/* global setTimeout, clearTimeout */

/**
 * Entity Actions: what an entity can do, and doing it. Every surface that acts on an entity (a
 * Quick Access tile, a desktop pin, the command palette, a hotkey, the Omarchy bar) asks here, so
 * which domains can be controlled, which service a domain takes in a given state, and what its
 * feature flags allow are known in one place and cannot drift apart between surfaces.
 *
 * - describeEntity(entity) says what is on offer: what a click does, the named commands, the
 *   hotkey actions, and the capabilities its feature flags give it. Pure, so main can use it too.
 * - createEntityActions(deps) returns the runner the renderer acts through. Its run(entity,
 *   action, value) makes the service call, shows an on/off change before Home Assistant confirms
 *   it, sends only the last value of a slider that is still moving, and reports failures.
 *
 * Dependency-free on purpose (climate-controls.cjs is too): main (CommonJS) and the Vite-built
 * renderer both load this file.
 */

const { getClimateControlCapabilities } = require('./climate-controls.cjs');

// Home Assistant's supported_features flags, for the domains whose controls depend on them.
// https://github.com/home-assistant/core/tree/dev/homeassistant/components (each domain's const.py)
const FEATURES = Object.freeze({
  light: { brightness: 1 }, // The legacy SUPPORT_BRIGHTNESS flag, still sent by older integrations.
  fan: { setSpeed: 1, presetMode: 8 },
  cover: { open: 1, close: 2, setPosition: 4, stop: 8 },
  valve: { open: 1, close: 2, stop: 8 },
  media_player: {
    pause: 1,
    seek: 2,
    volumeSet: 4,
    volumeMute: 8,
    previousTrack: 16,
    nextTrack: 32,
    play: 16384,
  },
  vacuum: { turnOn: 1, turnOff: 2, pause: 4, stop: 8, returnHome: 16, start: 8192 },
  todo: { create: 1, update: 4 },
  alarm_control_panel: {
    armHome: 1,
    armAway: 2,
    armNight: 4,
    armCustomBypass: 16,
    armVacation: 32,
  },
});

// Kinds of entity that switch on and off and report it as `on` and `off`. A click flips them, and
// the tile shows the new state before Home Assistant confirms it.
const ON_OFF_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean', 'humidifier', 'siren']);
// Kinds of entity that run once when clicked and have no lasting state worth showing.
const ACTIVATE_DOMAINS = new Set(['button', 'input_button', 'scene', 'script']);
// Kinds of entity a click toggles in a way other than on and off: open or close, lock or unlock,
// play or pause, start or pause, enable or disable.
const OTHER_TOGGLE_DOMAINS = new Set([
  'automation',
  'cover',
  'valve',
  'lock',
  'media_player',
  'timer',
]);
// Kinds of entity whose click opens one of the widget's dialogs.
const DIALOG_DOMAINS = new Set([
  'calendar',
  'camera',
  'climate',
  'sensor',
  'todo',
  'number',
  'input_number',
  'select',
  'input_select',
  'vacuum',
]);
// Kinds of entity with an adjust dialog of controls (brightness, speed, position, temperature,
// playback) beside their click.
const CONTROLS_DOMAINS = new Set(['climate', 'cover', 'fan', 'light', 'media_player']);
// An alarm panel is armed and disarmed by name, where a code can be asked for; a click points there.
const HINT_DOMAINS = new Set(['alarm_control_panel']);
const PRESS_DOMAINS = new Set(['button', 'input_button']);
const RUN_DOMAINS = new Set(['scene', 'script']);
const NUMERIC_DOMAINS = new Set(['number', 'input_number']);
const SELECT_DOMAINS = new Set(['select', 'input_select']);

// What a hotkey on each domain can run, the first being what a new hotkey runs. Every one of these
// is an action run() takes for that domain.
const HOTKEY_ACTIONS = Object.freeze({
  light: Object.freeze(['toggle', 'turn_on', 'turn_off', 'brightness_up', 'brightness_down']),
  switch: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  scene: Object.freeze(['turn_on']),
  script: Object.freeze(['turn_on']),
  automation: Object.freeze(['trigger', 'toggle', 'turn_on', 'turn_off']),
  button: Object.freeze(['press']),
  input_button: Object.freeze(['press']),
  input_boolean: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  fan: Object.freeze(['toggle', 'turn_on', 'turn_off', 'increase_speed', 'decrease_speed']),
  cover: Object.freeze(['toggle', 'open', 'close']),
  valve: Object.freeze(['toggle', 'open', 'close']),
  lock: Object.freeze(['lock', 'unlock']),
  humidifier: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  siren: Object.freeze(['toggle', 'turn_on', 'turn_off']),
});
const NO_ACTIONS = Object.freeze([]);

// The alarm modes, each with its feature flag and the state it arms to.
const ALARM_ARM_COMMANDS = [
  ['alarm_arm_home', FEATURES.alarm_control_panel.armHome, 'armed_home'],
  ['alarm_arm_away', FEATURES.alarm_control_panel.armAway, 'armed_away'],
  ['alarm_arm_night', FEATURES.alarm_control_panel.armNight, 'armed_night'],
  ['alarm_arm_custom_bypass', FEATURES.alarm_control_panel.armCustomBypass, 'armed_custom_bypass'],
  ['alarm_arm_vacation', FEATURES.alarm_control_panel.armVacation, 'armed_vacation'],
];

// How long a value that is still being dragged waits for the next one before it is sent, by action.
const DEBOUNCE_MS = Object.freeze({
  brightness: 110,
  color_temp: 150,
  percentage: 140,
  position: 180,
  temperature: 180,
  volume: 150,
  set_value: 120,
  previous_option: 100,
  next_option: 100,
});
// Stepping back and then forward through a select's options is one run of values.
const DEBOUNCE_GROUP = Object.freeze({ previous_option: 'option', next_option: 'option' });
// A switched device that Home Assistant has accepted the command for but never reported in the new
// state goes back to what Home Assistant last said after this long.
const ON_OFF_CONFIRMATION_TIMEOUT_MS = 8000;
const BRIGHTNESS_STEP = 51; // A fifth of Home Assistant's 0-255 brightness.
const SPEED_STEP = 33;

/** The domain of an entity or entity id ("light" for light.kitchen), or '' for anything else. */
function getEntityDomain(entityOrId) {
  const entityId = entityOrId && typeof entityOrId === 'object' ? entityOrId.entity_id : entityOrId;
  if (typeof entityId !== 'string') return '';
  const dot = entityId.indexOf('.');
  return dot > 0 ? entityId.slice(0, dot) : '';
}

/** Whether a supported_features value has every bit of `flag` set. */
function hasFeature(supportedFeatures, flag) {
  const features = Number(supportedFeatures);
  const feature = Number(flag);
  if (!Number.isFinite(features) || !Number.isFinite(feature) || feature <= 0) return false;
  return (features & feature) === feature;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function hasFiniteAttribute(attributes, name) {
  return !isBlank(attributes?.[name]) && Number.isFinite(Number(attributes[name]));
}

// Whether the entity says what it supports at all. One that does not is older than the flag, and
// is offered the control its attributes show it has.
function declaresFeatures(attributes) {
  return hasFiniteAttribute(attributes, 'supported_features');
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return !isBlank(value) && Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCapabilities(domain, entity) {
  const attributes = entity?.attributes || {};
  const features = attributes.supported_features;
  const has = (flag) => hasFeature(features, flag);
  switch (domain) {
    case 'light': {
      const colorModes = Array.isArray(attributes.supported_color_modes)
        ? attributes.supported_color_modes
        : [];
      return {
        canToggle: true,
        canSetBrightness:
          has(FEATURES.light.brightness) ||
          hasFiniteAttribute(attributes, 'brightness') ||
          colorModes.some((mode) => mode && mode !== 'onoff' && mode !== 'unknown'),
      };
    }
    case 'climate': {
      const climate = getClimateControlCapabilities(entity);
      return {
        canSetTemperature: climate.canSetTemperature,
        canSetRange: climate.canSetRange,
        hvacModes: Array.isArray(attributes.hvac_modes)
          ? attributes.hvac_modes.filter(Boolean)
          : [],
      };
    }
    case 'fan':
      return {
        canToggle: true,
        canSetPercentage:
          has(FEATURES.fan.setSpeed) ||
          (!declaresFeatures(attributes) && hasFiniteAttribute(attributes, 'percentage')),
        canSetPreset:
          has(FEATURES.fan.presetMode) &&
          Array.isArray(attributes.preset_modes) &&
          attributes.preset_modes.length > 0,
      };
    case 'cover':
      return {
        canOpen: has(FEATURES.cover.open),
        canClose: has(FEATURES.cover.close),
        canSetPosition:
          has(FEATURES.cover.setPosition) ||
          (!declaresFeatures(attributes) && hasFiniteAttribute(attributes, 'current_position')),
        canStop: has(FEATURES.cover.stop),
      };
    case 'valve': {
      // A valve that reports no features is tried anyway; one that cannot go a way is left alone.
      const valveHas = (flag) => !Number.isFinite(Number(features)) || has(flag);
      return {
        canOpen: valveHas(FEATURES.valve.open),
        canClose: valveHas(FEATURES.valve.close),
        canStop: has(FEATURES.valve.stop),
      };
    }
    case 'media_player':
      return {
        canPlay: has(FEATURES.media_player.play),
        canPause: has(FEATURES.media_player.pause),
        canPreviousTrack: has(FEATURES.media_player.previousTrack),
        canNextTrack: has(FEATURES.media_player.nextTrack),
        canSeek: has(FEATURES.media_player.seek),
        canSetVolume: has(FEATURES.media_player.volumeSet),
        canMute: has(FEATURES.media_player.volumeMute),
      };
    case 'vacuum': {
      // A pin window never asks Home Assistant for its service list, so these are what tell it
      // that Start, Pause or Return exist. A vacuum that publishes no flags takes the usual ones.
      const flags = Number(features);
      if (!Number.isFinite(flags) || flags <= 0) {
        return {
          canStart: true,
          canTurnOn: false,
          canPause: true,
          canReturnHome: true,
          canStop: false,
          canTurnOff: false,
        };
      }
      return {
        canStart: has(FEATURES.vacuum.start),
        // Vacuums written before START existed are switched on and off instead.
        canTurnOn: has(FEATURES.vacuum.turnOn),
        canPause: has(FEATURES.vacuum.pause),
        canReturnHome: has(FEATURES.vacuum.returnHome),
        canStop: has(FEATURES.vacuum.stop),
        canTurnOff: has(FEATURES.vacuum.turnOff),
      };
    }
    case 'todo':
      return { canAdd: has(FEATURES.todo.create), canUpdate: has(FEATURES.todo.update) };
    default:
      return {};
  }
}

function getClick(domain) {
  if (DIALOG_DOMAINS.has(domain)) return 'dialog';
  if (ACTIVATE_DOMAINS.has(domain)) return 'activate';
  if (ON_OFF_DOMAINS.has(domain) || OTHER_TOGGLE_DOMAINS.has(domain)) return 'toggle';
  if (HINT_DOMAINS.has(domain)) return 'hint';
  return 'none';
}

// The service that opens or closes a cover or a valve (by default the other way from where it is,
// as a click on its tile does), or null when it cannot go that way.
function getOpenCloseService(domain, entity, capabilities, close) {
  const closing = close ?? (entity?.state === 'open' || entity?.state === 'opening');
  if (closing ? !capabilities.canClose : !capabilities.canOpen) return null;
  return `${closing ? 'close' : 'open'}_${domain}`;
}

// The service a click calls on the entity as it is now, or null when it calls none.
function getToggleService(domain, entity, capabilities) {
  const state = entity?.state;
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
    case 'humidifier':
    case 'siren':
      return state === 'on' ? 'turn_off' : 'turn_on';
    case 'automation':
      return 'toggle';
    case 'cover':
    case 'valve':
      return getOpenCloseService(domain, entity, capabilities);
    case 'lock':
      return state === 'locked' ? 'unlock' : 'lock';
    case 'scene':
    case 'script':
      return 'turn_on';
    case 'button':
    case 'input_button':
      return 'press';
    case 'timer':
      return state === 'active' ? 'pause' : 'start';
    case 'media_player':
      if (state === 'playing') return capabilities.canPause ? 'media_pause' : null;
      return capabilities.canPlay ? 'media_play' : null;
    default:
      return null;
  }
}

// The named commands (Turn on, Run, Lock, Arm...) for the entity as it is now: only the ones that
// change it. Given only an id, every command the domain has.
function getCommands(domain, entity) {
  const known = !!entity;
  const state = entity?.state;
  if (known && (state === 'unavailable' || (state === 'unknown' && !RUN_DOMAINS.has(domain)))) {
    return [];
  }
  if (ON_OFF_DOMAINS.has(domain)) {
    return [
      (!known || state !== 'on') && 'turn_on',
      (!known || state !== 'off') && 'turn_off',
    ].filter(Boolean);
  }
  if (RUN_DOMAINS.has(domain)) return ['turn_on'];
  if (domain === 'lock') {
    return [
      (!known || state === 'unlocked') && 'lock',
      (!known || state === 'locked') && 'unlock',
    ].filter(Boolean);
  }
  if (domain === 'alarm_control_panel') {
    const features = entity?.attributes?.supported_features;
    return ALARM_ARM_COMMANDS.filter(
      ([, flag, armedState]) => !known || (hasFeature(features, flag) && state !== armedState)
    )
      .map(([service]) => service)
      .concat(!known || state !== 'disarmed' ? ['alarm_disarm'] : []);
  }
  return [];
}

/**
 * What an entity can do. Given only an entity id, describes its kind of entity.
 * @param {Object|string} entityOrId - A Home Assistant state object, or an entity id.
 * @param {{services?: Object}} [options] - Home Assistant's service list; when given, commands
 *   the server does not offer are left out.
 * @returns {{
 *   domain: string,
 *   available: boolean,
 *   click: 'toggle'|'activate'|'dialog'|'hint'|'none',
 *   service: string|null,
 *   confirm: boolean,
 *   controls: boolean,
 *   commands: string[],
 *   hotkeyActions: string[],
 *   capabilities: Object,
 * }}
 *   - available: whether it takes commands now. Only `unavailable` stops it: a button or scene
 *     never pressed reports `unknown` and still works.
 *   - click: what a click on its tile does. `toggle` and `activate` run run(entity, 'toggle'),
 *     `dialog` opens its dialog, `hint` points to the command palette, `none` does nothing.
 *   - service: the service that click calls now (turn_off for a light that is on), or null.
 *   - confirm: the click must be confirmed first (it would unlock a lock).
 *   - controls: it has an adjust dialog of controls beside its click.
 *   - commands: actions to offer by name now, each also an action run() takes.
 *   - hotkeyActions: the actions a hotkey on it can run, the first being the default.
 *   - capabilities: what its feature flags and attributes allow (canSetBrightness, canOpen, ...).
 */
function describeEntity(entityOrId, { services } = {}) {
  const entity = entityOrId && typeof entityOrId === 'object' ? entityOrId : null;
  const domain = getEntityDomain(entityOrId);
  const capabilities = getCapabilities(domain, entity);
  const commands = getCommands(domain, entity);
  return {
    domain,
    available: !!domain && !!entity && entity.state !== 'unavailable',
    click: getClick(domain),
    service: entity ? getToggleService(domain, entity, capabilities) : null,
    confirm: domain === 'lock' && entity?.state === 'locked',
    controls: CONTROLS_DOMAINS.has(domain),
    commands: services ? commands.filter((service) => !!services?.[domain]?.[service]) : commands,
    hotkeyActions: HOTKEY_ACTIONS[domain] || NO_ACTIONS,
    capabilities,
  };
}

function isOnOffState(value) {
  return value === 'on' || value === 'off';
}

const NOT_SENT = Object.freeze({ ok: false, sent: false });
const SUPERSEDED = Object.freeze({ ok: true, sent: false, superseded: true });

/**
 * The renderer's runner. One per window; it keeps the pending on/off changes and sliders.
 * @param {Object} deps
 * @param {(domain: string, service: string, data: Object) => Promise} deps.callService
 * @param {(entityId: string) => Object|undefined} deps.getEntity - The latest state Home Assistant
 *   sent for an entity.
 * @param {() => Object|null} [deps.getServices] - Home Assistant's service list, where known.
 * @param {(entity: Object) => void} [deps.onChange] - Draw this entity now: an on/off change shown
 *   before Home Assistant confirms it, or what it last reported once the change failed or lapsed.
 * @param {(error: Error, entity: Object) => void} [deps.onError] - Tell the user a command failed.
 * @param {(event: string, details: Object) => void} [deps.debug]
 * @returns {{run: Function, view: Function, observe: Function, reset: Function}}
 *   - run(entity, action, value?, {silent}?) acts and resolves to {ok, sent, result?, error?,
 *     superseded?}: `sent` is false when nothing was called (the entity is unavailable or cannot
 *     do that), `superseded` when a later value of the same slider replaced this one. Failures are
 *     reported through onError unless `silent`, and never reject.
 *   - view(entity) is the entity as it should be drawn: with the on/off state just asked for.
 *   - observe(entity) takes a state update from Home Assistant, settles the on/off change it
 *     confirms, and returns the entity to draw.
 *   - reset() drops everything pending, for a new Home Assistant connection.
 */
function createEntityActions({
  callService,
  getEntity,
  getServices = () => null,
  onChange = () => {},
  onError = () => {},
  debug = () => {},
}) {
  const desiredState = new Map();
  const optimisticState = new Map();
  const lastRequestedState = new Map();
  const inFlight = new Map();
  const confirmationTimers = new Map();
  const lastKnownBrightness = new Map();
  const debounced = new Map();
  let generation = 0;

  const live = (entity) => (entity?.entity_id && getEntity(entity.entity_id)) || entity;

  function rememberBrightness(entity) {
    if (getEntityDomain(entity) !== 'light') return;
    const brightness = Number(entity?.attributes?.brightness);
    if (Number.isFinite(brightness) && brightness > 0) {
      lastKnownBrightness.set(entity.entity_id, brightness);
    }
  }

  function view(entity) {
    if (!entity || typeof entity !== 'object' || !entity.entity_id) return entity;
    const domain = getEntityDomain(entity);
    if (domain === 'light') rememberBrightness(entity);
    if (!ON_OFF_DOMAINS.has(domain)) return entity;
    const optimistic = optimisticState.get(entity.entity_id);
    if (!isOnOffState(optimistic)) return entity;
    // A light turning back on shows the brightness it had, not 0%.
    const cachedBrightness = lastKnownBrightness.get(entity.entity_id);
    const needsBrightness =
      domain === 'light' &&
      optimistic === 'on' &&
      Number.isFinite(cachedBrightness) &&
      !(Number(entity.attributes?.brightness) > 0);
    if (entity.state === optimistic && !needsBrightness) return entity;
    return {
      ...entity,
      state: optimistic,
      ...(needsBrightness
        ? { attributes: { ...(entity.attributes || {}), brightness: cachedBrightness } }
        : {}),
    };
  }

  function clearConfirmationTimer(entityId) {
    clearTimeout(confirmationTimers.get(entityId));
    confirmationTimers.delete(entityId);
  }

  function clearPending(entityId) {
    clearConfirmationTimer(entityId);
    desiredState.delete(entityId);
    optimisticState.delete(entityId);
    lastRequestedState.delete(entityId);
  }

  function observe(entity) {
    if (!entity?.entity_id) return entity;
    const entityId = entity.entity_id;
    const domain = getEntityDomain(entity);
    if (!ON_OFF_DOMAINS.has(domain)) return entity;
    if (entity.state === 'unavailable') clearPending(entityId);
    const desired = desiredState.get(entityId);
    if (isOnOffState(desired)) {
      if (entity.state === desired) {
        clearPending(entityId);
        debug('entity.toggle_finalized', { entityId, domain, state: entity.state });
        return entity;
      }
      // An older update may still be on its way; keep showing what was asked for.
      optimisticState.set(entityId, desired);
      debug('entity.toggle_reconcile_pending', {
        entityId,
        domain,
        receivedState: entity.state,
        desiredState: desired,
      });
      return view(entity);
    }
    optimisticState.delete(entityId);
    return entity;
  }

  function report(error, entity, options) {
    if (!options?.silent) onError(error, entity);
  }

  // A successful response only says Home Assistant accepted the call. The requested state stays on
  // screen until the matching state_changed arrives, so an older update cannot briefly repaint it.
  function awaitConfirmation(entityId, domain, desired) {
    clearConfirmationTimer(entityId);
    const timer = setTimeout(() => {
      if (confirmationTimers.get(entityId) !== timer) return;
      confirmationTimers.delete(entityId);
      if (desiredState.get(entityId) !== desired) return;
      desiredState.delete(entityId);
      optimisticState.delete(entityId);
      lastRequestedState.delete(entityId);
      const serverEntity = getEntity(entityId);
      if (serverEntity) onChange(serverEntity);
      debug('entity.toggle_confirmation_timeout', {
        entityId,
        domain,
        desiredState: desired,
        receivedState: serverEntity?.state || null,
      });
    }, ON_OFF_CONFIRMATION_TIMEOUT_MS);
    timer?.unref?.();
    confirmationTimers.set(entityId, timer);
  }

  // Sends the latest on/off state asked for, one call at a time: taps made while a call is out are
  // folded into one follow-up, and none is sent when they end where the first call left it.
  async function sendOnOff(entityId, domain, holder, options) {
    const runGeneration = generation;
    let outcome = NOT_SENT;
    try {
      for (;;) {
        if (getEntity(entityId)?.state === 'unavailable') {
          clearPending(entityId);
          return outcome;
        }
        const desired = desiredState.get(entityId);
        if (!isOnOffState(desired)) return outcome;
        const service = desired === 'on' ? 'turn_on' : 'turn_off';
        lastRequestedState.set(entityId, desired);
        debug('entity.toggle_attempt', { entityId, domain, service, desiredState: desired });
        try {
          const result = await callService(domain, service, { entity_id: entityId });
          if (runGeneration !== generation) return { ok: true, sent: true, result };
          debug('entity.toggle_success', {
            entityId,
            domain,
            service,
            desiredState: desired,
            responseSuccess: result?.success !== false,
          });
          outcome = { ok: true, sent: true, result };
          if (desiredState.get(entityId) === desired) {
            if (getEntity(entityId)) awaitConfirmation(entityId, domain, desired);
            else clearPending(entityId);
          }
        } catch (error) {
          if (runGeneration !== generation) return { ok: false, sent: true, error };
          const latest = desiredState.get(entityId);
          debug('entity.toggle_primary_error', {
            entityId,
            domain,
            service,
            latestDesiredState: latest || null,
            error: error?.message || String(error),
          });
          outcome = { ok: false, sent: true, error };
          if (!latest || latest === desired) {
            clearPending(entityId);
            const serverEntity = getEntity(entityId);
            if (serverEntity) onChange(serverEntity);
            report(error, serverEntity || { entity_id: entityId }, options);
            return outcome;
          }
          // Another tap already asked for the other state; that call goes out next.
          debug('entity.toggle_error_ignored_stale_request', { entityId, domain });
        }
        const latest = desiredState.get(entityId);
        if (!latest) {
          lastRequestedState.delete(entityId);
          return outcome;
        }
        if (latest === lastRequestedState.get(entityId)) return outcome;
      }
    } finally {
      if (runGeneration === generation && inFlight.get(entityId) === holder) {
        inFlight.delete(entityId);
      }
    }
  }

  function switchOnOff(entity, domain, desired, options) {
    const entityId = entity.entity_id;
    // A switch press wins over a brightness the slider has not sent yet.
    if (domain === 'light') cancelDebounced(`${entityId}:brightness`);
    const current = optimisticState.get(entityId) ?? entity.state;
    const next = desired || (current === 'on' ? 'off' : 'on');
    clearConfirmationTimer(entityId);
    rememberBrightness(entity);
    desiredState.set(entityId, next);
    optimisticState.set(entityId, next);
    onChange({ ...entity, state: next });
    debug('entity.toggle_queued', {
      entityId,
      domain,
      previousState: isOnOffState(current) ? current : 'off',
      desiredState: next,
      inFlight: inFlight.has(entityId),
    });
    const running = inFlight.get(entityId);
    if (running) return running.promise;
    const holder = {};
    inFlight.set(entityId, holder);
    holder.promise = sendOnOff(entityId, domain, holder, options);
    return holder.promise;
  }

  async function send(entity, domain, service, data, options) {
    const entityId = entity.entity_id;
    debug('entity.action', { entityId, domain, service });
    try {
      const result = await callService(domain, service, { entity_id: entityId, ...data });
      return { ok: true, sent: true, result };
    } catch (error) {
      report(error, live(entity), options);
      return { ok: false, sent: true, error };
    }
  }

  function cancelDebounced(key) {
    const pending = debounced.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    debounced.delete(key);
    pending.resolve(SUPERSEDED);
  }

  // Sends the last of a run of values; each one it replaces resolves as superseded.
  function sendLater(entity, action, plan, options) {
    const key = `${entity.entity_id}:${DEBOUNCE_GROUP[action] || action}`;
    cancelDebounced(key);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        debounced.delete(key);
        const current = live(entity);
        if (current?.state === 'unavailable') {
          resolve(NOT_SENT);
          return;
        }
        // Planned when it is sent, so it reads the state and services of that moment.
        const call = plan(current);
        if (!call) {
          resolve(NOT_SENT);
          return;
        }
        resolve(send(current, call.domain, call.service, call.data, options));
      }, DEBOUNCE_MS[action]);
      debounced.set(key, { timer, resolve });
    });
  }

  function hasService(domain, service) {
    return !!getServices()?.[domain]?.[service];
  }

  // The call an action makes on an entity, or null when it makes none. `domain` is the entity's.
  function planCall(entity, domain, action, value, capabilities) {
    const call = (service, data = {}) => ({ domain, service, data });
    const attributes = entity.attributes || {};
    switch (action) {
      case 'toggle': {
        const service = getToggleService(domain, entity, capabilities);
        return service ? call(service) : null;
      }
      case 'turn_on':
      case 'turn_off':
        return call(action);
      case 'lock':
      case 'unlock':
        return domain === 'lock' ? call(action) : null;
      case 'open':
      case 'close': {
        if (domain !== 'cover' && domain !== 'valve') return null;
        const service = getOpenCloseService(domain, entity, capabilities, action === 'close');
        return service ? call(service) : null;
      }
      case 'stop':
        if (domain === 'cover' || domain === 'valve') {
          return capabilities.canStop ? call(`stop_${domain}`) : null;
        }
        return domain === 'vacuum' ? call('stop') : null;
      case 'press':
      case 'trigger':
        if (PRESS_DOMAINS.has(domain)) return call('press');
        return domain === 'automation' ? call('trigger') : null;
      case 'brightness_up':
      case 'brightness_down': {
        if (domain !== 'light') return null;
        const brightness = finiteNumber(attributes.brightness, 0);
        const current = brightness >= 0 ? brightness : 0;
        const step = action === 'brightness_up' ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
        return call('turn_on', { brightness: clamp(current + step, 0, 255) });
      }
      case 'increase_speed':
      case 'decrease_speed': {
        if (domain !== 'fan') return null;
        const percentage = finiteNumber(attributes.percentage, 0);
        const current = percentage >= 0 ? percentage : 0;
        const step = action === 'increase_speed' ? SPEED_STEP : -SPEED_STEP;
        return call('set_percentage', { percentage: clamp(current + step, 0, 100) });
      }
      case 'brightness': {
        if (domain !== 'light') return null;
        const percent = clamp(Math.round(Number(value) || 0), 0, 100);
        return percent <= 0 ? call('turn_off') : call('turn_on', { brightness_pct: percent });
      }
      case 'color_temp':
        return domain === 'light' && Number.isFinite(Number(value))
          ? call('turn_on', { color_temp_kelvin: Math.round(Number(value)) })
          : null;
      case 'color':
        return domain === 'light' && Array.isArray(value) && value.length === 3
          ? call('turn_on', { rgb_color: value.map((part) => clamp(Math.round(part), 0, 255)) })
          : null;
      case 'percentage': {
        if (domain !== 'fan' || !capabilities.canSetPercentage) return null;
        const percent = clamp(Math.round(Number(value) || 0), 0, 100);
        return percent <= 0 ? call('turn_off') : call('set_percentage', { percentage: percent });
      }
      case 'position':
        return domain === 'cover' && capabilities.canSetPosition
          ? call('set_cover_position', { position: clamp(Math.round(Number(value) || 0), 0, 100) })
          : null;
      case 'temperature':
        return domain === 'climate' && Number.isFinite(Number(value))
          ? call('set_temperature', { temperature: Number(value) })
          : null;
      case 'hvac_mode':
        return domain === 'climate' && typeof value === 'string' && value
          ? call('set_hvac_mode', { hvac_mode: value })
          : null;
      case 'play':
        return domain === 'media_player' && capabilities.canPlay ? call('media_play') : null;
      case 'pause':
        if (domain === 'media_player') return capabilities.canPause ? call('media_pause') : null;
        return domain === 'vacuum' || domain === 'timer' ? call('pause') : null;
      case 'next_track':
        return domain === 'media_player' && capabilities.canNextTrack
          ? call('media_next_track')
          : null;
      case 'previous_track':
        return domain === 'media_player' && capabilities.canPreviousTrack
          ? call('media_previous_track')
          : null;
      case 'seek':
        return domain === 'media_player' && capabilities.canSeek && Number.isFinite(Number(value))
          ? call('media_seek', { seek_position: Number(value) })
          : null;
      case 'volume':
        return domain === 'media_player' &&
          capabilities.canSetVolume &&
          Number.isFinite(Number(value))
          ? call('volume_set', { volume_level: clamp(Number(value), 0, 1) })
          : null;
      case 'mute':
        return domain === 'media_player' && capabilities.canMute
          ? call('volume_mute', { is_volume_muted: !!value })
          : null;
      case 'set_value': {
        const number = Number(value);
        if (!NUMERIC_DOMAINS.has(domain) || isBlank(value) || !Number.isFinite(number)) return null;
        const min = finiteNumber(attributes.min);
        const max = finiteNumber(attributes.max);
        const bounded = min !== null && max !== null && max > min;
        return call('set_value', { value: bounded ? clamp(number, min, max) : number });
      }
      case 'previous_option':
      case 'next_option': {
        if (!SELECT_DOMAINS.has(domain)) return null;
        // Stepping is the server's own when it has it; otherwise the option the caller worked out.
        const step = action === 'previous_option' ? 'select_previous' : 'select_next';
        if (hasService(domain, step)) return call(step);
        return typeof value === 'string' && value ? call('select_option', { option: value }) : null;
      }
      case 'start':
      case 'return_to_base':
        return domain === 'vacuum' || (domain === 'timer' && action === 'start')
          ? call(action)
          : null;
      case 'alarm_disarm':
      case 'alarm_arm_home':
      case 'alarm_arm_away':
      case 'alarm_arm_night':
      case 'alarm_arm_custom_bypass':
      case 'alarm_arm_vacation':
        return domain === 'alarm_control_panel'
          ? call(action, typeof value === 'string' && value ? { code: value } : {})
          : null;
      default:
        return null;
    }
  }

  /**
   * Act on an entity. The actions, by the kinds of entity that take them:
   * - toggle: what a click on its tile runs (see describeEntity's click and service).
   * - turn_on, turn_off: any; lock, unlock: a lock; open, close, stop: a cover or valve.
   * - press, trigger: a button presses, an automation triggers.
   * - brightness_up, brightness_down (by a fifth), brightness (value: percent), color_temp
   *   (value: kelvin), color (value: [r, g, b]): a light.
   * - increase_speed, decrease_speed (by a third), percentage (value: percent): a fan.
   * - position (value: percent): a cover. temperature (value), hvac_mode (value): a thermostat.
   * - play, pause, next_track, previous_track, seek (value: seconds), volume (value: 0-1),
   *   mute (value: boolean): a media player.
   * - set_value (value): a number. previous_option, next_option (value: the option to choose
   *   when the server cannot step itself): a select.
   * - start, pause, stop, return_to_base, turn_on, turn_off: a vacuum. start, pause: a timer.
   * - alarm_disarm, alarm_arm_* (value: the code, if one was asked for): an alarm panel.
   * Slider values (brightness, color_temp, percentage, position, temperature, volume, set_value
   * and the option steps) wait a moment for the next value and only the last is sent.
   */
  function run(entity, action, value, options = {}) {
    const current = live(entity);
    if (!current?.entity_id || current.state === 'unavailable') return Promise.resolve(NOT_SENT);
    const domain = getEntityDomain(current);
    if (
      ON_OFF_DOMAINS.has(domain) &&
      (action === 'toggle' || action === 'turn_on' || action === 'turn_off')
    ) {
      const desired = action === 'turn_on' ? 'on' : action === 'turn_off' ? 'off' : null;
      return switchOnOff(current, domain, desired, options);
    }
    const plan = (latest) =>
      planCall(latest, domain, action, value, getCapabilities(domain, latest));
    if (DEBOUNCE_MS[action]) {
      if (!plan(current)) return Promise.resolve(NOT_SENT);
      return sendLater(current, action, plan, options);
    }
    const call = plan(current);
    if (!call) {
      debug('entity.action_ignored', { entityId: current.entity_id, domain, action });
      return Promise.resolve(NOT_SENT);
    }
    // A cover told to open, close or stop drops a position the slider has not sent yet.
    if (domain === 'cover') cancelDebounced(`${current.entity_id}:position`);
    return send(current, call.domain, call.service, call.data, options);
  }

  function reset() {
    generation += 1;
    confirmationTimers.forEach((timer) => clearTimeout(timer));
    confirmationTimers.clear();
    [...debounced.keys()].forEach(cancelDebounced);
    desiredState.clear();
    optimisticState.clear();
    lastRequestedState.clear();
    inFlight.clear();
    lastKnownBrightness.clear();
  }

  return { run, view, observe, reset };
}

module.exports = { describeEntity, createEntityActions, getEntityDomain, hasFeature };
