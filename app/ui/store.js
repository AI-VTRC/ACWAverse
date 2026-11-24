// Application state, change notification and undo.

import { validateScenario } from '../../build/engine/index.js';

export const state = {
  /** The scenario being edited: the single source of truth. */
  scenario: null,
  /** { kind: 'node' | 'link' | 'sensor' | 'controller' | 'attack', id } or null. */
  selection: null,
  tool: 'select',
  /** Results of the latest run, or null. */
  results: null,
  /** True while the results no longer match the scenario. */
  stale: false,
  /** True between a change and the run that follows it. */
  pending: false,
  issues: [],
  runError: '',
  runMs: 0,
  autoRun: true,
  /** Index of the row shown on the diagram. */
  row: 0,
  playing: false,
  /** Rows per second during playback. */
  speed: 12,
  colorBy: 'none',
  showControl: true,
  showValues: true,
  /** Plotted series: [{ key, slot }]. */
  trends: [],
  panel: 'element'
};

const listeners = new Map();

/** Subscribe to one or more topics: scenario, selection, results, time, tool, view, trends, panel. */
export function on(topics, fn) {
  topics.split(' ').forEach(topic => {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(fn);
  });
}

export function emit(topic, detail) {
  (listeners.get(topic) || []).forEach(fn => fn(detail));
}

// ---------------------------------------------------------------- undo

const undoStack = [];
const redoStack = [];
let lastKey = '';
let lastTime = 0;

const snapshot = () => JSON.stringify(state.scenario);

/**
 * Change the scenario. `change` edits state.scenario in place. Consecutive
 * changes with the same `key` (typing in one field, dragging one node) are a
 * single step for undo.
 */
export function commit(change, key = '') {
  const now = Date.now();
  const merge = key !== '' && key === lastKey && now - lastTime < 1500;
  if (!merge) {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
  }
  redoStack.length = 0;
  lastKey = key;
  lastTime = now;
  change(state.scenario);
  changed();
}

function changed() {
  state.issues = validateScenario(state.scenario);
  state.stale = true;
  // A run is about to follow, so the diagram may keep showing the last one meanwhile.
  state.pending = state.autoRun && !state.issues.some(issue => issue.level === 'error');
  reconcileSelection();
  emit('scenario');
}

function reconcileSelection() {
  const sel = state.selection;
  if (!sel) return;
  const sc = state.scenario;
  const list = sel.kind === 'node' ? sc.nodes : sel.kind === 'link' ? sc.links
    : sel.kind === 'sensor' ? sc.sensors : sel.kind === 'controller' ? sc.controllers : sc.attacks;
  if (!(list || []).some(item => item.id === sel.id)) state.selection = null;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function undo() {
  if (!canUndo()) return;
  redoStack.push(snapshot());
  state.scenario = JSON.parse(undoStack.pop());
  lastKey = '';
  changed();
}

export function redo() {
  if (!canRedo()) return;
  undoStack.push(snapshot());
  state.scenario = JSON.parse(redoStack.pop());
  lastKey = '';
  changed();
}

/** Replace the whole scenario (a new file, an example). */
export function load(scenario) {
  undoStack.length = 0;
  redoStack.length = 0;
  lastKey = '';
  state.scenario = scenario;
  state.selection = null;
  state.results = null;
  state.row = 0;
  state.playing = false;
  state.trends = [];
  changed();
  emit('loaded');
}

export function select(kind, id) {
  state.selection = kind ? { kind, id } : null;
  if (kind) state.panel = 'element';
  emit('selection');
}

export function setRow(row) {
  const rows = state.results ? state.results.rows : 1;
  state.row = Math.max(0, Math.min(rows - 1, Math.round(row)));
  emit('time');
}

// ---------------------------------------------------------------- lookups

export const findNode = id => state.scenario.nodes.find(node => node.id === id);
export const findLink = id => state.scenario.links.find(link => link.id === id);
export const findElement = id => findNode(id) || findLink(id);
export const findSensor = id => (state.scenario.sensors || []).find(sensor => sensor.id === id);
export const findController = id => (state.scenario.controllers || []).find(controller => controller.id === id);
export const findAttack = id => (state.scenario.attacks || []).find(attack => attack.id === id);

/** Value of a series at the current row, or NaN. */
export function now(key) {
  const results = state.results;
  if (!results || !results.series[key]) return NaN;
  return results.series[key][Math.min(state.row, results.rows - 1)];
}

/** Attacks in progress at the current row. */
export function activeAttacks() {
  const results = state.results;
  if (!results) return [];
  const row = Math.min(state.row, results.rows - 1);
  return (state.scenario.attacks || []).filter(attack => results.labels.byAttack[attack.id] && results.labels.byAttack[attack.id][row] === 1);
}

/** The element, sensor or controller an attack acts on. */
export function attackTarget(attack) {
  switch (attack.type) {
    case 'data_poisoning': return attack.sensor;
    case 'command_injection': return attack.actuator;
    case 'controller_tamper': return attack.controller;
    case 'pump_failure': return attack.pump;
    case 'valve_stuck': return attack.valve;
    case 'pipe_blockage': return attack.pipe;
    default: return attack.node;
  }
}
