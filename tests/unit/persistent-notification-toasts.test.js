/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createMainConfigStore } = require('../helpers/main-config-store');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function registerHandler({ config, persistence = { success: true } }) {
  let handler;
  const start = mainSource.indexOf("ipcRoutes.handle('set-persistent-notification-toasts'");
  const end = mainSource.indexOf('// Popup Hotkey IPC Handlers', start);
  const pushConfigToRenderer = jest.fn();
  const store = createMainConfigStore(config, { pushConfigToRenderer });
  if (!persistence.success) store.failNextWrite(persistence.error);
  const context = {
    ipcRoutes: { handle: (_channel, callback) => (handler = callback) },
    config,
    configStore: store.configStore,
    writeCount: store.writeCount,
    pushConfigToRenderer,
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
    expect(context.writeCount()).toBe(1);
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

  test('is carried by an exported settings file, and absent (meaning on) until somebody turns it off', () => {
    const { ensureEntityAlertsConfigDefaults } = require('../../src/profile-sync-engine.cjs');

    // The shape a sync pull fills in does not grow a key of its own: devices that never touched
    // the switch keep hashing the same.
    expect(ensureEntityAlertsConfigDefaults({}).entityAlerts).toEqual({
      enabled: false,
      alerts: {},
    });
    expect(
      ensureEntityAlertsConfigDefaults({ entityAlerts: { persistentNotifications: false } })
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
