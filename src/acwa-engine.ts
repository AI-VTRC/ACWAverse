// ACWA Engine: pure simulation logic for unit testing and reuse
(function(){
  const GRAVITY = 9.80665;

  enum ComponentType {
    Tank = 'tank',
    Pump = 'pump',
    Valve = 'valve',
    Source = 'source',
    Sink = 'sink',
    Junction = 'junction'
  }

  enum TankShape {
    Cylindrical = 'cylindrical',
    Rectangular = 'rectangular',
    Spherical = 'spherical'
  }

  enum ChemistryKey {
    O2 = 'o2',
    BODN = 'bodn',
    Nitrate = 'nitrate',
    CO2 = 'co2'
  }

  enum TimedActionType {
    SetPumpPower = 'set_pump_power',
    SetValveState = 'set_valve_state',
    SetValveFlow = 'set_valve_flow'
  }

  enum ConditionalOperator {
    GreaterThan = '>',
    LessThan = '<',
    Equal = '=='
  }

  enum ConditionalActionType {
    SetPumpPower = TimedActionType.SetPumpPower,
    SetValveState = TimedActionType.SetValveState,
    SetValveFlow = TimedActionType.SetValveFlow,
    EmergencyStop = 'emergency_stop',
    EmergencyClose = 'emergency_close',
    ReducePower = 'reduce_power',
    IncreasePower = 'increase_power'
  }

  enum AttackType {
    ChemicalDosing = 'chemical_dosing',
    ChemicalInterference = 'chemical_interference',
    PhysicalDamage = 'physical_damage',
    DataPoisoning = 'data_poisoning'
  }

  type ChemistryMap = Partial<Record<ChemistryKey, number>>;
  const CHEMISTRY_KEYS: readonly ChemistryKey[] = [
    ChemistryKey.O2,
    ChemistryKey.BODN,
    ChemistryKey.Nitrate,
    ChemistryKey.CO2
  ];
  const MIX_KEYS: readonly (keyof ChemistryCarrier)[] = [
    'temperature',
    'ph',
    ChemistryKey.O2,
    ChemistryKey.BODN,
    ChemistryKey.Nitrate,
    ChemistryKey.CO2
  ];

  interface HazenWilliamsConfig {
    K?: number;
    n?: number;
    length?: number;
    C?: number;
    c?: number;
  }

  interface DarcyWeisbachConfig {
    f?: number;
    length?: number;
    diameter?: number;
  }

  interface ChemistryProfile {
    enableReactions?: boolean;
    ambientO2?: number;
    ambientCO2?: number;
    bodnDecay?: number;
    o2ReaerationRate?: number;
    co2DegasRate?: number;
    bodnO2Factor?: number;
    bodnCO2Factor?: number;
    denitrificationFactor?: number;
    nitrateDecay?: number;
    o2Decay?: number;
    co2Decay?: number;
    neutralPh?: number;
    phCo2Sensitivity?: number;
    phO2Sensitivity?: number;
    phRelaxRate?: number;
    reaerationRate?: number;
    co2PhSensitivity?: number; // backwards compat alias
  }

  interface PoisonedReading {
    value: number;
    startTime?: number;
    endTime?: number;
  }

  interface ChemistryCarrier extends ChemistryMap {
    temperature?: number;
    ph?: number;
  }

  interface BaseComponent {
    id: string;
    type: ComponentType;
    baseElevation?: number;
    elevation?: number;
    stuck?: boolean;
    power?: number;
    flowRate?: number;
    isOpen?: boolean;
    waterAmount?: number;
    waterLevel?: number;
    maxFlowRate?: number;
    efficiency?: number;
    headGain?: number;
    baseHeadGain?: number;
    maxThroughput?: number;
    head?: number;
    poisonedReadings?: Record<string, PoisonedReading>;
    [key: string]: unknown;
  }

  interface TankComponent extends BaseComponent, ChemistryCarrier {
    type: ComponentType.Tank;
    waterAmount: number;
    waterLevel: number;
    maxLevel: number;
    overflowVolume?: number;
    shape?: TankShape;
    radius?: number;
    width?: number;
    height?: number;
    decayRates?: ChemistryMap;
    chemistry?: ChemistryProfile;
  }

  interface PumpComponent extends BaseComponent, ChemistryCarrier {
    type: ComponentType.Pump;
    maxFlowRate: number;
    power: number;
    efficiency?: number;
    curve?: [number, number, number];
    headGain?: number;
    baseHeadGain?: number;
    maxThroughput?: number;
    chemistry?: ChemistryProfile;
  }

  interface ValveComponent extends BaseComponent {
    type: ComponentType.Valve;
    isOpen?: boolean;
    flowRate?: number;
    flowSetpoint?: number;
    opening?: number;
  }

  interface SourceComponent extends BaseComponent, ChemistryCarrier {
    type: ComponentType.Source;
    head?: number;
    waterLevel?: number;
  }

  interface SinkComponent extends BaseComponent {
    type: ComponentType.Sink;
    head?: number;
  }

  interface JunctionComponent extends BaseComponent {
    type: ComponentType.Junction;
  }

  type Component = TankComponent | PumpComponent | ValveComponent | SourceComponent | SinkComponent | JunctionComponent;

  interface Pipe {
    id?: string;
    from: string;
    to: string;
    diameter?: number;
    length?: number;
    hw?: HazenWilliamsConfig;
    dw?: DarcyWeisbachConfig;
    maxFlowRate?: number;
  }

  interface SimulationNetwork {
    components: Component[];
    pipes: Pipe[];
  }

  interface TimedControlAction {
    time: number;
    componentId: string;
    actionType: TimedActionType;
    params: Record<string, string>;
  }

  interface ConditionalAction {
    source: { componentId: string; value: string };
    condition: { operator: ConditionalOperator; threshold: number };
    target: { componentId: string; actionType: ConditionalActionType; params?: Record<string, string> };
  }

  interface ChemicalDosingAttack {
    time: number;
    type: AttackType.ChemicalDosing;
    componentId: string;
    chemicalType: 'acid' | 'base';
    amount?: number;
  }

  interface ChemicalInterferenceAttack {
    time: number;
    type: AttackType.ChemicalInterference;
    componentId: string;
    chemical: 'O2' | 'BODn' | 'nitrate' | 'CO2';
    amount: number;
  }

  interface PhysicalDamageAttack {
    time: number;
    type: AttackType.PhysicalDamage;
    componentId: string;
    damageType: 'pump_failure' | 'valve_stuck' | 'leak';
  }

  interface DataPoisoningAttack {
    time: number;
    type: AttackType.DataPoisoning;
    componentId: string;
    poisonType: string;
    value: number;
    duration: number;
  }

  type Attack = ChemicalDosingAttack | ChemicalInterferenceAttack | PhysicalDamageAttack | DataPoisoningAttack;

  interface StepContext {
    timeStep: number;
    ambientTemp: number;
    controlsAtT: TimedControlAction[];
    attacksAtT: Attack[];
    rules: ConditionalAction[];
  }

  type TankEntity = { kind: ComponentType.Tank; comp: TankComponent };
  type SourceEntity = { kind: ComponentType.Source; comp: SourceComponent };
  type SinkEntity = { kind: ComponentType.Sink; comp: SinkComponent };

  type SourceEntityRef = TankEntity | SourceEntity;
  type DestEntityRef = TankEntity | SinkEntity;
  type EntityRef = TankEntity | SourceEntity | SinkEntity;

  interface HydraulicPath<T extends EntityRef> {
    entity: T;
    pipes: Pipe[];
    components: Component[];
  }

  interface FlowCandidate {
    from: SourceEntityRef;
    to: EntityRef;
    flowRate: number;
    pipes: Pipe[];
    components: Component[];
  }

  interface SimulationState {
    network: SimulationNetwork;
    controlActions?: TimedControlAction[];
    conditionalActions?: ConditionalAction[];
    attackScenarios?: Attack[];
  }

  interface SimulationSettings {
    duration: number;
    ambientTemp: number;
    timeStep: number;
  }

  type ACWAEngineAPI = {
    isValveOpen: (comp: Component) => boolean;
    findSourceTank: (simNetwork: SimulationNetwork, startComponentId: string) => TankComponent | SourceComponent | null;
    findDestTank: (simNetwork: SimulationNetwork, startComponentId: string) => TankComponent | null;
    applyTimedControl: (simNetwork: SimulationNetwork, action: TimedControlAction) => void;
    applyAttack: (simNetwork: SimulationNetwork, attack: Attack) => void;
    getCurrentValue: (sourceComp: Component, key: string, t: number) => number | undefined;
    applyConditionalActions: (simNetwork: SimulationNetwork, rules: ConditionalAction[], t: number) => void;
    clearExpiredPoisoning: (simNetwork: SimulationNetwork, t: number) => void;
    applyPumpTransfers: (simNetwork: SimulationNetwork, timeStep: number) => void;
    applyPassiveFlows: (simNetwork: SimulationNetwork, timeStep: number) => void;
    updateTanks: (simNetwork: SimulationNetwork, ambientTemp: number, timeStep: number) => void;
    recordStep: (simNetwork: SimulationNetwork, t: number, meta: { attacksAtT: Attack[] }) => Record<string, number | string>;
    step: (simNetwork: SimulationNetwork, t: number, ctx: StepContext) => Record<string, number | string>;
    run: (network: SimulationNetwork, controlActions: TimedControlAction[] | undefined, conditionalActions: ConditionalAction[] | undefined, attackScenarios: Attack[] | undefined, duration: number, ambientTemp: number, timeStep: number) => { simNetwork: SimulationNetwork; results: Array<Record<string, number | string>> };
    startSimulationPure: (state: SimulationState, settings: SimulationSettings) => { simNetwork: SimulationNetwork; results: Array<Record<string, number | string>> };
    enums: {
      ComponentType: typeof ComponentType;
      TankShape: typeof TankShape;
      TimedActionType: typeof TimedActionType;
      ConditionalOperator: typeof ConditionalOperator;
      ConditionalActionType: typeof ConditionalActionType;
      AttackType: typeof AttackType;
      ChemistryKey: typeof ChemistryKey;
    };
  };

  const DEFAULT_CHEMISTRY: Required<Pick<ChemistryProfile,
    'ambientO2' |
    'ambientCO2' |
    'bodnDecay' |
    'o2ReaerationRate' |
    'co2DegasRate' |
    'bodnO2Factor' |
    'bodnCO2Factor' |
    'denitrificationFactor' |
    'nitrateDecay' |
    'neutralPh' |
    'phCo2Sensitivity' |
    'phO2Sensitivity' |
    'phRelaxRate'
  >> = {
    ambientO2: 8,
    ambientCO2: 5,
    bodnDecay: 0.01,
    o2ReaerationRate: 0.003,
    co2DegasRate: 0.001,
    bodnO2Factor: 1.5,
    bodnCO2Factor: 0.6,
    denitrificationFactor: 0.05,
    nitrateDecay: 0.001,
    neutralPh: 7,
    phCo2Sensitivity: 0.08,
    phO2Sensitivity: 0.02,
    phRelaxRate: 0.2
  };

  function deepCopy<T>(obj: T): T { return JSON.parse(JSON.stringify(obj)); }

  function valveOpening(comp: Component | undefined): number {
    if (!comp || comp.type !== ComponentType.Valve) return 1;
    if (typeof comp.opening === 'number'){
      return Math.max(0, Math.min(1, comp.opening));
    }
    return comp.isOpen === false ? 0 : 1;
  }

  function isValveOpen(comp: Component): boolean {
    return comp.type !== ComponentType.Valve || valveOpening(comp) > 1e-6;
  }

  function nextOutgoingFrom(simNetwork: SimulationNetwork, componentId: string): Pipe | undefined {
    return simNetwork.pipes.find(p => p.from === componentId);
  }
  function nextIncomingTo(simNetwork: SimulationNetwork, componentId: string): Pipe | undefined {
    return simNetwork.pipes.find(p => p.to === componentId);
  }

  function findSourceTank(simNetwork: SimulationNetwork, startComponentId: string): TankComponent | SourceComponent | null {
    let current: Component | undefined = simNetwork.components.find(c => c.id === startComponentId);
    const visited = new Set<string>();
    while (current){
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (current.type === ComponentType.Tank) return current;
      if (current.type === ComponentType.Source) return current;
      if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))){
        const currentId = current.id;
        const incomingPipe = simNetwork.pipes.find(p => p.to === currentId);
        if (!incomingPipe) break;
        current = simNetwork.components.find(c => c.id === incomingPipe.from);
      } else {
        break;
      }
    }
    return null;
  }

  function findDestTank(simNetwork: SimulationNetwork, startComponentId: string): TankComponent | null {
    let current: Component | undefined = simNetwork.components.find(c => c.id === startComponentId);
    const visited = new Set<string>();
    while (current){
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (current.type === ComponentType.Tank) return current;
      if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))){
        const currentId = current.id;
        const outgoingPipe = simNetwork.pipes.find(p => p.from === currentId);
        if (!outgoingPipe) break;
        current = simNetwork.components.find(c => c.id === outgoingPipe.to);
      } else {
        break;
      }
    }
    return null;
  }

  function findSourceEntity(simNetwork: SimulationNetwork, startComponentId: string): SourceEntityRef | null {
    let current: Component | undefined = simNetwork.components.find(c => c.id === startComponentId);
    const visited = new Set<string>();
    while (current){
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (current.type === ComponentType.Tank) return { kind: ComponentType.Tank, comp: current };
      if (current.type === ComponentType.Source) return { kind: ComponentType.Source, comp: current };
      if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))){
        const currentId = current.id;
        const incomingPipe = simNetwork.pipes.find(p => p.to === currentId);
        if (!incomingPipe) break;
        current = simNetwork.components.find(c => c.id === incomingPipe.from);
      } else {
        break;
      }
    }
    return null;
  }

  function findDestEntity(simNetwork: SimulationNetwork, startComponentId: string): DestEntityRef | null {
    let current: Component | undefined = simNetwork.components.find(c => c.id === startComponentId);
    const visited = new Set<string>();
    while (current){
      if (visited.has(current.id)) break;
      visited.add(current.id);
      if (current.type === ComponentType.Tank) return { kind: ComponentType.Tank, comp: current };
      if (current.type === ComponentType.Sink) return { kind: ComponentType.Sink, comp: current };
      if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))){
        const currentId = current.id;
        const outgoingPipe = simNetwork.pipes.find(p => p.from === currentId);
        if (!outgoingPipe) break;
        current = simNetwork.components.find(c => c.id === outgoingPipe.to);
      } else {
        break;
      }
    }
    return null;
  }

  function collectDownstreamPaths(simNetwork: SimulationNetwork, startComponentId: string): HydraulicPath<DestEntityRef>[] {
    const componentsById = new Map(simNetwork.components.map(comp => [comp.id, comp]));
    const outgoing = new Map<string, Pipe[]>();
    (simNetwork.pipes || []).forEach(pipe => {
      const list = outgoing.get(pipe.from) || [];
      list.push(pipe);
      outgoing.set(pipe.from, list);
    });
    const paths: HydraulicPath<DestEntityRef>[] = [];

    function walk(currentId: string, pipes: Pipe[], components: Component[], visited: Set<string>): void {
      (outgoing.get(currentId) || []).forEach(pipe => {
        const next = componentsById.get(pipe.to);
        if (!next || visited.has(next.id) || next.type === ComponentType.Pump) return;

        const nextPipes = [...pipes, pipe];
        const nextComponents = [...components, next];
        if (next.type === ComponentType.Tank){
          paths.push({
            entity: { kind: ComponentType.Tank, comp: next },
            pipes: nextPipes,
            components: nextComponents
          });
          return;
        }
        if (next.type === ComponentType.Sink){
          paths.push({
            entity: { kind: ComponentType.Sink, comp: next },
            pipes: nextPipes,
            components: nextComponents
          });
          return;
        }
        if (next.type !== ComponentType.Junction && next.type !== ComponentType.Valve) return;
        if (next.type === ComponentType.Valve && !isValveOpen(next)) return;

        const nextVisited = new Set(visited);
        nextVisited.add(next.id);
        walk(next.id, nextPipes, nextComponents, nextVisited);
      });
    }

    walk(startComponentId, [], [], new Set([startComponentId]));
    return paths;
  }

  function collectUpstreamPaths(simNetwork: SimulationNetwork, startComponentId: string): HydraulicPath<SourceEntityRef>[] {
    const componentsById = new Map(simNetwork.components.map(comp => [comp.id, comp]));
    const incoming = new Map<string, Pipe[]>();
    (simNetwork.pipes || []).forEach(pipe => {
      const list = incoming.get(pipe.to) || [];
      list.push(pipe);
      incoming.set(pipe.to, list);
    });
    const paths: HydraulicPath<SourceEntityRef>[] = [];

    function walk(currentId: string, pipes: Pipe[], components: Component[], visited: Set<string>): void {
      (incoming.get(currentId) || []).forEach(pipe => {
        const previous = componentsById.get(pipe.from);
        if (!previous || visited.has(previous.id) || previous.type === ComponentType.Pump) return;

        const nextPipes = [pipe, ...pipes];
        const nextComponents = [previous, ...components];
        if (previous.type === ComponentType.Tank){
          paths.push({
            entity: { kind: ComponentType.Tank, comp: previous },
            pipes: nextPipes,
            components: nextComponents
          });
          return;
        }
        if (previous.type === ComponentType.Source){
          paths.push({
            entity: { kind: ComponentType.Source, comp: previous },
            pipes: nextPipes,
            components: nextComponents
          });
          return;
        }
        if (previous.type !== ComponentType.Junction && previous.type !== ComponentType.Valve) return;
        if (previous.type === ComponentType.Valve && !isValveOpen(previous)) return;

        const nextVisited = new Set(visited);
        nextVisited.add(previous.id);
        walk(previous.id, nextPipes, nextComponents, nextVisited);
      });
    }

    walk(startComponentId, [], [], new Set([startComponentId]));
    return paths;
  }

  function componentHead(comp: TankComponent | SourceComponent | SinkComponent | ValveComponent | JunctionComponent | PumpComponent): number {
    const elevation = typeof comp.baseElevation === 'number' ? comp.baseElevation :
      (typeof comp.elevation === 'number' ? comp.elevation : 0);
    if (comp.type === ComponentType.Tank){
      return elevation + (typeof comp.waterLevel === 'number' ? comp.waterLevel : 0);
    }
    if (comp.type === ComponentType.Source){
      if (typeof comp.head === 'number') return comp.head;
      if (typeof comp.waterLevel === 'number') return elevation + comp.waterLevel;
      return elevation;
    }
    if (comp.type === ComponentType.Sink){
      if (typeof comp.head === 'number') return comp.head;
      return elevation;
    }
    return elevation;
  }

  function entityHead(entity: EntityRef | null): number | undefined {
    if (!entity) return undefined;
    return componentHead(entity.comp);
  }

  function ensurePositive(num: number | undefined, fallback: number): number {
    return (typeof num === 'number' && num > 0) ? num : fallback;
  }

  function computeHazenK(pipe: Pipe): number {
    const hw = pipe.hw || {};
    const length = ensurePositive(hw.length || pipe.length, 1);
    const diameter = ensurePositive(pipe.diameter, 1);
    const cValue = ensurePositive(hw.C || hw.c, 130);
    return 10.67 * length / (Math.pow(cValue, 1.852) * Math.pow(diameter, 4.8704));
  }

  type PipeResistance =
    | { type: 'hazen'; K: number; n: number }
    | { type: 'darcy'; R: number };

  function computePipeResistance(pipe: Pipe): PipeResistance {
    if (pipe.hw){
      const n = typeof pipe.hw.n === 'number' ? pipe.hw.n : 1.852;
      const K = typeof pipe.hw.K === 'number' && pipe.hw.K > 0 ? pipe.hw.K : computeHazenK(pipe);
      return { type: 'hazen', K, n };
    }
    if (pipe.dw){
      const f = ensurePositive(pipe.dw.f, 0);
      const length = ensurePositive(pipe.dw.length || pipe.length, 1);
      const diameter = ensurePositive(pipe.dw.diameter || pipe.diameter, 1);
      if (f > 0){
        const R = (f * 8 * length) / (Math.PI * Math.PI * GRAVITY * Math.pow(diameter, 5));
        if (R > 0) return { type: 'darcy', R };
      }
    }
    if (pipe.diameter){
      const K = computeHazenK(pipe);
      return { type: 'hazen', K, n: 1.852 };
    }
    // Unconfigured UI pipes use a conservative quadratic resistance. Keeping
    // the same model in both directions makes head-loss and flow calculations
    // true mathematical inverses.
    return { type: 'darcy', R: 1e6 };
  }

  function computeFlowRateFromHead(pipe: Pipe | undefined, headDiff: number): number {
    if (!pipe) return 0;
    if (Math.abs(headDiff) < 1e-9) return 0;
    const resistance = computePipeResistance(pipe);
    const absHead = Math.abs(headDiff);
    let rate: number;
    if (resistance.type === 'hazen'){
      rate = Math.pow(absHead / resistance.K, 1 / resistance.n);
    } else {
      rate = Math.sqrt(absHead / resistance.R);
    }
    if (typeof pipe.maxFlowRate === 'number' && pipe.maxFlowRate >= 0){
      rate = Math.min(rate, pipe.maxFlowRate);
    }
    return headDiff >= 0 ? rate : -rate;
  }

  function computeHeadLoss(pipe: Pipe | undefined, flowRate: number): number {
    if (!pipe) return 0;
    const absFlow = Math.abs(flowRate);
    if (absFlow < 1e-12) return 0;
    const resistance = computePipeResistance(pipe);
    if (resistance.type === 'hazen'){
      return resistance.K * Math.pow(absFlow, resistance.n);
    }
    return resistance.R * absFlow * absFlow;
  }

  function pathHeadLoss(pipes: Pipe[], flowRate: number): number {
    return pipes.reduce((total, pipe) => total + computeHeadLoss(pipe, flowRate), 0);
  }

  function pathOpeningFactor(components: Component[]): number {
    return components.reduce((factor, comp) => {
      if (comp.type === ComponentType.Valve && typeof comp.flowSetpoint === 'number'){
        return Math.min(factor, comp.flowSetpoint > 0 ? 1 : 0);
      }
      return Math.min(factor, valveOpening(comp));
    }, 1);
  }

  function pathFlowLimit(pipes: Pipe[], components: Component[]): number {
    let limit = Number.POSITIVE_INFINITY;
    pipes.forEach(pipe => {
      if (typeof pipe.maxFlowRate === 'number' && pipe.maxFlowRate >= 0){
        limit = Math.min(limit, pipe.maxFlowRate);
      }
    });
    components.forEach(comp => {
      if (comp.type !== ComponentType.Valve) return;
      if (typeof comp.maxFlowRate === 'number' && comp.maxFlowRate >= 0){
        limit = Math.min(limit, comp.maxFlowRate);
      }
      if (typeof comp.flowSetpoint === 'number' && comp.flowSetpoint >= 0){
        limit = Math.min(limit, comp.flowSetpoint);
      }
    });
    return limit;
  }

  function solvePathFlowForHead(pipes: Pipe[], components: Component[], availableHead: number): number {
    if (pipes.length === 0 || availableHead <= 1e-12) return 0;
    const openingFactor = pathOpeningFactor(components);
    if (openingFactor <= 1e-6) return 0;

    let high = Number.POSITIVE_INFINITY;
    pipes.forEach(pipe => {
      const pipeRate = Math.abs(computeFlowRateFromHead(pipe, availableHead));
      high = Math.min(high, pipeRate);
    });
    high = Math.min(high, pathFlowLimit(pipes, components));
    if (!Number.isFinite(high)) high = 1;
    if (high <= 0) return 0;

    let low = 0;
    for (let iter = 0; iter < 40; iter++){
      const mid = (low + high) / 2;
      if (pathHeadLoss(pipes, mid) <= availableHead){
        low = mid;
      } else {
        high = mid;
      }
    }
    return low * openingFactor;
  }

  function applyFlowCandidates(candidates: FlowCandidate[], timeStep: number): void {
    if (timeStep <= 0 || candidates.length === 0) return;
    const candidateRates = candidates.map(candidate => Math.max(0, candidate.flowRate));
    const resourceGroups = new Map<object, { limit: number; indices: Set<number> }>();
    function registerResource(resource: object, limit: number, candidateIndex: number): void {
      if (!Number.isFinite(limit) || limit < 0) return;
      const group = resourceGroups.get(resource) || { limit, indices: new Set<number>() };
      group.limit = Math.min(group.limit, limit);
      group.indices.add(candidateIndex);
      resourceGroups.set(resource, group);
    }
    candidates.forEach((candidate, index) => {
      candidate.pipes.forEach(pipe => {
        if (typeof pipe.maxFlowRate === 'number'){
          registerResource(pipe, pipe.maxFlowRate, index);
        }
      });
      candidate.components.forEach(comp => {
        if (comp.type !== ComponentType.Valve) return;
        if (typeof comp.maxFlowRate === 'number'){
          registerResource(comp, comp.maxFlowRate, index);
        }
        if (typeof comp.flowSetpoint === 'number'){
          registerResource(comp, comp.flowSetpoint, index);
        }
      });
    });
    resourceGroups.forEach(group => {
      const total = Array.from(group.indices).reduce((sum, index) => sum + candidateRates[index], 0);
      if (total <= group.limit || total <= 0) return;
      const scale = group.limit / total;
      group.indices.forEach(index => {
        candidateRates[index] *= scale;
      });
    });

    const scaledVolumes = candidateRates.map(rate => rate * timeStep);
    const requestedByTank = new Map<string, number>();
    candidates.forEach((candidate, index) => {
      if (candidate.from.kind !== ComponentType.Tank) return;
      requestedByTank.set(
        candidate.from.comp.id,
        (requestedByTank.get(candidate.from.comp.id) || 0) + scaledVolumes[index]
      );
    });
    candidates.forEach((candidate, index) => {
      if (candidate.from.kind !== ComponentType.Tank) return;
      const requested = requestedByTank.get(candidate.from.comp.id) || 0;
      if (requested > candidate.from.comp.waterAmount && requested > 0){
        scaledVolumes[index] *= candidate.from.comp.waterAmount / requested;
      }
    });

    const supplySnapshots = new Map<string, TankComponent | SourceComponent>();
    candidates.forEach(candidate => {
      if (!supplySnapshots.has(candidate.from.comp.id)){
        supplySnapshots.set(candidate.from.comp.id, { ...candidate.from.comp });
      }
    });

    candidates.forEach((candidate, index) => {
      const volume = scaledVolumes[index];
      if (volume <= 0 || candidate.from.comp.id === candidate.to.comp.id) return;
      if (candidate.from.kind === ComponentType.Tank){
        candidate.from.comp.waterAmount = Math.max(0, candidate.from.comp.waterAmount - volume);
      }
      if (candidate.to.kind === ComponentType.Tank){
        const supply = supplySnapshots.get(candidate.from.comp.id);
        if (supply) mixIntoTank(candidate.to.comp, supply, volume);
      }
    });
  }

  function mixIntoTank(tank: TankComponent, supplyComp: TankComponent | SourceComponent, volume: number): void {
    if (volume <= 0) return;
    const existing = tank.waterAmount;
    const total = existing + volume;
    if (total <= 0) return;
    MIX_KEYS.forEach(param => {
      const supplyValue = supplyComp[param];
      const tankValue = tank[param];
      if (typeof supplyValue === 'number' && typeof tankValue === 'number'){
        tank[param] = ((tankValue * existing) + (supplyValue * volume)) / total;
      } else if (typeof supplyValue === 'number' && existing === 0){
        tank[param] = supplyValue;
      }
    });
    tank.waterAmount = total;
  }

  function computePumpHead(pump: PumpComponent, flowRate: number): number {
    if (pump && pump.curve && Array.isArray(pump.curve) && pump.curve.length === 3){
      const [a0, a1, a2] = pump.curve;
      return a0 + a1 * flowRate + a2 * flowRate * flowRate;
    }
    if (pump && typeof pump.headGain === 'number'){
      return pump.headGain;
    }
    const base = pump && typeof pump.baseHeadGain === 'number' ? pump.baseHeadGain : 5;
    return base * ((pump && typeof pump.power === 'number') ? pump.power / 100 : 1);
  }

  function applyTimedControl(simNetwork: SimulationNetwork, action: TimedControlAction): void {
    const comp = simNetwork.components.find(c => c.id === action.componentId);
    if (!comp || comp.stuck) return;
    if (action.actionType === TimedActionType.SetPumpPower && comp.type === ComponentType.Pump) {
      const powerValue = parseFloat(action.params.power ?? '0');
      comp.power = Math.max(0, Math.min(100, isFinite(powerValue) ? powerValue : 0));
    }
    if (action.actionType === TimedActionType.SetValveState && comp.type === ComponentType.Valve){
      comp.flowSetpoint = undefined;
      const raw = String(action.params.state ?? '').toLowerCase();
      if (raw.endsWith('%')){
        const pct = parseFloat(raw);
        if (!Number.isNaN(pct)){
          comp.opening = Math.max(0, Math.min(1, pct / 100));
          comp.isOpen = comp.opening > 1e-6;
          if (!comp.isOpen) comp.flowRate = 0;
        }
      } else {
        const numeric = parseFloat(raw);
        if (!Number.isNaN(numeric)){
          const opening = Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
          comp.opening = opening;
          comp.isOpen = opening > 1e-6;
          if (!comp.isOpen) comp.flowRate = 0;
        } else {
          comp.isOpen = raw === 'open';
          comp.opening = comp.isOpen ? 1 : 0;
          if (!comp.isOpen) comp.flowRate = 0;
        }
      }
    }
    if (action.actionType === TimedActionType.SetValveFlow && comp.type === ComponentType.Valve){
      const flow = parseFloat(action.params.flowRate ?? '0');
      const numericFlow = Math.max(0, isFinite(flow) ? flow : 0);
      comp.flowSetpoint = numericFlow;
      comp.flowRate = numericFlow;
      comp.isOpen = numericFlow > 0;
      if (typeof comp.maxFlowRate === 'number' && comp.maxFlowRate > 0){
        comp.opening = Math.max(0, Math.min(1, Math.abs(numericFlow) / comp.maxFlowRate));
      } else {
        comp.opening = comp.isOpen ? 1 : 0;
      }
    }
  }

  function applyAttack(simNetwork: SimulationNetwork, attack: Attack): void {
    const comp = simNetwork.components.find(c => c.id === attack.componentId);
    if (!comp) return;
    switch (attack.type){
      case AttackType.ChemicalDosing:
        if (comp.type === ComponentType.Tank || comp.type === ComponentType.Source){
          const rawAmount = typeof attack.amount === 'number' ? attack.amount : 1.5;
          const amount = Math.max(0, rawAmount);
          if (attack.chemicalType === 'acid') comp.ph = Math.max(0, (comp.ph ?? 7) - amount);
          if (attack.chemicalType === 'base') comp.ph = Math.min(14, (comp.ph ?? 7) + amount);
        }
        break;
      case AttackType.ChemicalInterference:
        if (comp.type === ComponentType.Tank || comp.type === ComponentType.Source){
          if (attack.chemical === 'O2') comp.o2 = Math.max(0, Math.min(15, (comp.o2 ?? 0) + attack.amount));
          if (attack.chemical === 'BODn') comp.bodn = Math.max(0, Math.min(10, (comp.bodn ?? 0) + attack.amount));
          if (attack.chemical === 'nitrate') comp.nitrate = Math.max(0, Math.min(5, (comp.nitrate ?? 0) + attack.amount));
          if (attack.chemical === 'CO2') comp.co2 = Math.max(0, Math.min(10, (comp.co2 ?? 0) + attack.amount));
        }
        break;
      case AttackType.PhysicalDamage:
        if (attack.damageType === 'pump_failure' && comp.type === ComponentType.Pump){ 
          comp.power = 0; 
          comp.efficiency = 0; 
          comp.stuck = true; // Prevent future control until manual reset
        }
        if (attack.damageType === 'valve_stuck' && comp.type === ComponentType.Valve){ 
          comp.isOpen = false; 
          comp.flowRate = 0; 
          comp.flowSetpoint = 0;
          comp.opening = 0;
          comp.stuck = true; // Prevent future control until manual reset
        }
        if (attack.damageType === 'leak' && comp.type === ComponentType.Tank){ 
          comp.waterAmount *= 0.95; 
          comp.stuck = true; // Mark tank as damaged
        }
        break;
      case AttackType.DataPoisoning:
        if (!comp.poisonedReadings) comp.poisonedReadings = {};
        comp.poisonedReadings[attack.poisonType] = {
          value: attack.value,
          startTime: attack.time,
          endTime: attack.time + attack.duration
        };
        break;
    }
  }

  function getCurrentValue(sourceComp: Component, key: string, t: number): number | undefined {
    const baseValue = sourceComp[key];
    let v = typeof baseValue === 'number' ? baseValue : undefined;
    const poisoned = sourceComp.poisonedReadings ? sourceComp.poisonedReadings[key] : undefined;
    if (poisoned){
      if ((poisoned.startTime === undefined || t >= poisoned.startTime) && (poisoned.endTime === undefined || t <= poisoned.endTime)){
        v = poisoned.value;
      }
    }
    return v;
  }

  function applyConditionalActions(simNetwork: SimulationNetwork, rules: ConditionalAction[], t: number): void {
    rules.forEach(rule => {
      const sourceComp = simNetwork.components.find(c => c.id === rule.source.componentId);
      if (!sourceComp) return;
      const currentValue = getCurrentValue(sourceComp, rule.source.value, t);
      let ok = false;
      switch (rule.condition.operator){
        case ConditionalOperator.GreaterThan:
          ok = (currentValue ?? Number.NEGATIVE_INFINITY) > rule.condition.threshold;
          break;
        case ConditionalOperator.LessThan:
          ok = (currentValue ?? Number.POSITIVE_INFINITY) < rule.condition.threshold;
          break;
        case ConditionalOperator.Equal:
          ok = currentValue === rule.condition.threshold;
          break;
      }
      if (!ok) return;
      const targetComp = simNetwork.components.find(c => c.id === rule.target.componentId);
      if (!targetComp || targetComp.stuck) return;
      const params = rule.target.params || {};
      switch (rule.target.actionType){
        case ConditionalActionType.SetPumpPower:
          if (targetComp.type === ComponentType.Pump){
            const powerValue = parseFloat(params.power ?? '0');
            targetComp.power = Math.max(0, Math.min(100, isFinite(powerValue) ? powerValue : 0));
          }
          break;
        case ConditionalActionType.EmergencyStop:
          if (targetComp.type === ComponentType.Pump){
            targetComp.power = 0;
          }
          break;
        case ConditionalActionType.EmergencyClose:
          if (targetComp.type === ComponentType.Valve){
            targetComp.flowSetpoint = 0;
            targetComp.isOpen = false;
            targetComp.flowRate = 0;
            targetComp.opening = 0;
          }
          break;
        case ConditionalActionType.ReducePower: 
          if (targetComp.type === ComponentType.Pump){
            const reduceAmount = parseFloat(params.power ?? '50');
            const delta = isFinite(reduceAmount) ? reduceAmount : 0;
            targetComp.power = Math.max(0, (targetComp.power ?? 0) - delta);
          }
          break;
        case ConditionalActionType.IncreasePower: 
          if (targetComp.type === ComponentType.Pump){
            const increaseAmount = parseFloat(params.power ?? '100');
            const delta = isFinite(increaseAmount) ? increaseAmount : 0;
            targetComp.power = Math.min(100, (targetComp.power ?? 0) + delta);
          }
          break;
        case ConditionalActionType.SetValveState:
          if (targetComp.type === ComponentType.Valve){
            targetComp.flowSetpoint = undefined;
            const raw = String(params.state ?? '').toLowerCase();
            if (raw.endsWith('%')){
              const pct = parseFloat(raw);
              if (!Number.isNaN(pct)){
                targetComp.opening = Math.max(0, Math.min(1, pct / 100));
                targetComp.isOpen = targetComp.opening > 1e-6;
                if (!targetComp.isOpen) targetComp.flowRate = 0;
              }
            } else {
              const numeric = parseFloat(raw);
              if (!Number.isNaN(numeric)){
                const opening = Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
                targetComp.opening = opening;
                targetComp.isOpen = opening > 1e-6;
                if (!targetComp.isOpen) targetComp.flowRate = 0;
              } else {
                targetComp.isOpen = raw === 'open';
                targetComp.opening = targetComp.isOpen ? 1 : 0;
                if (!targetComp.isOpen) targetComp.flowRate = 0;
              }
            }
          }
          break;
        case ConditionalActionType.SetValveFlow:
          if (targetComp.type === ComponentType.Valve){
            const flowRate = parseFloat(params.flowRate ?? '0');
            const rate = Math.max(0, isFinite(flowRate) ? flowRate : 0);
            targetComp.flowSetpoint = rate;
            targetComp.flowRate = rate;
            targetComp.isOpen = rate > 0;
            if (typeof targetComp.maxFlowRate === 'number' && targetComp.maxFlowRate > 0){
              targetComp.opening = Math.max(0, Math.min(1, Math.abs(rate) / targetComp.maxFlowRate));
            } else {
              targetComp.opening = targetComp.isOpen ? 1 : 0;
            }
          }
          break;
      }
    });
  }

  function clearExpiredPoisoning(simNetwork: SimulationNetwork, t: number): void {
    simNetwork.components.forEach(comp => {
      const readings = comp.poisonedReadings;
      if (!readings) return;
      Object.entries(readings).forEach(([key, poisoning]) => {
        if (poisoning && poisoning.endTime !== undefined && t > poisoning.endTime){
          delete readings[key];
        }
      });
    });
  }

  function applyPumpTransfers(simNetwork: SimulationNetwork, timeStep: number): void {
    const pumps = simNetwork.components.filter((c): c is PumpComponent => c.type === ComponentType.Pump);
    pumps.forEach(pump => {
      if ((pump.power ?? 0) <= 0) return;
      const maxFlowRated = Math.max(0, pump.maxFlowRate || 0);
      const powerFactor = Math.max(0, Math.min(1, pump.power / 100));
      const efficiency = (pump.efficiency !== undefined) ? Math.max(0, Math.min(1, pump.efficiency)) : 1.0;
      let pumpCapacity = maxFlowRated * powerFactor * efficiency;
      if (typeof pump.maxThroughput === 'number') pumpCapacity = Math.min(pumpCapacity, pump.maxThroughput);
      if (pumpCapacity <= 0) return;

      const upstreamPaths = collectUpstreamPaths(simNetwork, pump.id);
      const downstreamPaths = collectDownstreamPaths(simNetwork, pump.id);
      if (upstreamPaths.length === 0 || downstreamPaths.length === 0) return;

      const branches = upstreamPaths.flatMap(upstream => downstreamPaths.map(downstream => {
        const sourceHead = entityHead(upstream.entity);
        const destHead = entityHead(downstream.entity);
        return {
          source: upstream.entity,
          dest: downstream.entity,
          staticHead: sourceHead !== undefined && destHead !== undefined ? destHead - sourceHead : Number.POSITIVE_INFINITY,
          pipes: [...upstream.pipes, ...downstream.pipes],
          components: [...upstream.components, ...downstream.components]
        };
      })).filter(branch => (
        Number.isFinite(branch.staticHead) &&
        branch.source.comp.id !== branch.dest.comp.id
      ));
      if (branches.length === 0) return;

      function branchCapacity(branch: typeof branches[number], totalPumpFlow: number): number {
        const availableHead = computePumpHead(pump, totalPumpFlow) - branch.staticHead;
        return solvePathFlowForHead(branch.pipes, branch.components, availableHead);
      }

      let low = 0;
      let high = pumpCapacity;
      for (let iter = 0; iter < 40; iter++){
        const mid = (low + high) / 2;
        const supportedFlow = branches.reduce(
          (sum, branch) => sum + branchCapacity(branch, mid),
          0
        );
        if (supportedFlow >= mid){
          low = mid;
        } else {
          high = mid;
        }
      }

      const totalFlow = low;
      if (totalFlow <= 1e-12) return;
      const branchFlows = branches.map(branch => branchCapacity(branch, totalFlow));
      const branchTotal = branchFlows.reduce((sum, flow) => sum + flow, 0);
      if (branchTotal <= 1e-12) return;
      const scale = Math.min(1, totalFlow / branchTotal);
      const candidates: FlowCandidate[] = branches.map((branch, index) => ({
        from: branch.source,
        to: branch.dest,
        flowRate: branchFlows[index] * scale,
        pipes: branch.pipes,
        components: branch.components
      })).filter(candidate => candidate.flowRate > 1e-12);
      applyFlowCandidates(candidates, timeStep);
    });
  }

  function applyPassiveFlows(simNetwork: SimulationNetwork, timeStep: number): void {
    const origins: SourceEntityRef[] = [];
    simNetwork.components.forEach(comp => {
      if (comp.type === ComponentType.Tank){
        origins.push({ kind: ComponentType.Tank, comp });
      }
      if (comp.type === ComponentType.Source){
        origins.push({ kind: ComponentType.Source, comp });
      }
    });
    const candidates: FlowCandidate[] = [];

    origins.forEach(origin => {
      collectDownstreamPaths(simNetwork, origin.comp.id).forEach(path => {
        if (origin.comp.id === path.entity.comp.id) return;
        const headUp = entityHead(origin);
        const headDown = entityHead(path.entity);
        if (headUp === undefined || headDown === undefined) return;
        const headDiff = headUp - headDown;
        const flowRate = solvePathFlowForHead(path.pipes, path.components, Math.abs(headDiff));
        if (flowRate <= 1e-12) return;

        if (headDiff >= 0){
          candidates.push({
            from: origin,
            to: path.entity,
            flowRate,
            pipes: path.pipes,
            components: path.components
          });
        } else if (path.entity.kind === ComponentType.Tank){
          candidates.push({
            from: { kind: ComponentType.Tank, comp: path.entity.comp },
            to: origin,
            flowRate,
            pipes: path.pipes,
            components: path.components
          });
        }
      });
    });
    applyFlowCandidates(candidates, timeStep);
  }

  function updateTanks(simNetwork: SimulationNetwork, ambientTemp: number, timeStep: number): void {
    const tanks = simNetwork.components.filter((c): c is TankComponent => c.type === ComponentType.Tank);
    tanks.forEach(tank => {
      const shape = tank.shape ?? TankShape.Cylindrical;
      let area;
      if (shape === TankShape.Rectangular){
        const width = (typeof tank.width === 'number' && tank.width > 0) ? tank.width : 1;
        const depth = (typeof tank.height === 'number' && tank.height > 0) ? tank.height : 1;
        area = width * depth;
      } else {
        const radius = (typeof tank.radius === 'number' && tank.radius > 0) ? tank.radius : 1;
        area = Math.PI * radius * radius;
      }
      area = area > 0 ? area : 1;
      tank.waterAmount = Math.max(0, tank.waterAmount);

      // If the tank exceeds capacity, spill the excess and track it explicitly.
      // This keeps the hydraulic head consistent with the physical capacity limit.
      const capacity = (typeof tank.maxLevel === 'number' ? Math.max(0, tank.maxLevel) : 0) * area;
      if (Number.isFinite(capacity) && tank.waterAmount > capacity){
        const overflow = tank.waterAmount - capacity;
        tank.overflowVolume = (typeof tank.overflowVolume === 'number' ? tank.overflowVolume : 0) + overflow;
        tank.waterAmount = capacity;
      }

      tank.waterLevel = tank.waterAmount / area;
      tank.waterLevel = Math.min(tank.waterLevel, tank.maxLevel);
      const currentTemp = tank.temperature ?? ambientTemp;
      const tempDiff = ambientTemp - currentTemp;
      tank.temperature = currentTemp + tempDiff * 0.001 * timeStep;
    });
  }

  // Optional first-order decay kinetics in tanks: C <- C * exp(-k * dt) for configured species
  function applyTankKinetics(simNetwork: SimulationNetwork, timeStep: number): void {
    const dt = Math.max(0, timeStep);
    if (dt === 0) return;
    const tanks = simNetwork.components.filter((c): c is TankComponent => c.type === ComponentType.Tank);
    tanks.forEach(tank => {
      const chemistry = tank.chemistry || {};
      const reactionsEnabled = !!chemistry.enableReactions;
      const rates = tank.decayRates || {};

      if (!reactionsEnabled){
        CHEMISTRY_KEYS.forEach(key => {
          const rate = rates[key];
          if (rate !== undefined && typeof tank[key] === 'number'){
            const k = Math.max(0, rate);
            tank[key] = (tank[key] as number) * Math.exp(-k * dt);
          }
        });
        if (typeof tank.o2 === 'number') tank.o2 = Math.max(0, Math.min(15, tank.o2));
        if (typeof tank.bodn === 'number') tank.bodn = Math.max(0, Math.min(10, tank.bodn));
        if (typeof tank.nitrate === 'number') tank.nitrate = Math.max(0, Math.min(5, tank.nitrate));
        if (typeof tank.co2 === 'number') tank.co2 = Math.max(0, Math.min(10, tank.co2));
        return;
      }

      const ambientO2 = chemistry.ambientO2 ?? DEFAULT_CHEMISTRY.ambientO2;
      const ambientCO2 = chemistry.ambientCO2 ?? DEFAULT_CHEMISTRY.ambientCO2;
      const bodnDecay = Math.max(0, rates.bodn ?? chemistry.bodnDecay ?? DEFAULT_CHEMISTRY.bodnDecay);
      const nitrateDecay = Math.max(0, rates.nitrate ?? chemistry.nitrateDecay ?? DEFAULT_CHEMISTRY.nitrateDecay);
      const o2Decay = Math.max(0, rates.o2 ?? chemistry.o2Decay ?? 0);
      const co2Decay = Math.max(0, rates.co2 ?? chemistry.co2Decay ?? 0);
      const reaerationRate = Math.max(0, chemistry.reaerationRate ?? DEFAULT_CHEMISTRY.o2ReaerationRate);
      const degasRate = Math.max(0, chemistry.co2DegasRate ?? DEFAULT_CHEMISTRY.co2DegasRate);
      const stoichO2 = chemistry.bodnO2Factor ?? DEFAULT_CHEMISTRY.bodnO2Factor;
      const stoichCO2 = chemistry.bodnCO2Factor ?? DEFAULT_CHEMISTRY.bodnCO2Factor;
      const denitrifyFactor = chemistry.denitrificationFactor ?? DEFAULT_CHEMISTRY.denitrificationFactor;

      let bodn = typeof tank.bodn === 'number' ? tank.bodn : 0;
      const initialBodn = bodn;
      bodn = bodn * Math.exp(-bodnDecay * dt);
      bodn = Math.max(0, Math.min(10, bodn));
      const bodnLoss = Math.max(0, initialBodn - bodn);

      let o2 = typeof tank.o2 === 'number' ? tank.o2 : 0;
      let nitrate = typeof tank.nitrate === 'number' ? tank.nitrate : 0;
      let co2 = typeof tank.co2 === 'number' ? tank.co2 : 0;

      if (o2Decay > 0) o2 = o2 * Math.exp(-o2Decay * dt);
      if (nitrateDecay > 0) nitrate = nitrate * Math.exp(-nitrateDecay * dt);
      if (co2Decay > 0) co2 = co2 * Math.exp(-co2Decay * dt);

      if (bodnLoss > 0){
        if (stoichO2 > 0) o2 = Math.max(0, o2 - bodnLoss * stoichO2);
        if (stoichCO2 !== 0) co2 = Math.max(0, co2 + bodnLoss * stoichCO2);
        if (denitrifyFactor > 0){
          const reduction = Math.min(nitrate, bodnLoss * denitrifyFactor);
          nitrate = Math.max(0, nitrate - reduction);
          if (reduction > 0) co2 = Math.max(0, co2 + reduction * 0.2);
        }
      }

      if (reaerationRate > 0){
        o2 += (ambientO2 - o2) * (1 - Math.exp(-reaerationRate * dt));
      }
      if (degasRate > 0){
        co2 += (ambientCO2 - co2) * (1 - Math.exp(-degasRate * dt));
      }

      o2 = Math.max(0, Math.min(15, o2));
      nitrate = Math.max(0, Math.min(5, nitrate));
      co2 = Math.max(0, Math.min(10, co2));

      tank.bodn = bodn;
      tank.o2 = o2;
      tank.nitrate = nitrate;
      tank.co2 = co2;

      if (typeof tank.ph === 'number'){
        const neutralPh = chemistry.neutralPh ?? DEFAULT_CHEMISTRY.neutralPh;
        const co2Sens = (chemistry.co2PhSensitivity ?? chemistry.phCo2Sensitivity) ?? DEFAULT_CHEMISTRY.phCo2Sensitivity;
        const o2Sens = chemistry.phO2Sensitivity ?? DEFAULT_CHEMISTRY.phO2Sensitivity;
        const targetPh = neutralPh - co2Sens * (co2 - ambientCO2) + o2Sens * (o2 - ambientO2);
        const relaxRate = Math.max(0, chemistry.phRelaxRate ?? DEFAULT_CHEMISTRY.phRelaxRate);
        const delta = targetPh - tank.ph;
        tank.ph += relaxRate > 0 ? delta * (1 - Math.exp(-relaxRate * dt)) : delta;
        tank.ph = Math.max(0, Math.min(14, tank.ph));
      }
    });
  }

  function recordStep(simNetwork: SimulationNetwork, t: number, meta: { attacksAtT: Attack[] }): Record<string, number | string> {
    const step: Record<string, number | string> = { time: t };
    simNetwork.components.forEach(comp => {
      Object.keys(comp).forEach(key => {
        const actualValue = (comp as Record<string, unknown>)[key];
        if (typeof actualValue !== 'number' || Number.isNaN(actualValue)) return;
        let reported = actualValue;
        const poisoned = comp.poisonedReadings ? comp.poisonedReadings[key] : undefined;
        if (poisoned){
          if ((poisoned.startTime === undefined || t >= poisoned.startTime) && (poisoned.endTime === undefined || t <= poisoned.endTime)){
            reported = poisoned.value;
          }
        }
        step[`${comp.id}_${key}`] = actualValue;
        if (reported !== actualValue){
          step[`${comp.id}_${key}_reported`] = reported;
        }
      });
    });
    const describeAttack = (attack: Attack): string => {
      const base = attack.componentId ? `${attack.type}:${attack.componentId}` : attack.type;
      switch (attack.type){
        case AttackType.PhysicalDamage:
          return attack.damageType ? `${base}[${attack.damageType}]` : base;
        case AttackType.DataPoisoning:
          return attack.poisonType ? `${base}[${attack.poisonType}]` : base;
        case AttackType.ChemicalDosing:
          return `${base}[${attack.chemicalType}]`;
        case AttackType.ChemicalInterference:
          return `${base}[${attack.chemical}]`;
      }
    };
    const labels = meta.attacksAtT.map(describeAttack).filter(Boolean) as string[];
    step.active_attacks = labels.join('; ');
    return step;
  }

  function step(simNetwork: SimulationNetwork, t: number, ctx: StepContext): Record<string, number | string> {
    const { timeStep, ambientTemp, controlsAtT, attacksAtT, rules } = ctx;
    (controlsAtT || []).forEach(a => applyTimedControl(simNetwork, a));
    (attacksAtT || []).forEach(a => applyAttack(simNetwork, a));
    applyConditionalActions(simNetwork, rules || [], t);
    clearExpiredPoisoning(simNetwork, t);
    applyPumpTransfers(simNetwork, timeStep);
    applyPassiveFlows(simNetwork, timeStep);
    updateTanks(simNetwork, ambientTemp, timeStep);
    applyTankKinetics(simNetwork, timeStep);
    return recordStep(simNetwork, t, { attacksAtT: attacksAtT || [] });
  }

  function run(network: SimulationNetwork, controlActions: TimedControlAction[] = [], conditionalActions: ConditionalAction[] = [], attackScenarios: Attack[] = [], duration: number, ambientTemp: number, timeStep: number): { simNetwork: SimulationNetwork; results: Array<Record<string, number | string>> } {
    if (!Number.isFinite(duration) || duration < 0){
      throw new RangeError('Simulation duration must be a finite, non-negative number.');
    }
    if (!Number.isFinite(timeStep) || timeStep <= 0){
      throw new RangeError('Simulation timeStep must be a finite number greater than zero.');
    }
    const simNetwork = deepCopy(network);
    const results: Array<Record<string, number | string>> = [];

    const epsilon = Math.max(1e-9, timeStep * 1e-9);
    const sameTime = (left: number, right: number) => Math.abs(left - right) <= epsilon;
    const timeline: number[] = [0, duration];
    for (let index = 1; index * timeStep < duration - epsilon; index++){
      timeline.push(index * timeStep);
    }
    controlActions.forEach(action => {
      if (Number.isFinite(action.time) && action.time >= 0 && action.time <= duration){
        timeline.push(action.time);
      }
    });
    attackScenarios.forEach(attack => {
      if (Number.isFinite(attack.time) && attack.time >= 0 && attack.time <= duration){
        timeline.push(attack.time);
      }
    });
    timeline.sort((left, right) => left - right);
    const uniqueTimeline = timeline.filter((time, index) => index === 0 || !sameTime(time, timeline[index - 1]));

    updateTanks(simNetwork, ambientTemp, 0);
    uniqueTimeline.forEach((current, index) => {
      if (index > 0){
        const elapsed = current - uniqueTimeline[index - 1];
        applyPumpTransfers(simNetwork, elapsed);
        applyPassiveFlows(simNetwork, elapsed);
        updateTanks(simNetwork, ambientTemp, elapsed);
        applyTankKinetics(simNetwork, elapsed);
      }
      const controlsAtT = controlActions.filter(action => sameTime(action.time, current));
      const attacksAtT = attackScenarios.filter(attack => sameTime(attack.time, current));
      controlsAtT.forEach(action => applyTimedControl(simNetwork, action));
      attacksAtT.forEach(attack => applyAttack(simNetwork, attack));
      applyConditionalActions(simNetwork, conditionalActions, current);
      clearExpiredPoisoning(simNetwork, current);
      results.push(recordStep(simNetwork, current, { attacksAtT }));
    });
    return { simNetwork, results };
  }

  function startSimulationPure(state: SimulationState, settings: SimulationSettings): { simNetwork: SimulationNetwork; results: Array<Record<string, number | string>> } {
    const { network, controlActions = [], conditionalActions = [], attackScenarios = [] } = state;
    const { duration, ambientTemp, timeStep } = settings;
    return run(network, controlActions, conditionalActions, attackScenarios, duration, ambientTemp, timeStep);
  }

  const api: ACWAEngineAPI = {
    isValveOpen: (comp: Component) => isValveOpen(comp),
    findSourceTank,
    findDestTank,
    applyTimedControl,
    applyAttack,
    getCurrentValue,
    applyConditionalActions,
    clearExpiredPoisoning,
    applyPumpTransfers,
    applyPassiveFlows,
    updateTanks,
    recordStep,
    step,
    run,
    startSimulationPure,
    enums: {
      ComponentType,
      TankShape,
      TimedActionType,
      ConditionalOperator,
      ConditionalActionType,
      AttackType,
      ChemistryKey
    }
  };

  (window as typeof window & { ACWAEngine: ACWAEngineAPI }).ACWAEngine = api;
})();
