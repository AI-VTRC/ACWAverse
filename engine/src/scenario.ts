// The scenario document: everything needed to run one simulation.
//
// A water system is described the way hydraulic engineers draw it: NODES
// (junctions, tanks, reservoirs) joined by LINKS (pipes, pumps, valves). Every
// link has a start node (`from`) and an end node (`to`). For a pipe that only
// fixes the sign convention of its flow. For a pump it is physical: `from` is
// the suction side and `to` is the discharge side. For a valve `from` is the
// inlet.
//
// On top of the physical system sits the control system: SENSORS measure a
// quantity on an element, CONTROLLERS read sensors and command actuators
// (pumps and valves). ATTACKS act on a sensor, a command, a controller or a
// physical element.
//
// All quantities are SI: m, m³, m³/s, s, °C, mg/L. Pressure is in metres of
// water column.

export const GRAVITY = 9.80665;
export const WATER_DENSITY = 998.2;        // kg/m³ at 20 °C
export const KINEMATIC_VISCOSITY = 1.004e-6; // m²/s at 20 °C

export const FORMAT = 'acwaverse/2';

// ---------------------------------------------------------------- quality

/** Water quality of a body of water. Missing values take the network default. */
export interface QualitySpec {
  /** °C */
  temperature?: number;
  /** Free chlorine, mg/L as Cl2. */
  chlorine?: number;
  ph?: number;
  /** Total alkalinity, mg/L as CaCO3. */
  alkalinity?: number;
  /** Dissolved oxygen, mg/L. */
  oxygen?: number;
  /** Biochemical oxygen demand, mg/L O2. */
  bod?: number;
  /** Ammonia nitrogen, mg/L N. */
  ammonia?: number;
  /** Nitrate nitrogen, mg/L N. */
  nitrate?: number;
  /** Conservative tracer or contaminant, mg/L. */
  tracer?: number;
}

/** Reaction-rate settings. Rates are per day at 20 °C unless noted. */
export interface ChemistrySpec {
  /** Bulk free-chlorine decay (1/day). */
  chlorineBulkDecay?: number;
  /** Chlorine wall-reaction velocity in pipes (m/day). */
  chlorineWallDecay?: number;
  /** BOD oxidation rate (1/day). */
  bodDecay?: number;
  /** Nitrification rate (1/day). */
  nitrification?: number;
  /** Dissolved oxygen at which oxidation runs at half speed (mg/L). */
  oxygenHalfSaturation?: number;
  /** Gas-transfer velocity at open tank surfaces (m/day). */
  gasTransfer?: number;
  /** Atmospheric CO2 (ppm). */
  atmosphericCO2?: number;
  /** Tank heat exchange with ambient air (1/day). */
  heatExchange?: number;
  /** Temperature coefficient of the biochemical rates. */
  theta?: number;
}

// ---------------------------------------------------------------- nodes

interface NodeBase {
  id: string;
  /** Diagram position (m or arbitrary units; not used by the physics). */
  x?: number;
  y?: number;
  label?: string;
}

export interface JunctionSpec extends NodeBase {
  type: 'junction';
  /** Elevation of the node (m). */
  elevation?: number;
  /** Base demand (m³/s). */
  demand?: number;
  /** Demand multipliers, one per pattern step, repeating. */
  pattern?: number[];
  /** Length of a pattern step (s). Default 3600. */
  patternStep?: number;
  /** Pressure at which the full demand is delivered (m). Default 10. */
  requiredPressure?: number;
  /** Pressure below which nothing is delivered (m). Default 0. */
  minPressure?: number;
  quality?: QualitySpec;
}

export interface TankSpec extends NodeBase {
  type: 'tank';
  /** Elevation of the tank floor (m). */
  elevation?: number;
  shape?: 'cylinder' | 'box' | 'sphere';
  /** Cylinder or sphere diameter (m). */
  diameter?: number;
  /** Box plan dimensions (m). */
  width?: number;
  length?: number;
  /** Maximum water level above the floor (m). */
  height: number;
  /** Initial water level above the floor (m). */
  level: number;
  /** What happens at the maximum level. Default 'spill'. */
  whenFull?: 'spill' | 'closeInlet';
  quality?: QualitySpec;
}

export interface ReservoirSpec extends NodeBase {
  type: 'reservoir';
  /** Water surface elevation (m). Does not change. */
  head: number;
  quality?: QualitySpec;
}

export type NodeSpec = JunctionSpec | TankSpec | ReservoirSpec;

// ---------------------------------------------------------------- links

interface LinkBase {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface PipeSpec extends LinkBase {
  type: 'pipe';
  /** m */
  length: number;
  /** Internal diameter (m). */
  diameter: number;
  friction?: 'hazen-williams' | 'darcy-weisbach';
  /** Hazen-Williams C (default 130), or absolute roughness in mm for Darcy-Weisbach (default 0.26). */
  roughness?: number;
  /** Sum of minor-loss coefficients. */
  minorLoss?: number;
  /** Allow flow only from `from` to `to`. */
  checkValve?: boolean;
  closed?: boolean;
}

export interface PumpSpec extends LinkBase {
  type: 'pump';
  /** Head at zero flow, full speed (m). */
  shutoffHead: number;
  /** Flow at zero head, full speed (m³/s). */
  maxFlow: number;
  /** Optional full-speed curve h = a0 + a1 q + a2 q². Overrides the two above. */
  curve?: [number, number, number];
  /** Initial speed setting, 0 (off) to 1 (full speed). Default 1. */
  speed?: number;
  /** Efficiency at the best-efficiency point (0-1). Default 0.75. */
  efficiency?: number;
  /** Flow at the best-efficiency point (m³/s). Default 0.6 × maxFlow. */
  bepFlow?: number;
  /** Seconds from standstill to full speed. Default 5. */
  rampTime?: number;
  /** Required net positive suction head at full speed (m). Default 3. */
  npshRequired?: number;
  /** Discharge check valve. Default true. */
  checkValve?: boolean;
  /** Elevation of the pump (m). Defaults to that of its suction node. */
  elevation?: number;
}

export interface ValveSpec extends LinkBase {
  type: 'valve';
  kind?: 'gate' | 'globe' | 'butterfly' | 'ball' | 'linear';
  /** Bore (m). */
  diameter: number;
  /** 'position': the setting is the opening (0-1). 'flow': the setting is a flow limit (m³/s). */
  mode?: 'position' | 'flow';
  /** Initial setting. Default: fully open. */
  setting?: number;
  /** Loss coefficient fully open. Default depends on kind. */
  fullOpenK?: number;
  /** Seconds for a full stroke. Default 10. */
  strokeTime?: number;
}

export type LinkSpec = PipeSpec | PumpSpec | ValveSpec;

// ---------------------------------------------------------------- control system

export interface SensorSpec {
  id: string;
  /** Id of the node or link the instrument is mounted on. */
  element: string;
  /** Measured quantity; see QUANTITIES for what each element offers. */
  quantity: string;
  /** Standard deviation of measurement noise, in the unit of the quantity. */
  noise?: number;
  label?: string;
}

interface ControllerBase {
  id: string;
  enabled?: boolean;
  label?: string;
}

/**
 * Two-position control with a dead band, the usual way a pump follows a tank.
 * 'fill': switch on below `low`, off above `high`.
 * 'drain': switch on above `high`, off below `low`.
 */
export interface OnOffController extends ControllerBase {
  type: 'onoff';
  sensor: string;
  actuator: string;
  action: 'fill' | 'drain';
  low: number;
  high: number;
  /** Setting to command when on (default 1) and off (default 0). */
  onValue?: number;
  offValue?: number;
}

/** Timed control action: commands a setting at given times, optionally repeating. */
export interface TimedController extends ControllerBase {
  type: 'timed';
  actuator: string;
  events: Array<{ time: number; value: number }>;
  /** Repeat period (s), e.g. 86400 for a daily schedule. */
  repeat?: number;
}

/**
 * Conditional action: while the reading satisfies the condition, command
 * `value`; otherwise `otherwise`, if given.
 */
export interface ConditionalController extends ControllerBase {
  type: 'conditional';
  sensor: string;
  operator: '>' | '<' | '>=' | '<=';
  threshold: number;
  actuator: string;
  value: number;
  otherwise?: number;
}

/** Proportional-integral-derivative loop driving a pump speed or valve setting. */
export interface PidController extends ControllerBase {
  type: 'pid';
  sensor: string;
  actuator: string;
  setpoint: number;
  kp: number;
  /** Integral gain (per second). */
  ki?: number;
  /** Derivative gain (seconds). */
  kd?: number;
  /** Output limits. Default 0 and 1. */
  min?: number;
  max?: number;
  /** Reverse acting: raise the output when the reading is above the setpoint. */
  reverse?: boolean;
}

export type ControllerSpec = OnOffController | TimedController | ConditionalController | PidController;

// ---------------------------------------------------------------- attacks

interface AttackBase {
  id: string;
  /** Start time (s). */
  start: number;
  /** Duration (s). Omitted: lasts to the end of the run (or is instantaneous, for chemical interference). */
  duration?: number;
  label?: string;
}

/**
 * Data poisoning: falsify what a sensor reports. The physical value is
 * untouched; conditional actions and the display see the false one.
 */
export interface DataPoisoningAttack extends AttackBase {
  type: 'data_poisoning';
  sensor: string;
  /**
   * constant: report `value`. offset: add `value`. scale: multiply by `value`.
   * freeze: keep reporting the reading at the start. drift: add `value` per hour.
   * noise: add random noise of standard deviation `value`.
   * replay: report what the sensor read `value` seconds earlier.
   */
  mode: 'constant' | 'offset' | 'scale' | 'freeze' | 'drift' | 'noise' | 'replay';
  value?: number;
}

/** Override the command reaching an actuator; controllers are ignored meanwhile. */
export interface CommandInjectionAttack extends AttackBase {
  type: 'command_injection';
  actuator: string;
  value: number;
}

/** Disable a controller or change its parameters. */
export interface ControllerTamperAttack extends AttackBase {
  type: 'controller_tamper';
  controller: string;
  disable?: boolean;
  /** Parameter overrides, e.g. { "high": 9.5 }. */
  set?: Record<string, number>;
}

export interface PumpFailureAttack extends AttackBase {
  type: 'pump_failure';
  pump: string;
}

/** The valve stops responding, staying where it is or at `position`. */
export interface ValveStuckAttack extends AttackBase {
  type: 'valve_stuck';
  valve: string;
  position?: number;
}

/** A hole at a junction (pipe burst) or in a tank floor; discharge follows the orifice law. */
export interface LeakAttack extends AttackBase {
  type: 'leak';
  node: string;
  /** Equivalent hole diameter (m). */
  diameter: number;
}

/** Partial or full obstruction of a pipe. */
export interface PipeBlockageAttack extends AttackBase {
  type: 'pipe_blockage';
  pipe: string;
  /** Fraction of the flow area blocked, 0-1. */
  fraction: number;
}

/** Chemical interference: a substance added at a node, at once or evenly over the duration. */
export interface ChemicalInterferenceAttack extends AttackBase {
  type: 'chemical_interference';
  node: string;
  substance: 'chlorine' | 'acid' | 'base' | 'ammonia' | 'bod' | 'nitrate' | 'tracer' | 'dechlorinator' | 'sulfite';
  /**
   * Total amount: grams, except acid and base (moles of H+ / OH-),
   * dechlorinator (grams of chlorine it neutralises) and sulfite, an oxygen
   * scavenger (grams of dissolved oxygen it removes).
   */
  amount: number;
}

export type AttackSpec =
  | DataPoisoningAttack | CommandInjectionAttack | ControllerTamperAttack
  | PumpFailureAttack | ValveStuckAttack | LeakAttack | PipeBlockageAttack | ChemicalInterferenceAttack;

export type AttackType = AttackSpec['type'];

export const ATTACK_TYPES: readonly AttackType[] = [
  'data_poisoning', 'command_injection', 'controller_tamper',
  'pump_failure', 'valve_stuck', 'leak', 'pipe_blockage', 'chemical_interference'
];

/**
 * The three attack families: data poisoning (false data in the control
 * system), physical damage (to equipment) and chemical interference (with the
 * water). Injected commands and tampered controllers falsify data inside the
 * control system, so they are counted with data poisoning.
 */
export type AttackClass = 'data_poisoning' | 'physical_damage' | 'chemical_interference';

export const ATTACK_CLASSES: readonly AttackClass[] = ['data_poisoning', 'physical_damage', 'chemical_interference'];

export const ATTACK_CLASS: Record<AttackType, AttackClass> = {
  data_poisoning: 'data_poisoning', command_injection: 'data_poisoning', controller_tamper: 'data_poisoning',
  pump_failure: 'physical_damage', valve_stuck: 'physical_damage', leak: 'physical_damage', pipe_blockage: 'physical_damage',
  chemical_interference: 'chemical_interference'
};

// ---------------------------------------------------------------- the document

export interface SimulationSpec {
  /** s */
  duration: number;
  /** Hydraulic and quality time step (s). */
  timeStep: number;
  /** Interval between recorded rows (s). Default: timeStep. */
  reportStep?: number;
  /** °C */
  ambientTemperature?: number;
  /** Seed for sensor noise. */
  seed?: number;
}

export interface Scenario {
  format?: string;
  name: string;
  description?: string;
  nodes: NodeSpec[];
  links: LinkSpec[];
  sensors?: SensorSpec[];
  controllers?: ControllerSpec[];
  attacks?: AttackSpec[];
  simulation: SimulationSpec;
  /** Default water quality for nodes that do not state their own. */
  quality?: QualitySpec;
  chemistry?: ChemistrySpec;
}

// ---------------------------------------------------------------- quantities

export interface QuantityInfo {
  label: string;
  unit: string;
}

const Q = (label: string, unit: string): QuantityInfo => ({ label, unit });

export const QUALITY_QUANTITIES: Record<string, QuantityInfo> = {
  temperature: Q('Temperature', '°C'),
  chlorine: Q('Free chlorine', 'mg/L'),
  ph: Q('pH', ''),
  alkalinity: Q('Alkalinity', 'mg/L CaCO3'),
  oxygen: Q('Dissolved oxygen', 'mg/L'),
  bod: Q('BOD', 'mg/L'),
  ammonia: Q('Ammonia', 'mg/L N'),
  nitrate: Q('Nitrate', 'mg/L N'),
  tracer: Q('Tracer', 'mg/L'),
  age: Q('Water age', 'h')
};

/** Every physical quantity the simulator computes, by element type. */
export const QUANTITIES: Record<NodeSpec['type'] | LinkSpec['type'], Record<string, QuantityInfo>> = {
  junction: {
    pressure: Q('Pressure', 'm'),
    head: Q('Head', 'm'),
    demand: Q('Demand requested', 'm³/s'),
    supplied: Q('Demand supplied', 'm³/s'),
    leak: Q('Leak flow', 'm³/s'),
    ...QUALITY_QUANTITIES
  },
  tank: {
    level: Q('Level', 'm'),
    volume: Q('Stored volume', 'm³'),
    head: Q('Head', 'm'),
    inflow: Q('Inflow', 'm³/s'),
    outflow: Q('Outflow', 'm³/s'),
    overflow: Q('Overflow', 'm³/s'),
    spilled: Q('Spilled volume', 'm³'),
    leak: Q('Leak flow', 'm³/s'),
    ...QUALITY_QUANTITIES
  },
  reservoir: {
    head: Q('Head', 'm'),
    outflow: Q('Net outflow', 'm³/s'),
    supplied: Q('Volume supplied', 'm³')
  },
  pipe: {
    flow: Q('Flow', 'm³/s'),
    velocity: Q('Velocity', 'm/s'),
    headloss: Q('Head loss', 'm')
  },
  pump: {
    flow: Q('Flow', 'm³/s'),
    head: Q('Head added', 'm'),
    speed: Q('Speed', '0-1'),
    setting: Q('Speed setting', '0-1'),
    power: Q('Shaft power', 'kW'),
    energy: Q('Energy used', 'kWh'),
    efficiency: Q('Efficiency', '0-1'),
    suctionPressure: Q('Suction pressure', 'm'),
    dischargePressure: Q('Discharge pressure', 'm'),
    running: Q('Running', '0/1'),
    cavitating: Q('Cavitating', '0/1'),
    failed: Q('Failed', '0/1')
  },
  valve: {
    flow: Q('Flow', 'm³/s'),
    opening: Q('Opening', '0-1'),
    setting: Q('Setting', ''),
    headloss: Q('Head loss', 'm'),
    velocity: Q('Velocity', 'm/s')
  }
};

export function quantitiesFor(type: string): Record<string, QuantityInfo> {
  return (QUANTITIES as Record<string, Record<string, QuantityInfo>>)[type] || {};
}

// ---------------------------------------------------------------- helpers

export function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function attackEnd(attack: AttackSpec): number {
  return typeof attack.duration === 'number' && attack.duration > 0 ? attack.start + attack.duration : Number.POSITIVE_INFINITY;
}

// ---------------------------------------------------------------- validation

export interface Issue {
  level: 'error' | 'warning';
  /** Id of the element concerned, or '' for the document as a whole. */
  where: string;
  message: string;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPositive = (v: unknown): v is number => isNumber(v) && v > 0;
const isNonNegative = (v: unknown): v is number => isNumber(v) && v >= 0;
const isFraction = (v: unknown): v is number => isNumber(v) && v >= 0 && v <= 1;

/** Check a scenario. A scenario with no errors can be simulated. */
export function validateScenario(scenario: Scenario): Issue[] {
  const issues: Issue[] = [];
  const error = (where: string, message: string) => issues.push({ level: 'error', where, message });
  const warning = (where: string, message: string) => issues.push({ level: 'warning', where, message });

  if (!scenario || typeof scenario !== 'object') return [{ level: 'error', where: '', message: 'The scenario is not an object.' }];
  const nodes = Array.isArray(scenario.nodes) ? scenario.nodes : [];
  const links = Array.isArray(scenario.links) ? scenario.links : [];
  const sensors = scenario.sensors || [];
  const controllers = scenario.controllers || [];
  const attacks = scenario.attacks || [];
  if (!Array.isArray(scenario.nodes)) error('', 'nodes must be a list.');
  if (!Array.isArray(scenario.links)) error('', 'links must be a list.');

  // identifiers are unique across the whole document
  const kinds = new Map<string, string>();
  const claim = (id: unknown, kind: string): id is string => {
    if (typeof id !== 'string' || id.trim() === '') {
      error('', `A ${kind} has no id.`);
      return false;
    }
    if (kinds.has(id)) {
      error(id, `The id "${id}" is used more than once.`);
      return false;
    }
    kinds.set(id, kind);
    return true;
  };

  const nodeTypes = new Map<string, NodeSpec['type']>();
  nodes.forEach(node => {
    if (!node || !claim(node.id, 'node')) return;
    nodeTypes.set(node.id, node.type);
    switch (node.type) {
      case 'junction':
        if (node.elevation !== undefined && !isNumber(node.elevation)) error(node.id, 'Elevation must be a number.');
        if (node.demand !== undefined && !isNonNegative(node.demand)) error(node.id, 'Demand must be zero or more.');
        if (node.pattern !== undefined && (!Array.isArray(node.pattern) || node.pattern.some(v => !isNonNegative(v)))) error(node.id, 'Demand pattern must be a list of non-negative multipliers.');
        if (node.patternStep !== undefined && !isPositive(node.patternStep)) error(node.id, 'Pattern step must be greater than zero.');
        if (isNumber(node.requiredPressure) && node.requiredPressure <= num(node.minPressure, 0)) error(node.id, 'Required pressure must exceed the minimum pressure.');
        break;
      case 'tank': {
        const shape = node.shape || 'cylinder';
        if (!['cylinder', 'box', 'sphere'].includes(shape)) error(node.id, `Unknown tank shape "${shape}".`);
        if (shape === 'box') {
          if (!isPositive(node.width) || !isPositive(node.length)) error(node.id, 'A box tank needs a width and a length greater than zero.');
        } else if (!isPositive(node.diameter)) {
          error(node.id, 'Tank diameter must be greater than zero.');
        }
        if (!isPositive(node.height)) error(node.id, 'Tank height (maximum level) must be greater than zero.');
        else if (shape === 'sphere' && isPositive(node.diameter) && node.height > node.diameter + 1e-9) error(node.id, 'A spherical tank cannot be filled above its diameter.');
        if (!isNonNegative(node.level)) error(node.id, 'Initial level must be zero or more.');
        else if (isPositive(node.height) && node.level > node.height + 1e-9) error(node.id, 'Initial level is above the tank height.');
        if (node.whenFull !== undefined && node.whenFull !== 'spill' && node.whenFull !== 'closeInlet') error(node.id, 'whenFull must be "spill" or "closeInlet".');
        break;
      }
      case 'reservoir':
        if (!isNumber(node.head)) error(node.id, 'Reservoir head must be a number.');
        break;
      default:
        error((node as NodeBase).id, `Unknown node type "${String((node as { type?: unknown }).type)}".`);
    }
  });

  const linkTypes = new Map<string, LinkSpec['type']>();
  const degree = new Map<string, number>();
  links.forEach(link => {
    if (!link || !claim(link.id, 'link')) return;
    linkTypes.set(link.id, link.type);
    let endsOk = true;
    (['from', 'to'] as const).forEach(end => {
      if (!nodeTypes.has(link[end])) {
        error(link.id, `${end === 'from' ? 'Start' : 'End'} node "${String(link[end])}" does not exist.`);
        endsOk = false;
      }
    });
    if (endsOk && link.from === link.to) {
      error(link.id, 'A link cannot start and end at the same node.');
      endsOk = false;
    }
    if (endsOk) {
      degree.set(link.from, (degree.get(link.from) || 0) + 1);
      degree.set(link.to, (degree.get(link.to) || 0) + 1);
    }
    switch (link.type) {
      case 'pipe':
        if (!isPositive(link.length)) error(link.id, 'Pipe length must be greater than zero.');
        if (!isPositive(link.diameter)) error(link.id, 'Pipe diameter must be greater than zero.');
        if (link.friction !== undefined && link.friction !== 'hazen-williams' && link.friction !== 'darcy-weisbach') error(link.id, `Unknown friction model "${String(link.friction)}".`);
        if (link.roughness !== undefined && !isPositive(link.roughness)) error(link.id, 'Roughness must be greater than zero.');
        if (link.minorLoss !== undefined && !isNonNegative(link.minorLoss)) error(link.id, 'Minor-loss coefficient must be zero or more.');
        break;
      case 'pump':
        if (link.curve !== undefined) {
          const c = link.curve;
          if (!Array.isArray(c) || c.length !== 3 || c.some(v => !isNumber(v)) || !(c[0] > 0) || !(c[2] < 0)) error(link.id, 'A pump curve needs three coefficients with a0 > 0 and a2 < 0.');
        } else {
          if (!isPositive(link.shutoffHead)) error(link.id, 'Shut-off head must be greater than zero.');
          if (!isPositive(link.maxFlow)) error(link.id, 'Maximum flow must be greater than zero.');
        }
        if (link.speed !== undefined && !isFraction(link.speed)) error(link.id, 'Speed setting must be between 0 and 1.');
        if (link.efficiency !== undefined && !(isNumber(link.efficiency) && link.efficiency > 0 && link.efficiency <= 1)) error(link.id, 'Efficiency must be between 0 and 1.');
        if (link.rampTime !== undefined && !isNonNegative(link.rampTime)) error(link.id, 'Ramp time must be zero or more.');
        break;
      case 'valve':
        if (!isPositive(link.diameter)) error(link.id, 'Valve diameter must be greater than zero.');
        if (link.kind !== undefined && !['gate', 'globe', 'butterfly', 'ball', 'linear'].includes(link.kind)) error(link.id, `Unknown valve kind "${String(link.kind)}".`);
        if (link.mode !== undefined && link.mode !== 'position' && link.mode !== 'flow') error(link.id, 'Valve mode must be "position" or "flow".');
        if (link.setting !== undefined) {
          if (link.mode === 'flow' ? !isNonNegative(link.setting) : !isFraction(link.setting)) error(link.id, link.mode === 'flow' ? 'Flow setting must be zero or more.' : 'Valve opening must be between 0 and 1.');
        }
        if (link.strokeTime !== undefined && !isNonNegative(link.strokeTime)) error(link.id, 'Stroke time must be zero or more.');
        break;
      default:
        error((link as LinkBase).id, `Unknown link type "${String((link as { type?: unknown }).type)}".`);
    }
  });

  nodes.forEach(node => {
    if (node && typeof node.id === 'string' && nodeTypes.get(node.id) === node.type && !degree.get(node.id)) warning(node.id, 'Not connected to anything.');
  });
  if (nodes.length > 0 && !nodes.some(n => n && (n.type === 'tank' || n.type === 'reservoir'))) warning('', 'The network has no tank or reservoir, so nothing can supply water.');

  const elementType = (id: string): string | undefined => nodeTypes.get(id) || linkTypes.get(id);
  const isActuator = (id: string) => linkTypes.get(id) === 'pump' || linkTypes.get(id) === 'valve';

  const sensorIds = new Set<string>();
  sensors.forEach(sensor => {
    if (!sensor || !claim(sensor.id, 'sensor')) return;
    sensorIds.add(sensor.id);
    const type = elementType(sensor.element);
    if (!type) error(sensor.id, `Element "${String(sensor.element)}" does not exist.`);
    else if (!(sensor.quantity in quantitiesFor(type))) error(sensor.id, `A ${type} has no quantity "${String(sensor.quantity)}".`);
    if (sensor.noise !== undefined && !isNonNegative(sensor.noise)) error(sensor.id, 'Noise must be zero or more.');
  });

  const controllerIds = new Set<string>();
  controllers.forEach(controller => {
    if (!controller || !claim(controller.id, 'controller')) return;
    controllerIds.add(controller.id);
    const id = controller.id;
    if (!isActuator(controller.actuator)) error(id, `Actuator "${String(controller.actuator)}" is not a pump or valve.`);
    if (controller.type !== 'timed' && !sensorIds.has(controller.sensor)) error(id, `Sensor "${String(controller.sensor)}" does not exist.`);
    switch (controller.type) {
      case 'onoff':
        if (controller.action !== 'fill' && controller.action !== 'drain') error(id, 'Action must be "fill" or "drain".');
        if (!isNumber(controller.low) || !isNumber(controller.high)) error(id, 'Low and high limits must be numbers.');
        else if (controller.low >= controller.high) error(id, 'The low limit must be below the high limit.');
        break;
      case 'timed':
        if (!Array.isArray(controller.events) || controller.events.length === 0) error(id, 'A timed control action needs at least one event.');
        else if (controller.events.some(e => !e || !isNonNegative(e.time) || !isNonNegative(e.value))) error(id, 'Timed control actions need a time and a value of zero or more.');
        if (controller.repeat !== undefined && !isPositive(controller.repeat)) error(id, 'Repeat period must be greater than zero.');
        break;
      case 'conditional':
        if (!['>', '<', '>=', '<='].includes(controller.operator)) error(id, `Unknown operator "${String(controller.operator)}".`);
        if (!isNumber(controller.threshold)) error(id, 'Threshold must be a number.');
        if (!isNonNegative(controller.value)) error(id, 'Value must be zero or more.');
        if (controller.otherwise !== undefined && !isNonNegative(controller.otherwise)) error(id, 'The otherwise value must be zero or more.');
        break;
      case 'pid':
        if (!isNumber(controller.setpoint)) error(id, 'Setpoint must be a number.');
        if (!isNumber(controller.kp)) error(id, 'Proportional gain must be a number.');
        if (isNumber(controller.min) && isNumber(controller.max) && controller.min >= controller.max) error(id, 'Minimum output must be below the maximum.');
        break;
      default:
        error(id, `Unknown controller type "${String((controller as { type?: unknown }).type)}".`);
    }
  });

  const sim = scenario.simulation;
  if (!sim || typeof sim !== 'object') {
    error('', 'Simulation settings are missing.');
  } else {
    if (!isNonNegative(sim.duration)) error('', 'Duration must be zero or more.');
    if (!isPositive(sim.timeStep)) error('', 'Time step must be greater than zero.');
    if (sim.reportStep !== undefined && !isPositive(sim.reportStep)) error('', 'Report step must be greater than zero.');
  }
  const duration = sim && isNonNegative(sim.duration) ? sim.duration : Number.POSITIVE_INFINITY;

  attacks.forEach(attack => {
    if (!attack || !claim(attack.id, 'attack')) return;
    const id = attack.id;
    if (!isNonNegative(attack.start)) error(id, 'Start time must be zero or more.');
    else if (attack.start > duration) error(id, 'Starts after the end of the simulation.');
    if (attack.duration !== undefined && !isPositive(attack.duration)) error(id, 'Duration must be greater than zero.');
    switch (attack.type) {
      case 'data_poisoning':
        if (!sensorIds.has(attack.sensor)) error(id, `Sensor "${String(attack.sensor)}" does not exist.`);
        if (!['constant', 'offset', 'scale', 'freeze', 'drift', 'noise', 'replay'].includes(attack.mode)) error(id, `Unknown spoofing mode "${String(attack.mode)}".`);
        else if (attack.mode !== 'freeze' && !isNumber(attack.value)) error(id, 'This spoofing mode needs a value.');
        else if ((attack.mode === 'replay' || attack.mode === 'noise') && !(isNumber(attack.value) && attack.value >= 0)) error(id, 'The value must be zero or more.');
        break;
      case 'command_injection':
        if (!isActuator(attack.actuator)) error(id, `Actuator "${String(attack.actuator)}" is not a pump or valve.`);
        if (!isNonNegative(attack.value)) error(id, 'The injected value must be zero or more.');
        break;
      case 'controller_tamper':
        if (!controllerIds.has(attack.controller)) error(id, `Controller "${String(attack.controller)}" does not exist.`);
        if (!attack.disable && (!attack.set || Object.keys(attack.set).length === 0)) error(id, 'Either disable the controller or give parameters to change.');
        if (attack.set && Object.values(attack.set).some(v => !isNumber(v))) error(id, 'Changed parameters must be numbers.');
        break;
      case 'pump_failure':
        if (linkTypes.get(attack.pump) !== 'pump') error(id, `"${String(attack.pump)}" is not a pump.`);
        break;
      case 'valve_stuck':
        if (linkTypes.get(attack.valve) !== 'valve') error(id, `"${String(attack.valve)}" is not a valve.`);
        if (attack.position !== undefined && !isFraction(attack.position)) error(id, 'Position must be between 0 and 1.');
        break;
      case 'leak':
        if (nodeTypes.get(attack.node) !== 'junction' && nodeTypes.get(attack.node) !== 'tank') error(id, `"${String(attack.node)}" is not a junction or tank.`);
        if (!isPositive(attack.diameter)) error(id, 'Hole diameter must be greater than zero.');
        break;
      case 'pipe_blockage':
        if (linkTypes.get(attack.pipe) !== 'pipe') error(id, `"${String(attack.pipe)}" is not a pipe.`);
        if (!isFraction(attack.fraction)) error(id, 'Blocked fraction must be between 0 and 1.');
        break;
      case 'chemical_interference':
        if (nodeTypes.get(attack.node) !== 'junction' && nodeTypes.get(attack.node) !== 'tank') error(id, `"${String(attack.node)}" is not a junction or tank.`);
        if (!['chlorine', 'acid', 'base', 'ammonia', 'bod', 'nitrate', 'tracer', 'dechlorinator', 'sulfite'].includes(attack.substance)) error(id, `Unknown substance "${String(attack.substance)}".`);
        if (!isPositive(attack.amount)) error(id, 'Amount must be greater than zero.');
        break;
      default:
        error(id, `Unknown attack type "${String((attack as { type?: unknown }).type)}".`);
    }
  });

  return issues;
}

export class ScenarioError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super('Invalid scenario:\n' + issues.map(i => `  ${i.where ? i.where + ': ' : ''}${i.message}`).join('\n'));
    this.name = 'ScenarioError';
    this.issues = issues;
  }
}
