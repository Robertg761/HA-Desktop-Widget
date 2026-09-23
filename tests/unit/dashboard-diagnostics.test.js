jest.mock('../../src/settings.js', () => ({ refreshRestoredDashboardSettings: jest.fn() }));
jest.mock('../../src/ui.js', () => ({ restoreDashboard: jest.fn() }));
const websocket = require('../../src/websocket.js').default;
const state = require('../../src/state.js').default;
const { initializeDashboardTools, diagnosticsReport } = require('../../src/dashboard-tools.js');

test('diagnostics record lifecycle events without copying sensitive server or error content', () => {
  state.setConfig({ homeAssistant: { url: 'http://private-host', token: 'secret-token' } });
  initializeDashboardTools();
  websocket.emit('connect-attempt');
  websocket.emit('message', { type: 'auth_ok' });
  websocket.emit('message', {
    type: 'result',
    success: true,
    result: [{ entity_id: 'sensor.private', state: 'secret-state' }],
  });
  websocket.emit('error', new Error('secret-token http://private-host'));
  const report = diagnosticsReport();
  expect(report.attempts).toBe(1);
  expect(report.lastConnectedAt).toBeTruthy();
  expect(report.lastUpdateAt).toBeTruthy();
  expect(report.lastIssue).toBe('connection_error');
  expect(JSON.stringify(report)).not.toMatch(/private|secret/);
  websocket.removeAllListeners();
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
