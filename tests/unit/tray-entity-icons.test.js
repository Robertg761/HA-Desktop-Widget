/**
 * @jest-environment jsdom
 */
const state = require('../../src/state.js').default;
const {
  buildTrayEntityIconPayload,
  disposeTrayEntityIcons,
  handleTrayEntityStateChange,
  hasPendingTrayEntityIconUpdates,
  initTrayEntityIcons,
  setTrayEntityConnectionState,
  tickTrayEntityIcon,
  refreshTrayEntityIcons,
  syncTrayEntityIconsWithConfig,
} = require('../../src/tray-entity-icons.js');

function createFakeCanvas(width, height) {
  const ctx = {
    font: '',
    measureText: jest.fn((text) => {
      const px = Number.parseFloat(/([\d.]+)px/.exec(ctx.font)?.[1] || '12');
      return { width: text.length * px * 0.6 };
    }),
    clearRect: jest.fn(),
    strokeText: jest.fn(),
    fillText: jest.fn(),
  };
  return {
    width,
    height,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,AAAA',
  };
}

const { createTrayEntityTicker } = require('../../src/tray-entity-ticker.cjs');
const testTickers = [];
function createApi(platform = 'linux') {
  const ticker = createTrayEntityTicker((entityId) => void tickTrayEntityIcon(entityId));
  testTickers.push(ticker);
  return {
    platform,
    ticker,
    updateTrayEntityIcon: jest.fn((payload) => {
      ticker.setActive(payload.entityId, payload.activeTimer);
      return Promise.resolve({ success: true });
    }),
  };
}

function setup({ platform = 'linux', trayEntities = { 'sensor.battery': {} }, states } = {}) {
  state.setConfig({ ...state.CONFIG, trayEntities, customEntityNames: {} });
  state.setStates(
    states || {
      'sensor.battery': {
        entity_id: 'sensor.battery',
        state: '43',
        attributes: { friendly_name: 'Battery', unit_of_measurement: '%' },
      },
    }
  );
  const api = createApi(platform);
  const initialized = initTrayEntityIcons({
    electronAPI: api,
    platform,
    createCanvas: createFakeCanvas,
    connected: true,
  });
  return { api, initialized };
}

async function flush(ms = 250) {
  jest.advanceTimersByTime(ms);
  await Promise.resolve();
  await Promise.resolve();
}

describe('tray-entity-icons', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    disposeTrayEntityIcons();
    testTickers.splice(0).forEach((ticker) => ticker.clear());
    require('../../src/i18n.js').setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    jest.useRealTimers();
  });

  it('only initializes when the host exposes the tray IPC', () => {
    expect(initTrayEntityIcons({ electronAPI: { platform: 'linux' } })).toBe(false);
    expect(initTrayEntityIcons({ electronAPI: createApi() })).toBe(true);
  });

  it('builds a payload with a fitting label, a tooltip, and PNG representations', () => {
    setup();
    const payload = buildTrayEntityIconPayload('sensor.battery', { scheme: 'dark' });
    expect(payload.entityId).toBe('sensor.battery');
    expect(payload.label).toBe('43');
    expect(payload.tooltip).toContain('Battery');
    expect(payload.tooltip).toContain('43');
    expect(payload.representations.map((rep) => rep.scaleFactor)).toEqual([1, 1.5, 2, 3]);
    payload.representations.forEach((rep) => {
      expect(rep.dataURL.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  it('sends no bitmaps on macOS where the label is drawn as a tray title', () => {
    setup({ platform: 'darwin' });
    const payload = buildTrayEntityIconPayload('sensor.battery', { scheme: 'dark' });
    expect(payload.label).toBe('43 %');
    expect(payload.representations).toEqual([]);
  });

  it('debounces bursts of state changes into a single update and skips unchanged icons', async () => {
    const { api } = setup();

    handleTrayEntityStateChange('sensor.battery');
    handleTrayEntityStateChange('sensor.battery');
    handleTrayEntityStateChange('sensor.battery');
    expect(hasPendingTrayEntityIconUpdates()).toBe(true);
    expect(api.updateTrayEntityIcon).not.toHaveBeenCalled();

    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(1);
    expect(api.updateTrayEntityIcon.mock.calls[0][0]).toMatchObject({
      entityId: 'sensor.battery',
      label: '43',
    });

    // Same state again: nothing visible changed, so nothing is sent.
    handleTrayEntityStateChange('sensor.battery');
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(1);

    state.setStates({
      'sensor.battery': {
        entity_id: 'sensor.battery',
        state: '44',
        attributes: { friendly_name: 'Battery', unit_of_measurement: '%' },
      },
    });
    handleTrayEntityStateChange('sensor.battery');
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
    expect(api.updateTrayEntityIcon.mock.calls[1][0].label).toBe('44');
  });

  it('ignores entities that are not configured for the tray', async () => {
    const { api } = setup();
    handleTrayEntityStateChange('sensor.other');
    expect(hasPendingTrayEntityIconUpdates()).toBe(false);
    await flush();
    expect(api.updateTrayEntityIcon).not.toHaveBeenCalled();
  });

  it.each(['idle', 'paused', 'unavailable'])(
    'updates a timer promptly when it becomes %s',
    async (nextState) => {
      const timer = {
        entity_id: 'timer.test',
        state: 'active',
        attributes: {
          friendly_name: 'Timer',
          finishes_at: new Date(Date.now() + 120000).toISOString(),
        },
      };
      const { api } = setup({
        trayEntities: { 'timer.test': {} },
        states: { 'timer.test': timer },
      });
      handleTrayEntityStateChange('timer.test');
      await flush();
      expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(1);
      expect(api.ticker.hasActive('timer.test')).toBe(true);

      state.setStates({ 'timer.test': { ...timer, state: nextState } });
      handleTrayEntityStateChange('timer.test');
      await flush();
      expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
      expect(api.updateTrayEntityIcon.mock.calls[1][0].tooltip).toContain('Timer');
      expect(hasPendingTrayEntityIconUpdates()).toBe(false);
      await flush(30000);
      expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
    }
  );

  it('refreshes an active timer immediately when forced and keeps countdown updates running', async () => {
    const { api } = setup({
      trayEntities: { 'timer.test': {} },
      states: {
        'timer.test': {
          entity_id: 'timer.test',
          state: 'active',
          attributes: { finishes_at: new Date(Date.now() + 120000).toISOString() },
        },
      },
    });
    handleTrayEntityStateChange('timer.test');
    await flush();
    refreshTrayEntityIcons({ force: true });
    handleTrayEntityStateChange('timer.test');
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
    await flush(1000);
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(3);
  });

  it('forces a re-render on refresh even when the icon is unchanged', async () => {
    const { api } = setup();
    refreshTrayEntityIcons({ force: true });
    await flush();
    refreshTrayEntityIcons({ force: true });
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
  });

  it('re-publishes after main reports that an update was not applied', async () => {
    const { api } = setup();
    api.updateTrayEntityIcon.mockResolvedValueOnce({ success: false, error: 'not yet' });
    handleTrayEntityStateChange('sensor.battery');
    await flush();
    handleTrayEntityStateChange('sensor.battery');
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
  });

  it('reconciles pending and published icons with the config', async () => {
    const { api } = setup();
    handleTrayEntityStateChange('sensor.battery');

    state.setConfig({ ...state.CONFIG, trayEntities: { 'sensor.other': {} } });
    state.setStates({
      'sensor.battery': state.STATES['sensor.battery'],
      'sensor.other': {
        entity_id: 'sensor.other',
        state: 'on',
        attributes: { friendly_name: 'Other' },
      },
    });
    syncTrayEntityIconsWithConfig();
    await flush();

    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(1);
    expect(api.updateTrayEntityIcon.mock.calls[0][0]).toMatchObject({
      entityId: 'sensor.other',
      label: 'ON',
    });
  });

  it('renders a placeholder for entities that have no state yet', () => {
    setup({ trayEntities: { 'sensor.missing': {} }, states: {} });
    const payload = buildTrayEntityIconPayload('sensor.missing', { scheme: 'light' });
    expect(payload.label).toBe('!');
    expect(payload.tooltip).toContain('sensor.missing');
  });
  it('marks cached values offline until a new snapshot is explicitly accepted', async () => {
    const { api } = setup();
    refreshTrayEntityIcons();
    await flush();
    setTrayEntityConnectionState(false);
    await flush();
    expect(api.updateTrayEntityIcon.mock.lastCall[0]).toMatchObject({
      label: '--',
      tooltip: 'Battery: Offline',
    });
    handleTrayEntityStateChange('sensor.battery');
    await flush();
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('--');
    state.setStates({
      'sensor.battery': { entity_id: 'sensor.battery', state: '52', attributes: {} },
    });
    setTrayEntityConnectionState(true);
    await flush();
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('52');
  });

  it('ticks through the last seconds and stops at zero without an HA state event', async () => {
    const { api } = setup({
      trayEntities: { 'timer.test': {} },
      states: {
        'timer.test': {
          entity_id: 'timer.test',
          state: 'active',
          attributes: { finishes_at: new Date(Date.now() + 3000).toISOString() },
        },
      },
    });
    refreshTrayEntityIcons();
    await flush();
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('3s');
    await flush(1000);
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('2s');
    await flush(1000);
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('1s');
    await flush(1000);
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('0s');
    expect(hasPendingTrayEntityIconUpdates()).toBe(false);
  });

  it('cancels a timer tick when the connection is lost', async () => {
    const { api } = setup({
      trayEntities: { 'timer.test': {} },
      states: {
        'timer.test': {
          entity_id: 'timer.test',
          state: 'active',
          attributes: { finishes_at: new Date(Date.now() + 9000).toISOString() },
        },
      },
    });
    refreshTrayEntityIcons();
    await flush();
    setTrayEntityConnectionState(false);
    await flush();
    expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('--');
    expect(hasPendingTrayEntityIconUpdates()).toBe(false);
  });

  it('retains localized precision, units and a short name in the macOS title', () => {
    setup({
      platform: 'darwin',
      trayEntities: { 'sensor.room': { label: 'Büro' } },
      states: {
        'sensor.room': {
          entity_id: 'sensor.room',
          state: '21.4',
          attributes: { friendly_name: 'Office', unit_of_measurement: '°C' },
        },
      },
    });
    require('../../src/i18n.js').setLocaleBootstrap({
      activeLocale: 'de',
      messages: require('../../locales/de.json'),
    });
    const payload = buildTrayEntityIconPayload('sensor.room');
    expect(payload.label).toBe('Büro: 21,4 °C');
    expect(payload.tooltip).toContain('Büro · Office');
    expect(payload.representations).toEqual([]);
  });

  it('localizes binary sensor meaning instead of showing English abbreviations', () => {
    setup({
      platform: 'darwin',
      trayEntities: { 'binary_sensor.door': {} },
      states: {
        'binary_sensor.door': {
          entity_id: 'binary_sensor.door',
          state: 'off',
          attributes: { device_class: 'door', friendly_name: 'Tür' },
        },
      },
    });
    require('../../src/i18n.js').setLocaleBootstrap({
      activeLocale: 'de',
      messages: require('../../locales/de.json'),
    });
    expect(buildTrayEntityIconPayload('binary_sensor.door')).toMatchObject({
      label: 'Geschlossen',
      tooltip: 'Tür: Geschlossen',
    });
  });

  it('republishes a color-only settings change without an entity event', async () => {
    const { api } = setup();
    refreshTrayEntityIcons();
    await flush();
    state.setConfig({ ...state.CONFIG, trayEntities: { 'sensor.battery': { color: 'blue' } } });
    syncTrayEntityIconsWithConfig();
    await flush();
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
  });

  it('retries a failed static sensor update without waiting for a state change', async () => {
    const { api } = setup();
    api.updateTrayEntityIcon.mockResolvedValueOnce({ success: false });
    refreshTrayEntityIcons();
    await flush();
    await flush(2000);
    expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(2);
    expect(hasPendingTrayEntityIconUpdates()).toBe(false);
  });

  it('does not revive a disposed timer when an outstanding IPC call completes', async () => {
    const { api } = setup({
      trayEntities: { 'timer.test': {} },
      states: {
        'timer.test': {
          entity_id: 'timer.test',
          state: 'active',
          attributes: { finishes_at: new Date(Date.now() + 9000).toISOString() },
        },
      },
    });
    let resolve;
    api.updateTrayEntityIcon.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    refreshTrayEntityIcons();
    await flush();
    disposeTrayEntityIcons();
    resolve({ success: true });
    await flush();
    expect(hasPendingTrayEntityIconUpdates()).toBe(false);
  });
  it('does not revive favorites preserved by the dashboard but absent from the fresh snapshot', () => {
    setup();
    setTrayEntityConnectionState(true, []);
    expect(buildTrayEntityIconPayload('sensor.battery').label).toBe('!');
    handleTrayEntityStateChange('sensor.battery');
    expect(buildTrayEntityIconPayload('sensor.battery').label).toBe('43');
  });

  it('starts offline even when old entity states are already cached', () => {
    setup();
    initTrayEntityIcons({ electronAPI: createApi(), platform: 'darwin' });
    expect(buildTrayEntityIconPayload('sensor.battery').label).toBe('Offline');
  });
  it('publishes hidden-window changes without relying on throttled renderer timers', () => {
    const previous = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    try {
      const { api } = setup();
      handleTrayEntityStateChange('sensor.battery');
      expect(api.updateTrayEntityIcon).toHaveBeenCalledTimes(1);
      expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('43');
      expect(hasPendingTrayEntityIconUpdates()).toBe(false);
      setTrayEntityConnectionState(false);
      expect(api.updateTrayEntityIcon.mock.lastCall[0].label).toBe('--');
    } finally {
      if (previous) Object.defineProperty(document, 'hidden', previous);
      else delete document.hidden;
    }
  });
});
