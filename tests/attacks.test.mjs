import assert from 'node:assert/strict';
import { test } from 'node:test';
import { at, first, junction, last, near, pipe, pump, reservoir, run, tank, valve, within } from './helpers.mjs';

const nodes = [
  reservoir('R', 0), tank('T', { elevation: 20, diameter: 3, height: 6, level: 3 }),
  junction('J'), junction('D', { demand: 0.004, requiredPressure: 1 })
];
const links = [pump('P', 'R', 'T'), pipe('L', 'T', 'J', { diameter: 0.15 }), valve('V', 'J', 'D', { kind: 'gate', diameter: 0.1 })];
const sensors = [{ id: 'LT', element: 'T', quantity: 'level' }, { id: 'FT', element: 'L', quantity: 'flow' }];
const controllers = [{ id: 'LC', type: 'onoff', sensor: 'LT', actuator: 'P', action: 'fill', low: 2, high: 4 }];
const go = (attacks, extra = {}) => run(nodes, links, { duration: 7200, timeStep: 30, reportStep: 60, sensors, controllers, attacks, ...extra });
const window = { start: 1800, duration: 1800 };
const rowsWhere = (r, predicate) => Array.from(r.times).map((t, i) => i).filter(i => predicate(r.times[i]));
const inside = t => t >= 1800 && t < 3600;

test('spoofing changes what a sensor reports, not what is true', () => {
  const baseline = go([]);
  const modes = {
    constant: (truth) => 2.5,
    offset: (truth) => truth + 0.5,
    scale: (truth) => truth * 0.5
  };
  for (const [mode, expected] of Object.entries(modes)) {
    const value = mode === 'constant' ? 2.5 : 0.5;
    const r = go([{ id: 'A', type: 'data_poisoning', sensor: 'FT', mode, value, ...window }]);
    for (let i = 0; i < r.rows; i++) {
      const truth = r.series['FT.true'][i];
      assert.equal(truth, r.series['L.flow'][i]);
      assert.equal(truth, baseline.series['L.flow'][i], 'a spoofed sensor nobody acts on leaves the plant alone');
      near(r.series['FT.reading'][i], inside(r.times[i]) ? expected(truth) : truth, 1e-12, `${mode} at ${r.times[i]}`);
    }
  }
});

test('freeze, drift and replay', () => {
  const freeze = go([{ id: 'A', type: 'data_poisoning', sensor: 'LT', mode: 'freeze', ...window }]);
  const held = at(freeze, 'LT.reading', 1800);
  within(held, Math.min(at(freeze, 'T.level', 1740), at(freeze, 'T.level', 1800)), Math.max(at(freeze, 'T.level', 1740), at(freeze, 'T.level', 1800)), 'holds the last reading from before the attack');
  rowsWhere(freeze, inside).forEach(i => assert.equal(freeze.series['LT.reading'][i], held));
  assert.notEqual(at(freeze, 'LT.reading', 3600), held);

  const drift = go([{ id: 'A', type: 'data_poisoning', sensor: 'FT', mode: 'drift', value: 0.002, ...window }]);
  near(at(drift, 'FT.reading', 2700) - at(drift, 'FT.true', 2700), 0.002 * 900 / 3600, 1e-9);

  const replay = go([{ id: 'A', type: 'data_poisoning', sensor: 'LT', mode: 'replay', value: 900, ...window }]);
  rowsWhere(replay, inside).forEach(i => near(replay.series['LT.reading'][i], at(replay, 'LT.true', replay.times[i] - 900), 1e-12));
});

test('a falsified level reading misleads the controller and the tank overflows', () => {
  const honest = go([], { duration: 6 * 3600 });
  assert.equal(last(honest, 'T.spilled'), 0);
  const r = go([{ id: 'A', type: 'data_poisoning', sensor: 'LT', mode: 'constant', value: 1.5, start: 600, duration: 4 * 3600 }], { duration: 6 * 3600 });
  assert.ok(last(r, 'T.spilled') > 1, 'the pump kept running because the level looked low');
  near(Math.max(...r.series['T.level']), 6, 1e-9);
  assert.equal(at(r, 'LT.reading', 3600), 1.5);
  assert.ok(r.events.some(e => e.kind === 'tank' && e.message.includes('overflowing')));
  assert.ok(r.events.some(e => e.kind === 'attack' && e.message.includes('started')));
});

test('an injected command overrides the controller for as long as it lasts', () => {
  const r = go([{ id: 'A', type: 'command_injection', actuator: 'P', value: 1, ...window }]);
  rowsWhere(r, inside).forEach(i => assert.equal(r.series['P.setting'][i], 1));
  assert.equal(at(r, 'LC.output', 3000), 0, 'the controller is asking for the pump to stop');
  assert.ok(at(r, 'T.level', 3000) > 4.5, 'but the pump runs on and the level passes the high limit');
  assert.equal(at(r, 'P.setting', 3600), 0, 'control returns when the attack ends');
  assert.equal(at(r, 'P.setting', 3600), at(r, 'LC.output', 3600));
});

test('a command can be injected into an actuator that no controller drives', () => {
  const r = go([{ id: 'A', type: 'command_injection', actuator: 'V', value: 0, ...window }]);
  near(at(r, 'D.supplied', 1740), 0.004, 1e-3);
  within(at(r, 'D.supplied', 2400), -1e-6, 1e-6);
  assert.equal(at(r, 'V.setting', 2400), 0);
  near(at(r, 'D.supplied', 3900), 0.004, 1e-3);
  assert.equal(at(r, 'V.setting', 3900), 1);
});

test('tampering with a controller: disabled, or with changed limits', () => {
  const off = go([{ id: 'A', type: 'controller_tamper', controller: 'LC', disable: true, start: 0 }], { duration: 6 * 3600 });
  assert.ok(last(off, 'T.spilled') > 0, 'nothing stops the pump any more');
  const moved = go([{ id: 'A', type: 'controller_tamper', controller: 'LC', set: { high: 5.5 }, start: 0, duration: 3 * 3600 }], { duration: 6 * 3600 });
  within(Math.max(...moved.series['T.level']), 5.5, 5.6);
  assert.equal(last(moved, 'T.spilled'), 0);
});

test('a failed pump stops and restarts when repaired', () => {
  const r = go([{ id: 'A', type: 'pump_failure', pump: 'P', ...window }], { controllers: [] });
  assert.ok(at(r, 'P.flow', 1740) > 0.01);
  rowsWhere(r, inside).forEach(i => {
    assert.equal(r.series['P.failed'][i], 1);
    assert.equal(r.series['P.running'][i], 0);
    within(r.series['P.flow'][i], -1e-6, 1e-6);
  });
  assert.equal(at(r, 'P.setting', 2400), 1, 'it is still being told to run');
  assert.ok(at(r, 'P.flow', 3660) > 0.01);
});

test('a stuck valve ignores commands', () => {
  const schedule = [{ id: 'S', type: 'timed', actuator: 'V', events: [{ time: 2400, value: 0 }] }];
  const r = go([{ id: 'A', type: 'valve_stuck', valve: 'V', ...window }], { controllers: [...controllers, ...schedule] });
  assert.equal(at(r, 'V.setting', 3000), 0);
  assert.equal(at(r, 'V.opening', 3000), 1, 'told to close, it stays open');
  near(at(r, 'D.supplied', 3000), 0.004, 1e-3);
  assert.equal(at(r, 'V.opening', 3660), 0, 'once freed it follows the command');
  const jammed = go([{ id: 'A', type: 'valve_stuck', valve: 'V', position: 0, ...window }]);
  within(at(jammed, 'D.supplied', 2400), -1e-6, 1e-6);
  assert.equal(at(jammed, 'V.setting', 2400), 1);
});

test('a burst at a junction loses water at the orifice rate', () => {
  const hole = 0.02;
  const r = go([{ id: 'A', type: 'leak', node: 'J', diameter: hole, ...window }]);
  assert.equal(at(r, 'J.leak', 1740), 0);
  assert.equal(at(r, 'J.leak', 3600), 0);
  const pressure = at(r, 'J.pressure', 2400);
  near(at(r, 'J.leak', 2400), 0.61 * Math.PI * hole * hole / 4 * Math.sqrt(2 * 9.80665 * pressure), 1e-6);
  near(at(r, 'L.flow', 2400), at(r, 'J.leak', 2400) + at(r, 'D.supplied', 2400), 1e-6);
  assert.ok(at(r, 'J.leak', 1800) > 0, 'the leak shows in the row where it starts');
  assert.ok(r.balance.leaked > 1);
});

test('a blocked pipe carries less, and none when fully blocked', () => {
  // Gravity flow between two reservoirs, so the pipe alone sets the flow.
  const n = [reservoir('A', 30), reservoir('B', 10)];
  const l = [pipe('L', 'A', 'B', { length: 50, diameter: 0.1 })];
  const blocked = fraction => run(n, l, { duration: 600, timeStep: 60, attacks: [{ id: 'X', type: 'pipe_blockage', pipe: 'L', fraction, start: 300 }] });
  const half = blocked(0.5);
  const most = blocked(0.9);
  assert.ok(last(half, 'L.flow') < first(half, 'L.flow'));
  assert.ok(last(most, 'L.flow') < 0.5 * last(half, 'L.flow'));
  // 90 % blocked: K = (0.9 / 0.1)² = 81 velocity heads on top of friction.
  const q = last(most, 'L.flow');
  const friction = 10.67 * 50 / (Math.pow(130, 1.852) * Math.pow(0.1, 4.8704)) * Math.pow(q, 1.852);
  near(friction + 81 * 8 * q * q / (Math.PI ** 2 * 9.80665 * 1e-4), 20, 1e-6);
  within(last(blocked(1), 'L.flow'), 0, 1e-6);
});

test('rows are labelled with the attacks in progress and their class', () => {
  const attacks = [
    { id: 'spoof', type: 'data_poisoning', sensor: 'LT', mode: 'offset', value: 0.1, start: 600, duration: 600 },
    { id: 'burst', type: 'leak', node: 'J', diameter: 0.01, start: 900, duration: 900 },
    { id: 'dose', type: 'chemical_interference', node: 'T', substance: 'tracer', amount: 100, start: 3000 },
    { id: 'slow', type: 'chemical_interference', node: 'T', substance: 'acid', amount: 10, start: 4200, duration: 600 }
  ];
  const r = go(attacks);
  const label = (name, t) => (name in r.labels.byAttack ? r.labels.byAttack[name] : r.labels[name])[r.times.indexOf(t)];
  assert.deepEqual([540, 600, 1140, 1200].map(t => label('spoof', t)), [0, 1, 1, 0]);
  assert.deepEqual([840, 900, 1740, 1800].map(t => label('burst', t)), [0, 1, 1, 0]);
  assert.deepEqual([2940, 3000, 3060].map(t => label('dose', t)), [0, 1, 0], 'an instant injection labels one row');
  assert.deepEqual([4140, 4200, 4740, 4800].map(t => label('slow', t)), [0, 1, 1, 0]);
  assert.deepEqual([300, 720, 1020, 1500, 2400, 3000].map(t => label('any', t)), [0, 1, 1, 1, 0, 1]);
  assert.deepEqual([720, 1020, 1500].map(t => label('data_poisoning', t)), [1, 1, 0]);
  assert.deepEqual([720, 1020, 1500].map(t => label('physical_damage', t)), [0, 1, 1]);
  assert.deepEqual([1500, 3000, 4500].map(t => label('chemical_interference', t)), [0, 1, 1]);
  near(at(r, 'T.tracer', 3000), 100 / at(r, 'T.volume', 3000), 1e-9, 'the dose shows in the row where it happens');
});

test('an attack with no duration lasts to the end of the run', () => {
  const r = go([{ id: 'A', type: 'pump_failure', pump: 'P', start: 3600 }]);
  assert.equal(last(r, 'P.failed'), 1);
  assert.equal(r.labels.any[r.rows - 1], 1);
  assert.equal(r.labels.any[0], 0);
});
