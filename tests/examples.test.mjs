// The example scenarios shipped with the application must load, validate and
// run cleanly, and each must show the behaviour its description promises.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { simulate, validateScenario, FORMAT } from './helpers.mjs';

const dir = new URL('../app/examples/', import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort();
const load = file => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
const max = series => series.reduce((a, b) => Math.max(a, b), -Infinity);
const min = series => series.reduce((a, b) => Math.min(a, b), Infinity);

test('there are seven examples', () => {
  assert.equal(files.length, 7);
});

for (const file of files) {
  test(`${file} is valid, runs and balances`, () => {
    const scenario = load(file);
    assert.equal(scenario.format, FORMAT);
    assert.deepEqual(validateScenario(scenario), []);
    scenario.nodes.forEach(node => assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${node.id} has a position`));
    const results = simulate(scenario);
    assert.equal(results.stats.unconverged, 0);
    assert.deepEqual(results.warnings, []);
    const moved = Math.max(1, results.balance.supplied, Math.abs(results.balance.stored));
    assert.ok(Math.abs(results.balance.error) < 1e-6 * moved, `water balance error ${results.balance.error}`);
    // A controller's output is blank while it issues no command; everything else is a number.
    results.columns.filter(column => column.group !== 'command')
      .forEach(column => assert.ok(results.series[column.key].every(Number.isFinite), `${column.key} is finite`));
  });
}

test('Muleshoe: the falsified tower level overflows the tower', () => {
  const scenario = load('muleshoe.json');
  const attacked = simulate(scenario);
  assert.ok(attacked.balance.spilled > 10);
  assert.ok(max(attacked.series['TOWER.level']) >= 8.99);
  // The operator sees 3.0 m while the tower is in fact full.
  const row = attacked.times.findIndex(t => t >= 19800);
  assert.ok(Math.abs(attacked.series['LT1.reading'][row] - 3) < 1e-9);
  assert.ok(attacked.series['LT1.true'][row] > 8.9);
  const normal = simulate({ ...scenario, attacks: [] });
  assert.equal(normal.balance.spilled, 0);
  assert.ok(max(normal.series['TOWER.level']) < 8.5);
  assert.ok(min(normal.series['TOWN.pressure']) > 14);
});

test('Four-tank loop: timed control moves water round the ring without spilling', () => {
  const results = simulate(load('four-tank-timed.json'));
  assert.equal(results.balance.spilled, 0);
  assert.ok(Math.abs(results.balance.stored) < 1e-6);
  assert.ok(min(results.series['T1.level']) < 1.0 && max(results.series['T2.level']) > 1.0);
});

test('Four-tank loop: the attacks overflow tank 3 and acidify tank 1', () => {
  const results = simulate(load('four-tank-conditional.json'));
  assert.ok(results.balance.spilled > 0.1);
  assert.ok(max(results.series['T3.level']) >= 1.999);
  assert.ok(min(results.series['T1.ph']) < 7);
  assert.ok(max(results.series['T2.bod']) > 1);
});

test('ACWA line: the falsified feed level runs the feed tank dry', () => {
  const scenario = load('acwa-line.json');
  const attacked = simulate(scenario);
  assert.ok(attacked.events.some(event => event.where === 'FEED' && /empty/.test(event.message)));
  assert.ok(min(attacked.series['T2.oxygen']) < 5);
  const normal = simulate({ ...scenario, attacks: [] });
  assert.ok(min(normal.series['FEED.level']) > 0.19);
});

test('ACWA bus: branch valves close as tanks fill; the attacks defeat one of them', () => {
  const scenario = load('acwa-bus.json');
  const normal = simulate({ ...scenario, attacks: [] });
  ['T1', 'T2', 'T3', 'T4'].forEach(id => assert.ok(max(normal.series[`${id}.level`]) < 1.9, id));
  const attacked = simulate(scenario);
  assert.ok(attacked.balance.leaked > 0.05);
  assert.ok(max(attacked.series['T4.nitrate']) > 1);
});

test('ACWA star: falsified outer levels overflow the outer tanks', () => {
  const scenario = load('acwa-star.json');
  assert.ok(simulate(scenario).balance.spilled > 0.5);
  assert.equal(simulate({ ...scenario, attacks: [] }).balance.spilled, 0);
});
