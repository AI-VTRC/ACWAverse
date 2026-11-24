import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUANTITIES, ScenarioError, junction, pipe, pump, reservoir, scenario, simulate, tank, validateScenario, valve } from './helpers.mjs';

const good = () => scenario(
  [reservoir('R', 0), tank('T'), junction('J', { demand: 0.001 })],
  [pump('P', 'R', 'T'), pipe('L', 'T', 'J'), valve('V', 'T', 'J')],
  {
    duration: 600,
    sensors: [{ id: 'LT', element: 'T', quantity: 'level' }],
    controllers: [{ id: 'C', type: 'onoff', sensor: 'LT', actuator: 'P', action: 'fill', low: 1, high: 3 }],
    attacks: [{ id: 'A', type: 'pump_failure', pump: 'P', start: 60 }]
  });
const errors = s => validateScenario(s).filter(issue => issue.level === 'error');
const broken = change => { const s = good(); change(s); return errors(s); };

test('a sound scenario has no issues', () => {
  assert.deepEqual(validateScenario(good()), []);
});

test('problems are reported against the element they concern', () => {
  const cases = [
    [s => { s.links[0].to = 'NOPE'; }, 'P', /does not exist/],
    [s => { s.links[1].to = 'T'; }, 'L', /same node/],
    [s => { s.nodes.push(junction('R')); }, 'R', /more than once/],
    [s => { s.sensors.push({ id: 'T', element: 'T', quantity: 'level' }); }, 'T', /more than once/],
    [s => { s.nodes[1].level = 9; }, 'T', /above the tank height/],
    [s => { s.nodes[1].diameter = 0; }, 'T', /diameter/],
    [s => { s.links[1].length = -5; }, 'L', /length/],
    [s => { s.links[0].maxFlow = 0; }, 'P', /Maximum flow/],
    [s => { s.links[0].curve = [10, 0, 5]; }, 'P', /curve/],
    [s => { s.links[2].setting = 1.5; }, 'V', /between 0 and 1/],
    [s => { s.sensors[0].quantity = 'flow'; }, 'LT', /no quantity/],
    [s => { s.sensors[0].element = 'X'; }, 'LT', /does not exist/],
    [s => { s.controllers[0].actuator = 'L'; }, 'C', /not a pump or valve/],
    [s => { s.controllers[0].low = 5; }, 'C', /below the high limit/],
    [s => { s.controllers[0].sensor = 'X'; }, 'C', /does not exist/],
    [s => { s.attacks[0].pump = 'V'; }, 'A', /not a pump/],
    [s => { s.attacks[0].start = 9999; }, 'A', /after the end/],
    [s => { s.attacks.push({ id: 'B', type: 'leak', node: 'R', diameter: 0.01, start: 0 }); }, 'B', /not a junction or tank/],
    [s => { s.attacks.push({ id: 'B', type: 'data_poisoning', sensor: 'LT', mode: 'offset', start: 0 }); }, 'B', /needs a value/],
    [s => { s.attacks.push({ id: 'B', type: 'chemical_interference', node: 'T', substance: 'gold', amount: 1, start: 0 }); }, 'B', /Unknown substance/],
    [s => { s.simulation.timeStep = 0; }, '', /Time step/]
  ];
  cases.forEach(([change, where, pattern]) => {
    const found = broken(change);
    assert.ok(found.some(issue => issue.where === where && pattern.test(issue.message)), `expected ${pattern} at "${where}", got ${JSON.stringify(found)}`);
  });
});

test('an invalid scenario is refused with the list of problems', () => {
  const s = good();
  s.links[0].from = 'NOPE';
  assert.throws(() => simulate(s), error => error instanceof ScenarioError && error.issues.length === 1 && error.issues[0].where === 'P');
});

test('warnings do not stop a run', () => {
  const s = good();
  s.nodes.push(junction('SPARE'));
  const issues = validateScenario(s);
  assert.deepEqual(issues.map(issue => [issue.level, issue.where]), [['warning', 'SPARE']]);
  assert.equal(simulate(s).warnings.length, 1);
});

test('every catalogued quantity of every element is recorded', () => {
  const r = simulate(good());
  const types = { R: 'reservoir', T: 'tank', J: 'junction', P: 'pump', L: 'pipe', V: 'valve' };
  for (const [id, type] of Object.entries(types)) {
    for (const quantity of Object.keys(QUANTITIES[type])) {
      const series = r.series[`${id}.${quantity}`];
      assert.ok(series, `${id}.${quantity}`);
      if (type !== 'reservoir' || quantity === 'head' || quantity === 'outflow' || quantity === 'supplied') {
        assert.ok(Array.from(series).every(Number.isFinite), `${id}.${quantity} has a value in every row`);
      }
    }
  }
  assert.equal(r.rows, 11);
  assert.equal(r.times[10], 600);
});

test('rows follow the report step, and the run ends on time when steps do not divide it', () => {
  const s = good();
  s.simulation = { duration: 1000, timeStep: 45, reportStep: 300 };
  const r = simulate(s);
  assert.deepEqual(Array.from(r.times.slice(0, r.rows)), [0, 300, 600, 900]);
});
