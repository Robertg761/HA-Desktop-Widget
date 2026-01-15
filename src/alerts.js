import state from './state.js';
import { showToast } from './ui-utils.js';
import { getEntityDisplayName, getEntityIcon } from './utils.js';

let entityAlerts = {};
let alertStates = {};

function initializeEntityAlerts() {
  if (state.CONFIG && state.CONFIG.entityAlerts) {
    entityAlerts = state.CONFIG.entityAlerts;
  }
  if (!entityAlerts.enabled) return;

  Object.keys(entityAlerts.alerts).forEach(entityId => {
    if (state.STATES[entityId]) {
      alertStates[entityId] = state.STATES[entityId].state;
    }
  });
}

function checkEntityAlerts(entityId, newState) {
  try {
    if (!entityAlerts.enabled || !entityAlerts.alerts[entityId]) return;

    const alertConfig = entityAlerts.alerts[entityId];
    const previousState = alertStates[entityId];

    alertStates[entityId] = newState;

    let shouldAlert = false;
    let alertMessage = '';

    if (alertConfig.onStateChange && previousState !== newState) {
      shouldAlert = true;
      alertMessage = `${getEntityDisplayName(state.STATES[entityId])} changed from ${previousState} to ${newState}`;
    } else if (alertConfig.onSpecificState && alertConfig.targetState === newState) {
      shouldAlert = true;
      alertMessage = `${getEntityDisplayName(state.STATES[entityId])} is now ${newState}`;
    }

    if (shouldAlert) {
      showEntityAlert(alertMessage, entityId);
    }
  } catch (error) {
    console.error('Error checking entity alerts:', error);
  }
}

function showEntityAlert(message, entityId) {
  try {
    if (Notification.permission === 'granted') {
      const entity = state.STATES[entityId];
      const icon = entity ? getEntityIcon(entity) : '❓';
      new Notification('Home Assistant Alert', {
        body: message,
        icon: icon,
        tag: `ha-alert-${entityId}`,
        requireInteraction: false
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
      entityAlerts.enabled = enabled;
      showToast(`Entity alerts ${enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      return true;
    }
  } catch (error) {
    console.error('Error toggling alerts:', error);
    showToast('Error toggling alerts', 'error', 2000);
  }
  return false;
}

function requestNotificationPermission() {
  try {
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showToast('Notifications enabled', 'success', 2000);
        } else {
          showToast('Notifications disabled', 'warning', 2000);
        }
      });
    }
  } catch (error) {
    console.error('Error requesting notification permission:', error);
  }
}

export {
  initializeEntityAlerts,
  checkEntityAlerts,
  toggleAlerts,
  requestNotificationPermission,
};
