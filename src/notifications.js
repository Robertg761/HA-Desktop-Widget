import websocket from './websocket.js';
import state from './state.js';
import { formatClockDateTime, formatRelativeTime as formatAge } from './format.js';
import { t } from './i18n.js';
import {
  notificationMarkdownToPlainText,
  renderNotificationMarkdown,
} from './notification-markdown.js';
import { closeDialog, openDialog, renderKeepingFocus, showConfirm, showToast } from './ui-utils.js';

const DEFAULT_NOTIFICATION_TITLE = 'Home Assistant';
const MAX_BELL_COUNT = 99;
// How long an open panel goes before it says "5 min. ago" where it said "4 min. ago".
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

// How long ago a notification arrived, in the language's own relative time ("5 min. ago",
// "hace 5 min", "قبل 5 دقائق"), and "just now" for the first minute.
function formatRelativeTime(createdAt, now = Date.now()) {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '';
  // One stamped ahead of this computer's clock is just now, not "in 2 minutes".
  return formatAge(Math.min(timestamp, now), { now });
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
    // Home Assistant's own notifications can be kept out of the desktop's notification area; they
    // still arrive in the bell's list. This is not the entity alerts switch, and works with it off.
    if (state.CONFIG?.entityAlerts?.persistentNotifications === false) return;
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

// Clears every notification, for the backlog an integration failure leaves behind. Home Assistant has
// a service for it; if this one's does not know it, each notification is dismissed on its own.
async function dismissAllPersistentNotifications(button) {
  const ids = Array.from(activeNotifications.keys());
  if (ids.length < 2) return;
  const confirmed = await showConfirm(
    t('Dismiss all notifications?'),
    t('This clears {{count}} notifications in Home Assistant, on every device.', {
      count: ids.length,
    }),
    { confirmText: t('Dismiss all'), confirmClass: 'btn-danger' }
  );
  if (!confirmed) return;
  if (button) button.disabled = true;
  try {
    try {
      await websocket.callService('persistent_notification', 'dismiss_all', {});
    } catch {
      const results = await Promise.allSettled(
        ids.map((id) =>
          websocket.callService('persistent_notification', 'dismiss', { notification_id: id })
        )
      );
      if (results.some((result) => result.status === 'rejected')) throw new Error('dismiss failed');
    }
  } catch (error) {
    console.error('Error dismissing all persistent notifications:', error);
    showToast(t('Could not dismiss notifications'), 'error');
  } finally {
    if (button) button.disabled = false;
  }
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
  // "5m ago" says how long, not when; the exact time is on hover.
  const createdAt = new Date(notification.created_at);
  if (Number.isFinite(createdAt.getTime())) {
    time.title = formatClockDateTime(createdAt);
  }

  content.appendChild(title);
  if (notification.message) content.appendChild(message);
  if (time.textContent) content.appendChild(time);

  const dismissButton = document.createElement('button');
  dismissButton.type = 'button';
  dismissButton.className = 'btn btn-secondary btn-sm persistent-notification-dismiss';
  dismissButton.textContent = t('Dismiss');
  // Several rows of "Dismiss" are told apart by the notification each one clears.
  dismissButton.setAttribute(
    'aria-label',
    t('Dismiss {{title}}', { title: notification.title || DEFAULT_NOTIFICATION_TITLE })
  );
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

  // A long backlog gets its size and one way to clear it; one or two notifications do not need either.
  const toolbar = document.getElementById('persistent-notifications-toolbar');
  if (toolbar) {
    toolbar.classList.toggle('hidden', count < 2);
    const summary = document.getElementById('persistent-notifications-summary');
    if (summary) summary.textContent = t('{{count}} notifications', { count });
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

  const dismissAllButton = document.getElementById('dismiss-all-notifications');
  if (dismissAllButton) {
    dismissAllButton.addEventListener('click', () =>
      dismissAllPersistentNotifications(dismissAllButton)
    );
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
