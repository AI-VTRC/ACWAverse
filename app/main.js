// ACWAverse: the application shell. Builds the page, runs the simulation
// when the scenario changes, and wires the keyboard.

import { simulate } from '../build/engine/index.js';
import * as edit from './data/edit.js';
import { EXAMPLES, loadExample } from './data/io.js';
import { mountDock, toggleTrend } from './ui/dock.js';
import { debounce, h, num, s } from './ui/dom.js';
import { deleteElement, mountPanels, toast } from './ui/panels.js';
import { canRedo, canUndo, commit, emit, load, on, redo, select, setRow, state, undo } from './ui/store.js';
import { cancelPending, fit, mountDiagram, zoom } from './viz/diagram.js';

// ---------------------------------------------------------------- running

let freshlyLoaded = false;

function runNow() {
  state.pending = false;
  if (state.issues.some(issue => issue.level === 'error')) { emit('results'); return; }
  const started = performance.now();
  try {
    state.results = simulate(state.scenario);
    state.runError = '';
    state.stale = false;
  } catch (error) {
    state.results = null;
    state.runError = error && error.message ? error.message : String(error);
  }
  state.runMs = performance.now() - started;
  if (state.results) {
    state.row = Math.min(state.row, state.results.rows - 1);
    if (freshlyLoaded) {
      freshlyLoaded = false;
      openingView();
    }
    // Keep plotted series that still exist.
    const keys = new Set(state.results.columns.map(column => column.key));
    state.trends = state.trends.filter(trend => keys.has(trend.key));
  }
  if (state.autoRun && state.runMs > 1500) {
    state.autoRun = false;
    toast('This scenario takes a while to compute, so it now runs only when you press Run.');
  }
  emit('results');
}

/** What a newly opened scenario shows first: its sensors plotted, at a moment worth looking at. */
function openingView() {
  const results = state.results;
  const sensors = (state.scenario.sensors || []).slice(0, 4).map(sensor => `${sensor.id}.reading`);
  const tanks = state.scenario.nodes.filter(node => node.type === 'tank').slice(0, 4).map(node => `${node.id}.level`);
  state.trends = [];
  (sensors.length > 0 ? sensors : tanks).forEach(key => toggleTrend(key));
  const firstAttacked = results.labels.any.indexOf(1);
  if (firstAttacked >= 0) {
    let end = firstAttacked;
    while (end + 1 < results.rows && results.labels.any[end + 1] === 1) end++;
    state.row = Math.round(firstAttacked + 0.6 * (end - firstAttacked));
  } else {
    state.row = Math.round(results.rows / 3);
  }
}

const scheduleRun = debounce(runNow, 180);

// ---------------------------------------------------------------- shell

function toolIcon(tool) {
  const parts = {
    select: [s('path', { d: 'M6,3 L6,19 L10.5,15 L13.5,21 L16,19.8 L13,14 L19,13.5 Z', class: 'fill' })],
    junction: [s('circle', { cx: 12, cy: 12, r: 4.5, class: 'fill' }), s('path', { d: 'M2,12 H7.5 M16.5,12 H22' })],
    tank: [s('path', { d: 'M5,4 V20 H19 V4' }), s('path', { d: 'M5,11 H19 V20 H5 Z', class: 'fill soft' })],
    reservoir: [s('path', { d: 'M2,8 L4,11 V19 H20 V11 L22,8' }), s('path', { d: 'M4,12 q2,-2 4,0 t4,0 t4,0 t4,0 V19 H4 Z', class: 'fill soft' })],
    pipe: [s('path', { d: 'M2,12 H22', 'stroke-width': 3.2 }), s('path', { d: 'M13,8 L17,12 L13,16' , class: 'thin' })],
    pump: [s('circle', { cx: 12, cy: 12, r: 8 }), s('path', { d: 'M8.5,7.5 L17,12 L8.5,16.5 Z', class: 'fill' })],
    valve: [s('path', { d: 'M3,6 L12,12 L3,18 Z M21,6 L12,12 L21,18 Z' })]
  }[tool];
  return s('svg', { viewBox: '0 0 24 24', width: 22, height: 22, 'aria-hidden': 'true' }, parts);
}

const TOOLS = [
  ['select', 'Select', 'Select and move things (Esc)'],
  ['junction', 'Junction', 'Add a junction: a point where pipes meet or water is used'],
  ['tank', 'Tank', 'Add a storage tank'],
  ['reservoir', 'Reservoir', 'Add a reservoir: a source at a fixed level, such as a well field or lake'],
  ['pipe', 'Pipe', 'Draw a pipe between two nodes'],
  ['pump', 'Pump', 'Draw a pump from its suction node to its discharge node'],
  ['valve', 'Valve', 'Draw a valve from its inlet node to its outlet node']
];

const COLOR_BY = [
  ['none', 'Plain'], ['pressure', 'Pressure'], ['velocity', 'Pipe velocity'], ['chlorine', 'Chlorine'], ['ph', 'pH'],
  ['tracer', 'Tracer'], ['age', 'Water age'], ['temperature', 'Temperature'], ['oxygen', 'Dissolved oxygen'], ['ammonia', 'Ammonia']
];

function build(app) {
  const status = h('button', { class: 'status', id: 'status', title: 'Open the Run tab', onclick: () => { state.panel = 'run'; emit('panel'); } });
  const runButton = h('button', { class: 'btn primary', id: 'run', onclick: runNow }, 'Run');
  const undoButton = h('button', { class: 'btn', id: 'undo', title: 'Undo (Ctrl+Z)', onclick: undo }, 'Undo');
  const redoButton = h('button', { class: 'btn', id: 'redo', title: 'Redo (Ctrl+Shift+Z)', onclick: redo }, 'Redo');
  const exampleSelect = h('select', {
    id: 'example', 'aria-label': 'Open an example',
    onchange: async event => {
      const file = event.target.value;
      if (!file) return;
      try { openScenario(await loadExample(file)); } catch (error) { toast(error.message); }
    }
  }, h('option', { value: '' }, 'Examples…'), EXAMPLES.map(example => h('option', { value: example.file }, example.title)));

  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('strong', null, 'ACWAverse'), h('span', { id: 'scenario-name' })),
    h('div', { class: 'bar-group' }, exampleSelect, undoButton, redoButton),
    h('div', { class: 'bar-group view-options' },
      h('label', { for: 'color-by' }, 'Colour by'),
      h('select', { id: 'color-by', onchange: event => { state.colorBy = event.target.value; emit('view'); } }, COLOR_BY.map(([value, label]) => h('option', { value }, label))),
      h('label', { class: 'toggle', for: 'show-control' }, h('input', { id: 'show-control', type: 'checkbox', checked: state.showControl, onchange: event => { state.showControl = event.target.checked; emit('selection'); } }), 'Control layer'),
      h('label', { class: 'toggle', for: 'show-values' }, h('input', { id: 'show-values', type: 'checkbox', checked: state.showValues, onchange: event => { state.showValues = event.target.checked; emit('view'); } }), 'Values')),
    h('div', { class: 'bar-group end' }, status, runButton));

  const rail = h('nav', { class: 'rail', 'aria-label': 'Drawing tools' }, TOOLS.map(([tool, label, title]) => h('button', {
    class: 'tool', 'data-tool': tool, title, 'aria-pressed': 'false', onclick: () => { state.tool = tool; emit('tool'); }
  }, toolIcon(tool), h('span', null, label))));

  const stage = h('main', { class: 'stage' });
  const zoomBox = h('div', { class: 'zoom' },
    h('button', { class: 'btn icon-btn', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => zoom(1.25) }, '+'),
    h('button', { class: 'btn icon-btn', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => zoom(0.8) }, '−'),
    h('button', { class: 'btn', title: 'Show the whole system', onclick: fit }, 'Fit'));
  const side = h('aside', { class: 'side', 'aria-label': 'Details' });
  const dock = h('section', { class: 'dock', 'aria-label': 'Time and trends' });
  app.append(topbar, rail, stage, dock, side, h('div', { id: 'toast', class: 'toast', role: 'status', hidden: true }));

  mountDiagram(stage);
  stage.append(zoomBox);
  const dockApi = mountDock(dock);
  mountPanels(side);

  const refresh = () => {
    const errors = state.issues.filter(issue => issue.level === 'error').length;
    document.getElementById('scenario-name').textContent = state.scenario.name || '';
    undoButton.disabled = !canUndo();
    redoButton.disabled = !canRedo();
    runButton.hidden = state.autoRun && errors === 0;
    runButton.disabled = errors > 0;
    let text;
    let kind = 'ok';
    if (errors > 0) { text = `${errors} ${errors === 1 ? 'problem' : 'problems'} to fix`; kind = 'bad'; }
    else if (state.runError) { text = 'The run stopped'; kind = 'bad'; }
    else if (state.pending) { text = 'Running…'; kind = 'busy'; }
    else if (state.stale || !state.results) { text = 'Changed since the last run'; kind = 'busy'; }
    else {
      const events = state.results.events.filter(event => event.kind !== 'attack' && event.kind !== 'solver').length;
      text = `Up to date · ${num(state.runMs)} ms${events > 0 ? ` · ${events} ${events === 1 ? 'event' : 'events'}` : ''}`;
    }
    status.textContent = text;
    status.dataset.kind = kind;
  };

  on('scenario', () => {
    if (state.pending) scheduleRun();
    refresh();
  });
  on('results loaded', refresh);
  on('tool', () => rail.querySelectorAll('.tool').forEach(button => {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }));
  emit('tool');

  // ----- keyboard
  window.addEventListener('keydown', event => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (typing) return;
    if (event.key === 'Escape') {
      if (!cancelPending()) { if (state.tool !== 'select') { state.tool = 'select'; emit('tool'); } else select(null); }
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selection) {
      event.preventDefault();
      const { kind, id } = state.selection;
      deleteElement(kind, id);
    } else if (event.key === ' ') {
      event.preventDefault();
      dockApi.setPlaying(!state.playing);
    } else if (event.key === 'ArrowRight') {
      setRow(state.row + 1);
    } else if (event.key === 'ArrowLeft') {
      setRow(state.row - 1);
    }
  });
}

function openScenario(scenario) {
  freshlyLoaded = true;
  state.autoRun = true;
  load(scenario);
}

async function start() {
  const app = document.getElementById('app');
  state.scenario = edit.blankScenario();
  build(app);
  try {
    openScenario(await loadExample(EXAMPLES[0].file));
  } catch (error) {
    openScenario(edit.blankScenario());
    toast(error.message);
  }
}

start();
