/**
 * Pop-up alert cards: the pure half, shared by the main process (which opens the card and decides
 * what it may do) and the renderer (the Alerts dialog that sets a card up, and the card itself).
 *
 * An alert rule can ask for a small card on the desktop instead of a text-only system notification.
 * The card names the entity and what happened, can show a camera live, and offers up to two buttons
 * that act on entities of the user's choosing (unlock the front door, turn off the porch light).
 * It fades away on its own after a while, or stays until it is closed.
 *
 * The rule keeps `popup: { enabled, camera, actions, seconds }`. A rule saved before this existed
 * has no `popup` and keeps sending the system notification.
 */

const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// How long a card stays before it fades, in seconds. 0 keeps it until it is closed.
const ALERT_POPUP_DURATIONS = Object.freeze([15, 30, 60, 120, 0]);
const DEFAULT_ALERT_POPUP_SECONDS = 30;
const MAX_ALERT_POPUP_ACTIONS = 2;
// More than this on screen at once and the oldest goes, so a burst of alerts cannot cover a screen.
const MAX_ALERT_POPUPS = 3;

const ALERT_POPUP_TITLE_LIMIT = 120;
const ALERT_POPUP_MESSAGE_LIMIT = 300;
const ALERT_POPUP_LABEL_LIMIT = 40;

// The services a card's button may call, by domain. The card asks for a button by its number and
// the main process calls what was decided when the card opened, so nothing else can be called
// through it; this list is the second check, on what the main window asked for.
const ALERT_POPUP_SERVICES = Object.freeze({
  lock: Object.freeze(['lock', 'unlock']),
  light: Object.freeze(['turn_on', 'turn_off']),
  switch: Object.freeze(['turn_on', 'turn_off']),
  fan: Object.freeze(['turn_on', 'turn_off']),
  input_boolean: Object.freeze(['turn_on', 'turn_off']),
  siren: Object.freeze(['turn_on', 'turn_off']),
  humidifier: Object.freeze(['turn_on', 'turn_off']),
  remote: Object.freeze(['turn_on', 'turn_off']),
  automation: Object.freeze(['turn_on', 'turn_off']),
  climate: Object.freeze(['turn_on', 'turn_off']),
  water_heater: Object.freeze(['turn_on', 'turn_off']),
  cover: Object.freeze(['open_cover', 'close_cover']),
  valve: Object.freeze(['open_valve', 'close_valve']),
  alarm_control_panel: Object.freeze(['alarm_disarm', 'alarm_arm_away']),
  vacuum: Object.freeze(['start', 'return_to_base']),
  lawn_mower: Object.freeze(['start_mowing', 'dock']),
  timer: Object.freeze(['start', 'cancel']),
  button: Object.freeze(['press']),
  input_button: Object.freeze(['press']),
  scene: Object.freeze(['turn_on']),
  script: Object.freeze(['turn_on']),
  media_player: Object.freeze(['media_play', 'media_pause', 'turn_off']),
});

// Kinds of entity that turn on and off and say so as `on` and `off`.
const ON_OFF_DOMAINS = new Set([
  'light',
  'switch',
  'fan',
  'input_boolean',
  'siren',
  'humidifier',
  'remote',
  'automation',
]);
const NO_READING_STATES = new Set(['unavailable', 'unknown']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEntityId(value) {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function getDomain(entityId) {
  return typeof entityId === 'string' ? entityId.split('.')[0] : '';
}

// A tile colour from Tile settings, as #RRGGBB, or '' for one that follows the accent.
function cleanColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value) ? value.toUpperCase() : '';
}

// One line of text, cut at a character boundary.
function cleanText(value, limit) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, limit).join('');
}

/** Whether an entity of this kind can be a card's button. */
function isAlertPopupActionDomain(domain) {
  return Object.prototype.hasOwnProperty.call(ALERT_POPUP_SERVICES, domain);
}

// Home Assistant's feature flags for the buttons a card offers. An entity that reports no features
// is offered the button anyway, as its tile does; one that says it cannot is not.
const FEATURES = Object.freeze({
  cover: { open: 1, close: 2 },
  valve: { open: 1, close: 2 },
  alarm_control_panel: { arm_away: 2 },
  climate: { turn_off: 128, turn_on: 256 },
  water_heater: { on_off: 8 },
  vacuum: { return_home: 16, start: 8192 },
  lawn_mower: { start: 1, dock: 4 },
  media_player: { pause: 1, turn_off: 256, play: 16384 },
});

function supports(attributes, flag) {
  const features = Number(attributes.supported_features);
  if (!flag || attributes.supported_features == null || !Number.isFinite(features)) return true;
  return (features & flag) === flag;
}

/**
 * The button an entity gets on a card, from its state when the card opens: a locked lock offers
 * Unlock, a light that is on offers Turn off, an open water valve offers Close. `label` is the
 * English text and `context` the translation context, which the renderer translates. Null when the
 * entity offers nothing now: it is offline, it says it cannot, or it wants a code (a lock or an
 * alarm panel with a code), which a card has nowhere to type.
 */
function getAlertPopupAction(entity) {
  const entityId = entity?.entity_id;
  if (!isEntityId(entityId)) return null;
  const domain = getDomain(entityId);
  const state = typeof entity.state === 'string' ? entity.state : '';
  const attributes = isPlainObject(entity.attributes) ? entity.attributes : {};
  if (!state || NO_READING_STATES.has(state)) return null;
  const flags = FEATURES[domain] || {};
  const action = (service, label, context = '', flag = 0) => {
    if (!supports(attributes, flag)) return null;
    return {
      entityId,
      domain,
      service,
      label,
      ...(context ? { context } : {}),
    };
  };

  if (domain === 'lock') {
    if (attributes.code_format) return null;
    return state === 'locked' || state === 'locking'
      ? action('unlock', 'Unlock')
      : action('lock', 'Lock');
  }
  if (ON_OFF_DOMAINS.has(domain)) {
    return state === 'on' ? action('turn_off', 'Turn off') : action('turn_on', 'Turn on');
  }
  if (domain === 'climate') {
    return state === 'off'
      ? action('turn_on', 'Turn on', '', flags.turn_on)
      : action('turn_off', 'Turn off', '', flags.turn_off);
  }
  if (domain === 'water_heater') {
    return state === 'off'
      ? action('turn_on', 'Turn on', '', flags.on_off)
      : action('turn_off', 'Turn off', '', flags.on_off);
  }
  if (domain === 'cover' || domain === 'valve') {
    const suffix = domain === 'cover' ? 'cover' : 'valve';
    return state === 'open' || state === 'opening'
      ? action(`close_${suffix}`, 'Close', '', flags.close)
      : action(`open_${suffix}`, 'Open', 'Action: Open', flags.open);
  }
  if (domain === 'alarm_control_panel') {
    // A panel that wants a code to disarm wants one for everything a card could offer.
    if (attributes.code_format) {
      if (state !== 'disarmed' || attributes.code_arm_required !== false) return null;
    }
    if (state === 'disarmed') return action('alarm_arm_away', 'Arm', '', flags.arm_away);
    if (state === 'disarming') return null;
    return action('alarm_disarm', 'Disarm');
  }
  if (domain === 'vacuum') {
    return state === 'cleaning'
      ? action('return_to_base', 'Return', '', flags.return_home)
      : action('start', 'Start', '', flags.start);
  }
  if (domain === 'lawn_mower') {
    return state === 'mowing'
      ? action('dock', 'Return', '', flags.dock)
      : action('start_mowing', 'Start', '', flags.start);
  }
  if (domain === 'timer') {
    if (state === 'active') return action('cancel', 'Cancel');
    return action('start', state === 'paused' ? 'Resume' : 'Start');
  }
  if (domain === 'button' || domain === 'input_button') return action('press', 'Press');
  if (domain === 'scene') return action('turn_on', 'Activate');
  if (domain === 'script') return action('turn_on', 'Run');
  if (domain === 'media_player') {
    if (state === 'playing') return action('media_pause', 'Pause', '', flags.pause);
    if (state === 'paused') return action('media_play', 'Play', '', flags.play);
    if (state !== 'off') return action('turn_off', 'Turn off', '', flags.turn_off);
  }
  return null;
}

/**
 * A rule's pop-up settings in their saved shape, or null when the rule has none (or turned it off
 * and never chose anything). Unknown cameras and buttons are kept as long as they look like entity
 * ids: an entity Home Assistant has not sent yet is not a reason to forget the user's choice.
 */
function normalizeAlertPopupConfig(popup) {
  if (!isPlainObject(popup)) return null;
  const seconds = Number(popup.seconds);
  const actions = Array.isArray(popup.actions)
    ? [
        ...new Set(
          popup.actions.filter(
            (entityId) => isEntityId(entityId) && isAlertPopupActionDomain(getDomain(entityId))
          )
        ),
      ].slice(0, MAX_ALERT_POPUP_ACTIONS)
    : [];
  return {
    enabled: popup.enabled === true,
    camera: isEntityId(popup.camera) && getDomain(popup.camera) === 'camera' ? popup.camera : '',
    actions,
    seconds: ALERT_POPUP_DURATIONS.includes(seconds) ? seconds : DEFAULT_ALERT_POPUP_SECONDS,
  };
}

// Words that say what kind of thing an entity is rather than where it is: binary_sensor.front_door_ding,
// camera.front_door_camera and lock.front_door_lock are all about the front door.
const PLACE_MATCH_NOISE = new Set([
  'alarm',
  'bell',
  'binary',
  'button',
  'cam',
  'camera',
  'chime',
  'contact',
  'detected',
  'detection',
  'ding',
  'doorbell',
  'event',
  'lamp',
  'leak',
  'light',
  'lights',
  'lock',
  'moisture',
  'motion',
  'occupancy',
  'opener',
  'package',
  'person',
  'presence',
  'press',
  'pressed',
  'ring',
  'sensor',
  'shutoff',
  'snapshot',
  'state',
  'status',
  'valve',
  'visitor',
]);

function placeWords(entityId) {
  const objectId = String(entityId || '').split('.')[1] || '';
  return objectId.split('_').filter((word) => word && !PLACE_MATCH_NOISE.has(word));
}

function entityIdsOf(states, domain) {
  return Object.keys(isPlainObject(states) ? states : {}).filter(
    (candidate) => getDomain(candidate) === domain && isEntityId(candidate)
  );
}

/**
 * The entity of `domain` whose name says it is at the same place as `entityId`: its place words
 * start the trigger's (lock.front_door for binary_sensor.front_door_ding). The closest wins; a tie
 * is no answer, since a wrong guess on an alert card is worse than none.
 */
function findAtSamePlace(entityId, states, domain) {
  const words = placeWords(entityId);
  if (!words.length) return '';
  let best = '';
  let bestLength = 0;
  let tied = false;
  entityIdsOf(states, domain).forEach((candidate) => {
    if (candidate === entityId) return;
    const candidateWords = placeWords(candidate);
    if (!candidateWords.length || candidateWords.length > words.length) return;
    if (!candidateWords.every((word, index) => words[index] === word)) return;
    if (candidateWords.length > bestLength) {
      best = candidate;
      bestLength = candidateWords.length;
      tied = false;
    } else if (candidateWords.length === bestLength) {
      tied = true;
    }
  });
  return tied ? '' : best;
}

// What an entity is about, from its device class and its name: someone at the door, a leak.
const VISITOR_CLASSES = new Set(['doorbell', 'motion', 'occupancy', 'presence', 'sound']);
const VISITOR_WORDS = new Set([
  'ding',
  'doorbell',
  'motion',
  'package',
  'person',
  'ring',
  'visitor',
]);
const LEAK_WORDS = new Set(['flood', 'leak', 'moisture', 'water']);

function describe(entityId, states) {
  const attributes = (isPlainObject(states) && states[entityId]?.attributes) || {};
  const deviceClass = typeof attributes.device_class === 'string' ? attributes.device_class : '';
  const words = (String(entityId).split('.')[1] || '').split('_');
  return {
    visitor: VISITOR_CLASSES.has(deviceClass) || words.some((word) => VISITOR_WORDS.has(word)),
    leak: deviceClass === 'moisture' || words.some((word) => LEAK_WORDS.has(word)),
  };
}

/**
 * The camera a new pop-up should start with: the entity itself when it is a camera, otherwise the
 * camera whose name says it is at the same place (camera.front_door for
 * binary_sensor.front_door_ding), otherwise, for a doorbell or a motion sensor in a home with one
 * camera, that camera. Empty when no camera clearly fits. The user can always pick another.
 */
function suggestAlertPopupCamera(entityId, states = {}) {
  if (!isEntityId(entityId)) return '';
  if (getDomain(entityId) === 'camera') return entityId;
  const atSamePlace = findAtSamePlace(entityId, states, 'camera');
  if (atSamePlace) return atSamePlace;
  const cameras = entityIdsOf(states, 'camera');
  return cameras.length === 1 && describe(entityId, states).visitor ? cameras[0] : '';
}

// The kinds of entity a card's buttons are looked for at the same place, most useful first: the
// door's lock before its light.
const SAME_PLACE_ACTION_DOMAINS = Object.freeze([
  'lock',
  'cover',
  'valve',
  'alarm_control_panel',
  'light',
  'siren',
  'switch',
  'fan',
]);

/**
 * The buttons a new pop-up should start with: the entity's own when it has one (the garage door's
 * Close), then what is at the same place (the front door's lock for its doorbell), and for a leak
 * sensor the home's only water valve. At most two.
 */
function suggestAlertPopupActions(entityId, states = {}) {
  if (!isEntityId(entityId)) return [];
  const suggested = [];
  const add = (candidate) => {
    if (candidate && !suggested.includes(candidate) && suggested.length < MAX_ALERT_POPUP_ACTIONS)
      suggested.push(candidate);
  };
  if (isAlertPopupActionDomain(getDomain(entityId))) add(entityId);
  if (describe(entityId, states).leak) {
    const valves = entityIdsOf(states, 'valve');
    add(findAtSamePlace(entityId, states, 'valve') || (valves.length === 1 ? valves[0] : ''));
  }
  SAME_PLACE_ACTION_DOMAINS.forEach((domain) => add(findAtSamePlace(entityId, states, domain)));
  return suggested;
}

/**
 * What the main window asks the main process to open, checked: the main process trusts the main
 * window, but the card is a separate window and is told only what passed here. Null when there is
 * nothing to open.
 */
function sanitizeAlertPopupRequest(request) {
  if (!isPlainObject(request) || !isEntityId(request.entityId)) return null;
  const seconds = Number(request.seconds);
  const icon = isPlainObject(request.icon) ? request.icon : {};
  const iconAttributes = isPlainObject(icon.attributes) ? icon.attributes : {};
  const actions = (Array.isArray(request.actions) ? request.actions : [])
    .filter(
      (action) =>
        isPlainObject(action) &&
        isEntityId(action.entityId) &&
        action.domain === getDomain(action.entityId) &&
        (ALERT_POPUP_SERVICES[action.domain] || []).includes(action.service)
    )
    .slice(0, MAX_ALERT_POPUP_ACTIONS)
    .map((action) => ({
      entityId: action.entityId,
      domain: action.domain,
      service: action.service,
      label: cleanText(action.label, ALERT_POPUP_LABEL_LIMIT) || action.service,
      name: cleanText(action.name, ALERT_POPUP_TITLE_LIMIT),
      // The button takes its entity's tile colour, as its tile does.
      ...(cleanColor(action.color) ? { color: cleanColor(action.color) } : {}),
    }));
  return {
    entityId: request.entityId,
    title: cleanText(request.title, ALERT_POPUP_TITLE_LIMIT) || request.entityId,
    message: cleanText(request.message, ALERT_POPUP_MESSAGE_LIMIT),
    // Enough of the entity to draw its icon, and nothing more.
    icon: {
      entity_id: request.entityId,
      state: cleanText(icon.state, 64),
      attributes: {
        ...(typeof iconAttributes.icon === 'string'
          ? { icon: cleanText(iconAttributes.icon, 64) }
          : {}),
        ...(typeof iconAttributes.device_class === 'string'
          ? { device_class: cleanText(iconAttributes.device_class, 64) }
          : {}),
      },
    },
    camera:
      isEntityId(request.camera) && getDomain(request.camera) === 'camera' ? request.camera : '',
    // The alerting entity's tile colour, for the card's icon and its glow.
    ...(cleanColor(request.color) ? { color: cleanColor(request.color) } : {}),
    actions,
    seconds: ALERT_POPUP_DURATIONS.includes(seconds) ? seconds : DEFAULT_ALERT_POPUP_SECONDS,
    at: Number.isFinite(Number(request.at)) ? Number(request.at) : Date.now(),
  };
}

const ALERT_POPUP_WIDTH = 340;
const ALERT_POPUP_BASE_HEIGHT = 104;
// A 16:9 picture the width of the card, less its padding.
const ALERT_POPUP_CAMERA_HEIGHT = 174;
const ALERT_POPUP_ACTIONS_HEIGHT = 52;
const ALERT_POPUP_MARGIN = 16;
const ALERT_POPUP_GAP = 12;

/** A card's size: taller with a camera, and with a row of buttons. */
function getAlertPopupSize(popup) {
  return {
    width: ALERT_POPUP_WIDTH,
    height:
      ALERT_POPUP_BASE_HEIGHT +
      (popup?.camera ? ALERT_POPUP_CAMERA_HEIGHT : 0) +
      (popup?.actions?.length ? ALERT_POPUP_ACTIONS_HEIGHT : 0),
  };
}

/** Whether a stack of cards of these sizes fits the height of the work area, margins and all. */
function fitsAlertPopups(sizes, workArea) {
  if (!isPlainObject(workArea) || !Number.isFinite(workArea.height)) return true;
  const height = sizes.reduce((total, size) => total + size.height, 0);
  const gaps = Math.max(0, sizes.length - 1) * ALERT_POPUP_GAP;
  return height + gaps + ALERT_POPUP_MARGIN * 2 <= workArea.height;
}

/**
 * Where each card goes: stacked up from the bottom-right corner of the work area, newest at the
 * bottom, where notifications appear on Windows and most Linux desktops. `sizes` lists the cards
 * oldest first. A card that would leave the top of the work area is placed anyway at its top edge;
 * MAX_ALERT_POPUPS keeps that from happening on any ordinary screen.
 */
function layoutAlertPopups(sizes, workArea) {
  const area = isPlainObject(workArea) ? workArea : { x: 0, y: 0, width: 1280, height: 720 };
  let bottom = area.y + area.height - ALERT_POPUP_MARGIN;
  const placed = [];
  for (let index = sizes.length - 1; index >= 0; index -= 1) {
    const { width, height } = sizes[index];
    const y = Math.max(area.y, bottom - height);
    placed[index] = {
      x: Math.round(area.x + area.width - ALERT_POPUP_MARGIN - width),
      y: Math.round(y),
      width,
      height,
    };
    bottom = y - ALERT_POPUP_GAP;
  }
  return placed;
}

module.exports = {
  ALERT_POPUP_DURATIONS,
  ALERT_POPUP_SERVICES,
  DEFAULT_ALERT_POPUP_SECONDS,
  MAX_ALERT_POPUP_ACTIONS,
  MAX_ALERT_POPUPS,
  fitsAlertPopups,
  getAlertPopupAction,
  getAlertPopupSize,
  isAlertPopupActionDomain,
  layoutAlertPopups,
  normalizeAlertPopupConfig,
  sanitizeAlertPopupRequest,
  suggestAlertPopupActions,
  suggestAlertPopupCamera,
};
