import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateDataset, junction, pipe, pump, reservoir, resultsTable, scenario, simulate, tank, toCSV } from './helpers.mjs';

const base = () => scenario(
  [reservoir('R', 0), tank('T', { elevation: 20, diameter: 3, height: 6, level: 3 }), junction('D', { demand: 0.004, requiredPressure: 1 })],
  [pump('P', 'R', 'T'), pipe('L', 'T', 'D', { diameter: 0.15 })],
  {
    duration: 3600, timeStep: 60, reportStep: 300,
    sensors: [{ id: 'LT', element: 'T', quantity: 'level', noise: 0.01 }, { id: 'FT', element: 'L', quantity: 'flow' }],
    controllers: [{ id: 'LC', type: 'onoff', sensor: 'LT', actuator: 'P', action: 'fill', low: 2, high: 4 }],
    attacks: [
      { id: 'spoof', type: 'data_poisoning', sensor: 'LT', mode: 'offset', value: -1, start: 600, duration: 900 },
      { id: 'burst', type: 'leak', node: 'D', diameter: 0.02, start: 1200, duration: 600 }
    ]
  });

test('a run as a table: readings, commands and labels', () => {
  const table = resultsTable(simulate(base()));
  assert.deepEqual(table.header, ['time', 'LT', 'FT', 'LC.output', 'attack', 'attack_class', 'attack_ids']);
  assert.equal(table.rows.length, 13);
  const row = t => table.rows.find(r => r[0] === t);
  assert.deepEqual(row(300).slice(4), [0, 'none', '']);
  assert.deepEqual(row(900).slice(4), [1, 'data_poisoning', 'spoof']);
  assert.deepEqual(row(1200).slice(4), [1, 'data_poisoning+physical_damage', 'spoof;burst']);
  assert.deepEqual(row(1500).slice(4), [1, 'physical_damage', 'burst']);
  assert.deepEqual(row(1800).slice(4), [0, 'none', '']);
});

test('the full table adds the truth behind each sensor and the plant state', () => {
  const table = resultsTable(simulate(base()), { columns: 'all' });
  for (const name of ['LT', 'LT.true', 'T.level', 'P.flow', 'D.leak', 'T.chlorine']) assert.ok(table.header.includes(name), name);
  const reported = table.header.indexOf('LT');
  const truth = table.header.indexOf('LT.true');
  const attacked = table.rows.find(r => r[0] === 900);
  assert.ok(Math.abs(attacked[reported] - attacked[truth] + 1) < 0.05);
});

test('CSV output', () => {
  const csv = toCSV({ header: ['a', 'b'], rows: [[1, 'x,y'], [2.5, 'say "hi"']] });
  assert.equal(csv, 'a,b\n1,"x,y"\n2.5,"say ""hi"""\n');
  const lines = toCSV(resultsTable(simulate(base()))).trim().split('\n');
  assert.equal(lines.length, 14);
  assert.ok(lines.every(line => line.split(',').length === 7));
});

test('a dataset holds normal and attacked runs, each a little different', () => {
  const data = generateDataset(base(), { attackRuns: 4, normalRuns: 2, seed: 3 });
  assert.equal(data.runs.length, 6);
  assert.equal(data.rows.length, 6 * 13);
  assert.equal(data.header[0], 'run');
  const attackColumn = data.header.indexOf('attack');
  const labelled = run => data.rows.filter(r => r[0] === run && r[attackColumn] === 1).length;
  assert.deepEqual(data.runs.map(r => r.kind), ['normal', 'normal', 'attack', 'attack', 'attack', 'attack']);
  assert.equal(labelled(1), 0);
  assert.equal(labelled(2), 0);
  for (let run = 3; run <= 6; run++) assert.ok(labelled(run) > 0, `run ${run} has attacked rows`);
  const starts = data.runs.slice(2).map(r => r.attacks[0].start);
  assert.ok(new Set(starts).size > 1, 'attack times vary between runs');
  data.runs.slice(2).forEach(r => r.attacks.forEach(a => assert.ok(a.start + a.duration <= 3600)));
  const levelColumn = data.header.indexOf('LT');
  const initial = [1, 2, 3].map(run => data.rows.find(r => r[0] === run)[levelColumn]);
  assert.ok(new Set(initial).size === 3, 'initial conditions vary between runs');
});

test('a dataset is reproducible from its seed', () => {
  const a = toCSV(generateDataset(base(), { attackRuns: 2, normalRuns: 1, seed: 11 }));
  const b = toCSV(generateDataset(base(), { attackRuns: 2, normalRuns: 1, seed: 11 }));
  const c = toCSV(generateDataset(base(), { attackRuns: 2, normalRuns: 1, seed: 12 }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('with the spreads set to zero, every run repeats the scenario as written', () => {
  const options = { attackRuns: 2, normalRuns: 0, shiftAttacks: false, attackSpread: 0, levelSpread: 0, demandSpread: 0 };
  const data = generateDataset(base(), options);
  data.runs.forEach(r => assert.deepEqual(r.attacks.map(a => [a.start, a.duration]), [[600, 900], [1200, 600]]));
});
