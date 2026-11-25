/**
 * The main process's config store for tests that run slices of main.js in a vm: the real store
 * (src/main-config-store.cjs) writing to an in-memory file, with main.js's own config change effects
 * subscribed to it. Each effect calls a function of the same name in `stubs` (a jest.fn() unless
 * the test passes its own), so a test sees which effects a change set off, in order.
 *
 *   const { configStore, failNextWrite, writeCount } = createMainConfigStore(config, {
 *     pushConfigToRenderer: context.pushConfigToRenderer,
 *   });
 *   context.configStore = configStore;
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createConfigStore, replaceConfigContents } = require('../../src/main-config-store.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    throw new Error(`Could not slice main.js from ${startMarker}`);
  }
  return mainSource.slice(start, end);
}

// The effects table and the subscriptions, as main.js registers them.
const CONFIG_CHANGE_EFFECTS_SOURCE = sliceMain(
  '// Config change effects.',
  '// End of config change effects.'
);

const CONFIG_FILE_PATH = path.join(path.sep, 'profile', 'config.json');

/**
 * An fs stand-in holding files in memory. The next writes can be made to fail, and the next async
 * write can be intercepted: it waits for the interceptor, and fails if the interceptor throws.
 */
function createMemoryFs() {
  const files = new Map();
  const failures = [];
  const interceptors = [];
  let writes = 0;
  const write = (target, text) => {
    writes += 1;
    const failure = failures.shift();
    if (failure) throw new Error(failure);
    files.set(target, text);
  };
  return {
    files,
    failNextWrite(message = 'disk full') {
      failures.push(message);
    },
    failWrites(message = 'disk full') {
      failures.push(...Array(100).fill(message));
    },
    interceptNextWrite(interceptor) {
      interceptors.push(interceptor);
    },
    writeCount: () => writes,
    fs: {
      promises: {
        mkdir: async () => {},
        writeFile: async (target, text) => {
          const interceptor = interceptors.shift();
          if (interceptor) {
            try {
              await interceptor();
            } catch (error) {
              writes += 1;
              throw error;
            }
          }
          write(target, text);
        },
        unlink: async (target) => {
          files.delete(target);
        },
      },
      mkdirSync: () => {},
      writeFileSync: (target, text) => write(target, text),
      renameSync: (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      existsSync: (target) => files.has(target),
      unlinkSync: (target) => files.delete(target),
    },
  };
}

const EFFECT_FUNCTIONS = [
  'scheduleDebouncedProfileSyncPush',
  'applyMainWindowSettingSideEffects',
  'applyRuntimeConfigSideEffects',
  'createTray',
  'configureAutoUpdaterChannel',
  'syncDesktopPinWindowsWithConfig',
  'syncTrayEntitiesWithConfig',
  'pushConfigToRenderer',
  'broadcastDesktopPinConfigUpdate',
  'emitProfileSyncStatus',
  // What a Settings save that turns sync on or off calls.
  'clearProfileSyncTimers',
  'setupProfileSyncInterval',
  'prepareProfileSyncFirstEnableResolution',
  'completeProfileSyncFirstEnablePreparation',
  'updateProfileSyncStatus',
  'getActiveProfileSyncPassphrase',
  'updateLocalProfileSyncTracking',
];

/**
 * @param {object} config the config the store starts with (the store keeps this object)
 * @param {object} [stubs] functions and values the effects block reads from main.js
 * @param {object} [options]
 * @param {Function} [options.encode] what turns the config into the file's text (JSON by default)
 */
function createMainConfigStore(config, stubs = {}, { encode } = {}) {
  const memory = createMemoryFs();
  const configStore = createConfigStore({
    filePath: CONFIG_FILE_PATH,
    fs: memory.fs,
    ...(encode ? { encode } : {}),
  });
  configStore.load(config);
  const context = {
    configStore,
    config,
    profileSyncRuntime: { localProfileHash: null },
    tray: null,
    autoUpdaterInstance: null,
    omarchyBarPublisher: null,
    mainTError: (error) => error?.message || String(error),
    WeakMap,
    ...Object.fromEntries(EFFECT_FUNCTIONS.map((name) => [name, jest.fn()])),
    ...stubs,
  };
  vm.runInNewContext(CONFIG_CHANGE_EFFECTS_SOURCE, context);
  return {
    configStore,
    replaceConfigContents,
    context,
    failNextWrite: memory.failNextWrite,
    failWrites: memory.failWrites,
    interceptNextWrite: memory.interceptNextWrite,
    writeCount: memory.writeCount,
    /** The config as config.json holds it, or null before the first write. */
    written() {
      const text = memory.files.get(CONFIG_FILE_PATH);
      return text === undefined ? null : JSON.parse(text);
    },
  };
}

module.exports = { createMainConfigStore, createMemoryFs, replaceConfigContents };
