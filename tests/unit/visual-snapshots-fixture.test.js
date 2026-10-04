/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const {
  PAGE_SETS,
  RESETTABLE_SETTINGS,
  WINDOW_POSITION,
  WINDOW_SIZE,
  buildConfig,
  buildServices,
  buildStates,
} = require('../../scripts/visual-snapshots/fixture.cjs');
const { scenes } = require('../../scripts/visual-snapshots/scenes.cjs');
const {
  DESKTOP_PIN_SUPPORTED_FAMILIES,
  resolveDesktopPinProfile,
} = require('../../src/desktop-pin-support.cjs');

describe('visual snapshot fixture', () => {
  const entityIds = new Set(buildStates().map((state) => state.entity_id));

  it('only puts entities the mock Home Assistant knows on its pages', () => {
    const unknown = Object.entries(PAGE_SETS).flatMap(([setName, pages]) =>
      pages.flatMap((page) =>
        page.entityIds
          // A comparison graph is not an entity; the scene brings its definition.
          .filter((entityId) => !entityId.startsWith('graph:') && !entityIds.has(entityId))
          .map((entityId) => `${setName}/${page.id}: ${entityId}`)
      )
    );
    // The dialogs page keeps one favourite Home Assistant no longer has: the repair picker's tile.
    expect(unknown).toEqual(['dialogs/default: light.old_kitchen']);
  });

  it('starts on a page set that has the page it activates', () => {
    const config = buildConfig('http://127.0.0.1:1');
    expect(config.customTabs.map((page) => page.id)).toContain(config.activeTabId);
    expect(config.primaryMediaPlayer && entityIds.has(config.primaryMediaPlayer)).toBe(true);
    expect(config.ui.followOmarchy).toBe(false);
    expect(config.omarchyThemeDefaultApplied).toBe(true);
  });

  it('opens a window that fits a 1024x768 display above a 48px taskbar', () => {
    expect(WINDOW_POSITION.x + WINDOW_SIZE.width).toBeLessThanOrEqual(1024);
    expect(WINDOW_POSITION.y + WINDOW_SIZE.height).toBeLessThanOrEqual(768 - 48);
  });

  it('offers the services the command palette needs for the alarm panel', () => {
    expect(Object.keys(buildServices().alarm_control_panel)).toEqual(
      expect.arrayContaining(['alarm_disarm', 'alarm_arm_home'])
    );
  });

  it('lists more entities than one Manage Quick Access page shows', () => {
    expect(entityIds.size).toBeGreaterThan(50);
  });
});

describe('visual snapshot scenes', () => {
  it('has unique, file-name safe names', () => {
    const names = scenes.map((scene) => scene.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('leaves the scenes that change unrestored settings to the end', () => {
    const changesMore = (scene) =>
      Object.keys(scene.config || {}).some((key) => !RESETTABLE_SETTINGS.includes(key));
    const firstIndex = scenes.findIndex(changesMore);

    expect(firstIndex).toBeGreaterThan(0);
    // Everything after the first such scene changes them too, so no scene starts from a state an
    // earlier one left behind.
    expect(scenes.slice(firstIndex).every(changesMore)).toBe(true);
  });

  it('activates pages that exist in the page set it brings', () => {
    for (const scene of scenes.filter((entry) => entry.config?.customTabs)) {
      expect(scene.config.customTabs.map((page) => page.id)).toContain(scene.config.activeTabId);
    }
  });

  it('only asks for languages that ship with the app or a repository pack', () => {
    const bundled = fs
      .readdirSync(path.resolve(__dirname, '../../locales'))
      .map((file) => path.basename(file, '.json'));
    const packs = fs
      .readdirSync(path.resolve(__dirname, '../../locale-packs'))
      .map((file) => path.basename(file, '.json'));
    for (const language of scenes.map((scene) => scene.ui?.language).filter(Boolean)) {
      expect([...bundled, ...packs]).toContain(language);
    }
  });

  it('installs the repository pack of every language a scene asks for that is not bundled', () => {
    // A scene in a language whose pack is not in the profile would fall back to English and look
    // like a translation that does nothing.
    const runner = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/visual-snapshots/run.cjs'),
      'utf8'
    );
    const installed = [
      ...runner.match(/INSTALLED_PACKS = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g),
    ].map((match) => match[1]);
    const bundled = fs
      .readdirSync(path.resolve(__dirname, '../../locales'))
      .map((file) => path.basename(file, '.json'));
    for (const language of new Set(scenes.map((scene) => scene.ui?.language).filter(Boolean))) {
      expect(bundled.includes(language) || installed.includes(language)).toBe(true);
    }
  });

  it('covers the states the audit found broken', () => {
    const names = scenes.map((scene) => scene.name);
    for (const required of [
      'popup-brightness-light',
      'popup-climate-light',
      'popup-input-number',
      'popup-input-select',
      'popup-vacuum',
      'popup-todo',
      'popup-calendar',
      'popup-repair',
      'popup-alarm-code',
      'dialog-manage-quick-access',
      'de-main',
      'de-edit-mode',
      'ar-main',
      'ar-settings-general',
      'ar-popup-brightness',
      'ar-popup-colour',
      'ar-edit-mode',
      'ar-palette',
      'ar-settings-appearance',
      'ar-settings-appearance-custom',
      'ar-dialog-notifications',
      'ar-dialog-diagnostics',
      'hi-main',
      'hi-settings-appearance',
      'zh-main',
      'pin-ar-light-long',
      'narrow-main',
      'forced-colors-main',
      'forced-colors-popup',
      'forced-colors-popup-climate',
      'forced-colors-popup-colour',
      'forced-colors-settings-appearance',
      'forced-colors-light-main',
      'forced-colors-light-popup-climate',
      'readable-main',
      'readable-light-main',
      'readable-light-popup-climate',
      'readable-settings-appearance',
      'readable-settings-general',
      'readable-edit-mode',
      'readable-popup-brightness',
      'readable-popup-climate',
      'readable-popup-colour',
      'readable-popup-fan',
      'readable-pin-light',
      'readable-pin-climate',
      'readable-pin-cover',
      'readable-pin-fan',
      'six-tabs',
      'media-tile',
      'pin-light',
      'pin-light-long',
      'pin-de-cover',
      'pin-fr-climate',
      'pin-ar-light',
      'pin-large-climate',
      'pin-theme-light-climate',
      'focus-settings-opens-on-tab',
      'focus-settings-rail-label',
      'focus-settings-opacity-slider',
      'focus-confirm-unsaved-color',
      'focus-weather-card',
      'focus-weather-picker',
      'focus-command-palette',
      'focus-tile-settings',
      'toast-error-over-settings',
      'toast-reorganize-notice',
    ]) {
      expect(names).toContain(required);
    }
    const narrow = scenes.find((scene) => scene.name === 'narrow-main');
    expect(narrow.size.width).toBeLessThanOrEqual(345);
    expect(scenes.find((scene) => scene.name === 'forced-colors-main').media).toEqual([
      { name: 'forced-colors', value: 'active' },
    ]);
  });

  it('shows every desktop pin family it can pin, and only pins entities the fixture holds', () => {
    const states = new Map(buildStates().map((entity) => [entity.entity_id, entity]));
    const families = new Set();
    for (const scene of scenes.filter((entry) => entry.pin)) {
      expect(states.has(scene.pin)).toBe(true);
      families.add(resolveDesktopPinProfile(states.get(scene.pin)).family);
    }
    expect([...families].sort()).toEqual(
      [...DESKTOP_PIN_SUPPORTED_FAMILIES].filter((family) => family !== 'unsupported').sort()
    );
  });

  it('puts every pinned entity on a page the scene shows, since only those can be pinned', () => {
    for (const scene of scenes.filter((entry) => entry.pin)) {
      const pages = scene.config?.customTabs || PAGE_SETS.default;
      expect(pages.some((page) => page.entityIds.includes(scene.pin))).toBe(true);
    }
  });

  it('shows forced colours on a light contrast theme too', () => {
    for (const scene of scenes.filter((entry) => entry.name.startsWith('forced-colors-light-'))) {
      expect(scene.ui.theme).toBe('light');
      expect(scene.media).toEqual(
        expect.arrayContaining([
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: 'light' },
        ])
      );
    }
  });

  it('shows the Readable preset over both themes', () => {
    for (const scene of scenes.filter((entry) => entry.name.startsWith('readable-'))) {
      expect(scene.ui).toMatchObject({ highContrast: true, opaquePanels: true });
    }
    expect(scenes.find((scene) => scene.name === 'readable-light-main').ui.theme).toBe('light');
  });

  it('puts back every interface setting a scene changes', () => {
    // The runner merges a scene's interface settings over the app's, so a setting the fixture does
    // not name keeps the last scene's value: the Readable scenes made every later scene Readable.
    const base = buildConfig('http://127.0.0.1:1').ui;
    const changed = new Set(scenes.flatMap((scene) => Object.keys(scene.ui || {})));
    expect([...changed].filter((key) => !(key in base))).toEqual([]);
    expect(base).toMatchObject({ highContrast: false, opaquePanels: false });
  });

  it('has a light with colour controls for the colour pop-up', () => {
    const colourStrip = buildStates().find((state) => state.entity_id === 'light.colour_strip');
    expect(colourStrip.attributes.supported_color_modes).toEqual(
      expect.arrayContaining(['color_temp', 'hs'])
    );
    const scene = scenes.find((entry) => entry.name === 'forced-colors-popup-colour');
    const page = PAGE_SETS.default.find((entry) => entry.id === scene.config.activeTabId);
    expect(page.entityIds).toContain('light.colour_strip');
  });
});
