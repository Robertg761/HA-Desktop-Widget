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
const openDetails = (entityId) => (ctx) => ctx.click(tileDetails(entityId));
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

  // First run shows when no server is configured. The runner only puts the keys listed above
  // back after a scene, so this one stays last: later scenes would find the app unconnected.
  {
    name: 'first-run',
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: (ctx) => ctx.waitForSelector('.first-run-onboarding:not(.hidden)'),
  },
  {
    name: 'first-run-url',
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await ctx.waitForSelector('.first-run-onboarding:not(.hidden)');
      await ctx.click('.first-run-actions .btn-primary');
      await ctx.waitForSelector('.first-run-content input');
    },
  },
  {
    name: 'first-run-light',
    ui: { theme: 'light' },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: (ctx) => ctx.waitForSelector('.first-run-onboarding:not(.hidden)'),
  },
];

module.exports = { scenes };
