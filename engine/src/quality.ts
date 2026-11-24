// Water quality: transport through the network and reactions.
//
// Transport is the Lagrangian time-driven method used by EPANET: every pipe
// holds a queue of plug-flow segments, junctions mix their inflows completely,
// and tanks are completely mixed reactors.
//
// Each parcel of water carries: temperature, free chlorine, total alkalinity,
// total inorganic carbon, dissolved oxygen, BOD, ammonia, nitrate, a
// conservative tracer, and its age. pH is not transported. It follows from
// alkalinity and inorganic carbon through the carbonate equilibrium, so
// mixing two waters or adding acid gives a chemically consistent pH.

import { Link, Network, Node, tankAreaAt } from './network.js';
import { ChemistrySpec, QualitySpec, Scenario, num } from './scenario.js';
import { HydraulicSolver } from './solver.js';

export const SPECIES = ['temperature', 'chlorine', 'alkalinity', 'tic', 'oxygen', 'bod', 'ammonia', 'nitrate', 'tracer', 'age'] as const;
export type Species = typeof SPECIES[number];
export const NS = SPECIES.length;
const T = 0, CL = 1, ALK = 2, TIC = 3, O2 = 4, BOD = 5, NH3 = 6, NO3 = 7, TRACER = 8, AGE = 9;
// Units inside this file: °C; mg/L; alkalinity in meq/L; inorganic carbon in mmol/L; age in seconds.

// Carbonate system at 25 °C (mol/L).
const K1 = Math.pow(10, -6.35);
const K2 = Math.pow(10, -10.33);
const KW = 1e-14;
const KH_CO2 = 0.0334;          // mol/(L atm)
const N_MOLAR_MASS = 14.007;
const O2_MOLAR_MASS = 31.998;
/** Oxygen used by nitrification: g O2 per g N. */
const O2_PER_N = 4.57;
/** mg/L as CaCO3 per meq/L. */
const CACO3_PER_MEQ = 50.04;
const DAY = 86400;

export const DEFAULT_CHEMISTRY: Required<ChemistrySpec> = {
  chlorineBulkDecay: 0.5,
  chlorineWallDecay: 0,
  bodDecay: 0.23,
  nitrification: 0.1,
  oxygenHalfSaturation: 0.5,
  gasTransfer: 0.5,
  atmosphericCO2: 420,
  heatExchange: 0.5,
  theta: 1.047
};

export const DEFAULT_QUALITY = { chlorine: 0, ph: 7.5, alkalinity: 100, bod: 0, ammonia: 0, nitrate: 0, tracer: 0 };

/** Dissolved-oxygen saturation in fresh water at 1 atm (mg/L). */
export function oxygenSaturation(temperature: number): number {
  const t = Math.max(0, Math.min(40, temperature));
  return 14.652 - 0.41022 * t + 0.007991 * t * t - 0.000077774 * t * t * t;
}

/** Alkalinity (eq/L) of water with inorganic carbon ct (mol/L) at hydrogen-ion activity h. */
function alkalinityAt(h: number, ct: number): number {
  const denominator = h * h + K1 * h + K1 * K2;
  return ct * (K1 * h + 2 * K1 * K2) / denominator + KW / h - h;
}

/** pH from alkalinity (meq/L) and total inorganic carbon (mmol/L). */
export function phOf(alkalinityMeq: number, ticMmol: number): number {
  const alk = alkalinityMeq / 1000;
  const ct = Math.max(0, ticMmol) / 1000;
  let low = 0;
  let high = 14;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (low + high);
    if (alkalinityAt(Math.pow(10, -mid), ct) < alk) low = mid; else high = mid;
  }
  return 0.5 * (low + high);
}

/** Total inorganic carbon (mmol/L) of water with a given pH and alkalinity (meq/L). */
export function ticFor(ph: number, alkalinityMeq: number): number {
  const h = Math.pow(10, -Math.max(0, Math.min(14, ph)));
  const denominator = h * h + K1 * h + K1 * K2;
  const equivalents = (K1 * h + 2 * K1 * K2) / denominator;
  return Math.max(0, 1000 * (alkalinityMeq / 1000 - KW / h + h) / equivalents);
}

/** Dissolved CO2 (mmol/L) at a given pH and inorganic carbon (mmol/L). */
function dissolvedCO2(ph: number, ticMmol: number): number {
  const h = Math.pow(10, -ph);
  return Math.max(0, ticMmol) * h * h / (h * h + K1 * h + K1 * K2);
}

interface Segment {
  volume: number;
  c: Float64Array;
}

function parcel(spec: QualitySpec, ambient: number): Float64Array {
  const c = new Float64Array(NS);
  const temperature = num(spec.temperature, ambient);
  const alkalinity = Math.max(0, num(spec.alkalinity, DEFAULT_QUALITY.alkalinity)) / CACO3_PER_MEQ;
  c[T] = temperature;
  c[CL] = Math.max(0, num(spec.chlorine, DEFAULT_QUALITY.chlorine));
  c[ALK] = alkalinity;
  c[TIC] = ticFor(num(spec.ph, DEFAULT_QUALITY.ph), alkalinity);
  c[O2] = Math.max(0, num(spec.oxygen, oxygenSaturation(temperature)));
  c[BOD] = Math.max(0, num(spec.bod, DEFAULT_QUALITY.bod));
  c[NH3] = Math.max(0, num(spec.ammonia, DEFAULT_QUALITY.ammonia));
  c[NO3] = Math.max(0, num(spec.nitrate, DEFAULT_QUALITY.nitrate));
  c[TRACER] = Math.max(0, num(spec.tracer, DEFAULT_QUALITY.tracer));
  c[AGE] = 0;
  return c;
}

export type Substance = 'chlorine' | 'acid' | 'base' | 'ammonia' | 'bod' | 'nitrate' | 'tracer' | 'dechlorinator' | 'sulfite';

export class QualityModel {
  /** Concentrations of the water at each node. */
  readonly conc: Float64Array[];
  readonly chemistry: Required<ChemistrySpec>;
  maxSegments = 200;

  private readonly network: Network;
  private readonly hydraulics: HydraulicSolver;
  private readonly segments: Segment[][];
  private readonly tankBefore: Float64Array[];
  /** Substance waiting at a junction for water to carry it away (per species, in mass units). */
  private readonly pending: Array<Float64Array | null>;
  private readonly scratch = new Float64Array(NS);

  constructor(scenario: Scenario, network: Network, hydraulics: HydraulicSolver, ambient: number) {
    this.network = network;
    this.hydraulics = hydraulics;
    this.chemistry = { ...DEFAULT_CHEMISTRY, ...(scenario.chemistry || {}) };
    const nodes = network.nodes;
    const base = scenario.quality || {};

    // Tanks and reservoirs hold water of their own; so does a junction that
    // states a quality. The rest start with the water of the nearest of those.
    const conc: Array<Float64Array | undefined> = nodes.map(node => {
      const spec = node.spec;
      if (!spec) return undefined;
      if (node.kind === 'tank' || node.kind === 'reservoir' || spec.quality) return parcel({ ...base, ...(spec.quality || {}) }, ambient);
      return undefined;
    });
    const queue: number[] = [];
    conc.forEach((value, index) => { if (value) queue.push(index); });
    for (let head = 0; head < queue.length; head++) {
      const node = nodes[queue[head]];
      node.links.forEach(linkIndex => {
        const link = network.links[linkIndex];
        const other = link.from === node.index ? link.to : link.from;
        if (!conc[other]) {
          conc[other] = Float64Array.from(conc[node.index] as Float64Array);
          queue.push(other);
        }
      });
    }
    const fallback = parcel(base, ambient);
    this.conc = conc.map(value => value || Float64Array.from(fallback));
    this.tankBefore = nodes.map(() => new Float64Array(NS));
    this.pending = nodes.map(() => null);

    // As in EPANET, a pipe starts filled with the water of its far end.
    this.segments = network.links.map(link => {
      if (link.kind !== 'pipe' || link.volume <= 0) return [];
      return [{ volume: link.volume, c: Float64Array.from(this.conc[link.to]) }];
    });
  }

  // ------------------------------------------------------------ reactions

  private react(c: Float64Array, dt: number, pipe: Link | null, tank: Node | null, ambient: number): void {
    const k = this.chemistry;
    c[AGE] += dt;
    if (tank) c[T] += (ambient - c[T]) * (1 - Math.exp(-Math.max(0, k.heatExchange) / DAY * dt));
    const thermal = Math.pow(k.theta, c[T] - 20);
    const oxygenLimit = () => c[O2] / (k.oxygenHalfSaturation + c[O2]);

    // Carbonaceous BOD: organic matter + O2 -> CO2.
    if (k.bodDecay > 0 && c[BOD] > 0 && c[O2] > 0) {
      const rate = k.bodDecay / DAY * thermal * oxygenLimit();
      const exerted = Math.min(c[BOD] * (1 - Math.exp(-rate * dt)), c[O2]);
      c[BOD] -= exerted;
      c[O2] -= exerted;
      c[TIC] += exerted / O2_MOLAR_MASS;
    }

    // Nitrification: NH4+ + 2 O2 -> NO3- + 2 H+ + H2O.
    if (k.nitrification > 0 && c[NH3] > 0 && c[O2] > 0) {
      const rate = k.nitrification / DAY * thermal * oxygenLimit();
      const nitrogen = Math.min(c[NH3] * (1 - Math.exp(-rate * dt)), c[O2] / O2_PER_N);
      c[NH3] -= nitrogen;
      c[O2] -= O2_PER_N * nitrogen;
      c[NO3] += nitrogen;
      c[ALK] -= 2 * nitrogen / N_MOLAR_MASS;
    }

    // Free chlorine: first-order decay in the bulk, plus wall demand in pipes.
    let chlorineRate = Math.max(0, k.chlorineBulkDecay) / DAY * thermal;
    if (pipe && k.chlorineWallDecay > 0) chlorineRate += 4 * k.chlorineWallDecay / DAY / pipe.diameter;
    if (chlorineRate > 0) c[CL] *= Math.exp(-chlorineRate * dt);

    // Exchange of oxygen and carbon dioxide across the free surface of a tank.
    if (tank && k.gasTransfer > 0) {
      const i = tank.index;
      const area = tankAreaAt(tank.tank!, this.hydraulics.level[i]);
      const depth = Math.max(0.05, this.hydraulics.volume[i] / area);
      const transfer = 1 - Math.exp(-(k.gasTransfer / DAY / depth) * dt);
      c[O2] += (oxygenSaturation(c[T]) - c[O2]) * transfer;
      const equilibrium = 1000 * KH_CO2 * k.atmosphericCO2 * 1e-6;
      c[TIC] = Math.max(0, c[TIC] + (equilibrium - dissolvedCO2(phOf(c[ALK], c[TIC]), c[TIC])) * transfer);
    }
  }

  // ------------------------------------------------------------ transport

  /** Remove `volume` from the outflow end of a link and add what it carries to `mass`. */
  private pull(link: Link, forward: boolean, volume: number, mass: Float64Array): void {
    const upstream = forward ? link.from : link.to;
    const segments = this.segments[link.index];
    let remaining = volume;
    while (remaining > 0 && segments.length > 0) {
      const index = forward ? segments.length - 1 : 0;
      const segment = segments[index];
      const taken = Math.min(segment.volume, remaining);
      for (let s = 0; s < NS; s++) mass[s] += taken * segment.c[s];
      remaining -= taken;
      segment.volume -= taken;
      if (segment.volume <= 1e-15) {
        if (forward) segments.pop(); else segments.shift();
      }
    }
    if (remaining > 0) {
      // More water crossed the link than it holds (always so for pumps and
      // valves, which hold none): the rest comes straight from upstream.
      const source = this.network.nodes[upstream].kind === 'tank' ? this.tankBefore[upstream] : this.conc[upstream];
      for (let s = 0; s < NS; s++) mass[s] += remaining * source[s];
    }
  }

  private push(link: Link, forward: boolean, volume: number, c: Float64Array): void {
    const segments = this.segments[link.index];
    const added = Math.min(volume, link.volume);
    const neighbour = forward ? segments[0] : segments[segments.length - 1];
    if (neighbour && distance(neighbour.c, c) < 1e-4) {
      blend(neighbour, added, c);
      return;
    }
    const segment = { volume: added, c: Float64Array.from(c) };
    if (forward) segments.unshift(segment); else segments.push(segment);
    if (segments.length > this.maxSegments) {
      // Merge the most alike adjacent pair to bound memory.
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < segments.length; i++) {
        const d = distance(segments[i].c, segments[i + 1].c);
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
      blend(segments[best], segments[best + 1].volume, segments[best + 1].c);
      segments.splice(best + 1, 1);
    }
  }

  /**
   * Advance quality by dt using the flows of the hydraulic step just taken.
   * `volumeBefore` holds the tank volumes at the start of that step.
   */
  advance(dt: number, volumeBefore: Float64Array, ambient: number): void {
    if (dt <= 0) return;
    const { network, conc, scratch } = this;
    const nodes = network.nodes;
    const links = network.links;
    const eps = 1e-15;

    // 1. Reactions.
    links.forEach(link => {
      this.segments[link.index].forEach(segment => this.react(segment.c, dt, link, null, ambient));
    });
    nodes.forEach(node => {
      if (node.kind !== 'tank') return;
      this.react(conc[node.index], dt, null, node, ambient);
      this.tankBefore[node.index].set(conc[node.index]);
    });

    // 2. Order the junctions so that water passing through several short or
    //    volumeless links within one step picks up upstream changes.
    const isJunction = (index: number) => nodes[index].kind === 'junction';
    const indegree = new Int32Array(nodes.length);
    const downstream: number[][] = nodes.map(() => []);
    links.forEach(link => {
      const moved = Math.abs(link.flow) * dt;
      if (moved <= eps || moved <= link.volume) return;
      const up = link.flow > 0 ? link.from : link.to;
      const down = link.flow > 0 ? link.to : link.from;
      if (isJunction(up) && isJunction(down)) {
        downstream[up].push(down);
        indegree[down]++;
      }
    });
    const order: number[] = [];
    const placed = new Uint8Array(nodes.length);
    nodes.forEach(node => { if (isJunction(node.index) && indegree[node.index] === 0) { order.push(node.index); placed[node.index] = 1; } });
    for (let head = 0; head < order.length; head++) {
      downstream[order[head]].forEach(next => {
        if (--indegree[next] === 0 && !placed[next]) { order.push(next); placed[next] = 1; }
      });
    }
    nodes.forEach(node => { if (isJunction(node.index) && !placed[node.index]) order.push(node.index); });

    const inflow = (node: Node): number => {
      scratch.fill(0);
      let volume = 0;
      node.links.forEach(linkIndex => {
        const link = links[linkIndex];
        const forward = link.flow > 0;
        const into = forward ? link.to : link.from;
        const moved = Math.abs(link.flow) * dt;
        if (into !== node.index || moved <= eps) return;
        this.pull(link, forward, moved, scratch);
        volume += moved;
      });
      return volume;
    };

    // 3. Junctions: complete, instantaneous mixing of the inflows, plus
    //    anything injected there.
    order.forEach(index => {
      const volume = inflow(nodes[index]);
      if (volume <= eps) return;
      const c = conc[index];
      for (let s = 0; s < NS; s++) c[s] = scratch[s] / volume;
      const waiting = this.pending[index];
      if (waiting) {
        for (let s = 0; s < NS; s++) c[s] += waiting[s] / volume;
        c[CL] = Math.max(0, c[CL]);
        c[O2] = Math.max(0, c[O2]);
        this.pending[index] = null;
      }
    });

    // 4. Tanks (completely mixed) and outlets.
    nodes.forEach(node => {
      if (node.kind === 'junction') return;
      const volume = inflow(node);
      if (node.kind !== 'tank' || volume <= eps) return;
      const i = node.index;
      const after = this.hydraulics.volume[i];
      const c = conc[i];
      // Water that was in the tank at the start and is still there.
      const retained = Math.max(0, Math.min(volumeBefore[i], after - volume));
      const fresh = Math.max(0, after - retained);
      const total = retained + fresh;
      if (total <= eps) {
        for (let s = 0; s < NS; s++) c[s] = scratch[s] / volume;
      } else {
        for (let s = 0; s < NS; s++) c[s] = (retained * c[s] + fresh * scratch[s] / volume) / total;
      }
    });

    // 5. Refill the upstream end of every flowing pipe.
    links.forEach(link => {
      if (link.kind !== 'pipe' || link.volume <= 0) return;
      const moved = Math.abs(link.flow) * dt;
      if (moved <= eps) return;
      const forward = link.flow > 0;
      const upstream = forward ? link.from : link.to;
      const source = nodes[upstream].kind === 'tank' ? this.tankBefore[upstream] : conc[upstream];
      this.push(link, forward, moved, source);
    });
  }

  // ------------------------------------------------------------ injection

  /**
   * Add a substance at a node. In a tank it mixes into the stored water at
   * once. At a junction it is carried off by the water that next flows through.
   * Amounts are grams, except acid and base (moles), dechlorinator (grams
   * of chlorine neutralised) and sulfite (grams of oxygen removed).
   */
  inject(nodeIndex: number, substance: Substance, amount: number): void {
    const delta = new Float64Array(NS);
    switch (substance) {
      case 'chlorine': delta[CL] = amount; break;
      case 'dechlorinator': delta[CL] = -amount; break;
      case 'sulfite': delta[O2] = -amount; break;
      case 'acid': delta[ALK] = -amount; break;   // mol per m³ = meq/L
      case 'base': delta[ALK] = amount; break;
      case 'ammonia': delta[NH3] = amount; break;
      case 'bod': delta[BOD] = amount; break;
      case 'nitrate': delta[NO3] = amount; break;
      case 'tracer': delta[TRACER] = amount; break;
    }
    const node = this.network.nodes[nodeIndex];
    if (node.kind === 'tank') {
      const volume = this.hydraulics.volume[nodeIndex];
      if (volume <= 1e-9) return;
      const c = this.conc[nodeIndex];
      for (let s = 0; s < NS; s++) c[s] += delta[s] / volume;
      c[CL] = Math.max(0, c[CL]);
      c[O2] = Math.max(0, c[O2]);
    } else if (node.kind === 'junction') {
      const waiting = this.pending[nodeIndex] || (this.pending[nodeIndex] = new Float64Array(NS));
      for (let s = 0; s < NS; s++) waiting[s] += delta[s];
    }
  }

  // ------------------------------------------------------------ access

  /** A quality quantity of the water at a node, in reporting units. */
  value(nodeIndex: number, quantity: string): number {
    return quantityOf(this.conc[nodeIndex], quantity);
  }

  /** Total amount of a transported species in tanks and pipes (g; eq and mol for alkalinity and carbon). */
  totalMass(species: Species): number {
    const index = SPECIES.indexOf(species);
    let total = 0;
    this.network.nodes.forEach(node => {
      if (node.kind === 'tank') total += this.hydraulics.volume[node.index] * this.conc[node.index][index];
    });
    this.segments.forEach(list => list.forEach(segment => { total += segment.volume * segment.c[index]; }));
    return total;
  }

  /** Plug-flow profile of a pipe, from its start to its end. */
  pipeProfile(linkIndex: number, quantity: string): Array<{ volume: number; value: number }> {
    return this.segments[linkIndex].map(segment => ({ volume: segment.volume, value: quantityOf(segment.c, quantity) }));
  }
}

function quantityOf(c: Float64Array, quantity: string): number {
  switch (quantity) {
    case 'temperature': return c[T];
    case 'chlorine': return c[CL];
    case 'ph': return phOf(c[ALK], c[TIC]);
    case 'alkalinity': return c[ALK] * CACO3_PER_MEQ;
    case 'oxygen': return c[O2];
    case 'bod': return c[BOD];
    case 'ammonia': return c[NH3];
    case 'nitrate': return c[NO3];
    case 'tracer': return c[TRACER];
    case 'age': return c[AGE] / 3600;
    default: return NaN;
  }
}

function distance(a: Float64Array, b: Float64Array): number {
  let worst = 0;
  for (let s = 0; s < NS; s++) {
    // Age always differs a little between parcels; a minute apart counts as alike.
    const scale = s === AGE ? 6e5 : Math.max(Math.abs(a[s]), Math.abs(b[s]), 1e-3);
    worst = Math.max(worst, Math.abs(a[s] - b[s]) / scale);
  }
  return worst;
}

function blend(segment: Segment, volume: number, c: Float64Array): void {
  const total = segment.volume + volume;
  if (total <= 0) return;
  for (let s = 0; s < NS; s++) segment.c[s] = (segment.c[s] * segment.volume + c[s] * volume) / total;
  segment.volume = total;
}
