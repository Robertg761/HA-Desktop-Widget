import state from './state.js';
import websocket from './websocket.js';
import { restoreDashboard } from './ui.js';
import { refreshRestoredDashboardSettings } from './settings.js';
import { readDashboardHistory, writeDashboardHistory } from './dashboard-history.js';
import {
  closeDialog,
  copyTextToClipboard,
  disableControlsKeepingFocus,
  openDialog,
  showToast,
} from './ui-utils.js';
import { formatClockDateTime } from './format.js';
import { t } from './i18n.js';
import { applyCloseButtonIcons, setIconContent } from './icons.js';
import pageNameRules from './page-names.cjs';

const { defaultPageName } = pageNameRules;

const MAX_RECENT_ISSUES = 5;
const connection = {
  appVersion: null,
  operatingSystem: null,
  homeAssistantVersion: null,
  lastConnectedAt: null,
  lastUpdateAt: null,
  reconnects: 0,
  outage: null,
  recentIssues: [],
};

// The system and its version from the main process, e.g. "Ubuntu 24.04 LTS (linux 6.8.0-45)".
// Until that arrives, the operating system part of the user agent ("X11; Linux x86_64").
function operatingSystem() {
  return (
    connection.operatingSystem ||
    /\(([^)]+)\)/.exec(globalThis.navigator?.userAgent || '')?.[1] ||
    null
  );
}

function describeOperatingSystem(info) {
  const text = (value) => (typeof value === 'string' ? value.trim().slice(0, 128) : '');
  const platform = text(info?.platform);
  if (!platform) return null;
  const system = [platform, text(info.release)].filter(Boolean).join(' ');
  const distro = text(info.distro);
  return distro ? `${distro} (${system})` : system;
}

function diagnosticsReport() {
  // Deliberately allowlist fields. Server messages, URLs, states and config may contain secrets,
  // so issues are recorded as fixed reason codes and times only.
  // What explains a lost connection comes first, so it is on screen when the dialog opens; the
  // fixed facts about this install follow.
  return {
    connection: websocket.isConnected() ? 'connected' : 'disconnected',
    recentIssues: connection.recentIssues.map((issue) => ({ ...issue })),
    lastConnectedAt: connection.lastConnectedAt,
    lastUpdateAt: connection.lastUpdateAt,
    reconnects: connection.reconnects,
    appVersion: connection.appVersion,
    platform: window.electronAPI?.platform || null,
    os: operatingSystem(),
    homeAssistantVersion: connection.homeAssistantVersion,
  };
}

function isStateSnapshot(message) {
  return (
    message?.type === 'result' &&
    message.success &&
    Array.isArray(message.result) &&
    message.result.some((entity) => entity?.entity_id && typeof entity.state === 'string')
  );
}

// An outage lasts from the first failure until Home Assistant accepts the connection again. It is
// kept after recovery so a report copied later still shows the drop.
function recordIssue(reason) {
  if (!connection.outage) {
    connection.outage = {
      reason,
      startedAt: new Date().toISOString(),
      recoveredAt: null,
      reconnectAttempts: 0,
    };
    connection.recentIssues = [connection.outage, ...connection.recentIssues].slice(
      0,
      MAX_RECENT_ISSUES
    );
  } else if (reason === 'authorization_failed') {
    connection.outage.reason = reason;
  }
}

function dialog(title, { key, onClose = null } = {}) {
  const open = document.querySelector(`.dashboard-tools-modal[data-tool="${key}"]`);
  if (open) {
    open.querySelector('.close-btn')?.focus();
    return null;
  }
  const modal = document.createElement('div');
  modal.className = 'modal dashboard-tools-modal';
  modal.dataset.tool = key;
  modal.setAttribute('aria-label', title);
  const content = document.createElement('div');
  content.className = 'modal-content';
  const header = document.createElement('div');
  header.className = 'modal-header';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const close = document.createElement('button');
  close.className = 'close-btn';
  close.textContent = '×';
  close.setAttribute('aria-label', t('Close'));
  close.onclick = () => void closeDialog(modal, { remove: true, onClosed: onClose });
  header.append(heading, close);
  const body = document.createElement('div');
  body.className = 'modal-body';
  content.append(header, body);
  modal.append(content);
  document.body.append(modal);
  applyCloseButtonIcons(modal);
  // Called once the caller has filled the dialog in, so focus can start on its first control.
  const show = () => openDialog(modal, { display: null, dismiss: () => close.click() });
  return { modal, body, content, show };
}

function showDashboardHistory() {
  const opened = dialog(t('Restore dashboard'), { key: 'history' });
  if (!opened) return;
  const { modal, body, show } = opened;
  const description = document.createElement('p');
  description.className = 'workflow-description';
  description.textContent = t(
    'Restore a saved layout. Your current layout is saved before restoring. Connection settings stay on this device.'
  );
  body.append(description);
  const entries = readDashboardHistory(state.CONFIG);
  if (!entries.length) {
    description.classList.add('workflow-empty');
    description.textContent = t(
      'No restore points yet. Dashboard edits create local restore points automatically.'
    );
  }
  entries.forEach((entry) => {
    const button = document.createElement('button');
    button.className = 'btn btn-secondary dashboard-restore-entry';
    const date = document.createElement('span');
    date.className = 'dashboard-restore-date';
    date.textContent = entry.undone
      ? `${formatClockDateTime(entry.at)} · ${t('Before undo')}`
      : formatClockDateTime(entry.at);
    const pages = document.createElement('span');
    pages.className = 'dashboard-restore-pages';
    // A page nobody named is saved either with the name of the language of the day or, as the
    // server stores it, with no name at all; both are shown with today's default name.
    pages.textContent = entry.layout.customTabs
      .map((tab, index) =>
        tab.nameIsDefault || !String(tab.name ?? '').trim() ? defaultPageName(index, t) : tab.name
      )
      .join(', ');
    // Near-identical rows are told apart by how much each holds, not only by when it was saved.
    const count = document.createElement('span');
    count.className = 'dashboard-restore-count';
    count.textContent = t('Pages: {{pages}} · Tiles: {{tiles}}', {
      pages: entry.layout.customTabs.length,
      tiles: entry.layout.customTabs.reduce(
        (total, tab) => total + (tab.entityIds?.length || 0),
        0
      ),
    });
    const arrow = document.createElement('span');
    arrow.className = 'dashboard-restore-arrow';
    setIconContent(arrow, 'undo', { size: 20 });
    arrow.setAttribute('aria-hidden', 'true');
    button.append(date, pages, count, arrow);
    // The row's text is a date and some page names; the name says what pressing it does.
    button.setAttribute(
      'aria-label',
      t('Restore layout from {{date}}', { date: date.textContent })
    );
    button.onclick = async () => {
      const reenable = disableControlsKeepingFocus(modal.querySelectorAll('button'));
      try {
        await restoreDashboard(entry.layout, { activeTabId: entry.activeTabId });
        refreshRestoredDashboardSettings();
        void closeDialog(modal, { remove: true });
        showToast(t('Dashboard restored'), 'success');
      } catch {
        showToast(t('Could not restore dashboard. Please retry.'), 'error');
        reenable();
      }
    };
    body.append(button);
  });
  show();
}

function showConnectionDiagnostics() {
  // Connection changes refresh the dialog while it is open. State updates are left to the Refresh
  // button so the report the user may be reading or selecting is not rewritten every second.
  const liveEvents = ['open', 'close', 'error', 'message'];
  const onLiveEvent = (message) => {
    // Refresh once the reconnect's state snapshot arrives, not only on auth_ok before it.
    if (
      message?.type &&
      !['auth_ok', 'auth_invalid'].includes(message.type) &&
      !isStateSnapshot(message)
    )
      return;
    if (modal.isConnected) update();
  };
  const stopLiveUpdates = () => liveEvents.forEach((event) => websocket.off(event, onLiveEvent));
  const opened = dialog(t('Connection diagnostics'), {
    key: 'diagnostics',
    onClose: stopLiveUpdates,
  });
  if (!opened) return;
  const { modal, body, content, show } = opened;
  const summary = document.createElement('p');
  summary.className = 'diagnostics-status';
  summary.setAttribute('role', 'status');
  const report = document.createElement('textarea');
  report.className = 'form-control diagnostics-report';
  report.readOnly = true;
  // The report is eleven lines when nothing has gone wrong, and the last one is the closing brace.
  report.rows = 12;
  report.setAttribute('aria-label', t('Diagnostic report'));
  const refresh = document.createElement('button');
  refresh.className = 'btn btn-secondary';
  refresh.textContent = t('Refresh');
  const update = () => {
    const data = diagnosticsReport();
    summary.textContent = websocket.isConnected()
      ? t('Connected to Home Assistant')
      : t('Disconnected from Home Assistant');
    summary.dataset.connected = String(websocket.isConnected());
    report.value = JSON.stringify(data, null, 2);
  };
  refresh.onclick = update;
  const copy = document.createElement('button');
  copy.className = 'btn btn-primary';
  copy.textContent = t('Copy report');
  copy.onclick = async () => {
    if (await copyTextToClipboard(report.value)) {
      showToast(t('Report copied'), 'success');
      return;
    }
    report.focus();
    report.select();
    showToast(t('Select and copy the report manually.'), 'info');
  };
  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  footer.append(refresh, copy);
  body.append(summary, report);
  content.append(footer);
  update();
  liveEvents.forEach((event) => websocket.on(event, onLiveEvent));
  show();
}

const sameEntry = (a, b) => a.at === b.at && JSON.stringify(a.layout) === JSON.stringify(b.layout);

// Restoring saved the layout Undo replaced as the newest entry. Keep it so an accidental Undo can
// be reversed from Restore dashboard, but mark it so the next Undo steps further back instead of
// bouncing between the two layouts. The restored entry is the current layout now, so it goes.
function historyAfterUndo(before, after, restored) {
  let removed = false;
  return after
    .filter((entry) => {
      if (removed || !sameEntry(entry, restored)) return true;
      removed = true;
      return false;
    })
    .map((entry) =>
      before.some((previous) => sameEntry(previous, entry)) ? entry : { ...entry, undone: true }
    );
}

let undoInFlight = false;
function refreshDashboardUndoState() {
  const undo = document.getElementById('undo-dashboard-btn');
  if (undo) {
    undo.disabled =
      undoInFlight || !readDashboardHistory(state.CONFIG).some((entry) => !entry.undone);
  }
}

let initialized = false;
function initializeDashboardTools() {
  if (initialized) return;
  initialized = true;
  window.electronAPI
    ?.getAppVersion?.()
    ?.then((version) => {
      if (typeof version === 'string') connection.appVersion = version.slice(0, 64);
    })
    .catch(() => {});
  window.electronAPI
    ?.getOsInfo?.()
    ?.then((info) => {
      connection.operatingSystem = describeOperatingSystem(info);
    })
    .catch(() => {});
  websocket.on('connect-attempt', () => {
    if (connection.outage) connection.outage.reconnectAttempts += 1;
  });
  websocket.on('close', (event) => {
    // Closing a socket to reconnect with new settings is not a connection problem.
    if (event?.intentional) return;
    recordIssue(event?.reason === 'timeout' ? 'connection_timeout' : 'connection_closed');
  });
  websocket.on('error', (error) => {
    recordIssue(
      /invalid configuration|default token/i.test(error?.message || '')
        ? 'invalid_configuration'
        : 'connection_error'
    );
  });
  websocket.on('message', (message) => {
    if (message.type === 'auth_ok') {
      // Only a connection that was lost and came back is a reconnect. Reconnecting on purpose
      // (new settings) closes the socket without opening an outage, and is not counted.
      if (connection.lastConnectedAt && connection.outage) connection.reconnects += 1;
      connection.lastConnectedAt = new Date().toISOString();
      if (typeof message.ha_version === 'string') {
        connection.homeAssistantVersion = message.ha_version.slice(0, 32);
      }
      if (connection.outage) {
        connection.outage.recoveredAt = connection.lastConnectedAt;
        connection.outage = null;
      }
    }
    if (message.type === 'auth_invalid') recordIssue('authorization_failed');
    if (
      (message.type === 'event' && message.event?.event_type === 'state_changed') ||
      isStateSnapshot(message)
    ) {
      connection.lastUpdateAt = new Date().toISOString();
    }
  });
  const undo = document.getElementById('undo-dashboard-btn');
  if (undo) {
    window.addEventListener('dashboard-history-changed', refreshDashboardUndoState);
    undo.onclick = async () => {
      if (undoInFlight) return;
      const config = state.CONFIG;
      const entries = readDashboardHistory(config);
      const target = entries.find((entry) => !entry.undone);
      if (!target) return;
      undoInFlight = true;
      refreshDashboardUndoState();
      try {
        await restoreDashboard(target.layout, { activeTabId: target.activeTabId });
        refreshRestoredDashboardSettings();
        writeDashboardHistory(
          config,
          historyAfterUndo(entries, readDashboardHistory(config), target)
        );
        showToast(t('Dashboard edit undone'), 'success');
      } catch {
        showToast(t('Could not restore dashboard. Please retry.'), 'error');
      } finally {
        undoInFlight = false;
        refreshDashboardUndoState();
      }
    };
    refreshDashboardUndoState();
  }
  document.getElementById('dashboard-history-btn')?.addEventListener('click', showDashboardHistory);
  document
    .getElementById('connection-diagnostics-btn')
    ?.addEventListener('click', showConnectionDiagnostics);
}

export {
  initializeDashboardTools,
  // For failures seen without a socket event, such as an OAuth authorization that could not be
  // restored because Home Assistant was down at launch.
  recordIssue as recordConnectionIssue,
  refreshDashboardUndoState,
  showDashboardHistory,
  diagnosticsReport,
};
