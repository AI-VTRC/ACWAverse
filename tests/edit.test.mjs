// Editing operations used by the application. Deleting must not leave debris:
// junctions that only served what was removed go with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScenario } from './helpers.mjs';
import { addLink, addNode, blankScenario, remove } from '../app/data/edit.js';

const example = file => JSON.parse(readFileSync(new URL(`../app/examples/${file}`, import.meta.url), 'utf8'));
const ids = list => list.map(item => item.id).sort();
const errors = scenario => validateScenario(scenario).filter(issue => issue.level !== 'warning');

test('deleting a tank removes the dead-end runs that led only to it', () => {
  const sc = example('four-tank-conditional.json');
  // T1 -PU1-> J1 -P1-> T2 -PU2-> J2 -P2-> T3 ...
  const also = remove(sc, 'node', 'T2');
  assert.deepEqual(ids(sc.nodes), ['J3', 'J4', 'T1', 'T3', 'T4']);
  assert.deepEqual(ids(sc.links), ['P3', 'P4', 'PU3', 'PU4']);
  assert.deepEqual([...also].sort(), ['J1', 'J2', 'P1', 'P2', 'PU1', 'PU2']);
  // Nothing refers to what is gone.
  sc.sensors.forEach(sensor => assert.ok(sc.nodes.concat(sc.links).some(item => item.id === sensor.element), sensor.id));
  sc.controllers.forEach(controller => assert.ok(sc.links.some(link => link.id === controller.actuator), controller.id));
  assert.deepEqual(errors(sc), []);
});

test('deleting every tank in turn leaves nothing behind', () => {
  const sc = example('four-tank-timed.json');
  ['T1', 'T2', 'T3', 'T4'].forEach(id => remove(sc, 'node', id));
  assert.deepEqual(sc.nodes, []);
  assert.deepEqual(sc.links, []);
  assert.deepEqual(sc.sensors, []);
  assert.deepEqual(sc.controllers, []);
});

test('deleting a link keeps a junction that still has a link, and removes one left with none', () => {
  const sc = example('four-tank-timed.json');
  assert.deepEqual(remove(sc, 'link', 'PU1'), []);
  assert.ok(sc.nodes.some(node => node.id === 'J1'), 'J1 still carries P1');
  assert.deepEqual(remove(sc, 'link', 'P1'), ['J1']);
  assert.ok(!sc.nodes.some(node => node.id === 'J1'));
  assert.ok(sc.nodes.some(node => node.id === 'T1') && sc.nodes.some(node => node.id === 'T2'));
});

test('consumers, branches, tanks and reservoirs are never pruned', () => {
  const tower = example('pumped-tower.json');
  remove(tower, 'node', 'TOWER');
  // The town is a consumer and stays; the pump and its discharge junction led only to the tower.
  assert.deepEqual(ids(tower.nodes), ['TOWN', 'WELL']);
  assert.deepEqual(tower.links, []);

  const town = example('muleshoe.json');
  remove(town, 'node', 'GST1');
  // The well header still feeds the other tank; the suction header still has its pumps.
  assert.ok(town.nodes.some(node => node.id === 'J1'));
  assert.ok(town.nodes.some(node => node.id === 'SUCTION'));
  assert.deepEqual(ids(town.links), ['P1', 'P3', 'P5', 'P6', 'P7', 'PU1', 'PU2', 'PU3']);
});

test('dead ends that were there before are left alone', () => {
  const sc = blankScenario();
  const a = addNode(sc, 'tank', 0, 0);
  const b = addNode(sc, 'tank', 200, 0);
  const stub = addNode(sc, 'junction', 0, 200);
  const lone = addNode(sc, 'junction', 400, 400);
  addLink(sc, 'pipe', a, b);
  addLink(sc, 'pipe', a, stub);
  remove(sc, 'node', b);
  assert.deepEqual(ids(sc.nodes), [stub, lone, a].sort());
  assert.equal(sc.links.length, 1);
});
