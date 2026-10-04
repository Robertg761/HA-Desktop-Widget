/**
 * Which sensors are countdowns. One rule for the tile, the pin, the icon, the palette and the
 * tray, shared as CommonJS because the desktop pin support module (main and renderer) needs it
 * too.
 */

const PLAIN_NUMBER = /^\s*-?(?:0|[1-9]\d*)(?:\.\d+)?\s*$/;

/**
 * True for a sensor that counts down to an end time, such as a Google or Alexa kitchen timer: it
 * names a finish time or has "timer" in its id. A sensor that reports a number or has a unit is
 * a measurement instead, however it is named or whatever attributes it carries (a travel time
 * has a `duration`, "washer_timer_hours" counts hours), and a timestamp with no timer hints is
 * just a date (see formatDateState).
 * @param {object} entity - A Home Assistant state object.
 * @returns {boolean}
 */
function isTimerLikeSensor(entity) {
  if (!entity?.entity_id?.startsWith('sensor.')) return false;
  const attributes = entity.attributes || {};
  if (attributes.unit_of_measurement) return false;
  const stateText = typeof entity.state === 'number' ? String(entity.state) : entity.state;
  if (typeof stateText === 'string' && PLAIN_NUMBER.test(stateText)) return false;
  return !!(
    attributes.finishes_at ||
    attributes.end_time ||
    attributes.finish_time ||
    entity.entity_id.toLowerCase().includes('timer')
  );
}

module.exports = { isTimerLikeSensor };
