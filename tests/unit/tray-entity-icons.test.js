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

function createApi(platform = 'linux') {
  return {
    platform,
    updateTrayEntityIcon: jest.fn(() => Promise.resolve({ success: true })),
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
    expect(payload.representations.map((rep) => rep.scaleFactor)).toEqual([1, 1.5, 2]);
    payload.representations.forEach((rep) => {
      expect(rep.dataURL.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  it('sends no bitmaps on macOS where the label is drawn as a tray title', () => {
    setup({ platform: 'darwin' });
    const payload = buildTrayEntityIconPayload('sensor.battery', { scheme: 'dark' });
    expect(payload.label).toBe('43');
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
      expect(hasPendingTrayEntityIconUpdates()).toBe(true);

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
    await flush(30000);
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
    expect(payload.label).toBe('N/A');
    expect(payload.tooltip).toContain('sensor.missing');
  });
});
