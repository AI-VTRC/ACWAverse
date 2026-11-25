// The control system: instruments that measure the plant, and controllers
// that read those instruments and command pumps and valves.
//
// Controllers never see the plant directly. They see what the sensors report,
// which is the true value plus measurement noise, and whatever an attacker has
// done to the signal on the way.

import {
  AttackSpec, ControllerSpec, ControllerTamperAttack, Scenario, SensorSpec, DataPoisoningAttack, clamp, num
} from './scenario.js';

/** Small seeded generator (mulberry32) so that runs are repeatable. */
export class Random {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal deviate (Box-Muller). */
  gaussian(): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return value;
    }
    let u = 0;
    while (u < 1e-12) u = this.next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * this.next();
    this.spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }
}

export interface Sensor {
  spec: SensorSpec;
  /** Reads the physical quantity from the plant. */
  measure: () => number;
  /** The physical value at the last sample. */
  truth: number;
  /** What an honest instrument reports: truth plus noise. */
  clean: number;
  /** What the control system receives. */
  reported: number;
  historyTime: number[];
  historyValue: number[];
  /** Readings captured when a freeze attack began, by attack id. */
  frozen: Map<string, number>;
}

export interface Controller {
  spec: ControllerSpec;
  /** Index of the pump or valve link it commands. */
  actuator: number;
  /** Two-position controllers: whether the output is currently "on". */
  on: boolean;
  integral: number;
  lastError: number;
  lastTime: number;
  started: boolean;
  /** Last command issued, NaN if none yet. */
  output: number;
}

export class ControlSystem {
  readonly sensors: Sensor[] = [];
  readonly controllers: Controller[] = [];
  private readonly sensorById = new Map<string, Sensor>();
  private readonly random: Random;

  constructor(
    scenario: Scenario,
    measure: (element: string, quantity: string) => () => number,
    actuatorIndex: (id: string) => number,
    actuatorSetting: (index: number) => number
  ) {
    this.random = new Random(num(scenario.simulation.seed, 1));
    (scenario.sensors || []).forEach(spec => {
      const sensor: Sensor = {
        spec, measure: measure(spec.element, spec.quantity),
        truth: NaN, clean: NaN, reported: NaN, historyTime: [], historyValue: [], frozen: new Map()
      };
      this.sensors.push(sensor);
      this.sensorById.set(spec.id, sensor);
    });
    (scenario.controllers || []).forEach(spec => {
      const actuator = actuatorIndex(spec.actuator);
      const controller: Controller = { spec, actuator, on: false, integral: 0, lastError: 0, lastTime: 0, started: false, output: NaN };
      if (spec.type === 'onoff') {
        const onValue = num(spec.onValue, 1);
        const offValue = num(spec.offValue, 0);
        const now = actuatorSetting(actuator);
        controller.on = Math.abs(now - onValue) < Math.abs(now - offValue);
      }
      this.controllers.push(controller);
    });
  }

  /** Take a reading from every sensor at `time`, applying any signal attacks. */
  sample(time: number, active: AttackSpec[]): void {
    this.sensors.forEach(sensor => {
      const truth = sensor.measure();
      const noise = num(sensor.spec.noise, 0);
      const clean = noise > 0 ? truth + noise * this.random.gaussian() : truth;
      sensor.truth = truth;
      sensor.clean = clean;
      sensor.historyTime.push(time);
      sensor.historyValue.push(clean);
      let reported = clean;
      const seen = new Set<string>();
      active.forEach(attack => {
        if (attack.type !== 'data_poisoning' || attack.sensor !== sensor.spec.id) return;
        seen.add(attack.id);
        reported = this.spoof(sensor, attack, time, reported);
      });
      // A freeze that has ended lets go of its captured value.
      sensor.frozen.forEach((_, id) => { if (!seen.has(id)) sensor.frozen.delete(id); });
      sensor.reported = reported;
    });
  }

  private spoof(sensor: Sensor, attack: DataPoisoningAttack, time: number, value: number): number {
    const amount = num(attack.value, 0);
    switch (attack.mode) {
      case 'constant': return amount;
      case 'offset': return value + amount;
      case 'scale': return value * amount;
      case 'drift': return value + amount * (time - attack.start) / 3600;
      case 'noise': return value + amount * this.random.gaussian();
      case 'freeze': {
        if (!sensor.frozen.has(attack.id)) {
          // Hold the last reading from before the attack began.
          const n = sensor.historyValue.length;
          sensor.frozen.set(attack.id, n >= 2 ? sensor.historyValue[n - 2] : value);
        }
        return sensor.frozen.get(attack.id) as number;
      }
      case 'replay': {
        const target = time - amount;
        const times = sensor.historyTime;
        let low = 0;
        let high = times.length - 1;
        while (low < high) {
          const mid = (low + high + 1) >> 1;
          if (times[mid] <= target + 1e-9) low = mid; else high = mid - 1;
        }
        return sensor.historyValue[low];
      }
      default: return value;
    }
  }

  reading(sensorId: string): number {
    const sensor = this.sensorById.get(sensorId);
    return sensor ? sensor.reported : NaN;
  }

  /**
   * Run every controller once. Returns the commands issued, by actuator link
   * index. Controllers run in list order and a later one overrides an earlier
   * one for the same actuator.
   */
  scan(time: number, active: AttackSpec[], actuatorSetting: (index: number) => number): Map<number, number> {
    const commands = new Map<number, number>();
    this.controllers.forEach(controller => {
      let spec = controller.spec;
      let disabled = spec.enabled === false;
      active.forEach(attack => {
        if (attack.type !== 'controller_tamper' || attack.controller !== spec.id) return;
        const tamper = attack as ControllerTamperAttack;
        if (tamper.disable) disabled = true;
        if (tamper.set) spec = { ...spec, ...tamper.set } as ControllerSpec;
      });
      if (disabled) {
        controller.lastTime = time;
        controller.started = false;
        return;
      }
      const command = this.evaluate(controller, spec, time, actuatorSetting);
      controller.lastTime = time;
      controller.started = true;
      if (command === null || !Number.isFinite(command)) return;
      controller.output = command;
      commands.set(controller.actuator, command);
    });
    return commands;
  }

  private evaluate(controller: Controller, spec: ControllerSpec, time: number, actuatorSetting: (index: number) => number): number | null {
    switch (spec.type) {
      case 'onoff': {
        const reading = this.reading(spec.sensor);
        if (!Number.isFinite(reading)) return null;
        if (spec.action === 'drain') {
          if (reading > spec.high) controller.on = true;
          else if (reading < spec.low) controller.on = false;
        } else {
          if (reading < spec.low) controller.on = true;
          else if (reading > spec.high) controller.on = false;
        }
        return controller.on ? num(spec.onValue, 1) : num(spec.offValue, 0);
      }
      case 'conditional': {
        const reading = this.reading(spec.sensor);
        if (!Number.isFinite(reading)) return null;
        const met = spec.operator === '>' ? reading > spec.threshold
          : spec.operator === '<' ? reading < spec.threshold
            : spec.operator === '>=' ? reading >= spec.threshold
              : reading <= spec.threshold;
        if (met) return spec.value;
        return typeof spec.otherwise === 'number' ? spec.otherwise : null;
      }
      case 'timed': {
        // The latest event at or before now is issued once, when its time arrives.
        const since = controller.started ? controller.lastTime : Number.NEGATIVE_INFINITY;
        const repeat = num(spec.repeat, 0);
        let latest = Number.NEGATIVE_INFINITY;
        let value: number | null = null;
        spec.events.forEach(event => {
          if (event.time > time + 1e-9) return;
          const occurrence = repeat > 0 ? event.time + Math.floor((time - event.time) / repeat + 1e-9) * repeat : event.time;
          if (occurrence >= latest) {
            latest = occurrence;
            value = event.value;
          }
        });
        return latest > since + 1e-9 ? value : null;
      }
      case 'pid': {
        const reading = this.reading(spec.sensor);
        if (!Number.isFinite(reading)) return null;
        const low = num(spec.min, 0);
        const high = num(spec.max, 1);
        const error = (spec.setpoint - reading) * (spec.reverse ? -1 : 1);
        const ki = num(spec.ki, 0);
        const kd = num(spec.kd, 0);
        if (!controller.started) {
          // Start from where the actuator already is, so there is no bump.
          const now = actuatorSetting(controller.actuator);
          controller.integral = ki !== 0 ? (clamp(Number.isFinite(now) ? now : high, low, high) - spec.kp * error) / ki : 0;
          controller.lastError = error;
        }
        const dt = controller.started ? time - controller.lastTime : 0;
        let integral = controller.integral + error * dt;
        const derivative = dt > 0 ? (error - controller.lastError) / dt : 0;
        let output = spec.kp * error + ki * integral + kd * derivative;
        // Anti-windup: stop integrating while the output is saturated.
        if (output > high) {
          output = high;
          if (error * ki > 0) integral = controller.integral;
        } else if (output < low) {
          output = low;
          if (error * ki < 0) integral = controller.integral;
        }
        controller.integral = integral;
        controller.lastError = error;
        return output;
      }
    }
  }
}
