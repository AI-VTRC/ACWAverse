import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at, first, junction, last, near, pipe, pump, reservoir, run, tank, valve, within } from './helpers.mjs';

// A pump filling an elevated tank that feeds a steady demand.
const plant = (extra = {}) => ({
  nodes: [
    reservoir('R', 0), tank('T', { elevation: 20, diameter: 3, height: 6, level: 3 }),
    junction('D', { demand: 0.004, requiredPressure: 1 })
  ],
  links: [pump('P', 'R', 'T', extra.pump || {}), pipe('L', 'T', 'D', { diameter: 0.15 })]
});
const levelSensor = { id: 'LT', element: 'T', quantity: 'level' };

test('a sensor reports the quantity it measures', () => {
  const { nodes, links } = plant();
  const sensors = [levelSensor, { id: 'FT', element: 'L', quantity: 'flow' }, { id: 'PT', element: 'D', quantity: 'pressure' }];
  const r = run(nodes, links, { duration: 600, timeStep: 60, sensors });
  for (let i = 0; i < r.rows; i++) {
    assert.equal(r.series['LT.reading'][i], r.series['T.level'][i]);
    assert.equal(r.series['LT.true'][i], r.series['T.level'][i]);
    assert.equal(r.series['FT.reading'][i], r.series['L.flow'][i]);
    assert.equal(r.series['PT.reading'][i], r.series['D.pressure'][i]);
  }
  const column = r.columns.find(c => c.key === 'LT.reading');
  assert.equal(column.group, 'reading');
  assert.equal(column.unit, 'm');
});

test('sensor noise has the stated spread and repeats with the same seed', () => {
  const { nodes, links } = plant();
  const sensors = [{ ...levelSensor, noise: 0.05 }];
  const a = run(nodes, links, { duration: 36000, timeStep: 60, sensors, seed: 7 });
  const b = run(nodes, links, { duration: 36000, timeStep: 60, sensors, seed: 7 });
  const c = run(nodes, links, { duration: 36000, timeStep: 60, sensors, seed: 8 });
  assert.deepEqual(Array.from(a.series['LT.reading']), Array.from(b.series['LT.reading']));
  assert.notDeepEqual(Array.from(a.series['LT.reading']), Array.from(c.series['LT.reading']));
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < a.rows; i++) {
    const error = a.series['LT.reading'][i] - a.series['LT.true'][i];
    sum += error;
    squares += error * error;
  }
  within(Math.sqrt(squares / a.rows), 0.045, 0.055);
  within(sum / a.rows, -0.01, 0.01);
});

test('an on/off controller keeps a tank between its limits', () => {
  const { nodes, links } = plant();
  const controllers = [{ id: 'LC', type: 'onoff', sensor: 'LT', actuator: 'P', action: 'fill', low: 2, high: 4 }];
  const r = run(nodes, links, { duration: 8 * 3600, timeStep: 30, sensors: [levelSensor], controllers });
  const level = Array.from(r.series['T.level']);
  within(Math.min(...level), 1.95, 2.0);
  within(Math.max(...level), 4.0, 4.1);
  let starts = 0;
  for (let i = 1; i < r.rows; i++) if (r.series['P.running'][i] === 1 && r.series['P.running'][i - 1] === 0) starts++;
  assert.ok(starts >= 2, `the pump cycled ${starts} times`);
  // Inside the dead band the controller holds its last decision.
  for (let i = 1; i < r.rows; i++) {
    if (level[i] > 2.05 && level[i] < 3.95) assert.equal(r.series['LC.output'][i], r.series['LC.output'][i - 1]);
  }
});

test('an on/off controller can act in the draining direction', () => {
  const nodes = [tank('T', { elevation: 10, diameter: 2, height: 5, level: 4 }), junction('M'), reservoir('OUT', 0)];
  const links = [pipe('L', 'T', 'M', { length: 50, diameter: 0.05 }), valve('V', 'M', 'OUT', { kind: 'ball', setting: 0, diameter: 0.05 })];
  const controllers = [{ id: 'LC', type: 'onoff', sensor: 'LT', actuator: 'V', action: 'drain', low: 2, high: 3.5 }];
  const r = run(nodes, links, { duration: 3600, timeStep: 10, reportStep: 60, sensors: [levelSensor], controllers });
  assert.equal(at(r, 'V.setting', 0), 1, 'opens at once: the level is above the high limit');
  within(last(r, 'T.level'), 1.9, 2.0);
  assert.equal(last(r, 'V.setting'), 0);
});

test('a schedule switches at its times, and repeats', () => {
  const { nodes, links } = plant({ pump: { speed: 0 } });
  const controllers = [{ id: 'S', type: 'timed', actuator: 'P', events: [{ time: 600, value: 1 }, { time: 1200, value: 0 }], repeat: 1800 }];
  const r = run(nodes, links, { duration: 3600, timeStep: 60, controllers });
  const setting = t => at(r, 'P.setting', t);
  assert.deepEqual([0, 540, 600, 1140, 1200, 1740, 2400, 2940, 3000].map(setting), [0, 0, 1, 1, 0, 0, 1, 1, 0]);
});

test('a schedule event between time steps is still honoured on time', () => {
  const { nodes, links } = plant({ pump: { speed: 0 } });
  const controllers = [{ id: 'S', type: 'timed', actuator: 'P', events: [{ time: 90, value: 1 }] }];
  const r = run(nodes, links, { duration: 300, timeStep: 60, controllers });
  assert.equal(at(r, 'P.setting', 60), 0);
  assert.equal(at(r, 'P.setting', 120), 1);
  // Running for 30 of the 60 seconds: the tank gained half of what a full step brings.
  const gain = t => at(r, 'T.level', t) - at(r, 'T.level', t - 60);
  near(gain(120) - gain(60), (gain(180) - gain(60)) / 2, 0.02);
});

test('a rule acts while its condition holds', () => {
  const { nodes, links } = plant();
  const sensors = [levelSensor];
  const controllers = [{ id: 'HI', type: 'conditional', sensor: 'LT', operator: '>', threshold: 3.5, actuator: 'P', value: 0, otherwise: 1 }];
  const r = run(nodes, links, { duration: 3600, timeStep: 30, sensors, controllers });
  for (let i = 0; i < r.rows; i++) assert.equal(r.series['P.setting'][i], r.series['T.level'][i] > 3.5 ? 0 : 1);
});

test('later controllers override earlier ones for the same actuator', () => {
  const { nodes, links } = plant();
  const sensors = [levelSensor];
  const controllers = [
    { id: 'LC', type: 'onoff', sensor: 'LT', actuator: 'P', action: 'fill', low: 2, high: 4 },
    { id: 'TRIP', type: 'conditional', sensor: 'LT', operator: '>', threshold: 3.2, actuator: 'P', value: 0 }
  ];
  const r = run(nodes, links, { duration: 3600, timeStep: 30, sensors, controllers });
  within(Math.max(...r.series['T.level']), 3.2, 3.3);
  const disabled = run(nodes, links, { duration: 3600, timeStep: 30, sensors, controllers: [controllers[0], { ...controllers[1], enabled: false }] });
  assert.ok(Math.max(...disabled.series['T.level']) > 3.9);
});

test('a PID loop brings a level to its setpoint by varying pump speed', () => {
  const { nodes, links } = plant({ pump: { speed: 0.5, rampTime: 0 } });
  const controllers = [{ id: 'PID', type: 'pid', sensor: 'LT', actuator: 'P', setpoint: 4, kp: 2, ki: 0.005 }];
  const r = run(nodes, links, { duration: 6 * 3600, timeStep: 30, reportStep: 600, sensors: [levelSensor], controllers });
  near(last(r, 'T.level'), 4, 2e-3);
  near(last(r, 'P.flow'), 0.004, 0.01, 'inflow balances the demand');
  within(last(r, 'P.speed'), 0.75, 0.95);
  const output = Array.from(r.series['PID.output']);
  assert.ok(output.every(v => v >= 0 && v <= 1));
});

test('a PID loop can hold a pressure with a control valve', () => {
  const nodes = [reservoir('R', 40), junction('J'), junction('D', { demand: 0.01, requiredPressure: 5 })];
  const links = [pipe('L', 'R', 'J', { diameter: 0.15 }), valve('V', 'J', 'D', { kind: 'globe', setting: 1, diameter: 0.1, strokeTime: 0 })];
  const sensors = [{ id: 'PT', element: 'D', quantity: 'pressure' }];
  // Hold 20 m downstream of the valve. Opening the valve raises that pressure, so the loop is direct acting.
  const controllers = [{ id: 'PC', type: 'pid', sensor: 'PT', actuator: 'V', setpoint: 20, kp: 0.002, ki: 0.0003, min: 0.05, max: 1 }];
  const r = run(nodes, links, { duration: 3600, timeStep: 5, reportStep: 60, sensors, controllers });
  near(last(r, 'D.pressure'), 20, 5e-3);
  within(last(r, 'V.opening'), 0.06, 0.99);
  assert.ok(first(r, 'D.pressure') > 30);
});
