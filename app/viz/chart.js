// A time-series chart drawn in SVG: one unit, one axis, a few lines.
// Shaded bands mark when attacks are in progress; a cursor marks the time
// shown on the diagram. Dragging across the chart moves that time.

import { clock, displayScale, displayUnit, h, num, s } from '../ui/dom.js';

function niceTicks(min, max, count = 4) {
  if (!(max > min)) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const raw = (max - min) / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(m => m >= raw) || raw;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

/**
 * Colour of a line. A sensor's reported value takes the series colour; its true
 * value takes the same hue pulled towards the text colour, so the pair stay
 * related but can be told apart even where one lies on top of the other.
 */
export function lineColor(line) {
  return line.dashed ? `color-mix(in oklab, var(--s${line.slot}) 42%, var(--ink))` : `var(--s${line.slot})`;
}

/** The mark that stands for a line in a legend: a solid bar, or dashes for a true value. */
export function swatch(line) {
  const mark = s('svg', { class: 'swatch', viewBox: '0 0 20 8', width: 20, height: 8, 'aria-hidden': 'true' });
  mark.append(s('line', { x1: 1, x2: 19, y1: 4, y2: 4, 'stroke-width': line.dashed ? 2 : 3, 'stroke-linecap': line.dashed ? 'butt' : 'round', 'stroke-dasharray': line.dashed ? '5 3' : null, style: `stroke: ${lineColor(line)}` }));
  return mark;
}

/** Stretches of consecutive rows where flags[row] is 1, as [firstRow, lastRow] pairs. */
export function runsOf(flags, rows) {
  const runs = [];
  let start = -1;
  for (let i = 0; i < rows; i++) {
    if (flags[i] === 1 && start < 0) start = i;
    if (flags[i] !== 1 && start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, rows - 1]);
  return runs;
}

/**
 * Draw a chart into `host`.
 *   results   the run
 *   lines     [{ key, label, slot, dashed }]
 *   unit      engine unit shared by the lines
 *   row       current row
 *   onScrub   called with a row when the user drags across the chart
 */
export function drawChart(host, { results, lines, unit, row, onScrub }) {
  const width = Math.max(260, host.clientWidth || 480);
  const height = 150;
  const m = { left: 46, right: 14, top: 8, bottom: 22 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const rows = results.rows;
  const times = results.times;
  const t1 = times[rows - 1] || 1;
  const scale = displayScale(unit);

  let min = Infinity;
  let max = -Infinity;
  lines.forEach(line => {
    const data = results.series[line.key];
    if (!data) return;
    for (let i = 0; i < rows; i++) {
      const v = data[i] * scale;
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
  });
  if (min === Infinity) { min = 0; max = 1; }
  // Quantities that cannot be negative read best from a zero baseline, unless that would flatten them.
  if (min >= 0 && min < 0.6 * max) min = 0;
  const ticks = niceTicks(min, max);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const x = t => m.left + plotW * (t / t1);
  const y = v => m.top + plotH * (1 - (v - y0) / (y1 - y0));

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });

  // attack bands
  runsOf(results.labels.any, rows).forEach(([a, b]) => {
    const xa = x(times[a]);
    const xb = x(b + 1 < rows ? times[b + 1] : times[b]);
    svg.append(s('rect', { class: 'band', x: xa, y: m.top, width: Math.max(2, xb - xa), height: plotH }));
  });

  // grid and axes
  ticks.forEach(tick => {
    svg.append(
      s('line', { class: 'gridline', x1: m.left, x2: m.left + plotW, y1: y(tick), y2: y(tick) }),
      s('text', { class: 'tick', x: m.left - 6, y: y(tick) + 3.5, 'text-anchor': 'end' }, num(tick))
    );
  });
  const hours = t1 / 3600;
  const stepChoices = t1 <= 7200 ? [60, 120, 300, 600, 900, 1800] : [1800, 3600, 7200, 10800, 21600, 43200, 86400, 172800];
  const xStep = stepChoices.find(step => t1 / step <= Math.max(3, Math.floor(plotW / 70))) || stepChoices[stepChoices.length - 1];
  for (let t = 0; t <= t1 + 1e-6; t += xStep) {
    svg.append(
      s('line', { class: 'axis-tick', x1: x(t), x2: x(t), y1: m.top + plotH, y2: m.top + plotH + 4 }),
      s('text', { class: 'tick', x: x(t), y: height - 6, 'text-anchor': t === 0 ? 'start' : x(t) > width - 26 ? 'end' : 'middle' }, hours > 2 ? `${+(t / 3600).toFixed(1)} h` : clock(t, t1))
    );
  }
  svg.append(s('line', { class: 'axis', x1: m.left, x2: m.left + plotW, y1: m.top + plotH, y2: m.top + plotH }));

  // lines
  const stride = Math.max(1, Math.ceil(rows / 1600));
  // True values are drawn last, so their dashes show on top of the reported line they follow.
  [...lines.filter(line => !line.dashed), ...lines.filter(line => line.dashed)].forEach(line => {
    const data = results.series[line.key];
    if (!data) return;
    let d = '';
    let pen = false;
    for (let i = 0; i < rows; i += stride) {
      const v = data[i] * scale;
      if (!Number.isFinite(v)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    svg.append(s('path', { class: `line${line.dashed ? ' dashed' : ''}`, d, style: `stroke: ${lineColor(line)}` }));
  });

  // cursor at the current time
  const cursor = s('g', { class: 'cursor' });
  const place = (group, r, cls) => {
    while (group.firstChild) group.removeChild(group.firstChild);
    const cx = x(times[r]);
    group.append(s('line', { class: cls, x1: cx, x2: cx, y1: m.top, y2: m.top + plotH }));
    lines.forEach(line => {
      const data = results.series[line.key];
      const v = data ? data[r] * scale : NaN;
      if (!Number.isFinite(v)) return;
      // A filled dot for what was reported, a ring for the true value.
      group.append(line.dashed
        ? s('circle', { class: 'dot ring', cx, cy: y(v), r: 5, style: `stroke: ${lineColor(line)}` })
        : s('circle', { class: 'dot', cx, cy: y(v), r: 3.5, style: `fill: ${lineColor(line)}` }));
    });
  };
  place(cursor, Math.min(row, rows - 1), 'cursor-line');
  svg.append(cursor);

  // hover read-out
  const hover = s('g', { class: 'hover', hidden: true });
  svg.append(hover);
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const rowAt = event => {
    const box = svg.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, ((event.clientX - box.left) * (width / box.width) - m.left) / plotW)) * t1;
    let best = 0;
    let low = 0;
    let high = rows - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (times[mid] <= t) { best = mid; low = mid + 1; } else high = mid - 1;
    }
    return best + 1 < rows && t - times[best] > times[best + 1] - t ? best + 1 : best;
  };
  let dragging = false;
  svg.addEventListener('pointerdown', event => { dragging = true; svg.setPointerCapture(event.pointerId); onScrub(rowAt(event)); });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('pointermove', event => {
    const r = rowAt(event);
    if (dragging) { onScrub(r); return; }
    hover.toggleAttribute('hidden', false);
    place(hover, r, 'hover-line');
    tip.hidden = false;
    tip.replaceChildren(
      h('b', null, clock(times[r], t1), results.labels.any[r] === 1 ? ' · attack' : ''),
      ...lines.map(line => {
        const data = results.series[line.key];
        return h('span', null, swatch(line), `${line.label} `, h('em', null, data ? num(data[r] * scale) : '–'));
      })
    );
    const box = host.getBoundingClientRect();
    const left = event.clientX - box.left;
    tip.style.left = `${Math.min(Math.max(8, left + 12), Math.max(8, box.width - 170))}px`;
  });
  svg.addEventListener('pointerleave', () => { hover.toggleAttribute('hidden', true); tip.hidden = true; });

  host.replaceChildren(svg, tip);
  return { unit: displayUnit(unit) };
}
