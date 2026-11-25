// Shared helpers for the test suite. The engine is tested as built: run
// `npm test`, which compiles it first.
import assert from 'node:assert/strict';
export * from '../build/engine/index.js';
import { simulate } from '../build/engine/index.js';

export function near(actual, expected, tolerance, message = '') {
  const scale = Math.max(Math.abs(expected), 1e-12);
  const error = Math.abs(actual - expected);
  assert.ok(error <= tolerance * scale || error <= 1e-12, `${message} expected ${expected}, got ${actual} (relative error ${(error / scale).toExponential(2)})`);
}

export function within(actual, low, high, message = '') {
  assert.ok(actual >= low && actual <= high, `${message} expected a value in [${low}, ${high}], got ${actual}`);
}

export const reservoir = (id, head, extra = {}) => ({ id, type: 'reservoir', head, ...extra });
export const junction = (id, extra = {}) => ({ id, type: 'junction', elevation: 0, ...extra });
export const tank = (id, extra = {}) => ({ id, type: 'tank', elevation: 0, diameter: 4, height: 5, level: 2, ...extra });
export const pipe = (id, from, to, extra = {}) => ({ id, type: 'pipe', from, to, length: 100, diameter: 0.1, ...extra });
export const pump = (id, from, to, extra = {}) => ({ id, type: 'pump', from, to, shutoffHead: 40, maxFlow: 0.03, rampTime: 0, ...extra });
export const valve = (id, from, to, extra = {}) => ({ id, type: 'valve', from, to, diameter: 0.1, strokeTime: 0, ...extra });

/** Build a scenario with sensible defaults. */
export function scenario(nodes, links, extra = {}) {
  const { duration = 0, timeStep = 60, reportStep, seed, ...rest } = extra;
  return { name: 'test', nodes, links, simulation: { duration, timeStep, reportStep, seed }, ...rest };
}

export function run(nodes, links, extra = {}) {
  return simulate(scenario(nodes, links, extra));
}

/** Value of a series at a time (s). */
export function at(results, key, time) {
  const series = results.series[key];
  assert.ok(series, `no series "${key}"`);
  let row = -1;
  for (let i = 0; i < results.rows; i++) if (Math.abs(results.times[i] - time) < 1e-6) row = i;
  assert.ok(row >= 0, `no row at time ${time}`);
  return series[row];
}

export const last = (results, key) => results.series[key][results.rows - 1];
export const first = (results, key) => results.series[key][0];
export const G = 9.80665;
