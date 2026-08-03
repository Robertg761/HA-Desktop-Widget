/**
 * @jest-environment jsdom
 *
 * Boots the panel preview against the real ui.js renderer and the real widget
 * skeleton (extracted from index.html exactly like the panel build does), and
 * proves the preview surface renders without any Electron API present.
 */

const fs = require('fs');
const path = require('path');

const { extractWidgetSkeleton } = require('../../scripts/build-panel.cjs');

const PROFILE_DOCUMENT = {
  ui: { theme: 'dark', accent: 'teal' },
  primaryCards: ['weather', 'time'],
  customTabs: [
    {
      id: 'office',
      name: 'Office',
      entityIds: ['light.living_room', 'sensor.temperature'],
    },
  ],
  activeTabId: 'office',
  opacity: 0.8,
  frostedGlass: false,
};

const STATES = {
  'light.living_room': {
    entity_id: 'light.living_room',
    state: 'on',
    attributes: { friendly_name: 'Living Room Light', brightness: 180 },
  },
  'sensor.temperature': {
    entity_id: 'sensor.temperature',
    state: '21.4',
    attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C' },
  },
};

describe('panel preview bootstrap', () => {
  let preview;

  beforeAll(() => {
    delete window.electronAPI;
    const indexHtml = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = extractWidgetSkeleton(indexHtml);
    preview = require('../../preview/preview-main.js');
  });

  test('skeleton extraction finds the widget surface', () => {
    expect(document.getElementById('quick-controls')).toBeTruthy();
    expect(document.getElementById('weather-card')).toBeTruthy();
    expect(document.getElementById('quick-access-tabs')).toBeTruthy();
  });

  test('initPreview installs the API without an Electron surface', () => {
    const api = preview.initPreview();
    expect(window.__hadwPreview).toBe(api);
    expect(api.ready).toBe(true);
  });

  test('applying a profile renders real tiles from real states', () => {
    preview.setStates(STATES);
    preview.applyProfile(PROFILE_DOCUMENT);

    const tiles = document.querySelectorAll('#quick-controls .control-item');
    const tileIds = [...tiles].map((tile) => tile.dataset.entityId);
    expect(tileIds).toEqual(expect.arrayContaining(['light.living_room', 'sensor.temperature']));
    expect(document.body.textContent).toContain('Living Room Light');
    expect(document.body.dataset.accent).toBe('teal');
  });

  test('entity updates patch the rendered tile in place', () => {
    preview.setStates(STATES);
    preview.applyProfile(PROFILE_DOCUMENT);
    window.__hadwPreview.setEntityState({
      entity_id: 'sensor.temperature',
      state: '25.9',
      attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C' },
    });
    const tile = document.querySelector('.control-item[data-entity-id="sensor.temperature"]');
    expect(tile.textContent).toContain('25.9');
  });

  test('preview host maps media specs to Home Assistant URLs', () => {
    const host = preview.createPreviewHost();
    preview.setStates({
      'camera.front': {
        entity_id: 'camera.front',
        state: 'idle',
        attributes: { entity_picture: '/api/camera_proxy/camera.front?token=abc' },
      },
    });
    expect(host.resolveMediaUrl({ kind: 'camera_snapshot', entityId: 'camera.front' })).toBe(
      '/api/camera_proxy/camera.front?token=abc'
    );
    expect(host.resolveMediaUrl({ kind: 'media_artwork', url: '/api/media/x.jpg' })).toBe(
      '/api/media/x.jpg'
    );
    expect(host.canPersistConfig).toBe(false);
  });
});
