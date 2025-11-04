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

  function isValveOpen(comp: Component): boolean {
    return comp.type !== ComponentType.Valve || comp.isOpen !== false;
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
    | { type: 'darcy'; R: number }
    | { type: 'linear'; R: number };

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
    return { type: 'linear', R: 1e6 };
  }

  function computeFlowRateFromHead(pipe: Pipe | undefined, headDiff: number): number {
    if (!pipe) return 0;
    if (Math.abs(headDiff) < 1e-9) return 0;
    const resistance = computePipeResistance(pipe);
    const absHead = Math.abs(headDiff);
    let rate;
    if (resistance.type === 'hazen'){
      rate = Math.pow(absHead / resistance.K, 1 / resistance.n);
    } else if (resistance.type === 'darcy'){
      rate = Math.sqrt(absHead / resistance.R);
    } else {
      rate = absHead / resistance.R;
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
    if (pipe.hw){
      const n = typeof pipe.hw.n === 'number' ? pipe.hw.n : 1.852;
      const K = typeof pipe.hw.K === 'number' && pipe.hw.K > 0 ? pipe.hw.K : computeHazenK(pipe);
      return K * Math.pow(absFlow, n);
    }
    if (pipe.dw){
      const f = ensurePositive(pipe.dw.f, 0);
      const length = ensurePositive(pipe.dw.length || pipe.length, 1);
      const diameter = ensurePositive(pipe.dw.diameter || pipe.diameter, 1);
      if (f > 0){
        const coeff = (f * 8 * length) / (Math.PI * Math.PI * GRAVITY * Math.pow(diameter, 5));
        return coeff * absFlow * absFlow;
      }
    }
    if (pipe.diameter){
      const K = computeHazenK(pipe);
      return K * Math.pow(absFlow, 1.852);
    }
    const R = 1e6;
    return (absFlow * absFlow) * R;
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
      const desired = String(action.params.state ?? '').toLowerCase();
      comp.isOpen = desired === 'open';
      if (!comp.isOpen) comp.flowRate = 0;
    }
    if (action.actionType === TimedActionType.SetValveFlow && comp.type === ComponentType.Valve){
      const flow = parseFloat(action.params.flowRate ?? '0');
      comp.flowRate = isFinite(flow) ? flow : 0;
      comp.isOpen = (comp.flowRate ?? 0) > 0;
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
            targetComp.isOpen = false;
            targetComp.flowRate = 0;
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
            const desired = String(params.state ?? '').toLowerCase();
            targetComp.isOpen = desired === 'open';
            if (!targetComp.isOpen) targetComp.flowRate = 0;
          }
          break;
        case ConditionalActionType.SetValveFlow:
          if (targetComp.type === ComponentType.Valve){
            const flowRate = parseFloat(params.flowRate ?? '0');
            const rate = isFinite(flowRate) ? flowRate : 0;
            targetComp.flowRate = rate;
            targetComp.isOpen = rate > 0;
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
      const inPipe = nextIncomingTo(simNetwork, pump.id);
      const outPipe = nextOutgoingFrom(simNetwork, pump.id);
      if (!inPipe || !outPipe) return;
      const sourceEntity = findSourceEntity(simNetwork, inPipe.from);
      if (!sourceEntity) return;
      const destEntity = findDestEntity(simNetwork, outPipe.to);
      if (!destEntity || destEntity.kind !== ComponentType.Tank) return;
      const destTank: TankComponent = destEntity.comp;
      const supplyComp: TankComponent | SourceComponent = sourceEntity.comp;
      const infiniteSource = sourceEntity.kind !== ComponentType.Tank;
      const sourceHead = entityHead(sourceEntity);
      const destHead = entityHead(destEntity);
      if (sourceHead === undefined || destHead === undefined) return;
      const staticHead = destHead - sourceHead;
      const maxFlowRated = Math.max(0, pump.maxFlowRate || 0);
      const powerFactor = Math.max(0, Math.min(1, pump.power / 100));
      const efficiency = (pump.efficiency !== undefined) ? Math.max(0, Math.min(1, pump.efficiency)) : 1.0;
      let maxFlow = maxFlowRated * powerFactor * efficiency;
      if (typeof pump.maxThroughput === 'number') maxFlow = Math.min(maxFlow, pump.maxThroughput);
      if (maxFlow <= 0) return;

      function feasible(flow: number): boolean {
        const lossIn = computeHeadLoss(inPipe, flow);
        const lossOut = computeHeadLoss(outPipe, flow);
        const requiredHead = staticHead + lossIn + lossOut;
        const availableHead = computePumpHead(pump, flow);
        return availableHead >= requiredHead;
      }

      let low = 0;
      let high = maxFlow;
      let flowRate = 0;
      if (!feasible(0)) return;
      for (let iter = 0; iter < 25; iter++){
        const mid = (low + high) / 2;
        if (feasible(mid)){
          flowRate = mid;
          low = mid;
        } else {
          high = mid;
        }
        if (high - low < 1e-6) break;
      }

      let volume = flowRate * timeStep;
      if (!infiniteSource){
        const sourceTank = supplyComp as TankComponent;
        const available = sourceTank.waterAmount;
        volume = Math.min(volume, available);
      }
      if (volume <= 0) return;

      mixIntoTank(destTank, supplyComp, volume);
      if (!infiniteSource){
        const sourceTank = supplyComp as TankComponent;
        sourceTank.waterAmount -= volume;
      }
      // mixIntoTank already set destTank waterAmount, so avoid double add
    });
  }

  function applyPassiveFlows(simNetwork: SimulationNetwork, timeStep: number): void {
    (simNetwork.pipes || []).forEach(pipe => {
      const fromComp = simNetwork.components.find(c => c.id === pipe.from);
      const toComp = simNetwork.components.find(c => c.id === pipe.to);
      if (!fromComp || !toComp) return;
      if (fromComp.type === ComponentType.Pump || toComp.type === ComponentType.Pump) return;
      if ((fromComp.type === ComponentType.Valve && !isValveOpen(fromComp)) || (toComp.type === ComponentType.Valve && !isValveOpen(toComp))) return;

      let upstreamEntity = findSourceEntity(simNetwork, pipe.from);
      if (!upstreamEntity && fromComp.type === ComponentType.Source){
        upstreamEntity = { kind: ComponentType.Source, comp: fromComp as SourceComponent };
      }
      let downstreamEntity = findDestEntity(simNetwork, pipe.to);
      if (!downstreamEntity && toComp.type === ComponentType.Sink){
        downstreamEntity = { kind: ComponentType.Sink, comp: toComp as SinkComponent };
      }
      if (!upstreamEntity || !downstreamEntity) return;

      const headUp = entityHead(upstreamEntity);
      const headDown = entityHead(downstreamEntity);
      if (headUp === undefined || headDown === undefined) return;

      let flowRate = computeFlowRateFromHead(pipe, headUp - headDown);
      if (Math.abs(flowRate) < 1e-12) return;

      const direction = flowRate >= 0 ? 1 : -1;
      const fromEntity = direction >= 0 ? upstreamEntity : downstreamEntity;
      const toEntity = direction >= 0 ? downstreamEntity : upstreamEntity;
      let volume = Math.abs(flowRate) * timeStep;

      if (fromEntity.kind === ComponentType.Tank){
        const sourceTank: TankComponent = fromEntity.comp;
        volume = Math.min(volume, sourceTank.waterAmount);
      }
      if (volume <= 0) return;

      if (fromEntity.kind === ComponentType.Tank){
        const sourceTank: TankComponent = fromEntity.comp;
        sourceTank.waterAmount -= volume;
      }

      if (toEntity.kind === ComponentType.Tank){
        const destTank: TankComponent = toEntity.comp;
        if (fromEntity.kind === ComponentType.Tank){
          const tankSupply = fromEntity.comp;
          mixIntoTank(destTank, tankSupply, volume);
        } else if (fromEntity.kind === ComponentType.Source){
          const sourceSupply = fromEntity.comp;
          mixIntoTank(destTank, sourceSupply, volume);
        }
      }
    });
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
    const simNetwork = deepCopy(network);
    const results: Array<Record<string, number | string>> = [];
    for (let current = 0; current <= duration; current += timeStep){
      const controlsAtT = controlActions.filter(a => a.time === current);
      const attacksAtT = attackScenarios.filter(a => a.time === current);
      const rec = step(simNetwork, current, { timeStep, ambientTemp, controlsAtT, attacksAtT, rules: conditionalActions });
      results.push(rec);
    }
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
