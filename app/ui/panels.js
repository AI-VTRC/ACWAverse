// The side panel: properties of what is selected, the control system, the
// attacks, run settings and results, and data export.

import { ATTACK_CLASS, ATTACK_CLASSES, ATTACK_TYPES, QUANTITIES, generateDataset, pumpCurve, pumpHead, resultsTable, toCSV } from '../../build/engine/index.js';
import * as edit from '../data/edit.js';
import { copyText, fileName, readFile, saveText, scenarioText } from '../data/io.js';
import { isPlotted, toggleTrend } from './dock.js';
import { clear, clock, display, h, num, put, s, span } from './dom.js';
import { FIELDS, actuatorUnit, form, sensorUnit, timeUnit } from './fields.js';
import {
  activeAttacks, attackTarget, commit, emit, findAttack, findController, findElement, findLink, findNode, findSensor,
  load, now, on, select, setRow, state
} from './store.js';

const TYPE_NAMES = { junction: 'Junction', tank: 'Tank', reservoir: 'Reservoir', pipe: 'Pipe', pump: 'Pump', valve: 'Valve' };
import { ATTACK_NAMES, CLASS_NAMES, CLASS_NOTES, CONTROLLER_NAMES } from './names.js';

let toastTimer = 0;
/** Delete an element, and say what else had to go with it. */
export function deleteElement(kind, id) {
  let also = [];
  commit(sc => { also = edit.remove(sc, kind, id) || []; });
  select(null);
  if (also.length > 0) toast(`Deleted ${id} and what only served it: ${also.join(', ')}. Undo brings it back.`);
}

export function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, Math.max(2600, text.length * 55));
}

// ---------------------------------------------------------------- wording

const withUnit = (value, { unit, scale }) => `${num(value * scale)}${unit === '%' ? '%' : unit ? ' ' + unit : ''}`;
const sensorValue = (sensorId, value) => withUnit(value, sensorUnit(sensorId));
const setting = (actuatorId, value) => {
  const link = findLink(actuatorId);
  const u = actuatorUnit(actuatorId);
  if (u.unit === '%' && link) {
    if (value <= 0) return link.type === 'pump' ? 'off' : 'closed';
    if (value >= 1) return link.type === 'pump' ? 'full speed' : 'fully open';
  }
  return withUnit(value, u);
};

function sensorName(sensorId) {
  const sensor = findSensor(sensorId);
  if (!sensor) return sensorId || 'no sensor';
  const element = findElement(sensor.element);
  const info = element ? QUANTITIES[element.type][sensor.quantity] : null;
  return `${sensor.element} ${info ? info.label.toLowerCase() : sensor.quantity}`;
}

export function controllerSummary(c) {
  switch (c.type) {
    case 'onoff': return c.action === 'drain'
      ? `Turns ${c.actuator} on when ${sensorName(c.sensor)} rises above ${sensorValue(c.sensor, c.high)}, off below ${sensorValue(c.sensor, c.low)}.`
      : `Turns ${c.actuator} on when ${sensorName(c.sensor)} falls below ${sensorValue(c.sensor, c.low)}, off above ${sensorValue(c.sensor, c.high)}.`;
    case 'timed': {
      const events = (c.events || []).slice(0, 3).map(event => `${setting(c.actuator, event.value)} at ${clock(event.time, state.scenario.simulation.duration)}`).join(', ');
      return `Sets ${c.actuator}: ${events}${(c.events || []).length > 3 ? ', …' : ''}${c.repeat ? `, repeating every ${span(c.repeat)}` : ''}.`;
    }
    case 'conditional': {
      const words = { '>': 'above', '<': 'below', '>=': 'at or above', '<=': 'at or below' }[c.operator] || c.operator;
      return `While ${sensorName(c.sensor)} is ${words} ${sensorValue(c.sensor, c.threshold)}, sets ${c.actuator} to ${setting(c.actuator, c.value)}${typeof c.otherwise === 'number' ? `; otherwise ${setting(c.actuator, c.otherwise)}` : ''}.`;
    }
    case 'pid': return `Holds ${sensorName(c.sensor)} at ${sensorValue(c.sensor, c.setpoint)} by adjusting ${c.actuator}.`;
    default: return '';
  }
}

export function attackSummary(a) {
  switch (a.type) {
    case 'data_poisoning': {
      const value = typeof a.value === 'number' ? a.value : 0;
      const what = {
        constant: `reports a fixed ${sensorValue(a.sensor, value)}`, offset: `reads ${value >= 0 ? 'high' : 'low'} by ${sensorValue(a.sensor, Math.abs(value))}`,
        scale: `reads ${num(value)} times the truth`, freeze: 'is frozen at its last value', drift: `drifts by ${sensorValue(a.sensor, value)} an hour`,
        noise: `is buried in noise of ${sensorValue(a.sensor, value)}`, replay: `replays what it read ${span(value)} earlier`
      }[a.mode] || 'is poisoned';
      return `${a.sensor} ${what}.`;
    }
    case 'command_injection': return `${a.actuator} is forced to ${setting(a.actuator, a.value)}.`;
    case 'controller_tamper': return a.disable ? `${a.controller} is switched off.` : `${a.controller} has its settings changed (${Object.entries(a.set || {}).map(([key, value]) => `${key} = ${value}`).join(', ')}).`;
    case 'pump_failure': return `${a.pump} fails.`;
    case 'valve_stuck': return typeof a.position === 'number' ? `${a.valve} jams at ${num(a.position * 100)}%.` : `${a.valve} jams where it is.`;
    case 'leak': return `A ${num(a.diameter * 1000)} mm hole opens at ${a.node}.`;
    case 'pipe_blockage': return `${a.pipe} is ${num(a.fraction * 100)}% blocked.`;
    case 'chemical_interference': return `${num(a.amount)} ${a.substance === 'acid' || a.substance === 'base' ? 'mol' : 'g'} of ${a.substance} goes into ${a.node}.`;
    default: return '';
  }
}

export function attackTiming(a) {
  const total = state.scenario.simulation.duration;
  if (a.type === 'chemical_interference' && !(a.duration > 0)) return `at ${clock(a.start, total)}`;
  return `from ${clock(a.start, total)} ${a.duration > 0 ? `for ${span(a.duration)}` : 'to the end'}`;
}

// ---------------------------------------------------------------- live values

/** A grid of current values with a button on each to plot it. Returns { el, update }. */
function liveValues(entries) {
  const cells = entries.map(entry => {
    const value = h('b');
    const button = h('button', {
      class: 'plot-toggle', title: `Plot ${entry.label.toLowerCase()}`, 'aria-label': `Plot ${entry.label.toLowerCase()}`,
      onclick: () => toggleTrend(entry.key)
    }, chartIcon());
    return { entry, value, button, el: h('div', { class: 'live-cell' }, h('span', null, entry.label), value, button) };
  });
  const update = () => {
    cells.forEach(cell => {
      const v = now(cell.entry.key);
      cell.value.textContent = state.results ? display(v, cell.entry.unit).text : '–';
      cell.button.classList.toggle('on', isPlotted(cell.entry.key));
      cell.button.setAttribute('aria-pressed', isPlotted(cell.entry.key) ? 'true' : 'false');
    });
  };
  update();
  return { el: h('div', { class: 'live' }, cells.map(cell => cell.el)), update };
}

function chartIcon() {
  return s('svg', { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true' }, s('path', { d: 'M2,13 L6,8 L9,10.5 L14,3.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
}

const QUALITY_KEYS = ['temperature', 'chlorine', 'ph', 'alkalinity', 'oxygen', 'bod', 'ammonia', 'nitrate', 'tracer', 'age'];

function elementEntries(element, quality) {
  return Object.entries(QUANTITIES[element.type])
    .filter(([key]) => QUALITY_KEYS.includes(key) === quality && key !== 'setting')
    .map(([key, info]) => ({ key: `${element.id}.${key}`, label: info.label, unit: info.unit }));
}

// ---------------------------------------------------------------- pump curve

function pumpCurveChart(link) {
  const curve = pumpCurve(link);
  const w = 260;
  const hgt = 130;
  const m = { l: 34, r: 10, t: 8, b: 24 };
  const qMax = curve.maxFlow * 1000;
  const hMax = Math.max(curve.a0, pumpHead(curve, 1, curve.maxFlow * 0.2));
  const x = q => m.l + (w - m.l - m.r) * (q / qMax);
  const y = v => m.t + (hgt - m.t - m.b) * (1 - v / hMax);
  const path = speed => {
    let d = '';
    for (let i = 0; i <= 40; i++) {
      const q = curve.maxFlow * speed * i / 40;
      const head = pumpHead(curve, speed, q);
      if (head < 0) break;
      d += `${i === 0 ? 'M' : 'L'}${x(q * 1000).toFixed(1)},${y(head).toFixed(1)}`;
    }
    return d;
  };
  const speedLine = s('path', { class: 'curve now', d: '' });
  const point = s('circle', { class: 'point', r: 4.5, hidden: true });
  const svg = s('svg', { class: 'pump-curve', viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': 'Pump head against flow' },
    s('line', { class: 'axis', x1: m.l, x2: w - m.r, y1: hgt - m.b, y2: hgt - m.b }),
    s('line', { class: 'axis', x1: m.l, x2: m.l, y1: m.t, y2: hgt - m.b }),
    s('text', { class: 'tick', x: m.l - 5, y: y(curve.a0) + 4, 'text-anchor': 'end' }, num(curve.a0)),
    s('text', { class: 'tick', x: m.l - 5, y: hgt - m.b + 3, 'text-anchor': 'end' }, '0'),
    s('text', { class: 'tick', x: x(qMax), y: hgt - 8, 'text-anchor': 'end' }, `${num(qMax)} L/s`),
    s('text', { class: 'tick', x: w - m.r, y: m.t + 8, 'text-anchor': 'end' }, 'head (m) against flow'),
    s('line', { class: 'bep', x1: x(curve.bepFlow * 1000), x2: x(curve.bepFlow * 1000), y1: y(pumpHead(curve, 1, curve.bepFlow)), y2: hgt - m.b }),
    s('text', { class: 'tick', x: x(curve.bepFlow * 1000), y: hgt - 8, 'text-anchor': 'middle' }, 'best point'),
    s('path', { class: 'curve', d: path(1) }),
    speedLine, point
  );
  const update = () => {
    const speed = now(`${link.id}.speed`);
    const q = now(`${link.id}.flow`);
    const head = now(`${link.id}.head`);
    const running = state.results && now(`${link.id}.running`) >= 0.5;
    speedLine.setAttribute('d', running && speed < 0.995 ? path(speed) : '');
    point.toggleAttribute('hidden', !running);
    if (running) { point.setAttribute('cx', x(Math.max(0, q) * 1000)); point.setAttribute('cy', y(Math.max(0, head))); }
  };
  update();
  return { el: h('div', { class: 'pump-curve-wrap' }, svg, h('p', { class: 'help' }, 'Head against flow at full speed. The dot is where the pump is working now.')), update };
}

// ---------------------------------------------------------------- element tab

let liveUpdate = null;

function header(title, subtitle, kind, id) {
  const idInput = h('input', {
    id: `f-id-${kind}`, class: 'id-input', type: 'text', value: id, 'aria-label': 'Name', spellcheck: 'false',
    onchange: event => {
      const next = event.target.value.trim();
      if (!next || next === id) { event.target.value = id; return; }
      if (edit.allIds(state.scenario).has(next)) { toast(`The name ${next} is already in use.`); event.target.value = id; return; }
      commit(sc => edit.rename(sc, id, next));
      state.trends.forEach(trend => { if (trend.key.startsWith(id + '.')) trend.key = next + trend.key.slice(id.length); });
      select(kind, next);
    }
  });
  return h('div', { class: 'head' },
    h('div', { class: 'title' }, h('span', { class: 'eyebrow' }, title), idInput),
    h('button', { class: 'btn small danger', onclick: () => deleteElement(kind, id) }, 'Delete'),
    subtitle ? h('p', { class: 'sub' }, subtitle) : null);
}

function section(title, ...children) {
  return h('section', { class: 'group' }, title ? h('h3', null, title) : null, children);
}

function attackButtons(kind, type, id) {
  const types = edit.attacksFor(kind, type);
  if (types.length === 0) return null;
  return section('Attack it', h('div', { class: 'row wrap' }, types.map(attackType => h('button', {
    class: 'btn small', onclick: () => { let created; commit(sc => { created = edit.addAttack(sc, attackType, id); }); select('attack', created); }
  }, ATTACK_NAMES[attackType]))));
}

function renderElement(host) {
  liveUpdate = null;
  const sel = state.selection;
  const sc = state.scenario;
  if (!sel) {
    put(host, 
      h('div', { class: 'head' }, h('div', { class: 'title' }, h('span', { class: 'eyebrow' }, 'System'),
        h('input', { id: 'f-scenario-name', class: 'id-input', type: 'text', value: sc.name || '', 'aria-label': 'Name of the system', onchange: event => commit(s2 => { s2.name = event.target.value.trim() || 'Untitled'; }, 'name') }))),
      h('textarea', { id: 'f-scenario-description', class: 'description', rows: 4, placeholder: 'Describe the system and what this scenario shows.', onchange: event => commit(s2 => { s2.description = event.target.value; }, 'description') }, sc.description || ''),
      section('Contents', h('ul', { class: 'counts' },
        [['junction', 'junctions'], ['tank', 'tanks'], ['reservoir', 'reservoirs']].map(([type, word]) => h('li', null, h('b', null, sc.nodes.filter(n => n.type === type).length), ` ${word}`)),
        [['pipe', 'pipes'], ['pump', 'pumps'], ['valve', 'valves']].map(([type, word]) => h('li', null, h('b', null, sc.links.filter(l => l.type === type).length), ` ${word}`)),
        h('li', null, h('b', null, (sc.sensors || []).length), ' sensors'), h('li', null, h('b', null, (sc.controllers || []).length), ' control actions'), h('li', null, h('b', null, (sc.attacks || []).length), ' attacks'))),
      section('Working on the diagram', h('ul', { class: 'tips' },
        h('li', null, 'Select anything to see and edit it here.'),
        h('li', null, 'Pick a tool on the left to add nodes. For a pipe, pump or valve, click its start node and then its end node.'),
        h('li', null, 'A pump moves water the way its arrow points, from the first node you click to the second. Select it to turn it around.'),
        h('li', null, 'Drag nodes to move them, drag the background to pan, scroll to zoom.')))
    );
    return;
  }

  if (sel.kind === 'node' || sel.kind === 'link') {
    const element = findElement(sel.id);
    if (!element) return;
    put(host, header(TYPE_NAMES[element.type], '', sel.kind, element.id));

    if (sel.kind === 'link') {
      const words = element.type === 'pump' ? ['Draws from', 'Delivers to'] : element.type === 'valve' ? ['Inlet', 'Outlet'] : ['From', 'To'];
      put(host, h('div', { class: 'direction' },
        h('div', { class: 'ends' },
          h('span', null, h('small', null, words[0]), h('button', { class: 'link-btn', onclick: () => select('node', element.from) }, element.from)),
          s('svg', { viewBox: '0 0 40 14', width: 40, height: 14, 'aria-hidden': 'true' }, s('path', { d: 'M1,7 H36 M30,2 L37,7 L30,12', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })),
          h('span', null, h('small', null, words[1]), h('button', { class: 'link-btn', onclick: () => select('node', element.to) }, element.to))),
        h('button', { class: 'btn small', onclick: () => commit(sc2 => edit.reverseLink(sc2, element.id)) }, element.type === 'pipe' ? 'Swap ends' : 'Turn around'),
        element.type === 'pipe' ? h('p', { class: 'help' }, 'Flow from the first node to the second counts as positive. Water can run either way.') : null));
    }

    const live = liveValues(elementEntries(element, false));
    const updaters = [live.update];
    put(host, section('Now', live.el));
    if (element.type === 'pump') {
      const curve = pumpCurveChart(element);
      put(host, section('Pump curve', curve.el));
      updaters.push(curve.update);
    }
    put(host, section('Properties', form(sc2 => [...sc2.nodes, ...sc2.links].find(item => item.id === element.id), FIELDS[element.type], element.id)));

    if (sel.kind === 'node') {
      const quality = element.type === 'reservoir' ? null : liveValues(elementEntries(element, true));
      if (quality) updaters.push(quality.update);
      put(host, h('details', { class: 'group', id: `d-quality-${element.type}` },
        h('summary', null, 'Water quality'),
        quality ? quality.el : null,
        h('h4', null, element.type === 'junction' ? 'Water here at the start' : 'Water in it at the start'),
        form(sc2 => sc2.nodes.find(item => item.id === element.id), FIELDS.quality, `${element.id}-q`),
        h('p', { class: 'help' }, 'Blank fields take the defaults set under Run.')));
    }

    // instruments
    const sensors = (sc.sensors || []).filter(sensor => sensor.element === element.id);
    const quantitySelect = h('select', { id: 'f-new-sensor-quantity', 'aria-label': 'Quantity to measure' },
      Object.entries(QUANTITIES[element.type]).map(([key, info]) => h('option', { value: key }, info.label)));
    put(host, section('Sensors on it',
      sensors.length > 0 ? h('ul', { class: 'list' }, sensors.map(sensor => h('li', null,
        h('button', { class: 'link-btn', onclick: () => select('sensor', sensor.id) }, sensor.id), ` ${QUANTITIES[element.type][sensor.quantity] ? QUANTITIES[element.type][sensor.quantity].label.toLowerCase() : sensor.quantity}`))) : null,
      h('div', { class: 'row' }, quantitySelect,
        h('button', { class: 'btn small', onclick: () => { let created; commit(sc2 => { created = edit.addSensor(sc2, element.id, quantitySelect.value); }); select('sensor', created); } }, 'Add sensor'))));

    const controllers = (sc.controllers || []).filter(c => c.actuator === element.id);
    if (controllers.length > 0) {
      put(host, section('Controlled by', h('ul', { class: 'list' }, controllers.map(c => h('li', null,
        h('button', { class: 'link-btn', onclick: () => select('controller', c.id) }, c.id), ` ${controllerSummary(c)}`)))));
    }
    put(host, attackButtons(sel.kind, element.type, element.id));
    liveUpdate = () => updaters.forEach(update => update());
    return;
  }

  if (sel.kind === 'sensor') {
    const sensor = findSensor(sel.id);
    if (!sensor) return;
    const unit = (state.results && state.results.columns.find(c => c.key === `${sensor.id}.reading`) || {}).unit || '';
    const live = liveValues([
      { key: `${sensor.id}.reading`, label: 'Reported value', unit },
      { key: `${sensor.id}.true`, label: 'True value', unit }
    ]);
    liveUpdate = live.update;
    const users = (sc.controllers || []).filter(c => c.sensor === sensor.id);
    put(host, 
      header('Sensor', `Measures ${sensorName(sensor.id)}. The control system sees only the reported value.`, 'sensor', sensor.id),
      section('Now', live.el),
      section('Properties', form(sc2 => (sc2.sensors || []).find(item => item.id === sensor.id), sensorFields(), sensor.id)),
      users.length > 0 ? section('Used by', h('ul', { class: 'list' }, users.map(c => h('li', null, h('button', { class: 'link-btn', onclick: () => select('controller', c.id) }, c.id), ` ${controllerSummary(c)}`)))) : null,
      attackButtons('sensor', '', sensor.id));
    return;
  }

  if (sel.kind === 'controller') {
    const controller = findController(sel.id);
    if (!controller) return;
    const live = liveValues([{ key: `${controller.id}.output`, label: 'Last command', unit: actuatorUnit(controller.actuator).unit === '%' ? '0-1' : 'm³/s' }]);
    liveUpdate = live.update;
    put(host, 
      header(CONTROLLER_NAMES[controller.type], controllerSummary(controller), 'controller', controller.id),
      section('Now', live.el),
      section('Settings', form(sc2 => (sc2.controllers || []).find(item => item.id === controller.id), FIELDS[controller.type], controller.id)),
      h('p', { class: 'help' }, 'Control actions run in the order listed under Control. When two command the same pump or valve, the later one wins.'),
      attackButtons('controller', '', controller.id));
    return;
  }

  if (sel.kind === 'attack') {
    const attack = findAttack(sel.id);
    if (!attack) return;
    const target = attackTarget(attack);
    const targetKind = findNode(target) ? 'node' : findLink(target) ? 'link' : findSensor(target) ? 'sensor' : findController(target) ? 'controller' : null;
    put(host, 
      header(ATTACK_NAMES[attack.type], `${attackSummary(attack)} ${attack.type === 'command_injection' || attack.type === 'controller_tamper' ? 'Counted as data poisoning. ' : ''}${attackTiming(attack)[0].toUpperCase()}${attackTiming(attack).slice(1)}.`, 'attack', attack.id),
      section('When', form(sc2 => (sc2.attacks || []).find(item => item.id === attack.id), FIELDS.timing, `${attack.id}-t`),
        h('div', { class: 'row' }, h('button', { class: 'btn small', disabled: !state.results, onclick: () => jumpTo(attack.start) }, 'Show this moment'))),
      section('What', form(sc2 => (sc2.attacks || []).find(item => item.id === attack.id), FIELDS[attack.type], attack.id)),
      targetKind ? h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => select(targetKind, target) }, `Go to ${target}`)) : null);
  }
}

function sensorFields() {
  return FIELDS.sensor.map(field => (field.key !== 'element' ? field : {
    ...field,
    after: sensor => {
      const element = findElement(sensor.element);
      if (element && !QUANTITIES[element.type][sensor.quantity]) sensor.quantity = Object.keys(QUANTITIES[element.type])[0];
    }
  }));
}

/** Move the diagram to the row at or just after a time. */
export function jumpTo(time) {
  const results = state.results;
  if (!results) return;
  let row = 0;
  while (row < results.rows - 1 && results.times[row] < time - 1e-6) row++;
  setRow(row);
}

// ---------------------------------------------------------------- control tab

function renderControl(host) {
  const sc = state.scenario;
  const sensors = sc.sensors || [];
  const controllers = sc.controllers || [];
  put(host, 
    h('p', { class: 'lede' }, 'Sensors measure the plant. Control actions command pumps and valves: timed control actions at set times, conditional actions when a sensor reading meets a condition. They see only what the sensors report.'),
    section(`Sensors (${sensors.length})`,
      sensors.length > 0 ? h('ul', { class: 'cards' }, sensors.map(sensor => h('li', { class: isSel('sensor', sensor.id) }, h('button', { class: 'card-btn', onclick: () => select('sensor', sensor.id) },
        h('b', null, sensor.id, sensor.label ? h('em', null, sensor.label) : null), h('span', null, sensorName(sensor.id)), sensor.noise > 0 ? h('small', null, `noise ${sensorValue(sensor.id, sensor.noise)}`) : null))))
        : h('p', { class: 'empty' }, 'No sensors yet. Select a tank, pipe or pump on the diagram and add one from its properties.')),
    section(`Control actions (${controllers.length})`,
      controllers.length > 0 ? h('ol', { class: 'cards' }, controllers.map((c, index) => h('li', { class: isSel('controller', c.id) },
        h('button', { class: 'card-btn', onclick: () => select('controller', c.id) },
          h('b', null, c.id, h('em', null, CONTROLLER_NAMES[c.type]), c.enabled === false ? h('em', { class: 'off' }, 'out of service') : null), h('span', null, controllerSummary(c))),
        h('span', { class: 'order' },
          h('button', { class: 'x', title: 'Run earlier', 'aria-label': `Run ${c.id} earlier`, disabled: index === 0, onclick: () => commit(sc2 => { const list = sc2.controllers; [list[index - 1], list[index]] = [list[index], list[index - 1]]; }) }, '↑'),
          h('button', { class: 'x', title: 'Run later', 'aria-label': `Run ${c.id} later`, disabled: index === controllers.length - 1, onclick: () => commit(sc2 => { const list = sc2.controllers; [list[index + 1], list[index]] = [list[index], list[index + 1]]; }) }, '↓')))))
        : h('p', { class: 'empty' }, 'No control actions yet.'),
      h('div', { class: 'row wrap' }, Object.entries(CONTROLLER_NAMES).map(([type, name]) => h('button', {
        class: 'btn small', onclick: () => { let created; commit(sc2 => { created = edit.addController(sc2, type); }); select('controller', created); }
      }, `Add ${name === 'PID loop' ? name : name.toLowerCase()}`))))
  );
}

const isSel = (kind, id) => (state.selection && state.selection.kind === kind && state.selection.id === id ? 'selected' : '');

// ---------------------------------------------------------------- attacks tab

let attackListUpdate = null;

function renderAttacks(host) {
  const sc = state.scenario;
  const attacks = sc.attacks || [];
  const total = sc.simulation.duration || 1;
  const items = attacks.map(attack => {
    const start = Math.min(1, attack.start / total);
    const end = attack.duration > 0 ? Math.min(1, (attack.start + attack.duration) / total) : attack.type === 'chemical_interference' ? start : 1;
    const li = h('li', { class: `${ATTACK_CLASS[attack.type]} ${isSel('attack', attack.id)}` },
      h('button', { class: 'card-btn', onclick: () => select('attack', attack.id) },
        h('b', null, attack.label || attack.id, h('em', { class: 'class' }, CLASS_NAMES[ATTACK_CLASS[attack.type]])),
        h('span', null, attackSummary(attack)),
        h('small', null, attackTiming(attack)),
        h('span', { class: 'when' }, h('i', { style: { left: `${start * 100}%`, width: `${Math.max(1.2, (end - start) * 100)}%` } }))));
    return { attack, li };
  });
  attackListUpdate = () => {
    const active = new Set(activeAttacks().map(attack => attack.id));
    items.forEach(item => item.li.classList.toggle('active', active.has(item.attack.id)));
  };
  attackListUpdate();
  const add = type => { let created; commit(sc2 => { created = edit.addAttack(sc2, type); }); select('attack', created); };
  const group = (title, note, types) => h('div', { class: 'add-group' }, h('h4', null, title), h('p', { class: 'help' }, note),
    h('div', { class: 'row wrap' }, types.map(type => h('button', { class: 'btn small', onclick: () => add(type) }, ATTACK_NAMES[type]))));
  put(host, 
    h('p', { class: 'lede' }, 'Cyber-physical attack scenarios. An attack poisons data in the control system, damages equipment or interferes with the water chemistry. Each has a start time and usually a duration.'),
    section(`Scheduled attacks (${attacks.length})`,
      attacks.length > 0 ? h('ul', { class: 'cards attacks' }, items.map(item => item.li)) : h('p', { class: 'empty' }, 'No attacks. The run shows normal operation.')),
    section('Add an attack',
      ...ATTACK_CLASSES.map(family => group(CLASS_NAMES[family], CLASS_NOTES[family], ATTACK_TYPES.filter(type => ATTACK_CLASS[type] === family))))
  );
}

// ---------------------------------------------------------------- run tab

function renderRun(host) {
  const results = state.results;
  const errors = state.issues.filter(issue => issue.level === 'error');
  const warnings = state.issues.filter(issue => issue.level === 'warning');
  const go = issue => {
    const id = issue.where;
    const kind = findNode(id) ? 'node' : findLink(id) ? 'link' : findSensor(id) ? 'sensor' : findController(id) ? 'controller' : findAttack(id) ? 'attack' : null;
    if (kind) select(kind, id);
  };
  const issueList = (list, cls) => h('ul', { class: `issues ${cls}` }, list.map(issue => h('li', null,
    issue.where ? h('button', { class: 'link-btn', onclick: () => go(issue) }, issue.where) : null, issue.where ? ' ' : '', issue.message)));

  put(host, 
    errors.length > 0 ? section(`${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before it can run`, issueList(errors, 'error')) : null,
    state.runError ? section('The run stopped', h('p', { class: 'error-text' }, state.runError)) : null,
    warnings.length > 0 ? section('Worth checking', issueList(warnings, 'warning')) : null,
    section('Run settings',
      form(sc => sc.simulation, FIELDS.simulation, 'sim'),
      h('label', { class: 'field check', for: 'f-autorun' }, h('input', { id: 'f-autorun', type: 'checkbox', checked: state.autoRun, onchange: event => { state.autoRun = event.target.checked; emit('scenario'); } }), h('span', null, 'Run again after every change')))
  );

  if (results && !state.stale) {
    const b = results.balance;
    const m3 = v => `${num(v)} m³`;
    put(host, section('This run',
      h('dl', { class: 'facts' },
        h('dt', null, 'Supplied by reservoirs'), h('dd', null, m3(b.supplied)),
        h('dt', null, 'Delivered to consumers'), h('dd', null, `${m3(b.delivered)}${b.requested > 0 ? ` (${num(100 * b.delivered / b.requested)}% of demand)` : ''}`),
        h('dt', null, 'Lost through leaks'), h('dd', null, m3(b.leaked)),
        h('dt', null, 'Spilled from tanks'), h('dd', null, m3(b.spilled)),
        h('dt', null, 'Change in storage'), h('dd', null, m3(b.stored)),
        h('dt', null, 'Unaccounted for'), h('dd', null, m3(Math.abs(b.error) < 1e-6 ? 0 : b.error)),
        h('dt', null, 'Computed in'), h('dd', null, `${num(state.runMs)} ms, ${results.stats.steps.toLocaleString('en-US')} steps`)),
      results.stats.unconverged > 0 ? h('p', { class: 'error-text' }, `${results.stats.unconverged} steps did not fully converge. A shorter time step may help.`) : null));

    const events = results.events;
    put(host, section(`Events (${events.length})`,
      events.length > 0 ? h('ul', { class: 'events' }, events.slice(0, 200).map(event => h('li', { class: event.kind },
        h('button', { class: 'link-btn time', onclick: () => jumpTo(event.time) }, clock(event.time, results.times[results.rows - 1])), ' ', event.message)))
        : h('p', { class: 'empty' }, 'Nothing out of the ordinary happened.')));
  }

  put(host, 
    h('details', { class: 'group', id: 'd-default-quality' }, h('summary', null, 'Water quality defaults'),
      h('p', { class: 'help' }, 'The water every tank, reservoir and pipe starts with, unless a node says otherwise.'),
      form(sc => sc, FIELDS.quality, 'defq')),
    h('details', { class: 'group', id: 'd-chemistry' }, h('summary', null, 'Reaction rates'),
      form(sc => sc, FIELDS.chemistry.map(field => ({ ...field, key: `chemistry.${field.key}` })), 'chem'))
  );
}

// ---------------------------------------------------------------- data tab

const dataState = { columns: 'readings', attackRuns: 10, normalRuns: 2, seed: 1, shift: true, spread: 20, dataset: null, busy: false };

function tablePreview(table, limit = 8) {
  const columns = table.header.slice(0, 12);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map(name => h('th', null, name)), table.header.length > columns.length ? h('th', null, `+${table.header.length - columns.length} more`) : null)),
    h('tbody', null, table.rows.slice(0, limit).map(row => h('tr', null, columns.map((_, i) => h('td', null, typeof row[i] === 'number' ? num(row[i]) : String(row[i]))), table.header.length > columns.length ? h('td', null, '…') : null)))));
}

function exportButtons(name, text, type) {
  return h('div', { class: 'row wrap' },
    h('button', { class: 'btn small', onclick: () => { if (saveText(name, text(), type)) toast(`Saving ${name}. If nothing happens here, use Copy.`); } }, 'Download'),
    h('button', { class: 'btn small', onclick: async () => toast(await copyText(text()) ? 'Copied to the clipboard.' : 'Copying is not allowed here. Use Download.') }, 'Copy'));
}

function renderData(host) {
  const sc = state.scenario;
  const results = state.results && !state.stale ? state.results : null;
  const fileInput = h('input', {
    id: 'f-open-file', type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async event => {
      const file = event.target.files[0];
      if (!file) return;
      try { load(await readFile(file)); toast(`Opened ${file.name}.`); } catch (error) { toast(error.message); }
      event.target.value = '';
    }
  });
  put(host, section('Scenario file',
    h('p', { class: 'help' }, 'A scenario is one JSON file: the plant, its control system, the attacks and the run settings.'),
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn small', onclick: () => load(edit.blankScenario()) }, 'New'),
      h('button', { class: 'btn small', onclick: () => fileInput.click() }, 'Open…'), fileInput),
    exportButtons(fileName(sc.name, 'json'), () => scenarioText(sc), 'application/json')));

  if (results) {
    const table = resultsTable(results, { columns: dataState.columns });
    put(host, section('This run as a table',
      h('div', { class: 'field' }, h('label', { for: 'f-data-columns' }, 'Columns'),
        h('div', { class: 'control' }, h('select', { id: 'f-data-columns', onchange: event => { dataState.columns = event.target.value; emit('panel'); } },
          h('option', { value: 'readings', selected: dataState.columns === 'readings' }, 'Sensor readings'),
          h('option', { value: 'all', selected: dataState.columns === 'all' }, 'Everything')))),
      h('p', { class: 'help' }, `${table.rows.length.toLocaleString('en-US')} rows, ${table.header.length} columns, in SI units. Sensor readings are what the control system sees, attacks included; Everything adds the true state of every element. The last three columns label each row: attack (0 or 1), its family (data poisoning, physical damage, chemical interference), and which attacks.`),
      tablePreview(table),
      exportButtons(fileName(sc.name, 'csv'), () => toCSV(resultsTable(results, { columns: dataState.columns })), 'text/csv')));
  }

  const numberField = (id, label, key, unit) => h('div', { class: 'field' }, h('label', { for: id }, label),
    h('div', { class: 'control' }, h('input', { id, type: 'number', min: 0, step: 1, value: dataState[key], onchange: event => { dataState[key] = Math.max(0, Number(event.target.value) || 0); } }), unit ? h('span', { class: 'unit' }, unit) : null));
  const status = h('p', { class: 'help', id: 'dataset-status' });
  const output = h('div');
  const showDataset = () => {
    clear(output);
    const data = dataState.dataset;
    if (!data) return;
    const attackColumn = data.header.indexOf('attack');
    const attacked = data.rows.filter(row => row[attackColumn] === 1).length;
    put(output, 
      h('p', { class: 'help' }, `${data.runs.length} runs, ${data.rows.length.toLocaleString('en-US')} rows, ${num(100 * attacked / Math.max(1, data.rows.length))}% of them under attack.`),
      tablePreview(data, 6),
      exportButtons(fileName(`${sc.name} dataset`, 'csv'), () => toCSV(data), 'text/csv'));
  };
  put(host, section('Dataset for training detectors',
    h('p', { class: 'help' }, 'Runs the scenario many times, with and without its attacks. Each run starts from slightly different tank levels and demands, and each attack moves in time and changes in strength.'),
    numberField('f-ds-attack', 'Runs with attacks', 'attackRuns'),
    numberField('f-ds-normal', 'Runs without attacks', 'normalRuns'),
    numberField('f-ds-spread', 'Variation between runs', 'spread', '%'),
    numberField('f-ds-seed', 'Seed', 'seed'),
    h('label', { class: 'field check', for: 'f-ds-shift' }, h('input', { id: 'f-ds-shift', type: 'checkbox', checked: dataState.shift, onchange: event => { dataState.shift = event.target.checked; } }), h('span', null, 'Move attacks to random times')),
    h('div', { class: 'row' }, h('button', {
      class: 'btn small primary', disabled: state.issues.some(issue => issue.level === 'error'),
      onclick: event => {
        const button = event.currentTarget;
        button.disabled = true;
        status.textContent = 'Working…';
        setTimeout(() => {
          try {
            const started = performance.now();
            dataState.dataset = generateDataset(state.scenario, {
              attackRuns: dataState.attackRuns, normalRuns: dataState.normalRuns, seed: dataState.seed, shiftAttacks: dataState.shift,
              attackSpread: dataState.spread / 100, levelSpread: dataState.spread / 200, demandSpread: dataState.spread / 200, columns: dataState.columns
            });
            status.textContent = `Done in ${num((performance.now() - started) / 1000)} s.`;
            showDataset();
          } catch (error) {
            status.textContent = error.message;
          }
          button.disabled = false;
        }, 30);
      }
    }, 'Generate dataset')),
    status, output));
  showDataset();
}

// ---------------------------------------------------------------- the panel

const TABS = [['element', 'Selected'], ['control', 'Control'], ['attacks', 'Attacks'], ['run', 'Run'], ['data', 'Data']];

export function mountPanels(host) {
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { class: 'panel-body', role: 'tabpanel' });
  put(host, tabs, body);
  let timer = 0;

  const render = () => {
    const activeId = document.activeElement && document.activeElement.id;
    const scroll = body.scrollTop;
    const open = new Set([...body.querySelectorAll('details[open]')].map(el => el.id));
    clear(tabs);
    const errors = state.issues.filter(issue => issue.level === 'error').length;
    TABS.forEach(([key, label]) => tabs.append(h('button', {
      class: `tab${state.panel === key ? ' active' : ''}`, role: 'tab', 'aria-selected': state.panel === key ? 'true' : 'false',
      onclick: () => { state.panel = key; body.scrollTop = 0; emit('panel'); }
    }, label,
    key === 'run' && errors > 0 ? h('span', { class: 'count error' }, errors) : null,
    key === 'attacks' && (state.scenario.attacks || []).length > 0 ? h('span', { class: 'count' }, state.scenario.attacks.length) : null)));
    clear(body);
    liveUpdate = null;
    attackListUpdate = null;
    body.dataset.tab = state.panel;
    ({ element: renderElement, control: renderControl, attacks: renderAttacks, run: renderRun, data: renderData })[state.panel](body);
    body.querySelectorAll('details').forEach(el => { if (open.has(el.id)) el.open = true; });
    body.scrollTop = scroll;
    if (activeId) {
      const again = document.getElementById(activeId);
      if (again && again !== document.activeElement && body.contains(again)) again.focus();
    }
  };
  // Rebuilding waits a moment so that a field's own change event finishes,
  // and the focus has moved on, before the form under it is replaced.
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 0); };
  let lastSelection = '';
  on('scenario loaded panel', schedule);
  on('selection', () => {
    const key = state.selection ? `${state.selection.kind}:${state.selection.id}` : '';
    if (key !== lastSelection) body.scrollTop = 0;
    lastSelection = key;
    schedule();
  });
  on('results', () => { if (state.panel === 'run' || state.panel === 'data') schedule(); else { if (liveUpdate) liveUpdate(); if (attackListUpdate) attackListUpdate(); } });
  on('time trends', () => { if (liveUpdate) liveUpdate(); if (attackListUpdate) attackListUpdate(); });
  render();
}
