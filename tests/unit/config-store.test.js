/**
 * @jest-environment jsdom
 */

const { createNullHost } = require('@hadw/renderer/host.js');
const { createConfigStore } = require('../../src/config-store.js');

// Main, as the null host stands in for it, but able to persist: each write is answered when the
// test says so, in whatever order it says.
function createMain(initial) {
  let stored = { ...initial };
  let revision = 7;
  const pending = [];
  const host = {
    ...createNullHost(),
    canPersistConfig: true,
    getConfigRevision: () => revision,
    updateConfig: jest.fn(
      (payload) =>
        new Promise((resolve, reject) => {
          pending.push({ payload, resolve, reject });
        })
    ),
  };
  return {
    host,
    pending,
    // Stores the write as main would and answers it, with the bookkeeping main sends along.
    accept(index = 0, extra = {}) {
      const [write] = pending.splice(index, 1);
      const { configRevision: _base, ...payload } = write.payload;
      stored = { ...stored, ...payload, ...extra };
      revision += 1;
      write.resolve({ ...stored, configRevision: revision, runtimeWarnings: [] });
    },
    refuse(index = 0, answer = { success: false, error: 'Disk full' }) {
      const [write] = pending.splice(index, 1);
      write.resolve(answer);
    },
    fail(index = 0, error) {
      const [write] = pending.splice(index, 1);
      write.reject(error);
    },
    get stored() {
      return stored;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setUp(initial = { homeAssistant: { url: 'http://ha.local' }, opacity: 0.9, ui: {} }) {
  const main = createMain(initial);
  const holder = {
    CONFIG: null,
    setConfig(config) {
      this.CONFIG = config;
    },
  };
  holder.setConfig(JSON.parse(JSON.stringify(initial)));
  const remember = jest.fn();
  const store = createConfigStore({ getHost: () => main.host, holder, remember });
  return { main, store, remember };
}

describe('config store', () => {
  test('a write sends the patch, and holds main’s answer without its bookkeeping', async () => {
    const { main, store } = setUp();

    const pending = store.update({ opacity: 0.5 });
    expect(main.host.updateConfig).toHaveBeenCalledWith({ opacity: 0.5 });
    // Not optimistic: nothing changes until main has stored it.
    expect(store.read().opacity).toBe(0.9);
    expect(store.isWriting()).toBe(true);

    main.accept(0, { normalizedByMain: true });
    const config = await pending;

    expect(config).toBe(store.read());
    expect(config).toMatchObject({ opacity: 0.5, normalizedByMain: true });
    expect(config).not.toHaveProperty('configRevision');
    expect(config).not.toHaveProperty('runtimeWarnings');
    expect(store.isWriting()).toBe(false);
  });

  test('a change function edits a copy, and main is sent the whole result', async () => {
    const { main, store } = setUp();
    const before = store.read();

    const pending = store.update((config) => {
      config.ui.theme = 'dark';
    });
    expect(before.ui).toEqual({});
    expect(main.host.updateConfig.mock.calls[0][0]).toEqual({ ...before, ui: { theme: 'dark' } });

    main.accept();
    await expect(pending).resolves.toMatchObject({ ui: { theme: 'dark' } });
  });

  test('the held config cannot be edited in place under test', async () => {
    const { main, store } = setUp();
    const pending = store.update({ ui: { theme: 'dark' } });
    main.accept();
    const config = await pending;

    expect(() => {
      config.ui.theme = 'light';
    }).toThrow(TypeError);
    expect(store.read().ui.theme).toBe('dark');
  });

  test('a refusal rejects with main’s error and changes nothing', async () => {
    const { main, store } = setUp();

    const pending = store.update({ opacity: 0.5 });
    main.refuse();

    await expect(pending).rejects.toMatchObject({
      message: 'Disk full',
      result: { success: false, error: 'Disk full' },
      superseded: false,
    });
    expect(store.read().opacity).toBe(0.9);
  });

  test('an answer without a config main stands behind is a refusal too', async () => {
    const { main, store } = setUp();

    const pending = store.update({ opacity: 0.5 });
    main.refuse(0, { success: true });

    await expect(pending).rejects.toThrow('The main process rejected the settings update');
    expect(store.read().opacity).toBe(0.9);
  });

  test('a refusal that carries the config main recovered to holds that config', async () => {
    const { main, store } = setUp();
    const recovered = {
      homeAssistant: { url: 'http://ha.local' },
      opacity: 0.7,
      configRevision: 9,
    };

    const pending = store.update({ opacity: 0.5 });
    const error = Object.assign(new Error('Failed to save settings'), {
      result: { success: false, config: recovered },
    });
    main.fail(0, error);

    await expect(pending).rejects.toBe(error);
    expect(store.read()).toEqual({ homeAssistant: { url: 'http://ha.local' }, opacity: 0.7 });
  });

  test('an optimistic write is held at once and rolled back when main refuses it', async () => {
    const { main, store } = setUp();

    const pending = store.update({ opacity: 0.5 }, { optimistic: true });
    expect(store.read().opacity).toBe(0.5);

    main.refuse();
    await expect(pending).rejects.toThrow('Disk full');
    expect(store.read().opacity).toBe(0.9);
  });

  test('an optimistic write that may not be rolled back keeps the change when refused', async () => {
    const { main, store } = setUp();

    const pending = store.update({ opacity: 0.5 }, { optimistic: true, rollbackOnFailure: false });
    main.refuse();

    await expect(pending).rejects.toThrow('Disk full');
    expect(store.read().opacity).toBe(0.5);
  });

  describe('a side effect', () => {
    test('runs once main has stored the change', async () => {
      const { main, store } = setUp();
      const apply = jest.fn();

      const pending = store.update({ opacity: 0.5 }, { apply });
      expect(apply).not.toHaveBeenCalled();
      main.accept();
      await pending;

      expect(apply).toHaveBeenCalledWith(store.read());
      expect(store.read().opacity).toBe(0.5);
    });

    test('that fails rolls the write back, then undoes itself', async () => {
      const { main, store } = setUp();
      const undo = jest.fn();
      const failure = new Error('Hotkey taken');

      const pending = store.update(
        (config) => {
          config.opacity = 0.5;
        },
        {
          apply: () => {
            throw failure;
          },
          undo,
        }
      );
      main.accept();
      await flush();

      // The rollback names the revision the write was built from, so main keeps what a profile
      // sync pull brought in since.
      expect(main.host.updateConfig).toHaveBeenLastCalledWith({
        homeAssistant: { url: 'http://ha.local' },
        opacity: 0.9,
        ui: {},
        configRevision: 7,
      });
      main.accept();

      await expect(pending).rejects.toBe(failure);
      expect(failure.rollbackError).toBeUndefined();
      expect(store.read().opacity).toBe(0.9);
      expect(undo).toHaveBeenCalledWith(store.read());
    });

    test('rolls back only the keys a patch changed', async () => {
      const { main, store } = setUp();

      const pending = store.update(
        { opacity: 0.5, frostedGlass: true },
        {
          apply: () => {
            throw new Error('No');
          },
        }
      );
      main.accept();
      await flush();

      expect(main.host.updateConfig).toHaveBeenLastCalledWith({
        opacity: 0.9,
        frostedGlass: null,
        configRevision: 7,
      });
      main.accept();
      await expect(pending).rejects.toThrow('No');
    });

    test('keeps the write when the rollback is refused, and says why', async () => {
      const { main, store } = setUp();
      const undo = jest.fn();

      const pending = store.update(
        { opacity: 0.5 },
        {
          apply: () => {
            throw new Error('Hotkey taken');
          },
          undo,
        }
      );
      main.accept();
      await flush();
      // The answer to the rollback is no config at all.
      main.refuse(0, { error: 'Restore failed' });

      const error = await pending.catch((thrown) => thrown);
      expect(error.message).toBe('Hotkey taken');
      expect(error.rollbackError.message).toBe('Restore failed');
      // What main refused to restore is not taken for a config.
      expect(store.read()).toMatchObject({
        homeAssistant: { url: 'http://ha.local' },
        opacity: 0.5,
      });
      expect(undo).not.toHaveBeenCalled();
    });

    test('says so when it cannot be undone after the rollback', async () => {
      const { main, store } = setUp();

      const pending = store.update(
        { opacity: 0.5 },
        {
          apply: () => {
            throw new Error('Hotkey taken');
          },
          undo: () => {
            throw new Error('Not re-registered');
          },
        }
      );
      main.accept();
      await flush();
      main.accept();

      const error = await pending.catch((thrown) => thrown);
      expect(error.rollbackError.message).toBe('Not re-registered');
      expect(store.read().opacity).toBe(0.9);
    });
  });

  describe('writes that overlap', () => {
    test('only the newest write adopts main’s answer, whatever order the answers come in', async () => {
      const { main, store } = setUp();

      const first = store.update({ opacity: 0.5 }, { optimistic: true });
      const second = store.update({ opacity: 0.6 }, { optimistic: true });
      expect(store.read().opacity).toBe(0.6);

      // The newer write is answered first; the older answer then arrives late.
      main.accept(1);
      await second;
      main.accept(0);
      const late = await first;

      expect(late.opacity).toBe(0.5);
      expect(late).not.toBe(store.read());
      expect(store.read().opacity).toBe(0.6);
    });

    test('an older write that fails does not undo a newer one', async () => {
      const { main, store } = setUp();

      const first = store.update({ opacity: 0.5 }, { optimistic: true });
      const second = store.update({ opacity: 0.6 }, { optimistic: true });

      main.refuse(0);
      await expect(first).rejects.toMatchObject({ superseded: true });
      expect(store.read().opacity).toBe(0.6);

      main.accept(0);
      await second;
      expect(store.read().opacity).toBe(0.6);
    });

    test('the newest write that fails goes back to the newest config main has answered with', async () => {
      const { main, store } = setUp();

      const first = store.update({ opacity: 0.5 }, { optimistic: true });
      const second = store.update({ ui: { theme: 'dark' } }, { optimistic: true });

      main.accept(0);
      await first;
      main.refuse(0);
      await expect(second).rejects.toMatchObject({ superseded: false });

      // The first write stood; only the second goes.
      expect(store.read()).toMatchObject({ opacity: 0.5, ui: {} });
    });

    test('a config main sent while a write was pending is not undone by its answer', async () => {
      const { main, store } = setUp();

      const pending = store.update({ opacity: 0.5 });
      store.adopt({ homeAssistant: { url: 'http://ha.local' }, opacity: 0.3, pulled: true });
      main.accept();
      await pending;

      expect(store.read()).toMatchObject({ opacity: 0.3, pulled: true });
    });

    test('a change made here while a write is pending is made again over its answer', async () => {
      const { main, store } = setUp();

      const pending = store.update({ opacity: 0.5 });
      await store.update(
        (config) => {
          config.ui = { ...config.ui, collapsed: true };
        },
        { persist: false }
      );
      expect(main.host.updateConfig).toHaveBeenCalledTimes(1);

      main.accept();
      await pending;
      expect(store.read()).toMatchObject({ opacity: 0.5, ui: { collapsed: true } });
    });
  });

  test('keeps the replaced layout for Undo when asked to', async () => {
    const { main, store, remember } = setUp();
    const before = store.read();

    const plain = store.update({ opacity: 0.5 });
    main.accept();
    await plain;
    expect(remember).not.toHaveBeenCalled();

    const edit = store.update({ customTabs: [] }, { history: true });
    main.accept();
    await edit;
    expect(remember).toHaveBeenLastCalledWith(
      { ...before, opacity: 0.5 },
      expect.objectContaining({ customTabs: [] }),
      undefined
    );

    const restore = store.update({ customTabs: [{ id: 'a' }] }, { history: { wholeLayout: true } });
    main.accept();
    await restore;
    expect(remember).toHaveBeenLastCalledWith(expect.any(Object), expect.any(Object), {
      wholeLayout: true,
    });
  });

  describe('without a host that can persist (the null host)', () => {
    function setUpNull() {
      const holder = { CONFIG: { opacity: 0.9 }, setConfig: (c) => (holder.CONFIG = c) };
      return { holder, store: createConfigStore({ getHost: createNullHost, holder }) };
    }

    test('an optimistic change is kept here', async () => {
      const { store } = setUpNull();
      await expect(store.update({ opacity: 0.5 }, { optimistic: true })).resolves.toMatchObject({
        opacity: 0.5,
      });
      expect(store.read().opacity).toBe(0.5);
    });

    test('a write that needs main’s answer is refused', async () => {
      const { store } = setUpNull();
      await expect(store.update({ opacity: 0.5 })).rejects.toThrow(
        'Configuration updates are unavailable on this build.'
      );
      expect(store.read().opacity).toBe(0.9);
    });
  });

  test('adopt holds a config main sent, and refuses anything else', () => {
    const { store } = setUp();

    expect(() => store.adopt({ success: false, error: 'Locked' })).toThrow('Locked');
    expect(() => store.adopt(undefined)).toThrow('The main process rejected the settings update');
    expect(store.read().opacity).toBe(0.9);

    const config = store.adopt({ homeAssistant: { url: 'http://x' }, persistenceWarnings: [] });
    expect(config).toEqual({ homeAssistant: { url: 'http://x' } });
    expect(store.read()).toBe(config);
  });
});
