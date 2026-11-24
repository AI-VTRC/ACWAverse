// Property forms. Each kind of thing has a list of field descriptions; one
// builder turns a list into a form that edits the scenario.
//
// The scenario is stored in SI units. Fields show friendlier ones (L/s, mm,
// %, minutes) and convert on the way in and out.

import { QUANTITIES } from '../../build/engine/index.js';
import { displayScale, displayUnit, h } from './dom.js';
import { commit, findElement, findSensor, state } from './store.js';

const get = (object, path) => path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);

function set(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof target[keys[i]] !== 'object' || target[keys[i]] === null) target[keys[i]] = {};
    target = target[keys[i]];
  }
  const key = keys[keys.length - 1];
  if (value === undefined) delete target[key]; else target[key] = value;
  // Do not leave an empty group behind.
  if (keys.length === 2 && Object.keys(object[keys[0]]).length === 0) delete object[keys[0]];
}

const resolve = (value, object) => (typeof value === 'function' ? value(object) : value);
const tidy = value => Number(value.toPrecision(10));

// ---------------------------------------------------------------- units that depend on context

/** Unit and scale of what a sensor measures, for display. */
export function sensorUnit(sensorId) {
  const sensor = findSensor(sensorId);
  const element = sensor ? findElement(sensor.element) : null;
  const info = element ? (QUANTITIES[element.type] || {})[sensor.quantity] : null;
  const unit = info ? info.unit : '';
  return { unit: displayUnit(unit), scale: displayScale(unit) };
}

/** Unit and scale of the setting of a pump or valve. */
export function actuatorUnit(actuatorId) {
  const link = findElement(actuatorId);
  if (link && link.type === 'valve' && link.mode === 'flow') return { unit: 'L/s', scale: 1000 };
  return { unit: '%', scale: 100 };
}

/** Times are entered in minutes for short runs and hours for long ones. */
export function timeUnit() {
  return state.scenario.simulation.duration <= 6 * 3600 ? { unit: 'min', scale: 1 / 60 } : { unit: 'h', scale: 1 / 3600 };
}

const elementOptions = test => () => [...state.scenario.nodes, ...state.scenario.links].filter(test).map(item => [item.id, `${item.id} (${item.type})`]);
const sensorOptions = () => (state.scenario.sensors || []).map(sensor => [sensor.id, `${sensor.id} (${sensor.element} ${sensor.quantity})`]);
const actuatorOptions = elementOptions(item => item.type === 'pump' || item.type === 'valve');

// ---------------------------------------------------------------- field lists

const QUALITY = [
  { key: 'quality.temperature', label: 'Temperature', unit: '°C', placeholder: 'ambient' },
  { key: 'quality.chlorine', label: 'Free chlorine', unit: 'mg/L', placeholder: '0' },
  { key: 'quality.ph', label: 'pH', placeholder: '7.5' },
  { key: 'quality.alkalinity', label: 'Alkalinity', unit: 'mg/L CaCO₃', placeholder: '100' },
  { key: 'quality.oxygen', label: 'Dissolved oxygen', unit: 'mg/L', placeholder: 'saturated' },
  { key: 'quality.bod', label: 'BOD', unit: 'mg/L', placeholder: '0' },
  { key: 'quality.ammonia', label: 'Ammonia', unit: 'mg/L N', placeholder: '0' },
  { key: 'quality.nitrate', label: 'Nitrate', unit: 'mg/L N', placeholder: '0' },
  { key: 'quality.tracer', label: 'Tracer', unit: 'mg/L', placeholder: '0' }
];

export const FIELDS = {
  junction: [
    { key: 'elevation', label: 'Elevation', unit: 'm', placeholder: '0' },
    { key: 'demand', label: 'Demand', unit: 'L/s', scale: 1000, placeholder: 'none', min: 0 },
    { key: 'pattern', label: 'Demand pattern', type: 'list', placeholder: 'constant', help: 'Multipliers of the demand, one per step, repeating. For example 0.6, 1.4, 1.0', show: o => o.demand > 0 },
    { key: 'patternStep', label: 'Pattern step', unit: 'min', scale: 1 / 60, placeholder: '60', show: o => o.demand > 0 && Array.isArray(o.pattern) },
    { key: 'requiredPressure', label: 'Pressure for full supply', unit: 'm', placeholder: '10', show: o => o.demand > 0 },
    { key: 'minPressure', label: 'Pressure for any supply', unit: 'm', placeholder: '0', show: o => o.demand > 0 }
  ],
  tank: [
    { key: 'elevation', label: 'Floor elevation', unit: 'm', placeholder: '0' },
    { key: 'shape', label: 'Shape', type: 'select', options: [['cylinder', 'Cylinder'], ['box', 'Box'], ['sphere', 'Sphere']], fallback: 'cylinder' },
    { key: 'diameter', label: 'Diameter', unit: 'm', min: 0, show: o => o.shape !== 'box' },
    { key: 'width', label: 'Width', unit: 'm', min: 0, show: o => o.shape === 'box' },
    { key: 'length', label: 'Length', unit: 'm', min: 0, show: o => o.shape === 'box' },
    { key: 'height', label: 'Height (highest level)', unit: 'm', min: 0 },
    { key: 'level', label: 'Level at the start', unit: 'm', min: 0 },
    { key: 'whenFull', label: 'When full', type: 'select', options: [['spill', 'It overflows'], ['closeInlet', 'Its inlet closes']], fallback: 'spill' }
  ],
  reservoir: [
    { key: 'head', label: 'Water surface elevation', unit: 'm' }
  ],
  pipe: [
    { key: 'length', label: 'Length', unit: 'm', min: 0 },
    { key: 'diameter', label: 'Diameter', unit: 'mm', scale: 1000, min: 0 },
    { key: 'friction', label: 'Friction law', type: 'select', options: [['hazen-williams', 'Hazen-Williams'], ['darcy-weisbach', 'Darcy-Weisbach']], fallback: 'hazen-williams' },
    { key: 'roughness', label: o => (o.friction === 'darcy-weisbach' ? 'Roughness' : 'Hazen-Williams C'), unit: o => (o.friction === 'darcy-weisbach' ? 'mm' : ''), placeholder: o => (o.friction === 'darcy-weisbach' ? '0.26' : '130'), min: 0 },
    { key: 'minorLoss', label: 'Minor losses (K)', placeholder: '0', min: 0 },
    { key: 'checkValve', label: 'Check valve: flow only in the drawn direction', type: 'check' },
    { key: 'closed', label: 'Closed', type: 'check' }
  ],
  pump: [
    { key: 'shutoffHead', label: 'Head at no flow', unit: 'm', min: 0 },
    { key: 'maxFlow', label: 'Flow at no head', unit: 'L/s', scale: 1000, min: 0 },
    { key: 'speed', label: 'Speed at the start', unit: '%', scale: 100, placeholder: '100', min: 0, max: 100 },
    { key: 'efficiency', label: 'Best efficiency', unit: '%', scale: 100, placeholder: '75', min: 0, max: 100 },
    { key: 'bepFlow', label: 'Flow at best efficiency', unit: 'L/s', scale: 1000, placeholder: '60% of full', min: 0 },
    { key: 'rampTime', label: 'Time to reach full speed', unit: 's', placeholder: '5', min: 0 },
    { key: 'npshRequired', label: 'NPSH required', unit: 'm', placeholder: '3', min: 0 },
    { key: 'elevation', label: 'Elevation of the pump', unit: 'm', placeholder: 'as suction node' },
    { key: 'checkValve', label: 'Check valve on the discharge', type: 'check', fallback: true }
  ],
  valve: [
    { key: 'kind', label: 'Type', type: 'select', options: [['gate', 'Gate'], ['globe', 'Globe'], ['butterfly', 'Butterfly'], ['ball', 'Ball'], ['linear', 'Linear control valve']], fallback: 'gate' },
    { key: 'diameter', label: 'Bore', unit: 'mm', scale: 1000, min: 0 },
    { key: 'mode', label: 'Operated by', type: 'select', options: [['position', 'Opening (0 to 100%)'], ['flow', 'Flow limit it holds']], fallback: 'position' },
    { key: 'setting', label: o => (o.mode === 'flow' ? 'Flow limit at the start' : 'Opening at the start'), unit: o => (o.mode === 'flow' ? 'L/s' : '%'), scale: o => (o.mode === 'flow' ? 1000 : 100), placeholder: o => (o.mode === 'flow' ? 'no limit' : '100'), min: 0 },
    { key: 'fullOpenK', label: 'Loss coefficient fully open', placeholder: 'typical for type', min: 0 },
    { key: 'strokeTime', label: 'Time for a full stroke', unit: 's', placeholder: '10', min: 0 }
  ],
  quality: QUALITY,

  sensor: [
    { key: 'element', label: 'Mounted on', type: 'select', options: elementOptions(() => true) },
    { key: 'quantity', label: 'Measures', type: 'select', options: o => { const element = findElement(o.element); return element ? Object.entries(QUANTITIES[element.type]).map(([key, info]) => [key, info.label]) : []; } },
    { key: 'noise', label: 'Noise (standard deviation)', unit: o => sensorUnit(o.id).unit, scale: o => sensorUnit(o.id).scale, placeholder: 'none', min: 0 }
  ],

  onoff: [
    { key: 'sensor', label: 'Watches', type: 'select', options: sensorOptions },
    { key: 'actuator', label: 'Switches', type: 'select', options: actuatorOptions },
    { key: 'action', label: 'Purpose', type: 'select', options: [['fill', 'Fill: on when low, off when high'], ['drain', 'Drain: on when high, off when low']] },
    { key: 'low', label: 'Low limit', unit: o => sensorUnit(o.sensor).unit, scale: o => sensorUnit(o.sensor).scale },
    { key: 'high', label: 'High limit', unit: o => sensorUnit(o.sensor).unit, scale: o => sensorUnit(o.sensor).scale },
    { key: 'onValue', label: 'Setting when on', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, placeholder: o => (actuatorUnit(o.actuator).unit === '%' ? '100' : '1000'), min: 0 },
    { key: 'offValue', label: 'Setting when off', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, placeholder: '0', min: 0 },
    { key: 'enabled', label: 'In service', type: 'check', fallback: true }
  ],
  timed: [
    { key: 'actuator', label: 'Commands', type: 'select', options: actuatorOptions },
    { key: 'events', label: 'Timed actions', type: 'events' },
    { key: 'repeat', label: 'Repeats every', unit: () => timeUnit().unit, scale: () => timeUnit().scale, placeholder: 'never', min: 0 },
    { key: 'enabled', label: 'In service', type: 'check', fallback: true }
  ],
  conditional: [
    { key: 'sensor', label: 'When', type: 'select', options: sensorOptions },
    { key: 'operator', label: 'Is', type: 'select', options: [['>', 'above'], ['<', 'below'], ['>=', 'at or above'], ['<=', 'at or below']] },
    { key: 'threshold', label: 'Threshold', unit: o => sensorUnit(o.sensor).unit, scale: o => sensorUnit(o.sensor).scale },
    { key: 'actuator', label: 'Set', type: 'select', options: actuatorOptions },
    { key: 'value', label: 'To', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, min: 0 },
    { key: 'otherwise', label: 'Otherwise to', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, placeholder: 'leave alone', min: 0 },
    { key: 'enabled', label: 'In service', type: 'check', fallback: true }
  ],
  pid: [
    { key: 'sensor', label: 'Controls', type: 'select', options: sensorOptions },
    { key: 'actuator', label: 'By adjusting', type: 'select', options: actuatorOptions },
    { key: 'setpoint', label: 'Setpoint', unit: o => sensorUnit(o.sensor).unit, scale: o => sensorUnit(o.sensor).scale },
    { key: 'kp', label: 'Proportional gain', help: 'Change of setting (0 to 1) per unit of error, in base units.' },
    { key: 'ki', label: 'Integral gain', unit: '1/s', placeholder: '0' },
    { key: 'kd', label: 'Derivative gain', unit: 's', placeholder: '0' },
    { key: 'min', label: 'Lowest output', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, placeholder: '0' },
    { key: 'max', label: 'Highest output', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, placeholder: o => (actuatorUnit(o.actuator).unit === '%' ? '100' : '1000') },
    { key: 'reverse', label: 'Reverse acting: more output when the reading is high', type: 'check' },
    { key: 'enabled', label: 'In service', type: 'check', fallback: true }
  ],

  timing: [
    { key: 'start', label: 'Starts at', unit: () => timeUnit().unit, scale: () => timeUnit().scale, min: 0 },
    { key: 'duration', label: 'Lasts', unit: () => timeUnit().unit, scale: () => timeUnit().scale, placeholder: o => (o.type === 'chemical_interference' ? 'all at once' : 'to the end'), min: 0 }
  ],
  data_poisoning: [
    { key: 'sensor', label: 'Sensor', type: 'select', options: sensorOptions },
    { key: 'mode', label: 'The reading is', type: 'select', options: [
      ['constant', 'replaced by a fixed value'], ['offset', 'shifted by an amount'], ['scale', 'multiplied by a factor'],
      ['freeze', 'frozen at its last value'], ['drift', 'made to drift steadily'], ['noise', 'buried in noise'], ['replay', 'replaced by a recording']] },
    { key: 'value', show: o => o.mode !== 'freeze',
      label: o => ({ constant: 'Reported value', offset: 'Shift', scale: 'Factor', drift: 'Drift per hour', noise: 'Noise (standard deviation)', replay: 'Recording from this long ago' }[o.mode] || 'Value'),
      unit: o => (o.mode === 'scale' ? '×' : o.mode === 'replay' ? 's' : sensorUnit(o.sensor).unit),
      scale: o => (o.mode === 'scale' || o.mode === 'replay' ? 1 : sensorUnit(o.sensor).scale) }
  ],
  command_injection: [
    { key: 'actuator', label: 'Pump or valve', type: 'select', options: actuatorOptions },
    { key: 'value', label: 'Forced setting', unit: o => actuatorUnit(o.actuator).unit, scale: o => actuatorUnit(o.actuator).scale, min: 0 }
  ],
  controller_tamper: [
    { key: 'controller', label: 'Control action', type: 'select', options: () => (state.scenario.controllers || []).map(c => [c.id, `${c.id} (${c.type})`]) },
    { key: 'disable', label: 'Switched off', type: 'check' },
    { key: 'set', label: 'Changed settings', type: 'pairs', placeholder: 'high = 5.5', help: 'Settings of the control action to overwrite, in base units (m, m³/s, 0 to 1). For example: high = 5.5, low = 1' }
  ],
  pump_failure: [
    { key: 'pump', label: 'Pump', type: 'select', options: elementOptions(item => item.type === 'pump') }
  ],
  valve_stuck: [
    { key: 'valve', label: 'Valve', type: 'select', options: elementOptions(item => item.type === 'valve') },
    { key: 'position', label: 'Jammed at', unit: '%', scale: 100, placeholder: 'where it is', min: 0, max: 100 }
  ],
  leak: [
    { key: 'node', label: 'Where', type: 'select', options: elementOptions(item => item.type === 'junction' || item.type === 'tank') },
    { key: 'diameter', label: 'Hole diameter', unit: 'mm', scale: 1000, min: 0 }
  ],
  pipe_blockage: [
    { key: 'pipe', label: 'Pipe', type: 'select', options: elementOptions(item => item.type === 'pipe') },
    { key: 'fraction', label: 'Bore blocked', unit: '%', scale: 100, min: 0, max: 100 }
  ],
  chemical_interference: [
    { key: 'node', label: 'Where', type: 'select', options: elementOptions(item => item.type === 'junction' || item.type === 'tank') },
    { key: 'substance', label: 'Substance', type: 'select', options: [
      ['chlorine', 'Chlorine'], ['dechlorinator', 'Dechlorinating agent'], ['sulfite', 'Oxygen scavenger (sulfite)'], ['acid', 'Strong acid'], ['base', 'Strong base'],
      ['ammonia', 'Ammonia'], ['bod', 'Organic matter (BOD)'], ['nitrate', 'Nitrate'], ['tracer', 'Tracer or contaminant']] },
    { key: 'amount', label: 'Amount', unit: o => (o.substance === 'acid' || o.substance === 'base' ? 'mol' : o.substance === 'dechlorinator' ? 'g Cl₂ removed' : o.substance === 'sulfite' ? 'g O₂ removed' : 'g'), min: 0 }
  ],

  simulation: [
    { key: 'duration', label: 'Length of the run', unit: 'h', scale: 1 / 3600, min: 0 },
    { key: 'timeStep', label: 'Time step', unit: 's', min: 0 },
    { key: 'reportStep', label: 'Record every', unit: 's', placeholder: 'time step', min: 0 },
    { key: 'ambientTemperature', label: 'Air temperature', unit: '°C', placeholder: '20' },
    { key: 'seed', label: 'Seed for sensor noise', placeholder: '1' }
  ],
  chemistry: [
    { key: 'chlorineBulkDecay', label: 'Chlorine decay in the water', unit: '1/day', placeholder: '0.5', min: 0 },
    { key: 'chlorineWallDecay', label: 'Chlorine decay at pipe walls', unit: 'm/day', placeholder: '0', min: 0 },
    { key: 'bodDecay', label: 'BOD oxidation', unit: '1/day', placeholder: '0.23', min: 0 },
    { key: 'nitrification', label: 'Nitrification', unit: '1/day', placeholder: '0.1', min: 0 },
    { key: 'gasTransfer', label: 'Gas exchange at tank surfaces', unit: 'm/day', placeholder: '0.5', min: 0 },
    { key: 'heatExchange', label: 'Tank heat exchange with the air', unit: '1/day', placeholder: '0.5', min: 0 }
  ]
};

// ---------------------------------------------------------------- the builder

/**
 * Build a form.
 *   target   function returning the object being edited, given the scenario
 *   fields   field descriptions
 *   scope    string unique to this object, used for input ids and undo steps
 */
export function form(target, fields, scope) {
  const object = target(state.scenario);
  const rows = [];
  if (!object) return h('div', { class: 'form' });
  const change = (field, value) => commit(sc => {
    const live = target(sc);
    if (live) set(live, field.key, value);
    if (field.after) field.after(live);
  }, `${scope}:${field.key}`);

  fields.forEach(field => {
    if (field.show && !field.show(object)) return;
    const id = `f-${scope}-${field.key}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const label = resolve(field.label, object);
    const unit = resolve(field.unit, object) || '';
    const scale = resolve(field.scale, object) || 1;
    const placeholder = resolve(field.placeholder, object);
    const current = get(object, field.key);
    const type = field.type || 'number';

    if (type === 'check') {
      const checked = current === undefined ? field.fallback === true : current === true;
      rows.push(h('label', { class: 'field check', for: id },
        h('input', { id, type: 'checkbox', checked, onchange: event => change(field, event.target.checked === (field.fallback === true) ? undefined : event.target.checked) }),
        h('span', null, label)));
      return;
    }

    let input;
    if (type === 'select') {
      const options = resolve(field.options, object) || [];
      const value = current === undefined ? field.fallback : current;
      const known = options.some(([key]) => key === value);
      input = h('select', { id, onchange: event => change(field, event.target.value) },
        known ? null : h('option', { value: '', selected: true }, value ? `${value} (missing)` : 'Choose…'),
        options.map(([key, text]) => h('option', { value: key, selected: key === value }, text)));
    } else if (type === 'list') {
      input = h('input', {
        id, type: 'text', inputmode: 'decimal', placeholder, value: Array.isArray(current) ? current.join(', ') : '',
        onchange: event => {
          const values = event.target.value.split(/[\s,;]+/).filter(Boolean).map(Number).filter(Number.isFinite);
          change(field, values.length > 0 ? values : undefined);
        }
      });
    } else if (type === 'pairs') {
      input = h('input', {
        id, type: 'text', placeholder, value: current ? Object.entries(current).map(([key, value]) => `${key} = ${value}`).join(', ') : '',
        onchange: event => {
          const pairs = {};
          event.target.value.split(/[,;]+/).forEach(part => {
            const [key, value] = part.split('=').map(text => text.trim());
            if (key && value !== undefined && Number.isFinite(Number(value))) pairs[key] = Number(value);
          });
          change(field, Object.keys(pairs).length > 0 ? pairs : undefined);
        }
      });
    } else if (type === 'events') {
      rows.push(eventsEditor(object, target, scope));
      return;
    } else if (type === 'text') {
      input = h('input', { id, type: 'text', placeholder, value: current === undefined ? '' : String(current), onchange: event => change(field, event.target.value.trim() || undefined) });
    } else {
      input = h('input', {
        id, type: 'number', step: 'any', placeholder, min: field.min, max: field.max,
        value: typeof current === 'number' && Number.isFinite(current) ? tidy(current * scale) : '',
        onchange: event => {
          const text = event.target.value.trim();
          const value = Number(text);
          change(field, text === '' || !Number.isFinite(value) ? undefined : value / scale);
        }
      });
    }
    rows.push(h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('div', { class: 'control' }, input, unit ? h('span', { class: 'unit' }, unit) : null),
      field.help ? h('p', { class: 'help' }, field.help) : null));
  });
  return h('div', { class: 'form' }, rows);
}

/** The actions of a timed control action: rows of time and setting. */
function eventsEditor(object, target, scope) {
  const { unit, scale } = (() => state.scenario.simulation.duration <= 6 * 3600 ? { unit: 'min', scale: 1 / 60 } : { unit: 'h', scale: 1 / 3600 })();
  const setting = actuatorUnit(object.actuator);
  const edit = change => commit(sc => { const live = target(sc); if (live) { change(live.events); live.events.sort((a, b) => a.time - b.time); } }, '');
  const rows = (object.events || []).map((event, index) => h('div', { class: 'event-row' },
    h('span', { class: 'prefix' }, 'at'),
    h('input', { id: `f-${scope}-ev-t-${index}`, type: 'number', step: 'any', min: 0, value: tidy(event.time * scale), 'aria-label': 'Time', onchange: e => edit(list => { list[index].time = Math.max(0, Number(e.target.value) || 0) / scale; }) }),
    h('span', { class: 'unit' }, unit),
    h('span', { class: 'prefix' }, 'set to'),
    h('input', { id: `f-${scope}-ev-v-${index}`, type: 'number', step: 'any', min: 0, value: tidy(event.value * setting.scale), 'aria-label': 'Setting', onchange: e => edit(list => { list[index].value = Math.max(0, Number(e.target.value) || 0) / setting.scale; }) }),
    h('span', { class: 'unit' }, setting.unit),
    h('button', { class: 'x', title: 'Remove this entry', 'aria-label': 'Remove this entry', disabled: object.events.length <= 1, onclick: () => edit(list => { list.splice(index, 1); }) }, '×')
  ));
  return h('div', { class: 'field events' },
    h('label', null, 'Timed actions'),
    rows,
    h('button', { class: 'btn small', onclick: () => edit(list => { const lastEvent = list[list.length - 1]; list.push({ time: (lastEvent ? lastEvent.time : 0) + 1 / scale, value: lastEvent && lastEvent.value > 0 ? 0 : 1 }); }) }, 'Add an entry'));
}
