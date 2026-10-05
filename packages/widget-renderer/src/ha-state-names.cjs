/**
 * English display names for Home Assistant's raw states, as translation keys. The renderer
 * (entity tiles, pins, palette, dialogs, alerts) and the tray tooltips read the same tables, so
 * every surface says "Armed away" or "Closed" in the same words and shares one set of language
 * pack keys. This is CommonJS because the main process requires it too.
 */

// A thermostat's HVAC mode, in Home Assistant's own words. The state of a climate entity is its
// mode, not what it is doing (an idle thermostat in heat mode is not heating), and heat_cool and
// auto are different modes, so each has a name of its own. The climate dialog and the pins name the
// mode buttons from this table too, so a thermostat is called the same thing everywhere.
const HVAC_MODE_NAMES = Object.freeze({
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Heat/Cool',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan only',
});

// The state of an entity, by the raw state Home Assistant sends.
const STATE_NAMES = Object.freeze({
  on: 'On',
  off: 'Off',
  home: 'Home',
  not_home: 'Away',
  open: 'Open',
  opening: 'Opening',
  closed: 'Closed',
  closing: 'Closing',
  stopped: 'Stopped',
  locked: 'Locked',
  unlocked: 'Unlocked',
  locking: 'Locking',
  unlocking: 'Unlocking',
  jammed: 'Jammed',
  playing: 'Playing',
  paused: 'Paused',
  idle: 'Idle',
  standby: 'Standby',
  buffering: 'Buffering',
  active: 'Active',
  cleaning: 'Cleaning',
  docked: 'Docked',
  returning: 'Returning',
  error: 'Error',
  heat: 'Heating',
  cool: 'Cooling',
  heat_cool: 'Automatic',
  auto: 'Automatic',
  dry: 'Drying',
  fan_only: 'Fan',
  disarmed: 'Disarmed',
  disarming: 'Disarming',
  armed_home: 'Armed at home',
  armed_away: 'Armed away',
  armed_night: 'Armed at night',
  armed_vacation: 'Armed on vacation',
  armed_custom_bypass: 'Armed',
  arming: 'Arming',
  pending: 'Pending',
  triggered: 'Alarm',
  charging: 'Charging',
  discharging: 'Discharging',
  not_charging: 'Not charging',
  full: 'Full',
  running: 'Running',
  streaming: 'Streaming',
  recording: 'Recording',
  above_horizon: 'Above horizon',
  below_horizon: 'Below horizon',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
});

// What a binary sensor reads when it is on and off, by device class: [on, off]. A class that is
// missing here reads "Detected" and "Clear".
const BINARY_STATE_NAMES = Object.freeze({
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  lock: ['Unlocked', 'Locked'],
  motion: ['Motion', 'Clear'],
  moving: ['Moving', 'Still'],
  occupancy: ['Occupied', 'Clear'],
  presence: ['Home', 'Away'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Smoke', 'Clear'],
  gas: ['Gas', 'Clear'],
  carbon_monoxide: ['Carbon monoxide', 'Clear'],
  problem: ['Problem', 'OK'],
  safety: ['Unsafe', 'Safe'],
  battery: ['Low', 'OK'],
  battery_charging: ['Charging', 'Idle'],
  connectivity: ['Connected', 'Disconnected'],
  plug: ['Plugged in', 'Unplugged'],
  power: ['On', 'Off'],
  running: ['Running', 'Idle'],
  cold: ['Cold', 'OK'],
  heat: ['Hot', 'OK'],
  light: ['Light', 'Dark'],
  sound: ['Sound', 'Clear'],
  vibration: ['Vibration', 'Clear'],
  tamper: ['Tampered', 'OK'],
  update: ['Update', 'OK'],
});

module.exports = { HVAC_MODE_NAMES, STATE_NAMES, BINARY_STATE_NAMES };
