// Physical laws of the individual elements: pipe friction, centrifugal
// pumps, valves, consumer demands and leaks.
//
// Every link has a monotone head-loss law h(q) = H_from - H_to with a
// derivative, which is all the network solver needs. One-way behaviour (check
// valves, demands, leaks) and limits (flow-control valves, demand ceilings)
// are steep but continuous branches of the same law, so the solver needs no
// separate open/closed bookkeeping.

import { GRAVITY, KINEMATIC_VISCOSITY, WATER_DENSITY, clamp } from './scenario.js';
import { Link, PumpCurve } from './network.js';

/** Resistance of a closed element (s/m²): 1 m of head passes 1e-8 m³/s. */
export const R_CLOSED = 1e8;
/** Resistance of something that passes nothing at all: the shut inlet of a full tank, a hole that is not there. */
const R_SHUT = 1e12;
/** Below this velocity the turbulent laws are replaced by their chord. */
const LOW_VELOCITY = 0.01;
/** h = K × MINOR_FACTOR × q² / d⁴ */
const MINOR_FACTOR = 8 / (Math.PI * Math.PI * GRAVITY);
/** Atmospheric pressure less the vapour pressure of water at 20 °C (m). */
export const NPSH_ATMOSPHERE = 10.33 - 0.24;

// ---------------------------------------------------------------- pumps

/** Head added at relative speed `speed` (affinity laws). */
export function pumpHead(curve: PumpCurve, speed: number, flow: number): number {
  return curve.a0 * speed * speed + curve.a1 * speed * flow + curve.a2 * flow * flow;
}

/** Shaft power (W): linear in flow between shut-off and best point, cubic in speed. */
export function pumpShaftPower(curve: PumpCurve, speed: number, flow: number): number {
  if (speed <= 1e-6) return 0;
  const relativeFlow = Math.max(0, flow) / (speed * curve.bepFlow);
  return speed * speed * speed * (curve.shutoffPower + (curve.bepPower - curve.shutoffPower) * relativeFlow);
}

/** Hydraulic power delivered divided by shaft power. */
export function pumpEfficiency(curve: PumpCurve, speed: number, flow: number): number {
  const shaft = pumpShaftPower(curve, speed, flow);
  if (shaft <= 0 || flow <= 0) return 0;
  return clamp(WATER_DENSITY * GRAVITY * flow * Math.max(0, pumpHead(curve, speed, flow)) / shaft, 0, 1);
}

/** Net positive suction head the pump needs at this operating point (m). */
export function pumpNpshRequired(curve: PumpCurve, speed: number, flow: number): number {
  if (speed <= 1e-6) return 0;
  const relativeFlow = Math.max(0, flow) / (speed * curve.bepFlow);
  return curve.npshRequired * speed * speed * (0.4 + 0.6 * relativeFlow * relativeFlow);
}

export function pumpIsRunning(link: Link): boolean {
  return !link.failed && link.speed > 1e-6;
}

function pumpLaw(link: Link, q: number): void {
  const curve = link.curve as PumpCurve;
  if (!pumpIsRunning(link)) {
    if (link.checkValve) {
      link.closed = true;
      link.h = R_CLOSED * q;
      link.g = R_CLOSED;
    } else {
      // Stopped impeller: an obstruction of about ten velocity heads.
      link.closed = false;
      quadratic(link, q, 10 * MINOR_FACTOR / Math.pow(link.diameter, 4), LOW_VELOCITY * link.area);
    }
    return;
  }
  link.closed = false;
  const speed = clamp(link.speed, 0, 1);
  const shutoff = curve.a0 * speed * speed;
  if (q >= 0) {
    const slopeFloor = 2 * Math.abs(curve.a2) * 1e-3 * curve.maxFlow;
    link.h = -pumpHead(curve, speed, q);
    link.g = Math.max(-(curve.a1 * speed + 2 * curve.a2 * q), slopeFloor);
  } else if (link.checkValve) {
    link.h = -shutoff + R_CLOSED * q;
    link.g = R_CLOSED;
  } else {
    // Water forced backwards through a running pump is dissipated.
    link.h = -shutoff - Math.abs(curve.a2) * q * q;
    link.g = Math.max(-2 * Math.abs(curve.a2) * q, 2 * Math.abs(curve.a2) * 1e-3 * curve.maxFlow);
  }
}

// ---------------------------------------------------------------- valves

// Loss coefficient K (velocity heads) against fractional opening, from
// handbook data (Crane TP-410, Idelchik). Interpolated in log K.
const VALVE_TABLES: Record<string, Array<[number, number]>> = {
  gate: [[0.125, 98], [0.25, 24], [0.375, 9], [0.5, 4.5], [0.625, 2.1], [0.75, 0.9], [0.875, 0.4], [1, 0.17]],
  globe: [[0.1, 400], [0.25, 60], [0.5, 15], [0.75, 8], [1, 6]],
  butterfly: [[0.11, 3500], [0.22, 750], [0.33, 118], [0.44, 32], [0.56, 10.8], [0.67, 3.9], [0.78, 1.5], [0.89, 0.5], [1, 0.3]],
  ball: [[0.11, 1800], [0.22, 200], [0.33, 48], [0.44, 17], [0.56, 5.5], [0.67, 1.6], [0.78, 0.6], [0.89, 0.15], [1, 0.05]]
};

/** Loss coefficient of a valve at fractional opening x in (0, 1]. */
export function valveLossCoefficient(kind: string, opening: number, fullOpenK?: number): number {
  const x = clamp(opening, 1e-6, 1);
  const table = VALVE_TABLES[kind];
  if (!table) {
    // 'linear': flow coefficient proportional to stem travel.
    return (fullOpenK && fullOpenK > 0 ? fullOpenK : 2.5) / (x * x);
  }
  const scale = fullOpenK && fullOpenK > 0 ? fullOpenK / table[table.length - 1][1] : 1;
  if (x <= table[0][0]) return scale * table[0][1] * Math.pow(table[0][0] / x, 2);
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, k0] = table[i - 1];
      const [x1, k1] = table[i];
      const w = (x - x0) / (x1 - x0);
      return scale * Math.exp(Math.log(k0) + w * (Math.log(k1) - Math.log(k0)));
    }
  }
  return scale * table[table.length - 1][1];
}

function valveLaw(link: Link, q: number): void {
  const limit = link.flowMode ? link.setting : Number.POSITIVE_INFINITY;
  if (link.opening < 1e-4 || limit < 1e-12) {
    link.closed = true;
    link.h = R_CLOSED * q;
    link.g = R_CLOSED;
    return;
  }
  link.closed = false;
  const m = valveLossCoefficient(link.valveKind, link.opening, link.fullOpenK) * MINOR_FACTOR / Math.pow(link.diameter, 4);
  if (q > limit) {
    // Flow control: the valve throttles as far as needed to hold its limit.
    link.h = m * limit * limit + R_CLOSED * (q - limit);
    link.g = R_CLOSED;
    return;
  }
  quadratic(link, q, m, LOW_VELOCITY * link.area);
}

/** h = m q |q| with a linear chord below `chordFlow`. */
function quadratic(link: Link, q: number, m: number, chordFlow: number): void {
  const a = Math.abs(q);
  if (a < chordFlow) {
    link.g = Math.max(m * chordFlow, 1e-9);
    link.h = link.g * q;
  } else {
    link.g = 2 * m * a;
    link.h = m * a * q;
  }
}

// ---------------------------------------------------------------- pipes

/** Darcy friction factor: laminar, Swamee-Jain turbulent, blended between. */
export function darcyFrictionFactor(reynolds: number, relativeRoughness: number): number {
  const swameeJain = (re: number) => 0.25 / Math.pow(Math.log10(relativeRoughness / 3.7 + 5.74 / Math.pow(re, 0.9)), 2);
  if (reynolds <= 2000) return 64 / Math.max(reynolds, 1e-9);
  if (reynolds >= 4000) return swameeJain(reynolds);
  const w = (reynolds - 2000) / 2000;
  return (1 - w) * (64 / 2000) + w * swameeJain(4000);
}

/**
 * Loss coefficient of an obstruction that leaves a fraction (1 - f) of the
 * bore open: the sudden-expansion loss behind it, (A/A_open - 1)², in
 * velocity heads of the full pipe.
 */
export function blockageLossCoefficient(fraction: number): number {
  const f = clamp(fraction, 0, 0.999);
  return Math.pow(f / (1 - f), 2);
}

function pipeLaw(link: Link, q: number): void {
  if (link.shut || link.blockage >= 0.999) {
    link.closed = true;
    link.h = R_CLOSED * q;
    link.g = R_CLOSED;
    return;
  }
  link.closed = false;
  if (link.oneWay && q < 0) {
    link.h = R_CLOSED * q;
    link.g = R_CLOSED;
    return;
  }
  const a = Math.abs(q);
  const chordFlow = LOW_VELOCITY * link.area;
  if (link.friction === 'dw') {
    const reynolds = 4 * a / (Math.PI * link.diameter * KINEMATIC_VISCOSITY);
    if (reynolds <= 2000) {
      // Hagen-Poiseuille: head loss is linear in flow.
      link.g = 128 * KINEMATIC_VISCOSITY * link.length / (Math.PI * GRAVITY * Math.pow(link.diameter, 4));
      link.h = link.g * q;
    } else {
      const f = darcyFrictionFactor(reynolds, link.roughness / link.diameter);
      link.g = 2 * f * link.resistance * a;
      link.h = f * link.resistance * a * q;
    }
  } else {
    const n = 1.852;
    if (a < chordFlow) {
      link.g = Math.max(link.resistance * Math.pow(chordFlow, n - 1), 1e-9);
      link.h = link.g * q;
    } else {
      link.g = n * link.resistance * Math.pow(a, n - 1);
      link.h = link.g * q / n;
    }
  }
  const k = link.minor + (link.blockage > 0 ? blockageLossCoefficient(link.blockage) : 0);
  if (k > 0) {
    const m = k * MINOR_FACTOR / Math.pow(link.diameter, 4);
    if (a < chordFlow) {
      link.g += m * chordFlow;
      link.h += m * chordFlow * q;
    } else {
      link.g += 2 * m * a;
      link.h += m * a * q;
    }
  }
}

// ---------------------------------------------------------------- demands and leaks

function demandLaw(link: Link, q: number): void {
  const demand = link.demand;
  if (demand <= 1e-12) {
    link.closed = true;
    link.h = R_SHUT * q;
    link.g = R_SHUT;
    return;
  }
  link.closed = false;
  if (q < 0) {
    link.h = R_SHUT * q;
    link.g = R_SHUT;
  } else if (q > demand) {
    // Consumers take no more than they ask for, however high the pressure.
    const cap = Math.max(R_CLOSED, 1e6 / demand);
    link.h = link.pressureRange + cap * (q - demand);
    link.g = cap;
  } else {
    const chord = 1e-3 * demand;
    const m = link.pressureRange / (demand * demand);
    if (q < chord) {
      link.g = m * chord;
      link.h = link.g * q;
    } else {
      link.g = 2 * m * q;
      link.h = m * q * q;
    }
  }
}

/** Free discharge through a hole: q = Cd A √(2 g h). */
function leakLaw(link: Link, q: number): void {
  if (link.orifice <= 1e-12) {
    link.closed = true;
    link.h = R_SHUT * q;
    link.g = R_SHUT;
    return;
  }
  link.closed = false;
  if (q < 0) {
    link.h = R_SHUT * q;
    link.g = R_SHUT;
    return;
  }
  const m = 1 / (2 * GRAVITY * link.orifice * link.orifice);
  quadratic(link, q, m, LOW_VELOCITY * link.orifice);
}

function law(link: Link, q: number): void {
  switch (link.kind) {
    case 'pipe': pipeLaw(link, q); break;
    case 'pump': pumpLaw(link, q); break;
    case 'valve': valveLaw(link, q); break;
    case 'demand': demandLaw(link, q); break;
    case 'leak': leakLaw(link, q); break;
  }
}

/** Evaluate head loss `link.h` and gradient `link.g` at flow q. */
export function evaluateLink(link: Link, q: number): void {
  if (link.blockedToward >= 0 && q !== 0 && (q > 0 ? link.to : link.from) === link.blockedToward) {
    // Delivery to a full tank is shut off; flow the other way is unaffected.
    law(link, 0);
    link.h += R_SHUT * q;
    link.g = R_SHUT;
    return;
  }
  law(link, q);
}

/** A plausible starting flow for a link that has just opened. */
export function nominalFlow(link: Link): number {
  if (link.kind === 'pump' && link.curve) return 0.5 * link.curve.maxFlow * clamp(link.speed, 0, 1);
  if (link.kind === 'demand') return 0.5 * link.demand;
  if (link.kind === 'leak') return 0.5 * link.orifice;
  return 0.3 * link.area;
}
