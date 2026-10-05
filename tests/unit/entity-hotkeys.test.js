/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { ENTITY_HOTKEY_DOMAINS, supportsEntityHotkey } = require('../../src/entity-hotkeys.cjs');

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
  ])('takes %s, whose domain Settings has actions for', (entityId) => {
    expect(supportsEntityHotkey(entityId)).toBe(true);
  });

  it.each([
    'sensor.office_temp',
    'binary_sensor.front_door',
    'camera.porch',
    'media_player.living_room',
    'climate.hall',
    'cover.garage',
    'lock.front',
    'timer.laundry',
    'weather.home',
  ])('refuses %s, where a toggle would do nothing or skip its confirmation', (entityId) => {
    expect(supportsEntityHotkey(entityId)).toBe(false);
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

  it('offers nothing on a sensor, which a hotkey cannot act on', () => {
    expect(itemsFor('sensor.office_temp', false).labels).toEqual([]);
    expect(itemsFor('camera.porch', false).labels).toEqual([]);
  });

  it('still offers Remove on a sensor an earlier version gave a hotkey, so its chord can be freed', () => {
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
