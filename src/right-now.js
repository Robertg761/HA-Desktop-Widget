import timerSensors from '../packages/widget-renderer/src/timer-sensors.cjs';
import { compareNames } from './format.js';

const { isTimerLikeSensor } = timerSensors;

// The "Right now" page is not stored with the person's pages. It is worked out from the live
// states each time it is drawn, so it has an id of its own that no stored page can take.
const RIGHT_NOW_PAGE_ID = 'right-now';

// A battery at or below this is low. Home Assistant's own battery badges turn red at 20% too.
const LOW_BATTERY_PERCENT = 20;

// The groups in the order the page shows them: what can be switched off first, then what is
// open, then what needs a hand (a battery to change, a device to bring back).
const RIGHT_NOW_GROUPS = ['on', 'media', 'timers', 'open', 'unlocked', 'battery', 'offline'];

const OPENING_SENSOR_CLASSES = new Set(['door', 'garage_door', 'opening', 'window']);
const OPENING_COVER_CLASSES = new Set(['door', 'garage', 'gate', 'window']);
const OPEN_COVER_STATES = new Set(['open', 'opening']);
// A jammed or open lock needs a look as much as an unlocked one does.
const UNLOCKED_STATES = new Set(['unlocked', 'unlocking', 'open', 'opening', 'jammed']);
// What a person thinks of as a device that went offline. Helpers, updates, buttons and the like
// are left out: an unavailable one says nothing about the home.
const OFFLINE_DOMAINS = new Set([
  'alarm_control_panel',
  'binary_sensor',
  'camera',
  'climate',
  'cover',
  'fan',
  'humidifier',
  'light',
  'lock',
  'media_player',
  'sensor',
  'switch',
  'vacuum',
  'valve',
  'water_heater',
]);
// When a device's entities are all unavailable, the one that stands for it is the one a person
// would know it by: what it controls before what it measures.
const OFFLINE_DOMAIN_RANK = [
  'light',
  'switch',
  'fan',
  'cover',
  'lock',
  'climate',
  'media_player',
  'vacuum',
  'camera',
  'humidifier',
  'water_heater',
  'valve',
  'alarm_control_panel',
  'binary_sensor',
  'sensor',
];

function getDomain(entityId) {
  return typeof entityId === 'string' ? entityId.split('.')[0] : '';
}

/** Whether the page is offered. It is on until someone turns it off in Settings. */
function isRightNowPageEnabled(config) {
  return config?.ui?.rightNowPage !== false;
}

// A light or player group repeats its members, which are on the page already.
function isGroupEntity(entity) {
  return Array.isArray(entity?.attributes?.entity_id) && entity.attributes.entity_id.length > 0;
}

function isLowBattery(entity, threshold) {
  const attributes = entity.attributes || {};
  if (attributes.device_class !== 'battery') return false;
  const domain = getDomain(entity.entity_id);
  if (domain === 'binary_sensor') return entity.state === 'on';
  if (domain !== 'sensor') return false;
  if (attributes.unit_of_measurement && attributes.unit_of_measurement !== '%') return false;
  const level = typeof entity.state === 'number' ? entity.state : Number.parseFloat(entity.state);
  return Number.isFinite(level) && level <= threshold;
}

function isRunningTimerSensor(entity, now) {
  if (!isTimerLikeSensor(entity)) return false;
  const attributes = entity.attributes || {};
  const end = [entity.state, attributes.finishes_at, attributes.end_time, attributes.finish_time]
    .map((value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN))
    .find(Number.isFinite);
  return Number.isFinite(end) && end > now;
}

/**
 * The group an entity belongs to on the page, or null when it has nothing to say right now.
 * Unavailable entities are handled apart (see the offline group), as one device can have many.
 */
function classifyRightNowEntity(entity, { now = Date.now(), batteryThreshold } = {}) {
  if (!entity?.entity_id || typeof entity.state !== 'string') return null;
  const domain = getDomain(entity.entity_id);
  const state = entity.state;
  const deviceClass = entity.attributes?.device_class;
  const threshold = Number.isFinite(batteryThreshold) ? batteryThreshold : LOW_BATTERY_PERCENT;

  if ((domain === 'light' || domain === 'fan') && state === 'on') {
    return isGroupEntity(entity) ? null : 'on';
  }
  if (domain === 'media_player' && state === 'playing') {
    return isGroupEntity(entity) ? null : 'media';
  }
  if (domain === 'timer' && (state === 'active' || state === 'paused')) return 'timers';
  if (domain === 'sensor' && isRunningTimerSensor(entity, now)) return 'timers';
  if (domain === 'binary_sensor' && state === 'on' && OPENING_SENSOR_CLASSES.has(deviceClass)) {
    return 'open';
  }
  if (
    domain === 'cover' &&
    OPEN_COVER_STATES.has(state) &&
    OPENING_COVER_CLASSES.has(deviceClass)
  ) {
    return 'open';
  }
  if (domain === 'lock' && UNLOCKED_STATES.has(state)) return 'unlocked';
  if (isLowBattery(entity, threshold)) return 'battery';
  return null;
}

function indexRegistry(registry) {
  const entries = new Map();
  (Array.isArray(registry?.entities) ? registry.entities : []).forEach((entry) => {
    if (entry?.entity_id) entries.set(entry.entity_id, entry);
  });
  return entries;
}

/**
 * Work out the page from the live states.
 *
 * `registry` is Home Assistant's entity registry list ({ entities }), when it could be read. With
 * it, hidden and disabled entities stay off the page, a device's settings and diagnostics stay off
 * it (except its battery level, which is diagnostic in most integrations), and an offline device
 * shows once rather than once for each of its entities. Without it the page still works from the
 * states alone, and offline entities are only counted for the domains above.
 *
 * @returns {{ entityIds: string[], groups: Record<string, string[]> }}
 */
function buildRightNowPage(states, registry = null, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const getName =
    typeof options.getName === 'function'
      ? options.getName
      : (entity) => entity?.attributes?.friendly_name || entity?.entity_id || '';
  const entries = indexRegistry(registry);
  const hasRegistry = entries.size > 0;
  const groups = Object.fromEntries(RIGHT_NOW_GROUPS.map((group) => [group, []]));
  const offlineByDevice = new Map();

  Object.values(states || {}).forEach((entity) => {
    if (!entity?.entity_id) return;
    const entry = entries.get(entity.entity_id);
    if (entry?.hidden_by || entry?.disabled_by) return;
    const domain = getDomain(entity.entity_id);

    if (entity.state === 'unavailable') {
      if (!OFFLINE_DOMAINS.has(domain) || entry?.entity_category) return;
      // With the registry, an entity that belongs to no device (a template, a helper) is not a
      // device that went offline.
      if (hasRegistry && !entry?.device_id) return;
      const key = entry?.device_id || entity.entity_id;
      const current = offlineByDevice.get(key);
      const rank = OFFLINE_DOMAIN_RANK.indexOf(domain);
      if (!current || rank < current.rank) {
        offlineByDevice.set(key, { entityId: entity.entity_id, rank });
      }
      return;
    }

    const group = classifyRightNowEntity(entity, {
      now,
      batteryThreshold: options.batteryThreshold,
    });
    if (!group) return;
    if (entry?.entity_category && group !== 'battery') return;
    groups[group].push(entity.entity_id);
  });

  groups.offline = [...offlineByDevice.values()].map((item) => item.entityId);

  const byName = (a, b) =>
    compareNames(getName(states[a]) || a, getName(states[b]) || b) || compareNames(a, b);
  RIGHT_NOW_GROUPS.forEach((group) => groups[group].sort(byName));

  return {
    entityIds: RIGHT_NOW_GROUPS.flatMap((group) => groups[group]),
    groups,
  };
}

/**
 * The ids to draw this time: the new page, with ids that just left it kept in their old place
 * until `lingerUntil` passes, so the tile a person just switched off does not vanish under the
 * pointer. Returns the ids and the next time one of them is due to go (or null).
 */
function mergeLingeringIds(previousIds, nextIds, lingerUntil, now = Date.now()) {
  const next = new Set(nextIds);
  const kept = [];
  let nextExpiry = null;
  previousIds.forEach((id, index) => {
    if (next.has(id)) return;
    const until = lingerUntil.get(id);
    if (!Number.isFinite(until) || until <= now) return;
    kept.push({ id, index });
    nextExpiry = nextExpiry === null ? until : Math.min(nextExpiry, until);
  });
  const ids = [...nextIds];
  kept.forEach(({ id, index }) => ids.splice(Math.min(index, ids.length), 0, id));
  return { entityIds: ids, nextExpiry };
}

export {
  LOW_BATTERY_PERCENT,
  RIGHT_NOW_GROUPS,
  RIGHT_NOW_PAGE_ID,
  buildRightNowPage,
  classifyRightNowEntity,
  isRightNowPageEnabled,
  mergeLingeringIds,
};
