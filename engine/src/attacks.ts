// Attacks on the plant and on its control system.
//
// Data poisoning (a falsified sensor reading, an injected command, a tampered
// control action) is applied inside the control system. This file deals with
// the timing of all attacks and with the ones that act on the plant: physical
// damage (a failed pump, a stuck valve, a leak, a blocked pipe) and chemical
// interference (a substance put into the water).

import { Link, Network, ORIFICE_CD } from './network.js';
import { ATTACK_CLASS, AttackClass, AttackSpec, ChemicalInterferenceAttack, clamp } from './scenario.js';

/** An injection with no duration happens all at once at its start time. */
export function isInstant(attack: AttackSpec): boolean {
  return attack.type === 'chemical_interference' && !(typeof attack.duration === 'number' && attack.duration > 0);
}

export function attackEndTime(attack: AttackSpec): number {
  if (typeof attack.duration === 'number' && attack.duration > 0) return attack.start + attack.duration;
  return isInstant(attack) ? attack.start : Number.POSITIVE_INFINITY;
}

/** Whether an attack is in progress at time t (start inclusive, end exclusive). */
export function isActive(attack: AttackSpec, t: number): boolean {
  if (isInstant(attack)) return false;
  return t >= attack.start - 1e-9 && t < attackEndTime(attack) - 1e-9;
}

/**
 * Whether a recorded row at time t should be labelled with this attack. An
 * instantaneous injection labels the first row at or after it.
 */
export function isLabelled(attack: AttackSpec, t: number, reportStep: number): boolean {
  if (isInstant(attack)) return t >= attack.start - 1e-9 && t < attack.start + reportStep - 1e-9;
  return isActive(attack, t);
}

export function attackClass(attack: AttackSpec): AttackClass {
  return ATTACK_CLASS[attack.type];
}

/**
 * Set the physical condition of every link from the attacks in progress.
 * Returns true if anything changed.
 */
export function applyPhysicalAttacks(network: Network, active: AttackSpec[], stuckAt: Map<string, number>): boolean {
  const links = network.links;
  const before = links.map(signature).join('|');
  links.forEach(link => {
    link.failed = false;
    link.stuck = false;
    link.blockage = 0;
    if (link.kind === 'leak') link.orifice = 0;
  });
  const seen = new Set<string>();
  active.forEach(attack => {
    switch (attack.type) {
      case 'pump_failure': {
        const link = links[network.linkIndex.get(attack.pump) as number];
        link.failed = true;
        link.speed = 0;
        break;
      }
      case 'valve_stuck': {
        const link = links[network.linkIndex.get(attack.valve) as number];
        seen.add(attack.id);
        if (!stuckAt.has(attack.id)) stuckAt.set(attack.id, typeof attack.position === 'number' ? clamp(attack.position, 0, 1) : link.opening);
        link.stuck = true;
        link.opening = stuckAt.get(attack.id) as number;
        break;
      }
      case 'pipe_blockage': {
        const link = links[network.linkIndex.get(attack.pipe) as number];
        link.blockage = Math.max(link.blockage, clamp(attack.fraction, 0, 1));
        break;
      }
      case 'leak': {
        const node = network.nodes[network.nodeIndex.get(attack.node) as number];
        if (node.leakLink >= 0) links[node.leakLink].orifice += ORIFICE_CD * Math.PI * attack.diameter * attack.diameter / 4;
        break;
      }
    }
  });
  stuckAt.forEach((_, id) => { if (!seen.has(id)) stuckAt.delete(id); });
  return links.map(signature).join('|') !== before;
}

function signature(link: Link): string {
  return `${link.failed ? 1 : 0}${link.stuck ? 1 : 0}:${link.blockage}:${link.orifice}:${link.stuck ? link.opening : ''}`;
}

/** Amount of an injection delivered between t0 and t1. */
export function injectedBetween(attack: ChemicalInterferenceAttack, t0: number, t1: number): number {
  if (isInstant(attack)) return attack.start >= t0 - 1e-9 && attack.start < t1 - 1e-9 ? attack.amount : 0;
  const duration = attack.duration as number;
  const overlap = Math.min(t1, attack.start + duration) - Math.max(t0, attack.start);
  return overlap > 0 ? attack.amount * overlap / duration : 0;
}
