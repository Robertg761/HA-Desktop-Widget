import state from './state.js';
import { createAlertEvaluator } from './alert-rules.js';
import { showToast } from './ui-utils.js';
import { getEntityDisplayName, getEntityIcon, getStateDisplayLabel } from './utils.js';
import { t } from './i18n.js';

const evaluator = createAlertEvaluator({
  getConfig: () => state.CONFIG?.entityAlerts,
  notify: (entityId, previousRawState, newRawState, rule) => {
    const name = getEntityDisplayName(state.STATES[entityId]);
    const previousState = getStateDisplayLabel(previousRawState);
    const newState = getStateDisplayLabel(newRawState);
    const message = rule.onStateChange
      ? t('{{name}} changed from {{previousState}} to {{newState}}', {
          name,
          previousState,
          newState,
        })
      : t('{{name}} is now {{newState}}', { name, newState });
    showEntityAlert(message, entityId);
  },
});

let alertConnection = null;
function initializeEntityAlerts() {
  const connection = JSON.stringify([
    state.CONFIG?.homeAssistant?.url,
    state.CONFIG?.homeAssistant?.token,
  ]);
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
      new Notification(t('Home Assistant Alert'), {
        body: message,
        icon: icon,
        tag: `ha-alert-${entityId}`,
        requireInteraction: false,
      });
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
