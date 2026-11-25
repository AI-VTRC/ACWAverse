// Editing operations on a scenario. Each takes the scenario and changes it in
// place; callers wrap them in a commit so they can be undone.

const PREFIX = {
  junction: 'J', tank: 'T', reservoir: 'R', pipe: 'P', pump: 'PU', valve: 'V'
};

/** ISA-style instrument letters for a measured quantity. */
export function sensorTag(quantity) {
  const map = {
    level: 'LT', volume: 'LT', flow: 'FT', inflow: 'FT', outflow: 'FT', supplied: 'FT', leak: 'FT', overflow: 'FT',
    pressure: 'PT', head: 'PT', suctionPressure: 'PT', dischargePressure: 'PT', headloss: 'PDT',
    speed: 'ST', opening: 'ZT', power: 'JT', energy: 'JQ', temperature: 'TT', running: 'YS'
  };
  return map[quantity] || 'AT';
}

export function allIds(scenario) {
  const ids = new Set();
  [scenario.nodes, scenario.links, scenario.sensors || [], scenario.controllers || [], scenario.attacks || []]
    .forEach(list => list.forEach(item => ids.add(item.id)));
  return ids;
}

export function nextId(scenario, prefix) {
  const ids = allIds(scenario);
  for (let n = 1; ; n++) if (!ids.has(prefix + n)) return prefix + n;
}

export function addNode(scenario, type, x, y) {
  const id = nextId(scenario, PREFIX[type]);
  const base = { id, type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
  if (type === 'tank') scenario.nodes.push({ ...base, elevation: 0, shape: 'cylinder', diameter: 4, height: 4, level: 2, whenFull: 'spill' });
  else if (type === 'reservoir') scenario.nodes.push({ ...base, head: 10 });
  else scenario.nodes.push({ ...base, elevation: 0 });
  return id;
}

export function addLink(scenario, type, from, to) {
  const id = nextId(scenario, PREFIX[type]);
  const base = { id, type, from, to };
  if (type === 'pipe') scenario.links.push({ ...base, length: 100, diameter: 0.1, friction: 'hazen-williams', roughness: 130 });
  else if (type === 'pump') scenario.links.push({ ...base, shutoffHead: 30, maxFlow: 0.02, speed: 1, efficiency: 0.75, rampTime: 5 });
  else scenario.links.push({ ...base, kind: 'gate', diameter: 0.1, mode: 'position', setting: 1, strokeTime: 10 });
  return id;
}

/** Swap the two ends of a link: for a pump, suction and discharge change places. */
export function reverseLink(scenario, id) {
  const link = scenario.links.find(item => item.id === id);
  if (link) [link.from, link.to] = [link.to, link.from];
}

export function addSensor(scenario, element, quantity) {
  scenario.sensors = scenario.sensors || [];
  const id = nextId(scenario, sensorTag(quantity));
  scenario.sensors.push({ id, element, quantity });
  return id;
}

export function addController(scenario, type) {
  scenario.controllers = scenario.controllers || [];
  const actuators = scenario.links.filter(link => link.type === 'pump' || link.type === 'valve');
  const sensors = scenario.sensors || [];
  const actuator = actuators.length > 0 ? actuators[0].id : '';
  const sensor = sensors.length > 0 ? sensors[0].id : '';
  const id = nextId(scenario, 'C');
  if (type === 'onoff') scenario.controllers.push({ id, type, sensor, actuator, action: 'fill', low: 1, high: 3 });
  else if (type === 'timed') scenario.controllers.push({ id, type, actuator, events: [{ time: 0, value: 1 }] });
  else if (type === 'conditional') scenario.controllers.push({ id, type, sensor, operator: '>', threshold: 1, actuator, value: 0 });
  else scenario.controllers.push({ id, type: 'pid', sensor, actuator, setpoint: 1, kp: 0.5, ki: 0.01 });
  return id;
}

/** Attack types that can be aimed at a given kind of thing. */
export function attacksFor(kind, type) {
  if (kind === 'sensor') return ['data_poisoning'];
  if (kind === 'controller') return ['controller_tamper'];
  if (type === 'pump') return ['pump_failure', 'command_injection'];
  if (type === 'valve') return ['valve_stuck', 'command_injection'];
  if (type === 'pipe') return ['pipe_blockage'];
  if (type === 'junction' || type === 'tank') return ['leak', 'chemical_interference'];
  return [];
}

export function addAttack(scenario, type, target) {
  scenario.attacks = scenario.attacks || [];
  const id = nextId(scenario, 'A');
  const duration = scenario.simulation.duration;
  const grid = scenario.simulation.reportStep || scenario.simulation.timeStep;
  const snap = t => Math.round(t / grid) * grid;
  const timing = { start: snap(duration / 4), duration: Math.max(grid, snap(duration / 4)) };
  const pick = (list, test) => target || ((list || []).find(test) || {}).id || '';
  switch (type) {
    case 'data_poisoning': scenario.attacks.push({ id, type, sensor: pick(scenario.sensors, () => true), mode: 'constant', value: 0, ...timing }); break;
    case 'command_injection': scenario.attacks.push({ id, type, actuator: pick(scenario.links, l => l.type === 'pump' || l.type === 'valve'), value: 0, ...timing }); break;
    case 'controller_tamper': scenario.attacks.push({ id, type, controller: pick(scenario.controllers, () => true), disable: true, ...timing }); break;
    case 'pump_failure': scenario.attacks.push({ id, type, pump: pick(scenario.links, l => l.type === 'pump'), ...timing }); break;
    case 'valve_stuck': scenario.attacks.push({ id, type, valve: pick(scenario.links, l => l.type === 'valve'), ...timing }); break;
    case 'pipe_blockage': scenario.attacks.push({ id, type, pipe: pick(scenario.links, l => l.type === 'pipe'), fraction: 0.8, ...timing }); break;
    case 'leak': scenario.attacks.push({ id, type, node: pick(scenario.nodes, n => n.type !== 'reservoir'), diameter: 0.02, ...timing }); break;
    default: scenario.attacks.push({ id, type: 'chemical_interference', node: pick(scenario.nodes, n => n.type === 'tank'), substance: 'tracer', amount: 100, start: timing.start }); break;
  }
  return id;
}

/** Give something a new id and update everything that refers to it. */
export function rename(scenario, oldId, newId) {
  newId = String(newId).trim();
  if (!newId || newId === oldId || allIds(scenario).has(newId)) return false;
  const swap = (object, key) => { if (object[key] === oldId) object[key] = newId; };
  scenario.nodes.forEach(node => swap(node, 'id'));
  scenario.links.forEach(link => ['id', 'from', 'to'].forEach(key => swap(link, key)));
  (scenario.sensors || []).forEach(sensor => ['id', 'element'].forEach(key => swap(sensor, key)));
  (scenario.controllers || []).forEach(controller => ['id', 'sensor', 'actuator'].forEach(key => swap(controller, key)));
  (scenario.attacks || []).forEach(attack => ['id', 'sensor', 'actuator', 'controller', 'pump', 'valve', 'pipe', 'node'].forEach(key => swap(attack, key)));
  return true;
}

/**
 * Remove an element and everything that cannot exist without it: the links of
 * a node, the sensors on an element, the controllers and attacks that use it.
 *
 * Junctions that only served what was removed go too. Deleting a link removes
 * a junction it leaves with no links at all. Deleting a node also removes the
 * dead-end runs that led only to it: a plain junction left with a single link
 * is taken out together with that link, and so on back to the first tank,
 * reservoir, consumer or branch.
 *
 * Returns the ids of the nodes and links removed besides the one asked for.
 */
export function remove(scenario, kind, id) {
  const drop = (list, test) => {
    const removed = [];
    for (let i = (list || []).length - 1; i >= 0; i--) if (test(list[i])) removed.push(...list.splice(i, 1));
    return removed;
  };
  const gone = new Set([id]);
  const also = [];
  if (kind === 'node' || kind === 'link') {
    const removedLinks = kind === 'node'
      ? drop(scenario.links, link => link.from === id || link.to === id)
      : drop(scenario.links, link => link.id === id);
    if (kind === 'node') {
      drop(scenario.nodes, node => node.id === id);
      removedLinks.forEach(link => also.push(link.id));
    }
    const linksAt = nodeId => scenario.links.filter(link => link.from === nodeId || link.to === nodeId);
    const plain = nodeId => {
      const node = scenario.nodes.find(item => item.id === nodeId);
      return !!node && node.type === 'junction' && !(node.demand > 0);
    };
    // Junctions that lost a link are looked at once; pruning a run adds the next one along.
    const queue = removedLinks.flatMap(link => [link.from, link.to]);
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!plain(nodeId)) continue;
      const left = linksAt(nodeId);
      if (left.length > (kind === 'node' ? 1 : 0)) continue;
      drop(scenario.nodes, node => node.id === nodeId);
      also.push(nodeId);
      left.forEach(link => {
        drop(scenario.links, item => item.id === link.id);
        also.push(link.id);
        queue.push(link.from === nodeId ? link.to : link.from);
      });
    }
    removedLinks.forEach(link => gone.add(link.id));
    also.forEach(item => gone.add(item));
  } else if (kind === 'sensor') {
    drop(scenario.sensors, sensor => sensor.id === id);
  } else if (kind === 'controller') {
    drop(scenario.controllers, controller => controller.id === id);
  } else if (kind === 'attack') {
    drop(scenario.attacks, attack => attack.id === id);
    return also;
  }
  drop(scenario.sensors, sensor => gone.has(sensor.element)).forEach(sensor => gone.add(sensor.id));
  drop(scenario.controllers, controller => gone.has(controller.actuator) || gone.has(controller.sensor)).forEach(controller => gone.add(controller.id));
  drop(scenario.attacks, attack => ['sensor', 'actuator', 'controller', 'pump', 'valve', 'pipe', 'node'].some(key => gone.has(attack[key])));
  return also;
}

export function blankScenario() {
  return {
    format: 'acwaverse/2',
    name: 'New system',
    description: '',
    nodes: [],
    links: [],
    sensors: [],
    controllers: [],
    attacks: [],
    simulation: { duration: 86400, timeStep: 60, reportStep: 300, ambientTemperature: 20, seed: 1 }
  };
}
