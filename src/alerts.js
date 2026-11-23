import state from './state.js';
import { createAlertEvaluator } from './alert-rules.js';
import { showToast } from './ui-utils.js';
import {
  getEntityDisplayName,
  getEntityDisplayState,
  getEntityIcon,
  isTimerLikeSensor,
} from './utils.js';
import { formatStateName } from './format.js';
import { t } from './i18n.js';
import { getConnectionIdentity } from './connection.js';
import alertPopup from './alert-popup.cjs';

const { getAlertPopupAction, normalizeAlertPopupConfig } = alertPopup;

// The attributes that decide how a state reads (its unit, precision and kind). The rest, such as a
// light's brightness, describe the entity now rather than the state the alert is about.
const ALERT_STATE_ATTRIBUTES = [
  'device_class',
  'has_time',
  'state_class',
  'step',
  'suggested_display_precision',
  'temperature_unit',
  'unit_of_measurement',
];

// A raw Home Assistant state as the tiles and the palette show it: translated names ("Open",
// "Away"), numbers in the user's format at the sensor's precision, with their unit.
function formatAlertState(entityId, value) {
  const entity = state.STATES?.[entityId];
  // A timer's state is its run state; the countdown belongs to the entity as it is now.
  if (!entity || entityId.startsWith('timer.') || isTimerLikeSensor(entity)) {
    return formatStateName(value);
  }
  const attributes = {};
  ALERT_STATE_ATTRIBUTES.forEach((name) => {
    if (entity.attributes?.[name] !== undefined) attributes[name] = entity.attributes[name];
  });
  return getEntityDisplayState({ ...entity, state: value, attributes });
}

const evaluator = createAlertEvaluator({
  getConfig: () => state.CONFIG?.entityAlerts,
  notify: (entityId, previousState, newState, rule) => {
    const name = getEntityDisplayName(state.STATES[entityId]);
    const states = {
      previousState: formatAlertState(entityId, previousState),
      newState: formatAlertState(entityId, newState),
    };
    const message = rule.onStateChange
      ? t('{{name}} changed from {{previousState}} to {{newState}}', { name, ...states })
      : t('{{name}} is now {{newState}}', { name, newState: states.newState });
    const popup = normalizeAlertPopupConfig(rule.popup);
    if (popup?.enabled) {
      // The card names the entity in its title, so its text says only what happened.
      const detail = rule.onStateChange
        ? t('Changed from {{previousState}} to {{newState}}', states)
        : t('Now {{newState}}', { newState: states.newState });
      showEntityAlertPopup({ entityId, name, message, detail, popup });
      return;
    }
    showEntityAlert(message, entityId);
  },
});

// Some short words need a different translation per context ("Open" the action is not the state).
function translateInContext(key, fallback) {
  const label = t(key);
  return label === key ? fallback : label;
}

/**
 * The buttons a card offers, from the entities the rule chose as they are now: a lock that is
 * already unlocked offers Lock. An entity that is gone or offline offers nothing and is left out.
 */
function getAlertPopupButtons(popup) {
  return popup.actions
    .map((actionEntityId) => {
      const entity = state.STATES?.[actionEntityId];
      const action = getAlertPopupAction(entity);
      if (!action) return null;
      return {
        ...action,
        label: action.context
          ? translateInContext(action.context, t(action.label))
          : t(action.label),
        name: getEntityDisplayName(entity),
      };
    })
    .filter(Boolean);
}

// The rule's camera while Home Assistant has it. A camera that was removed or is offline would only
// show "Preview unavailable", so the card goes without one and stays short.
function getAlertPopupCamera(popup) {
  const camera = popup.camera && state.STATES?.[popup.camera];
  if (!camera || camera.state === 'unavailable') return '';
  return popup.camera;
}

/**
 * Opens the rule's pop-up card. A card that cannot open (an older main process, or the window
 * failed) is replaced by the system notification, so the alert is never lost. The toast in the
 * widget is shown either way, as for every alert.
 */
function showEntityAlertPopup({ entityId, name, message, detail, popup }) {
  const fallBack = () => showDesktopAlert(message, entityId);
  try {
    showToast(message, 'info', 4000);
    if (typeof window.electronAPI?.showAlertPopup !== 'function') {
      fallBack();
      return;
    }
    const entity = state.STATES?.[entityId];
    Promise.resolve(
      window.electronAPI.showAlertPopup({
        entityId,
        title: name,
        message: detail,
        icon: entity
          ? {
              state: entity.state,
              attributes: {
                icon: entity.attributes?.icon,
                device_class: entity.attributes?.device_class,
              },
            }
          : null,
        camera: getAlertPopupCamera(popup),
        actions: getAlertPopupButtons(popup),
        seconds: popup.seconds,
        at: Date.now(),
      })
    )
      .then((result) => {
        if (result?.success === false) {
          console.error('Alert pop-up was not shown:', result.error);
          fallBack();
        }
      })
      .catch((error) => {
        console.error('Error showing alert pop-up:', error);
        fallBack();
      });
  } catch (error) {
    console.error('Error showing alert pop-up:', error);
    fallBack();
  }
}

let alertConnection = null;
function initializeEntityAlerts() {
  // Keyed on the connection identity rather than the raw token: a routine OAuth token refresh
  // must not cancel pending duration alerts or forget cooldowns.
  const connection = getConnectionIdentity(state.CONFIG);
  if (connection !== alertConnection) {
    evaluator.reset(state.STATES || {});
    alertConnection = connection;
  } else {
    evaluator.reconcile(state.STATES || {});
  }
}

function suspendEntityAlerts() {
  evaluator.suspend();
}

function resetEntityAlerts() {
  alertConnection = null;
  evaluator.reset();
}

function checkEntityAlerts(entityId, newState) {
  try {
    evaluator.check(entityId, newState);
  } catch (error) {
    console.error('Error checking entity alerts:', error);
  }
}

const NOTIFICATION_ICON_SIZE = 64;
// The same stack as the entity icons in the window: MDI glyphs first, then the platform's emoji.
const NOTIFICATION_ICON_FONT =
  '"Material Design Icons", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
// Home Assistant's own icons are MDI code points, which sit in Unicode's private-use areas: no
// font but MDI draws them, so they need that font loaded.
const PRIVATE_USE_GLYPH = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const NOTIFICATION_MDI_FONT = '16px "Material Design Icons"';

/**
 * Whether `glyph` can be drawn right now. MDI is a web font, and a page loads one only when some
 * text uses it; a canvas never starts that. Drawn before the window has shown an MDI icon, a code
 * point comes out in a fallback font, and a fallback's empty box has pixels like any glyph, so the
 * check for "something was drawn" cannot catch it. Emoji need no web font.
 */
function iconFontReady(glyph) {
  if (!PRIVATE_USE_GLYPH.test(glyph)) return true;
  try {
    return document.fonts?.check?.(NOTIFICATION_MDI_FONT, glyph) === true;
  } catch {
    return false;
  }
}

/**
 * A promise for the icon font when `glyph` needs it and it is not loaded yet, otherwise null. The
 * font file is local, so this settles at once; a failed load leaves the app icon on the notification.
 */
function loadIconFont(glyph) {
  if (!glyph || iconFontReady(glyph)) return null;
  try {
    return document.fonts?.load?.(NOTIFICATION_MDI_FONT, glyph) || null;
  } catch {
    return null;
  }
}

/**
 * A desktop notification's icon is a URL, never a character, so an entity's glyph (an emoji, or a
 * Material Design Icons code point) is drawn to a small image: white on a dark disc, which reads on
 * a light or a dark notification. Returns undefined when nothing could be drawn (no canvas, or a
 * font that has not loaded), and the notification then carries the app's own icon.
 */
function renderNotificationIcon(glyph) {
  try {
    if (!glyph || typeof document === 'undefined' || !iconFontReady(glyph)) return undefined;
    const size = NOTIFICATION_ICON_SIZE;
    const glyphCanvas = document.createElement('canvas');
    glyphCanvas.width = size;
    glyphCanvas.height = size;
    const glyphContext = glyphCanvas.getContext('2d');
    if (!glyphContext) return undefined;
    glyphContext.font = `${Math.round(size * 0.56)}px ${NOTIFICATION_ICON_FONT}`;
    glyphContext.fillStyle = '#ffffff';
    glyphContext.textAlign = 'center';
    glyphContext.textBaseline = 'middle';
    glyphContext.fillText(glyph, size / 2, size / 2 + size * 0.03);
    const pixels = glyphContext.getImageData(0, 0, size, size).data;
    let drawn = false;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0) {
        drawn = true;
        break;
      }
    }
    if (!drawn) return undefined;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    context.fillStyle = '#2b3445';
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    context.fill();
    context.drawImage(glyphCanvas, 0, 0);
    const url = canvas.toDataURL('image/png');
    return typeof url === 'string' && url.startsWith('data:image/png') ? url : undefined;
  } catch {
    return undefined;
  }
}

function showDesktopNotification(message, entityId, glyph) {
  try {
    const icon = renderNotificationIcon(glyph);
    const notification = new Notification(t('Home Assistant alert'), {
      body: message,
      ...(icon ? { icon } : {}),
      tag: `ha-alert-${entityId}`,
      requireInteraction: false,
    });
    notification.onclick = () => {
      window.electronAPI?.showWindow?.().catch((error) => {
        console.error('Error showing widget from alert:', error);
      });
    };
  } catch (error) {
    console.error('Error showing entity alert:', error);
  }
}

// The system notification for an alert, when notifications are allowed.
function showDesktopAlert(message, entityId) {
  try {
    if (Notification.permission !== 'granted') return;
    // An entity that is gone has no glyph to draw; its notification keeps the app icon.
    const entity = state.STATES[entityId];
    const glyph = entity ? getEntityIcon(entity) : '';
    const show = () => showDesktopNotification(message, entityId, glyph);
    // Only the notification waits for the icon font, and only the first time; the toast does not.
    const fontLoad = loadIconFont(glyph);
    if (fontLoad) fontLoad.then(show, show);
    else show();
  } catch (error) {
    console.error('Error showing entity alert:', error);
  }
}

function showEntityAlert(message, entityId) {
  try {
    showDesktopAlert(message, entityId);
    showToast(message, 'info', 4000);
  } catch (error) {
    console.error('Error showing entity alert:', error);
  }
}

async function toggleAlerts(enabled) {
  try {
    const result = await window.electronAPI.toggleAlerts(enabled);
    if (result.success) {
      if (state.CONFIG?.entityAlerts) state.CONFIG.entityAlerts.enabled = enabled;
      if (!enabled) suspendEntityAlerts();
      showToast(
        enabled ? t('Entity alerts enabled') : t('Entity alerts disabled'),
        'success',
        2000
      );
      return true;
    }
    showToast(result?.error || t('Error toggling alerts'), 'error', 3000);
  } catch (error) {
    console.error('Error toggling alerts:', error);
    showToast(t('Error toggling alerts'), 'error', 2000);
  }
  return false;
}

function requestNotificationPermission() {
  try {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          showToast(t('Notifications enabled'), 'success', 2000);
        } else {
          showToast(t('Notifications disabled'), 'warning', 2000);
        }
      });
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
  }
}

export {
  suspendEntityAlerts,
  resetEntityAlerts,
  initializeEntityAlerts,
  checkEntityAlerts,
  toggleAlerts,
  requestNotificationPermission,
};
