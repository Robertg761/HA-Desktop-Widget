/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  ENTITY_HOTKEY_ACTIONS,
  ENTITY_HOTKEY_DOMAINS,
  liveEntityHotkeys,
  resolveEntityHotkeyAction,
  supportsEntityHotkey,
} = require('../../src/entity-hotkeys.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

describe('the entities a hotkey can act on', () => {
  it.each([
    'light.desk',
    'switch.kettle',
    'scene.movie_time',
    'script.good_night',
    'automation.porch_lights',
    'button.restart',
    'input_button.doorbell',
    'input_boolean.guest_mode',
    'fan.bedroom',
    // A tile's menu has added hotkeys to these since 3.4.8. A toggle opens or closes, or switches
    // them, as a click on the tile does; a lock's hotkey locks, or unlocks after asking.
    'cover.garage',
    'valve.garden',
    'lock.front',
    'humidifier.bedroom',
    'siren.hall',
  ])('takes %s, whose domain Settings has actions for', (entityId) => {
    expect(supportsEntityHotkey(entityId)).toBe(true);
  });

  it.each([
    'sensor.office_temp',
    'binary_sensor.front_door',
    'camera.porch',
    'media_player.living_room',
    'climate.hall',
    'timer.laundry',
    'weather.home',
  ])('refuses %s, where a toggle would do nothing', (entityId) => {
    expect(supportsEntityHotkey(entityId)).toBe(false);
  });

  it('takes no domain whose toggle a tile click would ignore', () => {
    const uiSource = fs.readFileSync(path.resolve(__dirname, '../../src/ui.js'), 'utf8');
    const start = uiSource.indexOf('function toggleEntity(');
    const toggle = uiSource.slice(start, uiSource.indexOf('default:', start));
    for (const domain of ENTITY_HOTKEY_DOMAINS) {
      expect(toggle).toContain(`case '${domain}':`);
    }
  });

  it('takes the domains that have actions, and only those', () => {
    expect(ENTITY_HOTKEY_DOMAINS).toEqual(Object.keys(ENTITY_HOTKEY_ACTIONS));
    for (const actions of Object.values(ENTITY_HOTKEY_ACTIONS)) {
      expect(actions.length).toBeGreaterThan(0);
      expect(Object.isFrozen(actions)).toBe(true);
    }
  });

  it('refuses anything that is not an entity id', () => {
    for (const value of ['', 'light', '.light', undefined, null, 42, { entity_id: 'light.a' }]) {
      expect(supportsEntityHotkey(value)).toBe(false);
    }
  });

  it('is the list the Settings hotkey page and main both read', () => {
    const hotkeysSource = fs.readFileSync(path.resolve(__dirname, '../../src/hotkeys.js'), 'utf8');
    expect(hotkeysSource).toContain('entityHotkeys.supportsEntityHotkey(e.entity_id)');
    expect(hotkeysSource).not.toMatch(/HOTKEY_SUPPORTED_DOMAINS/);
    expect(mainSource).toContain("require('./src/entity-hotkeys.cjs')");
    expect(Object.isFrozen(ENTITY_HOTKEY_DOMAINS)).toBe(true);
  });
});

describe('the action a hotkey runs', () => {
  it('is the one it was saved with, where its domain offers it', () => {
    expect(resolveEntityHotkeyAction('light.desk', 'brightness_up')).toBe('brightness_up');
    expect(resolveEntityHotkeyAction('lock.front', 'unlock')).toBe('unlock');
    expect(resolveEntityHotkeyAction('cover.garage', 'close')).toBe('close');
  });

  // A lock offers no toggle, so a toggle saved on one by an older version, or the bare accelerator
  // it saved before actions existed, locks. Unlocking is never what a forgotten hotkey does.
  it('locks for a toggle saved on a lock, or for none', () => {
    expect(resolveEntityHotkeyAction('lock.front', 'toggle')).toBe('lock');
    expect(resolveEntityHotkeyAction('lock.front', undefined)).toBe('lock');
  });

  it("is the domain's first otherwise, what a new hotkey runs", () => {
    expect(resolveEntityHotkeyAction('scene.movie', 'toggle')).toBe('turn_on');
    expect(resolveEntityHotkeyAction('light.desk', 'unlock')).toBe('toggle');
    expect(resolveEntityHotkeyAction('automation.porch', undefined)).toBe('trigger');
  });
});

describe("a tile menu's hotkey items", () => {
  const start = mainSource.indexOf('function entityTileHotkeyMenuItems(');
  const end = mainSource.indexOf("ipcMain.handle('show-entity-tile-menu'", start);

  const itemsFor = (entityId, hasHotkey) => {
    const requestHotkey = jest.fn();
    const context = { supportsEntityHotkey, mainT: (text) => text };
    vm.runInNewContext(mainSource.slice(start, end), context);
    const items = context.entityTileHotkeyMenuItems(entityId, hasHotkey, requestHotkey);
    return { labels: items.map((item) => item.label), items, requestHotkey };
  };

  it('is found in main, ahead of the menu that uses it', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = mainSource.slice(end, mainSource.indexOf('menu.popup(', end));
    expect(handler).toContain('entityTileHotkeyMenuItems(normalizedEntityId, hasHotkey');
    // No leading separator when a tile has no hotkey items at all.
    expect(handler).toContain("...(hotkeyItems.length ? [{ type: 'separator' }] : [])");
  });

  it('offers Add Hotkey on a light, and Edit and Remove once it has one', () => {
    expect(itemsFor('light.desk', false).labels).toEqual(['Add Hotkey']);
    expect(itemsFor('light.desk', true).labels).toEqual(['Edit Hotkey', 'Remove Hotkey']);
  });

  it('offers Add Hotkey on a garage door and a lock, as it did before 4.0', () => {
    expect(itemsFor('cover.garage', false).labels).toEqual(['Add Hotkey']);
    expect(itemsFor('lock.front', true).labels).toEqual(['Edit Hotkey', 'Remove Hotkey']);
  });

  it('offers nothing on a sensor, which a hotkey cannot act on', () => {
    expect(itemsFor('sensor.office_temp', false).labels).toEqual([]);
    expect(itemsFor('camera.porch', false).labels).toEqual([]);
  });

  it('still offers Remove on a sensor an earlier version gave a hotkey, so it can be cleared', () => {
    expect(itemsFor('sensor.office_temp', true).labels).toEqual(['Remove Hotkey']);
  });

  it('asks the renderer to record for Add and Edit, and to remove for Remove', () => {
    const { items, requestHotkey } = itemsFor('light.desk', true);
    items[0].click();
    items[1].click();
    expect(requestHotkey.mock.calls).toEqual([[false], [true]]);
  });
});

describe("main's register-hotkey handler", () => {
  it('refuses an entity a hotkey cannot act on before it takes the chord', () => {
    const start = mainSource.indexOf("'register-hotkey',");
    const handler = mainSource.slice(start, mainSource.indexOf("'unregister-hotkey',", start));
    const refusal = handler.indexOf('if (!supportsEntityHotkey(normalizedEntityId))');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(
      handler.indexOf('config.globalHotkeys.hotkeys[normalizedEntityId] =')
    );
    expect(handler).toContain("mainT('Hotkeys cannot control this kind of entity')");
  });
});

describe('a hotkey an earlier version saved on an entity it cannot act on', () => {
  const { acceleratorsConflict } = require('../../src/accelerators.cjs');
  const between = (from, to) => {
    const start = mainSource.indexOf(from);
    const end = mainSource.indexOf(to, start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return mainSource.slice(start, end);
  };
  const hotkeys = {
    'sensor.office_temp': 'Ctrl+Alt+T',
    'camera.porch': { hotkey: 'Ctrl+Alt+P', action: 'toggle' },
    'light.desk': { hotkey: 'Ctrl+Alt+D', action: 'turn_on' },
    'switch.kettle': 'Ctrl+Alt+K',
  };
  const mainWith = () => {
    const context = {
      config: { globalHotkeys: { enabled: true, hotkeys }, popupHotkey: '' },
      liveEntityHotkeys,
      resolveEntityHotkeyAction,
      acceleratorsConflict,
      process: { platform: 'linux' },
      mainT: (text, vars = {}) => text.replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name]),
      portalShortcutsActive: false,
      hasLegacyGlobalShortcutFallback: true,
      registeredEntityHotkeyAccelerators: new Set(),
      globalShortcut: { register: jest.fn(() => true), unregister: jest.fn() },
      mainWindow: { isDestroyed: () => false, webContents: { send: jest.fn() } },
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      Date,
    };
    vm.runInNewContext(
      [
        "const PORTAL_ENTITY_SHORTCUT_PREFIX = 'entity.';",
        "const PORTAL_POPUP_SHORTCUT_ID = 'popup-toggle';",
        between('function registerGlobalHotkeys()', 'function validateHotkey('),
        between('function findConfiguredEntityHotkey(', '// Popup Hotkey Management'),
        between('function collectPortalShortcuts()', 'function reportPortalShortcutSyncResult('),
        between('function handlePortalShortcutActivated(', '// Hyprland binds name the portal'),
        'this.api = { registerGlobalHotkeys, findConfiguredEntityHotkey, collectPortalShortcuts, handlePortalShortcutActivated };',
      ].join('\n'),
      context
    );
    return { ...context.api, context };
  };

  it('is the list main reads, and leaves out what cannot act', () => {
    expect(liveEntityHotkeys(hotkeys)).toEqual([
      ['light.desk', { hotkey: 'Ctrl+Alt+D', action: 'turn_on' }],
      ['switch.kettle', { hotkey: 'Ctrl+Alt+K', action: 'toggle' }],
    ]);
    expect(liveEntityHotkeys({ 'light.a': '  ', 'light.b': null, 'light.c': {} })).toEqual([]);
    expect(liveEntityHotkeys(undefined)).toEqual([]);
  });

  it('is not registered as a global shortcut', () => {
    const { registerGlobalHotkeys, context } = mainWith();
    expect(registerGlobalHotkeys()).toMatchObject({ success: true });
    expect(context.globalShortcut.register.mock.calls.map(([accelerator]) => accelerator)).toEqual([
      'Ctrl+Alt+D',
      'Ctrl+Alt+K',
    ]);
  });

  it('is not bound through the desktop portal, and a stale portal session cannot fire it', () => {
    const { collectPortalShortcuts, handlePortalShortcutActivated, context } = mainWith();
    expect(collectPortalShortcuts().map((shortcut) => shortcut.id)).toEqual([
      'entity.light.desk',
      'entity.switch.kettle',
    ]);

    handlePortalShortcutActivated('entity.sensor.office_temp');
    expect(context.mainWindow.webContents.send).not.toHaveBeenCalled();
    handlePortalShortcutActivated('entity.light.desk');
    expect(context.mainWindow.webContents.send).toHaveBeenCalledWith('hotkey-triggered', {
      entityId: 'light.desk',
      hotkey: 'Ctrl+Alt+D',
      action: 'turn_on',
    });
  });

  it('does not hold its chord against another entity or the popup', () => {
    const { findConfiguredEntityHotkey } = mainWith();
    expect(findConfiguredEntityHotkey('Ctrl+Alt+T', 'light.desk')).toBeNull();
    expect(findConfiguredEntityHotkey('Ctrl+Alt+T')).toBeNull();
    expect(findConfiguredEntityHotkey('Ctrl+Alt+P')).toBeNull();
    // A hotkey that can act still does.
    expect(findConfiguredEntityHotkey('Ctrl+Alt+K', 'light.desk')?.[0]).toBe('switch.kettle');
  });
});
