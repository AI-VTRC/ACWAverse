const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function loadEngine() {
  const context = { console, window: {} };
  vm.createContext(context);
  const enginePath = path.resolve(__dirname, '../dist/acwa-engine.js');
  if (!fs.existsSync(enginePath)){
    throw new Error('Compiled engine not found at ' + enginePath + '. Run `npm run build` before executing tests.');
  }
  const engineCode = fs.readFileSync(enginePath, 'utf8');
  vm.runInContext(engineCode, context, { filename: 'acwa-engine.js' });
  return context.window.ACWAEngine;
}

function approxEqual(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

async function main() {
  const E = loadEngine();
  let failed = 0;
  let passed = 0;
  function test(name, fn){
    try { fn(); console.log('PASS', name); passed++; }
    catch (e) { console.error('FAIL', name, e.stack || e); failed++; }
  }

  test('isValveOpen logic', () => {
    assert.strictEqual(E.isValveOpen({type:'valve', isOpen:false}), false);
    assert.strictEqual(E.isValveOpen({type:'valve', isOpen:true}), true);
    assert.strictEqual(E.isValveOpen({type:'junction'}), true);
  });

  test('getCurrentValue respects poisoning window', () => {
    const comp = { waterLevel: 5, poisonedReadings: { waterLevel: { value: 9, startTime: 10, endTime: 20 } } };
    assert.strictEqual(E.getCurrentValue(comp, 'waterLevel', 5), 5);
    assert.strictEqual(E.getCurrentValue(comp, 'waterLevel', 15), 9);
    assert.strictEqual(E.getCurrentValue(comp, 'waterLevel', 25), 5);
  });

  test('applyTimedControl sets pump power and valve state', () => {
    const net = { components: [ { id:'p1', type:'pump', power:0 }, { id:'v1', type:'valve', isOpen:true, flowRate:1 } ], pipes: [] };
    E.applyTimedControl(net, { componentId:'p1', actionType:'set_pump_power', params:{power:'80'} });
    assert.strictEqual(net.components[0].power, 80);
    E.applyTimedControl(net, { componentId:'v1', actionType:'set_valve_state', params:{state:'closed'} });
    assert.strictEqual(net.components[1].isOpen, false);
    assert.strictEqual(net.components[1].flowRate, 0);
    // Test new set_valve_flow action
    E.applyTimedControl(net, { componentId:'v1', actionType:'set_valve_flow', params:{flowRate:'2.5'} });
    assert.strictEqual(net.components[1].flowRate, 2.5);
    assert.strictEqual(net.components[1].isOpen, true);
  });

  test('applyAttack dosing clamps pH to [0,14]', () => {
    const net = { components:[ { id:'t1', type:'tank', ph: 13 } ], pipes: [] };
    E.applyAttack(net, { type:'chemical_dosing', componentId:'t1', chemicalType:'base' });
    assert.strictEqual(net.components[0].ph, 14);
    E.applyAttack(net, { type:'chemical_dosing', componentId:'t1', chemicalType:'acid' });
    assert.ok(approxEqual(net.components[0].ph, 12.5));
  });

  test('find source/dest tanks across valves/junctions', () => {
    const comps = [ {id:'t1', type:'tank'}, {id:'j1', type:'junction'}, {id:'v1', type:'valve', isOpen:true}, {id:'t2', type:'tank'} ];
    const pipes = [ {from:'t1', to:'j1'}, {from:'j1', to:'v1'}, {from:'v1', to:'t2'} ];
    const net = { components: comps, pipes };
    assert.strictEqual(E.findDestTank(net, 'j1').id, 't2');
    assert.strictEqual(E.findSourceTank(net, 'j1').id, 't1');
  });

  function makeTiny(){
    return {
      network: {
        components: [
          { id:'src', type:'source' },
          { id:'j', type:'junction' },
          { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:0, waterAmount:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
          { id:'p', type:'pump', maxFlowRate:0.5, power:0 },
          { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:0, waterAmount:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
        ],
        pipes: [ {id:'a', from:'src', to:'j'}, {id:'b', from:'j', to:'tA'}, {id:'c', from:'tA', to:'p'}, {id:'d', from:'p', to:'tB'} ]
      },
      controlActions: [], conditionalActions: [], attackScenarios: []
    };
  }

  function hazenFlow(headDiff, K, n){
    if (headDiff <= 0) return 0;
    return Math.pow(headDiff / K, 1 / n);
  }

  test('gravity flow follows Hazen-Williams head-loss relationship', () => {
    const network = {
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:4, waterLevel:2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'j', type:'junction' },
        { id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [
        { id:'p', from:'t1', to:'j', hw:{ K:4.0, n:1.852 } },
        { id:'p2', from:'j', to:'t2' }
      ]
    };
    const out = E.run(network, [], [], [], 0, 20, 1);
    const expectedFlow = hazenFlow(2, 4.0, 1.852);
    const t1 = out.results[0]['t1_waterAmount'];
    const t2 = out.results[0]['t2_waterAmount'];
    assert.ok(Math.abs(t1 - (4 - expectedFlow)) < 5e-6);
    assert.ok(Math.abs(t2 - expectedFlow) < 5e-6);
  });

  function solvePumpFlow(pump, inPipe, outPipe, sourceHead, destHead){
    const GRAV = 9.80665;
    function headLoss(pipe, q){
      const absQ = Math.abs(q);
      if (pipe.hw){
        const n = pipe.hw.n !== undefined ? pipe.hw.n : 1.852;
        const K = pipe.hw.K !== undefined ? pipe.hw.K : 1;
        return K * Math.pow(absQ, n);
      }
      if (pipe.dw){
        const f = pipe.dw.f || 0;
        const length = pipe.dw.length || 1;
        const diameter = pipe.dw.diameter || 1;
        const coeff = (f * 8 * length) / (Math.PI * Math.PI * GRAV * Math.pow(diameter, 5));
        return coeff * absQ * absQ;
      }
      return 0;
    }
    function pumpHead(q){
      if (pump.curve && pump.curve.length === 3){
        const [a0,a1,a2] = pump.curve;
        return a0 + a1*q + a2*q*q;
      }
      if (pump.headGain) return pump.headGain;
      return 0;
    }
    const staticHead = destHead - sourceHead;
    let low = 0;
    let high = pump.maxFlowRate || 1;
    let best = 0;
    for (let i=0;i<30;i++){
      const mid = (low + high) / 2;
      const losses = headLoss(inPipe, mid) + headLoss(outPipe, mid);
      if (pumpHead(mid) >= staticHead + losses){
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    return best;
  }

  test('pump transfer matches pump curve and mixes chemistry', () => {
    const network = {
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:1, waterAmount:2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:1, power:100, curve:[5, -2, 0] },
        { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:0.2, waterAmount:1, temperature:10, ph:6, o2:5, bodn:4, nitrate:2, co2:3 }
      ],
      pipes: [
        {id:'c', from:'tA', to:'p', hw:{K:1.5, n:1.852}},
        {id:'d', from:'p', to:'tB', hw:{K:1.5, n:1.852}}
      ]
    };
    const expectedFlow = solvePumpFlow(network.components[1], network.pipes[0], network.pipes[1], 1, 0.2);
    const controlActions = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const out = E.run(network, controlActions, [], [], 0, 20, 1);
    const afterA = out.simNetwork.components.find(c=>c.id==='tA');
    const delivered = 2 - afterA.waterAmount;
    assert.ok(Math.abs(delivered - expectedFlow) < 1e-3);
    const afterB = out.simNetwork.components.find(c=>c.id==='tB');
    const total = 1 + expectedFlow;
    const expectedPh = ((6 * 1) + (7 * expectedFlow)) / total;
    assert.ok(Math.abs(afterB.ph - expectedPh) < 1e-6);
  });

  test('pump can draw directly from a source', () => {
    const network = {
      components: [
        { id:'src', type:'source', temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'v', type:'valve', isOpen:true },
        { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0, temperature:15, ph:6.5, o2:7, bodn:3, nitrate:1.5, co2:6 }
      ],
      pipes: [
        { from:'src', to:'p' },
        { from:'p', to:'v' },
        { from:'v', to:'t' }
      ]
    };
    const controls = [ { time:0, componentId:'p', actionType:'set_pump_power', params:{ power:'100' } } ];
    const out = E.run(network, controls, [], [], 0, 20, 1);
    const first = out.results[0];
    assert.ok(first['t_waterAmount'] > 0);
    assert.ok(first['t_temperature'] > 15); // mixed with source temperature
  });

  test('higher Hazen resistance reduces gravity flow', () => {
    const baseNetwork = (K) => ({
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:1.5, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'mid', type:'junction' },
        { id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0.2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [
        { id:'p1', from:'t1', to:'mid', hw:{K, n:1.852} },
        { id:'p2', from:'mid', to:'t2' }
      ]
    });
    const lowLoss = baseNetwork(0.5);
    const highLoss = baseNetwork(3.0);
    const outLow = E.run(lowLoss, [], [], [], 0, 20, 1);
    const outHigh = E.run(highLoss, [], [], [], 0, 20, 1);
    assert.ok(outLow.results[0]['t2_waterAmount'] > outHigh.results[0]['t2_waterAmount']);
  });

  test('increased pipe resistance lowers pump transfer rate', () => {
    const build = (K) => ({
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2.0, waterLevel:1.5, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:1, power:100, curve:[6,-3,0] },
        { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0.5, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [
        { from:'tA', to:'p', hw:{K, n:1.852}},
        { from:'p', to:'tB', hw:{K, n:1.852}}
      ]
    });
    const low = build(0.4);
    const high = build(2.5);
    const ctrl = [ { time:0, componentId:'p', actionType:'set_pump_power', params:{ power:'100' } } ];
    const lowResult = E.run(low, ctrl, [], [], 0, 20, 1);
    const highResult = E.run(high, ctrl, [], [], 0, 20, 1);
    const flowLow = 2 - lowResult.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    const flowHigh = 2 - highResult.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    assert.ok(flowLow > flowHigh);
  });

  test('data poisoning overrides recorded value in window only', () => {
    const tiny = makeTiny();
    tiny.attackScenarios.push({time:0, type:'data_poisoning', componentId:'tA', poisonType:'waterLevel', value:9, duration:5});
    const out = E.run(tiny.network, tiny.controlActions, tiny.conditionalActions, tiny.attackScenarios, 10, 20, 1);
    const rows = out.results;
    assert.notStrictEqual(rows[0]['tA_waterLevel'], 9);
    assert.strictEqual(rows[0]['tA_waterLevel_reported'], 9);
    assert.strictEqual(rows[5]['tA_waterLevel_reported'], 9);
    assert.strictEqual(rows[6]['tA_waterLevel_reported'], undefined);
  });

  test('valve closed blocks traversal', () => {
    const net = {
      components: [
        {id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:0, waterAmount:1, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5},
        {id:'v', type:'valve', isOpen:false},
        {id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterLevel:0, waterAmount:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5}
      ],
      pipes: [ {from:'t1', to:'v'}, {from:'v', to:'t2'} ]
    };
    const st = { network: net, controlActions: [], conditionalActions: [], attackScenarios: [] };
    const out = E.run(st.network, st.controlActions, st.conditionalActions, st.attackScenarios, 10, 20, 1);
    const last = out.results[out.results.length-1];
    assert.ok(approxEqual(last['t1_waterAmount'], 1.0));
  });

  test('startSimulationPure mirrors run()', () => {
    const tiny = makeTiny();
    const a = E.run(tiny.network, tiny.controlActions, tiny.conditionalActions, tiny.attackScenarios, 5, 20, 1);
    const b = E.startSimulationPure({ network: tiny.network, controlActions: tiny.controlActions, conditionalActions: tiny.conditionalActions, attackScenarios: tiny.attackScenarios }, { duration:5, ambientTemp:20, timeStep:1 });
    assert.strictEqual(a.results.length, b.results.length);
    assert.deepStrictEqual(Object.keys(a.results[5]), Object.keys(b.results[5]));
  });

  // --- Cyber-attack scenarios ---
  test('chemical_dosing acid clamps at 0 and base clamps at 14', () => {
    const net = { components:[ { id:'t', type:'tank', ph: 0.2 } ], pipes: [] };
    E.applyAttack(net, { type:'chemical_dosing', componentId:'t', chemicalType:'acid' });
    assert.strictEqual(net.components[0].ph, 0);
    const net2 = { components:[ { id:'t', type:'tank', ph: 13.4 } ], pipes: [] };
    E.applyAttack(net2, { type:'chemical_dosing', componentId:'t', chemicalType:'base' });
    assert.strictEqual(net2.components[0].ph, 14);
  });

  test('chemical_dosing applies configured magnitude', () => {
    const net = { components:[ { id:'t', type:'tank', ph: 6.5 } ], pipes: [] };
    E.applyAttack(net, { type:'chemical_dosing', componentId:'t', chemicalType:'acid', amount: 2 });
    assert.strictEqual(net.components[0].ph, 4.5);
    const net2 = { components:[ { id:'s', type:'source', ph: 6 } ], pipes: [] };
    E.applyAttack(net2, { type:'chemical_dosing', componentId:'s', chemicalType:'base', amount: 2.25 });
    assert.strictEqual(net2.components[0].ph, 8.25);
  });

  test('chemical_interference clamps O2/BODn/nitrate/CO2 within bounds', () => {
    const t = { id:'t', type:'tank', o2:14, bodn:9.5, nitrate:4.9, co2:9.8 };
    const net = { components:[t], pipes:[] };
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'O2', amount: 5 });
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'BODn', amount: 2 });
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'nitrate', amount: 2 });
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'CO2', amount: 2 });
    assert.strictEqual(t.o2, 15);
    assert.strictEqual(t.bodn, 10);
    assert.strictEqual(t.nitrate, 5);
    assert.strictEqual(t.co2, 10);
    // negative clamp
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'O2', amount: -20 });
    assert.strictEqual(t.o2, 0);
  });

  test('physical_damage pump_failure prevents future control actions (fixed behavior)', () => {
    const network = {
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'tA', to:'p'}, {from:'p', to:'tB'} ]
    };
    const controlActions = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}}, {time:1, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const attacks = [ {time:0, type:'physical_damage', componentId:'p', damageType:'pump_failure'} ];
    const out = E.run(network, controlActions, [], attacks, 2, 20, 1);
    const rows = out.results;
    // No transfer occurs at any time - pump stays failed and stuck
    assert.ok(approxEqual(rows[0]['tA_waterAmount'], 2)); // no transfer at t=0
    assert.ok(approxEqual(rows[1]['tA_waterAmount'], 2)); // no transfer at t=1
    assert.ok(approxEqual(rows[2]['tA_waterAmount'], 2)); // no transfer at t=2
    // Verify pump is marked as stuck
    const pump = out.simNetwork.components.find(c => c.id === 'p');
    assert.strictEqual(pump.stuck, true);
    assert.strictEqual(pump.power, 0);
    assert.strictEqual(pump.efficiency, 0);
  });

  test('physical_damage guards: pump_failure affects only pumps, valve_stuck only valves', () => {
    const net = { components:[ {id:'t', type:'tank', waterAmount:1, waterLevel:0, shape:'cylindrical', radius:1, maxLevel:10, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5}, {id:'v', type:'valve', isOpen:true}, {id:'p', type:'pump', power:100, maxFlowRate:0.5} ], pipes:[] };
    // Applying pump_failure to valve should do nothing
    E.applyAttack(net, { type:'physical_damage', componentId:'v', damageType:'pump_failure' });
    // Applying valve_stuck to pump should do nothing
    E.applyAttack(net, { type:'physical_damage', componentId:'p', damageType:'valve_stuck' });
    // Correctly applied
    E.applyAttack(net, { type:'physical_damage', componentId:'p', damageType:'pump_failure' });
    E.applyAttack(net, { type:'physical_damage', componentId:'v', damageType:'valve_stuck' });
    const v = net.components.find(c=>c.id==='v');
    const p = net.components.find(c=>c.id==='p');
    assert.strictEqual(v.isOpen, false);
    assert.strictEqual(p.power, 0);
  });

  test('data_poisoning recording respects start and end time window', () => {
    // Ensure well-formed tank geometry to avoid NaN in waterLevel updates
    const r = 1; const area = Math.PI * r * r; // set waterAmount so waterLevel=1 initially
    const net = { components:[ {id:'t', type:'tank', shape:'cylindrical', radius:r, maxLevel:10, waterAmount: area, waterLevel: 0, temperature: 10 } ], pipes:[] };
    const attacks = [ { time:5, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value: 7, duration: 2 } ];
    const out = E.run(net, [], [], attacks, 10, 20, 1);
    const rows = out.results;
    assert.strictEqual(rows[4]['t_waterLevel'], 1); // before start
    assert.strictEqual(rows[5]['t_waterLevel_reported'], 7); // at start
    assert.strictEqual(rows[7]['t_waterLevel_reported'], 7); // through end
    assert.strictEqual(rows[8]['t_waterLevel_reported'], undefined); // after end
  });

  test('physical_damage valve_stuck blocks gravity flow from that tick onward', () => {
    const network = {
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:Math.PI, waterLevel:1, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'v', type:'valve', isOpen:true },
        { id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'t1', to:'v'}, {from:'v', to:'t2'} ]
    };
    // Without attack, Hazen flow should drain some volume
    let out = E.run(network, [], [], [], 0, 20, 1);
    const first = out.results[0];
    assert.ok(first['t1_waterAmount'] < Math.PI);
    // With attack at t=0, no gravity depletion at t=0
    const network2 = JSON.parse(JSON.stringify(network));
    out = E.run(network2, [], [], [ {time:0, type:'physical_damage', componentId:'v', damageType:'valve_stuck'} ], 0, 20, 1);
    const first2 = out.results[0];
    assert.ok(Math.abs(first2['t1_waterAmount'] - Math.PI) < 1e-9);
  });

  test('physical_damage leak reduces waterAmount by 5% at attack tick', () => {
    const network = { components: [ {id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:10, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 } ], pipes: [] };
    const out = E.run(network, [], [], [ {time:0, type:'physical_damage', componentId:'t', damageType:'leak'} ], 0, 20, 1);
    const first = out.results[0];
    assert.ok(approxEqual(first['t_waterAmount'], 9.5));
  });

  test('simulation records attack labels in exported rows', () => {
    const network = {
      components: [
        { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:5, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: []
    };
    const attacks = [
      { time:0, type:'physical_damage', componentId:'t', damageType:'leak' },
      { time:0, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value:9, duration:1 }
    ];
    const out = E.run(network, [], [], attacks, 0, 20, 1);
    const first = out.results[0];
    assert.strictEqual(first.active_attacks, 'physical_damage:t[leak]; data_poisoning:t[waterLevel]');
  });

  test('poisoning triggers conditional rule in same tick (attacks then rules)', () => {
    const network = {
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'tA', to:'p'}, {from:'p', to:'tB'} ]
    };
    const rules = [ { source:{ componentId:'tA', value:'waterLevel' }, condition:{ operator:'>', threshold: 8 }, target:{ componentId:'p', actionType:'set_pump_power', params:{ power:'100' } } } ];
    const attacks = [ { time:0, type:'data_poisoning', componentId:'tA', poisonType:'waterLevel', value: 9, duration: 1 } ];
    const out = E.run(network, [], rules, attacks, 0, 20, 1);
    const first = out.results[0];
    assert.ok(first['tB_waterAmount'] > 1);
    const pump = out.simNetwork.components.find(c=>c.id==='p');
    assert.ok(pump.power > 0);
  });

  test('overlapping poisoning on multiple keys only affects targeted keys', () => {
    const area = Math.PI * 1 * 1;
    const network = { components:[ {id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount: area, waterLevel: 1, temperature: 10 } ], pipes:[] };
    const attacks = [
      { time:0, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value: 7, duration: 5 },
      { time:0, type:'data_poisoning', componentId:'t', poisonType:'temperature', value: 50, duration: 5 }
    ];
    const out = E.run(network, [], [], attacks, 0, 20, 1);
    const first = out.results[0];
    assert.ok(approxEqual(first['t_waterLevel'], 1));
    assert.strictEqual(first['t_waterLevel_reported'], 7);
    assert.ok(approxEqual(first['t_temperature'], 10.01));
    assert.strictEqual(first['t_temperature_reported'], 50);
  });

  test('multi-attack timeline sequencing on pH', () => {
    const network = { components:[ {id:'t', type:'tank', ph: 7 } ], pipes:[] };
    const attacks = [ {time:0, type:'chemical_dosing', componentId:'t', chemicalType:'acid'}, {time:1, type:'chemical_dosing', componentId:'t', chemicalType:'base'} ];
    const out = E.run(network, [], [], attacks, 1, 20, 1);
    const rows = out.results;
    assert.ok(approxEqual(rows[0]['t_ph'], 5.5));
    assert.ok(approxEqual(rows[1]['t_ph'], 7.0));
  });

  // Mass balance with pump-only network
  test('mass balance conserved with pump-only transfers', () => {
    const network = {
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'t1', to:'p'}, {from:'p', to:'t2'} ]
    };
    const controls = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}}, {time:1, componentId:'p', actionType:'set_pump_power', params:{power:'100'}}, {time:2, componentId:'p', actionType:'set_pump_power', params:{power:'100'}}, {time:3, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const out = E.run(network, controls, [], [], 3, 20, 1);
    const last = out.results[out.results.length-1];
    const sum = last['t1_waterAmount'] + last['t2_waterAmount'];
    assert.ok(approxEqual(sum, 2.0));
  });

  // Conditional cascade across pumps (two ticks)
  test('conditional cascade across pumps over two ticks', () => {
    const net = {
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p1', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'t2', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0.0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p2', type:'pump', maxFlowRate:0.5, power:0 },
        { id:'t3', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0.0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'t1', to:'p1'}, {from:'p1', to:'t2'}, {from:'t2', to:'p2'}, {from:'p2', to:'t3'} ]
    };
    const rules = [
      { source:{componentId:'t1', value:'waterAmount'}, condition:{operator:'>', threshold: 0}, target:{componentId:'p1', actionType:'set_pump_power', params:{power:'100'}} },
      { source:{componentId:'t2', value:'waterAmount'}, condition:{operator:'>', threshold: 0}, target:{componentId:'p2', actionType:'set_pump_power', params:{power:'100'}} }
    ];
    const out = E.run(net, [], rules, [], 1, 20, 1);
    const rows = out.results;
    assert.ok(rows[0]['t2_waterAmount'] > 0);
    const pump1 = out.simNetwork.components.find(c=>c.id==='p1');
    const pump2 = out.simNetwork.components.find(c=>c.id==='p2');
    assert.ok(pump1.power > 0);
    assert.ok(pump2.power > 0);
  });

  // Max level capping under sustained inflow
  test('waterLevel capped at maxLevel with sustained inflow', () => {
    const net = { components:[ {id:'src', type:'source'}, {id:'j', type:'junction'}, {id:'t', type:'tank', shape:'cylindrical', radius:0.1, maxLevel:0.2, waterAmount:0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5} ], pipes:[ {from:'src', to:'j'}, {from:'j', to:'t'} ] };
    const out = E.run(net, [], [], [], 200, 20, 1);
    const last = out.results[out.results.length-1];
    assert.ok(last['t_waterLevel'] <= 0.2 + 1e-9);
  });

  // Rectangular vs cylindrical area conversion
  test('rectangular tank waterLevel = waterAmount/(width*height)', () => {
    const width = 2, height = 3; const area = width*height;
    const t = { id:'tr', type:'tank', shape:'rectangular', width, height, maxLevel:100, waterAmount:6, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 };
    const net = { components:[ t ], pipes:[] };
    const out = E.run(net, [], [], [], 0, 20, 1);
    const first = out.results[0];
    assert.ok(approxEqual(first['tr_waterLevel'], 6/area));
  });

  // Cylindrical area conversion
  test('cylindrical tank waterLevel = waterAmount/(pi*r^2)', () => {
    const r = 1; const amount = Math.PI * r * r; // waterLevel should be 1
    const t = { id:'tc', type:'tank', shape:'cylindrical', radius:r, maxLevel:100, waterAmount:amount, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 };
    const net = { components:[ t ], pipes:[] };
    const out = E.run(net, [], [], [], 0, 20, 1);
    const first = out.results[0];
    assert.ok(approxEqual(first['tc_waterLevel'], 1));
  });

  // Temperature convergence scales with timeStep
  test('temperature relaxation scales with timeStep', () => {
    const baseTank = { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1, waterLevel:0, temperature:10, ph:7, o2:8, bodn:2, nitrate:1, co2:5 };
    const net1 = { components:[ JSON.parse(JSON.stringify(baseTank)) ], pipes:[] };
    const net10 = { components:[ JSON.parse(JSON.stringify(baseTank)) ], pipes:[] };
    const out1 = E.run(net1, [], [], [], 0, 20, 1); // Δt=1
    const out10 = E.run(net10, [], [], [], 0, 20, 10); // Δt=10
    const t1 = out1.results[0]['t_temperature']; // 10 + (20-10)*0.001*1 = 10.01
    const t10 = out10.results[0]['t_temperature']; // 10 + (20-10)*0.001*10 = 10.1
    assert.ok(approxEqual(t1, 10.01));
    assert.ok(approxEqual(t10, 10.1));
  });

  // Sink outflow diameter & timeStep scaling
  test('pump transfer scales with power percentage', () => {
    const netBase = {
      components: [
        {id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2.0, waterLevel:1, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5},
        {id:'p', type:'pump', maxFlowRate:1, power:0, curve:[5,-2,0]},
        {id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0.2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5}
      ],
      pipes: [ {from:'tA', to:'p', hw:{K:1, n:1.852}}, {from:'p', to:'tB', hw:{K:1, n:1.852}} ]
    };
    const fullPower = JSON.parse(JSON.stringify(netBase));
    const halfPower = JSON.parse(JSON.stringify(netBase));
    const ctrlFull = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const ctrlHalf = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'50'}} ];
    const outFull = E.run(fullPower, ctrlFull, [], [], 0, 20, 1);
    const outHalf = E.run(halfPower, ctrlHalf, [], [], 0, 20, 1);
    const flowFull = 2 - outFull.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    const flowHalf = 2 - outHalf.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    assert.ok(flowFull > flowHalf);
  });

  test('chemistry reactions consume oxygen and generate CO2 when enabled', () => {
    const net = {
      components: [
        { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:1, temperature:20, ph:7.5, o2:9, bodn:6, nitrate:1.5, co2:4, chemistry:{ enableReactions:true } }
      ],
      pipes: []
    };
    const out = E.run(net, [], [], [], 0, 20, 1);
    const result = out.simNetwork.components.find(c=>c.id==='t');
    assert.ok(result.bodn < 6);
    assert.ok(result.o2 < 9);
    assert.ok(result.co2 > 4);
    assert.ok(result.ph < 7.5);
  });

  test('chemistry re-aeration restores oxygen towards ambient', () => {
    const net = {
      components: [
        { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:1, temperature:20, ph:7, o2:2, bodn:0.5, nitrate:1, co2:5, chemistry:{ enableReactions:true, ambientO2:8, reaerationRate:0.01 } }
      ],
      pipes: []
    };
    const out = E.run(net, [], [], [], 0, 20, 1);
    const result = out.simNetwork.components.find(c=>c.id==='t');
    assert.ok(result.o2 > 2);
  });

  test('pump power clamped to 0-100% range', () => {
    const net = { components: [ { id:'p', type:'pump', power:50 } ], pipes: [] };
    // Test values > 100% get clamped
    E.applyTimedControl(net, { componentId:'p', actionType:'set_pump_power', params:{power:'150'} });
    assert.strictEqual(net.components[0].power, 100);
    // Test negative values get clamped  
    E.applyTimedControl(net, { componentId:'p', actionType:'set_pump_power', params:{power:'-25'} });
    assert.strictEqual(net.components[0].power, 0);
  });

  test('pump efficiency reduces flow rate proportionally', () => {
    const network = {
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2.0, waterLevel:1, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:1, power:100, efficiency:0.5, curve:[4,-1.5,0] },
        { id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0.2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {id:'c', from:'tA', to:'p', hw:{K:1, n:1.852}}, {id:'d', from:'p', to:'tB', hw:{K:1, n:1.852}} ]
    };
    const ctrl = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const fullEff = JSON.parse(JSON.stringify(network));
    fullEff.components[1].efficiency = 1;
    const resultHalf = E.run(network, ctrl, [], [], 0, 20, 1);
    const resultFull = E.run(fullEff, ctrl, [], [], 0, 20, 1);
    const flowHalf = 2 - resultHalf.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    const flowFull = 2 - resultFull.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    assert.ok(flowFull > flowHalf);
    assert.ok(Math.abs(flowHalf - flowFull * 0.5) < flowFull * 0.2);
  });

  test('pump mixing computes weighted average for pH', () => {
    const net = {
      components: [
        {id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2.0, waterLevel:1.2, temperature:20, ph:10, o2:8, bodn:2, nitrate:1, co2:5},
        {id:'p', type:'pump', maxFlowRate:1, power:100, curve:[5,-2,0]},
        {id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0.3, temperature:20, ph:4, o2:8, bodn:2, nitrate:1, co2:5}
      ],
      pipes: [ {from:'tA', to:'p', hw:{K:1, n:1.852}}, {from:'p', to:'tB', hw:{K:1, n:1.852}} ]
    };
    const controls = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const out = E.run(net, controls, [], [], 0, 20, 1);
    const flow = 2 - out.simNetwork.components.find(c=>c.id==='tA').waterAmount;
    const total = 1 + flow;
    const expected = ((4 * 1) + (10 * flow)) / total;
    const dest = out.simNetwork.components.find(c=>c.id==='tB');
    assert.ok(Math.abs(dest.ph - expected) < 1e-6);
  });

  test('no negative waterAmount: insufficient volume prevents gravity subtraction', () => {
    const net = { components:[ {id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0.01, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5}, {id:'j', type:'junction'} ], pipes:[ {from:'t', to:'j'} ] };
    const out = E.run(net, [], [], [], 0, 20, 1);
    const first = out.results[0];
    assert.ok(approxEqual(first['t_waterAmount'], 0.01));
  });

  test('supply head drives flow even without upstream tank', () => {
    const network = {
      components: [
        { id:'src', type:'source', head:2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'j', type:'junction' },
        { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'src', to:'j', hw:{K:1.2, n:1.852}}, {from:'j', to:'t'} ]
    };
    const out = E.run(network, [], [], [], 0, 20, 1);
    assert.ok(out.results[0]['t_waterAmount'] > 0);
  });

  // --- Advanced hydraulics: Hazen–Williams style optional flows ---
  test('HW pipe flow between two tanks respects head difference and K,n', () => {
    const r = 1; const area = Math.PI * r * r;
    const t1 = { id:'t1', type:'tank', shape:'cylindrical', radius:r, maxLevel:100, waterAmount:2*area, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 };
    const t2 = { id:'t2', type:'tank', shape:'cylindrical', radius:r, maxLevel:100, waterAmount:area, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 };
    const net = { components:[ t1, t2 ], pipes:[ {from:'t1', to:'t2', hw:{ K:1, n:2 }} ] };
    // Initially, levels are computed after step, so we need a preliminary step to set head
    const out0 = E.run(net, [], [], [], 0, 20, 1);
    const lvl1 = out0.results[0]['t1_waterLevel'];
    const lvl2 = out0.results[0]['t2_waterLevel'];
    // Next tick: HW flow uses dH = lvl1 - lvl2, q = (dH/K)^(1/n)
    const out1 = E.run(net, [], [], [], 1, 20, 1);
    const rows = out1.results;
    // We expect t1 to decrease and t2 to increase by the same amount
    assert.ok(rows[1]['t1_waterAmount'] < rows[0]['t1_waterAmount']);
    assert.ok(approxEqual(rows[1]['t1_waterAmount'] + rows[1]['t2_waterAmount'], rows[0]['t1_waterAmount'] + rows[0]['t2_waterAmount']));
  });

  test('Pump head-limited flow is min(capacity, head-based limit)', () => {
    const r = 1; const area = Math.PI * r * r;
    const net = {
      components: [
        { id:'tA', type:'tank', shape:'cylindrical', radius:r, maxLevel:100, waterAmount:2*area, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'p', type:'pump', maxFlowRate:1.0, power:100, headGain:0.05 },
        { id:'tB', type:'tank', shape:'cylindrical', radius:r, maxLevel:100, waterAmount:1*area, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 }
      ],
      pipes: [ {from:'tA', to:'p', hw:{K:2,n:2}}, {from:'p', to:'tB', hw:{K:2,n:2}} ]
    };
    // First step establishes levels, second applies head-limited flow
    const out = E.run(net, [], [], [], 1, 20, 1);
    const rows = out.results;
    assert.ok(rows[1]['tA_waterAmount'] < rows[0]['tA_waterAmount']);
  });

  // --- Water quality kinetics: first-order decay ---
  test('first-order decay in tanks reduces species per exp(-k dt)', () => {
    const t = { id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1, waterLevel:0, temperature:20, ph:7, o2:10, bodn:5, nitrate:2, co2:8, decayRates:{ o2: 0.1, bodn: 0.2 } };
    const net = { components:[ t ], pipes:[] };
    const out = E.run(net, [], [], [], 0, 20, 10); // dt=10
    const first = out.results[0];
    assert.ok(approxEqual(first['t_o2'], 10 * Math.exp(-0.1*10)));
    assert.ok(approxEqual(first['t_bodn'], 5 * Math.exp(-0.2*10)));
  });

  // --- Additional cyber-attack behavior tests derived from paper ---
  test('poisoned reading gets cleared after end time (duration-based effect)', () => {
    const r = 1; const area = Math.PI * r * r; // waterLevel=1 baseline
    const net = { components:[ {id:'t', type:'tank', shape:'cylindrical', radius:r, maxLevel:10, waterAmount: area, waterLevel: 0, temperature: 10 } ], pipes:[] };
    const attacks = [ { time:0, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value: 9, duration: 1 } ];
    const out = E.run(net, [], [], attacks, 2, 20, 1); // t=0..2, endTime=1
    // Recording shows poisoned values at t=0 and t=1, then clears at t=2
    assert.strictEqual(out.results[0]['t_waterLevel_reported'], 9);
    assert.strictEqual(out.results[1]['t_waterLevel_reported'], 9);
    assert.strictEqual(out.results[2]['t_waterLevel_reported'], undefined);
    // The engine should remove expired poisoning entries after t > endTime
    const comp = out.simNetwork.components.find(c => c.id==='t');
    assert.ok(!comp.poisonedReadings || comp.poisonedReadings.waterLevel === undefined);
  });

  test('data_poisoning masks physical changes in recording for targeted key', () => {
    // Chemical dosing changes actual pH; poisoning makes recorded pH show the injected value
    const net = { components:[ {id:'t', type:'tank', ph: 7 } ], pipes:[] };
    const attacks = [
      { time:0, type:'chemical_dosing', componentId:'t', chemicalType:'acid' },
      { time:0, type:'data_poisoning', componentId:'t', poisonType:'ph', value: 9, duration: 1 }
    ];
    const out = E.run(net, [], [], attacks, 0, 20, 1);
    const first = out.results[0];
    // Reported pH reflects poisoning value, not the physically altered value
    assert.strictEqual(first['t_ph_reported'], 9);
    // Underlying physical state was changed by dosing (7 -> 5.5) and actual export reflects it
    assert.ok(approxEqual(first['t_ph'], 5.5));
    assert.ok(Math.abs(out.simNetwork.components.find(c=>c.id==='t').ph - 5.5) < 1e-9);
  });

  test('valve_stuck at t=0 prevents reopen rule from working (fixed behavior)', () => {
    // Engine now properly sets a persistent "stuck" flag; rules cannot override
    const network = {
      components: [
        { id:'t1', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1.0, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5 },
        { id:'v', type:'valve', isOpen:true },
        { id:'j', type:'junction' }
      ],
      pipes: [ {from:'t1', to:'v'}, {from:'v', to:'j'} ]
    };
    const rules = [ { source:{componentId:'t1', value:'waterAmount'}, condition:{operator:'>', threshold: 0}, target:{componentId:'v', actionType:'set_valve_state', params:{ state: 'open' }} } ];
    // Attack closes valve at t=0 and sets stuck=true; rule cannot reopen it
    const attacks = [ { time:0, type:'physical_damage', componentId:'v', damageType:'valve_stuck' } ];
    const out = E.run(network, [], rules, attacks, 1, 20, 1); // t=0..1
    const rows = out.results;
    // Valve stays stuck - no water outflow occurs at t=1
    assert.ok(approxEqual(rows[1]['t1_waterAmount'], rows[0]['t1_waterAmount']));
    // Verify valve component is marked as stuck
    const valve = out.simNetwork.components.find(c => c.id === 'v');
    assert.strictEqual(valve.stuck, true);
  });

  test('chemical_interference negative amount clamps nitrate to lower bound 0', () => {
    const t = { id:'t', type:'tank', nitrate: 0.2 };
    const net = { components:[t], pipes:[] };
    E.applyAttack(net, { type:'chemical_interference', componentId:'t', chemical:'nitrate', amount: -5 });
    assert.strictEqual(t.nitrate, 0);
  });

  // Deep traversal via many junctions
  test('pump traversal through multiple junctions and valves', () => {
    const comps = [
      {id:'tA', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:2, waterLevel:1.2, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5},
      {id:'j1', type:'junction'},
      {id:'v1', type:'valve', isOpen:true},
      {id:'j2', type:'junction'},
      {id:'p', type:'pump', maxFlowRate:1, power:100, curve:[5,-2,0]},
      {id:'j3', type:'junction'},
      {id:'tB', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:0, waterLevel:0.3, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5}
    ];
    const pipes = [
      {from:'tA', to:'j1', hw:{K:1, n:1.852}},
      {from:'j1', to:'v1'},
      {from:'v1', to:'j2'},
      {from:'j2', to:'p', hw:{K:1, n:1.852}},
      {from:'p', to:'j3', hw:{K:1, n:1.852}},
      {from:'j3', to:'tB'}
    ];
    const net = { components: comps, pipes };
    const controls = [ {time:0, componentId:'p', actionType:'set_pump_power', params:{power:'100'}} ];
    const out = E.run(net, controls, [], [], 1, 20, 1);
    const delivered = out.results[0]['tB_waterAmount'];
    assert.ok(delivered > 0);
    assert.ok(out.results[0]['tA_waterAmount'] < 2);
  });

  // Poisoning overlap precedence at the same tick uses last applied
  test('overlapping poisoning at same tick applies last assignment', () => {
    const area = Math.PI;
    const net = { components:[ {id:'t', type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount: area, waterLevel: 1 } ], pipes:[] };
    const attacks = [ {time:5, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value: 7, duration: 5 }, {time:5, type:'data_poisoning', componentId:'t', poisonType:'waterLevel', value: 3, duration: 5 } ];
    const out = E.run(net, [], [], attacks, 10, 20, 1);
    const rows = out.results;
    // both at t=5; second overrides
    assert.ok(approxEqual(rows[5]['t_waterLevel'], 1));
    assert.strictEqual(rows[5]['t_waterLevel_reported'], 3);
  });

  // Performance smoke  (small)
  test('performance smoke (50 ticks, 30 comps)', () => {
    const comps = [];
    for (let i=0;i<15;i++) comps.push({id:`t${i}`, type:'tank', shape:'cylindrical', radius:1, maxLevel:10, waterAmount:1, waterLevel:0, temperature:20, ph:7, o2:8, bodn:2, nitrate:1, co2:5});
    for (let i=0;i<5;i++) comps.push({id:`p${i}`, type:'pump', maxFlowRate:0.5, power:0});
    for (let i=0;i<10;i++) comps.push({id:`j${i}`, type:'junction'});
    const pipes = [];
    // chain t0->p0->t1->p1->t2 ...
    pipes.push({from:'t0', to:'p0'});
    for (let i=0;i<4;i++){ pipes.push({from:`p${i}`, to:`t${i+1}`}); if (i+1<4) { pipes.push({from:`t${i+1}`, to:`p${i+1}`}); } }
    const net = { components: comps, pipes };
    const controls = [ {time:0, componentId:'p0', actionType:'set_pump_power', params:{power:'100'}} ];
    const out = E.run(net, controls, [], [], 50, 20, 1);
    assert.strictEqual(out.results.length, 51);
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
