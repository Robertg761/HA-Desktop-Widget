/**
 * @jest-environment jsdom
 */

const { createRendererHarness } = require('../helpers/renderer-harness');

describe('device dialogs and a language change', () => {
  const harness = createRendererHarness();

  afterEach(() => harness.cleanup());

  const bootstrapOf = (activeLocale) => ({ activeLocale, messages: {} });

  it('closes open device dialogs when the interface language changes', async () => {
    const closeAllEntityDetailDialogs = jest.fn();
    await harness.load({
      config: harness.tokenConfig(),
      ui: { closeAllEntityDetailDialogs },
      configureApi(api) {
        api.getLocaleBootstrap = jest.fn().mockResolvedValue(bootstrapOf('en'));
      },
    });
    // The first locale applied is the starting point, not a change.
    expect(closeAllEntityDetailDialogs).not.toHaveBeenCalled();

    harness.electronAPI.getLocaleBootstrap.mockResolvedValue(bootstrapOf('de'));
    harness.triggerMockEvent('configUpdated', {
      ...harness.tokenConfig(),
      ui: { ...harness.tokenConfig().ui, language: 'de' },
    });
    await harness.flushAsync();

    expect(closeAllEntityDetailDialogs).toHaveBeenCalledTimes(1);
  });

  it('leaves them open when a newer pack of the same language arrives', async () => {
    const closeAllEntityDetailDialogs = jest.fn();
    await harness.load({
      config: harness.tokenConfig(),
      ui: { closeAllEntityDetailDialogs },
      configureApi(api) {
        api.getLocaleBootstrap = jest.fn().mockResolvedValue(bootstrapOf('de'));
      },
    });

    harness.triggerMockEvent('localePacksUpdated');
    await harness.flushAsync();

    expect(harness.electronAPI.getLocaleBootstrap).toHaveBeenCalledTimes(2);
    expect(closeAllEntityDetailDialogs).not.toHaveBeenCalled();
  });
});
