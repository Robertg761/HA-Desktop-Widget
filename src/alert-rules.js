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

// A State Change rule also tells about an entity that goes unavailable or unknown (unless its
// "Notify when unavailable" switch is off). A device that drops off Wi-Fi and returns, over and over,
// would turn that into spam, so two limits apply on top of the rule's own duration and cooldown:
// the entity must stay without a reading this long before anyone is told, and one entity is told
// about at most once per interval, however often it goes and comes back. The Alerts dialog says
// both in its help text.
const UNAVAILABLE_GRACE_MS = 30 * 1000;
const UNAVAILABLE_NOTIFY_INTERVAL_MS = 15 * 60 * 1000;

const hasReading = (value) =>
  value !== null && value !== undefined && !NO_READING_STATES.has(value);

// Whether `rule` tells about an entity whose record shows it offline, which only a State Change rule
// whose switch is not off does.
const tellsOutage = (rule, record) =>
  !!rule?.onStateChange &&
  rule.notifyOnUnavailable !== false &&
  NO_READING_STATES.has(record.previous);

function isUsableState(rule, value) {
  if (value === null || value === undefined) return false;
  if (!NO_READING_STATES.has(value)) return true;
  return !!rule && (!!rule.onStateChange || matchesTargetState(rule, value));
}

// An entity without a reading has not left a Specific State or threshold condition, unless the rule
// names that very state: a lamp that drops off Wi-Fi for a second, or every entity while Home
// Assistant restarts, is still on as far as anyone knows. So the outage keeps a match already told
// about, and the entity coming back in the same condition is not news. (A State Change rule judges
// an outage against its last real reading instead.)
const outageLeavesMatch = (rule, value) =>
  !!rule && !rule.onStateChange && NO_READING_STATES.has(value) && !matchesTargetState(rule, value);

const disarm = (record) => {
  clearTimeout(record.timer);
  record.timer = null;
  record.matched = false;
};

// A duration still being waited out when the entity goes offline starts over once it is back:
// nobody can say the condition held through the outage.
const stopWaiting = (record) => {
  if (record.timer) disarm(record);
};

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
    // The last real reading, for a State Change rule to judge an entity that comes back from an
    // outage: it is only a change if it came back as something else.
    lastReal: hasReading(entity?.state) ? entity.state : undefined,
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
      const rule = getConfig()?.alerts?.[id];
      if (!record || record.signature !== JSON.stringify(rule)) {
        clearTimeout(record?.timer);
        const fresh = makeRecord(id, states[id]);
        if (record) {
          // An edited rule starts over, but when an entity was last told about is not part of the
          // rule: saving it again must not open the fifteen-minute limit to a flapping device.
          fresh.lastNotified = record.lastNotified;
          fresh.lastOutageNotified = record.lastOutageNotified;
          if (fresh.lastReal === undefined) fresh.lastReal = record.lastReal;
          // An outage still waiting to be told about starts its wait over, as after a reconnect:
          // the entity is offline and no state change will bring it up again.
          if (record.outagePending && (record.timer || record.resume) && tellsOutage(rule, fresh))
            fresh.resume = true;
        }
        records.set(id, fresh);
      }
    }
    // The reconnect snapshot arrives without state_changed events, so a condition that is still
    // true has to be re-armed here or its duration timer would never restart.
    records.forEach((record, id) => {
      const value = states[id]?.state;
      const rule = getConfig()?.alerts?.[id];
      if (record.resume) {
        delete record.resume;
        // Only an outage's waiting period can be pending while the entity has no reading. It starts
        // over, so an entity that stays offline through a reconnect is still told about.
        if (tellsOutage(rule, record) && NO_READING_STATES.has(value)) {
          record.previous = value;
          record.matched = true;
          arm(id, record, rule, record.lastReal, true);
        } else if (states[id]) check(id, value);
        return;
      }
      // A fresh snapshot may end a condition while disconnected. Keep cooldowns and already
      // notified matches that still hold, but take the snapshot as the new change baseline.
      if (outageLeavesMatch(rule, value)) stopWaiting(record);
      else if (
        !isUsableState(rule, value) ||
        (rule?.onStateChange ? value !== record.previous : !matchesAlert(rule || {}, value))
      )
        disarm(record);
      record.previous = value;
      if (hasReading(value)) record.lastReal = value;
    });
  };
  // Tells about `rule` once its waiting period is over, unless quiet hours or a cooldown say no.
  // `outage` is news of an entity gone offline, which has a waiting period and a limit of its own.
  const arm = (id, record, rule, previous, outage = false) => {
    const signature = JSON.stringify(rule);
    const fire = () => {
      record.timer = null;
      const current = getConfig();
      if (!current?.enabled || signature !== JSON.stringify(current.alerts?.[id])) return;
      const cooldown = Math.max(0, Number(rule.cooldownSeconds) || 0) * 1000;
      if (
        inQuietHours(rule.quietHours, new Date(now())) ||
        (record.lastNotified !== undefined && now() - record.lastNotified < cooldown) ||
        (outage &&
          record.lastOutageNotified !== undefined &&
          now() - record.lastOutageNotified < UNAVAILABLE_NOTIFY_INTERVAL_MS)
      )
        return;
      record.lastNotified = now();
      if (outage) record.lastOutageNotified = record.lastNotified;
      notify(id, previous, record.previous, rule);
    };
    let delay = Math.min(86400, Math.max(0, Number(rule.durationSeconds) || 0)) * 1000;
    if (outage) delay = Math.max(delay, UNAVAILABLE_GRACE_MS);
    if (delay) {
      record.timer = setTimeout(fire, delay);
      record.outagePending = outage;
    } else fire();
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
    let previous = record.previous;
    record.previous = value;
    if (outageLeavesMatch(rule, value)) {
      stopWaiting(record);
      return;
    }
    const offline = !!rule.onStateChange && NO_READING_STATES.has(value);
    if (rule.onStateChange && NO_READING_STATES.has(previous)) {
      // Unavailable to unknown, or back, is the same outage: its waiting period, or the news
      // already given, stands.
      if (offline) return;
      // Back from an outage. News of it that was still waiting is moot, and the entity is judged
      // against the last real reading: a lamp that was on and is on again has not changed.
      disarm(record);
      previous = record.lastReal;
    }
    if (hasReading(value)) record.lastReal = value;
    const changed = previous !== undefined && previous !== value;
    const valid = isUsableState(rule, value);
    const silenced = offline && rule.notifyOnUnavailable === false;
    const matched =
      valid && !silenced && (rule.onStateChange ? changed : matchesAlert(rule, value));
    if (rule.onStateChange ? changed || !valid : !matched) disarm(record);
    if (!matched || record.matched) return;
    record.matched = true;
    arm(id, record, rule, previous, offline);
  };
  return { check, reset, reconcile, suspend };
}

export {
  UNAVAILABLE_GRACE_MS,
  UNAVAILABLE_NOTIFY_INTERVAL_MS,
  inQuietHours,
  matchesAlert,
  normalizeAlertState,
  getAlertStateSuggestions,
  createAlertEvaluator,
};
