// Tables and datasets.
//
// A table is the record of one run as rows and columns. A dataset is many
// runs of the same plant, with and without attacks, each varied a little, in
// one table with labels: the material for training and testing detectors.

import { Random } from './control.js';
import { ATTACK_CLASSES, AttackSpec, Scenario, clamp, deepCopy, num, positive } from './scenario.js';
import { Results, Simulation } from './simulation.js';

export interface Table {
  header: string[];
  rows: Array<Array<number | string>>;
}

export interface TableOptions {
  /**
   * readings: what the control system sees (sensor readings and commands).
   * all: also the true value behind each sensor and the full physical state.
   */
  columns?: 'readings' | 'all';
  /** Leading columns to put in front of every row. */
  prefix?: Record<string, number | string>;
}

function round(value: number): number | string {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return 0;
  return Number(value.toPrecision(7));
}

/** The record of a run as a table, one row per report time, with attack labels. */
export function resultsTable(results: Results, options: TableOptions = {}): Table {
  const all = options.columns === 'all';
  const columns = results.columns.filter(column => all || column.group === 'reading' || column.group === 'command');
  const name = (key: string, group: string) => (group === 'reading' ? key.replace(/\.reading$/, '') : key);
  const prefix = options.prefix || {};
  const attackIds = Object.keys(results.labels.byAttack);
  const header = [...Object.keys(prefix), 'time', ...columns.map(column => name(column.key, column.group)), 'attack', 'attack_class', 'attack_ids'];
  const rows: Table['rows'] = [];
  for (let r = 0; r < results.rows; r++) {
    const classes = ATTACK_CLASSES.filter(c => results.labels[c][r] === 1);
    const ids = attackIds.filter(id => results.labels.byAttack[id][r] === 1);
    rows.push([
      ...Object.values(prefix),
      round(results.times[r]),
      ...columns.map(column => round(results.series[column.key][r])),
      results.labels.any[r],
      classes.length > 0 ? classes.join('+') : 'none',
      ids.join(';')
    ]);
  }
  return { header, rows };
}

export function toCSV(table: Table): string {
  const cell = (value: number | string) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [table.header, ...table.rows].map(row => row.map(cell).join(',')).join('\n') + '\n';
}

export interface DatasetOptions {
  /** Runs with the scenario's attacks. Default 10. */
  attackRuns?: number;
  /** Runs with no attacks. Default 2. */
  normalRuns?: number;
  seed?: number;
  /** Move each attack to a random time in the run. Default true. */
  shiftAttacks?: boolean;
  /** Relative spread of attack durations and magnitudes (0.2 means ±20 %). Default 0.2. */
  attackSpread?: number;
  /** Relative spread of initial tank levels. Default 0.1. */
  levelSpread?: number;
  /** Relative spread of demands. Default 0.1. */
  demandSpread?: number;
  columns?: 'readings' | 'all';
  onProgress?: (done: number, total: number) => void;
}

export interface DatasetRun {
  run: number;
  kind: 'normal' | 'attack';
  seed: number;
  attacks: Array<{ id: string; type: string; start: number; duration: number | null }>;
}

export interface Dataset extends Table {
  runs: DatasetRun[];
}

/** One randomised variant of a scenario. */
export function varyScenario(scenario: Scenario, random: Random, options: DatasetOptions, withAttacks: boolean): Scenario {
  const copy = deepCopy(scenario);
  const spread = (amount: number) => 1 + amount * (2 * random.next() - 1);
  const levelSpread = Math.max(0, num(options.levelSpread, 0.1));
  const demandSpread = Math.max(0, num(options.demandSpread, 0.1));
  const attackSpread = Math.max(0, num(options.attackSpread, 0.2));
  const duration = copy.simulation.duration;
  const grid = positive(copy.simulation.timeStep, 60);

  copy.simulation.seed = Math.floor(random.next() * 2147483647) + 1;
  copy.nodes.forEach(node => {
    if (node.type === 'tank') node.level = clamp(node.level * spread(levelSpread), 0, node.height);
    if (node.type === 'junction' && typeof node.demand === 'number') node.demand = node.demand * spread(demandSpread);
  });
  if (!withAttacks) {
    copy.attacks = [];
    return copy;
  }
  (copy.attacks || []).forEach((attack: AttackSpec) => {
    if (typeof attack.duration === 'number') attack.duration = Math.max(grid, Math.round(attack.duration * spread(attackSpread) / grid) * grid);
    if (options.shiftAttacks !== false) {
      const latest = Math.max(0, duration - num(attack.duration, 0));
      attack.start = Math.round(random.next() * latest / grid) * grid;
    }
    switch (attack.type) {
      case 'data_poisoning':
        if (typeof attack.value === 'number' && (attack.mode === 'offset' || attack.mode === 'drift' || attack.mode === 'noise' || attack.mode === 'constant')) attack.value *= spread(attackSpread);
        break;
      case 'leak': attack.diameter *= spread(attackSpread); break;
      case 'pipe_blockage': attack.fraction = clamp(attack.fraction * spread(attackSpread), 0, 1); break;
      case 'chemical_interference': attack.amount *= spread(attackSpread); break;
    }
  });
  return copy;
}

/** Simulate many varied runs of a scenario and gather them in one labelled table. */
export function generateDataset(scenario: Scenario, options: DatasetOptions = {}): Dataset {
  const attackRuns = Math.max(0, Math.floor(num(options.attackRuns, 10)));
  const normalRuns = Math.max(0, Math.floor(num(options.normalRuns, 2)));
  const hasAttacks = (scenario.attacks || []).length > 0;
  const plan: Array<'normal' | 'attack'> = [];
  for (let i = 0; i < normalRuns; i++) plan.push('normal');
  if (hasAttacks) for (let i = 0; i < attackRuns; i++) plan.push('attack');

  const random = new Random(num(options.seed, 1));
  const dataset: Dataset = { header: [], rows: [], runs: [] };
  plan.forEach((kind, index) => {
    const variant = varyScenario(scenario, random, options, kind === 'attack');
    const results = new Simulation(variant).run();
    const table = resultsTable(results, { columns: options.columns, prefix: { run: index + 1 } });
    if (dataset.header.length === 0) dataset.header = table.header;
    table.rows.forEach(row => dataset.rows.push(row));
    dataset.runs.push({
      run: index + 1, kind, seed: variant.simulation.seed as number,
      attacks: (variant.attacks || []).map(attack => ({ id: attack.id, type: attack.type, start: attack.start, duration: typeof attack.duration === 'number' ? attack.duration : null }))
    });
    if (options.onProgress) options.onProgress(index + 1, plan.length);
  });
  return dataset;
}
