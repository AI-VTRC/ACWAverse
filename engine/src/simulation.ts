// Runs a scenario: plant physics, control system and attacks, in step.
//
// At each point of the timeline, in this order:
//   1. attacks that start or stop change the condition of the plant;
//   2. sensors are read (and their signals falsified by any signal attack);
//   3. controllers run on the reported readings and command the actuators;
//   4. a row is recorded: the true state, the readings, the commands, labels;
//   5. hydraulics and water quality advance to the next point.

import { applyPhysicalAttacks, attackClass, attackEndTime, injectedBetween, isActive, isInstant, isLabelled } from './attacks.js';
import { ControlSystem } from './control.js';
import { NPSH_ATMOSPHERE, pumpEfficiency, pumpHead, pumpIsRunning, pumpNpshRequired, pumpShaftPower } from './elements.js';
import { Link, Network, Node, buildNetwork, demandFactor } from './network.js';
import { QualityModel } from './quality.js';
import {
  AttackSpec, ChemicalInterferenceAttack, Issue, QUALITY_QUANTITIES, Scenario, ScenarioError, clamp, num, positive, quantitiesFor, validateScenario
} from './scenario.js';
import { HydraulicSolver } from './solver.js';

export interface Column {
  key: string;
  /** Id of the element, sensor or controller the column belongs to. */
  owner: string;
  ownerType: string;
  quantity: string;
  label: string;
  unit: string;
  /** state: true physical value. reading: what a sensor reports. truth: what it should report. command: controller output. */
  group: 'state' | 'reading' | 'truth' | 'command';
}

export interface SimEvent {
  time: number;
  kind: 'attack' | 'tank' | 'pump' | 'supply' | 'solver';
  where: string;
  message: string;
}

export interface Results {
  name: string;
  /** Number of recorded rows. */
  rows: number;
  /** Time of each row (s). */
  times: Float64Array;
  /** One array per column key, a value per row. */
  series: Record<string, Float64Array>;
  columns: Column[];
  labels: {
    /** 1 where any attack is in progress. */
    any: Uint8Array;
    data_poisoning: Uint8Array;
    physical_damage: Uint8Array;
    chemical_interference: Uint8Array;
    byAttack: Record<string, Uint8Array>;
  };
  events: SimEvent[];
  /** Water volumes over the run (m³). `error` is what the books fail to balance by. */
  balance: { supplied: number; delivered: number; requested: number; leaked: number; spilled: number; stored: number; error: number };
  stats: { steps: number; solves: number; maxIterations: number; unconverged: number };
  warnings: Issue[];
}

interface Channel {
  column: Column;
  get: () => number;
  data: Float64Array;
}

export class Simulation {
  readonly scenario: Scenario;
  readonly network: Network;
  readonly solver: HydraulicSolver;
  readonly quality: QualityModel;
  readonly control: ControlSystem;
  readonly results: Results;
  /** Current simulation time (s). */
  time = 0;

  private readonly timeline: number[];
  private position = 0;
  private readonly reportStep: number;
  private readonly ambient: number;
  private readonly attacks: AttackSpec[];
  private readonly channels: Channel[] = [];
  private readonly stuckAt = new Map<string, number>();
  /** What the control system last asked of each actuator, by link index. */
  private readonly intended: Float64Array;
  private readonly energy: Float64Array;
  private readonly suppliedByNode: Float64Array;
  private readonly volumeBefore: Float64Array;
  private readonly flags = new Map<string, boolean>();
  private readonly initialStorage: number;
  private row = 0;

  constructor(scenario: Scenario) {
    const issues = validateScenario(scenario);
    const errors = issues.filter(issue => issue.level === 'error');
    if (errors.length > 0) throw new ScenarioError(errors);

    this.scenario = scenario;
    const sim = scenario.simulation;
    const duration = Math.max(0, num(sim.duration, 0));
    const timeStep = positive(sim.timeStep, 60);
    this.reportStep = positive(sim.reportStep, timeStep);
    this.ambient = num(sim.ambientTemperature, 20);
    this.attacks = scenario.attacks || [];

    this.network = buildNetwork(scenario);
    this.solver = new HydraulicSolver(this.network);
    this.quality = new QualityModel(scenario, this.network, this.solver, this.ambient);
    const links = this.network.links;
    this.intended = Float64Array.from(links, link => link.setting);
    this.energy = new Float64Array(links.length);
    this.suppliedByNode = new Float64Array(this.network.nodes.length);
    this.volumeBefore = new Float64Array(this.network.nodes.length);
    this.initialStorage = this.solver.storedVolume();

    this.control = new ControlSystem(
      scenario,
      (element, quantity) => this.reader(element, quantity),
      id => this.network.linkIndex.get(id) as number,
      index => this.intended[index]
    );

    this.timeline = this.buildTimeline(duration, timeStep);
    const rows = Math.floor(duration / this.reportStep + 1e-9) + 1;
    this.buildChannels(rows);
    const byAttack: Record<string, Uint8Array> = {};
    this.attacks.forEach(attack => { byAttack[attack.id] = new Uint8Array(rows); });
    this.results = {
      name: scenario.name || 'Scenario',
      rows: 0,
      times: new Float64Array(rows),
      series: {},
      columns: this.channels.map(channel => channel.column),
      labels: { any: new Uint8Array(rows), data_poisoning: new Uint8Array(rows), physical_damage: new Uint8Array(rows), chemical_interference: new Uint8Array(rows), byAttack },
      events: [],
      balance: { supplied: 0, delivered: 0, requested: 0, leaked: 0, spilled: 0, stored: 0, error: 0 },
      stats: { steps: 0, solves: 0, maxIterations: 0, unconverged: 0 },
      warnings: issues.filter(issue => issue.level === 'warning')
    };
    this.channels.forEach(channel => { this.results.series[channel.column.key] = channel.data; });

    // The state at time zero: a steady snapshot with the tanks at their initial levels.
    this.arrive(0, true);
  }

  get duration(): number {
    return this.timeline[this.timeline.length - 1];
  }

  get finished(): boolean {
    return this.position >= this.timeline.length - 1;
  }

  /** Advance to the next point of the timeline. Returns false when the run is over. */
  step(): boolean {
    if (this.finished) return false;
    const target = this.timeline[this.position + 1];
    let t = this.time;
    for (let guard = 0; guard < 200 && t < target - 1e-9; guard++) {
      t += this.advance(t, target - t);
    }
    this.position++;
    this.time = target;
    this.arrive(target, false);
    if (this.finished) this.finish();
    return !this.finished;
  }

  /** Run to the end and return the results. */
  run(): Results {
    while (this.step()) { /* keep going */ }
    if (this.timeline.length === 1) this.finish();
    return this.results;
  }

  // ------------------------------------------------------------ timeline

  private buildTimeline(duration: number, timeStep: number): number[] {
    const times: number[] = [];
    const add = (t: number) => { if (t >= 0 && t <= duration + 1e-9) times.push(Math.min(t, duration)); };
    const grid = (step: number) => { for (let k = 0; k * step <= duration + 1e-9; k++) add(k * step); };
    grid(timeStep);
    grid(this.reportStep);
    add(duration);
    this.attacks.forEach(attack => {
      add(attack.start);
      const end = attackEndTime(attack);
      if (Number.isFinite(end)) add(end);
    });
    (this.scenario.controllers || []).forEach(controller => {
      if (controller.type !== 'timed') return;
      const repeat = num(controller.repeat, 0);
      controller.events.forEach(event => {
        if (repeat > 0) for (let t = event.time; t <= duration; t += repeat) add(t); else add(event.time);
      });
    });
    this.scenario.nodes.forEach(node => {
      if (node.type === 'junction' && Array.isArray(node.pattern) && node.pattern.length > 1) grid(positive(node.patternStep, 3600));
    });
    times.sort((a, b) => a - b);
    const unique: number[] = [];
    times.forEach(t => { if (unique.length === 0 || t - unique[unique.length - 1] > 1e-6) unique.push(t); });
    return unique;
  }

  // ------------------------------------------------------------ one point in time

  /** Everything that happens at a point of the timeline, once the physics has reached it. */
  private arrive(t: number, initial: boolean): void {
    const active = this.attacks.filter(attack => isActive(attack, t));
    this.noteAttackEvents(t, active);

    // 1. Physical condition of the plant.
    const changed = applyPhysicalAttacks(this.network, active, this.stuckAt);
    this.attacks.forEach(attack => {
      if (attack.type !== 'chemical_interference' || !isInstant(attack) || Math.abs(attack.start - t) > 1e-9) return;
      const node = this.network.nodes[this.network.nodeIndex.get(attack.node) as number];
      if (node.kind === 'tank') this.quality.inject(node.index, attack.substance, attack.amount);
    });
    const demandChanged = this.setDemands(t);
    if (initial || changed || demandChanged) {
      // Flows respond at once to a hole, a blockage, a tripped pump or a change in demand.
      const info = this.solver.solve(0);
      this.noteSolve(t, info.converged, info.iterations, info.solves);
    }

    // 2. Instruments.
    this.control.sample(t, active);

    // 3. Controllers, then whatever reaches the actuators.
    const commands = this.control.scan(t, active, index => this.intended[index]);
    commands.forEach((value, index) => { this.intended[index] = this.limitSetting(this.network.links[index], value); });
    this.network.links.forEach(link => {
      if (link.kind === 'pump' || link.kind === 'valve') link.setting = this.intended[link.index];
    });
    active.forEach(attack => {
      if (attack.type !== 'command_injection') return;
      const link = this.network.links[this.network.linkIndex.get(attack.actuator) as number];
      link.setting = this.limitSetting(link, attack.value);
    });

    this.noteStateEvents(t);

    // 4. Record.
    const due = this.row * this.reportStep;
    if (Math.abs(t - due) < 1e-6 && this.row < this.results.times.length) this.record(t);
  }

  private limitSetting(link: Link, value: number): number {
    if (link.kind === 'valve' && link.flowMode) return Math.max(0, value);
    return clamp(value, 0, 1);
  }

  private record(t: number): void {
    const row = this.row++;
    const results = this.results;
    results.times[row] = t;
    this.channels.forEach(channel => {
      const value = channel.get();
      channel.data[row] = Number.isFinite(value) ? value : NaN;
    });
    this.attacks.forEach(attack => {
      if (!isLabelled(attack, t, this.reportStep)) return;
      results.labels.byAttack[attack.id][row] = 1;
      results.labels.any[row] = 1;
      results.labels[attackClass(attack)][row] = 1;
    });
    results.rows = this.row;
  }

  // ------------------------------------------------------------ physics

  /** Set what consumers ask for at time t. Returns true if any demand changed. */
  private setDemands(t: number): boolean {
    let changed = false;
    this.network.nodes.forEach(node => {
      if (node.demandLink < 0 || !node.spec || node.spec.type !== 'junction') return;
      const link = this.network.links[node.demandLink];
      const demand = num(node.spec.demand, 0) * demandFactor(node.spec, t);
      if (demand !== link.demand) changed = true;
      link.demand = demand;
    });
    return changed;
  }

  /** Advance the plant from t by up to dt; returns the time actually covered. */
  private advance(t: number, dt: number): number {
    const { network, solver, quality } = this;
    this.setDemands(t);

    // Actuators move toward their settings at their own pace.
    network.links.forEach(link => {
      if (link.kind === 'pump') {
        if (link.failed) link.speed = 0;
        else link.speed = approach(link.speed, link.setting, link.rampTime > 0 ? dt / link.rampTime : 1);
      } else if (link.kind === 'valve' && !link.stuck) {
        const target = link.flowMode ? 1 : link.setting;
        link.opening = approach(link.opening, target, link.strokeTime > 0 ? dt / link.strokeTime : 1);
      }
    });

    const injections = this.attacks.filter(attack => attack.type === 'chemical_interference') as ChemicalInterferenceAttack[];
    const nodeOf = (attack: ChemicalInterferenceAttack) => network.nodes[network.nodeIndex.get(attack.node) as number];
    injections.forEach(attack => {
      const node = nodeOf(attack);
      if (node.kind !== 'junction') return;
      const amount = injectedBetween(attack, t, t + dt);
      if (amount > 0) quality.inject(node.index, attack.substance, amount);
    });

    this.volumeBefore.set(solver.volume);
    const info = solver.solve(dt);
    const taken = info.dtTaken;
    this.noteSolve(t + taken, info.converged, info.iterations, info.solves);
    quality.advance(taken, this.volumeBefore, this.ambient);

    injections.forEach(attack => {
      const node = nodeOf(attack);
      if (node.kind !== 'tank' || isInstant(attack)) return;
      const amount = injectedBetween(attack, t, t + taken);
      if (amount > 0) quality.inject(node.index, attack.substance, amount);
    });

    // Running totals.
    const balance = this.results.balance;
    network.links.forEach(link => {
      if (link.kind === 'pump' && pumpIsRunning(link)) this.energy[link.index] += pumpShaftPower(link.curve!, link.speed, link.flow) * taken;
      if (link.kind === 'demand') {
        balance.delivered += link.flow * taken;
        balance.requested += link.demand * taken;
      }
      if (link.kind === 'leak') balance.leaked += link.flow * taken;
    });
    network.nodes.forEach(node => {
      if (node.kind !== 'reservoir') return;
      const out = solver.netOutflow[node.index] * taken;
      this.suppliedByNode[node.index] += out;
      balance.supplied += out;
    });
    this.results.stats.steps++;
    return taken;
  }

  private finish(): void {
    const balance = this.results.balance;
    balance.spilled = this.network.nodes.reduce((sum, node) => sum + this.solver.overflowVolume[node.index], 0);
    balance.stored = this.solver.storedVolume() - this.initialStorage;
    balance.error = balance.supplied - balance.delivered - balance.leaked - balance.spilled - balance.stored;
  }

  // ------------------------------------------------------------ events

  private noteSolve(t: number, converged: boolean, iterations: number, solves: number): void {
    const stats = this.results.stats;
    stats.solves += solves;
    stats.maxIterations = Math.max(stats.maxIterations, iterations);
    if (!converged) {
      stats.unconverged++;
      if (stats.unconverged <= 20) this.results.events.push({ time: t, kind: 'solver', where: '', message: 'The hydraulic solution did not fully converge at this step.' });
    }
  }

  private noteAttackEvents(t: number, active: AttackSpec[]): void {
    this.attacks.forEach(attack => {
      const name = attack.label || attack.id;
      if (isInstant(attack)) {
        if (Math.abs(attack.start - t) < 1e-9) this.results.events.push({ time: t, kind: 'attack', where: attack.id, message: `${name}: ${attack.type.replace('_', ' ')}.` });
        return;
      }
      this.edge(`attack:${attack.id}`, active.includes(attack), t, 'attack', attack.id, `${name} started.`, `${name} ended.`);
    });
  }

  private noteStateEvents(t: number): void {
    const { network, solver } = this;
    network.nodes.forEach(node => {
      if (node.kind === 'tank') {
        const i = node.index;
        this.edge(`empty:${node.id}`, solver.empty[i] === 1 || solver.volume[i] <= 1e-9 * node.tank!.maxVolume, t, 'tank', node.id, `${node.id} ran empty.`, `${node.id} has water again.`);
        this.edge(`spill:${node.id}`, solver.overflowRate[i] > 1e-9, t, 'tank', node.id, `${node.id} is overflowing.`, `${node.id} stopped overflowing.`);
      } else if (node.demandLink >= 0) {
        const link = network.links[node.demandLink];
        this.edge(`short:${node.id}`, link.demand > 1e-12 && link.flow < 0.98 * link.demand, t, 'supply', node.id, `${node.id} is not getting its full demand.`, `${node.id} is fully supplied again.`);
      }
    });
    network.links.forEach(link => {
      if (link.kind !== 'pump') return;
      this.edge(`cav:${link.id}`, this.cavitating(link), t, 'pump', link.id, `${link.id} is cavitating (too little suction pressure).`, `${link.id} stopped cavitating.`);
    });
  }

  private edge(key: string, now: boolean, t: number, kind: SimEvent['kind'], where: string, rising: string, falling: string): void {
    const before = this.flags.get(key) === true;
    if (now === before) return;
    this.flags.set(key, now);
    this.results.events.push({ time: t, kind, where, message: now ? rising : falling });
  }

  // ------------------------------------------------------------ measurement

  private cavitating(link: Link): boolean {
    if (!pumpIsRunning(link) || link.flow <= 1e-9) return false;
    const suction = this.network.nodes[link.from].head - link.elevation;
    return suction + NPSH_ATMOSPHERE < pumpNpshRequired(link.curve!, link.speed, link.flow);
  }

  /** A function that reads one physical quantity of one element. */
  reader(elementId: string, quantity: string): () => number {
    const { network, solver, quality } = this;
    const nodeIndex = network.nodeIndex.get(elementId);
    if (nodeIndex !== undefined) {
      const node = network.nodes[nodeIndex];
      const i = node.index;
      if (quantity in QUALITY_QUANTITIES && node.kind !== 'reservoir') return () => quality.value(i, quantity);
      const linkFlow = (index: number) => (index >= 0 && !network.links[index].closed ? Math.max(0, network.links[index].flow) : 0);
      const through = (inward: boolean) => () => {
        let total = 0;
        node.links.forEach(index => {
          if (index === node.leakLink || index === node.demandLink) return;
          const link = network.links[index];
          const into = link.to === i ? link.flow : -link.flow;
          if (inward ? into > 0 : into < 0) total += Math.abs(into);
        });
        return total;
      };
      switch (quantity) {
        case 'head': return () => node.head;
        case 'pressure': return () => node.head - node.elevation;
        case 'demand': return () => (node.demandLink >= 0 ? network.links[node.demandLink].demand : 0);
        case 'supplied': return node.kind === 'reservoir' ? () => this.suppliedByNode[i] : () => linkFlow(node.demandLink);
        case 'leak': return () => linkFlow(node.leakLink);
        case 'level': return () => solver.level[i];
        case 'volume': return () => solver.volume[i];
        case 'inflow': return through(true);
        case 'outflow': return node.kind === 'reservoir' ? () => solver.netOutflow[i] : through(false);
        case 'overflow': return () => solver.overflowRate[i];
        case 'spilled': return () => solver.overflowVolume[i];
      }
      return () => NaN;
    }
    const index = network.linkIndex.get(elementId);
    if (index === undefined) return () => NaN;
    const link = network.links[index];
    const from = network.nodes[link.from];
    const to = network.nodes[link.to];
    switch (quantity) {
      case 'flow': return () => link.flow;
      case 'velocity': return () => (link.area > 0 ? link.flow / link.area : 0);
      case 'headloss': return () => from.head - to.head;
      case 'setting': return () => link.setting;
      case 'opening': return () => link.opening;
      case 'speed': return () => (link.failed ? 0 : link.speed);
      case 'head': return () => (pumpIsRunning(link) ? Math.max(0, pumpHead(link.curve!, link.speed, Math.max(0, link.flow))) : 0);
      case 'power': return () => (pumpIsRunning(link) ? pumpShaftPower(link.curve!, link.speed, link.flow) / 1000 : 0);
      case 'energy': return () => this.energy[index] / 3.6e6;
      case 'efficiency': return () => (pumpIsRunning(link) ? pumpEfficiency(link.curve!, link.speed, link.flow) : 0);
      case 'suctionPressure': return () => from.head - link.elevation;
      case 'dischargePressure': return () => to.head - link.elevation;
      case 'running': return () => (pumpIsRunning(link) ? 1 : 0);
      case 'cavitating': return () => (this.cavitating(link) ? 1 : 0);
      case 'failed': return () => (link.failed ? 1 : 0);
    }
    return () => NaN;
  }

  private buildChannels(rows: number): void {
    const add = (column: Column, get: () => number) => this.channels.push({ column, get, data: new Float64Array(rows) });
    const elements: Array<{ id: string; type: string }> = [...this.scenario.nodes, ...this.scenario.links];
    elements.forEach(element => {
      const quantities = quantitiesFor(element.type);
      Object.keys(quantities).forEach(quantity => {
        const info = quantities[quantity];
        add({ key: `${element.id}.${quantity}`, owner: element.id, ownerType: element.type, quantity, label: info.label, unit: info.unit, group: 'state' }, this.reader(element.id, quantity));
      });
    });
    const typeOf = new Map(elements.map(element => [element.id, element.type] as [string, string]));
    this.control.sensors.forEach(sensor => {
      const spec = sensor.spec;
      const info = quantitiesFor(typeOf.get(spec.element) || '')[spec.quantity] || { label: spec.quantity, unit: '' };
      const label = `${spec.element} ${info.label.toLowerCase()}`;
      add({ key: `${spec.id}.reading`, owner: spec.id, ownerType: 'sensor', quantity: 'reading', label: `${label} (reported)`, unit: info.unit, group: 'reading' }, () => sensor.reported);
      add({ key: `${spec.id}.true`, owner: spec.id, ownerType: 'sensor', quantity: 'true', label: `${label} (true)`, unit: info.unit, group: 'truth' }, () => sensor.truth);
    });
    this.control.controllers.forEach(controller => {
      add({ key: `${controller.spec.id}.output`, owner: controller.spec.id, ownerType: 'controller', quantity: 'output', label: `Command to ${controller.spec.actuator}`, unit: '', group: 'command' }, () => controller.output);
    });
  }

  /** Nodes and links of the running plant, for a live display. */
  node(id: string): Node | undefined {
    const index = this.network.nodeIndex.get(id);
    return index === undefined ? undefined : this.network.nodes[index];
  }

  link(id: string): Link | undefined {
    const index = this.network.linkIndex.get(id);
    return index === undefined ? undefined : this.network.links[index];
  }
}

function approach(value: number, target: number, maxChange: number): number {
  if (!Number.isFinite(target)) return target > 0 ? 1 : 0;
  const change = target - value;
  if (Math.abs(change) <= maxChange) return target;
  return value + Math.sign(change) * maxChange;
}

/** Run a scenario from start to finish. Throws ScenarioError if it is not valid. */
export function simulate(scenario: Scenario): Results {
  return new Simulation(scenario).run();
}
