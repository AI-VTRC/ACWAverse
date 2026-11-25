// Small helpers for building the interface and formatting numbers.

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(element, props, children) {
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.setAttribute('class', value);
      else if (key === 'text') element.textContent = value;
      else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
      else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value' && 'value' in element) element.value = value;
      else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') element[key] = !!value;
      else element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

/** Create an HTML element: h('div', { class: 'x', onclick }, child, ...). */
export function h(tag, props, ...children) {
  return build(document.createElement(tag), props, children);
}

/** Create an SVG element. */
export function s(tag, props, ...children) {
  return build(document.createElementNS(SVG_NS, tag), props, children);
}

/** Append children to an element, leaving out the empty ones as h() does. */
export function put(element, ...children) {
  return build(element, null, children);
}

export function clear(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
  return element;
}

// ---------------------------------------------------------------- numbers

/** A number with about three significant figures and no noise. */
export function num(value) {
  if (!Number.isFinite(value)) return '–';
  const a = Math.abs(value);
  if (a === 0 || a < 5e-7) return '0';
  if (a >= 1000) return Math.round(value).toLocaleString('en-US');
  if (a >= 100) return value.toFixed(0);
  if (a >= 10) return value.toFixed(1);
  if (a >= 1) return value.toFixed(2);
  if (a >= 0.01) return value.toFixed(3);
  return value.toPrecision(2);
}

// The engine works in SI. People read flows in litres per second.
const DISPLAY = {
  'm³/s': { unit: 'L/s', scale: 1000 },
  '0-1': { unit: '%', scale: 100 },
  '0/1': { unit: '', scale: 1, flag: true }
};

/** Convert an engine value for display: { value, unit, text }. */
export function display(value, unit) {
  const rule = DISPLAY[unit];
  if (rule && rule.flag) return { value, unit: '', text: !Number.isFinite(value) ? '–' : value >= 0.5 ? 'yes' : 'no' };
  const shown = rule ? value * rule.scale : value;
  const shownUnit = rule ? rule.unit : unit;
  return { value: shown, unit: shownUnit, text: num(shown) + (shownUnit ? (shownUnit === '%' ? '%' : ' ' + shownUnit) : '') };
}

export function displayUnit(unit) {
  const rule = DISPLAY[unit];
  return rule ? rule.unit : unit;
}

export function displayScale(unit) {
  const rule = DISPLAY[unit];
  return rule ? rule.scale : 1;
}

/** Clock time for a number of seconds: 0:05:00, 13:30, 1d 02:00. */
export function clock(seconds, span = seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const t = Math.max(0, Math.round(seconds));
  const two = n => String(n).padStart(2, '0');
  if (span <= 7200) return `${Math.floor(t / 60)}:${two(t % 60)}`;
  const minutes = two(Math.floor((t % 3600) / 60));
  // Within a single day the hours run to 24:00, so the end of a day does not read as midnight.
  if (span <= 86400) return `${two(Math.floor(t / 3600))}:${minutes}`;
  return `${Math.floor(t / 86400)}d ${two(Math.floor((t % 86400) / 3600))}:${minutes}`;
}

/** A length of time in words: 90 s, 15 min, 2 h. */
export function span(seconds) {
  if (!Number.isFinite(seconds)) return 'to the end';
  if (seconds < 120) return `${num(seconds)} s`;
  if (seconds < 7200) return `${num(seconds / 60)} min`;
  return `${num(seconds / 3600)} h`;
}

export function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
