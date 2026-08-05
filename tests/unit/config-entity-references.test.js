/**
 * @jest-environment node
 */

const { replaceConfigEntityIdReferences } = require('../../src/config-entity-references.cjs');
const fs = require('fs');
const path = require('path');

describe('replaceConfigEntityIdReferences', () => {
  const oldEntityId = 'light.old_lamp';
  const newEntityId = 'light.desk_lamp';

  it('replaces every supported entity reference without changing the input snapshot', () => {
    const config = {
      homeAssistant: { url: 'http://ha.local', token: 'secret' },
      opacity: 0.73,
      primaryMediaPlayer: oldEntityId,
      selectedWeatherEntity: oldEntityId,
      favoriteEntities: [oldEntityId, newEntityId, 'sensor.room'],
      customTabs: [
        { id: 'main', entityIds: [oldEntityId, newEntityId] },
        { id: 'legacy', entities: [oldEntityId] },
      ],
      comparisonGraphs: [{ id: 'graph-1', entityIds: [oldEntityId, 'sensor.room'] }],
      primaryCards: [oldEntityId, 'time'],
      desktopPins: { [oldEntityId]: { x: 10, y: 20 } },
      customEntityNames: { [oldEntityId]: 'Old Lamp' },
      customEntityIcons: { [oldEntityId]: 'mdi:lamp' },
      tileSpans: { [oldEntityId]: 2 },
      quickAccessTileOptions: { [oldEntityId]: { valueSize: 'large' } },
      globalHotkeys: {
        enabled: true,
        hotkeys: { [oldEntityId]: { hotkey: 'Ctrl+1', action: 'toggle' } },
      },
      entityAlerts: {
        enabled: true,
        alerts: { [oldEntityId]: { condition: 'on' } },
      },
    };

    const result = replaceConfigEntityIdReferences(config, oldEntityId, newEntityId);

    expect(result.changed).toBe(true);
    expect(result.config).not.toBe(config);
    expect(config.favoriteEntities).toEqual([oldEntityId, newEntityId, 'sensor.room']);
    expect(result.config).toMatchObject({
      opacity: 0.73,
      primaryMediaPlayer: newEntityId,
      selectedWeatherEntity: newEntityId,
      favoriteEntities: [newEntityId, 'sensor.room'],
      primaryCards: [newEntityId, 'time'],
      desktopPins: { [newEntityId]: { x: 10, y: 20 } },
      customEntityNames: { [newEntityId]: 'Old Lamp' },
      customEntityIcons: { [newEntityId]: 'mdi:lamp' },
      tileSpans: { [newEntityId]: 2 },
      quickAccessTileOptions: { [newEntityId]: { valueSize: 'large' } },
      globalHotkeys: {
        enabled: true,
        hotkeys: { [newEntityId]: { hotkey: 'Ctrl+1', action: 'toggle' } },
      },
      entityAlerts: {
        enabled: true,
        alerts: { [newEntityId]: { condition: 'on' } },
      },
    });
    expect(result.config.customTabs).toEqual([
      { id: 'main', entityIds: [newEntityId] },
      { id: 'legacy', entityIds: [newEntityId] },
    ]);
    expect(result.config.comparisonGraphs[0].entityIds).toEqual([newEntityId, 'sensor.room']);
  });

  it('preserves unrelated authoritative changes and existing destination-key settings', () => {
    const latestAuthoritativeConfig = {
      homeAssistant: { url: 'http://ha.local' },
      ui: { theme: 'dark' },
      favoriteEntities: [oldEntityId],
      customEntityNames: {
        [oldEntityId]: 'Stale Name',
        [newEntityId]: 'Current Name',
      },
    };

    const result = replaceConfigEntityIdReferences(
      latestAuthoritativeConfig,
      oldEntityId,
      newEntityId
    );

    expect(result.config.ui).toEqual({ theme: 'dark' });
    expect(result.config.favoriteEntities).toEqual([newEntityId]);
    expect(result.config.customEntityNames).toEqual({ [newEntityId]: 'Current Name' });
  });

  it('returns the original snapshot when no references exist', () => {
    const config = { favoriteEntities: ['sensor.room'] };
    expect(replaceConfigEntityIdReferences(config, oldEntityId, newEntityId)).toEqual({
      config,
      changed: false,
    });
  });

  it('wires replacement through the main-process serialized config mutation queue', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
    const handlerStart = mainSource.indexOf("'replace-config-entity-id'");
    const handlerEnd = mainSource.indexOf("'update-config'", handlerStart);
    const handler = mainSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handler).toContain('serializeConfigMutationHandler(async');
    expect(handler).toContain('replaceConfigEntityIdReferences(config, oldEntityId, newEntityId)');
  });
});
