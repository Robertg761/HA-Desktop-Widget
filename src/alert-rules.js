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
  return !!rule.onSpecificState && value === rule.targetState;
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
  // re-arm from the first reading after the connection returns.
  const suspend = () => {
    records.forEach((record) => {
      if (!record.timer) return;
      clearTimeout(record.timer);
      record.timer = null;
      record.matched = false;
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
    const valid =
      value !== null && value !== undefined && !['unknown', 'unavailable'].includes(value);
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

export { inQuietHours, matchesAlert, createAlertEvaluator };
