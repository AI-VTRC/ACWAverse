import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  G, at, darcyFrictionFactor, first, hazenWilliamsResistance, junction, last, near, pipe, pump, pumpCurve, pumpEfficiency,
  reservoir, run, tank, tankGeometry, tankLevelAt, tankVolumeAt, valve, valveLossCoefficient, within
} from './helpers.mjs';

const MINOR = 8 / (Math.PI * Math.PI * G);

test('a pipe between two reservoirs carries the Hazen-Williams flow', () => {
  const r = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'A', 'B', { length: 500, diameter: 0.2, roughness: 120 })]);
  const expected = Math.pow(20 / hazenWilliamsResistance(500, 0.2, 120), 1 / 1.852);
  near(first(r, 'L.flow'), expected, 1e-6);
  near(first(r, 'L.headloss'), 20, 1e-9);
  near(first(r, 'L.velocity'), expected / (Math.PI * 0.01), 1e-6);
});

test('flow is negative when water runs against the direction a pipe was drawn', () => {
  const forward = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'A', 'B')]);
  const backward = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'B', 'A')]);
  assert.ok(first(forward, 'L.flow') > 0);
  near(first(backward, 'L.flow'), -first(forward, 'L.flow'), 1e-9);
});

test('minor losses add to friction', () => {
  const k = 12;
  const r = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'A', 'B', { length: 500, diameter: 0.2, roughness: 120, minorLoss: k })]);
  const q = first(r, 'L.flow');
  near(hazenWilliamsResistance(500, 0.2, 120) * Math.pow(q, 1.852) + k * MINOR * q * q / Math.pow(0.2, 4), 20, 1e-6);
});

test('Darcy-Weisbach friction: laminar and rough turbulent factors', () => {
  near(darcyFrictionFactor(1000, 1e-4), 0.064, 1e-12);
  // Swamee-Jain at Re = 1e5, e/d = 1e-3 (Moody chart: about 0.0222)
  near(darcyFrictionFactor(1e5, 1e-3), 0.0222, 0.01);
  const r = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'A', 'B', { length: 500, diameter: 0.2, friction: 'darcy-weisbach', roughness: 0.26 })]);
  const q = first(r, 'L.flow');
  const re = 4 * q / (Math.PI * 0.2 * 1.004e-6);
  const f = darcyFrictionFactor(re, 0.26e-3 / 0.2);
  near(f * 500 / 0.2 * Math.pow(q / (Math.PI * 0.01), 2) / (2 * G), 20, 1e-5);
});

test('a pump moves water from its suction side to its discharge side', () => {
  // Lifting 20 m with a pump of 40 m shut-off head: 40 (1 - (q/Qmax)²) = 20.
  const r = run([reservoir('LOW', 0), reservoir('HIGH', 20)], [pump('P', 'LOW', 'HIGH')]);
  near(first(r, 'P.flow'), 0.03 * Math.sqrt(0.5), 1e-6);
  near(first(r, 'P.head'), 20, 1e-6);
  near(first(r, 'P.suctionPressure'), 0, 1e-9);
  near(first(r, 'P.dischargePressure'), 20, 1e-9);
  assert.equal(first(r, 'P.running'), 1);
});

test('turning a pump around turns the flow around', () => {
  // Drawn from HIGH to LOW the same pump pushes water downhill, helped by gravity:
  // 40 (1 - (q/Qmax)²) = -20.
  const r = run([reservoir('LOW', 0), reservoir('HIGH', 20)], [pump('P', 'HIGH', 'LOW')]);
  near(first(r, 'P.flow'), 0.03 * Math.sqrt(1.5), 1e-6);
  // Seen from the nodes: water leaves HIGH and arrives at LOW.
  assert.ok(first(r, 'HIGH.outflow') > 0);
  assert.ok(first(r, 'LOW.outflow') < 0);
});

test('a pump cannot lift water above its shut-off head', () => {
  const r = run([reservoir('LOW', 0), reservoir('HIGH', 50)], [pump('P', 'LOW', 'HIGH')]);
  within(first(r, 'P.flow'), -1e-6, 1e-6);
});

test('a stopped pump holds back water with its check valve, and lets it through without one', () => {
  const held = run([reservoir('LOW', 0), reservoir('HIGH', 20)], [pump('P', 'LOW', 'HIGH', { speed: 0 })]);
  within(first(held, 'P.flow'), -1e-6, 1e-6);
  assert.equal(first(held, 'P.running'), 0);
  const open = run([reservoir('LOW', 0), reservoir('HIGH', 20)], [pump('P', 'LOW', 'HIGH', { speed: 0, checkValve: false })]);
  assert.ok(first(open, 'P.flow') < -0.001, 'water runs back through the stopped pump');
});

test('pump speed follows the affinity laws', () => {
  // At half speed the shut-off head is a quarter: 10 m, not enough to lift 15 m.
  const stalled = run([reservoir('LOW', 0), reservoir('HIGH', 15)], [pump('P', 'LOW', 'HIGH', { speed: 0.5 })]);
  within(first(stalled, 'P.flow'), -1e-6, 1e-6);
  // Lifting 5 m at half speed: 10 - 40 (q/Qmax)² = 5.
  const slow = run([reservoir('LOW', 0), reservoir('HIGH', 5)], [pump('P', 'LOW', 'HIGH', { speed: 0.5 })]);
  near(first(slow, 'P.flow'), 0.03 * Math.sqrt(5 / 40), 1e-6);
});

test('a three-coefficient pump curve is honoured', () => {
  const curve = [50, -200, -20000];
  const r = run([reservoir('LOW', 0), reservoir('HIGH', 30)], [pump('P', 'LOW', 'HIGH', { curve })]);
  const q = first(r, 'P.flow');
  near(curve[0] + curve[1] * q + curve[2] * q * q, 30, 1e-6);
});

test('pump power, efficiency and energy', () => {
  const spec = pump('P', 'LOW', 'HIGH', { efficiency: 0.8, bepFlow: 0.018 });
  const curve = pumpCurve(spec);
  near(pumpEfficiency(curve, 1, 0.018), 0.8, 1e-9);
  // Lift chosen so that the pump runs at its best point.
  const lift = 40 * (1 - Math.pow(0.018 / 0.03, 2));
  const r = run([reservoir('LOW', 0), reservoir('HIGH', lift)], [spec], { duration: 3600, timeStep: 60 });
  near(last(r, 'P.flow'), 0.018, 1e-5);
  near(last(r, 'P.efficiency'), 0.8, 1e-4);
  const kw = 998.2 * G * 0.018 * lift / 0.8 / 1000;
  near(last(r, 'P.power'), kw, 1e-4);
  near(last(r, 'P.energy'), kw, 1e-4, 'kWh after one hour');
});

test('a pump ramps up to speed', () => {
  const r = run([reservoir('LOW', 0), reservoir('HIGH', 5)], [pump('P', 'LOW', 'HIGH', { speed: 0, rampTime: 20 })], {
    duration: 60, timeStep: 5,
    controllers: [{ id: 'C', type: 'timed', actuator: 'P', events: [{ time: 10, value: 1 }] }]
  });
  assert.equal(at(r, 'P.speed', 10), 0);
  near(at(r, 'P.speed', 15), 0.25, 1e-9);
  near(at(r, 'P.speed', 20), 0.5, 1e-9);
  assert.equal(at(r, 'P.speed', 30), 1);
});

test('a pump starved of suction pressure is reported as cavitating', () => {
  // Suction 8 m below atmospheric at the pump: NPSH available is about 2 m.
  const nodes = [reservoir('LOW', 0), junction('S', { elevation: 8 }), reservoir('HIGH', 20)];
  const links = [pipe('L', 'LOW', 'S', { diameter: 0.3, length: 5 }), pump('P', 'S', 'HIGH', { npshRequired: 4 })];
  const r = run(nodes, links);
  assert.ok(first(r, 'P.suctionPressure') < -7.9);
  assert.equal(first(r, 'P.cavitating'), 1);
  assert.ok(r.events.some(e => e.kind === 'pump' && e.where === 'P'));
  const fine = run([reservoir('LOW', 0), junction('S'), reservoir('HIGH', 20)], links);
  assert.equal(first(fine, 'P.cavitating'), 0);
});

test('valve loss coefficients follow the handbook tables', () => {
  near(valveLossCoefficient('gate', 1), 0.17, 1e-12);
  near(valveLossCoefficient('gate', 0.5), 4.5, 1e-12);
  near(valveLossCoefficient('butterfly', 0.56), 10.8, 1e-12);
  near(valveLossCoefficient('linear', 0.5, 4), 16, 1e-12);
  assert.ok(valveLossCoefficient('globe', 0.3) > valveLossCoefficient('globe', 0.6));
});

test('a throttled valve passes the flow its loss coefficient allows', () => {
  const r = run([reservoir('A', 12), reservoir('B', 2)], [valve('V', 'A', 'B', { kind: 'gate', setting: 0.5 })]);
  near(first(r, 'V.flow'), Math.sqrt(10 * 1e-4 / (4.5 * MINOR)), 1e-6);
  near(first(r, 'V.opening'), 0.5, 1e-12);
});

test('a closed valve passes nothing', () => {
  const r = run([reservoir('A', 12), reservoir('B', 2)], [valve('V', 'A', 'B', { setting: 0 })]);
  within(first(r, 'V.flow'), 0, 1e-6);
});

test('a flow-control valve holds its flow limit', () => {
  const nodes = [reservoir('A', 30), junction('J'), reservoir('B', 0)];
  const links = [pipe('L', 'A', 'J', { diameter: 0.2 }), valve('V', 'J', 'B', { mode: 'flow', setting: 0.004, diameter: 0.2 })];
  const r = run(nodes, links);
  near(first(r, 'V.flow'), 0.004, 1e-4);
  // With a limit above what the pipe can deliver, the valve is simply open.
  links[1] = valve('V', 'J', 'B', { mode: 'flow', setting: 10, diameter: 0.2 });
  const open = run(nodes, links);
  assert.ok(first(open, 'V.flow') > 0.05);
});

test('a valve takes its stroke time to move', () => {
  const r = run([reservoir('A', 12), reservoir('B', 2)], [valve('V', 'A', 'B', { setting: 1, strokeTime: 40 })], {
    duration: 60, timeStep: 10,
    controllers: [{ id: 'C', type: 'timed', actuator: 'V', events: [{ time: 0, value: 0 }] }]
  });
  near(at(r, 'V.opening', 10), 0.75, 1e-9);
  near(at(r, 'V.opening', 40), 0, 1e-9);
  assert.equal(at(r, 'V.setting', 10), 0);
});

test('a check valve stops reverse flow in a pipe', () => {
  const r = run([reservoir('A', 10), reservoir('B', 30)], [pipe('L', 'A', 'B', { checkValve: true })]);
  within(first(r, 'L.flow'), -1e-6, 0);
  const closed = run([reservoir('A', 30), reservoir('B', 10)], [pipe('L', 'A', 'B', { closed: true })]);
  within(first(closed, 'L.flow'), 0, 1e-6);
});

test('junction pressure is head above the junction elevation', () => {
  const r = run([reservoir('A', 50), junction('J', { elevation: 12 }), reservoir('B', 30)], [pipe('L1', 'A', 'J'), pipe('L2', 'J', 'B')]);
  near(first(r, 'J.head'), 40, 1e-9);
  near(first(r, 'J.pressure'), 28, 1e-9);
});

test('demand is delivered in full when there is pressure, and follows its pattern', () => {
  const nodes = [reservoir('A', 50), junction('J', { demand: 0.004, pattern: [1, 0.5, 2], patternStep: 600 })];
  const r = run(nodes, [pipe('L', 'A', 'J', { diameter: 0.2 })], { duration: 1800, timeStep: 60, reportStep: 300 });
  near(at(r, 'J.supplied', 0), 0.004, 1e-4);
  near(at(r, 'J.supplied', 600), 0.002, 1e-4);
  near(at(r, 'J.supplied', 1500), 0.008, 1e-4);
  near(at(r, 'J.demand', 1500), 0.008, 1e-12);
  near(at(r, 'L.flow', 1500), 0.008, 1e-4);
});

test('demand falls off with pressure (Wagner)', () => {
  // 5 m of pressure where 20 m is required: half the demand is delivered.
  const nodes = [reservoir('A', 5), junction('J', { demand: 0.001, requiredPressure: 20 })];
  const r = run(nodes, [pipe('L', 'A', 'J', { diameter: 0.5, length: 1 })]);
  near(first(r, 'J.supplied'), 0.0005, 1e-3);
  assert.ok(r.events.some(e => e.kind === 'supply' && e.where === 'J'));
  // No pressure, no water, and never any inflow from the tap.
  const dry = run([reservoir('A', -5), junction('J', { demand: 0.001 })], [pipe('L', 'A', 'J')]);
  within(first(dry, 'J.supplied'), -1e-6, 1e-6);
});

test('tank geometry: cylinder, box and sphere', () => {
  near(tankGeometry({ diameter: 4, height: 5 }).maxVolume, Math.PI * 4 * 5, 1e-12);
  near(tankGeometry({ shape: 'box', width: 2, length: 3, height: 4 }).maxVolume, 24, 1e-12);
  const sphere = tankGeometry({ shape: 'sphere', diameter: 6, height: 6 });
  near(sphere.maxVolume, 4 / 3 * Math.PI * 27, 1e-12);
  near(tankVolumeAt(sphere, 3), 2 / 3 * Math.PI * 27, 1e-12);
  near(tankLevelAt(sphere, tankVolumeAt(sphere, 1.7)), 1.7, 1e-9);
});

test('a tank fills at the rate water arrives', () => {
  const nodes = [reservoir('R', 0), tank('T', { elevation: 5, diameter: 4, height: 6, level: 1 })];
  const r = run(nodes, [pump('P', 'R', 'T')], { duration: 600, timeStep: 10, reportStep: 600 });
  const volumeIn = r.balance.supplied;
  near(last(r, 'T.volume') - first(r, 'T.volume'), volumeIn, 1e-9);
  near(last(r, 'T.level'), 1 + volumeIn / (Math.PI * 4), 1e-9);
  assert.ok(last(r, 'T.inflow') > 0 && last(r, 'T.outflow') === 0);
  assert.ok(Math.abs(r.balance.error) < 1e-9);
});

test('two connected tanks level out', () => {
  const nodes = [tank('A', { level: 4 }), tank('B', { level: 1 })];
  const r = run(nodes, [pipe('L', 'A', 'B', { length: 20, diameter: 0.2 })], { duration: 7200, timeStep: 30, reportStep: 600 });
  near(last(r, 'A.level'), 2.5, 2e-3);
  near(last(r, 'B.level'), 2.5, 2e-3);
  near(last(r, 'A.volume') + last(r, 'B.volume'), first(r, 'A.volume') + first(r, 'B.volume'), 1e-12);
});

test('a full tank spills, or shuts its inlet', () => {
  const nodes = mode => [reservoir('R', 30), tank('T', { diameter: 2, height: 3, level: 2.5, whenFull: mode })];
  const links = [pipe('L', 'R', 'T', { diameter: 0.1 })];
  const spill = run(nodes('spill'), links, { duration: 1800, timeStep: 60 });
  near(last(spill, 'T.level'), 3, 1e-9);
  assert.ok(last(spill, 'T.spilled') > 1);
  assert.ok(last(spill, 'T.overflow') > 0);
  near(last(spill, 'T.overflow'), last(spill, 'L.flow'), 1e-6);
  assert.ok(Math.abs(spill.balance.error) < 1e-8);
  assert.ok(spill.events.some(e => e.message.includes('overflowing')));
  const shut = run(nodes('closeInlet'), links, { duration: 1800, timeStep: 60 });
  near(last(shut, 'T.level'), 3, 1e-6);
  assert.ok(last(shut, 'T.spilled') < 1e-6);
  assert.ok(!shut.events.some(e => e.message.includes('overflowing')));
  within(last(shut, 'L.flow'), -1e-6, 1e-6);
});

test('a tank that runs dry stops supplying', () => {
  const nodes = [tank('T', { elevation: 20, diameter: 2, height: 3, level: 0.5 }), junction('J', { demand: 0.005, requiredPressure: 1 })];
  const r = run(nodes, [pipe('L', 'T', 'J', { diameter: 0.15 })], { duration: 1200, timeStep: 30, reportStep: 60 });
  near(at(r, 'J.supplied', 60), 0.005, 1e-3);
  assert.ok(last(r, 'T.level') < 1e-9);
  within(last(r, 'J.supplied'), 0, 1e-6);
  near(r.balance.delivered, Math.PI * 0.5, 1e-6, 'all the stored water was delivered, and no more');
  assert.ok(r.events.some(e => e.message.includes('ran empty')));
});

test('a leaking tank drains as Torricelli predicts', () => {
  const hole = 0.05;
  const nodes = [tank('T', { diameter: 3, height: 4, level: 3 })];
  const r = run(nodes, [], { duration: 1800, timeStep: 5, reportStep: 300, attacks: [{ id: 'A', type: 'leak', node: 'T', diameter: hole, start: 0 }] });
  const k = 0.61 * (Math.PI * hole * hole / 4) / (Math.PI * 1.5 * 1.5) * Math.sqrt(2 * G) / 2;
  for (const t of [300, 900, 1800]) near(at(r, 'T.level', t), Math.pow(Math.sqrt(3) - k * t, 2), 2e-3);
  near(first(r, 'T.leak'), 0.61 * (Math.PI * hole * hole / 4) * Math.sqrt(2 * G * 3), 1e-6);
  near(r.balance.leaked, first(r, 'T.volume') - last(r, 'T.volume'), 1e-9);
});

test('water is conserved in a network with pumps, tanks, demands, a leak and a spill', () => {
  const nodes = [
    reservoir('R', 0), junction('J1'), tank('T1', { elevation: 20, diameter: 3, height: 3, level: 2.5 }),
    junction('J2', { demand: 0.004, pattern: [1, 2, 0.5], patternStep: 900 }), tank('T2', { elevation: 5, diameter: 2, height: 2, level: 0.2 })
  ];
  const links = [
    pump('P', 'R', 'J1'), pipe('L1', 'J1', 'T1', { diameter: 0.15 }), pipe('L2', 'T1', 'J2'),
    valve('V', 'J2', 'T2', { kind: 'globe', setting: 0.4 })
  ];
  const r = run(nodes, links, { duration: 7200, timeStep: 30, reportStep: 600, attacks: [{ id: 'A', type: 'leak', node: 'J2', diameter: 0.01, start: 1800, duration: 1800 }] });
  assert.ok(r.balance.spilled > 0 && r.balance.leaked > 0 && r.balance.delivered > 0);
  assert.ok(Math.abs(r.balance.error) < 1e-6 * r.balance.supplied, `balance error ${r.balance.error}`);
  assert.equal(r.stats.unconverged, 0);
});

test('parts that are cut off or not connected do not upset the solution', () => {
  const nodes = [reservoir('A', 30), reservoir('B', 10), junction('LONE'), junction('X'), junction('Y'), tank('T')];
  const links = [pipe('L', 'A', 'B'), pump('P', 'X', 'Y'), pipe('C', 'Y', 'T', { closed: true })];
  const r = run(nodes, links, { duration: 600, timeStep: 60 });
  assert.equal(r.stats.unconverged, 0);
  assert.ok(first(r, 'L.flow') > 0);
  within(last(r, 'P.flow'), -1e-6, 1e-6);
  near(last(r, 'T.level'), 2, 1e-6);
  assert.ok(r.warnings.some(w => w.where === 'LONE'));
});
