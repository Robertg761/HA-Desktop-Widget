/** @jest-environment node */
const display = require('../../src/window-display.cjs');

const primary = { id: 1, label: 'Laptop', workArea: { x: 0, y: 24, width: 1920, height: 1056 } };
const secondary = {
  id: 2,
  label: 'Desk',
  scaleFactor: 2,
  workArea: { x: -1280, y: -200, width: 1280, height: 900 },
};
function makeScreen(displays = [primary, secondary]) {
  return {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    getDisplayMatching: (bounds) => (bounds.x < 0 ? secondary : primary),
  };
}
const config = { windowPosition: { x: 100, y: 124 }, windowSize: { width: 500, height: 600 } };

test('moves to a selected display using logical coordinates and an offset from its work area', () => {
  const patch = display.prepareWindowDisplayChoice('2', config, makeScreen());
  expect(patch).toEqual({
    windowDisplay: { id: '2', label: 'Desk', offset: { x: 100, y: 100 } },
    windowPosition: { x: -1180, y: -100 },
  });
});

test('falls back without losing the preferred display or its position, including after restart', () => {
  const saved = { ...config, ...display.prepareWindowDisplayChoice('2', config, makeScreen()) };
  const original = JSON.stringify(saved);
  expect(display.resolveWindowDisplayPosition(saved, makeScreen([primary]))).toEqual({
    x: 100,
    y: 124,
  });
  expect(JSON.stringify(saved)).toBe(original);
  const restarted = JSON.parse(original);
  expect(display.resolveWindowDisplayPosition(restarted, makeScreen())).toEqual({
    x: -1180,
    y: -100,
  });
  const moved = { ...secondary, workArea: { ...secondary.workArea, x: 1920, y: 0 } };
  expect(display.resolveWindowDisplayPosition(restarted, makeScreen([primary, moved]))).toEqual({
    x: 2020,
    y: 100,
  });
});

test('clamps to a smaller work area without destroying the saved offset', () => {
  const saved = {
    ...config,
    windowDisplay: { id: '2', label: 'Desk', offset: { x: 1100, y: 800 } },
  };
  expect(display.resolveWindowDisplayPosition(saved, makeScreen())).toEqual({ x: -500, y: 100 });
  expect(saved.windowDisplay.offset).toEqual({ x: 1100, y: 800 });
});

test('Automatic leaves the current position alone and invalid choices are rejected', () => {
  expect(display.prepareWindowDisplayChoice('', config, makeScreen())).toEqual({
    windowDisplay: null,
  });
  expect(display.resolveWindowDisplayPosition(config, makeScreen())).toBeNull();
  for (const id of ['missing', {}, null, 2]) {
    expect(() => display.prepareWindowDisplayChoice(id, config, makeScreen())).toThrow();
  }
});

test('a drag saves its display and offset, but a move while unplugged preserves the preference', () => {
  const saved = { ...config, ...display.prepareWindowDisplayChoice('2', config, makeScreen()) };
  expect(
    display.rememberWindowDisplayPosition(saved, makeScreen(), {
      x: -1000,
      y: 0,
      ...config.windowSize,
    })
  ).toEqual({ id: '2', label: 'Desk', offset: { x: 280, y: 200 } });
  expect(
    display.rememberWindowDisplayPosition(saved, makeScreen(), {
      x: 200,
      y: 224,
      ...config.windowSize,
    })
  ).toEqual({ id: '1', label: 'Laptop', offset: { x: 200, y: 200 } });
  expect(
    display.rememberWindowDisplayPosition(saved, makeScreen([primary]), {
      x: 200,
      y: 224,
      ...config.windowSize,
    })
  ).toEqual(saved.windowDisplay);
});

test('lists a disconnected preference and ignores displays with an unknown identity', () => {
  const saved = {
    ...config,
    windowDisplay: { id: '2', label: 'Desk', offset: { x: 100, y: 100 } },
  };
  const state = display.getWindowDisplayState(
    saved,
    makeScreen([primary, { ...secondary, id: -1 }]),
    true
  );
  expect(state).toMatchObject({
    supported: true,
    selectedId: '2',
    displays: [
      { id: '1', label: 'Laptop', primary: true, available: true },
      { id: '2', label: 'Desk', available: false },
    ],
  });
  expect(display.getWindowDisplayState(saved, makeScreen(), false)).toEqual({
    supported: false,
    selectedId: '',
    displays: [],
  });
});

test('restores a Windows monitor by persistent identity after runtime IDs change', () => {
  const original = { ...secondary, persistentId: 'windows-monitor-a' };
  const saved = {
    ...config,
    ...display.prepareWindowDisplayChoice('2', config, makeScreen([primary, original])),
  };
  expect(saved.windowDisplay.persistentId).toBe('windows-monitor-a');
  const returned = { ...original, id: 99, workArea: { ...original.workArea, x: 1920, y: 0 } };
  const other = { ...secondary, id: 2, persistentId: 'windows-monitor-b' };
  const screen = makeScreen([primary, other, returned]);
  expect(display.resolveWindowDisplayPosition(JSON.parse(JSON.stringify(saved)), screen)).toEqual({
    x: 2020,
    y: 100,
  });
  expect(display.getWindowDisplayState(saved, screen, true).selectedId).toBe('99');
});

test('never mistakes a reused runtime ID or identical label for a missing Windows monitor', () => {
  const saved = {
    ...config,
    windowDisplay: {
      id: '2',
      persistentId: 'windows-monitor-a',
      label: 'Desk',
      offset: { x: 100, y: 100 },
    },
  };
  for (const replacement of [{ ...secondary, persistentId: 'windows-monitor-b' }, secondary]) {
    const screen = makeScreen([primary, replacement]);
    expect(display.resolveWindowDisplayPosition(saved, screen)).toEqual({ x: 100, y: 124 });
    const state = display.getWindowDisplayState(saved, screen, true);
    expect(state.displays.find((item) => item.id === state.selectedId).available).toBe(false);
    expect(
      display.rememberWindowDisplayPosition(saved, screen, { x: 200, y: 224, ...config.windowSize })
    ).toEqual(saved.windowDisplay);
  }
});

test('screen identity decoration keeps native methods bound and reads the latest inventory', () => {
  let identities = { 2: 'windows-monitor-a' };
  const native = makeScreen();
  native.on = function () {
    return this;
  };
  const screen = display.createDisplayIdentityScreen(native, () => identities);
  expect(screen.on('display-added')).toBe(native);
  expect(screen.getAllDisplays()[1].persistentId).toBe('windows-monitor-a');
  expect(screen.getDisplayMatching({ x: -1000 }).persistentId).toBe('windows-monitor-a');
  identities = {};
  expect(screen.getAllDisplays()[1].persistentId).toBeUndefined();
});
