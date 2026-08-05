/**
 * @jest-environment jsdom
 *
 * Boots the panel preview — the REAL renderer.js on the virtual desktop —
 * against the real widget markup extracted from index.html, and proves the
 * app's own wiring (settings modal included) works without Electron.
 */

const fs = require('fs');
const path = require('path');

const { extractWidgetSkeleton, resolveViteCli } = require('../../scripts/build-panel.cjs');

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

const PROFILE_DOCUMENT = {
  ui: { theme: 'dark', accent: 'teal' },
  customTabs: [
    { id: 'office', name: 'Office', entityIds: ['light.living_room', 'sensor.temperature'] },
  ],
  activeTabId: 'office',
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('panel builds invoke the installed Vite CLI through Node', () => {
  const viteCli = resolveViteCli();
  expect(path.basename(viteCli)).toBe('vite.js');
  expect(fs.existsSync(viteCli)).toBe(true);
});

describe('panel preview virtual desktop', () => {
  let api;

  beforeAll(async () => {
    delete window.electronAPI;
    window.matchMedia ||= () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    window.ResizeObserver ||= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const indexHtml = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    document.body.innerHTML = extractWidgetSkeleton(indexHtml);
    require('../../preview/preview-main.js');
    for (let i = 0; i < 200 && !window.__hadwPreview; i += 1) await flush();
    api = window.__hadwPreview;
  }, 30000);

  test('the real renderer boots and installs the parent API', () => {
    expect(api?.ready).toBe(true);
    expect(document.getElementById('settings-modal')).toBeTruthy();
  });

  test('profile plus states render real tiles', async () => {
    api.setStates(STATES);
    await api.applyProfile(PROFILE_DOCUMENT);
    await flush();
    const tileIds = [...document.querySelectorAll('#quick-controls .control-item')].map(
      (tile) => tile.dataset.entityId
    );
    expect(tileIds).toEqual(expect.arrayContaining(['light.living_room', 'sensor.temperature']));
    expect(document.body.dataset.accent).toBe('teal');
  });

  test("the app's own settings button opens the real settings modal", async () => {
    document.getElementById('settings-btn').click();
    await flush();
    expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
  });

  test('config edits flow through the app pipeline and reach the parent', async () => {
    const changes = [];
    api.onDocumentChange = (doc) => changes.push(doc);
    const result = await window.electronAPI.updateConfig({ ui: { theme: 'light' } });
    expect(result.success).toBe(true);
    await flush();
    expect(changes.at(-1).ui.theme).toBe('light');
    expect(api.getDocument().ui.theme).toBe('light');
  });

  test('editing mutates the active page through the app pipeline', async () => {
    await api.applyProfile(PROFILE_DOCUMENT);
    await flush();
    api.setEditing(true);
    expect(api.addEntity('switch.fan')).toBe(true);
    await flush();
    expect(api.getDocument().customTabs[0].entityIds).toContain('switch.fan');
    expect(api.removeEntity('switch.fan')).toBe(true);
    await flush();
    expect(api.getDocument().customTabs[0].entityIds).not.toContain('switch.fan');
    api.setEditing(false);
  });
});
