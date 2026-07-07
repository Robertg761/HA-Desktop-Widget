import websocket from './websocket.js';
import { t } from './i18n.js';

const DEFAULT_NOTIFICATION_TITLE = 'Home Assistant';
const MAX_BELL_COUNT = 99;

let activeNotifications = new Map();
let unsubscribePersistentNotifications = null;
let notificationUiInitialized = false;

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
  const nextNotifications = event.type === 'current'
    ? new Map()
    : new Map(currentNotifications || []);
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
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
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
    new Notification(title, {
      body: notification.message,
      tag: `ha-persistent-notification-${notification.notification_id}`,
      requireInteraction: false,
    });
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
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function openPersistentNotificationsPanel() {
  renderPersistentNotifications();
  const modal = document.getElementById('persistent-notifications-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function dismissPersistentNotification(notificationId, button) {
  if (!notificationId) return;
  if (button) button.disabled = true;

  websocket.callService('persistent_notification', 'dismiss', {
    notification_id: notificationId,
  }).catch((error) => {
    if (button) button.disabled = false;
    console.error('Error dismissing persistent notification:', error);
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
  message.textContent = notification.message;

  const time = document.createElement('div');
  time.className = 'persistent-notification-time';
  time.textContent = formatRelativeTime(notification.created_at);

  content.appendChild(title);
  if (notification.message) content.appendChild(message);
  if (time.textContent) content.appendChild(time);

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'btn btn-secondary btn-sm persistent-notification-dismiss';
  dismissButton.textContent = t('Dismiss');
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

  list.replaceChildren();
  empty.classList.toggle('hidden', count !== 0);
  notifications.forEach((notification) => {
    list.appendChild(createNotificationListItem(notification));
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

  const modal = document.getElementById('persistent-notifications-modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closePersistentNotificationsPanel();
    });
    modal.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closePersistentNotificationsPanel();
    });
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

export {
  applyPersistentNotificationEvent,
  formatRelativeTime,
  initializePersistentNotifications,
};
