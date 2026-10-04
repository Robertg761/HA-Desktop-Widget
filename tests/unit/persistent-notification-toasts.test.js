/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function registerHandler({ config, persistence = { success: true }, authorized = true }) {
  let handler;
  const start = mainSource.indexOf("ipcMain.handle(\n  'set-persistent-notification-toasts'");
  const end = mainSource.indexOf('// Popup Hotkey IPC Handlers', start);
  const context = {
    ipcMain: { handle: (_channel, callback) => (handler = callback) },
    // The real wrapper runs the handler after earlier mutations; the order does not matter here.
    serializeConfigMutationHandler: (callback) => callback,
    authorizeIpcSender: () => authorized,
    rejectUnauthorizedIpc: () => ({ success: false, error: 'unauthorized' }),
    config,
    saveConfigDurably: jest.fn(async () => persistence),
    pushConfigToRenderer: jest.fn(),
    mainT: (key, vars = {}) => key.replace('{{error}}', vars.error ?? ''),
  };
  vm.runInNewContext(mainSource.slice(start, end), context);
  return { handler, context };
}

describe('the Home Assistant notifications switch in the main process', () => {
  test('turns the desktop notifications off and tells the window', async () => {
    const config = { entityAlerts: { enabled: false, alerts: {} } };
    const { handler, context } = registerHandler({ config });

    await expect(handler({}, false)).resolves.toEqual({ success: true });

    expect(config.entityAlerts.persistentNotifications).toBe(false);
    expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
    expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
    // Alerts for entities are a different thing and keep their own setting.
    expect(config.entityAlerts.enabled).toBe(false);
  });

  test('puts the old value back, and says so, when the setting cannot be saved', async () => {
    const config = { entityAlerts: { persistentNotifications: true, enabled: true, alerts: {} } };
    const { handler, context } = registerHandler({
      config,
      persistence: { success: false, error: 'disk full' },
    });

    const result = await handler({}, false);

    expect(result).toEqual({ success: false, error: 'Failed to save alert setting: disk full' });
    expect(config.entityAlerts.persistentNotifications).toBe(true);
    expect(context.pushConfigToRenderer).not.toHaveBeenCalled();
  });

  test('is refused for a sender that is not the app', async () => {
    const config = { entityAlerts: { enabled: false, alerts: {} } };
    const { handler } = registerHandler({ config, authorized: false });

    await expect(handler({}, false)).resolves.toEqual({ success: false, error: 'unauthorized' });
    expect(config.entityAlerts.persistentNotifications).toBeUndefined();
  });

  test('is carried by an exported settings file, and absent (meaning on) until somebody turns it off', () => {
    const start = mainSource.indexOf('function ensureEntityAlertsConfigDefaults');
    const source = mainSource.slice(start, mainSource.indexOf('\n}\n', start) + 3);
    const context = { isPlainObject: (v) => !!v && typeof v === 'object' && !Array.isArray(v) };
    vm.runInNewContext(source, context);

    // The shape a sync pull fills in does not grow a key of its own: devices that never touched
    // the switch keep hashing the same.
    expect(context.ensureEntityAlertsConfigDefaults({}).entityAlerts).toEqual({
      enabled: false,
      alerts: {},
    });
    expect(
      context.ensureEntityAlertsConfigDefaults({ entityAlerts: { persistentNotifications: false } })
        .entityAlerts.persistentNotifications
    ).toBe(false);

    // The setting travels in a settings file, and is restored from one.
    const { buildSettingsFile, parseSettingsFile } = require('../../src/settings-file.cjs');
    const file = buildSettingsFile({
      entityAlerts: { enabled: true, persistentNotifications: false, alerts: {} },
    });
    expect(parseSettingsFile(JSON.stringify(file)).entityAlerts.persistentNotifications).toBe(
      false
    );
  });
});
