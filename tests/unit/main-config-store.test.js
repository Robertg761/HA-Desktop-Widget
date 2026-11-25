/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONFIG_STORE_CLOSED,
  createConfigStore,
  replaceConfigContents,
} = require('../../src/main-config-store.cjs');

let tempDir;
let filePath;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-store-'));
  filePath = path.join(tempDir, 'config.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function readFile() {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Node's fs, with the next async writes held until released, failed, or both.
function controllableFs() {
  const plan = [];
  const fakeFs = {
    ...fs,
    promises: {
      ...fs.promises,
      writeFile: async (target, ...rest) => {
        const step = plan.shift();
        if (step?.hold) await step.hold;
        if (step?.fail) throw new Error(step.fail);
        return fs.promises.writeFile(target, ...rest);
      },
    },
  };
  return {
    fs: fakeFs,
    /** Plans the next write; returns the function that lets a held one go on. */
    nextWrite({ fail = '', hold = false } = {}) {
      let release = () => {};
      const step = { fail };
      if (hold) {
        step.hold = new Promise((resolve) => {
          release = resolve;
        });
      }
      plan.push(step);
      return release;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

function createStore(options = {}) {
  const store = createConfigStore({ filePath, ...options });
  store.load({ theme: 'dark', favorites: ['light.kitchen'], window: { x: 1 } });
  return store;
}

describe('config store', () => {
  it('writes an applied change to disk before resolving and keeps one config object', async () => {
    const store = createStore();
    const config = store.get();

    const result = await store.apply((current) => ({ ...current, theme: 'light' }), {
      origin: 'settings',
    });

    expect(result).toMatchObject({ success: true });
    expect(store.get()).toBe(config);
    expect(config.theme).toBe('light');
    expect(readFile()).toEqual({ theme: 'light', favorites: ['light.kitchen'], window: { x: 1 } });
  });

  it('leaves the config as it was when the write fails', async () => {
    const io = controllableFs();
    const store = createStore({ fs: io.fs });
    const listener = jest.fn();
    store.subscribe(listener);
    io.nextWrite({ fail: 'disk full' });

    const result = await store.apply(
      (current) => {
        current.theme = 'light';
        current.favorites.push('light.office');
      },
      { origin: 'settings' }
    );

    expect(result).toEqual({ success: false, error: 'disk full' });
    expect(store.get()).toEqual({
      theme: 'dark',
      favorites: ['light.kitchen'],
      window: { x: 1 },
    });
    expect(listener).not.toHaveBeenCalled();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it('keeps an edit made to another key while a failing write was running', async () => {
    const io = controllableFs();
    const store = createStore({ fs: io.fs });
    const release = io.nextWrite({ hold: true, fail: 'disk full' });

    const pending = store.apply(
      (current) => {
        current.theme = 'light';
      },
      { origin: 'settings' }
    );
    await settle();
    store.get().window = { x: 2 };
    release();

    await expect(pending).resolves.toMatchObject({ success: false });
    expect(store.get()).toMatchObject({ theme: 'dark', window: { x: 2 } });
  });

  it('undoes what a before-write hook did when the write fails', async () => {
    const io = controllableFs();
    const store = createStore({ fs: io.fs });
    const tracking = { stamped: 0 };
    store.beforeWrite((config) => {
      config.editedAt = 'now';
      tracking.stamped += 1;
      return () => {
        tracking.stamped -= 1;
      };
    });
    io.nextWrite({ fail: 'disk full' });

    await store.apply(
      (current) => {
        current.theme = 'light';
      },
      { origin: 'settings' }
    );

    expect(tracking.stamped).toBe(0);
    expect(store.get()).not.toHaveProperty('editedAt');

    await store.apply(
      (current) => {
        current.theme = 'light';
      },
      { origin: 'settings' }
    );
    expect(tracking.stamped).toBe(1);
    expect(readFile()).toMatchObject({ theme: 'light', editedAt: 'now' });
  });

  it('rolls back and rejects when the change itself throws', async () => {
    const store = createStore();

    await expect(
      store.apply((current) => {
        current.theme = 'light';
        throw new Error('invalid change');
      })
    ).rejects.toThrow('invalid change');

    expect(store.get().theme).toBe('dark');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('tells every subscriber about every committed change, in subscription order', async () => {
    const store = createStore();
    const calls = [];
    store.subscribe(async (change) => {
      await settle();
      calls.push(['first', change.origin, change.previous.theme, change.config.theme]);
    });
    store.subscribe((change) => {
      calls.push(['second', change.origin, change.focus]);
    });

    await store.apply(
      (current) => {
        current.theme = 'light';
      },
      { origin: 'settings', focus: 'pin.a' }
    );
    await store.apply(null, { origin: 'local' });

    expect(calls).toEqual([
      ['first', 'settings', 'dark', 'light'],
      ['second', 'settings', 'pin.a'],
      ['first', 'local', 'light', 'light'],
      ['second', 'local', undefined],
    ]);
  });

  it('turns a failing subscriber into a runtime warning and still runs the rest', async () => {
    const store = createStore();
    const later = jest.fn();
    store.subscribe(() => {
      throw new Error('tray is gone');
    }, 'tray language');
    store.subscribe((change) => later(change.runtimeWarnings.length));

    const result = await store.apply(null, { origin: 'settings' });

    expect(result.success).toBe(true);
    expect(result.runtimeWarnings).toEqual([
      { code: 'runtime_side_effect_failed', context: 'tray language', error: 'tray is gone' },
    ]);
    expect(later).toHaveBeenCalledWith(1);
  });

  it('stops notifying a listener once it unsubscribes', async () => {
    const store = createStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    await store.apply(null, { origin: 'local' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('runs concurrent changes one after another, each from the last one’s result', async () => {
    const store = createStore();
    const seen = [];
    const append = (entity) => async (current) => {
      seen.push([...current.favorites]);
      await settle();
      current.favorites = [...current.favorites, entity];
    };

    await Promise.all([
      store.apply(append('light.a')),
      store.apply(append('light.b')),
      store.apply(append('light.c')),
    ]);

    expect(seen).toEqual([
      ['light.kitchen'],
      ['light.kitchen', 'light.a'],
      ['light.kitchen', 'light.a', 'light.b'],
    ]);
    expect(readFile().favorites).toEqual(['light.kitchen', 'light.a', 'light.b', 'light.c']);
  });

  it('applies inline from a task already in the queue, and queues other callers behind it', async () => {
    const store = createStore();
    const order = [];

    const task = store.serialize(async () => {
      order.push('task start');
      await store.apply((current) => {
        current.theme = 'light';
      });
      order.push('task applied');
      await settle();
      order.push('task end');
    });
    const outside = store.apply(() => {
      order.push('outside apply');
    });

    await Promise.all([task, outside]);
    expect(order).toEqual(['task start', 'task applied', 'task end', 'outside apply']);
  });

  it('turns work away once closed, after running the final task behind the queued ones', async () => {
    const store = createStore();
    const order = [];
    const queued = store.serialize(async () => {
      await settle();
      order.push('queued');
    });

    const final = store.close(() => order.push('final'));
    await expect(store.serialize(() => order.push('late'))).rejects.toMatchObject({
      code: CONFIG_STORE_CLOSED,
    });
    await Promise.all([queued, final]);
    expect(order).toEqual(['queued', 'final']);

    store.reopen();
    await store.serialize(() => order.push('after reopen'));
    expect(order).toEqual(['queued', 'final', 'after reopen']);
  });

  it('stamps each written change with the next revision', async () => {
    const store = createStore();
    expect(store.revision()).toBe(0);

    const first = await store.apply(null, { origin: 'local' });
    const second = await store.apply(null, { origin: 'local' });
    const memoryOnly = await store.apply(
      (current) => {
        current.status = 'offline';
      },
      { origin: 'home-assistant-auth', persist: false }
    );

    expect([first.revision, second.revision]).toEqual([1, 2]);
    expect(memoryOnly).toMatchObject({ success: true, revision: 2 });
    expect(store.revision()).toBe(2);
    expect(readFile()).not.toHaveProperty('status');
  });

  it('refuses every write while the loaded file could not be read safely', async () => {
    fs.writeFileSync(filePath, '{"theme": "user"');
    const store = createConfigStore({ filePath });
    store.load({ theme: 'default' }, { writeBlockedReason: 'The existing config is unreadable' });

    const applied = await store.apply((current) => {
      current.theme = 'light';
    });

    expect(applied).toEqual({ success: false, error: 'The existing config is unreadable' });
    expect(store.get().theme).toBe('default');
    expect(store.save()).toEqual({ success: false, error: 'The existing config is unreadable' });
    expect(store.flushSync()).toEqual({
      success: false,
      error: 'The existing config is unreadable',
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{"theme": "user"');

    store.load({ theme: 'default' });
    expect(store.flushSync()).toEqual({ success: true });
    expect(readFile()).toEqual({ theme: 'default' });
  });

  it('writes in-place edits after a pause, once, with the latest content', async () => {
    const timers = [];
    const store = createStore({
      setTimeout: (fn, ms) => timers.push({ fn, ms }),
      clearTimeout: (id) => {
        timers[id - 1].cleared = true;
      },
    });

    store.get().window = { x: 5 };
    expect(store.save({ origin: 'local' })).toEqual({ success: true, persistenceWarnings: [] });
    store.get().window = { x: 6 };
    store.save({ origin: 'local' });
    expect(fs.existsSync(filePath)).toBe(false);

    const live = timers.filter((timer) => !timer.cleared);
    expect(live).toEqual([expect.objectContaining({ ms: 120 })]);
    live[0].fn();
    while (!fs.existsSync(filePath)) await settle();
    expect(readFile().window).toEqual({ x: 6 });
  });

  it('lets a newer snapshot that succeeds satisfy an older write that failed', async () => {
    const io = controllableFs();
    const store = createStore({ fs: io.fs });
    const release = io.nextWrite({ hold: true, fail: 'disk busy' });

    const pending = store.apply((current) => {
      current.theme = 'light';
    });
    await settle();
    // A background save queues a newer snapshot that holds the same change.
    store.get().window = { x: 9 };
    store.save({ origin: 'local' });
    release();

    await expect(pending).resolves.toMatchObject({ success: true });
    expect(readFile()).toMatchObject({ theme: 'light', window: { x: 9 } });
  });

  it('does not let an older async write land after a shutdown flush', async () => {
    const io = controllableFs();
    const store = createStore({ fs: io.fs });
    const release = io.nextWrite({ hold: true });

    const pending = store.apply((current) => {
      current.theme = 'light';
    });
    await settle();
    store.get().window = { x: 3 };
    expect(store.flushSync()).toEqual({ success: true });
    release();

    await expect(pending).resolves.toMatchObject({ success: true });
    await settle();
    expect(readFile()).toMatchObject({ theme: 'light', window: { x: 3 } });
    expect(fs.readdirSync(tempDir)).toEqual(['config.json']);
  });

  it('runs the before-write hooks for background saves and says so', () => {
    const store = createStore();
    const hook = jest.fn();
    store.beforeWrite(hook);

    store.save({ origin: 'local' });
    store.flushSync({ origin: 'shutdown' });

    expect(hook.mock.calls.map(([, change]) => change)).toEqual([
      { origin: 'local', background: true },
      { origin: 'shutdown', background: true },
    ]);
  });

  it('copies a replacement into the existing object', () => {
    const target = { a: 1, nested: { b: 2 } };
    const nested = target.nested;
    replaceConfigContents(target, { ...target, a: 3, c: 4 });
    expect(target).toEqual({ a: 3, nested: { b: 2 }, c: 4 });
    expect(target.nested).toBe(nested);
    replaceConfigContents(target, { c: 5 });
    expect(target).toEqual({ c: 5 });
  });
});
