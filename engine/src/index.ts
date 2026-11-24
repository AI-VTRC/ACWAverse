// ACWAverse simulation engine: public interface.

export * from './scenario.js';
export { Simulation, simulate } from './simulation.js';
export type { Column, Results, SimEvent } from './simulation.js';
export { generateDataset, resultsTable, toCSV, varyScenario } from './dataset.js';
export type { Dataset, DatasetOptions, DatasetRun, Table, TableOptions } from './dataset.js';
export { buildNetwork, pumpCurve, tankAreaAt, tankGeometry, tankLevelAt, tankVolumeAt, hazenWilliamsResistance } from './network.js';
export type { Link, Network, Node, PumpCurve, TankGeometry } from './network.js';
export { blockageLossCoefficient, darcyFrictionFactor, pumpEfficiency, pumpHead, pumpNpshRequired, pumpShaftPower, valveLossCoefficient } from './elements.js';
export { DEFAULT_CHEMISTRY, DEFAULT_QUALITY, oxygenSaturation, phOf, ticFor } from './quality.js';
export { isActive, isInstant } from './attacks.js';
export { Random } from './control.js';
