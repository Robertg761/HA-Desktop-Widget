/** @jest-environment node */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const {
  createLayerPointerRelease,
  distanceToRect,
  getHyprlandRequestSocket,
  readHyprlandCursorFromSocket,
} = require('../../src/layer-pointer-release.cjs');

const widget = { x: 1000, y: 400, width: 500, height: 600 };

// Drives the watch one check at a time, with the pointer at each position in turn.
function drive(positions, { keepWatching = () => true, rect = widget } = {}) {
  let clock = 0;
  let pending = null;
  const onRelease = jest.fn();
  const cursor = [...positions];
  const release = createLayerPointerRelease({
    readCursor: () => Promise.resolve(cursor.length > 1 ? cursor.shift() : cursor[0]),
    getRect: () => rect,
    shouldKeepWatching: keepWatching,
    onRelease,
    intervalMs: 250,
    settleMs: 1000,
    now: () => clock,
    schedule: (callback) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  });
  const started = release.start();
  const tick = async (count = 1) => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
      await Promise.resolve();
      if (!pending) return;
      clock += 250;
      const next = pending;
      pending = null;
      next();
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { release, onRelease, started, tick };
}

describe('keeping a raised layer widget up while the pointer heads to it', () => {
  it('measures how far the pointer is from the widget', () => {
    expect(distanceToRect({ x: 1200, y: 500 }, widget)).toBe(0);
    expect(distanceToRect({ x: 990, y: 500 }, widget)).toBe(10);
    expect(distanceToRect({ x: 1503, y: 1004 }, widget)).toBe(5);
  });

  it('stays up while the pointer crosses other windows towards the widget', async () => {
    // From the bar, across a tiled window, onto the widget.
    const path = [
      { x: 200, y: 10 },
      { x: 400, y: 100 },
      { x: 600, y: 200 },
      { x: 800, y: 300 },
      { x: 1100, y: 450 },
      { x: 1200, y: 500 },
    ];
    const { onRelease, started, tick } = drive(path);
    expect(started).toBe(true);
    await tick(20);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('stays up while the pointer rests elsewhere, as after a click in the bar', async () => {
    const { onRelease, tick } = drive([{ x: 200, y: 10 }]);
    await tick(20);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('lowers once the pointer has moved off somewhere else for a moment', async () => {
    const { onRelease, tick } = drive([
      { x: 1200, y: 500 },
      { x: 900, y: 600 },
      { x: 600, y: 700 },
      { x: 300, y: 800 },
    ]);
    await tick(3);
    expect(onRelease).not.toHaveBeenCalled();
    await tick(5);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('stops when the widget is focused again or no longer raised', async () => {
    let watching = true;
    const { onRelease, tick } = drive(
      [
        { x: 1200, y: 500 },
        { x: 300, y: 800 },
        { x: 100, y: 900 },
      ],
      { keepWatching: () => watching }
    );
    await tick(1);
    watching = false;
    await tick(10);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('lowers right away when it cannot tell where things are', async () => {
    expect(drive([{ x: 0, y: 0 }], { rect: null }).started).toBe(false);
    const release = jest.fn();
    const watch = createLayerPointerRelease({
      readCursor: () => Promise.resolve(null),
      getRect: () => widget,
      shouldKeepWatching: () => true,
      onRelease: release,
      schedule: () => 1,
      cancel: () => {},
    });
    watch.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('reading the pointer from Hyprland', () => {
  it('finds the session request socket', () => {
    const env = { HYPRLAND_INSTANCE_SIGNATURE: 'abc', XDG_RUNTIME_DIR: '/run/user/1000' };
    const runtimeSocket = path.join('/run/user/1000', 'hypr', 'abc', '.socket.sock');
    expect(getHyprlandRequestSocket(env, (file) => file === runtimeSocket)).toBe(runtimeSocket);
    const tmpSocket = path.join('/tmp', 'hypr', 'abc', '.socket.sock');
    expect(getHyprlandRequestSocket(env, (file) => file === tmpSocket)).toBe(tmpSocket);
    expect(getHyprlandRequestSocket({}, () => true)).toBe('');
  });

  (process.platform === 'win32' ? it.skip : it)('asks the socket for j/cursorpos', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-hypr-'));
    const socketPath = path.join(dir, '.socket.sock');
    const server = net.createServer((connection) => {
      connection.on('data', (request) => {
        connection.end(
          String(request) === 'j/cursorpos' ? '{"x": 2410, "y": 1093}' : 'unknown request'
        );
      });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    try {
      await expect(readHyprlandCursorFromSocket({ socketPath })).resolves.toEqual({
        x: 2410,
        y: 1093,
      });
      await expect(
        readHyprlandCursorFromSocket({ socketPath: path.join(dir, 'missing') })
      ).resolves.toBeNull();
      await expect(readHyprlandCursorFromSocket({ socketPath: '' })).resolves.toBeNull();
    } finally {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
