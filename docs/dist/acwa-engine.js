"use strict";
// ACWA Engine: pure simulation logic for unit testing and reuse
(function () {
    const GRAVITY = 9.80665;
    let ComponentType;
    (function (ComponentType) {
        ComponentType["Tank"] = "tank";
        ComponentType["Pump"] = "pump";
        ComponentType["Valve"] = "valve";
        ComponentType["Source"] = "source";
        ComponentType["Sink"] = "sink";
        ComponentType["Junction"] = "junction";
    })(ComponentType || (ComponentType = {}));
    let TankShape;
    (function (TankShape) {
        TankShape["Cylindrical"] = "cylindrical";
        TankShape["Rectangular"] = "rectangular";
        TankShape["Spherical"] = "spherical";
    })(TankShape || (TankShape = {}));
    let ChemistryKey;
    (function (ChemistryKey) {
        ChemistryKey["O2"] = "o2";
        ChemistryKey["BODN"] = "bodn";
        ChemistryKey["Nitrate"] = "nitrate";
        ChemistryKey["CO2"] = "co2";
    })(ChemistryKey || (ChemistryKey = {}));
    let TimedActionType;
    (function (TimedActionType) {
        TimedActionType["SetPumpPower"] = "set_pump_power";
        TimedActionType["SetValveState"] = "set_valve_state";
        TimedActionType["SetValveFlow"] = "set_valve_flow";
    })(TimedActionType || (TimedActionType = {}));
    let ConditionalOperator;
    (function (ConditionalOperator) {
        ConditionalOperator["GreaterThan"] = ">";
        ConditionalOperator["LessThan"] = "<";
        ConditionalOperator["Equal"] = "==";
    })(ConditionalOperator || (ConditionalOperator = {}));
    let ConditionalActionType;
    (function (ConditionalActionType) {
        ConditionalActionType["SetPumpPower"] = "set_pump_power";
        ConditionalActionType["SetValveState"] = "set_valve_state";
        ConditionalActionType["SetValveFlow"] = "set_valve_flow";
        ConditionalActionType["EmergencyStop"] = "emergency_stop";
        ConditionalActionType["EmergencyClose"] = "emergency_close";
        ConditionalActionType["ReducePower"] = "reduce_power";
        ConditionalActionType["IncreasePower"] = "increase_power";
    })(ConditionalActionType || (ConditionalActionType = {}));
    let AttackType;
    (function (AttackType) {
        AttackType["ChemicalDosing"] = "chemical_dosing";
        AttackType["ChemicalInterference"] = "chemical_interference";
        AttackType["PhysicalDamage"] = "physical_damage";
        AttackType["DataPoisoning"] = "data_poisoning";
    })(AttackType || (AttackType = {}));
    const CHEMISTRY_KEYS = [
        ChemistryKey.O2,
        ChemistryKey.BODN,
        ChemistryKey.Nitrate,
        ChemistryKey.CO2
    ];
    const MIX_KEYS = [
        'temperature',
        'ph',
        ChemistryKey.O2,
        ChemistryKey.BODN,
        ChemistryKey.Nitrate,
        ChemistryKey.CO2
    ];
    const DEFAULT_CHEMISTRY = {
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
    function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }
    function valveOpening(comp) {
        if (!comp || comp.type !== ComponentType.Valve)
            return 1;
        if (typeof comp.opening === 'number') {
            return Math.max(0, Math.min(1, comp.opening));
        }
        return comp.isOpen === false ? 0 : 1;
    }
    function isValveOpen(comp) {
        return comp.type !== ComponentType.Valve || valveOpening(comp) > 1e-6;
    }
    function nextOutgoingFrom(simNetwork, componentId) {
        return simNetwork.pipes.find(p => p.from === componentId);
    }
    function nextIncomingTo(simNetwork, componentId) {
        return simNetwork.pipes.find(p => p.to === componentId);
    }
    function findSourceTank(simNetwork, startComponentId) {
        let current = simNetwork.components.find(c => c.id === startComponentId);
        const visited = new Set();
        while (current) {
            if (visited.has(current.id))
                break;
            visited.add(current.id);
            if (current.type === ComponentType.Tank)
                return current;
            if (current.type === ComponentType.Source)
                return current;
            if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))) {
                const currentId = current.id;
                const incomingPipe = simNetwork.pipes.find(p => p.to === currentId);
                if (!incomingPipe)
                    break;
                current = simNetwork.components.find(c => c.id === incomingPipe.from);
            }
            else {
                break;
            }
        }
        return null;
    }
    function findDestTank(simNetwork, startComponentId) {
        let current = simNetwork.components.find(c => c.id === startComponentId);
        const visited = new Set();
        while (current) {
            if (visited.has(current.id))
                break;
            visited.add(current.id);
            if (current.type === ComponentType.Tank)
                return current;
            if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))) {
                const currentId = current.id;
                const outgoingPipe = simNetwork.pipes.find(p => p.from === currentId);
                if (!outgoingPipe)
                    break;
                current = simNetwork.components.find(c => c.id === outgoingPipe.to);
            }
            else {
                break;
            }
        }
        return null;
    }
    function findSourceEntity(simNetwork, startComponentId) {
        let current = simNetwork.components.find(c => c.id === startComponentId);
        const visited = new Set();
        while (current) {
            if (visited.has(current.id))
                break;
            visited.add(current.id);
            if (current.type === ComponentType.Tank)
                return { kind: ComponentType.Tank, comp: current };
            if (current.type === ComponentType.Source)
                return { kind: ComponentType.Source, comp: current };
            if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))) {
                const currentId = current.id;
                const incomingPipe = simNetwork.pipes.find(p => p.to === currentId);
                if (!incomingPipe)
                    break;
                current = simNetwork.components.find(c => c.id === incomingPipe.from);
            }
            else {
                break;
            }
        }
        return null;
    }
    function findDestEntity(simNetwork, startComponentId) {
        let current = simNetwork.components.find(c => c.id === startComponentId);
        const visited = new Set();
        while (current) {
            if (visited.has(current.id))
                break;
            visited.add(current.id);
            if (current.type === ComponentType.Tank)
                return { kind: ComponentType.Tank, comp: current };
            if (current.type === ComponentType.Sink)
                return { kind: ComponentType.Sink, comp: current };
            if (current.type === ComponentType.Junction || (current.type === ComponentType.Valve && isValveOpen(current))) {
                const currentId = current.id;
                const outgoingPipe = simNetwork.pipes.find(p => p.from === currentId);
                if (!outgoingPipe)
                    break;
                current = simNetwork.components.find(c => c.id === outgoingPipe.to);
            }
            else {
                break;
            }
        }
        return null;
    }
    function componentHead(comp) {
        const elevation = typeof comp.baseElevation === 'number' ? comp.baseElevation :
            (typeof comp.elevation === 'number' ? comp.elevation : 0);
        if (comp.type === ComponentType.Tank) {
            return elevation + (typeof comp.waterLevel === 'number' ? comp.waterLevel : 0);
        }
        if (comp.type === ComponentType.Source) {
            if (typeof comp.head === 'number')
                return comp.head;
            if (typeof comp.waterLevel === 'number')
                return elevation + comp.waterLevel;
            return elevation;
        }
        if (comp.type === ComponentType.Sink) {
            if (typeof comp.head === 'number')
                return comp.head;
            return elevation;
        }
        return elevation;
    }
    function entityHead(entity) {
        if (!entity)
            return undefined;
        return componentHead(entity.comp);
    }
    function ensurePositive(num, fallback) {
        return (typeof num === 'number' && num > 0) ? num : fallback;
    }
    function computeHazenK(pipe) {
        const hw = pipe.hw || {};
        const length = ensurePositive(hw.length || pipe.length, 1);
        const diameter = ensurePositive(pipe.diameter, 1);
        const cValue = ensurePositive(hw.C || hw.c, 130);
        return 10.67 * length / (Math.pow(cValue, 1.852) * Math.pow(diameter, 4.8704));
    }
    function computePipeResistance(pipe) {
        if (pipe.hw) {
            const n = typeof pipe.hw.n === 'number' ? pipe.hw.n : 1.852;
            const K = typeof pipe.hw.K === 'number' && pipe.hw.K > 0 ? pipe.hw.K : computeHazenK(pipe);
            return { type: 'hazen', K, n };
        }
        if (pipe.dw) {
            const f = ensurePositive(pipe.dw.f, 0);
            const length = ensurePositive(pipe.dw.length || pipe.length, 1);
            const diameter = ensurePositive(pipe.dw.diameter || pipe.diameter, 1);
            if (f > 0) {
                const R = (f * 8 * length) / (Math.PI * Math.PI * GRAVITY * Math.pow(diameter, 5));
                if (R > 0)
                    return { type: 'darcy', R };
            }
        }
        if (pipe.diameter) {
            const K = computeHazenK(pipe);
            return { type: 'hazen', K, n: 1.852 };
        }
        return { type: 'linear', R: 1e6 };
    }
    function computeFlowRateFromHead(pipe, headDiff) {
        if (!pipe)
            return 0;
        if (Math.abs(headDiff) < 1e-9)
            return 0;
        const resistance = computePipeResistance(pipe);
        const absHead = Math.abs(headDiff);
        let rate;
        if (resistance.type === 'hazen') {
            rate = Math.pow(absHead / resistance.K, 1 / resistance.n);
        }
        else if (resistance.type === 'darcy') {
            rate = Math.sqrt(absHead / resistance.R);
        }
        else {
            rate = absHead / resistance.R;
        }
        if (typeof pipe.maxFlowRate === 'number' && pipe.maxFlowRate >= 0) {
            rate = Math.min(rate, pipe.maxFlowRate);
        }
        return headDiff >= 0 ? rate : -rate;
    }
    function computeHeadLoss(pipe, flowRate) {
        if (!pipe)
            return 0;
        const absFlow = Math.abs(flowRate);
        if (absFlow < 1e-12)
            return 0;
        if (pipe.hw) {
            const n = typeof pipe.hw.n === 'number' ? pipe.hw.n : 1.852;
            const K = typeof pipe.hw.K === 'number' && pipe.hw.K > 0 ? pipe.hw.K : computeHazenK(pipe);
            return K * Math.pow(absFlow, n);
        }
        if (pipe.dw) {
            const f = ensurePositive(pipe.dw.f, 0);
            const length = ensurePositive(pipe.dw.length || pipe.length, 1);
            const diameter = ensurePositive(pipe.dw.diameter || pipe.diameter, 1);
            if (f > 0) {
                const coeff = (f * 8 * length) / (Math.PI * Math.PI * GRAVITY * Math.pow(diameter, 5));
                return coeff * absFlow * absFlow;
            }
        }
        if (pipe.diameter) {
            const K = computeHazenK(pipe);
            return K * Math.pow(absFlow, 1.852);
        }
        const R = 1e6;
        return (absFlow * absFlow) * R;
    }
    function mixIntoTank(tank, supplyComp, volume) {
        if (volume <= 0)
            return;
        const existing = tank.waterAmount;
        const total = existing + volume;
        if (total <= 0)
            return;
        MIX_KEYS.forEach(param => {
            const supplyValue = supplyComp[param];
            const tankValue = tank[param];
            if (typeof supplyValue === 'number' && typeof tankValue === 'number') {
                tank[param] = ((tankValue * existing) + (supplyValue * volume)) / total;
            }
            else if (typeof supplyValue === 'number' && existing === 0) {
                tank[param] = supplyValue;
            }
        });
        tank.waterAmount = total;
    }
    function computePumpHead(pump, flowRate) {
        if (pump && pump.curve && Array.isArray(pump.curve) && pump.curve.length === 3) {
            const [a0, a1, a2] = pump.curve;
            return a0 + a1 * flowRate + a2 * flowRate * flowRate;
        }
        if (pump && typeof pump.headGain === 'number') {
            return pump.headGain;
        }
        const base = pump && typeof pump.baseHeadGain === 'number' ? pump.baseHeadGain : 5;
        return base * ((pump && typeof pump.power === 'number') ? pump.power / 100 : 1);
    }
    function applyTimedControl(simNetwork, action) {
        const comp = simNetwork.components.find(c => c.id === action.componentId);
        if (!comp || comp.stuck)
            return;
        if (action.actionType === TimedActionType.SetPumpPower && comp.type === ComponentType.Pump) {
            const powerValue = parseFloat(action.params.power ?? '0');
            comp.power = Math.max(0, Math.min(100, isFinite(powerValue) ? powerValue : 0));
        }
        if (action.actionType === TimedActionType.SetValveState && comp.type === ComponentType.Valve) {
            const raw = String(action.params.state ?? '').toLowerCase();
            if (raw.endsWith('%')) {
                const pct = parseFloat(raw);
                if (!Number.isNaN(pct)) {
                    comp.opening = Math.max(0, Math.min(1, pct / 100));
                    comp.isOpen = comp.opening > 1e-6;
                    if (!comp.isOpen)
                        comp.flowRate = 0;
                }
            }
            else {
                const numeric = parseFloat(raw);
                if (!Number.isNaN(numeric)) {
                    const opening = Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
                    comp.opening = opening;
                    comp.isOpen = opening > 1e-6;
                    if (!comp.isOpen)
                        comp.flowRate = 0;
                }
                else {
                    comp.isOpen = raw === 'open';
                    comp.opening = comp.isOpen ? 1 : 0;
                    if (!comp.isOpen)
                        comp.flowRate = 0;
                }
            }
        }
        if (action.actionType === TimedActionType.SetValveFlow && comp.type === ComponentType.Valve) {
            const flow = parseFloat(action.params.flowRate ?? '0');
            const numericFlow = isFinite(flow) ? flow : 0;
            comp.flowRate = numericFlow;
            comp.isOpen = numericFlow > 0;
            if (typeof comp.maxFlowRate === 'number' && comp.maxFlowRate > 0) {
                comp.opening = Math.max(0, Math.min(1, Math.abs(numericFlow) / comp.maxFlowRate));
            }
            else {
                comp.opening = comp.isOpen ? 1 : 0;
            }
        }
    }
    function applyAttack(simNetwork, attack) {
        const comp = simNetwork.components.find(c => c.id === attack.componentId);
        if (!comp)
            return;
        switch (attack.type) {
            case AttackType.ChemicalDosing:
                if (comp.type === ComponentType.Tank || comp.type === ComponentType.Source) {
                    const rawAmount = typeof attack.amount === 'number' ? attack.amount : 1.5;
                    const amount = Math.max(0, rawAmount);
                    if (attack.chemicalType === 'acid')
                        comp.ph = Math.max(0, (comp.ph ?? 7) - amount);
                    if (attack.chemicalType === 'base')
                        comp.ph = Math.min(14, (comp.ph ?? 7) + amount);
                }
                break;
            case AttackType.ChemicalInterference:
                if (comp.type === ComponentType.Tank || comp.type === ComponentType.Source) {
                    if (attack.chemical === 'O2')
                        comp.o2 = Math.max(0, Math.min(15, (comp.o2 ?? 0) + attack.amount));
                    if (attack.chemical === 'BODn')
                        comp.bodn = Math.max(0, Math.min(10, (comp.bodn ?? 0) + attack.amount));
                    if (attack.chemical === 'nitrate')
                        comp.nitrate = Math.max(0, Math.min(5, (comp.nitrate ?? 0) + attack.amount));
                    if (attack.chemical === 'CO2')
                        comp.co2 = Math.max(0, Math.min(10, (comp.co2 ?? 0) + attack.amount));
                }
                break;
            case AttackType.PhysicalDamage:
                if (attack.damageType === 'pump_failure' && comp.type === ComponentType.Pump) {
                    comp.power = 0;
                    comp.efficiency = 0;
                    comp.stuck = true; // Prevent future control until manual reset
                }
                if (attack.damageType === 'valve_stuck' && comp.type === ComponentType.Valve) {
                    comp.isOpen = false;
                    comp.flowRate = 0;
                    comp.opening = 0;
                    comp.stuck = true; // Prevent future control until manual reset
                }
                if (attack.damageType === 'leak' && comp.type === ComponentType.Tank) {
                    comp.waterAmount *= 0.95;
                    comp.stuck = true; // Mark tank as damaged
                }
                break;
            case AttackType.DataPoisoning:
                if (!comp.poisonedReadings)
                    comp.poisonedReadings = {};
                comp.poisonedReadings[attack.poisonType] = {
                    value: attack.value,
                    startTime: attack.time,
                    endTime: attack.time + attack.duration
                };
                break;
        }
    }
    function getCurrentValue(sourceComp, key, t) {
        const baseValue = sourceComp[key];
        let v = typeof baseValue === 'number' ? baseValue : undefined;
        const poisoned = sourceComp.poisonedReadings ? sourceComp.poisonedReadings[key] : undefined;
        if (poisoned) {
            if ((poisoned.startTime === undefined || t >= poisoned.startTime) && (poisoned.endTime === undefined || t <= poisoned.endTime)) {
                v = poisoned.value;
            }
        }
        return v;
    }
    function applyConditionalActions(simNetwork, rules, t) {
        rules.forEach(rule => {
            const sourceComp = simNetwork.components.find(c => c.id === rule.source.componentId);
            if (!sourceComp)
                return;
            const currentValue = getCurrentValue(sourceComp, rule.source.value, t);
            let ok = false;
            switch (rule.condition.operator) {
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
            if (!ok)
                return;
            const targetComp = simNetwork.components.find(c => c.id === rule.target.componentId);
            if (!targetComp || targetComp.stuck)
                return;
            const params = rule.target.params || {};
            switch (rule.target.actionType) {
                case ConditionalActionType.SetPumpPower:
                    if (targetComp.type === ComponentType.Pump) {
                        const powerValue = parseFloat(params.power ?? '0');
                        targetComp.power = Math.max(0, Math.min(100, isFinite(powerValue) ? powerValue : 0));
                    }
                    break;
                case ConditionalActionType.EmergencyStop:
                    if (targetComp.type === ComponentType.Pump) {
                        targetComp.power = 0;
                    }
                    break;
                case ConditionalActionType.EmergencyClose:
                    if (targetComp.type === ComponentType.Valve) {
                        targetComp.isOpen = false;
                        targetComp.flowRate = 0;
                        targetComp.opening = 0;
                    }
                    break;
                case ConditionalActionType.ReducePower:
                    if (targetComp.type === ComponentType.Pump) {
                        const reduceAmount = parseFloat(params.power ?? '50');
                        const delta = isFinite(reduceAmount) ? reduceAmount : 0;
                        targetComp.power = Math.max(0, (targetComp.power ?? 0) - delta);
                    }
                    break;
                case ConditionalActionType.IncreasePower:
                    if (targetComp.type === ComponentType.Pump) {
                        const increaseAmount = parseFloat(params.power ?? '100');
                        const delta = isFinite(increaseAmount) ? increaseAmount : 0;
                        targetComp.power = Math.min(100, (targetComp.power ?? 0) + delta);
                    }
                    break;
                case ConditionalActionType.SetValveState:
                    if (targetComp.type === ComponentType.Valve) {
                        const raw = String(params.state ?? '').toLowerCase();
                        if (raw.endsWith('%')) {
                            const pct = parseFloat(raw);
                            if (!Number.isNaN(pct)) {
                                targetComp.opening = Math.max(0, Math.min(1, pct / 100));
                                targetComp.isOpen = targetComp.opening > 1e-6;
                                if (!targetComp.isOpen)
                                    targetComp.flowRate = 0;
                            }
                        }
                        else {
                            const numeric = parseFloat(raw);
                            if (!Number.isNaN(numeric)) {
                                const opening = Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
                                targetComp.opening = opening;
                                targetComp.isOpen = opening > 1e-6;
                                if (!targetComp.isOpen)
                                    targetComp.flowRate = 0;
                            }
                            else {
                                targetComp.isOpen = raw === 'open';
                                targetComp.opening = targetComp.isOpen ? 1 : 0;
                                if (!targetComp.isOpen)
                                    targetComp.flowRate = 0;
                            }
                        }
                    }
                    break;
                case ConditionalActionType.SetValveFlow:
                    if (targetComp.type === ComponentType.Valve) {
                        const flowRate = parseFloat(params.flowRate ?? '0');
                        const rate = isFinite(flowRate) ? flowRate : 0;
                        targetComp.flowRate = rate;
                        targetComp.isOpen = rate > 0;
                        if (typeof targetComp.maxFlowRate === 'number' && targetComp.maxFlowRate > 0) {
                            targetComp.opening = Math.max(0, Math.min(1, Math.abs(rate) / targetComp.maxFlowRate));
                        }
                        else {
                            targetComp.opening = targetComp.isOpen ? 1 : 0;
                        }
                    }
                    break;
            }
        });
    }
    function clearExpiredPoisoning(simNetwork, t) {
        simNetwork.components.forEach(comp => {
            const readings = comp.poisonedReadings;
            if (!readings)
                return;
            Object.entries(readings).forEach(([key, poisoning]) => {
                if (poisoning && poisoning.endTime !== undefined && t > poisoning.endTime) {
                    delete readings[key];
                }
            });
        });
    }
    function applyPumpTransfers(simNetwork, timeStep) {
        const pumps = simNetwork.components.filter((c) => c.type === ComponentType.Pump);
        pumps.forEach(pump => {
            if ((pump.power ?? 0) <= 0)
                return;
            const inPipe = nextIncomingTo(simNetwork, pump.id);
            const outPipe = nextOutgoingFrom(simNetwork, pump.id);
            if (!inPipe || !outPipe)
                return;
            const sourceEntity = findSourceEntity(simNetwork, inPipe.from);
            if (!sourceEntity)
                return;
            const destEntity = findDestEntity(simNetwork, outPipe.to);
            if (!destEntity || destEntity.kind !== ComponentType.Tank)
                return;
            const destTank = destEntity.comp;
            const supplyComp = sourceEntity.comp;
            const infiniteSource = sourceEntity.kind !== ComponentType.Tank;
            const sourceHead = entityHead(sourceEntity);
            const destHead = entityHead(destEntity);
            if (sourceHead === undefined || destHead === undefined)
                return;
            const staticHead = destHead - sourceHead;
            const maxFlowRated = Math.max(0, pump.maxFlowRate || 0);
            const powerFactor = Math.max(0, Math.min(1, pump.power / 100));
            const efficiency = (pump.efficiency !== undefined) ? Math.max(0, Math.min(1, pump.efficiency)) : 1.0;
            const inFromComp = simNetwork.components.find(c => c.id === inPipe.from);
            const inToComp = simNetwork.components.find(c => c.id === inPipe.to);
            const outFromComp = simNetwork.components.find(c => c.id === outPipe.from);
            const outToComp = simNetwork.components.find(c => c.id === outPipe.to);
            const valveFactor = Math.min(valveOpening(inFromComp), valveOpening(inToComp), valveOpening(outFromComp), valveOpening(outToComp));
            if (valveFactor <= 1e-6)
                return;
            let maxFlow = maxFlowRated * powerFactor * efficiency * valveFactor;
            if (typeof pump.maxThroughput === 'number')
                maxFlow = Math.min(maxFlow, pump.maxThroughput);
            if (maxFlow <= 0)
                return;
            function feasible(flow) {
                const lossIn = computeHeadLoss(inPipe, flow);
                const lossOut = computeHeadLoss(outPipe, flow);
                const requiredHead = staticHead + lossIn + lossOut;
                const availableHead = computePumpHead(pump, flow);
                return availableHead >= requiredHead;
            }
            let low = 0;
            let high = maxFlow;
            let flowRate = 0;
            if (!feasible(0))
                return;
            for (let iter = 0; iter < 25; iter++) {
                const mid = (low + high) / 2;
                if (feasible(mid)) {
                    flowRate = mid;
                    low = mid;
                }
                else {
                    high = mid;
                }
                if (high - low < 1e-6)
                    break;
            }
            let volume = flowRate * timeStep;
            if (!infiniteSource) {
                const sourceTank = supplyComp;
                const available = sourceTank.waterAmount;
                volume = Math.min(volume, available);
            }
            if (volume <= 0)
                return;
            mixIntoTank(destTank, supplyComp, volume);
            if (!infiniteSource) {
                const sourceTank = supplyComp;
                sourceTank.waterAmount -= volume;
            }
            // mixIntoTank already set destTank waterAmount, so avoid double add
        });
    }
    function applyPassiveFlows(simNetwork, timeStep) {
        (simNetwork.pipes || []).forEach(pipe => {
            const fromComp = simNetwork.components.find(c => c.id === pipe.from);
            const toComp = simNetwork.components.find(c => c.id === pipe.to);
            if (!fromComp || !toComp)
                return;
            if (fromComp.type === ComponentType.Pump || toComp.type === ComponentType.Pump)
                return;
            const valveFactor = Math.min(valveOpening(fromComp), valveOpening(toComp));
            if (valveFactor <= 1e-6)
                return;
            let upstreamEntity = findSourceEntity(simNetwork, pipe.from);
            if (!upstreamEntity && fromComp.type === ComponentType.Source) {
                upstreamEntity = { kind: ComponentType.Source, comp: fromComp };
            }
            let downstreamEntity = findDestEntity(simNetwork, pipe.to);
            if (!downstreamEntity && toComp.type === ComponentType.Sink) {
                downstreamEntity = { kind: ComponentType.Sink, comp: toComp };
            }
            if (!upstreamEntity || !downstreamEntity)
                return;
            const headUp = entityHead(upstreamEntity);
            const headDown = entityHead(downstreamEntity);
            if (headUp === undefined || headDown === undefined)
                return;
            let flowRate = computeFlowRateFromHead(pipe, headUp - headDown) * valveFactor;
            if (Math.abs(flowRate) < 1e-12)
                return;
            const direction = flowRate >= 0 ? 1 : -1;
            const fromEntity = direction >= 0 ? upstreamEntity : downstreamEntity;
            const toEntity = direction >= 0 ? downstreamEntity : upstreamEntity;
            let volume = Math.abs(flowRate) * timeStep;
            if (fromEntity.kind === ComponentType.Tank) {
                const sourceTank = fromEntity.comp;
                volume = Math.min(volume, sourceTank.waterAmount);
            }
            if (volume <= 0)
                return;
            if (fromEntity.kind === ComponentType.Tank) {
                const sourceTank = fromEntity.comp;
                sourceTank.waterAmount -= volume;
            }
            if (toEntity.kind === ComponentType.Tank) {
                const destTank = toEntity.comp;
                if (fromEntity.kind === ComponentType.Tank) {
                    const tankSupply = fromEntity.comp;
                    mixIntoTank(destTank, tankSupply, volume);
                }
                else if (fromEntity.kind === ComponentType.Source) {
                    const sourceSupply = fromEntity.comp;
                    mixIntoTank(destTank, sourceSupply, volume);
                }
            }
        });
    }
    function updateTanks(simNetwork, ambientTemp, timeStep) {
        const tanks = simNetwork.components.filter((c) => c.type === ComponentType.Tank);
        tanks.forEach(tank => {
            const shape = tank.shape ?? TankShape.Cylindrical;
            let area;
            if (shape === TankShape.Rectangular) {
                const width = (typeof tank.width === 'number' && tank.width > 0) ? tank.width : 1;
                const depth = (typeof tank.height === 'number' && tank.height > 0) ? tank.height : 1;
                area = width * depth;
            }
            else {
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
    function applyTankKinetics(simNetwork, timeStep) {
        const dt = Math.max(0, timeStep);
        if (dt === 0)
            return;
        const tanks = simNetwork.components.filter((c) => c.type === ComponentType.Tank);
        tanks.forEach(tank => {
            const chemistry = tank.chemistry || {};
            const reactionsEnabled = !!chemistry.enableReactions;
            const rates = tank.decayRates || {};
            if (!reactionsEnabled) {
                CHEMISTRY_KEYS.forEach(key => {
                    const rate = rates[key];
                    if (rate !== undefined && typeof tank[key] === 'number') {
                        const k = Math.max(0, rate);
                        tank[key] = tank[key] * Math.exp(-k * dt);
                    }
                });
                if (typeof tank.o2 === 'number')
                    tank.o2 = Math.max(0, Math.min(15, tank.o2));
                if (typeof tank.bodn === 'number')
                    tank.bodn = Math.max(0, Math.min(10, tank.bodn));
                if (typeof tank.nitrate === 'number')
                    tank.nitrate = Math.max(0, Math.min(5, tank.nitrate));
                if (typeof tank.co2 === 'number')
                    tank.co2 = Math.max(0, Math.min(10, tank.co2));
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
            if (o2Decay > 0)
                o2 = o2 * Math.exp(-o2Decay * dt);
            if (nitrateDecay > 0)
                nitrate = nitrate * Math.exp(-nitrateDecay * dt);
            if (co2Decay > 0)
                co2 = co2 * Math.exp(-co2Decay * dt);
            if (bodnLoss > 0) {
                if (stoichO2 > 0)
                    o2 = Math.max(0, o2 - bodnLoss * stoichO2);
                if (stoichCO2 !== 0)
                    co2 = Math.max(0, co2 + bodnLoss * stoichCO2);
                if (denitrifyFactor > 0) {
                    const reduction = Math.min(nitrate, bodnLoss * denitrifyFactor);
                    nitrate = Math.max(0, nitrate - reduction);
                    if (reduction > 0)
                        co2 = Math.max(0, co2 + reduction * 0.2);
                }
            }
            if (reaerationRate > 0) {
                o2 += (ambientO2 - o2) * (1 - Math.exp(-reaerationRate * dt));
            }
            if (degasRate > 0) {
                co2 += (ambientCO2 - co2) * (1 - Math.exp(-degasRate * dt));
            }
            o2 = Math.max(0, Math.min(15, o2));
            nitrate = Math.max(0, Math.min(5, nitrate));
            co2 = Math.max(0, Math.min(10, co2));
            tank.bodn = bodn;
            tank.o2 = o2;
            tank.nitrate = nitrate;
            tank.co2 = co2;
            if (typeof tank.ph === 'number') {
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
    function recordStep(simNetwork, t, meta) {
        const step = { time: t };
        simNetwork.components.forEach(comp => {
            Object.keys(comp).forEach(key => {
                const actualValue = comp[key];
                if (typeof actualValue !== 'number' || Number.isNaN(actualValue))
                    return;
                let reported = actualValue;
                const poisoned = comp.poisonedReadings ? comp.poisonedReadings[key] : undefined;
                if (poisoned) {
                    if ((poisoned.startTime === undefined || t >= poisoned.startTime) && (poisoned.endTime === undefined || t <= poisoned.endTime)) {
                        reported = poisoned.value;
                    }
                }
                step[`${comp.id}_${key}`] = actualValue;
                if (reported !== actualValue) {
                    step[`${comp.id}_${key}_reported`] = reported;
                }
            });
        });
        const describeAttack = (attack) => {
            const base = attack.componentId ? `${attack.type}:${attack.componentId}` : attack.type;
            switch (attack.type) {
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
        const labels = meta.attacksAtT.map(describeAttack).filter(Boolean);
        step.active_attacks = labels.join('; ');
        return step;
    }
    function step(simNetwork, t, ctx) {
        const { timeStep, ambientTemp, controlsAtT, attacksAtT, rules } = ctx;
        (controlsAtT || []).forEach(a => applyTimedControl(simNetwork, a));
        (attacksAtT || []).forEach(a => applyAttack(simNetwork, a));
        applyConditionalActions(simNetwork, rules || [], t);
        clearExpiredPoisoning(simNetwork, t);
        // Iterative hydraulic solver: solve network continuity and energy relations iteratively
        // The solver iterates to refine flow calculations based on updated head distribution
        // This ensures mass balance at junctions and energy balance around loops
        const tanks = simNetwork.components.filter((c) => c.type === ComponentType.Tank);
        const needsIteration = tanks.length > 1 && simNetwork.pipes.some(p => {
            const fromTank = tanks.find(t => t.id === p.from);
            const toTank = tanks.find(t => t.id === p.to);
            return fromTank && toTank;
        });
        const maxIterations = needsIteration ? 3 : 1;
        const convergenceTolerance = 1e-2;
        const initialWaterAmounts = tanks.map(t => t.waterAmount);
        for (let iter = 0; iter < maxIterations; iter++) {
            const prevWaterAmounts = tanks.map(t => t.waterAmount);
            applyPumpTransfers(simNetwork, timeStep);
            applyPassiveFlows(simNetwork, timeStep);
            updateTanks(simNetwork, ambientTemp, timeStep);
            let maxChange = 0;
            tanks.forEach((tank, idx) => {
                const change = Math.abs(tank.waterAmount - prevWaterAmounts[idx]);
                if (change > maxChange)
                    maxChange = change;
            });
            if (maxChange < convergenceTolerance * timeStep)
                break;
            if (iter < maxIterations - 1 && needsIteration) {
                tanks.forEach((tank, idx) => {
                    tank.waterAmount = initialWaterAmounts[idx];
                });
                updateTanks(simNetwork, ambientTemp, 0);
            }
        }
        // Apply water quality kinetics after hydraulic convergence
        applyTankKinetics(simNetwork, timeStep);
        return recordStep(simNetwork, t, { attacksAtT: attacksAtT || [] });
    }
    function run(network, controlActions = [], conditionalActions = [], attackScenarios = [], duration, ambientTemp, timeStep) {
        const simNetwork = deepCopy(network);
        const results = [];
        for (let current = 0; current <= duration; current += timeStep) {
            const controlsAtT = controlActions.filter(a => a.time === current);
            const attacksAtT = attackScenarios.filter(a => a.time === current);
            const rec = step(simNetwork, current, { timeStep, ambientTemp, controlsAtT, attacksAtT, rules: conditionalActions });
            results.push(rec);
        }
        return { simNetwork, results };
    }
    function startSimulationPure(state, settings) {
        const { network, controlActions = [], conditionalActions = [], attackScenarios = [] } = state;
        const { duration, ambientTemp, timeStep } = settings;
        return run(network, controlActions, conditionalActions, attackScenarios, duration, ambientTemp, timeStep);
    }
    const api = {
        isValveOpen: (comp) => isValveOpen(comp),
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
    window.ACWAEngine = api;
})();
//# sourceMappingURL=acwa-engine.js.map