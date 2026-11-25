// Names shown for the parts of the cyber layer. They follow the ACWAverse
// paper: control is made of timed control actions and conditional actions, and
// attacks fall into data poisoning, physical damage and chemical interference.

export const CONTROLLER_NAMES = {
  timed: 'Timed control action',
  conditional: 'Conditional action',
  onoff: 'On/off control',
  pid: 'PID loop'
};

/** Short tags for the badges on the diagram. */
export const CONTROLLER_TAGS = { timed: 'TIME', conditional: 'IF', onoff: 'H/L', pid: 'PID' };

export const ATTACK_NAMES = {
  data_poisoning: 'Data poisoning',
  command_injection: 'Command injection',
  controller_tamper: 'Control action tampering',
  pump_failure: 'Pump failure',
  valve_stuck: 'Valve stuck',
  leak: 'Leak',
  pipe_blockage: 'Pipe blockage',
  chemical_interference: 'Chemical interference'
};

/** The three attack families. */
export const CLASS_NAMES = {
  data_poisoning: 'Data poisoning',
  physical_damage: 'Physical damage',
  chemical_interference: 'Chemical interference'
};

export const CLASS_NOTES = {
  data_poisoning: 'False data in the control system. The plant is untouched, but conditional actions and the display are misled.',
  physical_damage: 'Damage to equipment.',
  chemical_interference: 'Something put into the water.'
};
