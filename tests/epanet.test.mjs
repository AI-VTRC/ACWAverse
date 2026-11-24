// The engine against EPANET 2.2 on the same networks. The reference values
// come from tools/epanet_reference.py.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { simulate } from './helpers.mjs';

const read = name => JSON.parse(readFileSync(new URL(`./epanet/${name}`, import.meta.url), 'utf8'));
const cases = read('cases.json');
const references = read('reference.json');

// Largest allowed difference, as a fraction of the largest EPANET value in the series.
const TOLERANCE = { flows: 0.002, heads: 0.001, levels: 0.004, chlorine: 0.015 };
const QUANTITY = { flows: 'flow', heads: 'head', levels: 'level', chlorine: 'chlorine' };
const FLOOR = { flows: 1e-6, heads: 1, levels: 1, chlorine: 0.1 };

for (const item of cases) {
  test(`agrees with EPANET: ${item.description}`, () => {
    const reference = references.find(entry => entry.name === item.name);
    assert.ok(reference, 'run tools/epanet_reference.py to create the reference');
    const results = simulate(item.scenario);
    assert.equal(results.rows, reference.time.length);
    assert.equal(results.stats.unconverged, 0);
    for (const kind of Object.keys(TOLERANCE)) {
      for (const [id, expected] of Object.entries(reference[kind] || {})) {
        const mine = results.series[`${id}.${QUANTITY[kind]}`];
        const scale = Math.max(FLOOR[kind], ...expected.map(Math.abs));
        expected.forEach((value, row) => {
          const error = Math.abs(mine[row] - value) / scale;
          assert.ok(error <= TOLERANCE[kind], `${kind} of ${id} at ${reference.time[row]} s: EPANET ${value}, engine ${mine[row]}`);
        });
      }
    }
  });
}
