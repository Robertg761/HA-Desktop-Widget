/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');

const { buildRaiseScript, createKWinWindowRaiser } = require('../../src/kwin-window-raise.cjs');

const KWIN_SCRIPTING_PATH = '/Scripting';
const RUNTIME_DIR = path.resolve(path.join(path.sep, 'run', 'user', '1000'));

const silentLog = { info() {}, debug() {}, warn() {}, error() {} };

class FakeKWinBus extends EventEmitter {
  constructor({ kwinPresent = true, loadId = 7, plasma6RunFails = false, loadIds = null } = {}) {
    super();
    this.kwinPresent = kwinPresent;
    this.loadId = loadId;
    this.loadIds = Array.isArray(loadIds) ? [...loadIds] : null;
    this.plasma6RunFails = plasma6RunFails;
    this.calls = [];
    this.disconnected = false;
  }

  call(message) {
    this.calls.push({
      member: message.member,
      interface: message.interface,
      path: message.path,
      body: message.body,
    });

    switch (message.member) {
      case 'NameHasOwner':
        return Promise.resolve({ body: [this.kwinPresent] });
      case 'unloadScript':
        return Promise.resolve({ body: [true] });
      case 'loadScript': {
        const id = this.loadIds && this.loadIds.length ? this.loadIds.shift() : this.loadId;
        return Promise.resolve({ body: [id] });
      }
      case 'run':
        if (this.plasma6RunFails && message.path.startsWith(`${KWIN_SCRIPTING_PATH}/Script`)) {
          return Promise.reject(new Error('No such object path'));
        }
        return Promise.resolve({ body: [] });
      default:
        return Promise.reject(new Error(`Unexpected member ${message.member}`));
    }
  }

  disconnect() {
    this.disconnected = true;
  }
}

function createRaiser(busOptions = {}, overrides = {}) {
  const bus = new FakeKWinBus(busOptions);
  const writeFile = jest.fn(() => Promise.resolve());
  const removeFile = jest.fn(() => Promise.resolve());
  const raiser = createKWinWindowRaiser({
    log: overrides.log || silentLog,
    platform: overrides.platform || 'linux',
    scriptDir: RUNTIME_DIR,
    writeFile,
    removeFile,
    createBus: () => bus,
    ...overrides.options,
  });
  return { raiser, bus, writeFile, removeFile };
}

describe('buildRaiseScript', () => {
  it('embeds the exact title and supports both Plasma generations', () => {
    const script = buildRaiseScript('HA Desktop Widget');
    expect(script).toContain('var wanted = "HA Desktop Widget";');
    expect(script).toContain('workspace.windowList');
    expect(script).toContain('workspace.clientList');
    expect(script).toContain('workspace.activeWindow = candidate');
    expect(script).toContain('workspace.activeClient = candidate');
  });

  it('escapes titles that would otherwise break out of the script string', () => {
    const script = buildRaiseScript('He said "hi"\\n');
    expect(script).toContain(JSON.stringify('He said "hi"\\n'));
  });
});

describe('createKWinWindowRaiser', () => {
  it('writes the script and drives unload -> load -> run -> unload', async () => {
    const { raiser, bus, writeFile } = createRaiser({ loadId: 3 });

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(true);

    expect(writeFile).toHaveBeenCalledWith(
      raiser.getScriptFilePath(),
      expect.stringContaining('"HA Desktop Widget"'),
      { encoding: 'utf8', mode: 0o600, flag: 'wx' }
    );
    expect(bus.calls.map((call) => call.member)).toEqual([
      'NameHasOwner',
      'unloadScript',
      'loadScript',
      'run',
      'unloadScript',
    ]);
    expect(bus.calls[2].body).toEqual([raiser.getScriptFilePath(), raiser.getPluginName()]);
    expect(bus.calls[3].path).toBe(`${KWIN_SCRIPTING_PATH}/Script3`);
  });

  describe('the temporary script file', () => {
    it('is private to the user, unguessable, and removed once KWin has run it', async () => {
      const { raiser, writeFile, removeFile } = createRaiser();

      await raiser.raiseWindowByTitle('HA Desktop Widget');

      const [scriptPath, , options] = writeFile.mock.calls[0];
      expect(path.dirname(scriptPath)).toBe(path.resolve(RUNTIME_DIR));
      expect(path.basename(scriptPath)).toMatch(
        new RegExp(`^${raiser.getPluginName()}-[0-9a-f]{16}\\.js$`)
      );
      // Owner-only, and refusing to write through a file or link someone else left there.
      expect(options).toMatchObject({ mode: 0o600, flag: 'wx' });
      expect(removeFile).toHaveBeenCalledWith(scriptPath);
    });

    it('gets a new name every raise', async () => {
      const { raiser, writeFile } = createRaiser();

      await raiser.raiseWindowByTitle('HA Desktop Widget');
      await raiser.raiseWindowByTitle('HA Desktop Widget');

      expect(writeFile.mock.calls[0][0]).not.toBe(writeFile.mock.calls[1][0]);
    });

    it('is removed even when KWin refuses to load it', async () => {
      const { raiser, writeFile, removeFile } = createRaiser({ loadId: -1 });

      await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(false);

      expect(removeFile).toHaveBeenCalledWith(writeFile.mock.calls[0][0]);
    });

    it('is not left behind by a failure to remove it', async () => {
      const { raiser } = createRaiser(
        {},
        { options: { removeFile: jest.fn(() => Promise.reject(new Error('EACCES'))) } }
      );
      await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(true);
    });

    it('goes in the runtime directory, falling back to the temporary directory', () => {
      const withRuntime = createKWinWindowRaiser({
        log: silentLog,
        env: { XDG_RUNTIME_DIR: RUNTIME_DIR },
      });
      expect(path.dirname(withRuntime.getScriptFilePath())).toBe(RUNTIME_DIR);

      const withoutRuntime = createKWinWindowRaiser({ log: silentLog, env: {} });
      expect(path.dirname(withoutRuntime.getScriptFilePath())).toBe(os.tmpdir());
    });
  });

  it('resolves false without touching KWin when the bus name has no owner', async () => {
    const { raiser, bus, writeFile } = createRaiser({ kwinPresent: false });

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(false);

    expect(writeFile).not.toHaveBeenCalled();
    expect(bus.calls.map((call) => call.member)).toEqual(['NameHasOwner']);
  });

  it('falls back to the Plasma 5 script object path and remembers it', async () => {
    const { raiser, bus } = createRaiser({ plasma6RunFails: true, loadIds: [4, 5] });

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(true);

    const runPaths = bus.calls.filter((call) => call.member === 'run').map((call) => call.path);
    expect(runPaths).toEqual([`${KWIN_SCRIPTING_PATH}/Script4`, '/4']);

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(true);
    const laterRunPaths = bus.calls
      .filter((call) => call.member === 'run')
      .map((call) => call.path);
    // The second raise goes straight to the Plasma 5 path.
    expect(laterRunPaths).toEqual([`${KWIN_SCRIPTING_PATH}/Script4`, '/4', '/5']);
  });

  it('resolves false and warns when loadScript rejects the plugin', async () => {
    const warn = jest.fn();
    const { raiser } = createRaiser({ loadId: -1 }, { log: { ...silentLog, warn } });

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('KWin raise failed'));
  });

  it('resolves false off Linux and for empty titles without creating a bus', async () => {
    const createBus = jest.fn();
    const nonLinux = createKWinWindowRaiser({
      log: silentLog,
      platform: 'win32',
      writeFile: jest.fn(),
      createBus,
    });
    await expect(nonLinux.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(false);

    const linux = createKWinWindowRaiser({
      log: silentLog,
      platform: 'linux',
      writeFile: jest.fn(),
      createBus,
    });
    await expect(linux.raiseWindowByTitle('')).resolves.toBe(false);
    await expect(linux.raiseWindowByTitle(undefined)).resolves.toBe(false);

    expect(createBus).not.toHaveBeenCalled();
  });

  it('serializes overlapping raises so load/run cycles never interleave', async () => {
    const { raiser, bus } = createRaiser({ loadIds: [1, 2] });

    const [first, second] = await Promise.all([
      raiser.raiseWindowByTitle('HA Desktop Widget'),
      raiser.raiseWindowByTitle('HA Desktop Widget'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    const members = bus.calls.map((call) => call.member);
    expect(members).toEqual([
      'NameHasOwner',
      'unloadScript',
      'loadScript',
      'run',
      'unloadScript',
      'unloadScript',
      'loadScript',
      'run',
      'unloadScript',
    ]);
  });

  it('re-probes availability after a probe failure instead of caching it', async () => {
    let failFirstProbe = true;
    const bus = new FakeKWinBus({ loadId: 9 });
    const originalCall = bus.call.bind(bus);
    bus.call = (message) => {
      if (message.member === 'NameHasOwner' && failFirstProbe) {
        failFirstProbe = false;
        return Promise.reject(new Error('bus not ready'));
      }
      return originalCall(message);
    };
    const raiser = createKWinWindowRaiser({
      log: silentLog,
      platform: 'linux',
      scriptDir: '/tmp',
      writeFile: jest.fn(() => Promise.resolve()),
      createBus: () => bus,
    });

    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(false);
    await expect(raiser.raiseWindowByTitle('HA Desktop Widget')).resolves.toBe(true);
  });

  it('disconnects the bus on close', async () => {
    const { raiser, bus } = createRaiser();
    await raiser.raiseWindowByTitle('HA Desktop Widget');
    raiser.close();
    expect(bus.disconnected).toBe(true);
  });
});
