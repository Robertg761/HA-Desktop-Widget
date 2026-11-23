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
  cover: Object.freeze(['open_cover', 'close_cover']),
  button: Object.freeze(['press']),
  input_button: Object.freeze(['press']),
  scene: Object.freeze(['turn_on']),
  script: Object.freeze(['turn_on']),
  media_player: Object.freeze(['media_play', 'media_pause']),
});

const ON_OFF_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'siren']);
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

/**
 * The button an entity gets on a card, from its state when the card opens: a locked lock offers
 * Unlock, a light that is on offers Turn off. `label` is the English text and `context` the
 * translation context, which the renderer translates. Null when the entity offers nothing now: it
 * is offline, or it is a lock that wants a code, which a card has nowhere to type.
 */
function getAlertPopupAction(entity) {
  const entityId = entity?.entity_id;
  if (!isEntityId(entityId)) return null;
  const domain = getDomain(entityId);
  const state = typeof entity.state === 'string' ? entity.state : '';
  const attributes = isPlainObject(entity.attributes) ? entity.attributes : {};
  if (NO_READING_STATES.has(state)) return null;
  const action = (service, label, context = '') => ({
    entityId,
    domain,
    service,
    label,
    ...(context ? { context } : {}),
  });

  if (domain === 'lock') {
    if (attributes.code_format) return null;
    return state === 'locked' || state === 'locking'
      ? action('unlock', 'Unlock')
      : action('lock', 'Lock');
  }
  if (ON_OFF_DOMAINS.has(domain)) {
    return state === 'on' ? action('turn_off', 'Turn off') : action('turn_on', 'Turn on');
  }
  if (domain === 'cover') {
    return state === 'open' || state === 'opening'
      ? action('close_cover', 'Close')
      : action('open_cover', 'Open', 'Action: Open');
  }
  if (domain === 'button' || domain === 'input_button') return action('press', 'Press');
  if (domain === 'scene') return action('turn_on', 'Activate');
  if (domain === 'script') return action('turn_on', 'Run');
  if (domain === 'media_player') {
    if (state === 'playing') return action('media_pause', 'Pause');
    if (state === 'paused') return action('media_play', 'Play');
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

// Words that say what kind of thing an entity is rather than where it is: binary_sensor.front_door_ding
// and camera.front_door_camera are both about the front door.
const CAMERA_MATCH_NOISE = new Set([
  'binary',
  'button',
  'cam',
  'camera',
  'ding',
  'doorbell',
  'event',
  'motion',
  'occupancy',
  'person',
  'press',
  'pressed',
  'ring',
  'sensor',
  'snapshot',
  'visitor',
]);

function placeWords(entityId) {
  const objectId = String(entityId || '').split('.')[1] || '';
  return objectId.split('_').filter((word) => word && !CAMERA_MATCH_NOISE.has(word));
}

/**
 * The camera a new pop-up should start with: the entity itself when it is a camera, otherwise the
 * camera whose name says it is at the same place (camera.front_door for
 * binary_sensor.front_door_ding). Empty when no camera clearly is, since a wrong camera on a
 * doorbell card is worse than none. The user can always pick another.
 */
function suggestAlertPopupCamera(entityId, states = {}) {
  if (!isEntityId(entityId)) return '';
  if (getDomain(entityId) === 'camera') return entityId;
  const words = placeWords(entityId);
  if (!words.length) return '';
  let best = '';
  let bestLength = 0;
  let tied = false;
  Object.keys(isPlainObject(states) ? states : {}).forEach((candidate) => {
    if (getDomain(candidate) !== 'camera' || !isEntityId(candidate)) return;
    const cameraWords = placeWords(candidate);
    if (!cameraWords.length || cameraWords.length > words.length) return;
    if (!cameraWords.every((word, index) => words[index] === word)) return;
    if (cameraWords.length > bestLength) {
      best = candidate;
      bestLength = cameraWords.length;
      tied = false;
    } else if (cameraWords.length === bestLength) {
      tied = true;
    }
  });
  return tied ? '' : best;
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
  getAlertPopupAction,
  getAlertPopupSize,
  isAlertPopupActionDomain,
  layoutAlertPopups,
  normalizeAlertPopupConfig,
  sanitizeAlertPopupRequest,
  suggestAlertPopupCamera,
};
