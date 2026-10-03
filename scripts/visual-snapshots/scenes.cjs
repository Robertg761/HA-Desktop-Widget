/**
 * The scenes the visual snapshot runner captures, in the order it captures them.
 *
 * A scene starts from the fixture's own settings (dark theme, English, 500x660 window, no
 * emulation), changes only what it lists, and is put back afterwards, so scenes do not depend on
 * each other and can be run alone with SNAPSHOT_SCENES=<regex>. What a scene may set:
 *
 *   ui       settings merged over the fixture's ui settings (theme, language, seasonal, ...)
 *   config   other settings merged over the fixture's (frostedGlass, customTabs, activeTabId,
 *            entityAlerts)
 *   size     { width, height } to resize the window to
 *   media    CDP media features to emulate, e.g. forced-colors
 *   setup    async (ctx) that drives the UI; may return { capture } to photograph another
 *            window (a desktop pin) instead of the main one
 *   pin      the entity a pin scene pins (only a label for the tests, which check that every
 *            desktop pin family has a scene)
 *   keepToasts  leave the toasts on screen for the capture (they are cleared otherwise)
 *
 * A setup can also fail its scene with ctx.expect(expression, label), a layout check that compares
 * boxes with each other (a button lies inside its dialog) and so holds on any machine's fonts.
 *
 * The clock, the date, the running timer and the media progress follow the wall clock, so those
 * few pixels differ from run to run. Everything else comes from the fixture.
 */

const { PAGE_SETS, WINDOW_SIZE } = require('./fixture.cjs');

const NARROW_WINDOW = { width: 340, height: WINDOW_SIZE.height };
// The size the app opens at (the fixture's window is 60px taller to fit a 768px display), a window
// as narrow as 150% text makes it, the smallest the window can be, and a wide one.
const DEFAULT_SIZE = { width: 500, height: 600 };
const NARROW_SIZE = { width: 340, height: 600 };
const MINIMUM_SIZE = { width: 320, height: 360 };
const WIDE_SIZE = { width: 900, height: 700 };
const FORCED_COLORS = [{ name: 'forced-colors', value: 'active' }];
// A light contrast theme (Windows High Contrast White): Chromium picks the light palette from the
// colour scheme.
const FORCED_COLORS_LIGHT = [...FORCED_COLORS, { name: 'prefers-color-scheme', value: 'light' }];

const tileDetails = (entityId) =>
  `#quick-controls [data-entity-id="${entityId}"] .tile-details-button`;
const tile = (entityId) => `#quick-controls [data-entity-id="${entityId}"]`;

const openBrightness = (ctx) => ctx.click(tileDetails('light.desk_lamp'));
const openDetails = (entityId) => (ctx) => ctx.click(tileDetails(entityId));
const openClimate = (ctx) => ctx.click(tileDetails('climate.living_room'));
const openColourLight = (ctx) => ctx.click(tileDetails('light.colour_strip'));
// The page being edited carries its rename, duplicate and delete buttons in the tab strip. However
// long its name and however wordy Add page is in the interface's language, they have to lie inside
// the strip and clear of the fades at its edges, or they cannot be seen or reached. Its name has to
// keep some room as well: a lone page in a strip as wide as itself once lost all of it.
const EDIT_BUTTONS_IN_STRIP = `(() => {
  const strip = document.querySelector('.quick-access-tab-scroll');
  const tab = document.querySelector('.quick-access-tab.active');
  if (!strip || !tab) return false;
  const bounds = strip.getBoundingClientRect();
  const fade = parseFloat(getComputedStyle(strip).getPropertyValue('--qa-tab-fade')) || 0;
  const overflow = strip.dataset.overflow || '';
  const left = bounds.left + (overflow === 'left' || overflow === 'both' ? fade : 0);
  const right = bounds.right - (overflow === 'right' || overflow === 'both' ? fade : 0);
  const label = tab.querySelector('.quick-access-tab-label');
  const named = !label || label.clientWidth >= Math.min(label.scrollWidth, 30);
  return named && [...tab.children].every((part) => {
    const box = part.getBoundingClientRect();
    return box.left >= left - 1 && box.right <= right + 1;
  });
})()`;

async function toggleEditMode(ctx) {
  await ctx.click('#reorganize-quick-controls-btn');
  // The strip scrolls the page into view, which takes a moment.
  await ctx.waitForExpression(EDIT_BUTTONS_IN_STRIP, 'the edited page inside the tab strip');
}

async function openSettingsTab(ctx, tab) {
  await ctx.click('#settings-btn');
  await ctx.waitForExpression(
    `!document.querySelector('#settings-modal')?.classList.contains('hidden')`
  );
  // Settings remembers the last tab, so always click the wanted one.
  const tabSelector = `#settings-modal .tab-link[data-tab="${tab}"]`;
  await ctx.click(tabSelector);
  await ctx.waitForExpression(
    `document.querySelector('${tabSelector}').classList.contains('active')`
  );
  await ctx.ev(
    `(() => { const body = document.querySelector('#settings-modal .modal-body'); if (body) body.scrollTop = 0; })()`
  );
}

// The alarm tile has no click action; its commands live in the command palette. "Disarm" asks
// for the panel's code, which is the dialog this scene shows.
async function openAlarmCodeDialog(ctx) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  // The palette focuses its field a moment after it appears; text typed before is lost.
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.insertText('disarm');
  await ctx.waitForExpression(
    `document.querySelector('.command-palette-result.highlighted')?.textContent.includes('Disarm')`,
    'the Disarm command'
  );
  await ctx.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
  await ctx.waitForSelector('.alarm-code-modal');
}

// The first-run wizard is one panel that outlives config changes: it only starts over when it
// was hidden, so a scene that follows another first-run scene finds it on that scene's step.
// Back is disabled on the welcome step, so stepping back until then starts every scene from the
// same place, however the scenes were selected.
async function showFirstRunWelcome(ctx) {
  await ctx.waitForSelector('.first-run-onboarding:not(.hidden)');
  const back = `document.querySelector('.first-run-actions .btn-secondary:nth-child(2)')`;
  await ctx.ev(`(async () => {
    const back = ${back};
    // The URL and authorization steps are the most there is to step back from.
    for (let attempt = 0; attempt < 2 && !back.disabled; attempt += 1) {
      back.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })()`);
  await ctx.waitForExpression(`${back}.disabled`, 'the first-run welcome step');
}

// Settings opens one page at a time; this scrolls the wanted element to the top and opens any
// disclosure it sits in.
async function revealInSettings(ctx, selector) {
  await ctx.ev(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.closest('details')?.setAttribute('open', '');
    element?.scrollIntoView({ block: 'start' });
  })()`);
}

// Two alerts: one for a state change and one for a number crossing a threshold.
const alertsConfig = {
  entityAlerts: {
    enabled: true,
    alerts: {
      'binary_sensor.front_door': {
        onStateChange: true,
        onSpecificState: false,
        onNumericThreshold: false,
        targetState: '',
        comparison: 'above',
        threshold: null,
        durationSeconds: 0,
        cooldownSeconds: 0,
        quietHours: { enabled: false, start: '22:00', end: '07:00' },
      },
      'sensor.office_temp': {
        onStateChange: false,
        onSpecificState: false,
        onNumericThreshold: true,
        targetState: '',
        comparison: 'above',
        threshold: 25,
        durationSeconds: 60,
        cooldownSeconds: 300,
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
      },
    },
  },
};

async function openAlertConfig(ctx) {
  await openSettingsTab(ctx, 'alerts');
  await ctx.waitForSelector('.edit-alert');
  await ctx.click('.edit-alert[data-entity="sensor.office_temp"]');
  await ctx.waitForExpression(
    `!document.querySelector('#alert-config-modal')?.classList.contains('hidden')`
  );
}

// Edit mode puts a rename and a remove button on every tile.
async function openTileSettings(ctx, entityId = 'sensor.office_temp') {
  await toggleEditMode(ctx);
  await ctx.click(`${tile(entityId)} .rename-btn`);
  await ctx.waitForSelector('.rename-modal');
}

async function openRemoveConfirmation(ctx) {
  await toggleEditMode(ctx);
  await ctx.click(`${tile('scene.movie_time')} .remove-btn`);
  await ctx.waitForExpression(
    `!document.querySelector('#confirm-modal')?.classList.contains('hidden')`
  );
}

async function pinEntity(ctx, entityId) {
  return { capture: await ctx.openPin(entityId) };
}

const READABLE = { highContrast: true, opaquePanels: true };
const sixPages = (activeTabId) => ({ customTabs: PAGE_SETS.six, activeTabId });
// The page that holds an entity of every pin family; only Quick Access entities can be pinned.
const pinsPage = { customTabs: PAGE_SETS.pins, activeTabId: 'pins' };
const pinScene = (name, entityId, extra = {}) => ({
  name,
  pin: entityId,
  config: pinsPage,
  setup: (ctx) => pinEntity(ctx, entityId),
  ...extra,
});

const pages = (set, activeTabId) => ({ customTabs: PAGE_SETS[set], activeTabId });

// Keyboard focus rings only show after a key press, so press one before focusing from script.
async function focusWithKeyboard(ctx, selector) {
  await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
  await ctx.ev(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
}

// The page whose tiles open the helper, vacuum, to-do, calendar and repair dialogs.
const dialogsPage = { customTabs: PAGE_SETS.dialogs, activeTabId: 'default' };
// A holiday shows for an hour, long enough for the whole run.
const holiday = (show) => ({ enabled: true, show, showUntil: Date.now() + 3600000 });

// Layout checks. They only compare boxes with each other, so they hold whatever the fonts of the
// machine running them: a dialog's buttons lie inside it and inside the window, a tile holds what
// is in it, a title leaves the close button its room.
const DIALOG_FITS = `(() => {
  const open = [...document.querySelectorAll('.modal')].filter((modal) =>
    !modal.classList.contains('hidden') && !modal.classList.contains('modal-closing') &&
    modal.getClientRects().length > 0);
  const modal = open[open.length - 1];
  const content = modal?.querySelector('.modal-content');
  if (!content) return false;
  const box = content.getBoundingClientRect();
  const inside = (element) => {
    const part = element.getBoundingClientRect();
    return part.left >= box.left - 1 && part.right <= box.right + 1 &&
      part.top >= box.top - 1 && part.bottom <= box.bottom + 1;
  };
  return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1 &&
    [...content.querySelectorAll('.modal-header .close-btn, .modal-footer .btn')]
      .filter((element) => element.getClientRects().length > 0).every(inside);
})()`;
const TILES_HOLD_THEIR_CONTENT = `[...document.querySelectorAll('#quick-controls .control-item')].every((tile) => {
  const box = tile.getBoundingClientRect();
  return [...tile.querySelectorAll('.control-icon, .control-name, .control-state')]
    .filter((part) => part.getClientRects().length > 0)
    .every((part) => {
      const rect = part.getBoundingClientRect();
      return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 &&
        rect.left >= box.left - 1 && rect.right <= box.right + 1;
    });
})`;
const NO_SIDEWAYS_SCROLL = `document.documentElement.scrollWidth <= innerWidth + 1`;
// Every label in a Settings row keeps room to be read, at 150% text size and in a narrow window.
const SETTING_LABELS_READABLE = `[...document.querySelectorAll('#settings-modal .tab-content.active .setting-text')]
  .filter((text) => text.getClientRects().length > 0).every((text) => text.getBoundingClientRect().width >= 100)`;

const withPage = (set, activeTabId = 'default') => ({
  customTabs: PAGE_SETS[set],
  activeTabId,
});
const edgePage = withPage('edge');
// Hotkeys for two rows, so the Hotkeys scenes show a row with a hotkey beside one without.
const hotkeyPage = {
  ...edgePage,
  globalHotkeys: {
    enabled: false,
    hotkeys: {
      'light.hallway_ceiling_long': { hotkey: 'Ctrl+Shift+Space', action: 'toggle' },
      'light.desk_lamp': { hotkey: 'Ctrl+Alt+L', action: 'toggle' },
    },
  },
};

async function openHotkeysFor(ctx, filter) {
  await openSettingsTab(ctx, 'hotkeys');
  await ctx.waitForSelector('#hotkeys-list .hotkey-item');
  await ctx.ev(`(() => {
    const search = document.getElementById('hotkey-entity-search');
    if (!search) return;
    search.value = ${JSON.stringify(filter)};
    search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await ctx.sleep(300);
  await revealInSettings(ctx, '#hotkeys-list');
}

async function openPrimaryCardsList(ctx) {
  await openSettingsTab(ctx, 'dashboard');
  await ctx.click('#primary-cards-section .section-toggle');
  await ctx.waitForSelector('#primary-cards-list .entity-item');
  // The section opens with a transition; its heading is only where it will stay once it is open.
  await ctx.sleep(600);
  await revealInSettings(ctx, '#primary-cards-section');
}

// Holding the weather card opens its entity picker.
async function openWeatherPicker(ctx) {
  await ctx.ev(
    `document.getElementById('weather-card').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`
  );
  await ctx.sleep(700);
  await ctx.waitForExpression(
    `!document.querySelector('#weather-config-modal')?.classList.contains('hidden')`
  );
}

async function openAlertPicker(ctx) {
  await openSettingsTab(ctx, 'alerts');
  await ctx.click('.add-alert-btn');
  await ctx.waitForExpression(
    `!document.querySelector('#alert-entity-picker-modal')?.classList.contains('hidden')`
  );
}

// The comparison graph editor opens on a new graph from Manage Quick Access.
async function openGraphEditor(ctx) {
  await ctx.click('#manage-quick-controls-btn');
  await ctx.waitForSelector('#add-comparison-graph-btn');
  await ctx.click('#add-comparison-graph-btn');
  await ctx.waitForSelector('.comparison-graph-modal .entity-selector-list .entity-item');
}

// The command palette with a query that finds the longest row type.
async function openPaletteFor(ctx, query) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.insertText(query);
  await ctx.waitForSelector('.command-palette-result');
}

// The edit-mode hint is a long toast; a second one stands in for a pair of warnings.
async function showToasts(ctx) {
  await ctx.ev(
    `document.querySelectorAll('#toast-container .toast').forEach((toast) => toast.remove())`
  );
  await ctx.click('#reorganize-quick-controls-btn');
  await ctx.waitForSelector('#toast-container .toast');
  await ctx.ev(`(() => {
    const toast = document.createElement('div');
    toast.className = 'toast warning';
    toast.innerHTML = '<span class="toast-message"></span>';
    toast.firstChild.textContent =
      'The system keyring is locked, so the access token cannot be saved. Unlock it and restart.';
    document.getElementById('toast-container').appendChild(toast);
  })()`);
  await ctx.sleep(500);
}

const scenes = [
  // The main view and the dialogs opened from it, dark and in English.
  { name: 'main-dark' },
  { name: 'popup-brightness', setup: openBrightness },
  { name: 'popup-climate', setup: openClimate },
  { name: 'edit-mode', setup: toggleEditMode },
  { name: 'settings', setup: (ctx) => openSettingsTab(ctx, 'general') },
  { name: 'settings-appearance', setup: (ctx) => openSettingsTab(ctx, 'personalization') },
  { name: 'dialog-manage-quick-access', setup: (ctx) => ctx.click('#manage-quick-controls-btn') },
  { name: 'popup-alarm-code', config: sixPages('default'), setup: openAlarmCodeDialog },

  // The dialogs the dialogs page opens, each built by the app rather than by index.html.
  {
    name: 'popup-input-select',
    config: dialogsPage,
    setup: (ctx) => ctx.click(tile('input_select.house_mode')),
  },
  {
    name: 'popup-vacuum',
    config: dialogsPage,
    setup: (ctx) => ctx.click(tile('vacuum.robot')),
  },
  {
    name: 'popup-todo',
    config: dialogsPage,
    setup: async (ctx) => {
      await ctx.click(tile('todo.shopping'));
      await ctx.waitForSelector('.todo-item-row');
    },
  },
  {
    name: 'popup-calendar',
    config: dialogsPage,
    setup: async (ctx) => {
      await ctx.click(tile('calendar.family'));
      await ctx.waitForSelector('.calendar-event-row');
    },
  },
  {
    name: 'popup-repair',
    config: dialogsPage,
    setup: async (ctx) => {
      await ctx.click(tile('light.old_kitchen'));
      await ctx.waitForSelector('#entity-repair-modal .entity-item');
    },
  },

  {
    name: 'popup-light-colour',
    config: dialogsPage,
    setup: openDetails('light.color_strip'),
  },
  { name: 'popup-fan', config: dialogsPage, setup: openDetails('fan.office') },
  { name: 'popup-cover', config: dialogsPage, setup: openDetails('cover.garage') },
  {
    name: 'popup-media',
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  {
    name: 'dialog-tile-settings',
    setup: (ctx) => openTileSettings(ctx),
  },
  { name: 'dialog-confirm-remove', setup: openRemoveConfirmation },
  {
    name: 'dialog-alert-config',
    config: alertsConfig,
    setup: openAlertConfig,
  },

  // The sensor pop-up with its history period, and the dialogs the Advanced page opens.
  { name: 'popup-sensor', setup: (ctx) => ctx.click(tile('sensor.office_temp')) },
  {
    name: 'dialog-support',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'advanced');
      await ctx.click('#open-donate-modal-btn');
      await ctx.waitForExpression(
        `!document.querySelector('#donate-modal')?.classList.contains('hidden')`
      );
    },
  },
  {
    name: 'dialog-diagnostics',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'advanced');
      await ctx.click('#connection-diagnostics-btn');
      await ctx.waitForSelector('.diagnostics-report');
    },
  },

  // Settings pages the first scenes do not reach, and the custom colour editor.
  { name: 'settings-dashboard', setup: (ctx) => openSettingsTab(ctx, 'dashboard') },
  { name: 'settings-hotkeys', setup: (ctx) => openSettingsTab(ctx, 'hotkeys') },
  {
    name: 'settings-alerts',
    config: alertsConfig,
    setup: (ctx) => openSettingsTab(ctx, 'alerts'),
  },
  { name: 'settings-advanced', setup: (ctx) => openSettingsTab(ctx, 'advanced') },
  {
    name: 'settings-custom-color',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await revealInSettings(ctx, '#custom-color-picker');
    },
  },

  // A light as a primary card: the lit lamp warms its icon and glow.
  { name: 'primary-light-card', config: { primaryCards: ['light.desk_lamp', 'time'] } },

  // A page with nothing on it says so instead of showing an empty grid.
  {
    name: 'empty-page',
    config: {
      customTabs: [
        { id: 'default', name: 'Home', entityIds: [] },
        { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] },
      ],
      activeTabId: 'default',
    },
  },

  // Pages the six-tab set adds: a tab strip that overflows, media tiles and a helper dialog.
  { name: 'six-tabs', config: sixPages('devices') },
  { name: 'media-tile', config: sixPages('media') },
  {
    name: 'popup-input-number',
    config: sixPages('devices'),
    setup: (ctx) => ctx.click(tile('input_number.thermostat_offset')),
  },

  // The page tab strip with 1, 3, 6 and 12 pages (German names, the last of them very long), in
  // normal and edit mode, light and dark, left to right and right to left. The active page is the
  // last or next to last, which only shows if the strip scrolls it into view. In German, whose
  // Add page is the wordiest, a long page name must still leave room for all its buttons.
  { name: 'tabs-three', config: pages('three', 'kitchen') },
  { name: 'tabs-three-edit', config: pages('three', 'kitchen'), setup: toggleEditMode },
  { name: 'tabs-six-edit', config: sixPages('devices'), setup: toggleEditMode },
  {
    name: 'tabs-single-edit',
    setup: toggleEditMode,
    config: { customTabs: [PAGE_SETS.default[0]], activeTabId: 'default' },
  },
  { name: 'tabs-twelve', config: pages('twelve', 'page-12') },
  { name: 'tabs-twelve-edit', config: pages('twelve', 'page-6'), setup: toggleEditMode },
  { name: 'tabs-twelve-edit-last', config: pages('twelve', 'page-12'), setup: toggleEditMode },
  {
    name: 'tabs-twelve-de-edit',
    ui: { language: 'de' },
    config: pages('twelve', 'page-6'),
    setup: toggleEditMode,
  },
  { name: 'tabs-twelve-light', ui: { theme: 'light' }, config: pages('twelve', 'page-12') },
  {
    name: 'tabs-twelve-light-edit',
    ui: { theme: 'light' },
    config: pages('twelve', 'page-6'),
    setup: toggleEditMode,
  },
  { name: 'tabs-twelve-rtl', ui: { language: 'ar' }, config: pages('twelve', 'page-12') },
  {
    name: 'tabs-twelve-rtl-edit',
    ui: { language: 'ar' },
    config: pages('twelve', 'page-6'),
    setup: toggleEditMode,
  },
  {
    name: 'tabs-narrow-edit',
    size: NARROW_WINDOW,
    config: pages('six', 'media'),
    setup: toggleEditMode,
  },
  {
    name: 'tabs-focus',
    config: pages('twelve', 'page-4'),
    setup: (ctx) => focusWithKeyboard(ctx, '.quick-access-tab-link.active'),
  },
  {
    name: 'tabs-focus-edit',
    config: pages('twelve', 'page-4'),
    setup: async (ctx) => {
      await toggleEditMode(ctx);
      await focusWithKeyboard(ctx, '.qa-tab-rename');
    },
  },
  {
    name: 'tabs-focus-add',
    config: pages('three', 'default'),
    setup: async (ctx) => {
      await toggleEditMode(ctx);
      await focusWithKeyboard(ctx, '.qa-tab-add');
    },
  },

  // Edit mode puts a pin, edit and remove button on every tile; compact density and narrow
  // windows leave the least room for them.
  { name: 'edit-compact', ui: { density: 'compact' }, setup: toggleEditMode },
  {
    name: 'edit-compact-narrow',
    ui: { density: 'compact' },
    size: NARROW_WINDOW,
    setup: toggleEditMode,
  },
  { name: 'edit-narrow', size: NARROW_WINDOW, setup: toggleEditMode },
  { name: 'edit-media', config: sixPages('media'), setup: toggleEditMode },
  {
    name: 'edit-graph-camera',
    config: {
      ...pages('graph', 'default'),
      comparisonGraphs: [
        { id: 'graph:temps', name: 'Temperatures', span: 3, entityIds: ['sensor.office_temp'] },
      ],
      quickAccessTileOptions: { 'camera.driveway': { cameraPreviewRefresh: '30s' } },
    },
    setup: toggleEditMode,
  },

  // The light theme.
  { name: 'main-light', ui: { theme: 'light' } },
  { name: 'main-light-solid', ui: { theme: 'light' }, config: { frostedGlass: false } },
  { name: 'popup-brightness-light', ui: { theme: 'light' }, setup: openBrightness },
  { name: 'popup-climate-light', ui: { theme: 'light' }, setup: openClimate },

  // German has the long words, Arabic mirrors the layout.
  { name: 'de-main', ui: { language: 'de' } },
  { name: 'de-edit-mode', ui: { language: 'de' }, setup: toggleEditMode },
  { name: 'ar-main', ui: { language: 'ar' } },
  {
    name: 'ar-settings-general',
    ui: { language: 'ar' },
    setup: (ctx) => openSettingsTab(ctx, 'general'),
  },

  // The same dialogs in German (long labels) and Arabic (mirrored), and the light theme.
  {
    name: 'de-popup-fan',
    ui: { language: 'de' },
    config: dialogsPage,
    setup: openDetails('fan.office'),
  },
  {
    name: 'de-dialog-tile-settings',
    ui: { language: 'de' },
    setup: (ctx) => openTileSettings(ctx),
  },
  {
    name: 'de-settings-hotkeys',
    ui: { language: 'de' },
    setup: (ctx) => openSettingsTab(ctx, 'hotkeys'),
  },
  {
    name: 'de-popup-media',
    ui: { language: 'de' },
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  {
    name: 'ar-popup-media',
    ui: { language: 'ar' },
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  {
    name: 'ar-dialog-tile-settings',
    ui: { language: 'ar' },
    setup: (ctx) => openTileSettings(ctx),
  },
  {
    name: 'de-popup-input-select',
    ui: { language: 'de' },
    config: dialogsPage,
    setup: (ctx) => ctx.click(tile('input_select.house_mode')),
  },
  {
    name: 'de-dialog-alert-config',
    ui: { language: 'de' },
    config: alertsConfig,
    setup: openAlertConfig,
  },
  {
    name: 'de-dialog-manage-quick-access',
    ui: { language: 'de' },
    setup: (ctx) => ctx.click('#manage-quick-controls-btn'),
  },
  {
    name: 'ar-dialog-alert-config',
    ui: { language: 'ar' },
    config: alertsConfig,
    setup: openAlertConfig,
  },
  {
    name: 'ar-dialog-manage-quick-access',
    ui: { language: 'ar' },
    setup: (ctx) => ctx.click('#manage-quick-controls-btn'),
  },
  {
    name: 'ar-settings-hotkeys',
    ui: { language: 'ar' },
    setup: (ctx) => openSettingsTab(ctx, 'hotkeys'),
  },
  {
    name: 'popup-media-light',
    ui: { theme: 'light' },
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  {
    name: 'popup-light-colour-light',
    ui: { theme: 'light' },
    config: dialogsPage,
    setup: openDetails('light.color_strip'),
  },
  {
    name: 'dialog-tile-settings-light',
    ui: { theme: 'light' },
    setup: (ctx) => openTileSettings(ctx),
  },
  {
    name: 'dialog-alert-config-light',
    ui: { theme: 'light' },
    config: alertsConfig,
    setup: openAlertConfig,
  },
  {
    name: 'settings-dashboard-light',
    ui: { theme: 'light' },
    setup: (ctx) => openSettingsTab(ctx, 'dashboard'),
  },
  {
    name: 'settings-hotkeys-light',
    ui: { theme: 'light' },
    setup: (ctx) => openSettingsTab(ctx, 'hotkeys'),
  },
  {
    name: 'popup-input-select-light',
    ui: { theme: 'light' },
    config: dialogsPage,
    setup: (ctx) => ctx.click(tile('input_select.house_mode')),
  },
  {
    name: 'popup-todo-light',
    ui: { theme: 'light' },
    config: dialogsPage,
    setup: async (ctx) => {
      await ctx.click(tile('todo.shopping'));
      await ctx.waitForSelector('.todo-item-row');
    },
  },
  {
    name: 'dialog-manage-quick-access-light',
    ui: { theme: 'light' },
    setup: (ctx) => ctx.click('#manage-quick-controls-btn'),
  },

  // A window dragged narrower than the 500px it opens at.
  { name: 'narrow-main', size: NARROW_WINDOW },

  // Windows High Contrast, as Chromium emulates it: a dark contrast theme, then a light one.
  { name: 'forced-colors-main', media: FORCED_COLORS },
  { name: 'forced-colors-popup', media: FORCED_COLORS, setup: openBrightness },
  { name: 'forced-colors-popup-climate', media: FORCED_COLORS, setup: openClimate },
  {
    name: 'forced-colors-popup-colour',
    config: { activeTabId: 'bedroom' },
    media: FORCED_COLORS,
    setup: openColourLight,
  },
  {
    name: 'forced-colors-settings-appearance',
    media: FORCED_COLORS,
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  {
    name: 'forced-colors-dialog-alarm-code',
    config: sixPages('default'),
    media: FORCED_COLORS,
    setup: openAlarmCodeDialog,
  },
  { name: 'forced-colors-edit-mode', media: FORCED_COLORS, setup: toggleEditMode },
  { name: 'forced-colors-light-main', ui: { theme: 'light' }, media: FORCED_COLORS_LIGHT },
  {
    name: 'forced-colors-light-popup-climate',
    ui: { theme: 'light' },
    media: FORCED_COLORS_LIGHT,
    setup: openClimate,
  },
  {
    name: 'forced-colors-light-settings-appearance',
    ui: { theme: 'light' },
    media: FORCED_COLORS_LIGHT,
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },

  // The Readable preset (high contrast with opaque panels), on both themes.
  { name: 'readable-main', ui: READABLE },
  { name: 'readable-light-main', ui: { theme: 'light', ...READABLE } },
  { name: 'readable-light-popup-climate', ui: { theme: 'light', ...READABLE }, setup: openClimate },
  {
    name: 'readable-light-settings-appearance',
    ui: { theme: 'light', ...READABLE },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },

  // Desktop pins are windows of their own, opened at the default 168x148.
  { name: 'pin-light', pin: 'light.desk_lamp', setup: (ctx) => pinEntity(ctx, 'light.desk_lamp') },
  {
    name: 'pin-sensor',
    pin: 'sensor.office_temp',
    setup: (ctx) => pinEntity(ctx, 'sensor.office_temp'),
  },

  // Every pin family at the default size (media is wide), in English, then the families that
  // strain it in German, French, Spanish and Arabic, at an enlarged interface, and in the light
  // theme, where pins stay dark glass.
  pinScene('pin-light-off', 'light.shelf_leds'),
  pinScene('pin-light-long', 'light.upstairs_hallway_ceiling'),
  pinScene('pin-climate', 'climate.bedroom'),
  pinScene('pin-fan', 'fan.office'),
  pinScene('pin-cover', 'cover.garage_door'),
  pinScene('pin-media', 'media_player.kitchen_speaker'),
  pinScene('pin-media-play-only', 'media_player.hall_chime'),
  pinScene('pin-numeric', 'input_number.thermostat_offset'),
  pinScene('pin-enum', 'input_select.house_mode'),
  pinScene('pin-weather', 'weather.home'),
  pinScene('pin-camera', 'camera.driveway'),
  pinScene('pin-scene', 'scene.movie_time'),
  pinScene('pin-script', 'script.goodnight'),
  pinScene('pin-lock', 'lock.back_door'),
  pinScene('pin-action', 'automation.morning_routine'),
  pinScene('pin-presence', 'person.alex'),
  pinScene('pin-vacuum', 'vacuum.robot'),
  pinScene('pin-timer', 'timer.laundry'),
  pinScene('pin-de-cover', 'cover.garage_door', { ui: { language: 'de' } }),
  pinScene('pin-de-weather', 'weather.home', { ui: { language: 'de' } }),
  pinScene('pin-fr-climate', 'climate.bedroom', { ui: { language: 'fr' } }),
  pinScene('pin-fr-light', 'light.upstairs_hallway_ceiling', { ui: { language: 'fr' } }),
  pinScene('pin-es-fan', 'fan.office', { ui: { language: 'es' } }),
  pinScene('pin-ar-light', 'light.desk_lamp', { ui: { language: 'ar' } }),
  pinScene('pin-ar-climate', 'climate.bedroom', { ui: { language: 'ar' } }),
  pinScene('pin-large-light', 'light.desk_lamp', { ui: { scale: 1.5 } }),
  pinScene('pin-large-climate', 'climate.bedroom', { ui: { scale: 1.5 } }),
  pinScene('pin-large-weather', 'weather.home', { ui: { scale: 1.5 } }),
  pinScene('pin-theme-light-climate', 'climate.bedroom', { ui: { theme: 'light' } }),

  // The fixture turns seasonal themes off so the scenes above do not change with the date; these
  // force a holiday on. They also switch the themes on explicitly: CI machines often ask for
  // reduced motion, which otherwise keeps them off. The background scene is random, so these
  // differ a little run to run.
  {
    name: 'halloween',
    ui: { seasonal: holiday('halloween') },
  },
  {
    name: 'christmas-light',
    ui: { theme: 'light', seasonal: holiday('christmas') },
  },

  // Layout robustness. The edge page has a 95-character light, a seven-figure reading, one
  // unbroken German word as a name and a 90-character sensor; the scenes show it, and the dialogs
  // and Settings pages, at the default 500x600 window, a window as narrow as 150% text makes it
  // (340px), the smallest window, 130% and 150% text, a wide 900x700 window, and in the languages
  // with the longest labels. Each one that has a check fails when a box leaves its parent.
  {
    name: 'layout-edge-main',
    size: DEFAULT_SIZE,
    config: edgePage,
    setup: async (ctx) => ctx.expect(TILES_HOLD_THEIR_CONTENT, 'every tile holds its content'),
  },
  {
    name: 'layout-edge-compact',
    size: DEFAULT_SIZE,
    ui: { density: 'compact' },
    config: edgePage,
    setup: async (ctx) => ctx.expect(TILES_HOLD_THEIR_CONTENT, 'every tile holds its content'),
  },
  {
    name: 'layout-edge-narrow',
    size: NARROW_SIZE,
    config: edgePage,
    setup: async (ctx) => ctx.expect(NO_SIDEWAYS_SCROLL, 'no sideways scroll'),
  },
  { name: 'layout-edge-s130', size: DEFAULT_SIZE, ui: { scale: 1.3 }, config: edgePage },
  { name: 'layout-edge-s150', size: DEFAULT_SIZE, ui: { scale: 1.5 }, config: edgePage },
  {
    name: 'layout-main-minimum',
    size: MINIMUM_SIZE,
    setup: async (ctx) => ctx.expect(NO_SIDEWAYS_SCROLL, 'no sideways scroll'),
  },
  { name: 'layout-main-s150', size: DEFAULT_SIZE, ui: { scale: 1.5 } },
  { name: 'layout-main-wide', size: WIDE_SIZE },
  // A film runs past an hour: the times need an h:mm:ss, and the bar sits between them.
  {
    name: 'layout-media-long',
    size: DEFAULT_SIZE,
    config: { primaryMediaPlayer: 'media_player.theater' },
  },
  {
    name: 'layout-media-long-narrow',
    size: NARROW_SIZE,
    config: { primaryMediaPlayer: 'media_player.theater' },
  },
  { name: 'layout-time-long-date-es', ui: { language: 'es', dateFormat: 'long' } },
  {
    name: 'layout-time-long-date-es-narrow',
    size: NARROW_SIZE,
    ui: { language: 'es', dateFormat: 'long' },
  },

  // Control pop-ups at the default window, where the 60vh cap used to make them scroll, with a
  // title that is one long word, and narrow.
  {
    name: 'layout-popup-colour',
    size: DEFAULT_SIZE,
    config: dialogsPage,
    setup: async (ctx) => {
      await openDetails('light.color_strip')(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-popup-colour-narrow',
    size: NARROW_SIZE,
    config: dialogsPage,
    setup: async (ctx) => {
      await openDetails('light.color_strip')(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-popup-cover',
    size: DEFAULT_SIZE,
    config: dialogsPage,
    setup: async (ctx) => {
      await openDetails('cover.garage')(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-popup-long-title',
    size: DEFAULT_SIZE,
    config: edgePage,
    setup: async (ctx) => {
      await openDetails('cover.patio_awning_long')(ctx);
      await ctx.expect(DIALOG_FITS, 'the close button lies inside the dialog');
    },
  },
  {
    name: 'layout-popup-long-title-narrow',
    size: NARROW_SIZE,
    config: edgePage,
    setup: async (ctx) => {
      await openDetails('cover.patio_awning_long')(ctx);
      await ctx.expect(DIALOG_FITS, 'the close button lies inside the dialog');
    },
  },
  {
    name: 'layout-popup-climate-range',
    size: DEFAULT_SIZE,
    config: edgePage,
    setup: async (ctx) => {
      await openDetails('climate.heat_pump')(ctx);
      await ctx.expect(
        `(() => {
          const value = document.getElementById('climate-target-value');
          return value && value.getClientRects().length === 1 &&
            value.scrollWidth <= value.clientWidth + 1;
        })()`,
        'the target range is one line inside its card'
      );
    },
  },
  {
    name: 'layout-popup-climate-range-narrow',
    size: NARROW_SIZE,
    config: edgePage,
    setup: async (ctx) => {
      await openDetails('climate.heat_pump')(ctx);
      await ctx.expect(
        `document.getElementById('climate-target-value').getClientRects().length === 1`,
        'the target range is one line'
      );
    },
  },
  {
    name: 'layout-popup-climate-range-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    config: edgePage,
    setup: openDetails('climate.heat_pump'),
  },
  {
    name: 'layout-popup-brightness-narrow',
    size: NARROW_SIZE,
    setup: async (ctx) => {
      await openBrightness(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-popup-media-minimum',
    size: MINIMUM_SIZE,
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  {
    name: 'layout-popup-colour-minimum',
    size: MINIMUM_SIZE,
    config: dialogsPage,
    setup: async (ctx) => {
      await openDetails('light.color_strip')(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },

  // Dialogs built around a list: one scrollbar, the search field kept in view.
  {
    name: 'layout-dialog-manage',
    size: DEFAULT_SIZE,
    setup: async (ctx) => {
      await ctx.click('#manage-quick-controls-btn');
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-dialog-manage-narrow-de',
    size: NARROW_SIZE,
    ui: { language: 'de' },
    setup: async (ctx) => {
      await ctx.click('#manage-quick-controls-btn');
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-dialog-repair',
    size: DEFAULT_SIZE,
    config: dialogsPage,
    setup: async (ctx) => {
      await ctx.click(tile('light.old_kitchen'));
      await ctx.waitForSelector('#entity-repair-modal .entity-item');
      await ctx.expect(DIALOG_FITS, 'the dialog lies inside the window');
    },
  },
  {
    name: 'layout-dialog-alert-picker',
    size: DEFAULT_SIZE,
    config: alertsConfig,
    setup: async (ctx) => {
      await openAlertPicker(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog lies inside the window');
    },
  },
  {
    name: 'layout-dialog-alert-picker-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    config: alertsConfig,
    setup: openAlertPicker,
  },
  {
    name: 'layout-dialog-alert-picker-ar',
    size: DEFAULT_SIZE,
    ui: { language: 'ar' },
    config: alertsConfig,
    setup: openAlertPicker,
  },
  {
    name: 'layout-dialog-weather-picker',
    size: DEFAULT_SIZE,
    setup: async (ctx) => {
      await openWeatherPicker(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog lies inside the window');
    },
  },
  {
    name: 'layout-dialog-graph-editor',
    size: DEFAULT_SIZE,
    setup: async (ctx) => {
      await openGraphEditor(ctx);
      await ctx.expect(DIALOG_FITS, 'Done and Delete lie inside the dialog');
    },
  },
  {
    name: 'layout-dialog-alert-config',
    size: DEFAULT_SIZE,
    config: alertsConfig,
    setup: async (ctx) => {
      await openAlertConfig(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-dialog-confirm-minimum',
    size: MINIMUM_SIZE,
    setup: async (ctx) => {
      await openRemoveConfirmation(ctx);
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  {
    name: 'layout-dialog-tile-settings-narrow',
    size: NARROW_SIZE,
    setup: (ctx) => openTileSettings(ctx),
  },

  // Settings at 150% and 130% text size, in a narrow window, wide, and in German, French, Spanish
  // and Arabic: the label of every row keeps room to be read.
  ...['general', 'personalization', 'dashboard', 'advanced'].map((page) => ({
    name: `layout-settings-${page === 'personalization' ? 'appearance' : page}-s150`,
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    setup: async (ctx) => {
      await openSettingsTab(ctx, page);
      await ctx.expect(SETTING_LABELS_READABLE, 'every setting label keeps 100px');
    },
  })),
  {
    name: 'layout-settings-appearance-s130',
    size: DEFAULT_SIZE,
    ui: { scale: 1.3 },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  {
    name: 'layout-settings-appearance-narrow',
    size: NARROW_SIZE,
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await ctx.expect(SETTING_LABELS_READABLE, 'every setting label keeps 100px');
    },
  },
  {
    name: 'layout-settings-appearance-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  {
    name: 'layout-settings-appearance-wide',
    size: WIDE_SIZE,
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  {
    name: 'layout-settings-dashboard-wide',
    size: WIDE_SIZE,
    setup: (ctx) => openSettingsTab(ctx, 'dashboard'),
  },
  ...['de', 'fr', 'es', 'ar'].map((language) => ({
    name: `layout-settings-primary-cards-${language}`,
    size: DEFAULT_SIZE,
    ui: { language },
    setup: openPrimaryCardsList,
  })),
  {
    name: 'layout-settings-primary-cards-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    setup: openPrimaryCardsList,
  },
  {
    name: 'layout-settings-dashboard-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'dashboard');
      await revealInSettings(ctx, '#date-format');
    },
  },
  {
    name: 'layout-settings-hotkeys',
    size: DEFAULT_SIZE,
    config: hotkeyPage,
    setup: (ctx) => openHotkeysFor(ctx, 'light'),
  },
  {
    name: 'layout-settings-hotkeys-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    config: hotkeyPage,
    setup: (ctx) => openHotkeysFor(ctx, 'light'),
  },
  {
    name: 'layout-settings-hotkeys-ar',
    size: DEFAULT_SIZE,
    ui: { language: 'ar' },
    config: hotkeyPage,
    setup: (ctx) => openHotkeysFor(ctx, 'light'),
  },
  {
    name: 'layout-settings-hotkeys-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    config: hotkeyPage,
    setup: (ctx) => openHotkeysFor(ctx, 'light'),
  },

  // The command palette's longest rows, and the toasts at the sizes that capped them at half the
  // window.
  { name: 'layout-palette', size: DEFAULT_SIZE, setup: (ctx) => openPaletteFor(ctx, 'alarm') },
  {
    name: 'layout-palette-narrow',
    size: NARROW_SIZE,
    setup: (ctx) => openPaletteFor(ctx, 'alarm'),
  },
  {
    name: 'layout-palette-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    setup: (ctx) => openPaletteFor(ctx, 'a'),
  },
  { name: 'layout-toast', size: DEFAULT_SIZE, keepToasts: true, setup: showToasts },
  { name: 'layout-toast-narrow', size: NARROW_SIZE, keepToasts: true, setup: showToasts },
  {
    name: 'layout-toast-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    keepToasts: true,
    setup: showToasts,
  },
  {
    name: 'layout-toast-ar',
    size: DEFAULT_SIZE,
    ui: { language: 'ar' },
    keepToasts: true,
    setup: showToasts,
  },

  // First run shows when no server is configured. The runner only puts the keys listed above
  // back after a scene, so these stay last: later scenes would find the app unconnected. The
  // wizard stays open between them, so each one steps it back to the welcome page first.
  {
    name: 'first-run',
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  {
    name: 'first-run-url',
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunWelcome(ctx);
      await ctx.click('.first-run-actions .btn-primary');
      await ctx.waitForSelector('.first-run-content input');
    },
  },
  {
    name: 'first-run-light',
    ui: { theme: 'light' },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
];

module.exports = { scenes };
