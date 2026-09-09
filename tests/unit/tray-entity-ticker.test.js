const { createTrayEntityTicker } = require('../../src/tray-entity-ticker.cjs');

describe('main-process tray clocks', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('ticks once per second, does not duplicate clocks, and stops removed or inactive timers', () => {
    const onTick = jest.fn();
    const ticker = createTrayEntityTicker(onTick);
    ticker.setActive('timer.tea', true);
    ticker.setActive('timer.tea', true);
    ticker.setActive('sensor.temperature', true);
    jest.advanceTimersByTime(3000);
    expect(onTick.mock.calls).toEqual([['timer.tea'], ['timer.tea'], ['timer.tea']]);
    ticker.setActive('timer.tea', false);
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);
    ticker.setActive('timer.tea', true);
    ticker.reconcile([]);
    jest.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(3);
    ticker.setActive('timer.tea', true);
    ticker.clear();
    expect(jest.getTimerCount()).toBe(0);
  });
});
