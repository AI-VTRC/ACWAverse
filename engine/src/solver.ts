// Network hydraulics: the Global Gradient Algorithm (Todini & Pilati, 1988),
// the method used by EPANET, extended with implicit tank storage so that the
// extended-period simulation is unconditionally stable.
//
// Unknowns are the head at every node and the flow in every link. Each Newton
// iteration linearises the link head-loss laws, solves a sparse symmetric
// positive-definite system for the heads and updates the flows. Mass is
// conserved at every node on every iteration; the iteration drives the
// energy-equation residual to zero.

import { evaluateLink, nominalFlow } from './elements.js';
import { SkylineSolver } from './linear.js';
import { Network, Node, tankAreaAt, tankLevelAt, tankVolumeAt } from './network.js';

const MODE_STORAGE = 1;
const MODE_FIXED = 2;
const MODE_DRAIN = 3;

export interface SolveInfo {
  converged: boolean;
  iterations: number;
  solves: number;
  /** Time actually advanced; shorter than requested when a tank fills mid-step. */
  dtTaken: number;
}

export class HydraulicSolver {
  readonly network: Network;
  /** Stored volume per node (tanks only), m³. */
  readonly volume: Float64Array;
  readonly level: Float64Array;
  /** Cumulative spilled volume per tank, m³. */
  readonly overflowVolume: Float64Array;
  /** Spill rate over the most recent step, m³/s. */
  readonly overflowRate: Float64Array;
  /** 1 for a tank that ran dry in the most recent step. */
  readonly empty: Uint8Array;
  /** Net link outflow from each node over the most recent solve, m³/s. */
  readonly netOutflow: Float64Array;

  tolerance = 1e-7;
  maxIterations = 200;

  private readonly solver: SkylineSolver;
  private readonly rhs: Float64Array;
  private readonly heads: Float64Array;
  private readonly diag: Float64Array;
  private readonly p: Float64Array;
  private readonly c: Float64Array;
  private readonly next: Float64Array;
  private readonly nonlinearStorage: boolean;
  private readonly mode: Uint8Array;
  /** Nodes held at their current head because nothing else fixes their group. */
  private readonly pinned: Uint8Array;
  private readonly tankNodes: Node[];

  constructor(network: Network) {
    this.network = network;
    const model = network;
    const n = model.nodes.length;
    this.volume = new Float64Array(n);
    this.level = new Float64Array(n);
    this.overflowVolume = new Float64Array(n);
    this.overflowRate = new Float64Array(n);
    this.empty = new Uint8Array(n);
    this.netOutflow = new Float64Array(n);
    this.rhs = new Float64Array(n);
    this.heads = new Float64Array(n);
    this.diag = new Float64Array(n);
    this.p = new Float64Array(model.links.length);
    this.c = new Float64Array(model.links.length);
    this.next = new Float64Array(model.links.length);
    this.mode = new Uint8Array(n);
    this.pinned = new Uint8Array(n);
    this.solver = new SkylineSolver(n, model.links.map(link => [link.from, link.to] as [number, number]));
    this.tankNodes = model.nodes.filter(node => node.kind === 'tank');
    this.nonlinearStorage = this.tankNodes.some(node => node.tank!.shape === 'sphere');
    this.tankNodes.forEach(node => {
      const tank = node.tank!;
      const initialLevel = Math.max(0, Math.min(tank.maxLevel, node.head - node.elevation));
      this.level[node.index] = initialLevel;
      this.volume[node.index] = tankVolumeAt(tank, initialLevel);
      node.head = node.elevation + initialLevel;
    });
  }

  /** Total water held in tanks (m³). */
  storedVolume(): number {
    return this.tankNodes.reduce((sum, node) => sum + this.volume[node.index], 0);
  }

  /**
   * Advance the network by up to `dt` seconds (implicit Euler for tank storage).
   * With dt = 0 the tanks are held at their current level and a steady
   * snapshot of flows and heads is computed.
   */
  solve(dt: number): SolveInfo {
    const { network: model, mode } = this;
    const info: SolveInfo = { converged: true, iterations: 0, solves: 0, dtTaken: dt };

    model.links.forEach(link => {
      evaluateLink(link, link.flow);
      if (!link.closed && link.wasClosed) link.flow = nominalFlow(link);
      link.wasClosed = link.closed;
    });

    const volumeTolerance = (node: Node) => 1e-9 * Math.max(1, node.tank!.maxVolume);
    const maxPasses = 2 * this.tankNodes.length + 1;
    let step = dt;

    for (let attempt = 0; attempt < 6; attempt++) {
      let shortened = false;
      this.tankNodes.forEach(node => {
        mode[node.index] = step > 0 ? MODE_STORAGE : MODE_FIXED;
        node.head = node.elevation + this.level[node.index];
        const full = this.volume[node.index] >= node.tank!.maxVolume - volumeTolerance(node);
        this.blockInflow(node, step <= 0 && full && this.closesWhenFull(node));
      });

      for (let pass = 0; pass < maxPasses && !shortened; pass++) {
        const result = this.iterate(step);
        info.solves++;
        info.iterations = Math.max(info.iterations, result.iterations);
        info.converged = result.converged;
        this.computeNetOutflow();

        let changed = false;
        this.tankNodes.forEach(node => {
          const i = node.index;
          const tank = node.tank!;
          if (mode[i] === MODE_STORAGE) {
            const next = this.volume[i] - step * (this.netOutflow[i]);
            if (next < -volumeTolerance(node)) {
              mode[i] = MODE_DRAIN;
              changed = true;
            } else if (next > tank.maxVolume + volumeTolerance(node)) {
              const room = tank.maxVolume - this.volume[i];
              if (this.closesWhenFull(node) && room > 1e-6 * tank.maxVolume && attempt < 5) {
                // The tank fills part-way through the step: stop there, so its
                // inlet closes at the right moment.
                step *= Math.max(1e-3, room / (next - this.volume[i]));
                shortened = true;
                return;
              }
              mode[i] = MODE_FIXED;
              node.head = node.elevation + tank.maxLevel;
              // A full tank either shuts its inlet or spills.
              if (this.closesWhenFull(node)) this.blockInflow(node, true);
              changed = true;
            }
          } else if (mode[i] === MODE_FIXED && step <= 0) {
            if (this.volume[i] <= volumeTolerance(node) && this.netOutflow[i] > 1e-9) {
              mode[i] = MODE_DRAIN;
              changed = true;
            }
          }
        });
        if (!changed) break;
      }
      if (!shortened) break;
    }

    info.dtTaken = step;
    if (step > 0) this.commit(step);
    return info;
  }

  private closesWhenFull(node: Node): boolean {
    return node.closeInlet;
  }

  private blockInflow(node: Node, blocked: boolean): void {
    node.links.forEach(index => {
      const link = this.network.links[index];
      if (blocked) link.blockedToward = node.index;
      else if (link.blockedToward === node.index) link.blockedToward = -1;
    });
  }

  private computeNetOutflow(): void {
    this.netOutflow.fill(0);
    this.network.links.forEach(link => {
      this.netOutflow[link.from] += link.flow;
      this.netOutflow[link.to] -= link.flow;
    });
  }

  private commit(dt: number): void {
    const { mode } = this;
    this.tankNodes.forEach(node => {
      const i = node.index;
      const tank = node.tank!;
      const before = this.volume[i];
      this.empty[i] = mode[i] === MODE_DRAIN ? 1 : 0;
      let next: number;
      if (mode[i] === MODE_DRAIN) {
        next = 0;
      } else {
        next = before - dt * this.netOutflow[i];
        if (next < 0) next = 0;
      }
      let overflow = 0;
      if (next > tank.maxVolume) {
        overflow = next - tank.maxVolume;
        next = tank.maxVolume;
      }
      this.volume[i] = next;
      this.level[i] = Math.min(tank.maxLevel, tankLevelAt(tank, next));
      this.overflowVolume[i] += overflow;
      this.overflowRate[i] = overflow / dt;
      node.head = node.elevation + this.level[i];
    });
  }

  private isFixed(node: Node): boolean {
    return (node.kind === 'reservoir' || node.kind === 'outlet') || this.mode[node.index] === MODE_FIXED || this.pinned[node.index] === 1;
  }

  /**
   * Heads are only defined relative to a reference. A group of connected
   * nodes with no reservoir, no fixed-level tank and no storage (a pump or
   * valve between closed pipes, a stray junction) has none, so one of its
   * nodes is held at its current head to keep the equations solvable.
   */
  private pinFloatingGroups(): void {
    const { network: model, mode, pinned } = this;
    const nodes = model.nodes;
    const links = model.links;
    const reached = new Uint8Array(nodes.length);
    const stack: number[] = [];
    const spread = () => {
      while (stack.length > 0) {
        const node = nodes[stack.pop() as number];
        for (let k = 0; k < node.links.length; k++) {
          const link = links[node.links[k]];
          const other = link.from === node.index ? link.to : link.from;
          if (!reached[other]) { reached[other] = 1; stack.push(other); }
        }
      }
    };
    pinned.fill(0);
    nodes.forEach(node => {
      if ((node.kind === 'reservoir' || node.kind === 'outlet') || mode[node.index] === MODE_FIXED || mode[node.index] === MODE_STORAGE) {
        reached[node.index] = 1;
        stack.push(node.index);
      }
    });
    spread();
    nodes.forEach(node => {
      if (reached[node.index]) return;
      pinned[node.index] = 1;
      reached[node.index] = 1;
      stack.push(node.index);
      spread();
    });
  }

  private iterate(dt: number): { converged: boolean; iterations: number } {
    const { network: model, solver, rhs, heads, diag, p, c, mode } = this;
    const nodes = model.nodes;
    const links = model.links;
    const next_ = this.next;
    let previousDelta = Number.POSITIVE_INFINITY;
    let stalled = 0;
    this.pinFloatingGroups();

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      solver.clear();
      rhs.fill(0);
      diag.fill(0);

      for (let k = 0; k < links.length; k++) {
        const link = links[k];
        evaluateLink(link, link.flow);
        const conductance = 1 / link.g;
        const constant = link.flow - conductance * link.h;
        p[k] = conductance;
        c[k] = constant;
        const from = nodes[link.from];
        const to = nodes[link.to];
        const fromFixed = this.isFixed(from);
        const toFixed = this.isFixed(to);
        if (!fromFixed) {
          diag[link.from] += conductance;
          rhs[link.from] -= constant;
          if (toFixed) rhs[link.from] += conductance * to.head;
        }
        if (!toFixed) {
          diag[link.to] += conductance;
          rhs[link.to] += constant;
          if (fromFixed) rhs[link.to] += conductance * from.head;
        }
        if (!fromFixed && !toFixed) solver.add(link.from, link.to, -conductance);
      }

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (this.isFixed(node)) {
          diag[i] = 1;
          rhs[i] = node.head;
        } else if (mode[i] === MODE_STORAGE) {
          const tank = node.tank!;
          const levelNow = node.head - node.elevation;
          const area = tankAreaAt(tank, levelNow);
          diag[i] += area / dt;
          rhs[i] += (area * node.head - (tankVolumeAt(tank, levelNow) - this.volume[i])) / dt;
        } else if (mode[i] === MODE_DRAIN) {
          // An empty tank passes on only what it receives.
          rhs[i] += dt > 0 ? Math.max(0, this.volume[i]) / dt : 0;
        }
        if (diag[i] < 1e-14) {
          // Unconnected node: pin it to its current head.
          diag[i] = 1;
          rhs[i] = node.head;
        }
        solver.add(i, i, diag[i]);
      }

      if (!solver.solve(rhs, heads)) {
        return { converged: false, iterations: iteration };
      }

      let delta = 0;
      let total = 0;
      for (let k = 0; k < links.length; k++) {
        const link = links[k];
        const next = c[k] + p[k] * (heads[link.from] - heads[link.to]);
        delta += Math.abs(next - link.flow);
        total += Math.abs(next);
        next_[k] = next;
      }
      let headChange = 0;
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (this.isFixed(node)) continue;
        if (mode[i] === MODE_STORAGE) headChange = Math.max(headChange, Math.abs(heads[i] - node.head));
        node.head = heads[i];
      }

      const converged = delta <= this.tolerance * total + 1e-12 && (!this.nonlinearStorage || headChange < 1e-7);
      if (converged) {
        for (let k = 0; k < links.length; k++) links[k].flow = next_[k];
        return { converged: true, iterations: iteration };
      }
      // Damp the update when the iteration is not contracting.
      if (delta > 0.7 * previousDelta) stalled++; else stalled = Math.max(0, stalled - 1);
      const relaxation = stalled >= 3 ? 0.5 : 1;
      for (let k = 0; k < links.length; k++) links[k].flow += relaxation * (next_[k] - links[k].flow);
      previousDelta = delta;
    }
    return { converged: false, iterations: this.maxIterations };
  }
}

