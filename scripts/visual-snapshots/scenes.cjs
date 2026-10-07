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
 *   extraStates  (now) => entity states the home has only for this scene; the runner adds them
 *            before the scene and takes them away afterwards (see buildLandingLights)
 *   setup    async (ctx) that drives the UI; may return { capture } to photograph another
 *            window (a desktop pin) instead of the main one
 *   teardown async (ctx) run after the capture, to undo what setup did to the page itself (the
 *            runner puts back settings, dialogs, media and the window size on its own)
 *   pin      the entity a pin scene pins (only a label for the tests, which check that every
 *            desktop pin family has a scene)
 *   keepToasts  leave the toasts the setup raised on screen for the capture (they are cleared
 *               otherwise)
 *   startup  { config, env } for a scene about how the app starts: it runs on an app of its own
 *            whose config.json is config(fixture settings), with env added to its environment
 *   platforms  the process.platform values a scene runs on, when not every one can stage it
 *
 * A setup can also fail its scene with ctx.expect(expression, label), a layout check that compares
 * boxes with each other (a button lies inside its dialog) and so holds on any machine's fonts.
 *
 * The clock, the date, the running timer and the media progress follow the wall clock, so those
 * few pixels differ from run to run. Everything else comes from the fixture.
 */

const {
  PAGE_SETS,
  WINDOW_SIZE,
  buildLandingLights,
  buildUnavailableDevices,
} = require('./fixture.cjs');

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
// A touch-first machine (a tablet, a touch laptop in tablet mode) has a coarse pointer. Chromium's
// media emulation cannot set that, so the scene switches the stylesheet's coarse-pointer block on
// where it stands, which keeps its place in the cascade, and teardown puts the query back.
const COARSE_QUERY = '(pointer: coarse)';
const SWITCH_COARSE_POINTER_BLOCK_ON = `(() => {
  window.coarsePointerRules = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.media?.mediaText === ${JSON.stringify(COARSE_QUERY)}) {
        window.coarsePointerRules.push(rule);
        rule.media.mediaText = 'all';
      }
    }
  }
  return window.coarsePointerRules.length;
})()`;
const SWITCH_COARSE_POINTER_BLOCK_OFF = `(() => {
  for (const rule of window.coarsePointerRules || []) {
    rule.media.mediaText = ${JSON.stringify(COARSE_QUERY)};
  }
  delete window.coarsePointerRules;
})()`;
const coarsePointer = (name, then) => ({
  name,
  setup: async (ctx) => {
    if (!(await ctx.ev(SWITCH_COARSE_POINTER_BLOCK_ON))) {
      throw new Error('The stylesheet has no coarse-pointer block to switch on');
    }
    if (then) await then(ctx);
  },
  teardown: (ctx) => ctx.ev(SWITCH_COARSE_POINTER_BLOCK_OFF),
});

// The media tile's track is a button. Its title has to run out of room (so the ellipsis is doing
// its job), the ellipsis has to be set, and neither the track nor the tile may leave the window.
const MEDIA_TRACK_CUT_OFF = `(() => {
  const tile = document.getElementById('media-tile');
  const info = document.getElementById('media-tile-info');
  const title = document.getElementById('media-tile-title');
  if (!tile || !info || !title || info.tagName !== 'BUTTON') return false;
  const tileBox = tile.getBoundingClientRect();
  const infoBox = info.getBoundingClientRect();
  return title.scrollWidth > title.clientWidth &&
    getComputedStyle(title).textOverflow === 'ellipsis' &&
    infoBox.left >= tileBox.left - 1 && infoBox.right <= tileBox.right + 1 &&
    tileBox.left >= 0 && tileBox.right <= window.innerWidth;
})()`;

const tileDetails = (entityId) =>
  `#quick-controls [data-entity-id="${entityId}"] .tile-details-button`;
const tile = (entityId) => `#quick-controls [data-entity-id="${entityId}"]`;

const openBrightness = (ctx) => ctx.click(tileDetails('light.desk_lamp'));
const openDetails = (entityId) => (ctx) => ctx.click(tileDetails(entityId));
// For an entity the scene itself brings (extraStates): its tile is drawn when its state arrives.
const openArrivedDetails = (entityId) => async (ctx) => {
  await ctx.waitForSelector(tileDetails(entityId));
  await ctx.click(tileDetails(entityId));
};
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

// A custom colour typed but not saved, then Save: the three-way prompt, focused on Save and continue.
async function raiseUnsavedColorPrompt(ctx) {
  await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
  await openSettingsTab(ctx, 'personalization');
  await revealInSettings(ctx, '#custom-color-hex');
  await ctx.ev(`(() => {
    const hex = document.getElementById('custom-color-hex');
    hex.value = '#8E24AA';
    hex.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await ctx.click('#save-settings');
  await ctx.waitForExpression(
    `!document.querySelector('#confirm-modal')?.classList.contains('hidden') &&
      document.activeElement?.id === 'confirm-ok-btn'`,
    'the three-way prompt, focused on Save and continue'
  );
}

async function raiseReorganizeNotice(ctx) {
  await ctx.click('#reorganize-quick-controls-btn');
  await ctx.waitForExpression(`document.querySelector('#toast-container .toast.info')`);
}

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

// Types into a field the way a person does, so the input handlers run.
async function typeInto(ctx, selector, text) {
  await ctx.ev(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.focus();
    field.value = ${JSON.stringify(text)};
    field.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
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
// Back is hidden on the welcome step, so stepping back until then starts every scene from the
// same place, however the scenes were selected.
async function showFirstRunWelcome(ctx) {
  await ctx.waitForSelector('.first-run-onboarding:not(.hidden)');
  const back = `document.querySelector('.first-run-actions .btn-secondary:nth-child(2)')`;
  await ctx.ev(`(async () => {
    const back = ${back};
    // The URL and authorization steps are the most there is to step back from.
    for (let attempt = 0; attempt < 2 && !back.hidden; attempt += 1) {
      back.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  })()`);
  await ctx.waitForExpression(`${back}.hidden`, 'the first-run welcome step');
}

// Start-ups no change to a running app can show. Each starts an app of its own on the config.json
// that startup.config makes from the fixture's settings (see run.cjs), after the shared scenes.
const WIZARD_SHOWN = `document.querySelector('.first-run-onboarding:not(.hidden)')`;
const HEADER_DISCONNECTED = `!document.getElementById('connection-status').classList.contains('connected')`;
// A first install: only the window's place and seasonal themes off are saved, so the picture is
// the same whatever the date.
const firstInstall = (base) => ({
  windowPosition: base.windowPosition,
  ui: { seasonal: { enabled: false } },
});
// A saved token this computer cannot read: a profile moved to another computer or user account
// (Windows, macOS), or no unlocked keyring (Linux, where the check runs once the window is up).
const unreadableToken = (base) => ({
  ...base,
  homeAssistant: {
    ...base.homeAssistant,
    token: Buffer.from('not a ciphertext').toString('base64'),
    tokenEncrypted: true,
  },
});
// Browser authorization set up, and no authorization saved beside it.
const oauthWithNothingSaved = (base) => ({
  ...base,
  homeAssistant: { url: base.homeAssistant.url, authMethod: 'oauth' },
});
// An existing setup asked for its token or authorization again opens on a panel that says why,
// not on Welcome. With a title, it waits past any panel before it (restoring) for that one, and a
// start-up that drifts to another panel fails instead of capturing it.
async function showTokenPanel(ctx, title) {
  const shownTitle = `document.querySelector('#widget-state-panel .widget-state-title')?.textContent`;
  await ctx.waitForExpression(
    title ? `${shownTitle} === ${JSON.stringify(title)}` : shownTitle,
    title ? `the panel titled ${title}` : 'the token panel'
  );
  await ctx.expect(`!${WIZARD_SHOWN}`, 'an existing setup is not sent through Welcome');
}
const startupScenes = [
  // The header's dot is the hollow ring of no connection.
  {
    name: 'startup-first-run',
    startup: { config: firstInstall },
    setup: async (ctx) => {
      await ctx.waitForSelector('.first-run-onboarding:not(.hidden)');
      await ctx.expect(HEADER_DISCONNECTED, 'the header does not say connected');
    },
  },
  // A system language the app has as a pack that is not downloaded: the welcome step offers it.
  // Only Linux takes the system language from the environment of one app.
  {
    name: 'startup-first-run-ar-system',
    platforms: ['linux'],
    startup: {
      config: firstInstall,
      env: { LANGUAGE: 'ar', LANG: 'ar_EG.UTF-8', LC_ALL: '', LC_MESSAGES: '' },
    },
    setup: (ctx) => ctx.waitForSelector('#first-run-language-offer:not([hidden]) button'),
  },
  {
    name: 'startup-token-unreadable',
    keepToasts: true,
    startup: { config: unreadableToken },
    setup: (ctx) => showTokenPanel(ctx),
  },
  // Its "Enter token" opens Settings on General with the token field open, the reason above it.
  {
    name: 'startup-token-unreadable-settings',
    startup: { config: unreadableToken },
    setup: async (ctx) => {
      await showTokenPanel(ctx);
      await ctx.click('#widget-state-panel .widget-state-actions .btn:last-child');
      await ctx.waitForExpression(
        `document.activeElement?.id === 'ha-token'`,
        'the cursor in the token field'
      );
      await ctx.expect(
        `document.getElementById('secure-storage-notice').classList.contains('hidden')`,
        'the missing keyring is said once, in the line above the field'
      );
      await ctx.expect(
        `(() => {
          const page = document.querySelector('#settings-modal .modal-body').getBoundingClientRect();
          const caption = document.querySelector('#ha-token').closest('.settings-group')
            .querySelector('.settings-group-caption').getBoundingClientRect();
          return caption.top - page.top >= 12;
        })()`,
        'the Home Assistant caption is clear of the top of the page'
      );
    },
  },
  // The start after a token was entered on a computer with no keyring, which could not save it.
  {
    name: 'startup-token-not-saved',
    keepToasts: true,
    startup: {
      config: (base) => ({
        ...base,
        homeAssistant: { url: base.homeAssistant.url, authMethod: 'token' },
        tokenResetReason: 'not_persisted',
      }),
    },
    setup: (ctx) => showTokenPanel(ctx, 'Access token was not saved'),
  },
  // Browser authorization with no saved authorization to restore it from. Windows and macOS find
  // none and ask to reconnect. Linux under CI has no keyring, so it stops before looking and asks
  // for the keyring to be started or unlocked: that is the panel it captures, under a name that
  // says so.
  {
    name: 'startup-oauth-reauth',
    platforms: ['win32', 'darwin'],
    startup: { config: oauthWithNothingSaved },
    setup: (ctx) => showTokenPanel(ctx, 'Home Assistant authorization expired'),
  },
  {
    name: 'startup-oauth-keyring',
    platforms: ['linux'],
    startup: { config: oauthWithNothingSaved },
    setup: (ctx) => showTokenPanel(ctx, 'System keyring is unavailable'),
  },
];

// The wizard's authorization step, about to open `address`.
async function showFirstRunAuthorize(ctx, address) {
  await showFirstRunWelcome(ctx);
  await ctx.click('.first-run-actions .btn-primary');
  await ctx.waitForSelector('.first-run-content input');
  // The field keeps a draft from a scene before; this one starts from an empty field.
  await ctx.ev(`(() => {
    const field = document.querySelector('.first-run-content input');
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  })()`);
  await ctx.insertText(address);
  await ctx.click('.first-run-actions .btn-primary');
  await ctx.waitForSelector('.first-run-url');
}

// Every button the wizard shows lies inside its card and the window. When the whole card scrolled,
// a short window left step 3's Back and Connect below the fold of a scroller inside the window.
const WIZARD_ACTIONS_IN_VIEW = `(() => {
  const card = document.querySelector('.first-run-panel').getBoundingClientRect();
  const shown = [...document.querySelectorAll('.first-run-actions .btn')].filter(
    (button) => button.getClientRects().length > 0
  );
  return shown.length > 0 && shown.every((button) => {
    const box = button.getBoundingClientRect();
    return box.top >= card.top && box.bottom <= card.bottom && box.bottom <= window.innerHeight;
  });
})()`;

// Connect on the authorization step, against the mock Home Assistant, which leaves the widget's
// first request unanswered: the wizard waits as it does while the browser is open, for as long as
// the widget gives the server to answer (8 s). The Back button is Cancel meanwhile.
async function waitForFirstRunAuthorization(ctx) {
  await showFirstRunAuthorize(ctx, ctx.homeAssistantUrl);
  await ctx.click('.first-run-actions .btn-primary');
  await ctx.waitForSelector('.first-run-status[data-status="pending"]');
}

// Back to the welcome step from a wait, which Cancel ends.
async function cancelFirstRunAuthorization(ctx) {
  await ctx.ev(`(() => {
    const cancel = document.querySelector('.first-run-actions .btn-secondary:nth-child(2)');
    if (cancel?.classList.contains('btn-neutral')) cancel.click();
  })()`);
  await ctx.waitForExpression(
    `!document.querySelector('.first-run-actions .btn-primary').disabled`,
    'the wait to end'
  );
  await showFirstRunWelcome(ctx);
}

// The wizard's authorization step after an attempt on a server address nothing listens on, which
// fails at once and opens no browser. `says` is a part of the message the failure has to show, so
// a scene whose failure drifts to another one fails instead of capturing it.
async function failFirstRunAuthorization(ctx, says) {
  await showFirstRunAuthorize(ctx, '127.0.0.1:9');
  await ctx.click('.first-run-actions .btn-primary');
  await ctx.waitForSelector('.first-run-status[data-status="error"]');
  await ctx.expect(
    `document.querySelector('.first-run-status').textContent.includes(${JSON.stringify(says)})`,
    `the step says ${says}`
  );
}

// Settings opens one page at a time; this scrolls the wanted element to the top (or wherever `block`
// puts it) and opens any disclosure it sits in.
async function revealInSettings(ctx, selector, block = 'start') {
  await ctx.ev(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.closest('details')?.setAttribute('open', '');
    element?.scrollIntoView({ block: ${JSON.stringify(block)} });
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

// The threshold alert by default; the state change one shows the switch for unavailable and unknown.
async function openAlertConfig(ctx, entityId = 'sensor.office_temp') {
  await openSettingsTab(ctx, 'alerts');
  await ctx.waitForSelector('.edit-alert');
  await ctx.click(`.edit-alert[data-entity="${entityId}"]`);
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

// Gives an open pin new bounds, as dragging its corner does. Bounds can only change in edit mode;
// the pin redraws for its new size.
async function resizePin(ctx, entityId, size) {
  await ctx.ev(`(async () => {
    await window.electronAPI.setDesktopPinEditMode(true);
    await window.electronAPI.updateDesktopPinBounds(${JSON.stringify(entityId)}, ${JSON.stringify(size)});
    await window.electronAPI.setDesktopPinEditMode(false);
  })()`);
  await ctx.sleep(900);
}

// Every button of a pin lies inside its window, and none has its label cut short.
const PIN_BUTTONS_FIT = `(() => {
  const buttons = [...document.querySelectorAll('.desktop-pin-panel-button, .desktop-pin-light-preset')];
  const labels = [...document.querySelectorAll('.desktop-pin-panel-button-label')];
  return (
    buttons.length > 0 &&
    buttons.every((button) => {
      const box = button.getBoundingClientRect();
      return box.bottom <= innerHeight && box.right <= innerWidth;
    }) &&
    labels.every((label) => label.scrollWidth <= label.clientWidth)
  );
})()`;

async function expectPinButtonsFit(pin) {
  if (!(await pin.evaluate(PIN_BUTTONS_FIT))) {
    throw new Error('Layout check failed: a pin button is cut off or its label shortened');
  }
}

// A pin dragged a little bigger than the default 168x148, named for its size. Pins in that band ran
// their bottom row off the tile and cut its labels to "C...", so the scene fails if that is back.
const resizedPinScene = (family, entityId, size, extra = {}) =>
  pinScene(`pin-${family}-${size.width}x${size.height}`, entityId, {
    ...extra,
    setup: async (ctx) => {
      const pin = await ctx.openPin(entityId);
      await resizePin(ctx, entityId, size);
      await expectPinButtonsFit(pin);
      return { capture: pin };
    },
  });

// A pin at its default size whose buttons must all fit, for a language with long names.
const fittedPinScene = (name, entityId, extra = {}) =>
  pinScene(name, entityId, {
    ...extra,
    setup: async (ctx) => {
      const pin = await ctx.openPin(entityId);
      await expectPinButtonsFit(pin);
      return { capture: pin };
    },
  });

// A lamp that can only be switched on and off (a relay or a smart plug): no brightness to show.
// The fixture's own lights all dim, and a light added to it would join every list of lights.
const onOffLight = (now) => {
  const stamp = now.toISOString();
  return [
    {
      entity_id: 'light.porch',
      state: 'on',
      attributes: {
        friendly_name: 'Porch light',
        supported_color_modes: ['onoff'],
        color_mode: 'onoff',
      },
      last_changed: stamp,
      last_updated: stamp,
      context: { id: 'light.porch', parent_id: null, user_id: null },
    },
  ];
};
// A page of the one entity a scene pins, for one the pins page does not hold: only Quick Access
// entities can be pinned, and a second page keeps the tab strip the runner waits for.
const pinPage = (entityId) => ({
  customTabs: [
    { id: 'pins', name: 'Pins', entityIds: [entityId] },
    { id: 'default', name: 'Home', entityIds: ['light.desk_lamp'] },
  ],
  activeTabId: 'pins',
});

const pages = (set, activeTabId) => ({ customTabs: PAGE_SETS[set], activeTabId });

// A comparison graph of four temperatures on a page of its own, wide enough for two columns, with a
// day of history for three of them. Hovering it lists every series at the pointer's time.
const graphTooltipPage = {
  ...pages('graph', 'default'),
  comparisonGraphs: [
    {
      id: 'graph:temps',
      name: 'Temperatures',
      span: 2,
      entityIds: [
        'sensor.office_temp',
        'sensor.graph_living_temp',
        'sensor.graph_bedroom_temp',
        'sensor.graph_kitchen_temp',
      ],
    },
  ],
};

// Moves the pointer over the graph, `ratio` of the way across it, and checks the tooltip sits beside
// the pointer and not over the crosshair that marks it.
async function hoverGraph(ctx, ratio) {
  await ctx.waitForExpression(
    `document.querySelectorAll('.comparison-graph-frame polyline').length >= 3`,
    'the graph drawn from its history'
  );
  await ctx.ev(`(() => {
    const frame = document.querySelector('.comparison-graph-frame');
    const box = frame.getBoundingClientRect();
    frame.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: box.left + box.width * ${ratio},
      clientY: box.top + box.height / 2,
    }));
  })()`);
  await ctx.expect(
    `(() => {
      const tooltip = document.querySelector('.comparison-graph-tooltip');
      const crosshair = document.querySelector('.comparison-graph-crosshair');
      if (!tooltip || tooltip.hidden || !crosshair) return false;
      const box = tooltip.getBoundingClientRect();
      const line = crosshair.getBoundingClientRect().left;
      return line < box.left || line > box.right;
    })()`,
    'the tooltip does not cover the crosshair'
  );
}

// Keyboard focus rings only show after a key press, so press one before focusing from script.
async function focusWithKeyboard(ctx, selector) {
  await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
  await ctx.ev(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
}

// The page whose tiles open the helper, vacuum, to-do, calendar and repair dialogs.
const dialogsPage = { customTabs: PAGE_SETS.dialogs, activeTabId: 'default' };
// The page for the unreachable light and cover that buildUnavailableDevices brings.
const unavailablePage = {
  customTabs: [{ id: 'gone', name: 'Gone', entityIds: ['light.hall', 'cover.side_gate'] }],
  activeTabId: 'gone',
};
// A running and a paused timer between lit tiles, to see their tints against the accent.
const timersPage = {
  customTabs: [
    {
      id: 'timers',
      name: 'Timers',
      entityIds: ['light.desk_lamp', 'timer.laundry', 'timer.tea', 'climate.living_room'],
    },
  ],
  activeTabId: 'timers',
};
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
// The alert dialog's errors: under their own field and inside its column, the field marked invalid,
// the first one focused, no error toast, the duration field still level with the cooldown beside
// it, and the fields as wide as before the errors made the body scroll (window.__alertFieldEnd).
const ALERT_ERRORS_UNDER_FIELDS = `(() => {
  const box = (element) => element.getBoundingClientRect();
  const under = (id) => {
    const field = document.getElementById(id);
    const error = document.getElementById(id + '-error');
    if (!field || !error || field.getAttribute('aria-invalid') !== 'true') return false;
    return box(error).top >= box(field).bottom && box(error).left >= box(field).left - 1 &&
      box(error).right <= box(field).right + 1;
  };
  return under('alert-threshold') && under('alert-duration') &&
    document.activeElement?.id === 'alert-threshold' &&
    !document.querySelector('#toast-container .toast.error') &&
    Math.abs(box(document.getElementById('alert-duration')).top -
      box(document.getElementById('alert-cooldown')).top) < 1 &&
    Math.abs(box(document.getElementById('alert-threshold')).right - window.__alertFieldEnd) < 0.5;
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
// A number sensor's line lies along the foot of its tile, below the name and the reading: a name on
// two lines or a large value makes the tile taller instead of putting the line through the digits.
const SENSOR_SPARKLINES_CLEAR_OF_TEXT = `(() => {
  const lines = [...document.querySelectorAll('#quick-controls .control-sensor-sparkline')];
  return lines.length > 0 && lines.every((line) => {
    const band = line.getBoundingClientRect();
    const tile = line.closest('.control-item').getBoundingClientRect();
    return band.bottom <= tile.bottom + 1 &&
      [...line.closest('.control-info').querySelectorAll('.control-name, .control-sensor-readout')]
        .every((text) => text.getBoundingClientRect().bottom <= band.top + 0.5);
  });
})()`;
// Tiles in one row hang their names from the same line: a scene, a switch, a sensor and a timer
// differ in what sits below the name, not above it. A compact sensor drops its icon, so it is left
// out, and so are the tiles that lay themselves out.
const TILE_NAMES_ALIGNED = `(() => {
  const rows = new Map();
  for (const tile of document.querySelectorAll('#quick-controls .control-item')) {
    const name = tile.querySelector('.control-name');
    const icon = tile.querySelector('.control-icon');
    if (!name || !icon || !icon.getClientRects().length) continue;
    if (tile.matches('.media-player-entity, .comparison-graph-tile, .camera-preview-tile, [data-chart-type="gauge"]')) continue;
    const box = tile.getBoundingClientRect();
    const row = Math.round(box.top);
    rows.set(row, [...(rows.get(row) || []), name.getBoundingClientRect().top - box.top]);
  }
  // Within half a pixel: enlarged text lands on fractions.
  return rows.size > 0 && [...rows.values()].every((tops) => Math.max(...tops) - Math.min(...tops) <= 0.5);
})()`;
const NO_SIDEWAYS_SCROLL = `document.documentElement.scrollWidth <= innerWidth + 1`;
// The camera viewer's toolbar with its sound toggle: the status text and the buttons lie inside the
// dialog, do not overlap (side by side, or the buttons wrapped under the text), and the status
// text is not cut off.
const CAMERA_TOOLBAR_FITS = `(() => {
  const content = document.querySelector('.camera-modal .modal-content');
  const info = content?.querySelector('.camera-info');
  const buttons = content?.querySelector('.camera-mode-buttons');
  if (!info || !buttons) return false;
  const box = content.getBoundingClientRect();
  const infoBox = info.getBoundingClientRect();
  const buttonsBox = buttons.getBoundingClientRect();
  const sideways = Math.min(infoBox.right, buttonsBox.right) - Math.max(infoBox.left, buttonsBox.left);
  const upright = Math.min(infoBox.bottom, buttonsBox.bottom) - Math.max(infoBox.top, buttonsBox.top);
  return [infoBox, buttonsBox].every((part) => part.left >= box.left - 1 && part.right <= box.right + 1) &&
    (sideways <= 1 || upright <= 1) && [...info.children].every((part) => part.scrollWidth <= part.clientWidth + 1);
})()`;
// A lost connection: the panel sits above Quick Access with its buttons in view, the page has not
// scrolled, and the tiles are dimmed.
const OFFLINE_PANEL_IN_VIEW = `(() => {
  const panel = document.getElementById('widget-state-panel');
  const retry = panel?.querySelector('.btn-secondary');
  if (!retry) return false;
  const box = retry.getBoundingClientRect();
  return panel.nextElementSibling === document.querySelector('.controls-section') &&
    document.querySelector('.widget-content').scrollTop === 0 &&
    box.top >= 0 && box.bottom <= innerHeight &&
    getComputedStyle(document.querySelector('#quick-controls .control-item')).opacity < 1;
})()`;
const showOffline = async (ctx) => {
  await ctx.goOffline();
  await ctx.expect(OFFLINE_PANEL_IN_VIEW, 'the connection panel is in view above dimmed tiles');
};
// The light's colour swatches lie in full rows, six in one or three in two, never one left alone.
const SWATCH_ROWS_EVEN = `(() => {
  const swatches = [...document.querySelectorAll('.brightness-modal .light-color-swatch')];
  if (swatches.length !== 6) return false;
  const rows = new Map();
  swatches.forEach((swatch) => {
    const top = Math.round(swatch.getBoundingClientRect().top);
    rows.set(top, (rows.get(top) || 0) + 1);
  });
  const counts = [...rows.values()];
  return counts.every((count) => count === counts[0]);
})()`;
// The light pop-up's rows run the same width: a slider capped for the narrower pop-up it once was
// stopped short of the presets under it on both sides.
const LIGHT_ROWS_SHARE_EDGES = `(() => {
  const slider = document.querySelector('.brightness-modal .brightness-slider');
  const presets = document.querySelector('.brightness-modal .brightness-presets');
  if (!slider || !presets) return false;
  const a = slider.getBoundingClientRect();
  const b = presets.getBoundingClientRect();
  return Math.abs(a.left - b.left) <= 1 && Math.abs(a.right - b.right) <= 1;
})()`;
// An unavailable pop-up shows its note and what is still there to read or use: no block in its body
// stands empty, with only its padding between the note and the footer.
const NO_EMPTY_BLOCK_IN_UNAVAILABLE_DIALOG = `(() => {
  const body = document.querySelector('.modal.entity-unavailable .modal-body');
  if (!body?.querySelector('.dialog-unavailable-note')) return false;
  const shown = (element) => element.getClientRects().length > 0;
  return [...body.children].filter(shown).every((block) =>
    [...block.querySelectorAll('*')].some((part) => shown(part) && part.children.length === 0));
})()`;
// The thermostat's modes, fan speeds and presets lie in rows with none left alone on the last row.
const CLIMATE_CHIPS_IN_FULL_ROWS = `[...document.querySelectorAll(
  '.climate-modal :is(.climate-mode-buttons, .climate-option-buttons)'
)].every((grid) => {
  const rows = new Map();
  [...grid.children].filter((chip) => chip.getClientRects().length > 0).forEach((chip) => {
    const top = Math.round(chip.getBoundingClientRect().top);
    rows.set(top, (rows.get(top) || 0) + 1);
  });
  const counts = [...rows.values()];
  return counts.length < 2 || counts.at(-1) > 1;
})`;
// Every mode and option label lies inside its chip. Three chips a row in a narrow window are about
// 72px wide, and German's "Heizen/Kühlen" ran 85px, past both of its chip's edges.
const CLIMATE_LABELS_IN_CHIPS = `[...document.querySelectorAll(
  '.climate-modal :is(.climate-mode-btn, .climate-fan-mode-btn, .climate-preset-mode-btn)'
)].every((chip) => (chip.querySelector('.climate-mode-label') || chip).scrollWidth <= chip.clientWidth)`;
const openUnavailable = (open) => async (ctx) => {
  await open(ctx);
  await ctx.waitForExpression(
    NO_EMPTY_BLOCK_IN_UNAVAILABLE_DIALOG,
    'no empty block under the note'
  );
};
// Every toast on screen lies above or below the connection panel, and under the window's header,
// so none of the panel's words or buttons is covered, and neither are the window's own. The newest
// toast is one of them: a stack with no room beside the panel holds back its older ones instead.
const TOASTS_CLEAR_OF_OFFLINE_PANEL = `(() => {
  const panel = document.getElementById('widget-state-panel')?.getBoundingClientRect();
  const header = document.querySelector('.widget-header').getBoundingClientRect();
  const toasts = [...document.querySelectorAll('#toast-container .toast')];
  const shown = toasts.filter((toast) => toast.getClientRects().length > 0);
  return !!panel && shown.includes(toasts.at(-1)) && shown.every((toast) => {
    const box = toast.getBoundingClientRect();
    return (box.top >= panel.bottom || box.bottom <= panel.top) && box.top >= header.bottom;
  });
})()`;
// A full stack of three while Home Assistant is away, each a command that could not reach it: one
// from the palette, the media card's play button and a switch's tile. Three errors, because errors
// stay until they are dismissed.
async function raiseThreeOfflineErrors(ctx) {
  await raiseRefusedCommand(ctx);
  await ctx.click('#media-tile-play');
  await ctx.click('#quick-controls .control-item[data-entity-id="switch.compound_name"]');
  await ctx.waitForExpression(
    `document.querySelectorAll('#toast-container .toast.error').length === 3`,
    'three error toasts'
  );
}

// Every label in a Settings row keeps room to be read, at 150% text size and in a narrow window.
const SETTING_LABELS_READABLE = `[...document.querySelectorAll('#settings-modal .tab-content.active .setting-text')]
  .filter((text) => text.getClientRects().length > 0).every((text) => text.getBoundingClientRect().width >= 100)`;

// How a page of tiles is laid out, whatever its names and readings: names on one line across a row,
// and the sensors' lines clear of their text.
async function expectTilesLaidOut(ctx) {
  // A line is drawn when its sensor's history arrives, a round trip after the tile.
  await ctx.waitForExpression(
    `!!document.querySelector('#quick-controls .control-sensor-sparkline')`,
    "a number sensor's line"
  );
  await ctx.expect(TILE_NAMES_ALIGNED, 'the names in a row start at the same height');
  await ctx.expect(SENSOR_SPARKLINES_CLEAR_OF_TEXT, 'no sparkline runs through a name or reading');
}

// The same, and every part of every tile inside it.
// A reading too wide for its tile is drawn smaller, down to 10px, before it is cut with an
// ellipsis. One cut while still larger was fitted in the fallback face before the display font
// arrived, or before the density changed, and never fitted again. Waited for, since the fit
// follows the font's arrival by a frame.
async function expectSensorReadingsFitted(ctx) {
  await ctx.waitForExpression(
    `[...document.querySelectorAll('#quick-controls .control-sensor-value')].every((value) =>
      value.scrollWidth <= value.clientWidth + 1 || parseFloat(getComputedStyle(value).fontSize) <= 10)`,
    'every sensor reading whole, or at its smallest size'
  );
}

async function expectTilesInOrder(ctx) {
  await ctx.expect(TILES_HOLD_THEIR_CONTENT, 'every tile holds its content');
  await expectTilesLaidOut(ctx);
}

const withPage = (set, activeTabId = 'default') => ({
  customTabs: PAGE_SETS[set],
  activeTabId,
});
const edgePage = withPage('edge');
const formatsPage = withPage('formats');
const FORMAT_SIZE = { width: 520, height: 1040 };
// The list of entities is shown only while the Entity hotkeys switch is on, so every scene that
// photographs it turns the switch on.
const hotkeysOn = { globalHotkeys: { enabled: true, hotkeys: {} } };
// An earlier version let a sensor's tile menu save a hotkey that does nothing.
const hotkeysWithSensor = {
  globalHotkeys: { enabled: true, hotkeys: { 'sensor.office_temp': 'Ctrl+Alt+T' } },
};
const SENSOR_HOTKEY_ROW = `(() => {
  const row = document.querySelector('#hotkeys-list .hotkey-item');
  const field = row?.querySelector('.hotkey-input');
  return field?.dataset.entityId === 'sensor.office_temp' && field.disabled &&
    !row.querySelector('.hotkey-action-select') &&
    row.querySelector('.btn-clear-hotkey')?.checkVisibility() === true &&
    row.querySelector('.hotkey-item-note')?.textContent.trim().length > 0;
})()`;
// Hotkeys for two rows, so the Hotkeys scenes show a row with a hotkey beside one without. The list
// is in name order, so the second is a row that sits among the first few the "light" search shows
// (the Colour strip comes before the Desk lamp, whose hotkey fell below the fold).
const hotkeyPage = {
  ...edgePage,
  globalHotkeys: {
    enabled: true,
    hotkeys: {
      'light.hallway_ceiling_long': { hotkey: 'Ctrl+Shift+Space', action: 'toggle' },
      'light.colour_strip': { hotkey: 'Ctrl+Alt+L', action: 'toggle' },
    },
  },
};

// The Hotkeys page, with its list drawn from the search box. The box keeps what was typed into it
// when Settings closes and the list is drawn from it, so a scene that searches leaves the next one
// with whatever that search found (nothing, for the one that looks for nothing). Every scene that
// opens the page therefore sets the box itself, empty unless it wants a filter, and waits for the
// list or for the line that says nothing matched.
async function openHotkeysPage(ctx, filter = '', { expectNoMatch = false } = {}) {
  await openSettingsTab(ctx, 'hotkeys');
  await ctx.ev(`(() => {
    const search = document.getElementById('hotkey-entity-search');
    if (!search) return;
    search.value = ${JSON.stringify(filter)};
    search.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await ctx.waitForSelector(
    expectNoMatch ? '#hotkeys-list .hotkeys-empty' : '#hotkeys-list .hotkey-item'
  );
  await ctx.sleep(300);
}

async function openHotkeysFor(ctx, filter, options) {
  await openHotkeysPage(ctx, filter, options);
  await revealInSettings(ctx, '#hotkeys-list');
}

// A Dashboard section opens with a transition, and what is inside it is only where it will stay
// once the body has reached its full height and nothing in it is still moving. A fixed wait could
// end mid-transition on a slow runner.
async function waitForSectionOpen(ctx, sectionId) {
  await ctx.waitForExpression(
    `(() => {
      const body = document.querySelector(${JSON.stringify(`#${sectionId} .section-body`)});
      return !!body && !body.closest('.collapsed') &&
        !body.getAnimations({ subtree: true }).length &&
        Math.abs(body.getBoundingClientRect().height - body.scrollHeight) < 1;
    })()`,
    `${sectionId} to finish opening`
  );
}

async function openPrimaryCardsList(ctx) {
  await openSettingsTab(ctx, 'dashboard');
  // A section remembers whether it was open, so only open it when it is shut.
  await ctx.ev(`(() => {
    const section = document.getElementById('primary-cards-section');
    if (section.classList.contains('collapsed')) section.querySelector('.section-toggle').click();
  })()`);
  await ctx.waitForSelector('#primary-cards-list .entity-item');
  await waitForSectionOpen(ctx, 'primary-cards-section');
  await revealInSettings(ctx, '#primary-cards-section');
}

// The value a select shows fits between its padding: measured in its own font, the selected
// option's text is no wider than the box it is drawn in.
const selectShowsItsValue = (selector) => `(() => {
  const select = document.querySelector(${JSON.stringify(selector)});
  const text = select?.selectedOptions[0]?.textContent.trim();
  if (!text) return false;
  const style = getComputedStyle(select);
  const context = document.createElement('canvas').getContext('2d');
  context.font = style.font;
  const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return context.measureText(text).width <= room;
})()`;

// The search field and the count of matches under it are inside the visible part of the page.
const SEARCH_BOX_IN_VIEW = `(() => {
  const page = document.querySelector('#settings-modal .modal-body');
  const field = document.getElementById('settings-search');
  const count = document.getElementById('settings-search-status');
  if (!page || !field || !count || page.scrollTop < 100) return false;
  const top = page.getBoundingClientRect().top;
  return field.getBoundingClientRect().top >= top - 1 && count.getBoundingClientRect().top >= top - 1;
})()`;

// A Settings list with a scroller of its own is shorter than the page that scrolls it, so the page
// can bring the whole box into view instead of the two taking turns.
const listFitsSettingsPage = (selector) => `(() => {
  const list = document.querySelector(${JSON.stringify(selector)});
  const page = list?.closest('#settings-modal .modal-body');
  return !!page && list.scrollHeight > list.clientHeight &&
    list.getBoundingClientRect().height <= page.clientHeight;
})()`;

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

// The Updates row of Settings > Advanced as it looks for a given result. The app's update events
// come from its main process, which a scene cannot send, and the update module is bundled out of
// the page's reach, so this writes the line the way src/update-status.js draws a state. A scene
// names the event and what it should leave on screen; tests/unit/update-markup.test.js runs the
// module on that event and fails if the text, state, button or bar written here differ from it.
async function showUpdateState(ctx, { state, text, install = null, progress = null }) {
  await openSettingsTab(ctx, 'advanced');
  await ctx.ev(`(() => {
    const status = document.getElementById('update-status');
    status.dataset.state = ${JSON.stringify(state)};
    document.getElementById('update-status-text').textContent = ${JSON.stringify(text)};
    const install = document.getElementById('install-update-btn');
    install.classList.toggle('hidden', ${JSON.stringify(install)} === null);
    if (${JSON.stringify(install)} !== null) {
      document.getElementById('install-update-text').textContent = ${JSON.stringify(install)};
    }
    const bar = document.getElementById('update-progress');
    bar.classList.toggle('hidden', ${JSON.stringify(progress)} === null);
    if (${JSON.stringify(progress)} !== null) {
      document.getElementById('progress-fill').style.width = '${progress}%';
      bar.setAttribute('aria-valuenow', '${progress}');
      // As the app writes it, in the language of the page.
      document.getElementById('progress-text').textContent = new Intl.NumberFormat(
        document.documentElement.lang || 'en',
        { style: 'percent' }
      ).format(${progress} / 100);
    }
    status.scrollIntoView({ block: 'center' });
  })()`);
}

const updateScene = (name, event, shown) => ({
  name,
  update: { event, shown },
  setup: (ctx) => showUpdateState(ctx, shown),
});

// The camera viewer with its sound toggle showing. The toggle appears over an HLS stream and the
// fixture's camera has none, so the scene shows it to see how the toolbar holds three buttons.
async function openCameraViewerWithMute(ctx) {
  await ctx.click(tile('camera.driveway'));
  await ctx.waitForSelector('.camera-modal #mute-btn');
  await ctx.ev(`document.getElementById('mute-btn').hidden = false`);
  // The dialog scales in, and its boxes are only comparable once it has settled.
  await ctx.waitForExpression(
    CAMERA_TOOLBAR_FITS,
    'the status text and the three buttons fit side by side'
  );
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

// A command row has its entity's icon, so in a narrow window, where an entity's type pill gives
// way, its Command mark is all that tells "Arm Home alarm away" from the alarm itself. The mark is a
// glyph chip no wider than it is tall, so the names in view, which differ only at their ends, are
// whole. (A word pill cut every one of them off where the commands differ.)
const COMMAND_ROWS_MARKED = `(() => {
  const list = document.querySelector('.command-palette-results').getBoundingClientRect();
  const rows = [...document.querySelectorAll('.command-palette-result')].filter(
    (row) => row.querySelector('.command-palette-result-domain.is-row-kind') &&
      row.getBoundingClientRect().bottom <= list.bottom
  );
  return rows.length > 0 && rows.every((row) => {
    const chip = row.querySelector('.command-palette-result-domain').getBoundingClientRect();
    const glyph = row.querySelector('.command-palette-result-kind-icon svg')?.getBoundingClientRect();
    const name = row.querySelector('.command-palette-result-name');
    return glyph?.width > 0 && chip.width <= chip.height + 1 &&
      name.scrollWidth <= name.clientWidth;
  });
})()`;

// The palette with nothing typed: what was used last, the pages, the page on screen, then the rest.
async function openPaletteEmpty(ctx) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.waitForSelector('.command-palette-result');
}

// An entity with nothing to open or run: Enter keeps the palette and says so.
async function pressEnterOnEntityWithoutAction(ctx) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.insertText('front door');
  await ctx.waitForExpression(
    `document.querySelector('.command-palette-result.highlighted')?.textContent.includes('Front door')`,
    'the Front door row'
  );
  await ctx.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
  await ctx.waitForExpression(
    `!document.querySelector('.command-palette-hint')?.hidden`,
    'the hint under the results'
  );
}

// A search that finds nothing.
async function searchPaletteForNothing(ctx) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.insertText('zzzzz');
  await ctx.waitForExpression(
    `!document.querySelector('.command-palette-empty')?.hidden`,
    'the empty message'
  );
}

// An alert whose entity Home Assistant does not list, beside one it does.
// The id is long and has nowhere to break, as Home Assistant's own ids often are, so the row has to
// break it rather than push its buttons out of the card.
const alertsWithMissingEntity = {
  entityAlerts: {
    enabled: true,
    alerts: {
      ...alertsConfig.entityAlerts.alerts,
      'sensor.living_room_north_wall_temperature_sensor_behind_tv': {
        onStateChange: false,
        onSpecificState: true,
        onNumericThreshold: false,
        targetState: 'unavailable',
        comparison: 'above',
        threshold: null,
        durationSeconds: 0,
        cooldownSeconds: 0,
        quietHours: { enabled: false, start: '22:00', end: '07:00' },
      },
    },
  },
};

// Every alert's Edit and Remove lie inside its row, which is as wide as the card.
const ALERT_BUTTONS_IN_ROW = `(() => {
  const rows = [...document.querySelectorAll('#inline-alerts-list .alert-item')];
  return rows.length > 0 && rows.every((row) => {
    const box = row.getBoundingClientRect();
    const buttons = [...row.querySelectorAll('.alert-actions button')];
    return buttons.length === 2 && buttons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.left >= box.left - 1 && rect.right <= box.right + 1;
    });
  });
})()`;

// A command Home Assistant refuses: the mock turns down every call for the unreachable lamp, and
// the palette reports the reason in an error toast, as the app does for any failed command. The
// lamp's name comes from Home Assistant and is never translated, and a command row is the one with
// no state beside it, so this finds the command in any language.
const REFUSED_COMMAND_ROW = `[...document.querySelectorAll('.command-palette-result')].find((row) =>
  row.querySelector('.command-palette-result-name')?.textContent.includes('Unreachable lamp') &&
  !row.querySelector('.command-palette-result-state')?.textContent)`;

async function raiseRefusedCommand(ctx) {
  await ctx.ev(`document.activeElement?.blur?.()`);
  await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
  await ctx.waitForExpression(
    `document.activeElement?.classList.contains('command-palette-input')`
  );
  await ctx.insertText('unreachable');
  await ctx.waitForExpression(REFUSED_COMMAND_ROW, 'a command for the unreachable lamp');
  await ctx.ev(`${REFUSED_COMMAND_ROW}.click()`);
  await ctx.waitForExpression(
    `document.querySelector('#toast-container .toast.error')`,
    'the error toast'
  );
}

// A problem toast leads with its status icon and ends with its close button, which sits inside the
// toast and clear of the text, on either side in either direction.
const PROBLEM_TOASTS_LAID_OUT = `(() => {
  const toasts = [...document.querySelectorAll('#toast-container .toast.error, #toast-container .toast.warning')];
  return toasts.length > 0 && toasts.every((toast) => {
    const box = toast.getBoundingClientRect();
    const text = toast.querySelector('.toast-message').getBoundingClientRect();
    const close = toast.querySelector('.toast-close')?.getBoundingClientRect();
    return !!toast.querySelector('.toast-icon svg') && !!close &&
      close.left >= box.left && close.right <= box.right &&
      close.top >= box.top && close.bottom <= box.bottom &&
      (close.left >= text.right || close.right <= text.left);
  });
})()`;

// The problem toast's text runs onto a second line. Its icon and close button only take room from
// text that wraps, so a reason short enough for one line would leave them unchecked.
const PROBLEM_TOAST_WRAPS = `(() => {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('#toast-container .toast.error .toast-message'));
  return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size > 1;
})()`;

// The mock's reason is English, as Home Assistant's usually is, whatever language the app is in. In
// an Arabic toast it keeps its own direction, so its full stop stays right of its last word; it took
// the toast's direction once and sat at the far left of the line (".powered on and connected to
// Home Assistant").
const PROBLEM_TOAST_REASON_KEEPS_ITS_STOP = `(() => {
  const text = document.querySelector('#toast-container .toast.error .toast-message')?.firstChild;
  const stop = (text?.textContent || '').lastIndexOf('.');
  if (stop < 1) return false;
  const box = (start) => {
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 1);
    return range.getBoundingClientRect();
  };
  const word = box(stop - 1);
  const mark = box(stop);
  return Math.abs(mark.top - word.top) < 2 && mark.left >= word.right - 1;
})()`;

// The edit-mode hint is a long notice, and a refused command adds a problem toast to the stack.
// Both are raised by the app, so the stack has the icons, the close button and the layout the app
// gives it, which a toast built here by hand did not.
async function showToasts(ctx) {
  await ctx.ev(
    `document.querySelectorAll('#toast-container .toast').forEach((toast) => toast.remove())`
  );
  await raiseRefusedCommand(ctx);
  await ctx.click('#reorganize-quick-controls-btn');
  await ctx.waitForSelector('#toast-container .toast.info');
  await ctx.sleep(500);
  await ctx.expect(PROBLEM_TOAST_WRAPS, 'the error toast wrapping onto a second line');
  await ctx.expect(PROBLEM_TOASTS_LAID_OUT, 'the error toast with its icon and close button');
}

// The notifications Home Assistant holds arrive over the app's subscription: the bell shows them and
// the panel draws their Markdown with its own rows, English text as Home Assistant writes it under
// whatever language the app is in. Rows drawn by hand once hid that Arabic scrambled the Markdown
// paragraphs, so every scene of the panel takes this way. Two notifications give it its footer too,
// the count and Dismiss all, as the app writes them.
async function openNotifications(ctx) {
  ctx.showNotifications();
  await ctx.waitForSelector('#persistent-notifications-btn:not(.hidden)');
  await ctx.click('#persistent-notifications-btn');
  await ctx.waitForSelector(
    '#persistent-notifications-modal:not(.hidden) .persistent-notification-message a'
  );
}

async function openDiagnostics(ctx) {
  await openSettingsTab(ctx, 'general');
  await ctx.click('#connection-diagnostics-btn');
  await ctx.waitForSelector('.diagnostics-report');
}

// A saved custom colour in the summary line and the hex field of the editor under it.
const customColour = { customColors: [{ id: 'custom-ab34cd', name: '', color: '#AB34CD' }] };

// Text and status colour in both themes for accents from the pale to the saturated end. The
// wizard's scenes come last (see below), because they empty the server address.
const CONTRAST_ACCENTS = ['original', 'indigo', 'rose', 'aqua'];
const contrastScenes = (suffix, make) =>
  ['dark', 'light'].flatMap((theme) =>
    CONTRAST_ACCENTS.map((accent) => ({
      name: `contrast-${theme}-${accent}-${suffix}`,
      ui: { theme, accent },
      ...make(theme),
    }))
  );

// The connection result lines Settings shows, in the three states, without needing a server that
// fails: written the way renderConnectionStatus writes them.
async function showConnectionResults(ctx) {
  await openSettingsTab(ctx, 'general');
  await ctx.ev(`(() => {
    document.querySelector('#test-ha-connection-btn')?.closest('details')?.setAttribute('open', '');
    const write = (id, type, message) => {
      const status = document.getElementById(id);
      status.classList.remove('hidden');
      status.dataset.status = type;
      status.innerHTML = '<span class="connection-status-text"></span>';
      status.firstChild.textContent = message;
    };
    write('ha-oauth-status', 'success', 'Connected with Home Assistant authorization.');
    write('test-ha-connection-status', 'error', 'Could not reach Home Assistant at that URL.');
    document.querySelector('#test-ha-connection-btn')?.scrollIntoView({ block: 'center' });
  })()`);
}

// The profile sync error and the on-device warning under Advanced: the other status colours
// Settings uses. The sync section is hidden until sync is set up, so it is opened and filled here.
async function showSyncError(ctx) {
  await openSettingsTab(ctx, 'advanced');
  await ctx.ev(`(() => {
    const error = document.getElementById('profile-sync-error');
    error.textContent = 'The sync file could not be read. Sync is paused until it is fixed.';
    error.closest('.hidden, [hidden]')?.classList.remove('hidden');
    document.querySelectorAll('#settings-modal .form-warning').forEach((warning) => {
      if (warning.closest('#advanced-tab')) warning.classList.remove('hidden');
    });
    error.scrollIntoView({ block: 'center' });
  })()`);
}

// A light whose brightness (75%) and colour (the first swatch) are two of the dialog's presets, so
// the chips show which one is selected. The fixture's own lights match none of them.
const presetLight = (now) => {
  const stamp = now.toISOString();
  return [
    {
      entity_id: 'light.preset_demo',
      state: 'on',
      attributes: {
        friendly_name: 'Preset lamp',
        brightness: 191,
        supported_color_modes: ['color_temp', 'rgb'],
        color_mode: 'rgb',
        rgb_color: [255, 179, 71],
        color_temp_kelvin: 3200,
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
      },
      last_changed: stamp,
      last_updated: stamp,
      context: { id: 'light.preset_demo', parent_id: null, user_id: null },
    },
  ];
};

// The language packs on the General page, one row each.
async function openLanguagePacks(ctx) {
  await openSettingsTab(ctx, 'general');
  await ctx.waitForSelector('#language-packs-list .language-pack-row');
  await revealInSettings(ctx, '#language-packs-list', 'center');
}

// A camera Home Assistant has lost. Its page puts it beside the fixture's camera, whose snapshots
// fail, and a lamp.
const offlineCamera = (now) => {
  const stamp = now.toISOString();
  return [
    {
      entity_id: 'camera.porch',
      state: 'unavailable',
      attributes: { friendly_name: 'Porch' },
      last_changed: stamp,
      last_updated: stamp,
      context: { id: 'camera.porch', parent_id: null, user_id: null },
    },
  ];
};
const cameraTilesPage = {
  customTabs: [
    {
      id: 'default',
      name: 'Cameras',
      entityIds: ['camera.driveway', 'camera.porch', 'light.desk_lamp'],
    },
  ],
  activeTabId: 'default',
  quickAccessTileOptions: {
    'camera.driveway': { cameraPreviewRefresh: '30s' },
    'camera.porch': { cameraPreviewRefresh: '30s' },
  },
};
// Each camera tile has settled: the failed snapshot and the offline camera have said so.
const waitForCameraTiles = (ctx) =>
  ctx.waitForExpression(
    `!!document.querySelector('${tile('camera.driveway')}[data-camera-preview-state="error"]') &&
      !!document.querySelector('${tile('camera.porch')}[data-camera-preview-state="unavailable"]')`,
    'the camera tiles settled on their messages'
  );

// A radio stream with a programme name longer than the media tile has room for: no length, so its
// seek row is hidden.
const radioStream = (now) => {
  const stamp = now.toISOString();
  return [
    {
      entity_id: 'media_player.kitchen_radio',
      state: 'playing',
      attributes: {
        friendly_name: 'Kitchen radio',
        media_title: 'The Late Evening Jazz Session with Guests from the Village Vanguard',
        media_artist: 'Jazz 24',
        volume_level: 0.4,
        supported_features: 152463,
      },
      last_changed: stamp,
      last_updated: stamp,
      context: { id: 'media_player.kitchen_radio', parent_id: null, user_id: null },
    },
  ];
};

// Restore points that differ by what they hold, one of them with a page nobody named. The list is
// built when the dialog opens, so the restore points are put back as they were straight after.
async function openRestoreDashboard(ctx) {
  await openSettingsTab(ctx, 'advanced');
  await ctx.ev(`(async () => {
    const config = await window.electronAPI.getConfig();
    const url = new URL(config.homeAssistant.url);
    const key = 'dashboard-restore-points:' + url.origin + url.pathname.replace(/\\/+$/, '');
    const before = localStorage.getItem(key);
    const hour = 60 * 60 * 1000;
    const layout = (pages) => ({ customTabs: pages, favoriteEntities: [], comparisonGraphs: [] });
    const home = (tiles) => ({
      id: 'default',
      name: 'Home',
      entityIds: ['light.desk_lamp', 'fan.office', 'cover.garage', 'sensor.office_temp'].slice(0, tiles),
    });
    const now = Date.now();
    localStorage.setItem(key, JSON.stringify([
      { at: now - hour, layout: layout([home(4), { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] }]) },
      { at: now - 2 * hour, layout: layout([home(3), { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] }]) },
      { at: now - 26 * hour, layout: layout([{ id: 'default', name: 'All', nameIsDefault: true, entityIds: ['light.desk_lamp', 'fan.office'] }]) },
    ]));
    document.getElementById('dashboard-history-btn').click();
    if (before === null) localStorage.removeItem(key);
    else localStorage.setItem(key, before);
  })()`);
  await ctx.waitForSelector('.dashboard-restore-entry');
}

const scenes = [
  // The main view and the dialogs opened from it, dark and in English.
  { name: 'main-dark', setup: expectTilesLaidOut },
  {
    name: 'popup-brightness',
    setup: async (ctx) => {
      await openBrightness(ctx);
      await ctx.waitForSelector('.brightness-modal .brightness-presets');
      await ctx.expect(LIGHT_ROWS_SHARE_EDGES, 'the brightness slider as wide as the presets');
    },
  },
  { name: 'popup-climate', setup: openClimate },
  { name: 'edit-mode', setup: toggleEditMode },
  { name: 'settings', setup: (ctx) => openSettingsTab(ctx, 'general') },
  { name: 'settings-appearance', setup: (ctx) => openSettingsTab(ctx, 'personalization') },
  { name: 'dialog-manage-quick-access', setup: (ctx) => ctx.click('#manage-quick-controls-btn') },
  // A search that finds nothing: the message sits in the middle of a list that keeps its height.
  {
    name: 'dialog-manage-quick-access-nomatch',
    setup: async (ctx) => {
      await ctx.click('#manage-quick-controls-btn');
      await ctx.waitForSelector('#quick-controls-search');
      await ctx.ev(`(() => {
        const input = document.getElementById('quick-controls-search');
        input.value = 'zzzz';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await ctx.waitForSelector('#quick-controls-list .entity-selector-empty');
    },
  },
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
  // A list taller than the dialog scrolls, and the add field stays at the top of it instead of
  // going off with the first rows.
  {
    name: 'popup-todo-scrolled',
    config: {
      customTabs: [{ id: 'default', name: 'Home', entityIds: ['todo.errands'] }],
      activeTabId: 'default',
    },
    size: { width: 500, height: 420 },
    setup: async (ctx) => {
      await ctx.click(tile('todo.errands'));
      await ctx.waitForSelector('.todo-item-row');
      await ctx.ev(`(() => {
        const body = document.querySelector('.todo-modal .modal-body');
        body.scrollTop = body.scrollHeight;
      })()`);
      await ctx.waitForExpression(
        `(() => {
          const content = document.querySelector('.todo-modal .modal-content');
          const body = content.querySelector('.modal-body');
          const form = document.querySelector('.todo-add-form').getBoundingClientRect();
          const field = document.querySelector('.todo-add-form');
          // Once the dialog has stopped sliding in, the field sits on the body's top edge, over
          // its own backing.
          return (
            !content.getAnimations().length &&
            body.scrollTop > 0 &&
            Math.abs(form.top - body.getBoundingClientRect().top) < 1 &&
            getComputedStyle(field, '::before').opacity === '1'
          );
        })()`,
        'the add field held at the top of a scrolled list'
      );
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

  // The camera viewer's toolbar: Snapshot and Live are a pair, and the one on screen is filled.
  {
    name: 'popup-camera-viewer',
    setup: async (ctx) => {
      await ctx.click(tile('camera.driveway'));
      await ctx.waitForSelector('.camera-modal #snapshot-btn');
    },
  },
  // The sound toggle sits beside the pair: three buttons next to the status text, at the default
  // width and where the window is narrow and the words long.
  { name: 'popup-camera-viewer-mute', setup: openCameraViewerWithMute },
  {
    name: 'popup-camera-viewer-mute-narrow',
    size: NARROW_WINDOW,
    setup: openCameraViewerWithMute,
  },
  {
    name: 'de-popup-camera-viewer-mute-narrow',
    size: NARROW_WINDOW,
    ui: { language: 'de' },
    setup: openCameraViewerWithMute,
  },
  {
    name: 'popup-camera-viewer-live',
    setup: async (ctx) => {
      await ctx.click(tile('camera.driveway'));
      await ctx.waitForSelector('.camera-modal #live-btn');
      await ctx.click('.camera-modal #live-btn');
    },
  },

  {
    name: 'popup-light-colour',
    config: dialogsPage,
    setup: openDetails('light.color_strip'),
  },
  {
    name: 'popup-light-presets',
    config: {
      customTabs: [
        { id: 'default', name: 'Home', entityIds: ['light.preset_demo'] },
        { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] },
      ],
      activeTabId: 'default',
    },
    extraStates: presetLight,
    setup: openDetails('light.preset_demo'),
  },
  { name: 'popup-fan', config: dialogsPage, setup: openDetails('fan.office') },
  // A fan Home Assistant cannot reach says so and shows nothing to adjust.
  {
    name: 'popup-fan-unavailable',
    config: { activeTabId: 'bedroom' },
    setup: openUnavailable(openDetails('fan.bedroom')),
  },
  // The same for a light and a cover: the banner and the buttons, with no icon or graphic left over.
  {
    name: 'popup-light-unavailable',
    config: unavailablePage,
    extraStates: buildUnavailableDevices,
    setup: openUnavailable(openArrivedDetails('light.hall')),
  },
  {
    name: 'popup-cover-unavailable',
    config: unavailablePage,
    extraStates: buildUnavailableDevices,
    setup: openUnavailable(openArrivedDetails('cover.side_gate')),
  },
  // An entity that is gone dims on a primary card as it does in Quick Access.
  { name: 'primary-unavailable-card', config: { primaryCards: ['fan.bedroom', 'time'] } },
  { name: 'popup-cover', config: dialogsPage, setup: openDetails('cover.garage') },
  {
    name: 'popup-media',
    config: dialogsPage,
    setup: openDetails('media_player.den_stereo'),
  },
  // A title of 86 characters and a player that names its app: the dialog is where it is read whole.
  {
    name: 'popup-media-long-title',
    config: sixPages('media'),
    setup: openDetails('media_player.bedroom_tv'),
  },
  // The devices the dialogs follow: a garage door with no position (its picture follows its state),
  // an RGB light with no colour temperature, and a thermostat that dropped out.
  {
    name: 'popup-cover-no-position',
    config: pages('security', 'more'),
    setup: openDetails('cover.garage_simple'),
  },
  {
    name: 'popup-light-rgb',
    config: pages('security', 'more'),
    setup: openDetails('light.rgb_strip'),
  },
  {
    name: 'popup-climate-unavailable',
    config: pages('security', 'more'),
    setup: openDetails('climate.unavailable'),
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
  {
    name: 'dialog-alert-config-state-change',
    config: alertsConfig,
    setup: (ctx) => openAlertConfig(ctx, 'binary_sensor.front_door'),
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
      // The dialog opens on the chosen frequency; its ring is the option's, not a box round the radio.
      await ctx.expect(
        `(() => {
          const radio = document.activeElement;
          const option = radio?.closest('.donate-frequency-option');
          return !!option && getComputedStyle(radio).outlineStyle === 'none' &&
            getComputedStyle(option).outlineStyle === 'solid';
        })()`,
        'the focused frequency is ringed as a whole option'
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
  { name: 'settings-hotkeys', setup: (ctx) => openHotkeysPage(ctx) },
  // The entity list, where each row picks the action its hotkey runs from a select. A hotkey an
  // earlier version saved on a sensor comes first, with only its Clear button.
  {
    name: 'settings-hotkeys-entities',
    config: hotkeysWithSensor,
    setup: async (ctx) => {
      await openHotkeysFor(ctx, '');
      await ctx.expect(SENSOR_HOTKEY_ROW, "the sensor's hotkey keeps a row with its Clear button");
      // A lock's hotkey locks or unlocks; a toggle unlocked a door with nobody asked.
      await ctx.expect(
        `[...document.querySelector('#hotkeys-list .hotkey-action-select[data-entity-id="lock.back_door"]').options]
          .map((option) => option.value).join() === 'lock,unlock'`,
        'Lock and Unlock for the lock, and no Toggle'
      );
    },
  },
  // A home with more lights than one page of the list holds: the last page, with its rows above the
  // pager (Previous available, Next not).
  {
    name: 'settings-hotkeys-page-2',
    config: hotkeysOn,
    extraStates: buildLandingLights,
    setup: async (ctx) => {
      await openHotkeysPage(ctx);
      await ctx.waitForSelector('#hotkeys-list .primary-cards-pagination');
      await ctx.click('#hotkeys-list [data-primary-page="next"]');
      await ctx.waitForExpression(
        `document.querySelector('#hotkeys-list [data-primary-page="next"]')?.getAttribute('aria-disabled') === 'true'`,
        'the last page of the Hotkeys list'
      );
      // The pager sticks to the bottom of the list, so the list itself is what comes into view.
      await revealInSettings(ctx, '#hotkeys-list');
      await ctx.expect(
        `document.querySelector('#hotkeys-list [data-primary-page="previous"]').getAttribute('aria-disabled') === 'false' &&
          document.querySelectorAll('#hotkeys-list .hotkey-item').length > 0`,
        'a page of rows after the first, with Previous available'
      );
    },
  },
  {
    name: 'settings-alerts',
    config: alertsConfig,
    setup: (ctx) => openSettingsTab(ctx, 'alerts'),
  },
  // An alert for an entity that is gone keeps its row, under its id, with Edit and Remove in reach.
  {
    name: 'settings-alerts-missing-entity',
    config: alertsWithMissingEntity,
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'alerts');
      await ctx.expect(ALERT_BUTTONS_IN_ROW, 'every alert row keeps Edit and Remove inside it');
    },
  },
  // A hotkey search that finds nothing says so, instead of leaving an empty line.
  {
    name: 'settings-hotkeys-no-match',
    config: hotkeyPage,
    setup: (ctx) => openHotkeysFor(ctx, 'zzzzz', { expectNoMatch: true }),
  },
  { name: 'settings-advanced', setup: (ctx) => openSettingsTab(ctx, 'advanced') },
  // What a check can find, each in its own colour instead of the idle grey.
  updateScene(
    'settings-advanced-update-error',
    {
      status: 'error',
      error: 'Could not reach GitHub to check for updates. Check your internet connection.',
    },
    {
      state: 'error',
      text: 'Error: Could not reach GitHub to check for updates. Check your internet connection.',
    }
  ),
  updateScene(
    'settings-advanced-update-downloading',
    { status: 'downloading', progress: { percent: 42 } },
    { state: 'downloading', text: 'Downloading update...', progress: 42 }
  ),
  updateScene(
    'settings-advanced-update-ready',
    { status: 'downloaded', info: { version: '4.0.1' } },
    { state: 'downloaded', text: 'Update v4.0.1 ready to install', install: 'Install update' }
  ),
  // A package that cannot update itself: the line names the button, which opens the release page.
  updateScene(
    'settings-advanced-update-manual',
    {
      status: 'manual',
      version: '4.0.1',
      downloadUrl: 'https://github.com/Robertg761/HA-Desktop-Widget/releases/tag/v4.0.1',
    },
    {
      state: 'manual',
      text: 'Update available: v4.0.1. This package cannot update itself; use “Download update” to get it from GitHub.',
      install: 'Download update',
    }
  ),
  // The profile sync controls, opened by the switch alone: nothing is saved, so no sync starts and
  // the next scene finds Settings as it was.
  {
    name: 'settings-profile-sync',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'advanced');
      await ctx.click('#profile-sync-enabled');
      await ctx.waitForExpression(
        `!document.getElementById('profile-sync-settings').classList.contains('hidden')`,
        'the profile sync controls'
      );
      await revealInSettings(ctx, '#profile-sync-push-now', 'center');
    },
  },
  // French has the longest sync app and sync scope choices. Each select drops under its label and
  // shows its whole value, which a fixed width cut to "Tous les paramètres synchr...".
  {
    name: 'layout-settings-profile-sync-fr',
    ui: { language: 'fr' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'advanced');
      await ctx.click('#profile-sync-enabled');
      await ctx.waitForExpression(
        `!document.getElementById('profile-sync-settings').classList.contains('hidden')`,
        'the profile sync controls'
      );
      await revealInSettings(ctx, '.form-group:has(> #profile-sync-provider)', 'start');
      await ctx.expect(
        ['#profile-sync-provider', '#profile-sync-scope-preset']
          .map(selectShowsItsValue)
          .join(' && '),
        'the sync app and scope show their whole value'
      );
    },
  },
  // The passphrase shown in plain text: Show passphrase looks pressed, unlike the buttons beside it.
  {
    name: 'settings-profile-sync-passphrase-shown',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'advanced');
      await ctx.click('#profile-sync-enabled');
      await ctx.click('#profile-sync-encryption-enabled');
      await ctx.waitForExpression(
        `!document.getElementById('profile-sync-passphrase-group').classList.contains('hidden')`,
        'the passphrase field'
      );
      await typeInto(ctx, '#profile-sync-passphrase', 'correct horse');
      await ctx.click('#profile-sync-passphrase-reveal');
      await revealInSettings(ctx, '#profile-sync-passphrase-group', 'center');
      // Waited for rather than checked at once: the button's colours change through a transition.
      await ctx.waitForExpression(
        `(() => {
          const reveal = document.getElementById('profile-sync-passphrase-reveal');
          const other = document.getElementById('profile-sync-choose-folder');
          return document.getElementById('profile-sync-passphrase').type === 'text' &&
            getComputedStyle(reveal).backgroundColor !== getComputedStyle(other).backgroundColor &&
            getComputedStyle(reveal).borderColor !== getComputedStyle(other).borderColor;
        })()`,
        'Show passphrase looks pressed while the passphrase is shown'
      );
      // The open eye shows, and the button keeps its place beside the field: with the eye added it
      // first dropped under the field at the default size.
      await ctx.expect(
        `(() => {
          const reveal = document.getElementById('profile-sync-passphrase-reveal');
          const field = document.getElementById('profile-sync-passphrase');
          return reveal.querySelector('.passphrase-reveal-icon-shown').getBoundingClientRect().width > 0 &&
            !reveal.querySelector('.passphrase-reveal-icon-hidden').getBoundingClientRect().width &&
            Math.abs(reveal.getBoundingClientRect().top - field.getBoundingClientRect().top) < 2;
        })()`,
        'the open eye, beside the field'
      );
    },
  },
  { name: 'dialog-restore-dashboard', setup: openRestoreDashboard },
  {
    name: 'settings-language-packs',
    setup: async (ctx) => {
      await openLanguagePacks(ctx);
      // Every pack but German is installed, and German is built in: nothing is left to download.
      await ctx.expect(
        `document.getElementById('language-select-help').classList.contains('hidden') &&
          ![...document.querySelectorAll('#language-packs-list .language-pack-row')].some((row) =>
            row.querySelector('[data-locale-action="download"]')?.textContent === 'Download')`,
        'no pack is offered for download'
      );
    },
  },
  {
    name: 'settings-custom-color',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await revealInSettings(ctx, '#custom-color-picker');
    },
  },

  // The settings search: ranked results (the setting of that name first, with its group beside its
  // page), and a query that finds nothing, which fills the page with its own empty state.
  ...[
    ['settings-search-results', 'hotkey'],
    ['settings-search-empty', 'zzzz'],
  ].map(([name, query]) => ({
    name,
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'general');
      await typeInto(ctx, '#settings-search', query);
    },
  })),
  // A long list of results scrolled to its end: the field and the count of matches stay on top.
  {
    name: 'settings-search-results-scrolled',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'general');
      await typeInto(ctx, '#settings-search', 'a');
      await ctx.ev(`(() => {
        const page = document.querySelector('#settings-modal .modal-body');
        page.scrollTop = page.scrollHeight;
      })()`);
      // Under reduced motion every property still changes over 0.01ms, so the box settles first.
      await ctx.waitForExpression(
        `getComputedStyle(document.querySelector('#settings-modal .settings-search-box')).paddingTop === '18px'`,
        'the search box held at the top'
      );
      await ctx.expect(SEARCH_BOX_IN_VIEW, 'the search field and its count stay in view');
      // A band across the page, not a box in the column, with the field still over the results.
      await ctx.expect(
        `(() => {
          const page = document.querySelector('#settings-modal .modal-body');
          const edges = page.getBoundingClientRect();
          const band = document.querySelector('#settings-modal .settings-search-box').getBoundingClientRect();
          const field = document.getElementById('settings-search').getBoundingClientRect();
          const result = document.querySelector('.settings-search-result').getBoundingClientRect();
          return Math.abs(band.left - edges.left) < 1 &&
            Math.abs(band.right - (edges.left + page.clientWidth)) < 1 &&
            Math.abs(field.left - result.left) < 1 && Math.abs(field.right - result.right) < 1;
        })()`,
        'the search band spans the page, with the field over the results'
      );
    },
  },
  // Save from another page with a bad address: General opens with the field marked and the
  // reason under it, instead of a toast about a field that is not on screen.
  {
    name: 'settings-url-error',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await ctx.ev(`document.getElementById('ha-url').value = 'http://'`);
      await ctx.click('#save-settings');
      await ctx.waitForExpression(
        `!!document.getElementById('ha-url-error') && document.activeElement?.id === 'ha-url'`,
        'the inline URL error, with the field focused'
      );
      // The reason is part of the field's row: close under the field, with no divider between.
      await ctx.expect(
        `(() => {
          const error = document.getElementById('ha-url-error');
          const gap = error.getBoundingClientRect().top - document.getElementById('ha-url').getBoundingClientRect().bottom;
          return gap >= 0 && gap <= 10 && getComputedStyle(error).borderTopStyle === 'none';
        })()`,
        'the error sits under its field, in its row'
      );
    },
  },
  // The icon editor with a picker open: the home's own icons first, in a list that is paged.
  {
    name: 'settings-icons-picker',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'dashboard');
      await ctx.click('#custom-entity-icons-toggle');
      await ctx.waitForSelector('#custom-entity-icons-list .custom-entity-icon-item');
      await ctx.click('[data-custom-icon-picker-toggle]');
      await ctx.waitForSelector('.custom-entity-icon-choice');
      await revealInSettings(ctx, '#custom-entity-icons-list', 'start');
    },
  },
  // A search in German by a German name: the names Unicode CLDR gives every emoji come with the app
  // in each language it speaks, so "Glühbirne" finds the light bulb and the grid names it so.
  {
    name: 'de-settings-icons-search',
    ui: { language: 'de' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'dashboard');
      // The section remembers whether it was open, so only open it when it is shut.
      await ctx.ev(`(() => {
        const section = document.getElementById('custom-entity-icons-section');
        if (section.classList.contains('collapsed')) section.querySelector('.section-toggle').click();
      })()`);
      await ctx.waitForSelector('#custom-entity-icons-list .custom-entity-icon-item');
      await waitForSectionOpen(ctx, 'custom-entity-icons-section');
      await typeInto(ctx, '#custom-entity-icons-list [data-custom-icon-input]', 'Glühbirne');
      await ctx.waitForSelector('.custom-entity-icon-choice[aria-label="Glühbirne (💡)"]');
      await revealInSettings(ctx, '#custom-entity-icons-list', 'start');
    },
  },
  // The alert picker keeps its search field where it is while the list narrows to a few rows and to
  // none: the dialog used to shrink and re-centre under the person's typing.
  ...[
    ['dialog-alert-picker-filtered', 'lamp'],
    ['dialog-alert-picker-no-match', 'zzzz'],
  ].map(([name, query]) => ({
    name,
    size: DEFAULT_SIZE,
    config: alertsConfig,
    setup: async (ctx) => {
      await openAlertPicker(ctx);
      // Measure once the dialog has stopped sliding in. A runner that animates it (macOS) would
      // otherwise record a top that is still moving.
      await ctx.waitForExpression(
        `!document.getElementById('alert-entity-picker-modal').getAnimations({ subtree: true }).length`,
        'the alert picker to finish opening'
      );
      const search = `document.getElementById('alert-entity-picker-search').getBoundingClientRect().top`;
      await ctx.ev(`window.__pickerSearchTop = ${search}`);
      await typeInto(ctx, '#alert-entity-picker-search', query);
      await ctx.expect(
        `Math.abs(${search} - window.__pickerSearchTop) < 1`,
        'the search field keeps its place while the list narrows'
      );
    },
  })),

  // A light as a primary card: the lit lamp warms its icon and glow.
  { name: 'primary-light-card', config: { primaryCards: ['light.desk_lamp', 'time'] } },

  // The starter that fills the empty page opens on the entities a first page is made of.
  {
    name: 'dialog-starter',
    config: {
      customTabs: [
        { id: 'default', name: 'Home', entityIds: [] },
        { id: 'spare', name: 'Spare', entityIds: ['light.desk_lamp'] },
      ],
      activeTabId: 'default',
    },
    setup: async (ctx) => {
      await ctx.click('.widget-state-actions .btn-primary');
      await ctx.waitForSelector('#add-page-modal .room-entity-list label');
    },
  },
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

  // Keyboard focus in dialogs, and the toasts docked above them. A key is pressed first, because
  // the focus ring only shows after one.
  {
    name: 'focus-settings-opens-on-tab',
    setup: async (ctx) => {
      await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
      await ctx.click('#settings-btn');
      await ctx.waitForExpression(
        `document.activeElement?.matches('#settings-modal .tab-link.active')`,
        'focus on the current Settings page, not on Close'
      );
      // The page it opens on is on screen; naming its tab covered the start of the search field.
      await ctx.expect(
        `!document.querySelector('.tab-tooltip.visible')`,
        'no page label over the search field'
      );
    },
  },
  {
    name: 'focus-settings-rail-label',
    setup: async (ctx) => {
      await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
      await ctx.click('#settings-btn');
      await ctx.waitForExpression(`document.activeElement?.matches('#settings-modal .tab-link')`);
      await ctx.ev(
        `document.querySelector('#settings-modal [data-tab="personalization"]').focus()`
      );
      await ctx.waitForExpression(
        `document.querySelector('.tab-tooltip.visible')`,
        'the page label'
      );
    },
  },
  {
    name: 'focus-settings-opacity-slider',
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      // Centred: the rail is 6px high, so at the top edge the ring and the thumb would be clipped.
      await revealInSettings(ctx, '#opacity-slider', 'center');
      await focusWithKeyboard(ctx, '#opacity-slider');
    },
  },
  {
    name: 'focus-confirm-unsaved-color',
    setup: raiseUnsavedColorPrompt,
  },
  // Three buttons in a 400px dialog: in a narrow window, or with the wordier translations, they
  // have to wrap onto a second row rather than lose the end of their labels.
  {
    name: 'focus-confirm-unsaved-color-narrow',
    size: NARROW_WINDOW,
    setup: raiseUnsavedColorPrompt,
  },
  {
    name: 'focus-confirm-unsaved-color-de',
    ui: { language: 'de' },
    setup: raiseUnsavedColorPrompt,
  },
  {
    name: 'focus-confirm-unsaved-color-ar',
    ui: { language: 'ar' },
    setup: raiseUnsavedColorPrompt,
  },
  {
    name: 'focus-weather-card',
    setup: (ctx) => focusWithKeyboard(ctx, '#weather-card'),
  },
  {
    name: 'focus-weather-picker',
    setup: async (ctx) => {
      await focusWithKeyboard(ctx, '#weather-card');
      await ctx.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
      await ctx.waitForSelector('#weather-config-modal .entity-item[role="option"]');
      await ctx.waitForExpression(
        `document.activeElement?.matches('#weather-config-modal [role="option"], #weather-config-modal button')`
      );
      await ctx.ev(`document.querySelector('#weather-config-modal [role="option"]')?.focus()`);
    },
  },
  {
    name: 'focus-command-palette',
    setup: async (ctx) => {
      await ctx.ev(`document.activeElement?.blur?.()`);
      await ctx.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: ctx.CTRL });
      await ctx.waitForExpression(
        `document.activeElement?.classList.contains('command-palette-input')`
      );
      await ctx.insertText('lamp');
      await ctx.waitForExpression(`document.querySelector('.command-palette-result.highlighted')`);
    },
  },
  // The command palette with nothing typed, with an entity that has nothing to run, and with a
  // search that finds nothing.
  { name: 'palette-empty', setup: openPaletteEmpty },
  { name: 'palette-no-action', setup: pressEnterOnEntityWithoutAction },
  { name: 'palette-no-results', setup: searchPaletteForNothing },
  {
    name: 'focus-tile-settings',
    setup: async (ctx) => {
      await ctx.pressKey('Shift', { code: 'ShiftLeft', keyCode: 16 });
      await openTileSettings(ctx);
      await ctx.waitForExpression(
        `document.activeElement?.id === 'rename-input' &&
          document.activeElement.selectionStart === 0 &&
          document.activeElement.selectionEnd === document.activeElement.value.length`,
        'the name field, selected'
      );
    },
  },
  {
    name: 'toast-error-over-settings',
    keepToasts: true,
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'general');
      await raiseRefusedCommand(ctx);
      // The toast stack sits above the Save and Cancel pill, clear of both buttons.
      await ctx.waitForExpression(
        `(() => {
        const toast = document.querySelector('#toast-container .toast.error').getBoundingClientRect();
        const footer = document.querySelector('#settings-modal .modal-footer').getBoundingClientRect();
        return toast.bottom <= footer.top;
      })()`,
        'the toast above the footer'
      );
    },
  },
  // The notice sits over the bottom tile row, so it has to be short: two lines at the default
  // width, and not much more where the window is narrow or the language is wordy.
  { name: 'toast-reorganize-notice', keepToasts: true, setup: raiseReorganizeNotice },
  {
    name: 'toast-reorganize-notice-narrow',
    size: NARROW_WINDOW,
    keepToasts: true,
    setup: raiseReorganizeNotice,
  },
  {
    name: 'toast-reorganize-notice-de',
    ui: { language: 'de' },
    keepToasts: true,
    setup: raiseReorganizeNotice,
  },
  {
    name: 'toast-reorganize-notice-ar',
    ui: { language: 'ar' },
    keepToasts: true,
    setup: raiseReorganizeNotice,
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
  // Camera tiles with a preview and no picture to show: the fixture's snapshot fails, and the porch
  // camera is offline. Their icon sits above the name like any other tile's, in both themes and at
  // the compact height.
  {
    name: 'camera-tile',
    config: cameraTilesPage,
    extraStates: offlineCamera,
    setup: waitForCameraTiles,
  },
  {
    name: 'camera-tile-light-compact',
    ui: { theme: 'light', density: 'compact' },
    config: cameraTilesPage,
    extraStates: offlineCamera,
    setup: waitForCameraTiles,
  },

  // What a dashboard says about security and state: a locked, an unlocked and a jammed lock, an
  // alarm that is armed, one that went off and one that is disarmed, an open window, a low battery
  // and a person (a tile that does nothing, so no pointer and no hover).
  { name: 'tiles-security', config: pages('security', 'default') },
  { name: 'tiles-security-light', ui: { theme: 'light' }, config: pages('security', 'default') },
  // Halloween's orange, Christmas's red and the Amber accent paint an armed alarm in the same family
  // as an unlocked lock or an alarm that went off. Those keep a badge and an edge of their own, and
  // the lit tiles a lighter wash. Christmas in the dark theme was the worst: the armed alarm was a
  // stronger red than the one that went off.
  {
    name: 'tiles-security-halloween',
    ui: { seasonal: holiday('halloween') },
    config: pages('security', 'default'),
  },
  {
    name: 'tiles-security-christmas',
    ui: { seasonal: holiday('christmas') },
    config: pages('security', 'default'),
  },
  {
    name: 'tiles-security-christmas-light',
    ui: { theme: 'light', seasonal: holiday('christmas') },
    config: pages('security', 'default'),
  },
  { name: 'tiles-security-amber', ui: { accent: 'amber' }, config: pages('security', 'default') },
  // With the accent glow off nothing lights up for being on: the lamp and the playing TV stay plain,
  // and so does a TV Home Assistant calls 'on'. Only what needs attention is coloured.
  {
    name: 'tiles-glow-off',
    ui: { activeTileGlow: false },
    config: {
      customTabs: [
        {
          id: 'default',
          name: 'Glow',
          entityIds: [
            'light.desk_lamp',
            'lock.front_door',
            'person.alex',
            'media_player.tv_on',
            'media_player.bedroom_tv',
            'alarm_control_panel.cabin',
          ],
        },
      ],
      activeTabId: 'default',
    },
  },
  { name: 'graph-hover-left', config: graphTooltipPage, setup: (ctx) => hoverGraph(ctx, 0.25) },
  { name: 'graph-hover-right', config: graphTooltipPage, setup: (ctx) => hoverGraph(ctx, 0.75) },
  { name: 'notifications-markdown', setup: openNotifications },

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
    setup: (ctx) => openHotkeysPage(ctx),
  },
  {
    name: 'de-settings-hotkeys-entities',
    ui: { language: 'de' },
    config: hotkeysOn,
    setup: (ctx) => openHotkeysFor(ctx, ''),
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
    name: 'de-dialog-alert-config-state-change',
    ui: { language: 'de' },
    config: alertsConfig,
    setup: (ctx) => openAlertConfig(ctx, 'binary_sensor.front_door'),
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
    name: 'ar-dialog-alert-config-state-change',
    ui: { language: 'ar' },
    config: alertsConfig,
    setup: (ctx) => openAlertConfig(ctx, 'binary_sensor.front_door'),
  },
  // Lines that put a left-to-right run in an Arabic sentence: a threshold with its unit ("Above
  // 25°C") and a pack's version beside the date it was installed.
  {
    name: 'ar-settings-alerts',
    ui: { language: 'ar' },
    config: alertsConfig,
    setup: (ctx) => openSettingsTab(ctx, 'alerts'),
  },
  { name: 'ar-settings-language-packs', ui: { language: 'ar' }, setup: openLanguagePacks },
  {
    name: 'ar-dialog-manage-quick-access',
    ui: { language: 'ar' },
    setup: (ctx) => ctx.click('#manage-quick-controls-btn'),
  },
  {
    name: 'ar-settings-hotkeys',
    ui: { language: 'ar' },
    setup: (ctx) => openHotkeysPage(ctx),
  },
  // The popup hotkey field reads its own prompt while it records: Arabic text in a field whose
  // recorded shortcut is left to right.
  {
    name: 'ar-settings-popup-hotkey-capture',
    ui: { language: 'ar' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'hotkeys');
      await ctx.click('#popup-hotkey-set-btn');
      await revealInSettings(ctx, '#popup-hotkey-input', 'center');
    },
  },
  {
    name: 'ar-popup-brightness',
    ui: { language: 'ar' },
    setup: openBrightness,
  },
  {
    name: 'ar-popup-colour',
    ui: { language: 'ar' },
    config: { activeTabId: 'bedroom' },
    setup: openColourLight,
  },
  { name: 'ar-edit-mode', ui: { language: 'ar' }, setup: toggleEditMode },
  { name: 'ar-media-tile', ui: { language: 'ar' }, config: sixPages('media') },
  { name: 'ar-edge-tiles', ui: { language: 'ar' }, config: edgePage },
  {
    name: 'ar-palette',
    ui: { language: 'ar' },
    setup: (ctx) => openPaletteFor(ctx, 'o'),
  },
  {
    name: 'ar-settings-appearance',
    ui: { language: 'ar', accent: 'custom-ab34cd', ...customColour },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await revealInSettings(ctx, '#theme-current-selection', 'center');
    },
  },
  {
    name: 'ar-settings-appearance-custom',
    ui: { language: 'ar' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await revealInSettings(ctx, '#custom-color-hex', 'center');
    },
  },
  { name: 'ar-dialog-notifications', ui: { language: 'ar' }, setup: openNotifications },
  { name: 'ar-dialog-diagnostics', ui: { language: 'ar' }, setup: openDiagnostics },
  { name: 'hi-main', ui: { language: 'hi' } },
  {
    name: 'hi-settings-appearance',
    ui: { language: 'hi' },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  { name: 'zh-main', ui: { language: 'zh' } },
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
    setup: (ctx) => openHotkeysPage(ctx),
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

  // A timer takes a hue of its own when the accent is the green or the amber it would wear.
  { name: 'timer-accent-emerald', ui: { accent: 'emerald' }, config: timersPage },
  { name: 'timer-accent-amber', ui: { accent: 'amber' }, config: timersPage },

  // A touch-first machine gets 44px targets in the header and in dialogs, and 72px tiles.
  coarsePointer('coarse-pointer-main'),
  coarsePointer('coarse-pointer-dialog', openBrightness),
  // Settings' option controls (the theme mode) are as tall as the buttons beside them.
  coarsePointer('coarse-pointer-settings', (ctx) => openSettingsTab(ctx, 'personalization')),

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
  // The palette list holds no scrollbar gutter here, as the page does, and keeps its 9px margins.
  { name: 'forced-colors-palette', media: FORCED_COLORS, setup: openPaletteEmpty },
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
  // A running timer is a tile that takes keyboard focus itself, and draws its on edge as an outline.
  // The white focus ring has to stay on top of that edge.
  {
    name: 'readable-timer-focus',
    ui: READABLE,
    setup: (ctx) => focusWithKeyboard(ctx, tile('timer.laundry')),
  },
  { name: 'readable-light-main', ui: { theme: 'light', ...READABLE } },
  // The selected and on states of the preset, each of which has to differ from its off state by
  // more than hue: the lit tiles, the selected theme mode, switches, chips, swatches and pins.
  {
    name: 'readable-settings-appearance',
    ui: READABLE,
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },
  {
    name: 'readable-settings-general',
    ui: READABLE,
    setup: (ctx) => openSettingsTab(ctx, 'general'),
  },
  { name: 'readable-edit-mode', ui: READABLE, setup: toggleEditMode },
  { name: 'readable-popup-brightness', ui: READABLE, setup: openBrightness },
  { name: 'readable-popup-climate', ui: READABLE, setup: openClimate },
  {
    name: 'readable-popup-colour',
    ui: READABLE,
    config: { activeTabId: 'bedroom' },
    setup: openColourLight,
  },
  {
    name: 'readable-popup-fan',
    ui: READABLE,
    config: dialogsPage,
    setup: openDetails('fan.office'),
  },
  { name: 'readable-light-popup-climate', ui: { theme: 'light', ...READABLE }, setup: openClimate },
  {
    name: 'readable-light-settings-appearance',
    ui: { theme: 'light', ...READABLE },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },

  // A followed Omarchy palette (Linux only; the run stages a light, warm one for these scenes): the
  // Mode shows the palette's own, the Colors are out of reach with a note, and the fields keep the
  // faint hairline of the stock themes instead of the palette's full-strength border.
  {
    name: 'omarchy-settings-general',
    omarchyPalette: true,
    ui: { followOmarchy: true },
    setup: (ctx) => openSettingsTab(ctx, 'general'),
  },
  {
    name: 'omarchy-settings-appearance',
    omarchyPalette: true,
    ui: { followOmarchy: true },
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  },

  // The notice on a pin whose desktop decides where it sits (native Wayland), in edit mode: left
  // out of the default pin, where it would cover the controls, and shown in a wider one.
  ...[
    ['pin-edit-wayland', null],
    ['pin-edit-wayland-328x156', { width: 328, height: 156 }],
  ].map(([name, size]) => ({
    name,
    pin: 'light.desk_lamp',
    config: pinsPage,
    setup: async (ctx) => {
      const pin = await ctx.openPin('light.desk_lamp');
      if (size) await resizePin(ctx, 'light.desk_lamp', size);
      // The hints are the pin's own (renderCurrentMode sets both); the stylesheet picks the one for
      // compositor placement.
      await pin.evaluate(`(() => {
        document.body.classList.add('desktop-pin-edit-mode', 'desktop-pin-compositor-placement');
      })()`);
      return { capture: pin };
    },
  })),

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
  pinScene('pin-light-onoff', 'light.porch', {
    config: pinPage('light.porch'),
    extraStates: onOffLight,
  }),
  pinScene('pin-climate', 'climate.bedroom'),
  // A thermostat in heat_cool holds a range, which has two sliders where a single target has one,
  // and its mode button leads the row with Home Assistant's own name for the mode ("Heat/Cool", not
  // the "Auto" of the auto mode).
  pinScene('pin-climate-range', 'climate.heat_pump'),
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
  pinScene('pin-switch', 'switch.coffee_maker'),
  pinScene('pin-action', 'automation.morning_routine'),
  pinScene('pin-presence', 'person.alex'),
  pinScene('pin-vacuum', 'vacuum.robot'),
  pinScene('pin-timer', 'timer.laundry'),
  // Pins dragged a little bigger, between the default and the roomy 260x190: the four modes or
  // speeds come back and must still fit their row, and the weather's units keep their case.
  resizedPinScene('climate', 'climate.bedroom', { width: 200, height: 170 }),
  resizedPinScene('fan', 'fan.office', { width: 200, height: 170 }),
  resizedPinScene('cover', 'cover.garage_door', { width: 200, height: 170 }),
  resizedPinScene('weather', 'weather.home', { width: 200, height: 170 }),
  resizedPinScene('climate', 'climate.bedroom', { width: 240, height: 180 }),
  resizedPinScene('weather', 'weather.home', { width: 240, height: 180 }),
  // A heat/cool range's second slider took the room of the mode row, and a pin just short of the
  // balanced layout brought back a fourth mode that German cut to "Kü...".
  resizedPinScene('climate-range', 'climate.heat_pump', { width: 200, height: 170 }),
  resizedPinScene(
    'de-climate',
    'climate.bedroom',
    { width: 185, height: 158 },
    { ui: { language: 'de' } }
  ),
  pinScene('pin-de-cover', 'cover.garage_door', { ui: { language: 'de' } }),
  pinScene('pin-de-weather', 'weather.home', { ui: { language: 'de' } }),
  pinScene('pin-fr-climate', 'climate.bedroom', { ui: { language: 'fr' } }),
  // The heat_cool thermostat in French, whose "Chaud/Froid" is the longest name for the mode. With
  // "Désactivé" and "Chauffe" beside it, the default pin cut all three short.
  fittedPinScene('pin-fr-climate-heat-cool', 'climate.heat_pump', { ui: { language: 'fr' } }),
  pinScene('pin-fr-light', 'light.upstairs_hallway_ceiling', { ui: { language: 'fr' } }),
  pinScene('pin-es-fan', 'fan.office', { ui: { language: 'es' } }),
  pinScene('pin-ar-light', 'light.desk_lamp', { ui: { language: 'ar' } }),
  pinScene('pin-ar-climate', 'climate.bedroom', { ui: { language: 'ar' } }),
  pinScene('pin-ar-light-long', 'light.upstairs_hallway_ceiling', { ui: { language: 'ar' } }),
  pinScene('pin-large-light', 'light.desk_lamp', { ui: { scale: 1.5 } }),
  pinScene('pin-large-climate', 'climate.bedroom', { ui: { scale: 1.5 } }),
  pinScene('pin-large-weather', 'weather.home', { ui: { scale: 1.5 } }),
  pinScene('pin-theme-light-climate', 'climate.bedroom', { ui: { theme: 'light' } }),
  // The Readable preset reaches pin windows too: the power chip, the panel chips and the sliders.
  pinScene('readable-pin-light', 'light.desk_lamp', { ui: READABLE }),
  pinScene('readable-pin-climate', 'climate.bedroom', { ui: READABLE }),
  pinScene('readable-pin-cover', 'cover.garage_door', { ui: READABLE }),
  pinScene('readable-pin-fan', 'fan.office', { ui: READABLE }),
  // The pin's own track, thumb and fill in system colours.
  pinScene('forced-colors-pin-climate', 'climate.bedroom', { media: FORCED_COLORS }),
  pinScene('forced-colors-pin-light', 'light.desk_lamp', { media: FORCED_COLORS }),

  // The fixture turns seasonal themes off so the scenes above do not change with the date; these
  // force a holiday on. They also switch the themes on explicitly: CI machines often ask for
  // reduced motion, which otherwise keeps them off. The background scene is random, so these
  // differ a little run to run.
  {
    name: 'halloween',
    ui: { seasonal: holiday('halloween') },
  },
  // Settings over a holiday: its header and rail sit over the art without a blur of their own.
  {
    name: 'settings-halloween',
    ui: { seasonal: holiday('halloween') },
    setup: (ctx) => openSettingsTab(ctx, 'general'),
  },
  {
    name: 'christmas-light',
    ui: { theme: 'light', seasonal: holiday('christmas') },
  },
  // The holiday art that was drawn pale for the dark theme: flutes, the bunny and the chicks.
  {
    name: 'new-year-light',
    ui: { theme: 'light', seasonal: holiday('new-year') },
  },
  {
    name: 'easter-light',
    ui: { theme: 'light', seasonal: holiday('easter') },
  },
  // Where holiday art meets controls: the cobweb behind a dialog's close button, the egg and the
  // bunny in the Settings header and rail, and the pumpkins under a tile row that reaches the
  // bottom of a window as short as the app opens at.
  {
    name: 'halloween-popup',
    ui: { seasonal: holiday('halloween') },
    setup: openBrightness,
  },
  {
    name: 'easter-settings',
    ui: { seasonal: holiday('easter') },
    setup: (ctx) => openSettingsTab(ctx, 'general'),
  },
  {
    name: 'thanksgiving-short',
    ui: { seasonal: holiday('thanksgiving') },
    size: DEFAULT_SIZE,
  },

  // Colour contrast of text and status colours, dark and light, with four accents.
  ...contrastScenes('main', () => ({})),
  ...contrastScenes('settings', () => ({
    setup: (ctx) => openSettingsTab(ctx, 'personalization'),
  })),
  ...contrastScenes('popup', () => ({ setup: openBrightness })),
  ...['dark', 'light'].map((theme) => ({
    name: `contrast-${theme}-connection`,
    ui: { theme },
    setup: showConnectionResults,
  })),
  // The Background picker: swatches drawn as the window a choice gives, with the choice as a dot,
  // with a tinted background picked so the Background chip carries it too.
  ...['dark', 'light'].map((theme) => ({
    name: `contrast-${theme}-background-swatches`,
    ui: { theme, background: 'rose' },
    setup: async (ctx) => {
      await openSettingsTab(ctx, 'personalization');
      await ctx.click('.color-target-option[data-color-target="background"]');
      await ctx.ev(`document.querySelector('#theme-options')?.scrollIntoView({ block: 'center' })`);
    },
  })),
  // The hotkey prompt, which drew white text on the light panel.
  ...['dark', 'light'].map((theme) => ({
    name: `contrast-${theme}-hotkey-capture`,
    ui: { theme },
    config: hotkeysOn,
    setup: async (ctx) => {
      await openHotkeysPage(ctx);
      await ctx.waitForSelector('#hotkeys-list .hotkey-input');
      await ctx.ev(`document.querySelector('#hotkeys-list .hotkey-input').click()`);
      await ctx.waitForSelector('.hotkey-capture-modal');
    },
  })),
  ...['dark', 'light'].map((theme) => ({
    name: `contrast-${theme}-sync-error`,
    ui: { theme },
    setup: showSyncError,
  })),

  // Layout robustness. The edge page has a 95-character light, a seven-figure reading, one
  // unbroken German word as a name and a 90-character sensor; the scenes show it, and the dialogs
  // and Settings pages, at the default 500x600 window, a window as narrow as 150% text makes it
  // (340px), the smallest window, 130% and 150% text, a wide 900x700 window, and in the languages
  // with the longest labels. Each one that has a check fails when a box leaves its parent.
  {
    name: 'layout-edge-main',
    size: DEFAULT_SIZE,
    config: edgePage,
    setup: expectTilesInOrder,
  },
  {
    name: 'layout-edge-compact',
    size: DEFAULT_SIZE,
    ui: { density: 'compact' },
    config: edgePage,
    setup: async (ctx) => {
      await expectTilesInOrder(ctx);
      await expectSensorReadingsFitted(ctx);
    },
  },
  // The two number sensors with their value at the largest size, one of them under a name on two
  // lines: the tile grows, the line stays below the reading.
  {
    name: 'layout-edge-sensor-sizes',
    size: DEFAULT_SIZE,
    config: {
      ...edgePage,
      quickAccessTileOptions: {
        'sensor.energy_total': { valueSize: 'extra-large' },
        'sensor.long_named_temperature': { valueSize: 'extra-large' },
      },
    },
    setup: expectTilesInOrder,
  },
  {
    name: 'layout-edge-narrow',
    size: NARROW_SIZE,
    config: edgePage,
    setup: async (ctx) => ctx.expect(NO_SIDEWAYS_SCROLL, 'no sideways scroll'),
  },
  {
    name: 'layout-edge-s130',
    size: DEFAULT_SIZE,
    ui: { scale: 1.3 },
    config: edgePage,
    setup: expectTilesLaidOut,
  },
  {
    name: 'layout-edge-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    config: edgePage,
    setup: expectTilesLaidOut,
  },
  {
    name: 'layout-main-minimum',
    size: MINIMUM_SIZE,
    setup: async (ctx) => ctx.expect(NO_SIDEWAYS_SCROLL, 'no sideways scroll'),
  },
  {
    name: 'layout-main-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    setup: expectTilesLaidOut,
  },
  { name: 'layout-main-wide', size: WIDE_SIZE, setup: expectTilesLaidOut },
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
  // A stream has no length and its seek row is hidden. The row keeps only the width of its hidden
  // times, so the bar in it stays at its shortest, and the programme name has the rest of the row.
  {
    name: 'layout-media-stream',
    size: DEFAULT_SIZE,
    config: { primaryMediaPlayer: 'media_player.kitchen_radio' },
    extraStates: radioStream,
    setup: async (ctx) => {
      await ctx.waitForExpression(
        `document.querySelector('#media-tile .media-tile-seek')?.dataset.empty === 'true' &&
          document.getElementById('media-tile-title')?.textContent`,
        'the stream on the media tile'
      );
      await ctx.expect(
        `document.querySelector('#media-tile .media-tile-seek-bar').getBoundingClientRect().width < 40`,
        'the hidden seek row of a stream takes no share of the row'
      );
    },
  },
  // The track is a button that opens the player, and a title too long for the tile is still cut
  // off by an ellipsis inside it, with an artist under it or without, at the default width and at
  // 340px, where the grid stacks the rows, in the light theme and right to left.
  ...[
    ['layout-media-title-long', 'media_player.bedroom_tv', DEFAULT_SIZE, {}],
    ['layout-media-title-long-narrow', 'media_player.bedroom_tv', NARROW_SIZE, {}],
    [
      'layout-media-no-artist-narrow-light',
      'media_player.audiobook',
      NARROW_SIZE,
      { theme: 'light' },
    ],
    ['layout-media-no-artist-ar', 'media_player.audiobook', DEFAULT_SIZE, { language: 'ar' }],
  ].map(([name, player, size, ui]) => ({
    name,
    size,
    ui,
    config: { primaryMediaPlayer: player },
    setup: async (ctx) => {
      await ctx.waitForExpression(`document.getElementById('media-tile-title')?.textContent`);
      await ctx.expect(MEDIA_TRACK_CUT_OFF, 'a long title is cut off inside the media tile');
    },
  })),
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
      await ctx.expect(SWATCH_ROWS_EVEN, 'the colour swatches in full rows');
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
      await ctx.expect(CLIMATE_CHIPS_IN_FULL_ROWS, 'no mode or option alone on its row');
      await ctx.expect(CLIMATE_LABELS_IN_CHIPS, 'every label inside its chip');
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
      await ctx.expect(CLIMATE_CHIPS_IN_FULL_ROWS, 'no mode or option alone on its row');
      await ctx.expect(CLIMATE_LABELS_IN_CHIPS, 'every label inside its chip');
    },
  },
  // German names the heat pump's modes at their longest; the picture is of the modes, which sit
  // below the fold of the narrow window's dialog.
  {
    name: 'layout-popup-climate-modes-narrow-de',
    size: NARROW_SIZE,
    ui: { language: 'de' },
    config: edgePage,
    setup: async (ctx) => {
      await openDetails('climate.heat_pump')(ctx);
      await ctx.ev(
        `document.getElementById('climate-mode-buttons').scrollIntoView({ block: 'center' })`
      );
      await ctx.expect(CLIMATE_CHIPS_IN_FULL_ROWS, 'no mode or option alone on its row');
      await ctx.expect(CLIMATE_LABELS_IN_CHIPS, 'every label inside its chip');
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
      await ctx.expect(SWATCH_ROWS_EVEN, 'the colour swatches in full rows');
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
    name: 'layout-dialog-alert-config-state-change',
    size: DEFAULT_SIZE,
    config: alertsConfig,
    setup: async (ctx) => {
      await openAlertConfig(ctx, 'binary_sensor.front_door');
      await ctx.expect(DIALOG_FITS, 'the dialog and its buttons lie inside the window');
    },
  },
  // An empty threshold and a wait that is not a whole number of seconds are each said under their
  // own field, which is marked invalid, and the first takes the focus. A toast said only the first,
  // was gone in seconds and covered the quiet hours. Toasts are kept, so one would show here. The
  // errors make the body scroll, and the fields keep their width.
  {
    name: 'layout-dialog-alert-config-invalid',
    size: DEFAULT_SIZE,
    config: alertsConfig,
    keepToasts: true,
    setup: async (ctx) => {
      await openAlertConfig(ctx);
      // Measured once the dialog has stopped scaling in.
      await ctx.waitForExpression(
        `!document.getElementById('alert-config-modal').getAnimations({ subtree: true }).length`,
        'the alert dialog to finish opening'
      );
      await ctx.ev(
        `window.__alertFieldEnd = document.getElementById('alert-threshold').getBoundingClientRect().right`
      );
      await typeInto(ctx, '#alert-threshold', '');
      await typeInto(ctx, '#alert-duration', '1.5');
      await ctx.click('#save-alert');
      await ctx.waitForSelector('#alert-duration-error');
      await ctx.expect(
        ALERT_ERRORS_UNDER_FIELDS,
        'each error under its own field, and no error toast'
      );
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
    setup: async (ctx) => {
      await openPrimaryCardsList(ctx);
      await ctx.expect(listFitsSettingsPage('#primary-cards-list'), 'the list fits in the page');
    },
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
    setup: async (ctx) => {
      await openHotkeysFor(ctx, 'light');
      await ctx.expect(listFitsSettingsPage('#hotkeys-list'), 'the list fits in the page');
    },
  },

  // The command palette's longest rows, and the toasts at the sizes that capped them at half the
  // window.
  { name: 'layout-palette', size: DEFAULT_SIZE, setup: (ctx) => openPaletteFor(ctx, 'alarm') },
  {
    name: 'layout-palette-narrow',
    size: NARROW_SIZE,
    setup: async (ctx) => {
      await openPaletteFor(ctx, 'alarm');
      await ctx.expect(COMMAND_ROWS_MARKED, 'every command row is marked, and its name is whole');
    },
  },
  {
    name: 'layout-palette-de',
    size: DEFAULT_SIZE,
    ui: { language: 'de' },
    setup: (ctx) => openPaletteFor(ctx, 'a'),
  },
  // An entity Home Assistant cannot reach is dimmed in the results as it is on its tile.
  { name: 'palette-unavailable', setup: (ctx) => openPaletteFor(ctx, 'bedroom') },
  // Readings and states written in each language: precision and unit spacing, device class words,
  // timestamps, a duration, a paused timer and the next calendar events. A taller window shows them all.
  ...[undefined, 'de', 'ar'].map((language) => ({
    name: language ? `format-main-${language}` : 'format-main',
    size: FORMAT_SIZE,
    ui: language ? { language } : {},
    config: formatsPage,
    setup: expectSensorReadingsFitted,
  })),
  {
    name: 'format-palette-fr',
    size: FORMAT_SIZE,
    ui: { language: 'fr' },
    setup: (ctx) => openPaletteFor(ctx, 'temp'),
  },
  // Home Assistant goes away with a full page of tiles: the panel is above them without a scroll,
  // and they are dimmed.
  { name: 'layout-offline', size: DEFAULT_SIZE, config: edgePage, setup: showOffline },
  { name: 'layout-offline-narrow', size: NARROW_SIZE, config: edgePage, setup: showOffline },
  // Retry against a refused connection: the panel says the retry did not get through, and when.
  {
    name: 'layout-offline-retry-failed',
    size: DEFAULT_SIZE,
    config: edgePage,
    setup: async (ctx) => {
      await showOffline(ctx);
      await ctx.click('.widget-state-actions .btn-secondary');
      await ctx.waitForSelector('.widget-state-note');
    },
  },
  // A command that fails while Home Assistant is away: its error toast waits at the bottom, over
  // the dimmed tiles, and leaves the panel that says what is wrong in view. It once docked above
  // the panel's buttons, which put it over the panel's own message until it was dismissed.
  {
    name: 'layout-offline-toast',
    size: DEFAULT_SIZE,
    config: edgePage,
    keepToasts: true,
    setup: async (ctx) => {
      await showOffline(ctx);
      await raiseRefusedCommand(ctx);
      await ctx.waitForExpression(TOASTS_CLEAR_OF_OFFLINE_PANEL, 'the toast clear of the panel');
    },
  },
  // In a narrow window the panel's buttons are where the stack rests, and docked above them it
  // covered the panel's message. It goes above the whole panel, over the weather and media cards.
  {
    name: 'layout-offline-toast-narrow',
    size: NARROW_SIZE,
    config: edgePage,
    keepToasts: true,
    setup: async (ctx) => {
      await showOffline(ctx);
      await raiseRefusedCommand(ctx);
      await ctx.waitForExpression(TOASTS_CLEAR_OF_OFFLINE_PANEL, 'the toast clear of the panel');
    },
  },
  // Three toasts fit neither under the panel nor between it and the header.
  {
    name: 'layout-offline-toasts',
    size: DEFAULT_SIZE,
    config: edgePage,
    keepToasts: true,
    setup: async (ctx) => {
      await showOffline(ctx);
      await raiseThreeOfflineErrors(ctx);
      await ctx.waitForExpression(TOASTS_CLEAR_OF_OFFLINE_PANEL, 'the toasts clear of the panel');
    },
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
    setup: async (ctx) => {
      await showToasts(ctx);
      await ctx.expect(
        PROBLEM_TOAST_REASON_KEEPS_ITS_STOP,
        "the reason's full stop after its words"
      );
    },
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
  // The authorization step names the address it is about to open.
  {
    name: 'wizard-authorize-url',
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunWelcome(ctx);
      await ctx.click('.first-run-actions .btn-primary');
      await ctx.waitForSelector('.first-run-content input');
      await ctx.click('.first-run-content input');
      await ctx.insertText('homeassistant.local:8123');
      await ctx.click('.first-run-actions .btn-primary');
      await ctx.waitForSelector('.first-run-url');
    },
  },
  {
    name: 'first-run-light',
    ui: { theme: 'light' },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  ...contrastScenes('first-run', () => ({
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  })),
  // The welcome step where text runs right to left, in the smallest window, with the largest text
  // and in a contrast theme; and the authorization step when the server cannot be reached.
  {
    name: 'wizard-welcome-ar',
    ui: { language: 'ar' },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  {
    name: 'wizard-welcome-minimum',
    size: MINIMUM_SIZE,
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunWelcome(ctx);
      await ctx.expect(WIZARD_ACTIONS_IN_VIEW, 'the buttons in view');
    },
  },
  // The steps with the most to say, in the smallest window: their text scrolls, their buttons stay.
  {
    name: 'wizard-url-minimum',
    size: MINIMUM_SIZE,
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunWelcome(ctx);
      await ctx.click('.first-run-actions .btn-primary');
      await ctx.waitForSelector('.first-run-content input');
      await ctx.expect(WIZARD_ACTIONS_IN_VIEW, 'the buttons in view');
      await ctx.expect(
        `(() => {
          const text = document.querySelector('.first-run-content');
          const field = text.querySelector('input').getBoundingClientRect();
          const shown = text.getBoundingClientRect();
          return field.top >= shown.top && field.bottom <= shown.bottom;
        })()`,
        'the whole field in view'
      );
    },
  },
  {
    name: 'wizard-authorize-minimum',
    size: MINIMUM_SIZE,
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunAuthorize(ctx, 'homeassistant.local:8123');
      await ctx.expect(WIZARD_ACTIONS_IN_VIEW, 'Back and Connect in view');
      await ctx.expect(
        `(() => {
          const text = document.querySelector('.first-run-content');
          const status = document.querySelector('.first-run-status');
          return text.scrollHeight <= text.clientHeight || status.getBoundingClientRect().height === 0;
        })()`,
        'no empty status line under text that is cut off'
      );
    },
  },
  {
    name: 'wizard-welcome-s130',
    size: DEFAULT_SIZE,
    ui: { scale: 1.3 },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  {
    name: 'wizard-welcome-s150',
    size: DEFAULT_SIZE,
    ui: { scale: 1.5 },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  // The longest welcome (German), a script that joins its letters (Hindi) and one that breaks lines
  // between any two characters (Chinese).
  ...['de', 'hi', 'zh'].map((language) => ({
    name: `wizard-welcome-${language}`,
    ui: { language },
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await showFirstRunWelcome(ctx);
      await ctx.expect(WIZARD_ACTIONS_IN_VIEW, 'the buttons in view');
    },
  })),
  {
    name: 'wizard-welcome-forced-colors',
    media: FORCED_COLORS,
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: showFirstRunWelcome,
  },
  // Windows and macOS have a keyring, so the attempt gets as far as the server and finds no one
  // there. Linux under CI has none, so it stops at the keyring, which a first run is told keeps the
  // new authorization from being saved (it has nothing saved to read). Both go back to the welcome
  // step for the scenes after them, wherever the failure left the wizard.
  {
    name: 'wizard-authorize-error',
    platforms: ['win32', 'darwin'],
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: (ctx) => failFirstRunAuthorization(ctx, 'Could not reach Home Assistant at that URL.'),
    teardown: showFirstRunWelcome,
  },
  {
    name: 'wizard-authorize-keyring',
    platforms: ['linux'],
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: (ctx) => failFirstRunAuthorization(ctx, 'so the authorization cannot be saved.'),
    teardown: showFirstRunWelcome,
  },
  // Waiting for the browser, and that wait cancelled. Only Windows and macOS get as far as asking
  // the server: Linux under CI stops at the missing keyring before anything waits.
  {
    name: 'wizard-authorize-pending',
    platforms: ['win32', 'darwin'],
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await waitForFirstRunAuthorization(ctx);
      await ctx.expect(
        `(() => {
          const [, cancel, connect] = document.querySelectorAll('.first-run-actions .btn');
          return cancel.textContent === 'Cancel' && cancel.classList.contains('btn-neutral') &&
            !cancel.hidden && connect.disabled;
        })()`,
        'Cancel drawn as every other Cancel, and Connect waiting'
      );
    },
    // Only the widget's 8 s limit for the server's answer holds the wait, and the picture is taken
    // after the setup and the settle. On a runner slow enough to pass the limit first, the picture
    // is of the error that follows, so the scene fails instead of passing with it.
    teardown: async (ctx) => {
      const stillWaiting = await ctx.ev(
        `!!document.querySelector('.first-run-status[data-status="pending"]')`
      );
      await cancelFirstRunAuthorization(ctx);
      if (!stillWaiting) throw new Error('the wizard had stopped waiting when it was captured');
    },
  },
  {
    name: 'wizard-authorize-cancelled',
    platforms: ['win32', 'darwin'],
    config: { homeAssistant: { url: '', token: '', authMethod: 'token' } },
    setup: async (ctx) => {
      await waitForFirstRunAuthorization(ctx);
      await ctx.click('.first-run-actions .btn-neutral');
      await ctx.waitForExpression(
        `!document.querySelector('.first-run-actions .btn-primary').disabled`,
        'the wait to end'
      );
      await ctx.expect(
        `(() => {
          const [, back] = document.querySelectorAll('.first-run-actions .btn');
          const status = document.querySelector('.first-run-status');
          return back.textContent === 'Back' && !back.classList.contains('btn-neutral') &&
            !status.dataset.status && !!document.querySelector('.first-run-url');
        })()`,
        'the step as it was before Connect, with nothing to report'
      );
    },
    teardown: showFirstRunWelcome,
  },

  ...startupScenes,
];

module.exports = { scenes };
