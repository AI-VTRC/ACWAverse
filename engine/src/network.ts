// The network as the solver sees it, built directly from a scenario.
//
// Every scenario node becomes one node and every scenario link one link, in
// the direction it was drawn. Two kinds of extra link are added, each ending
// at its own "outlet" node open to the atmosphere:
//   - a demand link at every junction that delivers water to consumers, and
//   - a leak link at every node that a leak attack targets.
// The set of links never changes during a run; a leak that has not started is
// simply a closed link.

import {
  GRAVITY, LinkSpec, NodeSpec, PumpSpec, Scenario, TankSpec, WATER_DENSITY, clamp, num, positive
} from './scenario.js';

export type NodeKind = 'junction' | 'tank' | 'reservoir' | 'outlet';
export type LinkKind = 'pipe' | 'pump' | 'valve' | 'demand' | 'leak';

export interface TankGeometry {
  shape: 'cylinder' | 'box' | 'sphere';
  radius: number;
  baseArea: number;
  maxLevel: number;
  maxVolume: number;
}

export interface PumpCurve {
  /** Full-speed head curve h(q) = a0 + a1 q + a2 q² (m, m³/s). */
  a0: number;
  a1: number;
  a2: number;
  /** Flow at zero head, full speed. */
  maxFlow: number;
  bepFlow: number;
  bepEfficiency: number;
  /** Shaft power at shut-off and at the best-efficiency point, full speed (W). */
  shutoffPower: number;
  bepPower: number;
  npshRequired: number;
}

export interface Node {
  index: number;
  id: string;
  kind: NodeKind;
  spec?: NodeSpec;
  elevation: number;
  /** Total head (m). */
  head: number;
  tank?: TankGeometry;
  /** Tank inlet shuts when the tank is full, instead of spilling. */
  closeInlet: boolean;
  /** Indices of all links at this node. */
  links: number[];
  demandLink: number;
  leakLink: number;
}

export interface Link {
  index: number;
  id: string;
  kind: LinkKind;
  spec?: LinkSpec;
  from: number;
  to: number;
  /** Flow from `from` to `to` (m³/s). */
  flow: number;

  diameter: number;
  area: number;
  length: number;
  volume: number;

  // pipe
  friction: 'hw' | 'dw';
  resistance: number;
  roughness: number;
  minor: number;
  oneWay: boolean;
  shut: boolean;
  /** Fraction of the bore obstructed (0-1). */
  blockage: number;

  // pump and valve: the setting the actuator has been given, and where it actually is
  setting: number;
  // pump
  curve?: PumpCurve;
  speed: number;
  failed: boolean;
  checkValve: boolean;
  rampTime: number;
  elevation: number;
  // valve
  valveKind: string;
  flowMode: boolean;
  opening: number;
  fullOpenK?: number;
  strokeTime: number;
  stuck: boolean;

  // demand
  demand: number;
  pressureRange: number;
  // leak: discharge coefficient × hole area (m²); 0 when there is no hole
  orifice: number;

  /** Node this link may not currently deliver to (a full tank with a closing inlet), or -1. */
  blockedToward: number;
  /** Scratch: head loss and its derivative at the current flow. */
  h: number;
  g: number;
  closed: boolean;
  wasClosed: boolean;
}

export interface Network {
  nodes: Node[];
  links: Link[];
  nodeIndex: Map<string, number>;
  linkIndex: Map<string, number>;
}

export const DEFAULT_HW_C = 130;
export const DEFAULT_DW_ROUGHNESS_MM = 0.26;
export const ORIFICE_CD = 0.61;

// ---------------------------------------------------------------- tanks

export function tankGeometry(spec: TankSpec): TankGeometry {
  const shape = spec.shape || 'cylinder';
  if (shape === 'box') {
    const baseArea = positive(spec.width, 1) * positive(spec.length, 1);
    const maxLevel = positive(spec.height, 1);
    return { shape, radius: 0, baseArea, maxLevel, maxVolume: baseArea * maxLevel };
  }
  const radius = positive(spec.diameter, 1) / 2;
  const baseArea = Math.PI * radius * radius;
  if (shape === 'sphere') {
    const maxLevel = Math.min(positive(spec.height, 2 * radius), 2 * radius);
    const geometry: TankGeometry = { shape, radius, baseArea, maxLevel, maxVolume: 0 };
    geometry.maxVolume = tankVolumeAt(geometry, maxLevel);
    return geometry;
  }
  const maxLevel = positive(spec.height, 1);
  return { shape: 'cylinder', radius, baseArea, maxLevel, maxVolume: baseArea * maxLevel };
}

/** Free-surface area at a given water level (m²). */
export function tankAreaAt(geometry: TankGeometry, level: number): number {
  if (geometry.shape !== 'sphere') return geometry.baseArea;
  const h = clamp(level, 0, 2 * geometry.radius);
  const area = Math.PI * (2 * geometry.radius * h - h * h);
  // A sphere has no plan area at its poles; keep the storage term regular.
  return Math.max(area, 0.01 * geometry.baseArea);
}

export function tankVolumeAt(geometry: TankGeometry, level: number): number {
  if (geometry.shape !== 'sphere') return geometry.baseArea * level;
  const r = geometry.radius;
  if (level <= 0) return 0.01 * geometry.baseArea * level;
  if (level >= 2 * r) return (4 / 3) * Math.PI * r * r * r + 0.01 * geometry.baseArea * (level - 2 * r);
  return Math.PI * level * level * (3 * r - level) / 3;
}

export function tankLevelAt(geometry: TankGeometry, volume: number): number {
  if (geometry.shape !== 'sphere') return volume / geometry.baseArea;
  const r = geometry.radius;
  const full = (4 / 3) * Math.PI * r * r * r;
  if (volume <= 0) return 0;
  if (volume >= full) return 2 * r;
  let low = 0;
  let high = 2 * r;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (low + high);
    if (Math.PI * mid * mid * (3 * r - mid) / 3 < volume) low = mid; else high = mid;
  }
  return 0.5 * (low + high);
}

// ---------------------------------------------------------------- pumps

/**
 * Centrifugal pump characteristic at full speed. Either the three
 * coefficients are given, or the curve is the parabola through the shut-off
 * head and the zero-head flow: h = H0 (1 - (q/Qmax)²).
 */
export function pumpCurve(spec: PumpSpec): PumpCurve {
  let a0: number;
  let a1 = 0;
  let a2: number;
  let maxFlow: number;
  const c = spec.curve;
  if (Array.isArray(c) && c.length === 3 && c.every(v => Number.isFinite(v)) && c[0] > 0 && c[2] < 0) {
    [a0, a1, a2] = c;
    maxFlow = (-a1 - Math.sqrt(a1 * a1 - 4 * a2 * a0)) / (2 * a2);
  } else {
    a0 = positive(spec.shutoffHead, 20);
    maxFlow = positive(spec.maxFlow, 0.01);
    a2 = -a0 / (maxFlow * maxFlow);
  }
  const bepFlow = clamp(positive(spec.bepFlow, 0.6 * maxFlow), 0.05 * maxFlow, 0.95 * maxFlow);
  const bepEfficiency = clamp(positive(spec.efficiency, 0.75), 0.05, 1);
  const bepHead = a0 + a1 * bepFlow + a2 * bepFlow * bepFlow;
  const bepPower = WATER_DENSITY * GRAVITY * bepFlow * bepHead / bepEfficiency;
  return {
    a0, a1, a2, maxFlow, bepFlow, bepEfficiency,
    // Radial-flow pumps draw roughly half their best-point power against a closed valve.
    shutoffPower: 0.5 * bepPower,
    bepPower,
    npshRequired: positive(spec.npshRequired, 3)
  };
}

// ---------------------------------------------------------------- pipes

/** Hazen-Williams resistance for SI units: h = r q^1.852. */
export function hazenWilliamsResistance(length: number, diameter: number, c: number): number {
  return 10.67 * length / (Math.pow(c, 1.852) * Math.pow(diameter, 4.8704));
}

// ---------------------------------------------------------------- build

function blankLink(index: number, id: string, kind: LinkKind, from: number, to: number): Link {
  return {
    index, id, kind, from, to, flow: 0,
    diameter: 0.1, area: 0, length: 0, volume: 0,
    friction: 'hw', resistance: 0, roughness: DEFAULT_HW_C, minor: 0, oneWay: false, shut: false, blockage: 0,
    setting: 0, speed: 0, failed: false, checkValve: true, rampTime: 0, elevation: 0,
    valveKind: 'gate', flowMode: false, opening: 1, strokeTime: 0, stuck: false,
    demand: 0, pressureRange: 1, orifice: 0,
    blockedToward: -1, h: 0, g: 1, closed: false, wasClosed: true
  };
}

/** Build the network. The scenario is assumed to have passed validation. */
export function buildNetwork(scenario: Scenario): Network {
  const nodes: Node[] = [];
  const links: Link[] = [];
  const nodeIndex = new Map<string, number>();
  const linkIndex = new Map<string, number>();

  const addNode = (id: string, kind: NodeKind, elevation: number, spec?: NodeSpec): Node => {
    const node: Node = { index: nodes.length, id, kind, spec, elevation, head: elevation, closeInlet: false, links: [], demandLink: -1, leakLink: -1 };
    nodes.push(node);
    return node;
  };
  const addLink = (id: string, kind: LinkKind, from: number, to: number): Link => {
    const link = blankLink(links.length, id, kind, from, to);
    links.push(link);
    nodes[from].links.push(link.index);
    nodes[to].links.push(link.index);
    return link;
  };

  scenario.nodes.forEach(spec => {
    if (spec.type === 'tank') {
      const node = addNode(spec.id, 'tank', num(spec.elevation, 0), spec);
      node.tank = tankGeometry(spec);
      node.closeInlet = spec.whenFull === 'closeInlet';
      node.head = node.elevation + clamp(num(spec.level, 0), 0, node.tank.maxLevel);
    } else if (spec.type === 'reservoir') {
      const node = addNode(spec.id, 'reservoir', num(spec.head, 0), spec);
      node.head = num(spec.head, 0);
    } else {
      addNode(spec.id, 'junction', num(spec.elevation, 0), spec);
    }
    nodeIndex.set(spec.id, nodes.length - 1);
  });

  scenario.links.forEach(spec => {
    const from = nodeIndex.get(spec.from) as number;
    const to = nodeIndex.get(spec.to) as number;
    const link = addLink(spec.id, spec.type, from, to);
    link.spec = spec;
    linkIndex.set(spec.id, link.index);
    if (spec.type === 'pipe') {
      link.diameter = positive(spec.diameter, 0.1);
      link.length = positive(spec.length, 1);
      link.area = Math.PI * link.diameter * link.diameter / 4;
      link.volume = link.area * link.length;
      link.minor = Math.max(0, num(spec.minorLoss, 0));
      link.oneWay = spec.checkValve === true;
      link.shut = spec.closed === true;
      if (spec.friction === 'darcy-weisbach') {
        link.friction = 'dw';
        link.roughness = positive(spec.roughness, DEFAULT_DW_ROUGHNESS_MM) / 1000;
        link.resistance = 8 * link.length / (Math.PI * Math.PI * GRAVITY * Math.pow(link.diameter, 5));
      } else {
        link.friction = 'hw';
        link.roughness = positive(spec.roughness, DEFAULT_HW_C);
        link.resistance = hazenWilliamsResistance(link.length, link.diameter, link.roughness);
      }
    } else if (spec.type === 'pump') {
      link.curve = pumpCurve(spec);
      // Port size for the losses of a stopped pump: about 3 m/s at full flow.
      link.diameter = Math.sqrt(4 * link.curve.maxFlow / (Math.PI * 3));
      link.area = Math.PI * link.diameter * link.diameter / 4;
      link.setting = clamp(num(spec.speed, 1), 0, 1);
      link.speed = link.setting;
      link.checkValve = spec.checkValve !== false;
      link.rampTime = Math.max(0, num(spec.rampTime, 5));
      link.elevation = num(spec.elevation, nodes[from].elevation);
    } else {
      link.diameter = positive(spec.diameter, 0.1);
      link.area = Math.PI * link.diameter * link.diameter / 4;
      link.valveKind = spec.kind || 'gate';
      link.flowMode = spec.mode === 'flow';
      link.fullOpenK = typeof spec.fullOpenK === 'number' && spec.fullOpenK > 0 ? spec.fullOpenK : undefined;
      link.strokeTime = Math.max(0, num(spec.strokeTime, 10));
      if (link.flowMode) {
        link.setting = Math.max(0, num(spec.setting, Number.POSITIVE_INFINITY));
        link.opening = 1;
      } else {
        link.setting = clamp(num(spec.setting, 1), 0, 1);
        link.opening = link.setting;
      }
    }
  });

  // Demand links: pressure-driven delivery (Wagner): everything at
  // requiredPressure, nothing at minPressure, a square-root law in between.
  scenario.nodes.forEach(spec => {
    if (spec.type !== 'junction' || !(num(spec.demand, 0) > 0)) return;
    const node = nodes[nodeIndex.get(spec.id) as number];
    const minPressure = num(spec.minPressure, 0);
    const required = Math.max(minPressure + 0.01, num(spec.requiredPressure, 10));
    const outlet = addNode(`${spec.id}/demand`, 'outlet', node.elevation);
    outlet.head = node.elevation + minPressure;
    const link = addLink(`${spec.id}/demand`, 'demand', node.index, outlet.index);
    link.pressureRange = required - minPressure;
    link.demand = num(spec.demand, 0);
    node.demandLink = link.index;
  });

  // Leak links for the nodes that leak attacks name.
  (scenario.attacks || []).forEach(attack => {
    if (attack.type !== 'leak') return;
    const index = nodeIndex.get(attack.node);
    if (index === undefined) return;
    const node = nodes[index];
    if (node.leakLink >= 0 || node.kind === 'reservoir') return;
    const outlet = addNode(`${node.id}/leak`, 'outlet', node.elevation);
    const link = addLink(`${node.id}/leak`, 'leak', node.index, outlet.index);
    node.leakLink = link.index;
  });

  return { nodes, links, nodeIndex, linkIndex };
}

/** Demand multiplier of a junction at time t. */
export function demandFactor(spec: NodeSpec | undefined, time: number): number {
  if (!spec || spec.type !== 'junction' || !Array.isArray(spec.pattern) || spec.pattern.length === 0) return 1;
  const step = positive(spec.patternStep, 3600);
  const index = Math.floor(time / step + 1e-9) % spec.pattern.length;
  return Math.max(0, num(spec.pattern[index], 1));
}
