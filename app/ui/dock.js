// The bottom dock: playback controls, a timeline that shows when attacks are
// in progress, and the trend charts.

import { clock, display, displayUnit, h, clear } from './dom.js';
import { emit, on, setRow, state } from './store.js';
import { CLASS_NAMES } from './names.js';
import { drawChart, runsOf, swatch } from '../viz/chart.js';

const icon = d => h('span', { class: 'icon' }, (() => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
})());

const ICONS = {
  play: 'M4,2.5 L13,8 L4,13.5 Z',
  pause: 'M3.5,2.5 H6.5 V13.5 H3.5 Z M9.5,2.5 H12.5 V13.5 H9.5 Z',
  start: 'M3,2.5 H5 V13.5 H3 Z M13,2.5 L6,8 L13,13.5 Z',
  back: 'M10,3 L5,8 L10,13 Z',
  forward: 'M6,3 L11,8 L6,13 Z'
};

/** Toggle a series in the trends; colours are kept per series for as long as it is plotted. */
export function toggleTrend(key) {
  const index = state.trends.findIndex(trend => trend.key === key);
  if (index >= 0) {
    state.trends.splice(index, 1);
  } else {
    if (state.trends.length >= 8) state.trends.shift();
    const used = new Set(state.trends.map(trend => trend.slot));
    let slot = 1;
    while (used.has(slot)) slot++;
    state.trends.push({ key, slot });
  }
  emit('trends');
}

export const isPlotted = key => state.trends.some(trend => trend.key === key);

export function mountDock(host) {
  let playButton;
  let slider;
  let readout;
  let lanes;
  let chartsHost;
  let frame = 0;
  let last = 0;
  let carry = 0;

  const tick = time => {
    if (!state.playing || !state.results) return;
    const dt = Math.min(0.1, (time - last) / 1000);
    last = time;
    carry += dt * state.speed;
    const whole = Math.floor(carry);
    if (whole > 0) {
      carry -= whole;
      const next = state.row + whole;
      if (next >= state.results.rows - 1) {
        setRow(state.results.rows - 1);
        state.playing = false;
        emit('play');
        return;
      }
      setRow(next);
    }
    frame = requestAnimationFrame(tick);
  };

  const setPlaying = playing => {
    if (!state.results) return;
    if (playing && state.row >= state.results.rows - 1) setRow(0);
    state.playing = playing;
    cancelAnimationFrame(frame);
    if (playing) { last = performance.now(); carry = 0; frame = requestAnimationFrame(tick); }
    emit('play');
  };

  const transport = h('div', { class: 'transport' },
    h('div', { class: 'buttons' },
      h('button', { class: 'btn icon-btn', title: 'Back to the start', 'aria-label': 'Back to the start', onclick: () => { setPlaying(false); setRow(0); } }, icon(ICONS.start)),
      h('button', { class: 'btn icon-btn', title: 'One step back', 'aria-label': 'One step back', onclick: () => { setPlaying(false); setRow(state.row - 1); } }, icon(ICONS.back)),
      playButton = h('button', { class: 'btn icon-btn primary', title: 'Play', 'aria-label': 'Play', onclick: () => setPlaying(!state.playing) }, icon(ICONS.play)),
      h('button', { class: 'btn icon-btn', title: 'One step forward', 'aria-label': 'One step forward', onclick: () => { setPlaying(false); setRow(state.row + 1); } }, icon(ICONS.forward))
    ),
    readout = h('div', { class: 'readout' }),
    h('div', { class: 'timeline' },
      lanes = h('div', { class: 'lanes' }),
      slider = h('input', { id: 'time-slider', type: 'range', min: 0, max: 0, step: 1, value: 0, 'aria-label': 'Time', oninput: event => { setPlaying(false); setRow(Number(event.target.value)); } })
    ),
    h('label', { class: 'speed' }, 'Speed',
      h('select', { id: 'speed', onchange: event => { state.speed = Number(event.target.value); } },
        [[4, 'slow'], [12, 'normal'], [40, 'fast'], [160, 'very fast']].map(([value, label]) => h('option', { value, selected: value === state.speed }, label))))
  );
  chartsHost = h('div', { class: 'charts' });
  host.append(transport, chartsHost);

  const drawLanes = () => {
    clear(lanes);
    const results = state.results;
    if (!results) return;
    const total = results.times[results.rows - 1] || 1;
    Object.keys(CLASS_NAMES).forEach(kind => {
      const runs = runsOf(results.labels[kind], results.rows);
      if (runs.length === 0) return;
      const lane = h('div', { class: `lane ${kind}`, title: `${CLASS_NAMES[kind]} in progress` }, h('span', null, CLASS_NAMES[kind]));
      runs.forEach(([a, b]) => {
        const start = results.times[a] / total;
        const end = (b + 1 < results.rows ? results.times[b + 1] : results.times[b]) / total;
        lane.append(h('i', { style: { left: `${start * 100}%`, width: `${Math.max(0.6, (end - start) * 100)}%` } }));
      });
      lanes.append(lane);
    });
  };

  const drawTime = () => {
    const results = state.results;
    if (!results) { readout.textContent = 'No results yet'; return; }
    const total = results.times[results.rows - 1];
    slider.max = results.rows - 1;
    slider.value = state.row;
    readout.replaceChildren(h('b', null, clock(results.times[state.row], total)), ` of ${clock(total, total)}`);
  };

  const charts = [];
  const drawCharts = () => {
    clear(chartsHost);
    charts.length = 0;
    const results = state.results;
    if (!results) {
      chartsHost.append(h('p', { class: 'empty' }, state.runError || 'Fix the problems listed under Run to see results here.'));
      return;
    }
    // Series are grouped by unit: one chart, one axis.
    const groups = new Map();
    state.trends.forEach(trend => {
      const column = results.columns.find(c => c.key === trend.key);
      if (!column) return;
      const unit = column.unit || column.quantity;
      if (!groups.has(unit)) groups.set(unit, { unit: column.unit, lines: [] });
      const name = column.group === 'reading' ? `${column.owner} reported` : column.group === 'command' ? `${column.owner} command` : `${column.owner} ${column.label.toLowerCase()}`;
      const lines = groups.get(unit).lines;
      lines.push({ key: trend.key, label: name, slot: trend.slot, column });
      // A sensor's reading is drawn together with the true value, so a falsified signal shows.
      if (column.group === 'reading') lines.push({ key: `${column.owner}.true`, label: `${column.owner} true`, slot: trend.slot, dashed: true, column });
    });
    if (groups.size === 0) {
      chartsHost.append(h('p', { class: 'empty' }, 'Nothing is plotted. Select something on the diagram and press the chart button beside a value.'));
      return;
    }
    groups.forEach(group => {
      const plot = h('div', { class: 'plot' });
      const legendHost = h('div', { class: 'legend' });
      const card = h('div', { class: 'chart-card' }, h('div', { class: 'chart-head' }, h('span', { class: 'unit' }, displayUnit(group.unit) || 'value'), legendHost), plot);
      chartsHost.append(card);
      charts.push({ group, plot, legendHost });
    });
    renderCharts();
  };

  const renderCharts = () => {
    const results = state.results;
    if (!results) return;
    charts.forEach(({ group, plot, legendHost }) => {
      drawChart(plot, { results, lines: group.lines, unit: group.unit, row: state.row, onScrub: row => { setPlaying(false); setRow(row); } });
      legendHost.replaceChildren(...group.lines.map(line => h('span', { class: 'key' },
        swatch(line),
        line.label, ' ',
        h('b', null, display(results.series[line.key] ? results.series[line.key][state.row] : NaN, group.unit).text),
        line.dashed ? null : h('button', { class: 'x', title: `Remove ${line.label}`, 'aria-label': `Remove ${line.label}`, onclick: () => toggleTrend(line.key) }, '×')
      )));
    });
  };

  on('results', () => { drawLanes(); drawTime(); drawCharts(); });
  on('trends', drawCharts);
  on('time', () => { drawTime(); renderCharts(); });
  on('play', () => {
    playButton.replaceChildren(icon(state.playing ? ICONS.pause : ICONS.play));
    playButton.title = state.playing ? 'Pause' : 'Play';
    playButton.setAttribute('aria-label', playButton.title);
  });
  new ResizeObserver(() => renderCharts()).observe(chartsHost);
  drawTime();
  drawCharts();
  return { setPlaying };
}
