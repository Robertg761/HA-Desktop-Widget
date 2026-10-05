/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { triggerMockEvent } = require('../mocks/electron.js');
const { createRendererHarness, warmUpRenderer } = require('../helpers/renderer-harness');

describe('Renderer first-run Home Assistant authorization', () => {
  const harness = createRendererHarness();
  let mockElectronAPI;
  let mockState;
  let mockWebsocket;
  let mockUiUtils;
  let mockHotkeys;
  let mockAlerts;
  let mockSettings;

  const unconfiguredConfig = () => ({
    homeAssistant: {
      url: '',
      token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
    },
    favoriteEntities: [],
    entityAlerts: {
      enabled: false,
      alerts: {},
    },
    globalHotkeys: {
      enabled: false,
      hotkeys: {},
    },
    ui: {
      theme: 'auto',
      enableInteractionDebugLogs: false,
    },
  });

  const { flushAsync } = harness;

  const findButtonByText = (label) =>
    Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label
    );

  const clickButton = async (label) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label
    );
    expect(button).toBeTruthy();
    button.click();
    await flushAsync();
    return button;
  };

  const enterInput = (selector, value) => {
    const input = document.querySelector(selector);
    expect(input).toBeTruthy();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const reachAuthorizationStep = async (url) => {
    await clickButton('Next');
    enterInput('#first-run-ha-url', url);
    await clickButton('Next');
  };

  const oauthConfig = (url = 'http://ha.local:8123') => ({
    ...unconfiguredConfig(),
    homeAssistant: {
      url,
      token: 'short-lived-oauth-access-token',
      authMethod: 'oauth',
      oauthStatus: 'connected',
    },
  });

  // First run boots into a bare page, not the dashboard: a test that needs Settings or a dialog
  // brings its own markup.
  const loadRenderer = async ({
    config = unconfiguredConfig(),
    configureApi,
    bodyHtml = '<main class="widget-content"></main>',
  } = {}) => {
    await harness.load({
      config,
      configureApi,
      shellHtml: bodyHtml,
      ui: { openEntityControls: jest.fn() },
      uiUtils: { showToast: jest.fn(), suspendSeasonalColors: jest.fn() },
      settings: {
        closeSettings: jest.fn(() => jest.requireActual('../../src/settings.js').closeSettings()),
        reapplySettingsPreviews: jest.fn(),
        handleProfileSyncStatusUpdate: jest.fn(),
        revealHomeAssistantToken: jest.fn(),
        profileSyncNeedsAttention: (status) =>
          jest.requireActual('../../src/settings.js').profileSyncNeedsAttention(status),
      },
      utils: {
        getEntityDisplayName: (entity) => entity.attributes?.friendly_name || entity.entity_id,
      },
    });
    ({
      electronAPI: mockElectronAPI,
      state: mockState,
      websocket: mockWebsocket,
      uiUtils: mockUiUtils,
      hotkeys: mockHotkeys,
      alerts: mockAlerts,
      settings: mockSettings,
    } = harness);
  };

  // Closing Settings runs the real settings.js, the largest renderer module, which the first test
  // to close it would otherwise be the one to transform.
  warmUpRenderer(
    async () => {
      await loadRenderer();
      jest.requireActual('../../src/settings.js');
    },
    () => harness.cleanup()
  );
  // cleanup() also stops the renderer the test booted: its timers and window listeners would
  // otherwise act on the next test's page.
  afterEach(() => harness.cleanup());

  it('signals readiness through preload only after renderer configuration initializes', async () => {
    await loadRenderer();

    expect(mockElectronAPI.signalRendererReady).toHaveBeenCalledTimes(1);
    expect(mockElectronAPI.getConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockElectronAPI.signalRendererReady.mock.invocationCallOrder[0]
    );
  });

  it('uses a four-step browser authorization flow without asking for a token', async () => {
    await loadRenderer();

    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 1 of 4');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.getElementById('first-run-onboarding').textContent).not.toContain(
      'Long-Lived Access Token'
    );

    await reachAuthorizationStep('http://ha-one.local:8123');

    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 3 of 4');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.getElementById('first-run-onboarding').textContent).toContain(
      'Authorize in Home Assistant'
    );
  });

  const settingsNavigationHtml = () => {
    const page = new DOMParser().parseFromString(
      fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
      'text/html'
    );
    return `
      <header>${page.getElementById('close-btn').outerHTML}</header>
      <main class="widget-content"></main>
      <div id="settings-modal" class="modal hidden">
        ${page.getElementById('close-settings').outerHTML}
        ${page.getElementById('cancel-settings').outerHTML}
      </div>`;
  };

  it.each(['close-settings', 'cancel-settings'])(
    'returns to the same onboarding step and URL through %s on repeated Settings visits',
    async (closeId) => {
      await loadRenderer({ bodyHtml: settingsNavigationHtml() });
      await clickButton('Next');
      enterInput('#first-run-ha-url', 'http://draft.local:8123');
      const stepLabel = document.querySelector('.first-run-step-label').textContent;
      const wizard = document.getElementById('first-run-onboarding');
      const modal = document.getElementById('settings-modal');

      for (let visit = 0; visit < 2; visit += 1) {
        await clickButton('Full Settings');
        expect(wizard.classList.contains('hidden')).toBe(true);
        expect(modal.classList.contains('hidden')).toBe(false);
        document.getElementById(closeId).click();
        await flushAsync();

        expect(modal.classList.contains('hidden')).toBe(true);
        expect(wizard.classList.contains('hidden')).toBe(false);
        expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
        expect(document.getElementById('first-run-ha-url').value).toBe('http://draft.local:8123');
        expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
      }
      expect(mockSettings.closeSettings).toHaveBeenCalledTimes(2);

      // Once Settings has closed, the title bar's X closes the window like Alt+F4 does.
      document.getElementById('close-btn').click();
      expect(mockElectronAPI.closeWindow).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
    }
  );

  it.each([
    [
      'quick-controls-modal',
      '#manage-quick-controls-btn',
      '<button id="manage-quick-controls-btn"></button>',
    ],
    [
      'weather-config-modal',
      '#weather-card',
      '<div id="weather-card" class="status-card weather-card" data-primary-type="weather" tabindex="0" role="button"></div><div id="time-card" class="status-card"></div>',
    ],
  ])(
    'closes %s with Escape without also leaving reorganize mode',
    async (id, opener, openerHtml) => {
      const page = new DOMParser().parseFromString(
        fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
        'text/html'
      );
      await loadRenderer({
        bodyHtml: `<main class="widget-content"><div class="status-grid">${openerHtml}</div></main>${page.getElementById(id).outerHTML}`,
      });
      const modal = document.getElementById(id);
      const trigger = document.querySelector(opener);
      trigger.focus();
      if (id === 'weather-config-modal') {
        trigger.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
      } else {
        trigger.click();
      }
      await flushAsync();
      expect(modal.classList.contains('hidden')).toBe(false);
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);
      modal
        .querySelector('.close-btn')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
      await flushAsync();
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(pageEscape).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageEscape);
    }
  );

  it('opens Manage Quick Access on its search field, and returns to the button that opened it', async () => {
    const page = new DOMParser().parseFromString(
      fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
      'text/html'
    );
    await loadRenderer({
      bodyHtml: `<main class="widget-content"><button id="manage-quick-controls-btn"></button></main>${page.getElementById('quick-controls-modal').outerHTML}`,
    });
    const opener = document.getElementById('manage-quick-controls-btn');
    const modal = document.getElementById('quick-controls-modal');
    opener.focus();
    opener.click();
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The search is what a visit starts with; Close first meant typing did nothing, and a stray
    // Enter or Space dismissed the dialog.
    expect(document.activeElement.id).toBe('quick-controls-search');
    expect(modal.getAttribute('role')).toBe('dialog');

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modal.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Escape and the backdrop from dismissing the first-run wizard, and leaves the header usable', async () => {
    await loadRenderer({
      bodyHtml: `<header class="widget-header"><button id="close-btn">x</button></header>${settingsNavigationHtml()}`,
    });
    const wizard = document.getElementById('first-run-onboarding');
    expect(wizard.classList.contains('hidden')).toBe(false);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(escape);
    wizard.click();

    // It asks for an answer: nothing but its own buttons closes it.
    expect(wizard.classList.contains('hidden')).toBe(false);
    // The overlay starts under the header, whose height it was told, so the window's own buttons and
    // drag area keep working. Layout is not computed here, so the measured height is zero.
    expect(document.documentElement.style.getPropertyValue('--header-height')).toBe('0px');
  });

  it.each(['Enter', ' ', 'ContextMenu'])(
    'opens the weather picker from the keyboard (%p) and returns focus to the card',
    async (key) => {
      const page = new DOMParser().parseFromString(
        fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
        'text/html'
      );
      await loadRenderer({
        bodyHtml:
          '<main class="widget-content"><div class="status-grid">' +
          '<div id="weather-card" class="status-card weather-card" data-primary-type="weather"' +
          ' tabindex="0" role="button"></div><div id="time-card" class="status-card"></div>' +
          `</div></main>${page.getElementById('weather-config-modal').outerHTML}`,
      });
      const card = document.getElementById('weather-card');
      const modal = document.getElementById('weather-config-modal');
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await flushAsync();
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(require('../../src/ui.js').populateWeatherEntitiesList).toHaveBeenCalled();

      modal
        .querySelector('.close-btn')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
      await flushAsync();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(document.activeElement).toBe(card);
    }
  );

  it('moves focus into each wizard step and traps Tab inside the wizard', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    const wizard = document.getElementById('first-run-onboarding');
    expect(document.activeElement).toBe(wizard.querySelector('.first-run-title'));
    // It is named by the step's heading, not by the whole step, and described by its lead text.
    const accessibleName = () =>
      document.getElementById(wizard.getAttribute('aria-labelledby')).textContent;
    expect(wizard.getAttribute('role')).toBe('dialog');
    expect(wizard.getAttribute('aria-modal')).toBe('true');
    expect(accessibleName()).toBe('Welcome to HA Desktop Widget');
    expect(document.getElementById(wizard.getAttribute('aria-describedby')).tagName).toBe('P');

    await clickButton('Next');
    expect(document.activeElement).toBe(document.getElementById('first-run-ha-url'));
    expect(accessibleName()).toBe('Enter your Home Assistant URL');
    enterInput('#first-run-ha-url', 'http://ha.local:8123');
    await clickButton('Next');
    expect(document.activeElement.textContent).toBe('Authorize in Home Assistant');
    expect(accessibleName()).toBe('Authorize in Home Assistant');

    const buttons = Array.from(wizard.querySelectorAll('button:not(:disabled)'));
    const last = buttons[buttons.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    // Focus that fell to <body> goes back into the wizard, not to the header behind it.
    document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    document.getElementById('close-btn').focus();
    await flushAsync();
    expect(wizard.contains(document.activeElement)).toBe(true);
  });

  it.each([
    ['', 'Home Assistant URL cannot be empty'],
    ['   ', 'Home Assistant URL cannot be empty'],
    ['ftp://ha.local', 'URL must start with http:// or https://'],
    ['ha local', 'Enter a valid Home Assistant URL before connecting.'],
  ])('keeps the URL step and explains the problem when Next gets %p', async (url, explanation) => {
    await loadRenderer();
    await clickButton('Next');
    enterInput('#first-run-ha-url', url);
    await clickButton('Next');
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 2 of 4');
    expect(document.querySelector('.first-run-status').textContent).toContain(explanation);
    expect(document.activeElement).toBe(document.getElementById('first-run-ha-url'));
  });

  it('names the address the authorization step will open, with the scheme a bare host gains', async () => {
    await loadRenderer();
    await reachAuthorizationStep('ha.local:8123');

    const line = document.querySelector('.first-run-url');
    expect(line.textContent).toBe('http://ha.local:8123');
    expect(line.querySelector('bdi').dir).toBe('ltr');
  });

  it('treats Enter in the URL field as Next', async () => {
    await loadRenderer();
    await clickButton('Next');
    enterInput('#first-run-ha-url', 'http://ha.local:8123');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.getElementById('first-run-ha-url').dispatchEvent(enter);
    await flushAsync();
    expect(enter.defaultPrevented).toBe(true);
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 3 of 4');
  });

  it('does not quit on repeated close clicks during the Settings exit animation', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await reachAuthorizationStep('http://draft.local:8123');
    const stepLabel = document.querySelector('.first-run-step-label').textContent;
    await clickButton('Full Settings');
    const modal = document.getElementById('settings-modal');
    mockSettings.closeSettings.mockImplementation(() => modal.classList.add('modal-closing'));

    document.getElementById('close-settings').click();
    await flushAsync();
    document.getElementById('close-settings').click();
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(true);

    modal.classList.remove('modal-closing');
    modal.classList.add('hidden');
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
      false
    );
    expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
  });

  it('preserves the onboarding step and draft URL when settings changes echo back', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await clickButton('Next');
    enterInput('#first-run-ha-url', 'http://draft.local:8123');
    const stepLabel = document.querySelector('.first-run-step-label').textContent;
    await clickButton('Full Settings');

    triggerMockEvent('configUpdated', {
      ...unconfiguredConfig(),
      ui: { ...unconfiguredConfig().ui, theme: 'dark' },
    });
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(true);
    document.getElementById('close-settings').click();
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
      false
    );
    expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
    expect(document.getElementById('first-run-ha-url').value).toBe('http://draft.local:8123');
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
  });

  it('keeps the open wizard on its step when a config update arrives', async () => {
    await loadRenderer();
    await clickButton('Next');
    enterInput('#first-run-ha-url', 'http://draft.local:8123');
    triggerMockEvent('configUpdated', {
      ...unconfiguredConfig(),
      ui: { ...unconfiguredConfig().ui, theme: 'dark' },
    });
    await flushAsync();
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 2 of 4');
    expect(document.getElementById('first-run-ha-url').value).toBe('http://draft.local:8123');

    await clickButton('Next');
    triggerMockEvent('configUpdated', {
      ...unconfiguredConfig(),
      homeAssistant: { ...unconfiguredConfig().homeAssistant, url: 'http://draft.local:8123' },
    });
    await flushAsync();
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 3 of 4');
  });

  describe('visual snapshot first-run scenes', () => {
    const { scenes } = require('../../scripts/visual-snapshots/scenes.cjs');
    const firstRunScenes = scenes.filter((scene) => scene.name.startsWith('first-run'));

    // The runner's side of a scene: the page expressions and clicks its setup asks for.
    const snapshotContext = () => {
      const waitFor = async (check, label) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          if (check()) return;
          await flushAsync();
        }
        throw new Error(`Timed out waiting for ${label}`);
      };
      return {
        ev: (expression) => window.eval(expression),
        click: async (selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error(`Nothing matches ${selector}`);
          element.click();
          await flushAsync();
        },
        waitForSelector: (selector) => waitFor(() => document.querySelector(selector), selector),
        waitForExpression: (expression, label = expression) =>
          waitFor(() => window.eval(`!!(${expression})`), label),
      };
    };

    // A scene changes the settings the runner lists for it, which reaches the page as a config
    // broadcast, and then drives the page.
    const playScene = async (scene) => {
      triggerMockEvent('configUpdated', {
        ...unconfiguredConfig(),
        ui: { ...unconfiguredConfig().ui, ...scene.ui },
      });
      await flushAsync();
      await scene.setup(snapshotContext());
      return document.querySelector('.first-run-step-label').textContent;
    };

    const orderings = (names) =>
      names.length < 2
        ? [names]
        : names.flatMap((name, index) =>
            orderings([...names.slice(0, index), ...names.slice(index + 1)]).map((rest) => [
              name,
              ...rest,
            ])
          );

    it('has the three first-run scenes this test is about', () => {
      expect(firstRunScenes.map((scene) => scene.name)).toEqual([
        'first-run',
        'first-run-url',
        'first-run-light',
      ]);
    });

    it('captures each scene on the same wizard step whichever scenes ran before it', async () => {
      const alone = {};
      for (const scene of firstRunScenes) {
        await loadRenderer();
        alone[scene.name] = await playScene(scene);
      }
      expect(alone).toEqual({
        'first-run': 'Step 1 of 4',
        'first-run-url': 'Step 2 of 4',
        'first-run-light': 'Step 1 of 4',
      });

      // The full run plays them in the order of the list; a filtered run plays some of them, and
      // a scene may be played again, so every sequence has to agree with the single runs.
      const names = firstRunScenes.map((scene) => scene.name);
      const sequences = [...orderings(names), ['first-run-url', 'first-run-url']];
      for (const sequence of sequences) {
        await loadRenderer();
        for (const name of sequence) {
          const step = await playScene(firstRunScenes.find((scene) => scene.name === name));
          expect({ sequence: sequence.join(' > '), name, step }).toEqual({
            sequence: sequence.join(' > '),
            name,
            step: alone[name],
          });
        }
      }
    });
  });

  it('distinguishes the title bar Hide from the Settings Close action', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    expect(document.querySelector('button[aria-label="Close"]').id).toBe('close-settings');
    expect(document.getElementById('close-btn').getAttribute('data-i18n-aria-label')).toBe('Hide');
    expect(document.getElementById('close-btn').title).toBe('Hide');
  });

  it.each(['close-settings', 'cancel-settings'])(
    'does not revive onboarding after a connection is saved and Settings closes through %s',
    async (closeId) => {
      await loadRenderer({ bodyHtml: settingsNavigationHtml() });
      await clickButton('Full Settings');
      mockState.setConfig(oauthConfig());
      document.getElementById(closeId).click();
      await flushAsync();

      expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
        true
      );
      expect(mockElectronAPI.closeWindow).not.toHaveBeenCalled();
      document.getElementById('close-btn').click();
      expect(mockElectronAPI.closeWindow).toHaveBeenCalledTimes(1);
    }
  );

  it('closes the window from the title bar even during a Settings detour, without quitting', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await clickButton('Full Settings');
    document.getElementById('close-btn').click();
    expect(mockElectronAPI.closeWindow).toHaveBeenCalledTimes(1);
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
    expect(mockSettings.closeSettings).not.toHaveBeenCalled();
  });

  it('closes the window from the title bar for configured users, without quitting', async () => {
    await loadRenderer({ config: oauthConfig(), bodyHtml: settingsNavigationHtml() });
    mockSettings.openSettings();
    document.getElementById('close-btn').click();
    expect(mockElectronAPI.closeWindow).toHaveBeenCalledTimes(1);
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
    expect(mockSettings.closeSettings).not.toHaveBeenCalled();
  });

  describe('the main window outside the wizard', () => {
    it("opens the primary media player's controls from the track, which has no volume of its own", async () => {
      const player = {
        entity_id: 'media_player.living_room',
        state: 'playing',
        attributes: { friendly_name: 'Living room' },
      };
      await loadRenderer({
        config: { ...unconfiguredConfig(), primaryMediaPlayer: 'media_player.living_room' },
        bodyHtml:
          '<main class="widget-content"><button id="media-tile-info" type="button"></button></main>',
      });
      mockState.STATES = { [player.entity_id]: player };
      mockState.CONFIG = { ...mockState.CONFIG, primaryMediaPlayer: player.entity_id };

      document.getElementById('media-tile-info').click();

      expect(require('../../src/ui.js').openEntityControls).toHaveBeenCalledWith(player);
    });

    it('does nothing from the track while the player is not in Home Assistant', async () => {
      await loadRenderer({
        config: { ...unconfiguredConfig(), primaryMediaPlayer: 'media_player.gone' },
        bodyHtml:
          '<main class="widget-content"><button id="media-tile-info" type="button"></button></main>',
      });
      mockState.STATES = {};

      document.getElementById('media-tile-info').click();

      expect(require('../../src/ui.js').openEntityControls).not.toHaveBeenCalled();
    });

    it.each([
      ['darwin', 'Cmd+K'],
      ['win32', 'Ctrl+K'],
      ['linux', 'Ctrl+K'],
    ])('tells %s to press %s for the command palette', async (platform, shortcut) => {
      await loadRenderer({
        configureApi(api) {
          api.platform = platform;
        },
        bodyHtml:
          '<main class="widget-content"></main><div id="command-palette-hint" data-i18n-vars=\'{"shortcut":"Ctrl+K"}\'></div>',
      });

      expect(
        JSON.parse(document.getElementById('command-palette-hint').getAttribute('data-i18n-vars'))
      ).toEqual({ shortcut });
    });

    it.each([
      ['darwin', { ctrl: 'Control', alt: 'Option', meta: 'Cmd', example: 'Shift+Cmd+A' }],
      ['win32', { ctrl: 'Ctrl', alt: 'Alt', meta: 'Win', example: 'Ctrl+Shift+A' }],
      ['linux', { ctrl: 'Ctrl', alt: 'Alt', meta: 'Super', example: 'Ctrl+Shift+A' }],
    ])('names the entity hotkey modifiers as a %s keyboard prints them', async (platform, keys) => {
      await loadRenderer({
        configureApi(api) {
          api.platform = platform;
        },
        bodyHtml:
          '<main class="widget-content"></main><p id="entity-hotkeys-help" data-i18n-vars="{}"></p>',
      });

      expect(
        JSON.parse(document.getElementById('entity-hotkeys-help').getAttribute('data-i18n-vars'))
      ).toEqual({ ...keys, shift: 'Shift' });
    });
  });

  it('starts fresh installs with an empty URL and the Home Assistant 2026.8 address hint', async () => {
    await loadRenderer();

    await clickButton('Next');
    const input = document.getElementById('first-run-ha-url');

    expect(input.value).toBe('');
    expect(input.placeholder).toBe('http://homeassistant.local');
    // An address is not prose: no spelling underline, no capital, no autofill, a URL keyboard
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('inputmode')).toBe('url');
  });

  it('authorizes a fresh Home Assistant 2026.8 install without adding the legacy port', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({
          success: true,
          config: oauthConfig('http://homeassistant.local'),
        });
      },
    });

    await reachAuthorizationStep('homeassistant.local');
    await clickButton('Connect');

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith(
      'http://homeassistant.local'
    );
  });

  it('authorizes the normalized URL and starts the configured runtime', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({
          success: true,
          config: oauthConfig('http://ha.local:8123'),
        });
      },
    });
    await reachAuthorizationStep('ha.local:8123/path');
    await clickButton('Connect');

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith('http://ha.local:8123');
    expect(mockElectronAPI.testHaConnection).not.toHaveBeenCalled();
    expect(mockState.CONFIG.homeAssistant.authMethod).toBe('oauth');
    expect(document.getElementById('first-run-onboarding').classList).not.toContain('hidden');
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 4 of 4');
    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
    await clickButton('Skip for now');
    expect(document.getElementById('first-run-onboarding').classList).toContain('hidden');
  });

  it('opens the shared starter builder after authorization', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({ config: oauthConfig() });
      },
    });
    await reachAuthorizationStep('ha.local:8123');
    await clickButton('Connect');
    await clickButton('Choose rooms and entities');
    expect(require('../../src/ui.js').showAddPageModal).toHaveBeenCalledWith({ starter: true });
    expect(document.getElementById('first-run-onboarding').classList).toContain('hidden');
  });

  it('offers the starter builder on a connected empty dashboard without onboarding existing users', async () => {
    await loadRenderer({ config: oauthConfig() });
    expect(document.getElementById('first-run-onboarding')).toBeNull();
    let nextRequestId = 123;
    mockWebsocket.request.mockImplementation(({ type }) => {
      const id = nextRequestId++;
      const result =
        type === 'get_states' || type === 'config/area_registry/list'
          ? []
          : type === 'get_services' || type === 'get_config'
            ? {}
            : null;
      return Object.assign(Promise.resolve({ type: 'result', id, success: true, result }), { id });
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    mockWebsocket.emit('message', { type: 'result', id: 123, success: true, result: [] });
    await flushAsync();
    await clickButton('Choose rooms and entities');
    expect(require('../../src/ui.js').showAddPageModal).toHaveBeenCalledWith({ starter: true });
  });

  describe('the empty page card', () => {
    const connectWithEmptyPage = async (customTabs, activeTabId) => {
      await loadRenderer({ config: { ...oauthConfig(), customTabs, activeTabId } });
      let nextRequestId = 123;
      mockWebsocket.request.mockImplementation(({ type }) => {
        const id = nextRequestId++;
        const result =
          type === 'get_states' || type === 'config/area_registry/list'
            ? []
            : type === 'get_services' || type === 'get_config'
              ? {}
              : null;
        return Object.assign(Promise.resolve({ type: 'result', id, success: true, result }), {
          id,
        });
      });
      mockWebsocket.emit('message', { type: 'auth_ok' });
      mockWebsocket.emit('message', { type: 'result', id: 123, success: true, result: [] });
      await flushAsync();
      return document.getElementById('widget-state-panel');
    };

    it('says it is this page that is empty beside other pages, and names it', async () => {
      const panel = await connectWithEmptyPage(
        [
          { id: 'home', name: 'Home', entityIds: ['light.desk'] },
          { id: 'garage', name: 'Garage', entityIds: [] },
        ],
        'garage'
      );
      expect(panel.textContent).toContain('This page is empty');
      expect(panel.textContent).toContain('Add entities to Garage for one-click control.');
      expect(panel.textContent).not.toContain('No Quick Access entities yet');
      expect(panel.textContent).toContain('Choose rooms and entities');
    });

    it('keeps the first-run wording when the empty page is the only one', async () => {
      const panel = await connectWithEmptyPage(
        [{ id: 'default', name: 'Home', entityIds: [] }],
        'default'
      );
      expect(panel.textContent).toContain('No Quick Access entities yet');
      expect(panel.textContent).not.toContain('This page is empty');
    });
  });

  it('coalesces duplicate Connect clicks while browser authorization is pending', async () => {
    await loadRenderer();
    let resolveAuthorization;
    mockElectronAPI.startHomeAssistantOAuth.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthorization = resolve;
        })
    );
    await reachAuthorizationStep('http://ha.local:8123');

    const connectButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Connect'
    );
    connectButton.click();
    connectButton.click();
    await flushAsync();

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledTimes(1);
    expect(mockWebsocket.connect).not.toHaveBeenCalled();

    resolveAuthorization({ success: true, config: oauthConfig() });
    await flushAsync();

    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
  });

  it('refreshes Undo when a config broadcast switches Home Assistant servers', async () => {
    localStorage.clear();
    try {
      await loadRenderer({
        config: oauthConfig('http://server-a:8123'),
        bodyHtml:
          '<main class="widget-content"><button id="undo-dashboard-btn" disabled>Undo</button></main>',
      });
      const { rememberDashboard } = require('../../src/dashboard-history.js');
      const nextConfig = oauthConfig('http://server-b:8123');
      nextConfig.customTabs = [{ id: 'one', name: 'One', entityIds: [] }];
      rememberDashboard(nextConfig, {
        ...nextConfig,
        customTabs: [{ id: 'two', name: 'Two', entityIds: [] }],
      });
      const undo = document.getElementById('undo-dashboard-btn');
      expect(undo.disabled).toBe(true);
      triggerMockEvent('configUpdated', nextConfig);
      await flushAsync();
      expect(undo.disabled).toBe(false);
      triggerMockEvent('configUpdated', oauthConfig('http://server-a:8123'));
      await flushAsync();
      expect(undo.disabled).toBe(true);
    } finally {
      localStorage.clear();
    }
  });

  it('restores unsaved Settings previews after a config echo re-applies the saved appearance', async () => {
    await loadRenderer({ config: oauthConfig() });
    mockUiUtils.applyUiPreferences.mockClear();
    mockSettings.reapplySettingsPreviews.mockClear();

    triggerMockEvent('configUpdated', { ...oauthConfig(), ui: { density: 'compact' } });
    await flushAsync();

    expect(mockSettings.reapplySettingsPreviews).toHaveBeenCalledTimes(1);
    expect(mockUiUtils.applyUiPreferences.mock.invocationCallOrder[0]).toBeLessThan(
      mockSettings.reapplySettingsPreviews.mock.invocationCallOrder[0]
    );
  });

  it('gives Settings a hook that reloads the interface language', async () => {
    await loadRenderer({ config: oauthConfig() });
    triggerMockEvent('openSettings');
    const hooks = mockSettings.openSettings.mock.calls[0][0];
    const { setLocaleBootstrap, translateDocument } = require('../../src/i18n.js');
    const { renderActiveTab } = require('../../src/ui.js');
    mockElectronAPI.getLocaleBootstrap.mockClear();
    setLocaleBootstrap.mockClear();
    renderActiveTab.mockClear();

    await hooks.refreshLocale();

    expect(mockElectronAPI.getLocaleBootstrap).toHaveBeenCalledTimes(1);
    expect(setLocaleBootstrap).toHaveBeenCalledTimes(1);
    expect(translateDocument).toHaveBeenCalledWith(document);
    expect(renderActiveTab).toHaveBeenCalled();
  });

  it('starts the runtime once when OAuth completion also broadcasts config-updated', async () => {
    await loadRenderer();
    mockElectronAPI.startHomeAssistantOAuth.mockImplementationOnce(async () => {
      const nextConfig = oauthConfig();
      triggerMockEvent('configUpdated', nextConfig);
      await Promise.resolve();
      return { success: true, config: nextConfig };
    });
    await reachAuthorizationStep('http://ha.local:8123');

    await clickButton('Connect');
    await flushAsync();

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalled();
    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps onboarding open and shows the pairing error when authorization fails', async () => {
    await loadRenderer();
    mockElectronAPI.startHomeAssistantOAuth.mockRejectedValueOnce(
      new Error('authorization denied')
    );
    await reachAuthorizationStep('http://ha.local:8123');

    await clickButton('Connect');

    const wizard = document.getElementById('first-run-onboarding');
    const status = document.querySelector('.first-run-status');
    expect(wizard.classList).not.toContain('hidden');
    expect(status.dataset.status).toBe('error');
    expect(status.textContent).toContain('authorization denied');
    // An error interrupts: the role and the explicit politeness have to agree, or it is read politely.
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.getAttribute('aria-live')).toBe('assertive');
    // The wizard says it in its own status line, so a toast would say it twice.
    expect(mockUiUtils.showToast).not.toHaveBeenCalled();
    expect(mockWebsocket.connect).not.toHaveBeenCalled();
    expect(mockState.CONFIG.homeAssistant.token).toBe('YOUR_LONG_LIVED_ACCESS_TOKEN');
  });

  it('keeps the pairing message and busy button until a cancelled authorization has stopped', async () => {
    let releasePairing;
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releasePairing = resolve;
            })
        );
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    // Authorization runs for minutes in the browser. Leaving the step used to wipe the only
    // sign it was running, stranding a disabled button with nothing to explain it.
    await clickButton('Cancel');

    const status = document.querySelector('.first-run-status');
    expect(status.textContent).toContain('Waiting for you to approve in your browser');
    expect(status.dataset.status).toBe('pending');
    // Cancel stays on the Authorize step, whose button is Connect.
    const connect = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Connect'
    );
    expect(connect.disabled).toBe(true);
    expect(connect.getAttribute('aria-busy')).toBe('true');

    releasePairing?.({ success: true, config: oauthConfig() });
    await flushAsync();
  });

  it('cancels the pairing when the user cancels out of authorization', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(() => new Promise(() => {}));
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    await clickButton('Cancel');

    // Otherwise the loopback listener stays open and the next attempt is refused.
    expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalled();
  });

  const wizardButton = (label) =>
    Array.from(document.querySelectorAll('.first-run-actions button')).find(
      (candidate) => candidate.textContent === label
    );

  it('offers no Back on the first step or the last, where there is nowhere to go back to', async () => {
    await loadRenderer();
    expect(wizardButton('Back').hidden).toBe(true);
    expect(wizardButton('Back').disabled).toBe(false);

    await clickButton('Next');
    expect(wizardButton('Back').hidden).toBe(false);
    enterInput('#first-run-ha-url', 'http://ha.local:8123');
    await clickButton('Next');
    expect(wizardButton('Back').hidden).toBe(false);

    mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
      success: true,
      config: oauthConfig(),
    });
    await clickButton('Connect');
    expect(document.querySelector('.first-run-title').textContent).toBe(
      'Choose rooms and entities'
    );
    expect(wizardButton('Back').hidden).toBe(true);
  });

  it('turns Back into Cancel while authorization waits, and Cancel keeps the step', async () => {
    let rejectPairing;
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              rejectPairing = reject;
            })
        );
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    expect(wizardButton('Back')).toBeTruthy();

    await clickButton('Connect');
    expect(wizardButton('Back')).toBeUndefined();
    expect(wizardButton('Cancel').hidden).toBe(false);

    await clickButton('Cancel');
    const cancelError = new Error('Home Assistant authorization was cancelled');
    cancelError.result = { code: 'OAUTH_AUTHORIZATION_CANCELED' };
    rejectPairing(cancelError);
    await flushAsync();

    // Still on the Authorize step, Connect ready again, Back where it was.
    expect(document.querySelector('.first-run-title').textContent).toBe(
      'Authorize in Home Assistant'
    );
    expect(wizardButton('Connect').disabled).toBe(false);
    expect(wizardButton('Back').hidden).toBe(false);
    expect(wizardButton('Cancel')).toBeUndefined();
  });

  it('says what it is waiting for once the browser has had time to open', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(() => new Promise(() => {}));
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    jest.useFakeTimers();
    try {
      wizardButton('Connect').click();
      await jest.advanceTimersByTimeAsync(1000);
      const status = document.querySelector('.first-run-status');
      expect(status.textContent).toBe('Waiting for you to approve in your browser...');

      await jest.advanceTimersByTimeAsync(4000);
      expect(status.textContent).toBe(
        'Waiting for you to approve HA Desktop Widget in your browser. If it did not open, choose Cancel, then Connect again.'
      );
      expect(status.dataset.status).toBe('pending');

      // A cancelled wait does not announce itself again.
      wizardButton('Cancel').click();
      await jest.advanceTimersByTimeAsync(10);
      expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a cancelled pairing as cancelled rather than as a failure', async () => {
    let rejectPairing;
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              rejectPairing = reject;
            })
        );
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    await clickButton('Cancel');
    rejectPairing?.(new Error('Home Assistant authorization was cancelled'));
    await flushAsync();

    const status = document.querySelector('.first-run-status');
    expect(status.dataset.status).not.toBe('error');
    expect(mockUiUtils.showToast).not.toHaveBeenCalled();
  });

  it('recovers the Connect button when preparing the request throws', async () => {
    // normalizeBaseUrl used to run outside the try, so a throw there skipped the finally and
    // left the button disabled with the in-progress guard set -- every later click ignored
    // until the app restarted. It only throws for this sentinel so rendering stays unaffected,
    // and only on its second check: the first is the URL step's own validation.
    const actualConnection = jest.requireActual('../../src/connection.js');
    let sentinelChecks = 0;
    jest.doMock('../../src/connection.js', () => ({
      __esModule: true,
      ...actualConnection,
      normalizeBaseUrl: (value) => {
        if (value === 'http://boom.local' && ++sentinelChecks === 2) {
          throw new Error('exploded before dispatch');
        }
        return actualConnection.normalizeBaseUrl(value);
      },
    }));

    await loadRenderer();
    await reachAuthorizationStep('http://boom.local');

    await clickButton('Connect');

    const connect = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Connect'
    );
    expect(connect.disabled).toBe(false);
    expect(mockElectronAPI.startHomeAssistantOAuth).not.toHaveBeenCalled();

    // And the guard no longer swallows the retry: clicking again reaches the main process.
    mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
      success: true,
      config: oauthConfig(),
    });
    await clickButton('Connect');
    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledTimes(1);

    jest.dontMock('../../src/connection.js');
  });

  it('shows one runtime-only recovery warning with the quarantined config path', async () => {
    await loadRenderer({
      config: {
        ...unconfiguredConfig(),
        configRecovery: {
          recovered: true,
          backupPath: '/tmp/config.corrupt.2026-07-27.json',
          error: '',
        },
      },
    });

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/config.corrupt.2026-07-27.json'),
      'warning',
      20000
    );
    expect(mockState.CONFIG).not.toHaveProperty('configRecovery');

    triggerMockEvent('configUpdated', {
      ...mockState.CONFIG,
      configRecovery: {
        recovered: true,
        backupPath: '/tmp/config.corrupt.2026-07-27.json',
      },
    });
    await flushAsync();
    expect(mockState.CONFIG).not.toHaveProperty('configRecovery');
    expect(mockUiUtils.showToast).toHaveBeenCalledTimes(1);
  });

  it('shows and strips token persistence warnings delivered after a save', async () => {
    await loadRenderer();
    mockUiUtils.showToast.mockClear();

    triggerMockEvent('configPersistenceWarning', [{ code: 'home_assistant_token_not_persisted' }]);
    await flushAsync();

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Token encryption is not available'),
      'warning',
      10000,
      { source: 'startup-warning' }
    );
    expect(mockState.CONFIG).not.toHaveProperty('persistenceWarnings');
  });

  describe('sync that needs the person', () => {
    const attentionToast = [
      'Profile sync needs attention. Open Settings > Advanced.',
      'warning',
      expect.any(Number),
    ];

    it('is said once when a sync starts waiting or failing, wherever the person is', async () => {
      await loadRenderer({ bodyHtml: '<div id="settings-modal" class="hidden"></div>' });
      mockUiUtils.showToast.mockClear();

      triggerMockEvent('profileSyncStatus', { enabled: true, needsResolution: true });
      triggerMockEvent('profileSyncStatus', { enabled: true, needsResolution: true });
      triggerMockEvent('profileSyncStatus', {
        enabled: true,
        needsResolution: true,
        inFlight: true,
      });
      expect(mockUiUtils.showToast).toHaveBeenCalledTimes(1);
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(...attentionToast);

      // Once it is healthy again, the next trouble is news again.
      triggerMockEvent('profileSyncStatus', { enabled: true, lastSyncStatus: 'success' });
      triggerMockEvent('profileSyncStatus', { enabled: true, lastSyncStatus: 'error' });
      expect(mockUiUtils.showToast).toHaveBeenCalledTimes(2);
    });

    it('stays quiet while Settings is open, where the state is on screen', async () => {
      await loadRenderer({ bodyHtml: '<div id="settings-modal"></div>' });
      mockUiUtils.showToast.mockClear();

      triggerMockEvent('profileSyncStatus', { enabled: true, lastSyncStatus: 'error' });

      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
    });

    it('stays quiet for a healthy or switched-off sync', async () => {
      await loadRenderer({ bodyHtml: '<div id="settings-modal" class="hidden"></div>' });
      mockUiUtils.showToast.mockClear();

      triggerMockEvent('profileSyncStatus', { enabled: true, lastSyncStatus: 'success' });
      triggerMockEvent('profileSyncStatus', { enabled: false, lastSyncStatus: 'error' });

      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
    });
  });

  it('says the token was not saved once per session, however often settings are saved', async () => {
    await loadRenderer();
    mockUiUtils.showToast.mockClear();

    for (let save = 0; save < 3; save += 1) {
      triggerMockEvent('configPersistenceWarning', [
        { code: 'home_assistant_token_not_persisted' },
      ]);
      await flushAsync();
    }

    expect(mockUiUtils.showToast).toHaveBeenCalledTimes(1);
  });

  it('names the missing keyring on Linux instead of telling the user to re-enter the token', async () => {
    await loadRenderer({
      configureApi(api) {
        api.platform = 'linux';
      },
    });
    mockUiUtils.showToast.mockClear();

    triggerMockEvent('configPersistenceWarning', [{ code: 'home_assistant_token_not_persisted' }]);
    await flushAsync();

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('No unlocked system keyring (Secret Service) was found'),
      'warning',
      10000,
      { source: 'startup-warning' }
    );
  });

  describe('a system language the app has as a pack that is not downloaded', () => {
    const arabicSystem = (api) => {
      api.getLocaleBootstrap.mockResolvedValue({
        languageSetting: 'auto',
        detectedLocale: 'ar-EG',
        requestedLocale: 'ar-EG',
        activeLocale: 'en',
        usingEnglishFallback: true,
        messages: {},
      });
      api.getLocalePacks.mockResolvedValue([
        { locale: 'ar', displayName: 'العربية', englishName: 'Arabic', installed: false },
        { locale: 'fr', displayName: 'Français', englishName: 'French', installed: false },
      ]);
    };
    const offer = () => document.getElementById('first-run-language-offer');

    it('is offered on the welcome step, by its own name', async () => {
      await loadRenderer({ configureApi: arabicSystem });

      expect(offer().hidden).toBe(false);
      expect(offer().textContent).toContain('HA Desktop Widget is available in العربية.');
      const download = offer().querySelector('button');
      expect(download.textContent).toBe('Download');
      expect(download.getAttribute('aria-label')).toBe('Download العربية');
    });

    it('is downloaded from there, and the wizard is drawn again in it', async () => {
      await loadRenderer({ configureApi: arabicSystem });
      mockElectronAPI.getLocaleBootstrap.mockClear();

      offer().querySelector('button').click();
      await flushAsync();

      expect(mockElectronAPI.downloadLocalePack).toHaveBeenCalledWith('ar');
      expect(mockElectronAPI.getLocaleBootstrap).toHaveBeenCalled();
      expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 1 of 4');
    });

    it('says so when the download fails, and lets it be tried again', async () => {
      await loadRenderer({
        configureApi(api) {
          arabicSystem(api);
          api.downloadLocalePack.mockRejectedValueOnce(new Error('offline'));
        },
      });

      const download = offer().querySelector('button');
      download.click();
      await flushAsync();

      expect(document.querySelector('.first-run-status').textContent).toBe(
        'Failed to download language pack'
      );
      expect(download.disabled).toBe(false);
    });

    it.each([
      ['an English system', { usingEnglishFallback: false, detectedLocale: 'en-US' }],
      ['a language the user chose', { languageSetting: 'en', detectedLocale: 'ar-EG' }],
      ['a language with no pack', { detectedLocale: 'ja-JP' }],
    ])('is not offered for %s', async (_name, locale) => {
      await loadRenderer({
        configureApi(api) {
          arabicSystem(api);
          api.getLocaleBootstrap.mockResolvedValue({
            languageSetting: 'auto',
            activeLocale: 'en',
            usingEnglishFallback: true,
            messages: {},
            ...locale,
          });
        },
      });

      expect(offer().hidden).toBe(true);
      expect(offer().textContent).toBe('');
    });
  });

  describe('a saved token this computer cannot read', () => {
    // An existing setup: its server and pages are saved, only the token could not be used.
    const recoveryConfig = (tokenResetReason) => ({
      ...unconfiguredConfig(),
      homeAssistant: {
        url: 'http://ha.local:8123',
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        authMethod: 'token',
      },
      customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.desk'] }],
      activeTabId: 'home',
      ...(tokenResetReason ? { tokenResetReason } : {}),
    });
    const panel = () => document.getElementById('widget-state-panel');
    const wizardShown = () =>
      !!document.querySelector('#first-run-onboarding:not(.hidden)') ||
      document.body.classList.contains('first-run-active');
    const everythingSaid = () => [
      ...mockUiUtils.showToast.mock.calls.map(([message]) => message),
      ...mockUiUtils.setStatus.mock.calls.map(([, detail]) => detail),
      panel()?.textContent || '',
    ];

    it('says why and offers to enter it again, instead of the Welcome wizard', async () => {
      await loadRenderer({ config: recoveryConfig('decryption_failed') });

      expect(wizardShown()).toBe(false);
      expect(panel().querySelector('.widget-state-title').textContent).toBe(
        'Saved token cannot be read'
      );
      expect(panel().querySelector('.widget-state-copy').textContent).toContain(
        'This computer cannot decrypt the saved Home Assistant token.'
      );
      expect(findButtonByText('Enter token')).toBeTruthy();
      // The header says the same, and main is told the notice was seen.
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
        false,
        expect.stringContaining('cannot decrypt the saved Home Assistant token')
      );
      expect(mockElectronAPI.clearTokenResetReason).toHaveBeenCalledTimes(1);
      // The panel says it; a toast over it would say it twice.
      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
    });

    it('never points at a gear icon, which the wizard hides and desktop pins do not have', async () => {
      for (const reason of ['decryption_failed', 'encryption_unavailable', 'not_persisted']) {
        await loadRenderer({ config: recoveryConfig(reason) });
        expect(everythingSaid().join(' ')).not.toMatch(/gear/i);
      }
      await loadRenderer();
      expect(everythingSaid().join(' ')).not.toMatch(/gear/i);
    });

    it('names a locked keyring on Linux, where unlocking it and restarting brings the token back', async () => {
      await loadRenderer({
        config: recoveryConfig('encryption_unavailable'),
        configureApi(api) {
          api.platform = 'linux';
        },
      });

      expect(panel().querySelector('.widget-state-title').textContent).toBe(
        'System keyring is locked'
      );
      // The body goes on from the title instead of saying it again.
      const copy = panel().querySelector('.widget-state-copy').textContent;
      expect(copy).toContain('token cannot be read until the system keyring is unlocked');
      expect(copy).not.toMatch(/keyring is locked/i);
      expect(findButtonByText('Restart Widget')).toBeTruthy();
      expect(findButtonByText('Enter token')).toBeTruthy();
    });

    it('says a token that was never saved was not saved, without promising a restart brings it back', async () => {
      await loadRenderer({
        config: recoveryConfig('not_persisted'),
        configureApi(api) {
          api.platform = 'linux';
        },
      });

      const copy = panel().textContent;
      expect(copy).toContain('Access token was not saved');
      expect(copy).toContain('start gnome-keyring or KWallet so it is remembered');
      expect(copy).not.toMatch(/restart the widget|has been kept/i);
      expect(findButtonByText('Restart Widget')).toBeUndefined();
    });

    it('notes a token that was not saved once, though main repeats it with every config', async () => {
      await loadRenderer({ config: recoveryConfig('not_persisted') });

      // Main keeps 'not_persisted' until a token is saved, so every broadcast carries it again.
      triggerMockEvent('configUpdated', recoveryConfig('not_persisted'));
      await flushAsync();

      expect(mockElectronAPI.clearTokenResetReason).toHaveBeenCalledTimes(1);
      expect(panel().textContent).toContain('Access token was not saved');
      expect(wizardShown()).toBe(false);
    });

    it('keeps the panel when main echoes the config back without the reason', async () => {
      await loadRenderer({ config: recoveryConfig('decryption_failed') });

      // Acknowledging the notice clears main's copy, and main broadcasts the config again.
      triggerMockEvent('configUpdated', recoveryConfig());
      await flushAsync();

      expect(wizardShown()).toBe(false);
      expect(panel().textContent).toContain('Saved token cannot be read');
    });

    it('explains a reason that arrives once the deferred keyring check has run', async () => {
      await loadRenderer({
        config: { ...recoveryConfig(), secureStoragePending: true },
        configureApi(api) {
          api.platform = 'linux';
          api.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
        },
      });
      expect(wizardShown()).toBe(false);

      triggerMockEvent('configUpdated', recoveryConfig('encryption_unavailable'));
      await flushAsync();

      expect(wizardShown()).toBe(false);
      expect(panel().textContent).toContain('System keyring is locked');
      expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('disconnected');
    });

    it('opens Settings on the token field', async () => {
      await loadRenderer({ config: recoveryConfig('decryption_failed') });

      findButtonByText('Enter token').click();
      await flushAsync();

      expect(mockSettings.openSettings).toHaveBeenCalledTimes(1);
      expect(mockSettings.revealHomeAssistantToken).toHaveBeenCalledTimes(1);
      // Settings is told why, so it can say so beside the field.
      const hooks = mockSettings.openSettings.mock.calls[0][0];
      expect(hooks.getConnectionState()).toEqual(
        expect.objectContaining({
          needsToken: true,
          tokenReason: 'decryption_failed',
          status: 'disconnected',
        })
      );
    });

    it('goes away and connects once a token is entered', async () => {
      await loadRenderer({ config: recoveryConfig('decryption_failed') });

      triggerMockEvent('configUpdated', {
        ...recoveryConfig(),
        homeAssistant: { url: 'http://ha.local:8123', token: 'new-token', authMethod: 'token' },
      });
      await flushAsync();

      expect(panel()?.textContent || '').not.toContain('Saved token cannot be read');
      expect(mockWebsocket.connect).toHaveBeenCalled();
      expect(wizardShown()).toBe(false);
    });

    it('starts over at Welcome once the server is cleared too', async () => {
      // Main keeps 'not_persisted' until a token is saved, so it outlives a cleared setup.
      await loadRenderer({
        config: {
          ...recoveryConfig('not_persisted'),
          homeAssistant: { url: '', token: '', authMethod: 'token' },
        },
      });

      expect(wizardShown()).toBe(true);
      expect(panel()?.textContent || '').not.toContain('Access token was not saved');
    });

    it('says a missing keyring once when the config also carries the persistence warning', async () => {
      await loadRenderer({
        config: {
          ...recoveryConfig('encryption_unavailable'),
          persistenceWarnings: [{ code: 'home_assistant_token_not_persisted' }],
        },
        configureApi(api) {
          api.platform = 'linux';
        },
      });
      triggerMockEvent('configPersistenceWarning', [
        { code: 'home_assistant_token_not_persisted' },
      ]);
      await flushAsync();

      // The panel names the keyring; a toast with another remedy beside it would say it twice.
      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
      expect(panel().textContent).toContain('System keyring is locked');
    });

    it('continues startup but reports when the acknowledgement is not saved', async () => {
      await loadRenderer({
        config: recoveryConfig('decryption_failed'),
        configureApi(api) {
          api.clearTokenResetReason.mockRejectedValueOnce(new Error('config is read-only'));
        },
      });

      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('config is read-only'),
        'error',
        10000
      );
      expect(panel().textContent).toContain('Saved token cannot be read');
      expect(mockElectronAPI.signalRendererReady).toHaveBeenCalledTimes(1);
    });
  });

  it('tells the header, tray and bar the connection is gone when the setup is cleared', async () => {
    await loadRenderer({
      config: {
        ...unconfiguredConfig(),
        homeAssistant: { url: 'http://ha.local:8123', token: 'legacy-token', authMethod: 'token' },
      },
      configureApi(api) {
        api.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
      },
    });
    let requestId = 10;
    mockWebsocket.request.mockImplementation(() => {
      const request = new Promise(() => {});
      request.id = requestId++;
      return request;
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    mockWebsocket.emit('message', { type: 'result', id: 10, success: true, result: [] });
    expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(true, expect.any(String));

    // Settings saved with the address and token emptied.
    triggerMockEvent('configUpdated', unconfiguredConfig());
    await flushAsync();

    expect(mockWebsocket.close).toHaveBeenCalled();
    expect(document.body.classList.contains('first-run-active')).toBe(true);
    expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
      false,
      'Not set up yet. Finish setup to connect to Home Assistant.'
    );
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('disconnected');
  });

  it('names the first page only after the interface language has loaded', async () => {
    await loadRenderer();
    const i18n = require('../../src/i18n.js');
    const saveIndex = mockElectronAPI.updateConfig.mock.calls.findIndex(([patch]) =>
      Array.isArray(patch?.customTabs)
    );
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(mockElectronAPI.updateConfig.mock.calls[saveIndex][0].customTabs[0].name).toBe('All');
    // The fresh profile's default page gets its name from t('All'), so the catalog must be in
    // place first or a German profile would be saved with an English "All".
    expect(i18n.setLocaleBootstrap.mock.invocationCallOrder[0]).toBeLessThan(
      mockElectronAPI.updateConfig.mock.invocationCallOrder[saveIndex]
    );
  });

  it('reverts hotkey and alert controls when their main-process mutations fail', async () => {
    await loadRenderer({
      bodyHtml: `
        <main class="widget-content"></main>
        <input id="global-hotkeys-enabled" type="checkbox">
        <section id="hotkeys-section" style="display: none"></section>
        <input id="entity-alerts-enabled" type="checkbox">
        <section id="alerts-section" style="display: none"></section>
      `,
    });
    mockHotkeys.toggleHotkeys.mockResolvedValue(false);
    mockAlerts.toggleAlerts.mockResolvedValue(false);

    const hotkeyToggle = document.getElementById('global-hotkeys-enabled');
    hotkeyToggle.checked = true;
    hotkeyToggle.dispatchEvent(new Event('change'));
    const alertToggle = document.getElementById('entity-alerts-enabled');
    alertToggle.checked = true;
    alertToggle.dispatchEvent(new Event('change'));
    await flushAsync();

    expect(hotkeyToggle.checked).toBe(false);
    expect(hotkeyToggle.disabled).toBe(false);
    expect(document.getElementById('hotkeys-section').style.display).toBe('none');
    expect(alertToggle.checked).toBe(false);
    expect(alertToggle.disabled).toBe(false);
    expect(document.getElementById('alerts-section').style.display).toBe('none');
  });

  it('keeps keyboard focus on the hotkey and alert toggles while main applies them', async () => {
    await loadRenderer({
      bodyHtml: `
        <main class="widget-content"></main>
        <input id="global-hotkeys-enabled" type="checkbox">
        <input id="entity-alerts-enabled" type="checkbox">
      `,
    });
    // Chromium moves focus off a control when it is disabled; jsdom does not (and ignores blur()
    // on a disabled control), so the mocks drop it while main is applying the change.
    const dropFocus = async () => {
      const toggle = document.activeElement;
      toggle.disabled = false;
      toggle.blur();
      toggle.disabled = true;
      return true;
    };
    mockHotkeys.toggleHotkeys.mockImplementation(dropFocus);
    mockAlerts.toggleAlerts.mockImplementation(dropFocus);

    for (const id of ['global-hotkeys-enabled', 'entity-alerts-enabled']) {
      const toggle = document.getElementById(id);
      toggle.focus();
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      await flushAsync();

      expect(toggle.checked).toBe(true);
      expect(document.activeElement).toBe(toggle);
    }
  });

  // Clearing itself (the IPC, the state, the failure toast) is the shared helper's, tested in
  // hotkeys.test.js; the list only has to hand it the row's entity and place the keyboard after.
  const clearableRow = `
    <main class="widget-content"></main>
    <div id="hotkeys-list">
      <div class="hotkey-item">
        <div class="hotkey-input-container">
          <input class="hotkey-input" data-entity-id="light.office" data-focus-key="hotkey-input:light.office" value="Ctrl+Shift+L">
          <button class="btn-clear-hotkey"><svg class="entity-line-icon"><path d="M18 6 6 18"></path></svg></button>
        </div>
      </div>
    </div>
  `;

  it('leaves the keyboard where it was when clearing a hotkey fails', async () => {
    await loadRenderer({ config: unconfiguredConfig(), bodyHtml: clearableRow });
    mockHotkeys.clearEntityHotkey.mockResolvedValueOnce(false);
    const clear = document.querySelector('.btn-clear-hotkey');
    clear.focus();

    clear.click();
    await flushAsync();

    expect(mockHotkeys.clearEntityHotkey).toHaveBeenCalledWith('light.office');
    expect(document.activeElement).toBe(clear);
  });

  it('moves focus to the cleared row field, since the list is rebuilt and the Clear button is gone', async () => {
    await loadRenderer({ config: unconfiguredConfig(), bodyHtml: clearableRow });
    // What clearEntityHotkey does through renderHotkeysTab: rebuild the rows, which destroys the
    // Clear button that had focus.
    mockHotkeys.clearEntityHotkey.mockImplementationOnce(async () => {
      document.getElementById('hotkeys-list').innerHTML =
        '<div><input class="hotkey-input" data-entity-id="light.office" data-focus-key="hotkey-input:light.office" value=""></div>';
      return true;
    });
    const clear = document.querySelector('.btn-clear-hotkey');
    clear.focus();

    clear.click();
    await flushAsync();

    expect(mockHotkeys.clearEntityHotkey).toHaveBeenCalledWith('light.office');
    expect(document.activeElement).toBe(document.querySelector('.hotkey-input'));
  });

  it('clears the row when the click lands on the icon inside the Clear button', async () => {
    await loadRenderer({ config: unconfiguredConfig(), bodyHtml: clearableRow });

    document
      .querySelector('.btn-clear-hotkey path')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(mockHotkeys.clearEntityHotkey).toHaveBeenCalledWith('light.office');
  });

  it("sends the tile menu's Remove Hotkey to the shared clear, and Add or Edit to the recorder", async () => {
    await loadRenderer({ config: unconfiguredConfig() });

    triggerMockEvent('entityTileHotkeyRequested', { entityId: 'sensor.office_temp', remove: true });
    triggerMockEvent('entityTileHotkeyRequested', { entityId: 'light.office', remove: false });
    await flushAsync();

    expect(mockHotkeys.removeEntityHotkey).toHaveBeenCalledWith('sensor.office_temp');
    expect(mockHotkeys.removeEntityHotkey).toHaveBeenCalledTimes(1);
    expect(mockHotkeys.assignHotkeyToEntity).toHaveBeenCalledWith('light.office');
    expect(mockHotkeys.assignHotkeyToEntity).toHaveBeenCalledTimes(1);
  });

  // Recording itself (the dialog, the clash message, focus afterwards, the saved-while-off warning)
  // is the shared recorder's, tested in hotkeys.test.js; the list only has to start it for its row.
  it.each(['Enter', ' '])('starts the shared recorder for a row with %s', async (key) => {
    await loadRenderer({
      config: unconfiguredConfig(),
      bodyHtml:
        '<main class="widget-content"></main><div id="hotkeys-list"><div><input readonly class="hotkey-input" data-entity-id="light.office" value="Ctrl+L"></div></div>',
    });
    const input = document.querySelector('.hotkey-input');
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await flushAsync();
    expect(mockHotkeys.assignHotkeyToEntity).toHaveBeenCalledTimes(1);
    expect(mockHotkeys.assignHotkeyToEntity).toHaveBeenCalledWith('light.office', {
      action: undefined,
    });
  });

  it('records a row with the action picked in the same row', async () => {
    await loadRenderer({
      config: unconfiguredConfig(),
      bodyHtml: `<main class="widget-content"></main><div id="hotkeys-list"><div>
        <input readonly class="hotkey-input" data-entity-id="light.office">
        <select class="hotkey-action-select" data-entity-id="light.office">
          <option value="toggle">Toggle</option><option value="turn_on" selected>Turn On</option>
        </select></div></div>`,
    });

    document.querySelector('.hotkey-input').click();
    await flushAsync();

    expect(mockHotkeys.assignHotkeyToEntity).toHaveBeenCalledWith('light.office', {
      action: 'turn_on',
    });
  });

  it('publishes stale status until a fresh snapshot arrives, and preserves actionable auth failure', async () => {
    await loadRenderer({
      config: {
        ...oauthConfig(),
        homeAssistant: { url: 'http://ha.local:8123', token: 'legacy-token' },
        desktopPins: { 'light.office': {} },
      },
      configureApi(api) {
        api.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
      },
    });
    let requestId = 10;
    mockWebsocket.request.mockImplementation(() => {
      const request = new Promise(() => {});
      request.id = requestId++;
      return request;
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('connecting');
    expect(document.getElementById('widget-state-panel').textContent).toContain('Waiting for live');
    mockWebsocket.emit('message', { type: 'result', id: 10, success: true, result: [] });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('connected');
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalled();
    expect(mockElectronAPI.publishHaSnapshot.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockElectronAPI.publishHaConnectionState.mock.invocationCallOrder.at(-1)
    );
    mockWebsocket.emit('message', { type: 'auth_invalid' });
    expect(mockWebsocket.close).toHaveBeenCalled();
    mockWebsocket.emit('close', { intentional: false });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('auth-failed');
    expect(document.getElementById('widget-state-panel').textContent).toContain(
      'Authentication failed'
    );
    expect(document.getElementById('widget-state-panel').textContent).toContain('Open Settings');
  });

  it.each([
    ['rejected', ''],
    ['invalid', ''],
    ['timed out', 'snapshot-timeout'],
  ])('recovers when the initial snapshot is %s', async (failure, reason) => {
    await loadRenderer({ config: oauthConfig() });
    const socket = {};
    mockWebsocket.ws = socket;
    mockWebsocket.failConnection = jest.fn();
    let failSnapshot;
    const snapshot = new Promise((resolve, reject) => {
      failSnapshot = () => {
        if (failure === 'invalid') resolve({ success: false });
        else if (failure === 'rejected') reject(new Error('Home Assistant connection lost'));
        else reject(Object.assign(new Error('WebSocket request timeout'), { code: 'timeout' }));
      };
    });
    snapshot.id = 10;
    mockWebsocket.request.mockReturnValueOnce(snapshot);
    mockWebsocket.emit('message', { type: 'auth_ok' });
    failSnapshot();
    await flushAsync();
    expect(mockWebsocket.failConnection).toHaveBeenCalledTimes(1);
    const [failedSocket, failedReason = ''] = mockWebsocket.failConnection.mock.calls[0];
    expect(failedSocket).toBe(socket);
    // A snapshot that timed out has its own reason: the server answered the login, so it is not
    // "did not answer". Diagnostics still record it as a timeout, not a closed socket.
    expect(failedReason).toBe(reason);
  });

  it('closes the WebSocket through its lifecycle manager when the browser goes offline', async () => {
    await loadRenderer();
    const rawSocketClose = jest.fn();
    mockWebsocket.ws = {
      readyState: WebSocket.OPEN,
      close: rawSocketClose,
    };
    mockWebsocket.close.mockClear();

    window.dispatchEvent(new Event('offline'));

    expect(mockWebsocket.close).toHaveBeenCalledTimes(1);
    expect(rawSocketClose).not.toHaveBeenCalled();
  });
  it('explains the desktop layer and verifies a new popup activation during setup', async () => {
    const info = { hyprland: true, layerMode: true, lastActivation: null };
    await loadRenderer({
      configureApi(api) {
        api.getDesktopIntegration = jest.fn(async () => info);
      },
    });
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'underneath normal windows'
    );
    await clickButton('Check popup shortcut');
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'No popup shortcut received yet'
    );
    info.lastActivation = { id: 'popup-toggle', at: '2026-09-16T12:00:00Z' };
    await clickButton('Check popup shortcut');
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'Popup shortcut received.'
    );
    await clickButton('Next');
    expect(document.getElementById('first-run-desktop-help')).toBeNull();
  });

  // Every test boots its own renderer into the same window. This file's own loader used to leave
  // the earlier ones running, so their timers and window listeners answered with their own
  // websocket and config.
  it('stops the renderer of an earlier test, which no longer answers the network coming back', async () => {
    await loadRenderer({ config: oauthConfig() });
    const earlierWebsocket = mockWebsocket;
    const earlierConnects = earlierWebsocket.connect.mock.calls.length;
    harness.cleanup();

    await loadRenderer({ config: oauthConfig() });
    const connects = mockWebsocket.connect.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await flushAsync();

    expect(earlierWebsocket.connect).toHaveBeenCalledTimes(earlierConnects);
    expect(mockWebsocket.connect.mock.calls.length).toBeGreaterThan(connects);
  });
});
