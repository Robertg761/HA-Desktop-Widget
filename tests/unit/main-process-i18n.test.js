const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { formatTemplate } = require('../../src/i18n-main.cjs');
const { describeKnownProfileSyncFailure } = require('../../src/profile-sync-engine.cjs');
const {
  createProfileSyncHarness,
  createSafeStorage,
} = require('../helpers/profile-sync-devices.js');
const { liveEntityHotkeys, resolveEntityHotkeyAction } = require('../../src/entity-hotkeys.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

const GERMAN = {
  'Turn on {{entity}}': '{{entity}} einschalten',
  'Toggle {{entity}}': '{{entity}} umschalten',
  'Lock {{entity}}': '{{entity}} verriegeln',
  'Show or hide the widget window': 'Widget-Fenster ein- oder ausblenden',
  '{{error}}. Rollback failed: {{warning}}':
    '{{error}}. Wiederherstellung fehlgeschlagen: {{warning}}',
  'Failed to save hotkey: {{error}}': 'Tastenkürzel konnte nicht gespeichert werden: {{error}}',
  'Previous hotkey bindings could not be restored':
    'Vorherige Tastenkürzel konnten nicht wiederhergestellt werden',
  'Failed to decrypt synced profile payload':
    'Das synchronisierte Profil konnte nicht entschlüsselt werden',
  'Passphrase will only be kept for this session because OS encryption is unavailable.':
    'Die Passphrase wird nur für diese Sitzung behalten, weil die Systemverschlüsselung fehlt.',
};

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

function loadMainRuntime(language, extraContext = {}) {
  const context = {
    config: { ui: { language } },
    describeKnownProfileSyncFailure,
    localizationService: {
      translate: (languageSetting, key, vars) =>
        formatTemplate((languageSetting === 'de' ? GERMAN[key] : null) || key, vars),
    },
    ...extraContext,
  };
  vm.createContext(context);
  vm.runInContext(sliceMain('function mainT(', 'function finishSmokeTest('), context);
  return context;
}

// collectPortalShortcuts and the descriptions it gives, run against the test catalogs above.
function portalShortcutRuntime() {
  const runtime = loadMainRuntime('de', {
    PORTAL_ENTITY_SHORTCUT_PREFIX: 'entity:',
    PORTAL_POPUP_SHORTCUT_ID: 'popup',
    liveEntityHotkeys,
    resolveEntityHotkeyAction,
  });
  vm.runInContext(
    sliceMain('function collectPortalShortcuts(', 'function reportPortalShortcutSyncResult('),
    runtime
  );
  return runtime;
}

describe('main-process translations', () => {
  it('names portal shortcuts in the app language for the desktop shortcut settings', () => {
    const shortcutConfig = {
      ui: { language: 'de' },
      globalHotkeys: {
        enabled: true,
        hotkeys: {
          'light.kitchen': { hotkey: 'Ctrl+Alt+K', action: 'turn_on' },
          'switch.fan': 'Ctrl+Alt+F',
        },
      },
      popupHotkey: 'Ctrl+Alt+H',
    };
    const runtime = portalShortcutRuntime();
    runtime.config = shortcutConfig;

    expect(runtime.collectPortalShortcuts().map((shortcut) => shortcut.description)).toEqual([
      'light.kitchen einschalten',
      'switch.fan umschalten',
      'Widget-Fenster ein- oder ausblenden',
    ]);

    runtime.config = { ...shortcutConfig, ui: { language: 'en' } };
    expect(runtime.collectPortalShortcuts().map((shortcut) => shortcut.description)).toEqual([
      'Turn on light.kitchen',
      'Toggle switch.fan',
      'Show or hide the widget window',
    ]);
  });

  // Every action but turning on and off was listed as Toggle, so a lock's Unlock hotkey read
  // "Toggle lock.back_door" in the desktop's shortcut settings.
  it('names each portal shortcut for the action it runs', () => {
    const runtime = portalShortcutRuntime();
    const descriptions = (hotkeys, language = 'en') => {
      runtime.config = { ui: { language }, globalHotkeys: { enabled: true, hotkeys } };
      return runtime.collectPortalShortcuts().map((shortcut) => shortcut.description);
    };

    expect(
      descriptions({
        'lock.back_door': { hotkey: 'Ctrl+Alt+1', action: 'unlock' },
        'lock.front_door': { hotkey: 'Ctrl+Alt+2', action: 'lock' },
        'cover.garage': { hotkey: 'Ctrl+Alt+3', action: 'open' },
        'valve.garden': { hotkey: 'Ctrl+Alt+4', action: 'close' },
        'button.doorbell': { hotkey: 'Ctrl+Alt+5', action: 'press' },
        'automation.night': { hotkey: 'Ctrl+Alt+6', action: 'trigger' },
        'light.desk': { hotkey: 'Ctrl+Alt+7', action: 'brightness_up' },
        'light.hall': { hotkey: 'Ctrl+Alt+8', action: 'brightness_down' },
        'fan.ceiling': { hotkey: 'Ctrl+Alt+9', action: 'increase_speed' },
        'fan.desk': { hotkey: 'Ctrl+Alt+0', action: 'decrease_speed' },
        'cover.blind': { hotkey: 'Ctrl+Shift+1', action: 'toggle' },
      })
    ).toEqual([
      'Unlock lock.back_door',
      'Lock lock.front_door',
      'Open cover.garage',
      'Close valve.garden',
      'Press button.doorbell',
      'Trigger automation.night',
      'Brighten light.desk',
      'Dim light.hall',
      'Speed up fan.ceiling',
      'Slow down fan.desk',
      'Toggle cover.blind',
    ]);
    // A lock has no toggle: one an older version saved as a toggle, or as a bare accelerator, locks.
    expect(
      descriptions(
        { 'lock.back_door': { hotkey: 'Ctrl+Alt+L', action: 'toggle' }, 'lock.shed': 'Ctrl+Alt+S' },
        'de'
      )
    ).toEqual(['lock.back_door verriegeln', 'lock.shed verriegeln']);
  });

  it('reports a failed hotkey save and its failed rollback as one translated sentence', () => {
    const runtime = loadMainRuntime('de');
    const message = runtime.withRollbackWarning(
      runtime.mainT('Failed to save hotkey: {{error}}', { error: 'EACCES' }),
      runtime.mainT('Previous hotkey bindings could not be restored')
    );

    expect(message).toBe(
      'Tastenkürzel konnte nicht gespeichert werden: EACCES. Wiederherstellung fehlgeschlagen: ' +
        'Vorherige Tastenkürzel konnten nicht wiederhergestellt werden'
    );
    expect(runtime.withRollbackWarning('Saved', '')).toBe('Saved');
  });

  it('translates shared-helper errors by their English text and passes unknown text through', () => {
    const runtime = loadMainRuntime('de');

    expect(runtime.mainTError(new Error('Failed to decrypt synced profile payload'))).toBe(
      'Das synchronisierte Profil konnte nicht entschlüsselt werden'
    );
    expect(runtime.mainTError("ENOENT: no such file or directory, open '/sync'")).toBe(
      "ENOENT: no such file or directory, open '/sync'"
    );
    expect(runtime.mainTError('')).toBe('');
  });

  describe('profile sync', () => {
    const harness = createProfileSyncHarness();
    beforeEach(() => harness.setup());
    afterEach(() => harness.teardown());

    it('shows stored profile sync messages in the current language', async () => {
      const runtime = loadMainRuntime('de');
      // A computer without a keyring, whose passphrase is only kept for the session.
      const device = harness.createDevice('desktop', {
        syncing: false,
        safeStorage: createSafeStorage({ keyring: 'none' }),
        t: runtime.mainT,
        tError: runtime.mainTError,
      });
      await device.invoke('set-profile-sync-passphrase', 'a long enough passphrase', true);
      // Persisted in config by an earlier sync attempt, still in English.
      Object.assign(device.config.profileSync, {
        enabled: true,
        lastSyncStatus: 'error',
        lastSyncError: 'Failed to decrypt synced profile payload',
      });

      const status = device.status();
      expect(status.lastSyncError).toBe(
        'Das synchronisierte Profil konnte nicht entschlüsselt werden'
      );
      expect(status.passphraseWarning).toBe(
        'Die Passphrase wird nur für diese Sitzung behalten, weil die Systemverschlüsselung fehlt.'
      );
    });
  });

  it('wires the translator into main-process menus and helper modules', () => {
    expect(sliceMain('attachEditHandlers(mainWindow, Menu', '});')).toContain(
      'translate: (key) => mainT(key)'
    );
    expect(sliceMain('new HomeAssistantOAuthClient({', '});')).toContain(
      'translate: (key) => mainT(key)'
    );
    expect(sliceMain('createLinuxPopupHotkeyController({', '});')).toContain(
      'translate: (key, vars) => mainT(key, vars)'
    );
  });
});
