import state from './state.js';
import { createAlertEvaluator } from './alert-rules.js';
import { showToast } from './ui-utils.js';
import { getEntityDisplayName, getEntityIcon } from './utils.js';
import { formatNumericState, t } from './i18n.js';
import { getConnectionIdentity } from './connection.js';
import trayEntitySupport from './tray-entities.cjs';

// Raw Home Assistant states ("on", "not_home") shown with the same translated names as the
// tiles and tray; numeric states keep their decimals in the active locale's format.
function formatAlertState(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) return t('Unknown');
  const name = trayEntitySupport.STATE_NAMES[key];
  return name ? t(name) : formatNumericState(key);
}

const evaluator = createAlertEvaluator({
  getConfig: () => state.CONFIG?.entityAlerts,
  notify: (entityId, previousState, newState, rule) => {
    const name = getEntityDisplayName(state.STATES[entityId]);
    const message = rule.onStateChange
      ? t('{{name}} changed from {{previousState}} to {{newState}}', {
          name,
          previousState: formatAlertState(previousState),
          newState: formatAlertState(newState),
        })
      : t('{{name}} is now {{newState}}', { name, newState: formatAlertState(newState) });
    showEntityAlert(message, entityId);
  },
});

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

/**
 * A desktop notification's icon is a URL, never a character, so an entity's glyph (an emoji, or a
 * Material Design Icons code point) is drawn to a small image: white on a dark disc, which reads on
 * a light or a dark notification. Returns undefined when nothing could be drawn (no canvas, or a
 * font that has not loaded), and the notification then carries the app's own icon.
 */
function renderNotificationIcon(glyph) {
  try {
    if (!glyph || typeof document === 'undefined') return undefined;
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

function showEntityAlert(message, entityId) {
  try {
    if (Notification.permission === 'granted') {
      const entity = state.STATES[entityId];
      // An entity that is gone has no glyph to draw; its notification keeps the app icon.
      const icon = entity ? renderNotificationIcon(getEntityIcon(entity)) : undefined;
      const notification = new Notification(t('Home Assistant Alert'), {
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
    }

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
