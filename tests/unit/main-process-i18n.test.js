const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { formatTemplate } = require('../../src/i18n-main.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

const GERMAN = {
  'Turn on {{entity}}': '{{entity}} einschalten',
  'Toggle {{entity}}': '{{entity}} umschalten',
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
    const runtime = loadMainRuntime('de', {
      PORTAL_ENTITY_SHORTCUT_PREFIX: 'entity:',
      PORTAL_POPUP_SHORTCUT_ID: 'popup',
    });
    runtime.config = shortcutConfig;
    vm.runInContext(
      sliceMain('function collectPortalShortcuts(', 'function reportPortalShortcutSyncResult('),
      runtime
    );

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

  it('shows stored profile sync messages in the current language', () => {
    const runtime = loadMainRuntime('de', {
      PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES: 15,
      profileSyncRuntime: {
        passphraseWarning:
          'Passphrase will only be kept for this session because OS encryption is unavailable.',
        conflictCopies: [],
      },
      getProfileSyncConfig: () => ({
        enabled: true,
        lastSyncStatus: 'error',
        // Persisted in config by an earlier sync attempt, still in English.
        lastSyncError: 'Failed to decrypt synced profile payload',
      }),
      normalizeProfileSyncProvider: (provider) => provider || 'custom',
      getNormalizedProfileSyncScopeValue: () => 'all',
      collectProfileSyncFolderWarnings: () => [],
      getCloudSyncStatus: () => ({ available: false, signedIn: false }),
    });
    vm.runInContext(
      sliceMain(
        'function buildProfileSyncStatus(',
        'function hasProfileSyncCredentialTransitionPending('
      ),
      runtime
    );

    const status = runtime.buildProfileSyncStatus();
    expect(status.lastSyncError).toBe(
      'Das synchronisierte Profil konnte nicht entschlüsselt werden'
    );
    expect(status.passphraseWarning).toBe(
      'Die Passphrase wird nur für diese Sitzung behalten, weil die Systemverschlüsselung fehlt.'
    );
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
