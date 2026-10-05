/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const {
  FAILING_ENTITIES,
  PAGE_SETS,
  RESETTABLE_SETTINGS,
  WINDOW_POSITION,
  WINDOW_SIZE,
  buildConfig,
  buildHistories,
  buildLandingLights,
  buildServices,
  buildStates,
  buildUnavailableDevices,
} = require('../../scripts/visual-snapshots/fixture.cjs');
const { scenes } = require('../../scripts/visual-snapshots/scenes.cjs');
const { LIST_PAGE_SIZE } = require('../../src/list-pager.js');
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

  it('keeps a home of more lights than one Hotkeys page holds out of the fixture itself', () => {
    const landing = buildLandingLights();

    // Alone they run past a page, whatever else the home has ...
    expect(landing.length).toBeGreaterThan(LIST_PAGE_SIZE);
    expect(new Set(landing.map((light) => light.entity_id)).size).toBe(landing.length);
    expect(landing.every((light) => light.entity_id.startsWith('light.'))).toBe(true);
    expect(landing.every((light) => light.attributes.friendly_name)).toBe(true);
    // ... and the fixture's own lists, which every other scene shows, do not carry them.
    expect(landing.some((light) => entityIds.has(light.entity_id))).toBe(false);
    expect(
      [...entityIds].filter((entityId) => /^(light|switch|fan)\./.test(entityId)).length
    ).toBeLessThan(LIST_PAGE_SIZE);
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
    // A start-up scene runs on an app of its own, so where it sits in the list changes nothing.
    const shared = scenes.filter((scene) => !scene.startup);
    const firstIndex = shared.findIndex(changesMore);

    expect(firstIndex).toBeGreaterThan(0);
    // Everything after the first such scene changes them too, so no scene starts from a state an
    // earlier one left behind.
    expect(shared.slice(firstIndex).every(changesMore)).toBe(true);
  });

  it('gives the scenes that bring entities of their own a function that builds them', () => {
    const withStates = scenes.filter((scene) => 'extraStates' in scene);
    const fixtureIds = new Set(buildStates().map((entity) => entity.entity_id));

    expect(withStates.map((scene) => scene.name)).toContain('settings-hotkeys-page-2');
    for (const scene of withStates) {
      const brought = scene.extraStates(new Date());
      expect(brought.length).toBeGreaterThan(0);
      // Nothing the fixture holds is replaced, so taking the entities away puts the home back.
      expect(brought.filter((entity) => fixtureIds.has(entity.entity_id))).toEqual([]);
    }
  });

  it('brings an unreachable light and cover whose tiles the scenes open', () => {
    const brought = buildUnavailableDevices(new Date());

    expect(brought.map((entity) => [entity.entity_id, entity.state])).toEqual([
      ['light.hall', 'unavailable'],
      ['cover.side_gate', 'unavailable'],
    ]);
    for (const name of ['popup-light-unavailable', 'popup-cover-unavailable']) {
      const scene = scenes.find((entry) => entry.name === name);
      const tiles = scene.config.customTabs.find(
        (page) => page.id === scene.config.activeTabId
      ).entityIds;
      expect(tiles).toEqual(brought.map((entity) => entity.entity_id));
    }
  });

  it('puts the page back after a scene that rewrote its stylesheet', () => {
    // The runner restores settings, dialogs, media and the window size, not the page's own
    // stylesheet, so a scene that switches the coarse-pointer block on has to switch it off again.
    const touch = scenes.filter((scene) => scene.name.startsWith('coarse-pointer-'));

    expect(touch.length).toBeGreaterThan(0);
    for (const scene of touch) expect(typeof scene.teardown).toBe('function');
  });

  it('shows the Hotkeys list on a later page, in a home with the lights for one', () => {
    const scene = scenes.find((entry) => entry.name === 'settings-hotkeys-page-2');

    // The list is drawn only while Entity hotkeys is on.
    expect(scene.config.globalHotkeys.enabled).toBe(true);
    expect(scene.extraStates(new Date()).length).toBeGreaterThan(LIST_PAGE_SIZE);
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
      'ar-settings-alerts',
      'ar-settings-language-packs',
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
      'pin-light-onoff',
      'pin-switch',
      'pin-climate-200x170',
      'pin-fan-200x170',
      'pin-cover-200x170',
      'pin-weather-200x170',
      'pin-climate-240x180',
      'pin-weather-240x180',
      'pin-climate-range',
      'pin-climate-range-200x170',
      'pin-de-climate-185x158',
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
      'tiles-security',
      'tiles-security-light',
      'tiles-glow-off',
      'graph-hover-left',
      'graph-hover-right',
      'notifications-markdown',
      'popup-media-long-title',
      'popup-cover-no-position',
      'popup-light-rgb',
      'popup-climate-unavailable',
      'format-main',
      'format-main-de',
      'format-main-ar',
      'format-palette-fr',
      'startup-first-run',
      'startup-first-run-ar-system',
      'startup-token-unreadable',
      'startup-token-unreadable-settings',
      'startup-token-not-saved',
      'startup-oauth-reauth',
      'startup-oauth-keyring',
      'wizard-welcome-ar',
      'wizard-welcome-minimum',
      'wizard-welcome-s150',
      'wizard-welcome-forced-colors',
      'wizard-authorize-error',
      'wizard-authorize-keyring',
    ]) {
      expect(names).toContain(required);
    }
    const narrow = scenes.find((scene) => scene.name === 'narrow-main');
    expect(narrow.size.width).toBeLessThanOrEqual(345);
    expect(scenes.find((scene) => scene.name === 'forced-colors-main').media).toEqual([
      { name: 'forced-colors', value: 'active' },
    ]);
  });

  describe('the start-ups each scene starts its own app on', () => {
    const base = buildConfig('http://127.0.0.1:8123');
    const startup = (name) => scenes.find((scene) => scene.name === name).startup.config(base);

    it('is a first install with nothing saved but the window and the seasons off', () => {
      const config = startup('startup-first-run');
      expect(config.homeAssistant).toBeUndefined();
      expect(config.ui).toEqual({ seasonal: { enabled: false } });
      expect(startup('startup-first-run-ar-system')).toEqual(config);
    });

    it('keeps the server and dashboard of an existing setup whose token cannot be used', () => {
      const unreadable = startup('startup-token-unreadable');
      expect(unreadable.customTabs).toEqual(base.customTabs);
      expect(unreadable.homeAssistant.tokenEncrypted).toBe(true);
      expect(unreadable.homeAssistant.token).not.toBe(base.homeAssistant.token);

      const notSaved = startup('startup-token-not-saved');
      expect(notSaved.homeAssistant.url).toBe(base.homeAssistant.url);
      expect(notSaved.homeAssistant.token).toBeUndefined();
      expect(notSaved.tokenResetReason).toBe('not_persisted');

      const oauth = startup('startup-oauth-reauth');
      expect(oauth.homeAssistant).toEqual({ url: base.homeAssistant.url, authMethod: 'oauth' });
      expect(startup('startup-oauth-keyring')).toEqual(oauth);
    });
  });

  it('names only platforms Node knows', () => {
    for (const scene of scenes.filter((entry) => entry.platforms)) {
      for (const platform of scene.platforms) {
        expect(['darwin', 'linux', 'win32']).toContain(platform);
      }
    }
  });

  it('captures the failed authorization step once on every system, by the failure it can stage', () => {
    const failures = scenes.filter((scene) =>
      ['wizard-authorize-error', 'wizard-authorize-keyring'].includes(scene.name)
    );
    expect(failures.flatMap((scene) => scene.platforms).sort()).toStrictEqual([
      'darwin',
      'linux',
      'win32',
    ]);
  });

  it('captures a browser authorization with nothing saved once on every system', () => {
    const startups = scenes.filter((scene) =>
      ['startup-oauth-reauth', 'startup-oauth-keyring'].includes(scene.name)
    );
    expect(startups.flatMap((scene) => scene.platforms).sort()).toStrictEqual([
      'darwin',
      'linux',
      'win32',
    ]);
  });

  it('has a page of readings for the format scenes, with a pack installed for each language', () => {
    const formats = PAGE_SETS.formats.flatMap((page) => page.entityIds);
    const states = new Map(buildStates().map((entity) => [entity.entity_id, entity]));
    // Each kind of text the formatter writes is on the page: a Fahrenheit reading, a value below
    // zero, two timestamps, a duration, device class words, a paused timer and a free-form select.
    expect(states.get('sensor.pool_temp').attributes.unit_of_measurement).toBe('°F');
    expect(Number(states.get('sensor.cold_room').state)).toBeLessThan(0);
    expect(states.get('sensor.last_boot').attributes.device_class).toBe('timestamp');
    expect(states.get('sensor.next_dawn').attributes.device_class).toBe('timestamp');
    expect(states.get('sensor.uptime').attributes.device_class).toBe('duration');
    expect(states.get('binary_sensor.router').attributes.device_class).toBe('connectivity');
    expect(states.get('timer.tea').state).toBe('paused');
    expect(formats).toEqual(expect.arrayContaining(['select.heating_mode', 'calendar.bins']));
    const runner = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/visual-snapshots/run.cjs'),
      'utf8'
    );
    for (const language of ['de', 'ar']) {
      const scene = scenes.find((entry) => entry.name === `format-main-${language}`);
      expect(scene.ui.language).toBe(language);
      // German is bundled; Arabic needs the repository's pack installed in the profile.
      if (language !== 'de')
        expect(runner).toMatch(new RegExp(`INSTALLED_PACKS = \\[[^\\]]*'${language}'`));
    }
  });

  it('shows every desktop pin family it can pin, and only pins entities the home holds', () => {
    const fixtureStates = buildStates();
    const families = new Set();
    for (const scene of scenes.filter((entry) => entry.pin)) {
      // A scene may pin an entity it brings itself.
      const states = new Map(
        [...fixtureStates, ...(scene.extraStates?.(new Date()) || [])].map((entity) => [
          entity.entity_id,
          entity,
        ])
      );
      expect(states.has(scene.pin)).toBe(true);
      families.add(resolveDesktopPinProfile(states.get(scene.pin)).family);
    }
    expect([...families].sort()).toEqual(
      [...DESKTOP_PIN_SUPPORTED_FAMILIES].filter((family) => family !== 'unsupported').sort()
    );
  });

  it('pins a light that only switches, whose pin has no brightness to show', () => {
    const scene = scenes.find((entry) => entry.name === 'pin-light-onoff');
    const [light] = scene.extraStates(new Date());

    expect(light.entity_id).toBe(scene.pin);
    expect(light.attributes.supported_color_modes).toEqual(['onoff']);
  });

  it('pins a heat/cool thermostat, whose two sliders crowd a pin more than one target does', () => {
    const heatPump = buildStates().find((entity) => entity.entity_id === 'climate.heat_pump');
    expect(heatPump.attributes).toMatchObject({
      target_temp_low: expect.any(Number),
      target_temp_high: expect.any(Number),
    });
    for (const name of ['pin-climate-range', 'pin-climate-range-200x170']) {
      expect(scenes.find((entry) => entry.name === name).pin).toBe('climate.heat_pump');
    }
    // German's mode names are the longest a pin a little past the default size has to fit.
    expect(scenes.find((entry) => entry.name === 'pin-de-climate-185x158').ui.language).toBe('de');
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

  it('shows the dashboard-state scenes the tiles and dialogs were fixed for', () => {
    const states = new Map(buildStates().map((entity) => [entity.entity_id, entity]));
    const pageOf = (scene) => scene.config?.customTabs || PAGE_SETS.default;
    // A lock in each state a tile treats differently, an alarm that went off, a TV that is 'on'.
    expect(states.get('lock.front_door').state).toBe('unlocked');
    expect(states.get('lock.shed').state).toBe('jammed');
    expect(states.get('alarm_control_panel.cabin').state).toBe('triggered');
    expect(states.get('media_player.tv_on').state).toBe('on');
    expect(states.get('cover.garage_simple').attributes.current_position).toBeUndefined();
    expect(states.get('light.rgb_strip').attributes.color_mode).toBe('rgb');
    const glowOff = scenes.find((scene) => scene.name === 'tiles-glow-off');
    expect(glowOff.ui.activeTileGlow).toBe(false);
    expect(pageOf(glowOff).flatMap((page) => page.entityIds)).toEqual(
      expect.arrayContaining(['media_player.tv_on', 'light.desk_lamp'])
    );
    for (const name of [
      'popup-cover-no-position',
      'popup-light-rgb',
      'popup-climate-unavailable',
    ]) {
      const scene = scenes.find((entry) => entry.name === name);
      const page = scene.config.customTabs.find((entry) => entry.id === scene.config.activeTabId);
      expect(page.entityIds.length).toBeGreaterThan(0);
    }
  });

  it('fills the notifications panel in no scene by hand', () => {
    // Rows, a count and a footer written by a scene are not what the app draws, so they can hide a
    // regression; the scenes that open the panel show all of them over the real subscription.
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/visual-snapshots/scenes.cjs'),
      'utf8'
    );
    expect(source).not.toMatch(/persistent-notifications-(list|summary|toolbar|empty)/);
    expect(scenes.map((scene) => scene.name)).toEqual(
      expect.arrayContaining(['notifications-markdown', 'ar-dialog-notifications'])
    );
  });

  it('draws the Arabic notifications over the real subscription, not with rows made by hand', async () => {
    // Hand-made rows held plain text, so they hid that the Markdown paragraphs the app draws read
    // in the wrong order in Arabic.
    const scene = scenes.find((entry) => entry.name === 'ar-dialog-notifications');
    const steps = [];
    await scene.setup({
      showNotifications: () => steps.push('showNotifications'),
      waitForSelector: async () => {},
      click: async (selector) => steps.push(`click ${selector}`),
      ev: async () => steps.push('ev'),
    });
    expect(steps).toEqual(['showNotifications', 'click #persistent-notifications-btn']);
  });

  it('plots the graph the tooltip scenes hover over from history the mock holds', () => {
    const scene = scenes.find((entry) => entry.name === 'graph-hover-left');
    const [graph] = scene.config.comparisonGraphs;
    const history = buildHistories();
    const known = new Set(buildStates().map((entity) => entity.entity_id));
    const recorded = graph.entityIds.filter((entityId) => history(entityId).length > 0);
    expect(recorded.length).toBeGreaterThanOrEqual(3);
    for (const entityId of graph.entityIds) {
      expect(known.has(entityId)).toBe(true);
    }
  });

  // The toast layout scenes once showed a warning built here by hand, with no status icon and no
  // close button, and the app's toast layout never ran for it.
  it('raises its toasts through the app instead of building them', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/visual-snapshots/scenes.cjs'),
      'utf8'
    );
    expect(source).not.toMatch(/className\s*=\s*['"`]toast\b/);
    // The toast scenes run a command for the lamp the mock refuses, found by its name.
    const lamp = buildStates().find((entity) => entity.entity_id === 'light.unreachable');
    expect(FAILING_ENTITIES).toContain(lamp.entity_id);
    expect(lamp.attributes.friendly_name).toBe('Unreachable lamp');
    expect(source).toContain("includes('Unreachable lamp')");
  });
});
