function inQuietHours(quietHours, date = new Date()) {
  const parse = (value) => {
    if (!/^\d{2}:\d{2}$/.test(value || '')) return NaN;
    const hours = Number(value.slice(0, 2));
    const minutes = Number(value.slice(3));
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : NaN;
  };
  const start = parse(quietHours?.start);
  const end = parse(quietHours?.end);
  if (!quietHours?.enabled || !Number.isFinite(start) || !Number.isFinite(end) || start === end)
    return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * A state as Home Assistant spells it. People type "Not home" or "Armed Away", Home Assistant says
 * `not_home` and `armed_away`; case, spaces and underscores are not what an alert is about.
 */
function normalizeAlertState(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '_');
}

// The states each kind of entity reports, for the Specific State suggestions. Home Assistant's own
// words, not what a tile shows ("Locked" is the lock state `locked`).
const DOMAIN_STATES = {
  binary_sensor: ['on', 'off'],
  light: ['on', 'off'],
  switch: ['on', 'off'],
  input_boolean: ['on', 'off'],
  fan: ['on', 'off'],
  automation: ['on', 'off'],
  update: ['on', 'off'],
  lock: ['locked', 'unlocked', 'locking', 'unlocking', 'jammed', 'open', 'opening'],
  cover: ['open', 'closed', 'opening', 'closing'],
  alarm_control_panel: [
    'disarmed',
    'armed_home',
    'armed_away',
    'armed_night',
    'armed_vacation',
    'armed_custom_bypass',
    'pending',
    'arming',
    'disarming',
    'triggered',
  ],
  person: ['home', 'not_home'],
  device_tracker: ['home', 'not_home'],
  media_player: ['playing', 'paused', 'idle', 'standby', 'buffering', 'on', 'off'],
  climate: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'],
  vacuum: ['cleaning', 'docked', 'returning', 'paused', 'idle', 'error'],
  timer: ['idle', 'active', 'paused'],
  sun: ['above_horizon', 'below_horizon'],
};

/**
 * The states worth offering as a target for an entity: what it reports now, the choices it lists
 * itself (a select's options, a thermostat's hvac_modes), its kind's usual states, and the two an
 * offline alert needs. Each once, in that order.
 */
function getAlertStateSuggestions(entity) {
  if (!entity?.entity_id) return ['unavailable', 'unknown'];
  const domain = entity.entity_id.split('.')[0];
  const attributes = entity.attributes || {};
  const own = [attributes.options, attributes.hvac_modes].flatMap((list) =>
    Array.isArray(list) ? list : []
  );
  const suggestions = [entity.state, ...own, ...(DOMAIN_STATES[domain] || [])]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  return [...new Set([...suggestions, 'unavailable', 'unknown'])];
}

// Entities without a reading report these. They say nothing about a threshold or a target, so those
// rules ignore them, unless the rule names that very state ("tell me when it goes offline").
const NO_READING_STATES = new Set(['unknown', 'unavailable']);

function isUsableState(rule, value) {
  if (value === null || value === undefined) return false;
  if (!NO_READING_STATES.has(value)) return true;
  return !!rule && (!!rule.onStateChange || matchesTargetState(rule, value));
}

function matchesTargetState(rule, value) {
  const target = normalizeAlertState(rule.targetState);
  return !!rule.onSpecificState && !!target && normalizeAlertState(value) === target;
}

function matchesAlert(rule, value) {
  if (rule.onNumericThreshold) {
    if (value === null || value === undefined || String(value).trim() === '') return false;
    const number = Number(value);
    if (
      rule.threshold === null ||
      rule.threshold === undefined ||
      String(rule.threshold).trim() === ''
    )
      return false;
    const threshold = Number(rule.threshold);
    if (!Number.isFinite(number) || !Number.isFinite(threshold)) return false;
    return rule.comparison === 'below' ? number < threshold : number > threshold;
  }
  return matchesTargetState(rule, value);
}

function createAlertEvaluator({ getConfig, notify, now = () => Date.now() }) {
  const records = new Map();
  let enabled;
  const makeRecord = (id, entity) => ({
    previous: entity?.state,
    matched: false,
    signature: JSON.stringify(getConfig()?.alerts?.[id]),
  });
  const reset = (states = {}) => {
    records.forEach((record) => clearTimeout(record.timer));
    records.clear();
    enabled = !!getConfig()?.enabled;
    Object.entries(states).forEach(([id, entity]) => records.set(id, makeRecord(id, entity)));
  };
  // A dropped socket must not forget cooldowns or already-notified conditions, or every
  // reconnect would repeat the alert. Only pending duration timers are cancelled; those records
  // are re-evaluated from the state snapshot once the connection returns.
  const suspend = () => {
    records.forEach((record) => {
      if (!record.timer) return;
      clearTimeout(record.timer);
      record.timer = null;
      record.matched = false;
      record.resume = true;
    });
  };
  const reconcile = (states = {}) => {
    if (enabled !== !!getConfig()?.enabled) {
      reset(states);
      return;
    }
    // Keep timers and cooldowns for unchanged rules across ordinary config saves.
    for (const id of new Set([...records.keys(), ...Object.keys(states)])) {
      const record = records.get(id);
      if (!record || record.signature !== JSON.stringify(getConfig()?.alerts?.[id])) {
        clearTimeout(record?.timer);
        records.set(id, makeRecord(id, states[id]));
      }
    }
    // The reconnect snapshot arrives without state_changed events, so a condition that is still
    // true has to be re-armed here or its duration timer would never restart.
    records.forEach((record, id) => {
      if (record.resume) {
        delete record.resume;
        if (states[id]) check(id, states[id].state);
        return;
      }
      // A fresh snapshot may end a condition while disconnected. Keep cooldowns and already
      // notified matches that still hold, but take the snapshot as the new change baseline.
      const value = states[id]?.state;
      const rule = getConfig()?.alerts?.[id];
      const valid = isUsableState(rule, value);
      if (
        !valid ||
        (rule?.onStateChange ? value !== record.previous : !matchesAlert(rule || {}, value))
      ) {
        clearTimeout(record.timer);
        record.timer = null;
        record.matched = false;
      }
      record.previous = value;
    });
  };
  const check = (id, value) => {
    const config = getConfig();
    const rule = config?.alerts?.[id];
    const record = records.get(id) || makeRecord(id);
    records.set(id, record);
    if (!config?.enabled || !rule) {
      clearTimeout(record.timer);
      return;
    }
    const previous = record.previous;
    record.previous = value;
    const changed = previous !== undefined && previous !== value;
    const valid = isUsableState(rule, value);
    const matched = valid && (rule.onStateChange ? changed : matchesAlert(rule, value));
    if (rule.onStateChange ? changed || !valid : !matched) {
      clearTimeout(record.timer);
      record.timer = null;
      record.matched = false;
    }
    if (!matched || record.matched) return;
    record.matched = true;
    const signature = JSON.stringify(rule);
    const fire = () => {
      record.timer = null;
      const current = getConfig();
      if (!current?.enabled || signature !== JSON.stringify(current.alerts?.[id])) return;
      const cooldown = Math.max(0, Number(rule.cooldownSeconds) || 0) * 1000;
      if (
        inQuietHours(rule.quietHours, new Date(now())) ||
        (record.lastNotified !== undefined && now() - record.lastNotified < cooldown)
      )
        return;
      record.lastNotified = now();
      notify(id, previous, record.previous, rule);
    };
    const delay = Math.min(86400, Math.max(0, Number(rule.durationSeconds) || 0)) * 1000;
    if (delay) record.timer = setTimeout(fire, delay);
    else fire();
  };
  return { check, reset, reconcile, suspend };
}

export {
  inQuietHours,
  matchesAlert,
  normalizeAlertState,
  getAlertStateSuggestions,
  createAlertEvaluator,
};
