import websocket from './websocket.js';
import state from './state.js';
import { t } from './i18n.js';
import {
  notificationMarkdownToPlainText,
  renderNotificationMarkdown,
} from './notification-markdown.js';
import { closeDialog, openDialog, renderKeepingFocus, showToast } from './ui-utils.js';

const DEFAULT_NOTIFICATION_TITLE = 'Home Assistant';
const MAX_BELL_COUNT = 99;
// How long an open panel goes before it says "5m ago" where it said "4m ago".
const RELATIVE_TIME_REFRESH_MS = 60000;

let activeNotifications = new Map();
let unsubscribePersistentNotifications = null;
let notificationUiInitialized = false;
let relativeTimeTimer = null;

function toSafeString(value) {
  return typeof value === 'string' ? value : '';
}

function normalizePersistentNotification(notification, fallbackId = '') {
  const notificationId = toSafeString(notification?.notification_id) || String(fallbackId || '');
  if (!notificationId) return null;

  return {
    notification_id: notificationId,
    title: toSafeString(notification?.title),
    message: toSafeString(notification?.message),
    created_at: toSafeString(notification?.created_at),
  };
}

function normalizeNotificationCollection(notifications = {}) {
  const normalized = [];
  Object.entries(notifications || {}).forEach(([notificationId, notification]) => {
    const nextNotification = normalizePersistentNotification(notification, notificationId);
    if (nextNotification) normalized.push(nextNotification);
  });
  return normalized;
}

function applyPersistentNotificationEvent(currentNotifications, event = {}) {
  const nextNotifications =
    event.type === 'current' ? new Map() : new Map(currentNotifications || []);
  const added = [];

  if (event.type === 'current' || event.type === 'added' || event.type === 'updated') {
    normalizeNotificationCollection(event.notifications).forEach((notification) => {
      const wasKnown = nextNotifications.has(notification.notification_id);
      nextNotifications.set(notification.notification_id, notification);
      if (event.type === 'added' && !wasKnown) {
        added.push(notification);
      }
    });
  } else if (event.type === 'removed') {
    Object.keys(event.notifications || {}).forEach((notificationId) => {
      nextNotifications.delete(notificationId);
    });
  }

  return {
    notifications: nextNotifications,
    added,
  };
}

function formatRelativeTime(createdAt, now = Date.now()) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '';

  const elapsedMs = Math.max(0, now - timestamp);
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  if (elapsedMinutes < 1) return t('just now');
  if (elapsedMinutes < 60) return t('{{count}}m ago', { count: elapsedMinutes });

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t('{{count}}h ago', { count: elapsedHours });

  const elapsedDays = Math.floor(elapsedHours / 24);
  return t('{{count}}d ago', { count: elapsedDays });
}

function getSortedNotifications() {
  return Array.from(activeNotifications.values()).sort((a, b) => {
    const bTime = Date.parse(b.created_at);
    const aTime = Date.parse(a.created_at);
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    return safeBTime - safeATime;
  });
}

function showPersistentDesktopNotification(notification) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const title = notification.title || DEFAULT_NOTIFICATION_TITLE;
    const desktopNotification = new Notification(title, {
      // The system toast draws plain text, so the Markdown syntax goes and its words stay.
      body: notificationMarkdownToPlainText(notification.message),
      tag: `ha-persistent-notification-${notification.notification_id}`,
      requireInteraction: false,
    });
    desktopNotification.onclick = () => {
      openPersistentNotificationsPanel();
      window.electronAPI?.showWindow?.().catch((error) => {
        console.error('Error showing widget from notification:', error);
      });
    };
  } catch (error) {
    console.error('Error showing persistent notification:', error);
  }
}

function getBellElements() {
  return {
    button: document.getElementById('persistent-notifications-btn'),
    count: document.getElementById('persistent-notifications-count'),
  };
}

function closePersistentNotificationsPanel() {
  const modal = document.getElementById('persistent-notifications-modal');
  if (!modal) return Promise.resolve();
  const wasOpen = !modal.classList.contains('hidden');
  if (!wasOpen) return Promise.resolve();
  clearInterval(relativeTimeTimer);
  relativeTimeTimer = null;
  return closeDialog(modal);
}

// The ages are worked out when a row is built, and a panel left open would go on saying "just now".
function refreshRelativeTimes() {
  document
    .querySelectorAll('#persistent-notifications-list .persistent-notification-time')
    .forEach((element) => {
      element.textContent = formatRelativeTime(element.dataset.createdAt);
    });
}

function openPersistentNotificationsPanel() {
  renderPersistentNotifications();
  const modal = document.getElementById('persistent-notifications-modal');
  if (!modal) return;
  // Visibility is class-driven; an inline display would fight both `.hidden` and the exit
  // animation the shared close helper runs.
  openDialog(modal, {
    display: null,
    // The bell goes away with the last notification, so focus needs somewhere else to land.
    focusFallback: '#settings-btn',
    dismiss: closePersistentNotificationsPanel,
  });
  clearInterval(relativeTimeTimer);
  relativeTimeTimer = setInterval(refreshRelativeTimes, RELATIVE_TIME_REFRESH_MS);
}

function dismissPersistentNotification(notificationId, button) {
  if (!notificationId) return;
  if (button) button.disabled = true;

  websocket
    .callService('persistent_notification', 'dismiss', {
      notification_id: notificationId,
    })
    .catch((error) => {
      if (button) button.disabled = false;
      console.error('Error dismissing persistent notification:', error);
      // The button just came back with nothing said, which looks like a click that did nothing.
      showToast(t('Could not dismiss notification'), 'error');
    });
}

function createNotificationListItem(notification) {
  const item = document.createElement('div');
  item.className = 'persistent-notification-item';

  const content = document.createElement('div');
  content.className = 'persistent-notification-content';

  const title = document.createElement('div');
  title.className = 'persistent-notification-title';
  title.textContent = notification.title || DEFAULT_NOTIFICATION_TITLE;

  const message = document.createElement('div');
  message.className = 'persistent-notification-message';
  renderNotificationMarkdown(message, notification.message, {
    baseUrl: state.CONFIG?.homeAssistant?.url,
    openLink: (url) => {
      window.electronAPI?.openExternal?.(url)?.catch?.((error) => {
        console.error('Error opening notification link:', error);
      });
    },
  });

  const time = document.createElement('div');
  time.className = 'persistent-notification-time';
  time.dataset.createdAt = notification.created_at;
  time.textContent = formatRelativeTime(notification.created_at);

  content.appendChild(title);
  if (notification.message) content.appendChild(message);
  if (time.textContent) content.appendChild(time);

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'btn btn-secondary btn-sm persistent-notification-dismiss';
  dismissButton.textContent = t('Dismiss');
  dismissButton.dataset.focusKey = `notification:${notification.notification_id}`;
  dismissButton.addEventListener('click', () => {
    dismissPersistentNotification(notification.notification_id, dismissButton);
  });

  item.appendChild(content);
  item.appendChild(dismissButton);
  return item;
}

function renderPersistentNotifications() {
  const notifications = getSortedNotifications();
  const count = notifications.length;
  const { button, count: countElement } = getBellElements();

  if (button) {
    button.classList.toggle('hidden', count === 0);
    button.setAttribute('aria-hidden', count === 0 ? 'true' : 'false');
  }

  if (countElement) {
    countElement.textContent = count > MAX_BELL_COUNT ? `${MAX_BELL_COUNT}+` : String(count);
  }

  const list = document.getElementById('persistent-notifications-list');
  const empty = document.getElementById('persistent-notifications-empty');
  if (!list || !empty) return;

  // Dismissing one rebuilds the list under the focused Dismiss button; focus moves to the next
  // notification's button rather than to the page behind the panel.
  renderKeepingFocus(list, () => {
    list.replaceChildren();
    empty.classList.toggle('hidden', count !== 0);
    notifications.forEach((notification) => {
      list.appendChild(createNotificationListItem(notification));
    });
    // A message can hold links, and one comes before its Dismiss button in the order of the page.
    // The panel still opens on the first Dismiss, where it opened when messages were plain text.
    list.querySelector('.persistent-notification-dismiss')?.setAttribute('data-initial-focus', '');
  });

  if (count === 0) {
    closePersistentNotificationsPanel();
  }
}

function handlePersistentNotificationEvent(event) {
  const { notifications, added } = applyPersistentNotificationEvent(activeNotifications, event);
  activeNotifications = notifications;
  renderPersistentNotifications();
  added.forEach(showPersistentDesktopNotification);
}

function wirePersistentNotificationsUI() {
  if (notificationUiInitialized) return;
  notificationUiInitialized = true;

  const { button } = getBellElements();
  if (button) {
    button.addEventListener('click', openPersistentNotificationsPanel);
  }

  const closeButton = document.getElementById('close-persistent-notifications');
  if (closeButton) {
    closeButton.addEventListener('click', closePersistentNotificationsPanel);
  }
}

function initializePersistentNotifications() {
  wirePersistentNotificationsUI();
  renderPersistentNotifications();

  if (unsubscribePersistentNotifications || typeof websocket.subscribeMessage !== 'function') {
    return;
  }

  unsubscribePersistentNotifications = websocket.subscribeMessage(
    { type: 'persistent_notification/subscribe' },
    handlePersistentNotificationEvent
  );
}

export { applyPersistentNotificationEvent, formatRelativeTime, initializePersistentNotifications };
