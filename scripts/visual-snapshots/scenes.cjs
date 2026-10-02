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
// The page whose tiles open the helper, vacuum, to-do, calendar and repair dialogs.
const dialogsPage = { customTabs: PAGE_SETS.dialogs, activeTabId: 'default' };
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

  // Pages the six-tab set adds: a tab strip that overflows, media tiles and a helper dialog.
  { name: 'six-tabs', config: sixPages('devices') },
  { name: 'media-tile', config: sixPages('media') },
  {
    name: 'popup-input-number',
    config: sixPages('devices'),
    setup: (ctx) => ctx.click(tile('input_number.thermostat_offset')),
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
