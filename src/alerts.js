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

function showEntityAlert(message, entityId) {
  try {
    if (Notification.permission === 'granted') {
      const entity = state.STATES[entityId];
      const icon = entity ? getEntityIcon(entity) : '❓';
      const notification = new Notification(t('Home Assistant Alert'), {
        body: message,
        icon: icon,
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
