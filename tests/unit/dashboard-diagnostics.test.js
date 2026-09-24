jest.mock('../../src/settings.js', () => ({ refreshRestoredDashboardSettings: jest.fn() }));
jest.mock('../../src/ui.js', () => ({ restoreDashboard: jest.fn() }));
const websocket = require('../../src/websocket.js').default;
const state = require('../../src/state.js').default;
const { initializeDashboardTools, diagnosticsReport } = require('../../src/dashboard-tools.js');

test('diagnostics record lifecycle events without copying sensitive server or error content', async () => {
  window.electronAPI = { platform: 'linux', getAppVersion: jest.fn(async () => '3.11.0') };
  state.setConfig({ homeAssistant: { url: 'http://private-host', token: 'secret-token' } });
  initializeDashboardTools();
  await Promise.resolve();
  websocket.emit('connect-attempt');
  websocket.emit('message', { type: 'auth_ok', ha_version: '2026.9.3' });
  websocket.emit('message', {
    type: 'result',
    success: true,
    result: [{ entity_id: 'sensor.private', state: 'secret-state' }],
  });
  websocket.emit('error', new Error('secret-token http://private-host'));
  websocket.emit('close', { intentional: false });
  websocket.emit('connect-attempt');
  websocket.emit('connect-attempt');
  let report = diagnosticsReport();
  expect(report).toMatchObject({
    appVersion: '3.11.0',
    platform: 'linux',
    homeAssistantVersion: '2026.9.3',
    reconnects: 0,
    recentIssues: [{ reason: 'connection_error', recoveredAt: null, reconnectAttempts: 2 }],
  });
  expect(report.lastConnectedAt).toBeTruthy();
  expect(report.lastUpdateAt).toBeTruthy();

  // The drop stays in the report after the connection recovers.
  websocket.emit('message', { type: 'auth_ok', ha_version: '2026.9.3' });
  report = diagnosticsReport();
  expect(report.reconnects).toBe(1);
  expect(report.recentIssues).toHaveLength(1);
  expect(report.recentIssues[0].startedAt).toBeTruthy();
  expect(report.recentIssues[0].recoveredAt).toBe(report.lastConnectedAt);
  // Reconnecting on purpose (new settings) is not an outage.
  websocket.emit('close', { intentional: true });
  expect(diagnosticsReport().recentIssues).toHaveLength(1);
  expect(JSON.stringify(diagnosticsReport())).not.toMatch(/private|secret/);
  websocket.removeAllListeners();
  delete window.electronAPI;
});

test('diagnostics name the operating system and its version from the main process', async () => {
  jest.resetModules();
  const {
    initializeDashboardTools: initialize,
    diagnosticsReport: report,
  } = require('../../src/dashboard-tools.js');
  const currentSocket = require('../../src/websocket.js').default;
  window.electronAPI = {
    platform: 'linux',
    getOsInfo: jest.fn(async () => ({
      platform: 'linux',
      release: '6.8.0-45-generic',
      distro: 'Ubuntu 24.04.1 LTS',
    })),
  };
  initialize();
  await Promise.resolve();
  await Promise.resolve();
  expect(report().os).toBe('Ubuntu 24.04.1 LTS (linux 6.8.0-45-generic)');
  currentSocket.removeAllListeners();
  delete window.electronAPI;
});

test('diagnostics tell a timed-out connection from a closed one', () => {
  jest.resetModules();
  const {
    initializeDashboardTools: initialize,
    diagnosticsReport: report,
  } = require('../../src/dashboard-tools.js');
  const currentSocket = require('../../src/websocket.js').default;
  initialize();

  currentSocket.emit('close', { intentional: false, reason: 'timeout' });
  expect(report().recentIssues.map((issue) => issue.reason)).toEqual(['connection_timeout']);

  currentSocket.emit('message', { type: 'auth_ok' });
  currentSocket.emit('close', { intentional: false });
  expect(report().recentIssues.map((issue) => issue.reason)).toEqual([
    'connection_closed',
    'connection_timeout',
  ]);
  currentSocket.removeAllListeners();
});

test('the open report refreshes when the reconnect state snapshot arrives', () => {
  jest.resetModules();
  jest.useFakeTimers({ now: new Date('2026-09-23T10:00:00Z') });
  const { initializeDashboardTools: initialize } = require('../../src/dashboard-tools.js');
  const currentSocket = require('../../src/websocket.js').default;
  document.body.innerHTML = '<button id="connection-diagnostics-btn">Diagnostics</button>';
  initialize();
  document.getElementById('connection-diagnostics-btn').click();
  const report = () => JSON.parse(document.querySelector('.diagnostics-report').value);
  jest.setSystemTime(new Date('2026-09-23T10:05:00Z'));
  currentSocket.emit('message', { type: 'auth_ok' });
  expect(report().lastUpdateAt).toBeNull();
  jest.setSystemTime(new Date('2026-09-23T10:05:01Z'));
  currentSocket.emit('message', {
    type: 'result',
    success: true,
    result: [{ entity_id: 'light.kitchen', state: 'on' }],
  });
  expect(report().lastUpdateAt).toBe('2026-09-23T10:05:01.000Z');
  document.querySelectorAll('.dashboard-tools-modal').forEach((modal) => modal.remove());
  currentSocket.removeAllListeners();
  jest.useRealTimers();
});

test('repeated clicks focus the open tool dialog instead of stacking another', () => {
  jest.resetModules();
  const {
    initializeDashboardTools: initialize,
    showDashboardHistory,
  } = require('../../src/dashboard-tools.js');
  const currentSocket = require('../../src/websocket.js').default;
  document.body.innerHTML = '<button id="connection-diagnostics-btn">Diagnostics</button>';
  initialize();
  const button = document.getElementById('connection-diagnostics-btn');
  button.click();
  button.click();
  expect(document.querySelectorAll('.dashboard-tools-modal').length).toBe(1);
  expect(document.activeElement).toBe(document.querySelector('.dashboard-tools-modal .close-btn'));
  showDashboardHistory();
  showDashboardHistory();
  expect(document.querySelectorAll('.dashboard-tools-modal').length).toBe(2);
  document.querySelectorAll('.dashboard-tools-modal').forEach((modal) => modal.remove());
  currentSocket.removeAllListeners();
});

test('Undo follows server history and remains disabled while restoring', async () => {
  jest.resetModules();
  const currentState = require('../../src/state.js').default;
  const { rememberDashboard } = require('../../src/dashboard-history.js');
  const {
    initializeDashboardTools: initialize,
    refreshDashboardUndoState,
  } = require('../../src/dashboard-tools.js');
  const { restoreDashboard } = require('../../src/ui.js');
  const currentSocket = require('../../src/websocket.js').default;
  localStorage.clear();
  const a = {
    homeAssistant: { url: 'http://server-a' },
    customTabs: [{ id: 'one', name: 'One', entityIds: [] }],
  };
  const b = { ...a, homeAssistant: { url: 'http://server-b' } };
  rememberDashboard(b, { ...b, customTabs: [{ id: 'two', name: 'Two', entityIds: [] }] });
  currentState.setConfig(a);
  document.body.innerHTML = '<button id="undo-dashboard-btn" disabled>Undo</button>';
  initialize();
  const undo = document.getElementById('undo-dashboard-btn');
  expect(undo.disabled).toBe(true);
  currentState.setConfig(b);
  refreshDashboardUndoState();
  expect(undo.disabled).toBe(false);
  let finishRestore;
  restoreDashboard.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRestore = resolve;
      })
  );
  const pending = undo.onclick();
  refreshDashboardUndoState();
  window.dispatchEvent(new Event('dashboard-history-changed'));
  expect(undo.disabled).toBe(true);
  await undo.onclick();
  expect(restoreDashboard).toHaveBeenCalledTimes(1);
  finishRestore();
  await pending;
  expect(undo.disabled).toBe(true);
  currentState.setConfig(a);
  refreshDashboardUndoState();
  expect(undo.disabled).toBe(true);
  currentSocket.removeAllListeners();
  localStorage.clear();
});

test('Undo keeps the layout it replaced restorable and steps further back next time', async () => {
  jest.resetModules();
  const currentState = require('../../src/state.js').default;
  const { rememberDashboard, readDashboardHistory } = require('../../src/dashboard-history.js');
  const {
    initializeDashboardTools: initialize,
    showDashboardHistory,
  } = require('../../src/dashboard-tools.js');
  const { restoreDashboard } = require('../../src/ui.js');
  const currentSocket = require('../../src/websocket.js').default;
  localStorage.clear();
  const layout = (...names) => ({
    homeAssistant: { url: 'http://server' },
    customTabs: names.map((name) => ({ id: name, name, entityIds: [] })),
  });
  // Like the real restore, saving the restored layout remembers the one it replaces.
  restoreDashboard.mockImplementation(async (restored, { activeTabId } = {}) => {
    const next = { ...currentState.CONFIG, ...restored, activeTabId };
    rememberDashboard(currentState.CONFIG, next);
    currentState.setConfig(next);
  });
  const edit = (next) => {
    rememberDashboard(currentState.CONFIG, next);
    currentState.setConfig(next);
  };
  currentState.setConfig({ ...layout('All'), activeTabId: 'All' });
  edit({ ...layout('All', 'Kitchen'), activeTabId: 'Kitchen' });
  edit({ ...layout('All', 'Kitchen', 'Bedroom'), activeTabId: 'Bedroom' });
  document.body.innerHTML = '<button id="undo-dashboard-btn">Undo</button>';
  initialize();
  const undo = document.getElementById('undo-dashboard-btn');

  await undo.onclick();
  expect(restoreDashboard).toHaveBeenLastCalledWith(expect.anything(), { activeTabId: 'Kitchen' });
  expect(currentState.CONFIG.customTabs.map((tab) => tab.name)).toEqual(['All', 'Kitchen']);
  let history = readDashboardHistory(currentState.CONFIG);
  expect(history[0]).toMatchObject({ undone: true });
  expect(history[0].layout.customTabs.map((tab) => tab.name)).toEqual([
    'All',
    'Kitchen',
    'Bedroom',
  ]);

  // A second Undo goes back another step rather than redoing the first.
  await undo.onclick();
  expect(currentState.CONFIG.customTabs.map((tab) => tab.name)).toEqual(['All']);
  history = readDashboardHistory(currentState.CONFIG);
  expect(history.map((entry) => entry.layout.customTabs.length)).toEqual([2, 3]);
  expect(history.every((entry) => entry.undone)).toBe(true);
  expect(undo.disabled).toBe(true);

  // Both undone layouts can still be brought back from Restore dashboard.
  showDashboardHistory();
  const rows = [...document.querySelectorAll('.dashboard-restore-entry')];
  expect(rows).toHaveLength(2);
  expect(rows[1].textContent).toContain('Before undo');
  expect(rows[1].textContent).toContain('Bedroom');
  rows[1].click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(currentState.CONFIG.customTabs.map((tab) => tab.name)).toEqual([
    'All',
    'Kitchen',
    'Bedroom',
  ]);
  expect(currentState.CONFIG.activeTabId).toBe('Bedroom');
  document.querySelectorAll('.dashboard-tools-modal').forEach((modal) => modal.remove());
  currentSocket.removeAllListeners();
  localStorage.clear();
});

test('Copy report copies through the main process and falls back to manual selection', async () => {
  jest.resetModules();
  const { initializeDashboardTools: initialize } = require('../../src/dashboard-tools.js');
  const currentSocket = require('../../src/websocket.js').default;
  const writeClipboardText = jest.fn().mockResolvedValue({ success: true });
  window.electronAPI = { writeClipboardText };
  document.body.innerHTML =
    '<button id="connection-diagnostics-btn">Diagnostics</button><div id="toast-container"></div>';
  initialize();
  document.getElementById('connection-diagnostics-btn').click();
  const modal = document.querySelector('.dashboard-tools-modal');
  const report = modal.querySelector('.diagnostics-report');
  const copy = [...modal.querySelectorAll('button')].find((b) => b.textContent === 'Copy report');

  await copy.onclick();
  expect(writeClipboardText).toHaveBeenCalledWith(report.value);
  expect(document.getElementById('toast-container').textContent).toContain('Report copied');
  expect(document.activeElement).not.toBe(report);

  writeClipboardText.mockRejectedValueOnce(new Error('Invalid clipboard text'));
  await copy.onclick();
  expect(document.activeElement).toBe(report);
  expect(document.getElementById('toast-container').textContent).toContain(
    'Select and copy the report manually.'
  );
  modal.remove();
  delete window.electronAPI;
  currentSocket.removeAllListeners();
});
