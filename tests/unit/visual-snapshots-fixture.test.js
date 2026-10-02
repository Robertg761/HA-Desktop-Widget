/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const {
  PAGE_SETS,
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
          .filter((entityId) => !entityIds.has(entityId))
          .map((entityId) => `${setName}/${page.id}: ${entityId}`)
      )
    );
    expect(unknown).toEqual([]);
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

  it('covers the states the audit found broken', () => {
    const names = scenes.map((scene) => scene.name);
    for (const required of [
      'popup-brightness-light',
      'popup-climate-light',
      'popup-input-number',
      'popup-alarm-code',
      'dialog-manage-quick-access',
      'de-main',
      'de-edit-mode',
      'ar-main',
      'ar-settings-general',
      'narrow-main',
      'forced-colors-main',
      'forced-colors-popup',
      'six-tabs',
      'media-tile',
      'pin-light',
      'pin-light-long',
      'pin-de-cover',
      'pin-fr-climate',
      'pin-ar-light',
      'pin-large-climate',
      'pin-theme-light-climate',
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
});
