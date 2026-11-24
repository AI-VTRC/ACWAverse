import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulation, at, first, junction, last, near, oxygenSaturation, phOf, pipe, pump, reservoir, run, scenario, tank, ticFor, within } from './helpers.mjs';

const quiet = { chlorineBulkDecay: 0, bodDecay: 0, nitrification: 0, gasTransfer: 0, heatExchange: 0 };

test('pH follows from alkalinity and inorganic carbon', () => {
  for (const ph of [6, 7.5, 8.3, 9.5]) near(phOf(2, ticFor(ph, 2)), ph, 1e-6);
  // Pure water in equilibrium with air is slightly acid (about pH 5.6).
  within(phOf(0, 0.0334 * 420e-6 * 1000 * 1.2), 5.4, 5.8);
});

test('initial water quality is reported as given', () => {
  const quality = { temperature: 15, chlorine: 0.8, ph: 7.2, alkalinity: 120, oxygen: 6, bod: 2, ammonia: 0.4, nitrate: 3, tracer: 5 };
  const r = run([tank('T', { quality })], []);
  for (const [key, value] of Object.entries(quality)) near(first(r, `T.${key}`), value, 1e-6, key);
  assert.equal(first(r, 'T.age'), 0);
  const plain = run([tank('T')], []);
  near(first(plain, 'T.oxygen'), oxygenSaturation(20), 1e-9);
  near(first(plain, 'T.ph'), 7.5, 1e-6);
});

test('the scenario default quality applies to nodes without their own', () => {
  const r = run([tank('A', { quality: { chlorine: 1 } }), tank('B')], [], { quality: { chlorine: 0.3, temperature: 12 } });
  near(first(r, 'A.chlorine'), 1, 1e-9);
  near(first(r, 'A.temperature'), 12, 1e-9);
  near(first(r, 'B.chlorine'), 0.3, 1e-9);
});

test('chlorine decays at first order in a tank', () => {
  const r = run([tank('T', { quality: { chlorine: 1 } })], [], { duration: 86400, timeStep: 600, reportStep: 21600, chemistry: { ...quiet, chlorineBulkDecay: 1.2 } });
  near(at(r, 'T.chlorine', 21600), Math.exp(-0.3), 1e-9);
  near(last(r, 'T.chlorine'), Math.exp(-1.2), 1e-9);
  near(last(r, 'T.age'), 24, 1e-9);
});

test('wall demand makes chlorine decay faster in narrow pipes', () => {
  const build = diameter => run(
    [reservoir('R', 30, { quality: { chlorine: 1 } }), junction('J', { demand: 0.0005, requiredPressure: 1 })],
    [pipe('L', 'R', 'J', { length: 2000, diameter })],
    { duration: 12 * 3600, timeStep: 60, reportStep: 3600, chemistry: { ...quiet, chlorineWallDecay: 0.5 } });
  // Travel time is V/Q; decay rate at the wall is 4 kw / d.
  for (const d of [0.05, 0.1]) {
    const travel = Math.PI * d * d / 4 * 2000 / 0.0005;
    near(Math.log(last(build(d), 'J.chlorine')), -4 * 0.5 / 86400 / d * travel, 5e-3, `d = ${d}`);
  }
});

test('a front moves down a pipe as plug flow', () => {
  // 500 m of 0.1 m pipe holds 3.927 m³; at 2 L/s the front arrives after 1963 s.
  const nodes = [reservoir('R', 30, { quality: { tracer: 10 } }), junction('J', { demand: 0.002, requiredPressure: 1, quality: { tracer: 0 } })];
  const r = run(nodes, [pipe('L', 'R', 'J', { length: 500, diameter: 0.1 })], { duration: 2400, timeStep: 10, reportStep: 60, chemistry: quiet });
  within(at(r, 'J.tracer', 1920), 0, 1e-9);
  near(at(r, 'J.tracer', 2040), 10, 1e-9);
  near(at(r, 'J.age', 2040), 1963.5 / 3600, 0.01);
});

test('waters mix in proportion at a junction', () => {
  const nodes = [
    reservoir('A', 30, { quality: { tracer: 10, temperature: 10 } }), reservoir('B', 30, { quality: { tracer: 0, temperature: 30 } }),
    junction('J'), junction('D', { demand: 0.003, requiredPressure: 1 })
  ];
  const links = [pipe('LA', 'A', 'J', { length: 10 }), pipe('LB', 'B', 'J', { length: 10 }), pipe('LD', 'J', 'D', { length: 10 })];
  const r = run(nodes, links, { duration: 1200, timeStep: 10, reportStep: 600, chemistry: quiet });
  near(last(r, 'D.tracer'), 5, 1e-6);
  near(last(r, 'D.temperature'), 20, 1e-6);
});

test('a tank is a completely mixed reactor', () => {
  // Inflow q of tracer c into volume V at constant level: c(t) = c_in (1 - exp(-q t / V)).
  const nodes = [
    reservoir('R', 12, { quality: { tracer: 10 } }), tank('T', { elevation: 0, diameter: 2, height: 4, level: 2, quality: { tracer: 0 } }),
    junction('D', { elevation: -20, demand: 0.004, requiredPressure: 1 })
  ];
  const links = [
    { id: 'V', type: 'valve', from: 'R', to: 'T', diameter: 0.1, mode: 'flow', setting: 0.004, strokeTime: 0 },
    pipe('L', 'T', 'D', { length: 5, diameter: 0.2 })
  ];
  const r = run(nodes, links, { duration: 3600, timeStep: 5, reportStep: 600, chemistry: quiet });
  near(last(r, 'T.level'), 2, 1e-3);
  const volume = Math.PI * 2;
  for (const t of [600, 1800, 3600]) near(at(r, 'T.tracer', t), 10 * (1 - Math.exp(-0.004 * t / volume)), 5e-3, `t = ${t}`);
});

test('transport conserves mass', () => {
  const nodes = [
    reservoir('R', 0, { quality: { tracer: 2 } }), junction('J1'), tank('T', { elevation: 20, diameter: 6, height: 5, level: 1, quality: { tracer: 7 } }),
    junction('D', { demand: 0.003, requiredPressure: 1 })
  ];
  const links = [pump('P', 'R', 'J1'), pipe('L1', 'J1', 'T', { length: 300, diameter: 0.15 }), pipe('L2', 'T', 'D', { length: 400 })];
  const sim = new Simulation(scenario(nodes, links, { duration: 3600, timeStep: 30, chemistry: quiet }));
  const demand = sim.network.links.find(link => link.id === 'D/demand');
  const before = sim.quality.totalMass('tracer');
  let delivered = 0;
  let supplied = 0;
  let previous = 0;
  while (true) {
    const more = sim.step();
    const dt = sim.time - previous;
    previous = sim.time;
    supplied += sim.link('P').flow * dt * 2;
    delivered += demand.flow * dt * sim.quality.value(sim.node('D').index, 'tracer');
    if (!more) break;
  }
  const after = sim.quality.totalMass('tracer');
  near(after - before, supplied - delivered, 2e-3);
});

test('acid lowers pH and base raises it, by the right amount', () => {
  const nodes = [tank('T', { diameter: 2, height: 4, level: 2, quality: { ph: 7.5, alkalinity: 100 } })];
  const volume = Math.PI * 2;
  const dose = type => run(nodes, [], { duration: 600, timeStep: 60, chemistry: quiet, attacks: [{ id: 'A', type: 'chemical_interference', node: 'T', substance: type, amount: volume, start: 300 }] });
  // One mole per cubic metre is 1 meq/L, or 50 mg/L as CaCO3.
  const acid = dose('acid');
  near(at(acid, 'T.alkalinity', 240), 100, 1e-6);
  near(last(acid, 'T.alkalinity'), 100 - 50.04, 1e-6);
  assert.ok(last(acid, 'T.ph') < 6.6);
  const base = dose('base');
  near(last(base, 'T.alkalinity'), 100 + 50.04, 1e-6);
  assert.ok(last(base, 'T.ph') > 8.5);
});

test('nitrification turns ammonia into nitrate, using oxygen and alkalinity', () => {
  const nodes = [tank('T', { quality: { ammonia: 1, oxygen: 9, nitrate: 0, alkalinity: 100 } })];
  const r = run(nodes, [], { duration: 5 * 86400, timeStep: 600, reportStep: 86400, chemistry: { ...quiet, nitrification: 0.5 } });
  const converted = 1 - last(r, 'T.ammonia');
  within(converted, 0.85, 0.95);
  near(last(r, 'T.nitrate'), converted, 1e-9);
  near(9 - last(r, 'T.oxygen'), 4.57 * converted, 1e-9);
  near(100 - last(r, 'T.alkalinity'), 2 * converted / 14.007 * 50.04, 1e-9);
  assert.ok(last(r, 'T.ph') < first(r, 'T.ph'));
});

test('BOD uses up oxygen and stops when there is none', () => {
  const nodes = [tank('T', { quality: { bod: 30, oxygen: 8 } })];
  const r = run(nodes, [], { duration: 20 * 86400, timeStep: 3600, reportStep: 86400, chemistry: { ...quiet, bodDecay: 0.5 } });
  within(last(r, 'T.oxygen'), 0, 0.2);
  near(30 - last(r, 'T.bod'), 8 - last(r, 'T.oxygen'), 1e-9);
});

test('an open tank takes up oxygen from the air and drifts to ambient temperature', () => {
  const nodes = [tank('T', { diameter: 4, height: 3, level: 1, quality: { oxygen: 2, temperature: 5 } })];
  const r = run(nodes, [], { duration: 10 * 86400, timeStep: 3600, reportStep: 86400, chemistry: { ...quiet, gasTransfer: 0.5, heatExchange: 0.5 } });
  near(last(r, 'T.temperature'), 20, 0.01);
  near(last(r, 'T.oxygen'), oxygenSaturation(20), 0.02);
});

test('a substance injected at a junction is carried downstream in full', () => {
  const nodes = [reservoir('R', 30), junction('J'), junction('D', { demand: 0.002, requiredPressure: 1 })];
  const links = [pipe('L1', 'R', 'J', { length: 50 }), pipe('L2', 'J', 'D', { length: 200 })];
  const attacks = [{ id: 'A', type: 'chemical_interference', node: 'J', substance: 'tracer', amount: 60, start: 600, duration: 300 }];
  const r = run(nodes, links, { duration: 3600, timeStep: 10, reportStep: 10, chemistry: quiet, attacks });
  // 60 g over 300 s into 2 L/s is 100 mg/L while it lasts.
  near(at(r, 'J.tracer', 700), 100, 1e-4);
  within(at(r, 'J.tracer', 1000), 0, 1e-9);
  let mass = 0;
  for (let i = 1; i < r.rows; i++) mass += r.series['D.tracer'][i] * r.series['D.supplied'][i] * 10;
  near(mass, 60, 1e-3);
});

test('dechlorinator removes chlorine, down to none', () => {
  const nodes = [tank('T', { diameter: 2, height: 4, level: 2, quality: { chlorine: 1 } })];
  const volume = Math.PI * 2;
  const half = run(nodes, [], { duration: 120, timeStep: 60, chemistry: quiet, attacks: [{ id: 'A', type: 'chemical_interference', node: 'T', substance: 'dechlorinator', amount: 0.5 * volume, start: 60 }] });
  near(last(half, 'T.chlorine'), 0.5, 1e-9);
  const all = run(nodes, [], { duration: 120, timeStep: 60, chemistry: quiet, attacks: [{ id: 'A', type: 'chemical_interference', node: 'T', substance: 'dechlorinator', amount: 5 * volume, start: 60 }] });
  assert.equal(last(all, 'T.chlorine'), 0);
});

test('an oxygen scavenger removes dissolved oxygen, never below zero', () => {
  // Two tanks at the same level: nothing flows, each holds exactly 1 m³.
  const nodes = [
    tank('A', { diameter: 2, level: 1 / Math.PI, quality: { oxygen: 8 } }),
    tank('B', { diameter: 2, level: 1 / Math.PI, quality: { oxygen: 8 } })
  ];
  const links = [pipe('P', 'A', 'B')];
  const settings = { duration: 120, timeStep: 10, chemistry: { gasTransfer: 0, bodDecay: 0, nitrification: 0 } };
  const some = run(nodes, links, { ...settings, attacks: [{ id: 'X1', type: 'chemical_interference', node: 'A', substance: 'sulfite', amount: 3, start: 60 }] });
  near(last(some, 'A.oxygen'), 5, 1e-6);
  near(last(some, 'B.oxygen'), 8, 1e-6);
  const all = run(nodes, links, { ...settings, attacks: [{ id: 'X1', type: 'chemical_interference', node: 'A', substance: 'sulfite', amount: 50, start: 60 }] });
  assert.equal(last(all, 'A.oxygen'), 0);
});
