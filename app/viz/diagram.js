// The process diagram: the plant drawn as nodes and links, with the control
// system over it, and the state of the latest run shown on top.
//
// Direction is always visible. A pump is a circle with an arrowhead pointing
// from its suction side to its discharge side. A valve carries a small arrow
// from inlet to outlet. Once there are results, moving dashes and arrowheads
// on every link follow the way the water actually goes.

import { clear, display, num, s } from '../ui/dom.js';
import { activeAttacks, attackTarget, commit, emit, now, on, select, state } from '../ui/store.js';
import * as edit from '../data/edit.js';
import { CONTROLLER_TAGS } from '../ui/names.js';

const view = { x: 0, y: 0, k: 1 };
let svg;
let root;
let hint;
let legend;
/** Drawn parts by id, for updating without rebuilding. */
let parts = { nodes: new Map(), links: new Map(), sensors: new Map(), controllers: new Map() };
/** Link being drawn: { type, from } or null. */
let pending = null;
let pointer = { x: 0, y: 0 };

const NODE_TOOLS = ['junction', 'tank', 'reservoir'];
const LINK_TOOLS = ['pipe', 'pump', 'valve'];

// ---------------------------------------------------------------- geometry

export function nodePosition(node, index = 0) {
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) return { x: node.x, y: node.y };
  return { x: 120 + (index % 6) * 140, y: 120 + Math.floor(index / 6) * 140 };
}

function tankSize(node) {
  const w = Math.max(44, Math.min(84, 40 + 3 * (node.shape === 'box' ? Math.sqrt((node.width || 1) * (node.length || 1)) : node.diameter || 4)));
  const hgt = Math.max(50, Math.min(92, 40 + 5 * (node.height || 4)));
  return { w, h: hgt };
}

/** Half-extent of a node symbol, for placing things around it. */
function nodeRadius(node) {
  if (node.type === 'tank') { const { w, h } = tankSize(node); return Math.hypot(w, h) / 2; }
  if (node.type === 'reservoir') return 40;
  return 9;
}

/** Where a link runs: a gentle curve if it shares its two nodes with other links. */
function linkGeometry(link, positions, siblings) {
  const p0 = positions.get(link.from);
  const p1 = positions.get(link.to);
  if (!p0 || !p1) return null;
  const group = siblings.get(pairKey(link)) || [link.id];
  const offset = (group.indexOf(link.id) - (group.length - 1) / 2) * (group.spacing || 44);
  // The perpendicular is taken from a fixed ordering of the pair, so that two
  // links drawn in opposite directions still bow to opposite sides.
  const flip = link.from < link.to ? 1 : -1;
  const dx = (p1.x - p0.x) * flip;
  const dy = (p1.y - p0.y) * flip;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const c = { x: (p0.x + p1.x) / 2 + 2 * offset * nx, y: (p0.y + p1.y) / 2 + 2 * offset * ny };
  const at = t => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y
  });
  const angle = t => Math.atan2(2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y), 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x)) * 180 / Math.PI;
  const mid = at(0.5);
  // Unit normal on the side where labels go: the lower or right-hand side.
  let lx = -(p1.y - p0.y) / length;
  let ly = (p1.x - p0.x) / length;
  if (ly < 0 || (ly === 0 && lx < 0)) { lx = -lx; ly = -ly; }
  return { p0, p1, c, at, angle, mid, normal: { x: lx, y: ly }, d: `M${p0.x},${p0.y} Q${c.x},${c.y} ${p1.x},${p1.y}`, length: Math.hypot(p1.x - p0.x, p1.y - p0.y) };
}

/** Smallest angle between two bearings, in degrees. */
function apart(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The candidate bearing furthest from everything already there; earlier candidates win ties. */
function freest(candidates, taken) {
  let best = candidates[0];
  let bestScore = -Infinity;
  candidates.forEach((candidate, index) => {
    const score = taken.reduce((least, angle) => Math.min(least, apart(candidate, angle)), 180) - index * 0.5;
    if (score > bestScore) { bestScore = score; best = candidate; }
  });
  return best;
}

/** Distance from the centre of a node symbol to its outline along a bearing. */
function reach(node, degrees) {
  const dx = Math.abs(Math.cos(degrees * Math.PI / 180));
  const dy = Math.abs(Math.sin(degrees * Math.PI / 180));
  let w = 12, h = 12;
  if (node.type === 'tank') ({ w, h } = tankSize(node));
  else if (node.type === 'reservoir') { w = 76; h = 30; }
  return Math.min(dx > 1e-6 ? w / 2 / dx : Infinity, dy > 1e-6 ? h / 2 / dy : Infinity);
}

const pairKey = link => (link.from < link.to ? `${link.from}|${link.to}` : `${link.to}|${link.from}`);

function toWorld(event) {
  const box = svg.getBoundingClientRect();
  return { x: (event.clientX - box.left - view.x) / view.k, y: (event.clientY - box.top - view.y) / view.k };
}

function applyView() {
  root.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const grid = svg.querySelector('#grid');
  const size = 20 * view.k;
  grid.setAttribute('width', size);
  grid.setAttribute('height', size);
  grid.setAttribute('patternTransform', `translate(${view.x},${view.y})`);
  grid.firstChild.setAttribute('cx', size / 2);
  grid.firstChild.setAttribute('cy', size / 2);
  grid.firstChild.setAttribute('r', Math.max(0.6, Math.min(1.4, view.k)));
}

// True while the view is the fitted one; it then follows changes in the size of the stage.
let following = true;

/** Fit the whole plant into the visible area. */
export function fit() {
  following = true;
  const nodes = state.scenario.nodes;
  const box = svg.getBoundingClientRect();
  if (box.width === 0) return;
  if (nodes.length === 0) { view.x = 0; view.y = 0; view.k = 1; applyView(); return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((node, index) => {
    const p = nodePosition(node, index);
    const r = nodeRadius(node) + 34;
    x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r - 14);
    x1 = Math.max(x1, p.x + r + 40); y1 = Math.max(y1, p.y + r + 22);
  });
  const k = Math.max(0.25, Math.min(1.6, Math.min(box.width / (x1 - x0), box.height / (y1 - y0))));
  view.k = k;
  view.x = (box.width - (x1 - x0) * k) / 2 - x0 * k;
  view.y = (box.height - (y1 - y0) * k) / 2 - y0 * k;
  applyView();
}

// ---------------------------------------------------------------- build

function isLive() {
  return !!state.results && (!state.stale || state.pending);
}

function rebuild() {
  clear(root);
  parts = { nodes: new Map(), links: new Map(), sensors: new Map(), controllers: new Map() };
  const sc = state.scenario;
  const positions = new Map();
  sc.nodes.forEach((node, index) => positions.set(node.id, nodePosition(node, index)));
  const siblings = new Map();
  sc.links.forEach(link => {
    const key = pairKey(link);
    if (!siblings.has(key)) siblings.set(key, []);
    siblings.get(key).push(link.id);
    // Pumps and valves carry a symbol and two lines of text: give them room.
    if (link.type !== 'pipe') siblings.get(key).spacing = 72;
  });
  const selected = state.selection;
  const isSelected = (kind, id) => !!selected && selected.kind === kind && selected.id === id;

  const linkLayer = s('g', { class: 'links' });
  const signalLayer = s('g', { class: 'signals' });
  const nodeLayer = s('g', { class: 'nodes' });
  const sensorLayer = s('g', { class: 'sensors' });
  const overlay = s('g', { class: 'overlay' });
  root.append(linkLayer, signalLayer, nodeLayer, sensorLayer, overlay);

  // Places already used by symbols and text, so that instruments can keep clear of them.
  const occupied = [];
  const room = point => occupied.reduce((least, o) => Math.min(least, Math.hypot(point.x - o.x, point.y - o.y) - o.r), Infinity);

  // ----- links
  sc.links.forEach(link => {
    const geom = linkGeometry(link, positions, siblings);
    if (!geom) return;
    const group = s('g', { class: `link ${link.type}${isSelected('link', link.id) ? ' selected' : ''}`, 'data-kind': 'link', 'data-id': link.id });
    const width = link.type === 'pipe' ? Math.max(2.5, Math.min(7, 2 + 18 * (link.diameter || 0.1))) : 3.5;
    group.append(s('path', { class: 'hit', d: geom.d }));
    const base = s('path', { class: 'base', d: geom.d, 'stroke-width': width });
    const flow = s('path', { class: 'flow', d: geom.d, 'stroke-width': Math.max(1.6, width - 1.4) });
    group.append(base, flow);
    const chevrons = [0.25, 0.75].map(t => {
      const p = geom.at(t);
      const chevron = s('path', { class: 'chevron', d: 'M-5,-5 L3,0 L-5,5' });
      group.append(chevron);
      return { el: chevron, p, angle: geom.angle(t) };
    });
    // A valve's stem points away from the side its label is on.
    const heading = geom.angle(0.5) * Math.PI / 180;
    const upside = link.type === 'valve' && Math.sin(heading) * geom.normal.x - Math.cos(heading) * geom.normal.y > 0;
    const symbol = s('g', { class: 'symbol', transform: `translate(${geom.mid.x},${geom.mid.y}) rotate(${geom.angle(0.5)})${upside ? ' scale(1,-1)' : ''}` });
    const entry = { link, geom, group, base, flow, chevrons, symbol };
    if (link.type === 'pump') {
      // Centrifugal pump: the arrowhead points from suction to discharge. It is
      // notched at the back because a plain triangle that is nearly equilateral
      // reads as pointing along whichever of its sides happens to lie level,
      // which on a slanted link is the wrong way.
      symbol.append(
        s('circle', { class: 'halo', r: 19 }),
        s('circle', { class: 'body', r: 14 }),
        s('path', { class: 'arrow', d: 'M-7.5,-7.5 L10.5,0 L-7.5,7.5 L-3,0 Z' }),
        entry.cross = s('path', { class: 'cross', d: 'M-9,-9 L9,9 M-9,9 L9,-9' })
      );
      group.append(symbol);
    } else if (link.type === 'valve') {
      symbol.append(
        s('rect', { class: 'halo', x: -17, y: -24, width: 34, height: 37, rx: 6 }),
        s('path', { class: 'stem', d: 'M0,0 V-11 M-7,-11 A7,7 0 0 1 7,-11 Z' }),
        s('path', { class: 'body', d: 'M-12,-8 L0,0 L-12,8 Z M12,-8 L0,0 L12,8 Z' }),
        // Inlet-to-outlet mark under the valve.
        s('path', { class: 'direction', d: 'M-9,14 H7 M3,10.5 L8,14 L3,17.5' })
      );
      group.append(symbol);
    } else {
      if (link.checkValve) {
        symbol.append(s('path', { class: 'check', d: 'M-7,-7 L5,0 L-7,7 Z M5,-7 V7' }));
        group.append(symbol);
      }
      if (link.closed) {
        symbol.append(s('path', { class: 'shut', d: 'M-6,-6 L6,6 M-6,6 L6,-6' }));
        group.append(symbol);
      }
    }
    const clearance = link.type === 'pipe' ? 13 : link.type === 'valve' ? 30 : 26;
    const lp = { x: geom.mid.x + geom.normal.x * clearance, y: geom.mid.y + geom.normal.y * clearance };
    entry.name = s('text', { class: 'name', x: lp.x, y: lp.y + 3, 'text-anchor': 'middle' }, link.id);
    entry.value = s('text', { class: 'value', x: lp.x, y: lp.y + 15, 'text-anchor': 'middle' });
    entry.badge = s('g', { class: 'attack-badge', transform: `translate(${geom.mid.x - geom.normal.x * 24},${geom.mid.y - geom.normal.y * 24})`, hidden: true },
      s('circle', { r: 8 }), s('path', { d: 'M0,-4 V1 M0,3.6 V4' }));
    group.append(entry.name, entry.value, entry.badge);
    occupied.push({ x: lp.x, y: lp.y + 6, r: 20 });
    if (link.type !== 'pipe') occupied.push({ x: geom.mid.x, y: geom.mid.y, r: 16 });
    linkLayer.append(group);
    parts.links.set(link.id, entry);
  });

  // Bearings already occupied around each node: its links first, labels and sensors later.
  const taken = new Map(sc.nodes.map(node => [node.id, []]));
  parts.links.forEach(({ link, geom }) => {
    if (taken.has(link.from)) taken.get(link.from).push(geom.angle(0));
    if (taken.has(link.to)) taken.get(link.to).push(geom.angle(1) + 180);
  });

  // ----- nodes
  sc.nodes.forEach(node => {
    const p = positions.get(node.id);
    const group = s('g', { class: `node ${node.type}${isSelected('node', node.id) ? ' selected' : ''}`, 'data-kind': 'node', 'data-id': node.id, transform: `translate(${p.x},${p.y})` });
    const entry = { node, p, group };
    if (node.type === 'tank') {
      const { w, h } = tankSize(node);
      entry.size = { w, h };
      const sides = taken.get(node.id);
      entry.above = sides.some(bearing => apart(bearing, 90) < 35) && !sides.some(bearing => apart(bearing, -90) < 35);
      group.append(
        s('rect', { class: 'halo', x: -w / 2 - 6, y: -h / 2 - 6, width: w + 12, height: h + 12, rx: 6 }),
        s('rect', { class: 'shell', x: -w / 2, y: -h / 2, width: w, height: h }),
        entry.water = s('rect', { class: 'water', x: -w / 2 + 1.5, width: w - 3, y: 0, height: 0 }),
        entry.surface = s('path', { class: 'surface', d: '' }),
        s('path', { class: 'wall', d: `M${-w / 2},${-h / 2} V${h / 2} H${w / 2} V${-h / 2}` }),
        entry.spill = s('path', { class: 'spill', d: `M${w / 2 + 2},${-h / 2 + 2} q7,2 7,12 M${-w / 2 - 2},${-h / 2 + 2} q-7,2 -7,12`, hidden: true }),
        // Name and level go underneath, or on top if a pipe arrives from below.
        s('text', { class: 'name', y: entry.above ? -h / 2 - 32 : h / 2 + 15, 'text-anchor': 'middle' }, node.label || node.id),
        entry.value = s('text', { class: 'value', y: entry.above ? -h / 2 - 19 : h / 2 + 28, 'text-anchor': 'middle' }),
        entry.note = s('text', { class: 'note', y: entry.above ? -h / 2 - 7 : h / 2 + 41, 'text-anchor': 'middle' })
      );
    } else if (node.type === 'reservoir') {
      group.append(
        s('rect', { class: 'halo', x: -42, y: -22, width: 84, height: 44, rx: 6 }),
        s('path', { class: 'water', d: 'M-34,-8 q8.5,-6 17,0 t17,0 t17,0 t17,0 V14 H-34 Z' }),
        s('path', { class: 'wall', d: 'M-38,-14 L-34,-8 V14 H34 V-8 L38,-14' }),
        s('text', { class: 'name', y: -22, 'text-anchor': 'middle' }, node.label || node.id),
        entry.value = s('text', { class: 'value', y: 29, 'text-anchor': 'middle' })
      );
    } else {
      const consumer = (node.demand || 0) > 0;
      const around = taken.get(node.id);
      if (consumer) around.push(90);
      // The name and pressure go on the side with the most room.
      const side = freest([-90, 90, 0, 180], around);
      around.push(side);
      const place = {
        '-90': { x: 0, y: -24, anchor: 'middle' }, '90': { x: 0, y: 22, anchor: 'middle' },
        '0': { x: 12, y: -3, anchor: 'start' }, '180': { x: -12, y: -3, anchor: 'end' }
      }[side];
      group.append(
        s('circle', { class: 'halo', r: 12 }),
        entry.dot = s('circle', { class: 'dot', r: 5 }),
        s('text', { class: 'name small', x: place.x, y: place.y, 'text-anchor': place.anchor }, node.label || node.id),
        entry.value = s('text', { class: 'value', x: place.x, y: place.y + 12, 'text-anchor': place.anchor })
      );
      if (consumer) {
        // Water leaving the network to consumers.
        entry.tap = s('g', { class: 'tap' }, s('path', { d: 'M0,7 V22' }), s('path', { class: 'head', d: 'M-5,20 L0,29 L5,20 Z' }));
        entry.tapValue = s('text', { class: 'value', x: 9, y: 29 });
        group.append(entry.tap, entry.tapValue);
      }
    }
    if (node.type !== 'junction') {
      taken.get(node.id).push(-90, 90);
      if (node.type === 'tank') {
        const textAt = entry.above ? p.y - entry.size.h / 2 - 22 : p.y + entry.size.h / 2 + 20;
        occupied.push({ x: p.x - 20, y: textAt, r: 18 }, { x: p.x + 20, y: textAt, r: 18 });
      } else {
        occupied.push({ x: p.x - 18, y: p.y - 26, r: 16 }, { x: p.x + 18, y: p.y - 26, r: 16 }, { x: p.x, y: p.y + 29, r: 18 });
      }
    }
    entry.leak = s('g', { class: 'leak', hidden: true },
      s('path', { d: 'M-4,0 q-2,6 -6,9 M0,0 v11 M4,0 q2,6 6,9' }), entry.leakValue = s('text', { class: 'value', y: 23, 'text-anchor': 'middle' }));
    const r = nodeRadius(node);
    entry.leak.setAttribute('transform', `translate(${node.type === 'tank' ? -r * 0.55 : -16},${node.type === 'tank' ? entry.size.h / 2 + 2 : 8})`);
    if (node.type === 'tank') entry.leakValue.setAttribute('x', -20);
    entry.badge = s('g', { class: 'attack-badge', transform: `translate(${node.type === 'junction' ? -13 : -r * 0.72},${node.type === 'junction' ? -13 : -r * 0.72})`, hidden: true },
      s('circle', { r: 8 }), s('path', { d: 'M0,-4 V1 M0,3.6 V4' }));
    group.append(entry.leak, entry.badge);
    nodeLayer.append(group);
    parts.nodes.set(node.id, entry);
  });

  // ----- sensors, placed around the element they are mounted on
  const mounted = new Map();
  (sc.sensors || []).forEach(sensor => {
    const count = mounted.get(sensor.element) || 0;
    mounted.set(sensor.element, count + 1);
    let anchor;
    let at;
    let below = false;
    const nodeEntry = parts.nodes.get(sensor.element);
    const linkEntry = parts.links.get(sensor.element);
    if (nodeEntry) {
      const around = taken.get(sensor.element);
      const spot = degrees => {
        const out = reach(nodeEntry.node, degrees) + 26;
        return { x: nodeEntry.p.x + Math.cos(degrees * Math.PI / 180) * out, y: nodeEntry.p.y + Math.sin(degrees * Math.PI / 180) * out };
      };
      // Bearings whose spot is already crowded are tried last.
      const options = [-40, -140, 40, 140, 0, 180, -90, 90, -65, -115, 65, 115];
      const open = options.filter(degrees => room(spot(degrees)) >= 14);
      const bearing = freest(open.length > 0 ? open : options, around);
      around.push(bearing);
      const edge = reach(nodeEntry.node, bearing);
      const cos = Math.cos(bearing * Math.PI / 180);
      const sin = Math.sin(bearing * Math.PI / 180);
      below = sin > 0.5;
      anchor = { x: nodeEntry.p.x + cos * edge, y: nodeEntry.p.y + sin * edge };
      at = { x: nodeEntry.p.x + cos * (edge + 26), y: nodeEntry.p.y + sin * (edge + 26) };
    } else if (linkEntry) {
      const g = linkEntry.geom;
      // Opposite the label; on a pump or valve, up and to one side of the symbol,
      // which leaves the other side for the badge of a timed control action.
      const machine = linkEntry.link.type !== 'pipe';
      const along = g.angle(0.5) * Math.PI / 180;
      const beside = (t, out) => { const a = g.at(t); return { anchor: a, at: { x: a.x - g.normal.x * out, y: a.y - g.normal.y * out } }; };
      const corner = sign => ({ anchor: g.mid, at: { x: g.mid.x - (g.normal.x * 0.77 + sign * Math.cos(along) * 0.64) * 42, y: g.mid.y - (g.normal.y * 0.77 + sign * Math.sin(along) * 0.64) * 42 } });
      const options = machine
        ? [corner(1), beside(0.24, 34), beside(0.76, 34), corner(-1), beside(0.12, 34), beside(0.88, 34)]
        : [beside(0.5, 34), beside(0.3, 34), beside(0.7, 34), beside(0.2, 34), beside(0.8, 34)];
      const choice = options.find(option => room(option.at) >= 14) || options.reduce((best, option) => (room(option.at) > room(best.at) ? option : best));
      anchor = choice.anchor;
      at = choice.at;
      below = g.normal.y < -0.5;
    } else {
      return;
    }
    occupied.push({ x: at.x, y: at.y, r: 15 }, { x: at.x, y: below ? at.y + 22 : at.y - 18, r: 16 });
    const group = s('g', { class: `sensor${isSelected('sensor', sensor.id) ? ' selected' : ''}`, 'data-kind': 'sensor', 'data-id': sensor.id });
    const entry = { sensor, at, below, group };
    group.append(
      s('path', { class: 'leader', d: `M${anchor.x},${anchor.y} L${at.x},${at.y}` }),
      s('circle', { class: 'halo', cx: at.x, cy: at.y, r: 16 }),
      s('circle', { class: 'bubble', cx: at.x, cy: at.y, r: 12 }),
      s('text', { class: 'tag', x: at.x, y: at.y + 3, 'text-anchor': 'middle' }, sensor.id.length > 5 ? edit.sensorTag(sensor.quantity) : sensor.id),
      entry.value = s('text', { class: 'value', x: at.x, y: below ? at.y + 24 : at.y - 16, 'text-anchor': 'middle' }),
      entry.truth = s('text', { class: 'note', x: at.x, y: below ? at.y + 36 : at.y - 28, 'text-anchor': 'middle' })
    );
    sensorLayer.append(group);
    parts.sensors.set(sensor.id, entry);
  });

  // ----- controllers: signal lines from sensor to actuator
  // Controllers that read the same sensor and drive the same actuator share one line.
  const loops = new Map();
  (sc.controllers || []).forEach(controller => {
    if (!parts.links.has(controller.actuator)) return;
    const from = controller.type === 'timed' || !parts.sensors.has(controller.sensor) ? '' : controller.sensor;
    const key = `${from}>${controller.actuator}`;
    if (!loops.has(key)) loops.set(key, { from, members: [] });
    loops.get(key).members.push(controller);
  });
  const perActuator = new Map();
  const perSensor = new Map();
  // Room for a badge: clear of everything `room` knows about, and of the tanks and reservoirs themselves.
  const bodies = [];
  parts.nodes.forEach(({ node, p }) => { if (node.type !== 'junction') bodies.push({ x: p.x, y: p.y, r: nodeRadius(node) * 0.8 }); });
  // A sensor's reading is wider than the one circle `room` keeps for it.
  parts.sensors.forEach(({ at, below }) => { const y = below ? at.y + 22 : at.y - 18; bodies.push({ x: at.x - 18, y, r: 12 }, { x: at.x + 18, y, r: 12 }); });
  const clearOf = point => bodies.reduce((least, o) => Math.min(least, Math.hypot(point.x - o.x, point.y - o.y) - o.r), room(point));
  loops.forEach(loop => {
    const first = loop.members[0];
    const actuator = parts.links.get(first.actuator);
    const sensor = loop.from ? parts.sensors.get(loop.from) : null;
    const count = perActuator.get(first.actuator) || 0;
    perActuator.set(first.actuator, count + 1);
    const centre = actuator.geom.mid;
    let badgeAt;
    let d;
    if (sensor) {
      const a = sensor.at;
      const dist = Math.hypot(centre.x - a.x, centre.y - a.y) || 1;
      // Signal lines arch upwards, each further than the last, and stop at the edge of the symbol.
      const bow = Math.min(46, dist * 0.22) * (centre.x >= a.x ? -1 : 1) * (1 + count * 0.6);
      const c = { x: (a.x + centre.x) / 2 - (centre.y - a.y) / dist * bow, y: (a.y + centre.y) / 2 + (centre.x - a.x) / dist * bow };
      const reachIn = Math.hypot(centre.x - c.x, centre.y - c.y) || 1;
      const target = { x: centre.x - (centre.x - c.x) / reachIn * 17, y: centre.y - (centre.y - c.y) / reachIn * 17 };
      d = `M${a.x},${a.y} Q${c.x},${c.y} ${target.x},${target.y}`;
      // Lines that leave the same sensor carry their badges at different points.
      const shared = perSensor.get(loop.from) || 0;
      perSensor.set(loop.from, shared + 1);
      const on = t => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * target.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * target.y });
      const planned = [0.5, 0.36, 0.64, 0.25, 0.75][shared % 5];
      // A badge that would land on a sensor, a label or a tank slides along its line to the nearest free place.
      const free = [0.43, 0.57, 0.36, 0.64, 0.5, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]
        .sort((p, q) => Math.abs(p - planned) - Math.abs(q - planned))
        .find(t => clearOf(on(t)) >= 22);
      badgeAt = on(clearOf(on(planned)) >= 10 || free === undefined ? planned : free);
      occupied.push({ x: badgeAt.x, y: badgeAt.y, r: 16 });
    } else {
      // A timed control action has no sensor: its badge sits beside the actuator, opposite the label.
      const reachOut = 44 + count * 24;
      const along = actuator.geom.angle(0.5) * Math.PI / 180;
      badgeAt = { x: centre.x - (actuator.geom.normal.x * 0.77 - Math.cos(along) * 0.64) * reachOut, y: centre.y - (actuator.geom.normal.y * 0.77 - Math.sin(along) * 0.64) * reachOut };
      d = `M${badgeAt.x},${badgeAt.y} L${centre.x + (badgeAt.x - centre.x) * 17 / reachOut},${centre.y + (badgeAt.y - centre.y) * 17 / reachOut}`;
    }
    const tags = CONTROLLER_TAGS;
    const kinds = new Set(loop.members.map(member => member.type));
    const text = loop.members.length === 1 ? tags[first.type] || '?' : kinds.size === 1 ? `${loop.members.length}×${tags[first.type]}` : `×${loop.members.length}`;
    const chosen = loop.members.findIndex(member => isSelected('controller', member.id));
    // Clicking the badge again steps through the controllers that share the line.
    const next = loop.members[(chosen + 1) % loop.members.length];
    const width = Math.max(28, 9 + text.length * 5.4);
    const group = s('g', {
      class: `controller${chosen >= 0 ? ' selected' : ''}${loop.members.every(member => member.enabled === false) ? ' disabled' : ''}`,
      'data-kind': 'controller', 'data-id': next.id
    });
    group.append(
      s('path', { class: 'signal', d }),
      s('rect', { class: 'halo', x: badgeAt.x - width / 2 - 4, y: badgeAt.y - 12, width: width + 8, height: 24, rx: 6 }),
      s('rect', { class: 'badge', x: badgeAt.x - width / 2, y: badgeAt.y - 8, width, height: 16, rx: 3 }),
      s('text', { class: 'tag', x: badgeAt.x, y: badgeAt.y + 3, 'text-anchor': 'middle' }, text)
    );
    group.append(s('title', null, loop.members.map(member => member.label || member.id).join('\n')));
    signalLayer.append(group);
    parts.controllers.set(`${loop.from}>${first.actuator}`, { members: loop.members, group });
  });
  signalLayer.toggleAttribute('hidden', !state.showControl);
  sensorLayer.toggleAttribute('hidden', !state.showControl);

  parts.overlay = overlay;
  parts.positions = positions;
  drawPending();
  update();
}

// ---------------------------------------------------------------- update

/** Colour for a value on the current colour scale, or null. */
function scaleColor(value, range) {
  if (!range || !Number.isFinite(value)) return null;
  const t = range.max > range.min ? Math.max(0, Math.min(1, (value - range.min) / (range.max - range.min))) : 0.5;
  return `color-mix(in oklab, var(--seq-hi) ${Math.round(t * 100)}%, var(--seq-lo))`;
}

function colorRange() {
  const results = state.results;
  const by = state.colorBy;
  if (!results || by === 'none') return null;
  let min = Infinity;
  let max = -Infinity;
  results.columns.forEach(column => {
    if (column.quantity !== by || column.group !== 'state') return;
    const data = results.series[column.key];
    for (let i = 0; i < results.rows; i++) {
      const v = by === 'velocity' ? Math.abs(data[i]) : data[i];
      if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
    }
  });
  if (min === Infinity) return null;
  if (by === 'velocity') min = 0;
  return { min, max, column: results.columns.find(c => c.quantity === by && c.group === 'state') };
}

function update() {
  const live = isLive();
  const range = live ? colorRange() : null;
  const by = state.colorBy;
  const attacked = new Map();
  if (live) activeAttacks().forEach(attack => attacked.set(attackTarget(attack), attack));
  const flag = (entry, id) => {
    entry.group.classList.toggle('attacked', attacked.has(id));
    if (entry.badge) entry.badge.toggleAttribute('hidden', !attacked.has(id));
  };

  // strongest flow now, to pace the animation
  let top = 0;
  if (live) parts.links.forEach(entry => { top = Math.max(top, Math.abs(now(`${entry.link.id}.flow`)) || 0); });

  parts.links.forEach(entry => {
    const { link, group } = entry;
    const q = live ? now(`${link.id}.flow`) : NaN;
    const flowing = Number.isFinite(q) && Math.abs(q) > Math.max(1e-7, top * 1e-4);
    const forward = q >= 0;
    group.classList.toggle('flowing', flowing);
    group.classList.toggle('backward', flowing && !forward);
    if (flowing) {
      const relative = top > 0 ? Math.abs(q) / top : 0;
      entry.flow.style.animationDuration = `${(0.45 + 2.2 * (1 - Math.sqrt(relative))).toFixed(2)}s`;
    }
    entry.chevrons.forEach(chevron => {
      // With results the arrowheads follow the water. Without, they show how the link was drawn.
      const angle = chevron.angle + (flowing && !forward ? 180 : 0);
      chevron.el.setAttribute('transform', `translate(${chevron.p.x},${chevron.p.y}) rotate(${angle})`);
      chevron.el.toggleAttribute('hidden', live ? !flowing : false);
    });
    let color = null;
    if (range && by === 'velocity' && link.type === 'pipe') color = scaleColor(Math.abs(now(`${link.id}.velocity`)), range);
    else if (range && by !== 'velocity' && by !== 'pressure') color = scaleColor(now(`${forward ? link.from : link.to}.${by}`), range);
    entry.flow.style.stroke = color || '';

    let text = '';
    let state_ = '';
    if (link.type === 'pump') {
      const failed = live && now(`${link.id}.failed`) >= 0.5;
      const running = live ? now(`${link.id}.running`) >= 0.5 : (link.speed === undefined ? 1 : link.speed) > 0;
      const speed = live ? now(`${link.id}.speed`) : (link.speed === undefined ? 1 : link.speed);
      state_ = failed ? 'failed' : running ? 'on' : 'off';
      if (live) text = failed ? 'failed' : running ? `${display(q, 'm³/s').text}${speed < 0.995 ? ` · ${Math.round(speed * 100)}%` : ''}` : 'off';
      entry.cross.toggleAttribute('hidden', !failed);
      group.classList.toggle('cavitating', live && now(`${link.id}.cavitating`) >= 0.5);
    } else if (link.type === 'valve') {
      const opening = live ? now(`${link.id}.opening`) : (link.mode === 'flow' ? 1 : link.setting === undefined ? 1 : link.setting);
      const limited = link.mode === 'flow';
      state_ = opening < 0.005 || (limited && (live ? now(`${link.id}.setting`) : link.setting) === 0) ? 'off' : opening < 0.995 ? 'part' : 'on';
      if (live) text = state_ === 'off' ? 'closed' : `${display(q, 'm³/s').text}${state_ === 'part' ? ` · ${Math.round(opening * 100)}%` : ''}`;
      else if (limited && Number.isFinite(link.setting)) text = `≤ ${display(link.setting, 'm³/s').text}`;
    } else {
      if (link.closed) state_ = 'off';
      if (live) text = flowing ? display(Math.abs(q), 'm³/s').text : '';
      group.classList.toggle('blocked', live && attacked.has(link.id));
    }
    group.dataset.state = state_;
    entry.value.textContent = state.showValues ? text : '';
    flag(entry, link.id);
  });

  parts.nodes.forEach(entry => {
    const { node, group } = entry;
    const key = quantity => now(`${node.id}.${quantity}`);
    const color = range && by !== 'velocity' ? scaleColor(key(by), range) : null;
    let text = '';
    if (node.type === 'tank') {
      const level = live ? key('level') : node.level;
      const fraction = Math.max(0, Math.min(1, (level || 0) / (node.height || 1)));
      const { w, h } = entry.size;
      const height = (h - 1.5) * fraction;
      entry.water.setAttribute('y', h / 2 - 1.5 - height);
      entry.water.setAttribute('height', height);
      entry.water.style.fill = color || '';
      const y = h / 2 - 1.5 - height;
      entry.surface.setAttribute('d', fraction > 0.01 ? `M${-w / 2 + 1.5},${y} H${w / 2 - 1.5}` : '');
      text = `${num(level)} m`;
      const spilling = live && key('overflow') > 1e-9;
      const empty = live && key('level') <= 1e-6;
      entry.spill.toggleAttribute('hidden', !spilling);
      group.classList.toggle('alarm', spilling || empty);
      entry.note.textContent = spilling ? `overflow ${display(key('overflow'), 'm³/s').text}` : empty ? 'empty' : '';
    } else if (node.type === 'reservoir') {
      text = `${num(node.head)} m`;
    } else {
      if (entry.dot) entry.dot.style.fill = color || '';
      if (live) text = range && by !== 'pressure' && by !== 'velocity' ? display(key(by), range.column.unit).text : `${num(key('pressure'))} m`;
      if (entry.tap) {
        const supplied = live ? key('supplied') : node.demand;
        const asked = live ? key('demand') : node.demand;
        const short = live && asked > 1e-12 && supplied < 0.98 * asked;
        entry.tap.classList.toggle('short', short);
        entry.tapValue.textContent = state.showValues ? (short ? `${display(supplied, 'm³/s').text} of ${num(asked * 1000)}` : display(supplied, 'm³/s').text) : '';
        group.classList.toggle('alarm', short);
      }
    }
    if (node.type !== 'junction' || state.showValues) entry.value.textContent = text; else entry.value.textContent = '';
    const leak = live ? key('leak') : 0;
    entry.leak.toggleAttribute('hidden', !(leak > 1e-9));
    entry.leakValue.textContent = leak > 1e-9 ? `leak ${display(leak, 'm³/s').text}` : '';
    flag(entry, node.id);
  });

  parts.sensors.forEach(entry => {
    const { sensor, group } = entry;
    const reading = live ? now(`${sensor.id}.reading`) : NaN;
    const truth = live ? now(`${sensor.id}.true`) : NaN;
    const column = live ? state.results.columns.find(c => c.key === `${sensor.id}.reading`) : null;
    const unit = column ? column.unit : '';
    const spoofed = attacked.has(sensor.id);
    group.classList.toggle('attacked', spoofed);
    entry.value.textContent = live && state.showValues ? display(reading, unit).text : '';
    entry.truth.textContent = spoofed ? `true ${display(truth, unit).text}` : '';
  });

  parts.controllers.forEach(entry => {
    entry.group.classList.toggle('attacked', entry.members.some(member => attacked.has(member.id)));
  });

  drawLegend(range);
}

function drawLegend(range) {
  clear(legend);
  legend.hidden = !range;
  if (!range) return;
  const unit = range.column.unit;
  const title = state.colorBy === 'velocity' ? 'Velocity in pipes' : range.column.label;
  const lo = display(range.min, unit);
  const hi = display(range.max, unit);
  const label = document.createElement('span');
  label.textContent = `${title}${hi.unit ? ` (${hi.unit})` : ''}`;
  const bar = document.createElement('i');
  const low = document.createElement('b');
  low.textContent = num(lo.value);
  const high = document.createElement('b');
  high.textContent = num(hi.value);
  legend.append(label, low, bar, high);
}

// ---------------------------------------------------------------- drawing links

function drawPending() {
  const overlay = parts.overlay;
  if (!overlay) return;
  clear(overlay);
  if (!pending) return;
  const from = parts.positions.get(pending.from);
  if (!from) return;
  const angle = Math.atan2(pointer.y - from.y, pointer.x - from.x) * 180 / Math.PI;
  overlay.append(
    s('path', { class: 'rubber', d: `M${from.x},${from.y} L${pointer.x},${pointer.y}` }),
    s('path', { class: 'rubber-head', d: 'M-9,-6 L2,0 L-9,6', transform: `translate(${pointer.x},${pointer.y}) rotate(${angle})` })
  );
}

function setHint() {
  const tool = state.tool;
  let text = '';
  if (NODE_TOOLS.includes(tool)) text = `Click where the ${tool} goes.`;
  else if (tool === 'pump') text = pending ? `Suction at ${pending.from}. Now click the node it discharges to.` : 'Click the node the pump draws from (suction), then the node it delivers to (discharge).';
  else if (tool === 'valve') text = pending ? `Inlet at ${pending.from}. Now click the outlet node.` : 'Click the inlet node, then the outlet node.';
  else if (tool === 'pipe') text = pending ? `From ${pending.from}. Click the node at the other end, or empty space to add a junction there.` : 'Click the node where the pipe starts, then where it ends.';
  hint.textContent = text;
  hint.hidden = text === '';
}

function finishLink(toId) {
  if (!pending || toId === pending.from) return;
  const { type, from } = pending;
  let created;
  commit(sc => { created = edit.addLink(sc, type, from, toId); });
  // A run of pipe continues from where the last one ended.
  pending = type === 'pipe' ? { type, from: toId } : null;
  select('link', created);
  setHint();
}

// ---------------------------------------------------------------- interaction

function setup() {
  let drag = null;
  const touches = new Map();
  let pinch = null;

  const targetOf = event => {
    const el = event.target.closest('[data-kind]');
    return el ? { kind: el.dataset.kind, id: el.dataset.id } : null;
  };

  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), k: view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: view.x, y: view.y };
      drag = null;
      return;
    }
    svg.setPointerCapture(event.pointerId);
    // Once the user works on the diagram the view stays where they left it.
    following = false;
    const world = toWorld(event);
    const hit = targetOf(event);
    const tool = state.tool;

    if (NODE_TOOLS.includes(tool)) {
      let id;
      commit(sc => { id = edit.addNode(sc, tool, world.x, world.y); });
      select('node', id);
      return;
    }
    if (LINK_TOOLS.includes(tool)) {
      // A link snaps to a node the pointer is on or just beside.
      const end = hit && hit.kind === 'node' ? hit : nodeNear(world);
      if (end) {
        if (!pending) { pending = { type: tool, from: end.id }; pointer = world; drawPending(); setHint(); }
        else finishLink(end.id);
      } else if (pending) {
        let id;
        commit(sc => { id = edit.addNode(sc, 'junction', world.x, world.y); });
        finishLink(id);
      }
      return;
    }
    if (hit) {
      select(hit.kind, hit.id);
      if (hit.kind === 'node') {
        const node = state.scenario.nodes.find(n => n.id === hit.id);
        const p = nodePosition(node, state.scenario.nodes.indexOf(node));
        drag = { type: 'node', id: hit.id, startX: p.x, startY: p.y, dx: world.x - p.x, dy: world.y - p.y, moved: false };
      }
    } else {
      drag = { type: 'pan', x: event.clientX, y: event.clientY, vx: view.x, vy: view.y, moved: false };
    }
  });

  svg.addEventListener('pointermove', event => {
    if (touches.has(event.pointerId)) touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const k = Math.max(0.2, Math.min(4, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
      const box = svg.getBoundingClientRect();
      const cx = pinch.cx - box.left;
      const cy = pinch.cy - box.top;
      view.x = cx - (cx - pinch.x) * k / pinch.k;
      view.y = cy - (cy - pinch.y) * k / pinch.k;
      view.k = k;
      following = false;
      applyView();
      return;
    }
    const world = toWorld(event);
    if (pending) { pointer = world; drawPending(); }
    if (!drag) return;
    if (drag.type === 'pan') {
      view.x = drag.vx + event.clientX - drag.x;
      view.y = drag.vy + event.clientY - drag.y;
      if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 3) { drag.moved = true; following = false; }
      applyView();
    } else {
      const node = state.scenario.nodes.find(n => n.id === drag.id);
      if (!node) return;
      const x = Math.round((world.x - drag.dx) / 10) * 10;
      const y = Math.round((world.y - drag.dy) / 10) * 10;
      if (x !== node.x || y !== node.y) {
        node.x = x;
        node.y = y;
        drag.moved = true;
        rebuild();
      }
    }
  });

  const release = event => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (!drag) return;
    if (drag.type === 'pan' && !drag.moved && state.selection) select(null);
    if (drag.type === 'node' && drag.moved) {
      const node = state.scenario.nodes.find(n => n.id === drag.id);
      const x = node.x;
      const y = node.y;
      node.x = drag.startX;
      node.y = drag.startY;
      commit(() => { node.x = x; node.y = y; });
    }
    drag = null;
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const box = svg.getBoundingClientRect();
    const cx = event.clientX - box.left;
    const cy = event.clientY - box.top;
    const k = Math.max(0.2, Math.min(4, view.k * Math.exp(-event.deltaY * 0.0015)));
    view.x = cx - (cx - view.x) * k / view.k;
    view.y = cy - (cy - view.y) * k / view.k;
    view.k = k;
    following = false;
    applyView();
  }, { passive: false });
}

/** The node whose symbol the point falls on, with a little slack, or null. */
function nodeNear(point) {
  let best = null;
  let bestDistance = Infinity;
  state.scenario.nodes.forEach((node, index) => {
    const p = nodePosition(node, index);
    const dx = Math.abs(point.x - p.x);
    const dy = Math.abs(point.y - p.y);
    let inside;
    if (node.type === 'tank') { const { w, h } = tankSize(node); inside = dx <= w / 2 + 8 && dy <= h / 2 + 8; }
    else if (node.type === 'reservoir') inside = dx <= 44 && dy <= 24;
    else inside = Math.hypot(dx, dy) <= 14;
    const distance = Math.hypot(dx, dy);
    if (inside && distance < bestDistance) { best = { kind: 'node', id: node.id }; bestDistance = distance; }
  });
  return best;
}

/** Leave link drawing; returns true if there was something to cancel. */
export function cancelPending() {
  if (!pending) return false;
  pending = null;
  drawPending();
  setHint();
  return true;
}

export function zoom(factor) {
  const box = svg.getBoundingClientRect();
  const cx = box.width / 2;
  const cy = box.height / 2;
  const k = Math.max(0.2, Math.min(4, view.k * factor));
  view.x = cx - (cx - view.x) * k / view.k;
  view.y = cy - (cy - view.y) * k / view.k;
  view.k = k;
  following = false;
  applyView();
}

/** Create the diagram inside `host`. */
export function mountDiagram(host) {
  svg = s('svg', { class: 'diagram', role: 'img', 'aria-label': 'Process diagram of the water system' },
    s('defs', null, s('pattern', { id: 'grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, s('circle', { class: 'grid-dot', cx: 10, cy: 10, r: 1 }))),
    s('rect', { class: 'grid-bg', width: '100%', height: '100%', fill: 'url(#grid)' }),
    root = s('g', { class: 'view' })
  );
  hint = document.createElement('div');
  hint.className = 'diagram-hint';
  hint.hidden = true;
  legend = document.createElement('div');
  legend.className = 'diagram-legend';
  legend.hidden = true;
  host.append(svg, hint, legend);
  setup();
  applyView();

  on('scenario selection', rebuild);
  on('results time view', update);
  on('tool', () => { pending = null; drawPending(); setHint(); svg.dataset.tool = state.tool; });
  on('loaded', () => { rebuild(); requestAnimationFrame(fit); });
  new ResizeObserver(() => { if (following && svg.getBoundingClientRect().width > 0) fit(); }).observe(svg);
  emit('tool');
}
