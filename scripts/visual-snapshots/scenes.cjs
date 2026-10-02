/**
 * The scenes the visual snapshot runner captures, in the order it captures them.
 *
 * A scene starts from the fixture's own settings (dark theme, English, 500x660 window, no
 * emulation), changes only what it lists, and is put back afterwards, so scenes do not depend on
 * each other and can be run alone with SNAPSHOT_SCENES=<regex>. What a scene may set:
 *
 *   ui       settings merged over the fixture's ui settings (theme, language, seasonal, ...)
 *   config   other settings merged over the fixture's (frostedGlass, customTabs, activeTabId)
 *   size     { width, height } to resize the window to
 *   media    CDP media features to emulate, e.g. forced-colors
 *   setup    async (ctx) that drives the UI; may return { capture } to photograph another
 *            window (a desktop pin) instead of the main one
 *
 * The clock, the date, the running timer and the media progress follow the wall clock, so those
 * few pixels differ from run to run. Everything else comes from the fixture.
 */

const { PAGE_SETS, WINDOW_SIZE } = require('./fixture.cjs');

const NARROW_WINDOW = { width: 340, height: WINDOW_SIZE.height };
const FORCED_COLORS = [{ name: 'forced-colors', value: 'active' }];

const tileDetails = (entityId) =>
  `#quick-controls [data-entity-id="${entityId}"] .tile-details-button`;
const tile = (entityId) => `#quick-controls [data-entity-id="${entityId}"]`;

const openBrightness = (ctx) => ctx.click(tileDetails('light.desk_lamp'));
const openClimate = (ctx) => ctx.click(tileDetails('climate.living_room'));
const toggleEditMode = (ctx) => ctx.click('#reorganize-quick-controls-btn');

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

async function pinEntity(ctx, entityId) {
  return { capture: await ctx.openPin(entityId) };
}

const sixPages = (activeTabId) => ({ customTabs: PAGE_SETS.six, activeTabId });
const pages = (set, activeTabId) => ({ customTabs: PAGE_SETS[set], activeTabId });

// Keyboard focus rings only show after a key press, so press one before focusing from script.
async function focusWithKeyboard(ctx, selector) {
  await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
  await ctx.ev(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
}
// A holiday shows for an hour, long enough for the whole run.
const holiday = (show) => ({ enabled: true, show, showUntil: Date.now() + 3600000 });

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
  // last or next to last, which only shows if the strip scrolls it into view.
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

  // A window dragged narrower than the 500px it opens at.
  { name: 'narrow-main', size: NARROW_WINDOW },

  // Windows High Contrast, as Chromium emulates it.
  { name: 'forced-colors-main', media: FORCED_COLORS },
  { name: 'forced-colors-popup', media: FORCED_COLORS, setup: openBrightness },

  // Desktop pins are windows of their own, opened at the default 168x148.
  { name: 'pin-light', setup: (ctx) => pinEntity(ctx, 'light.desk_lamp') },
  { name: 'pin-sensor', setup: (ctx) => pinEntity(ctx, 'sensor.office_temp') },

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
];

module.exports = { scenes };
