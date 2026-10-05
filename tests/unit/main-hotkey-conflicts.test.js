/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { acceleratorsConflict, validateAccelerator } = require('../../src/accelerators.cjs');
const { liveEntityHotkeys } = require('../../src/entity-hotkeys.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

// main.js is one large script, so the hotkey helpers are run on their own with the model they use.
function loadHelpers({ platform = 'linux', config = {} } = {}) {
  const start = mainSource.indexOf('function validateHotkey(');
  const end = mainSource.indexOf('// Popup Hotkey Management', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const context = vm.createContext({
    process: { platform },
    config,
    acceleratorsConflict,
    validateAccelerator,
    liveEntityHotkeys,
    mainT: (text, values = {}) =>
      text.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(values[name])),
  });
  vm.runInContext(mainSource.slice(start, end), context);
  return context;
}

describe('the hotkey checks in main', () => {
  describe('hotkeyConflictResult', () => {
    it('names the entity by its custom name and carries its id, so the row can be pointed at', () => {
      const { hotkeyConflictResult } = loadHelpers({
        config: { customEntityNames: { 'light.desk': 'Study lamp' } },
      });

      expect(hotkeyConflictResult('light.desk')).toEqual({
        success: false,
        error: 'Hotkey already assigned to Study lamp',
        conflictEntityId: 'light.desk',
      });
    });

    it('falls back to the entity id when the entity has no custom name', () => {
      const { hotkeyConflictResult } = loadHelpers({
        config: { customEntityNames: { 'light.other': 'Other' } },
      });

      const result = hotkeyConflictResult('light.hall');

      expect(result.error).toBe('Hotkey already assigned to light.hall');
      expect(result.conflictEntityId).toBe('light.hall');
    });

    it('works when no names are configured at all', () => {
      const { hotkeyConflictResult } = loadHelpers({ config: {} });

      expect(hotkeyConflictResult('light.hall').error).toBe(
        'Hotkey already assigned to light.hall'
      );
    });

    it('says "another action" and an empty id when the holder is not known', () => {
      const { hotkeyConflictResult } = loadHelpers();

      expect(hotkeyConflictResult('')).toEqual({
        success: false,
        error: 'Hotkey already assigned to another action',
        conflictEntityId: '',
      });
      expect(hotkeyConflictResult(undefined).conflictEntityId).toBe('');
    });
  });

  describe('findConfiguredEntityHotkey', () => {
    const globalHotkeys = {
      hotkeys: {
        'light.desk': { hotkey: 'Ctrl+Alt+K', action: 'toggle' },
        'light.hall': 'Ctrl+Shift+H',
        'light.none': { action: 'toggle' },
      },
    };

    it('finds a chord however it is spelled, in the object and the legacy string format', () => {
      const { findConfiguredEntityHotkey } = loadHelpers({ config: { globalHotkeys } });

      expect(findConfiguredEntityHotkey('control+option+k')[0]).toBe('light.desk');
      expect(findConfiguredEntityHotkey('Ctrl+Shift+H')[0]).toBe('light.hall');
    });

    it('treats Command, Super and Win as the one Meta key', () => {
      const meta = {
        globalHotkeys: { hotkeys: { 'light.desk': { hotkey: 'Super+K', action: 'toggle' } } },
      };
      for (const platform of ['linux', 'win32', 'darwin']) {
        const { findConfiguredEntityHotkey } = loadHelpers({ platform, config: meta });

        expect(findConfiguredEntityHotkey('Command+K')?.[0]).toBe('light.desk');
        expect(findConfiguredEntityHotkey('Win+K')?.[0]).toBe('light.desk');
      }
    });

    it('does not count the entity being edited as its own conflict', () => {
      const { findConfiguredEntityHotkey } = loadHelpers({ config: { globalHotkeys } });

      expect(findConfiguredEntityHotkey('Ctrl+Alt+K', 'light.desk')).toBeNull();
      expect(findConfiguredEntityHotkey('Ctrl+Alt+K', 'light.hall')[0]).toBe('light.desk');
    });

    it('finds nothing for a free chord, an empty value or a row with no hotkey', () => {
      const { findConfiguredEntityHotkey } = loadHelpers({ config: { globalHotkeys } });

      expect(findConfiguredEntityHotkey('Ctrl+Alt+J')).toBeNull();
      expect(findConfiguredEntityHotkey('')).toBeNull();
      expect(findConfiguredEntityHotkey(undefined)).toBeNull();
    });

    it('leaves a chord free that a sensor holds from an earlier version, since it does nothing', () => {
      const { findConfiguredEntityHotkey } = loadHelpers({
        config: { globalHotkeys: { hotkeys: { 'sensor.office_temp': 'Ctrl+Alt+T' } } },
      });

      expect(findConfiguredEntityHotkey('Ctrl+Alt+T', 'light.desk')).toBeNull();
    });
  });

  describe('validateHotkey', () => {
    it('applies the shared rules for the platform main runs on', () => {
      const linux = loadHelpers({ platform: 'linux' });
      const windows = loadHelpers({ platform: 'win32' });

      expect(linux.validateHotkey('Ctrl+Alt+K')).toBe(true);
      expect(linux.validateHotkey('Shift+K')).toBe(false);
      expect(linux.validateHotkey('Ctrl+C')).toBe(false);
      expect(windows.validateHotkey('Win+L')).toBe(false);
      expect(linux.validateHotkey('Win+L')).toBe(true);
    });
  });
});
