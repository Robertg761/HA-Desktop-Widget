/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadStartup(config) {
  const readyStart = mainSource.indexOf('app\n  .whenReady()');
  const start = mainSource.indexOf('// Camera proxy:', readyStart);
  const end = mainSource.indexOf('\n  })\n  .catch((error) => {', start);
  expect(start).toBeGreaterThan(readyStart);
  expect(end).toBeGreaterThan(start);

  let resolveIdentities;
  let rejectIdentities;
  // Model the discovery already running in the background when config finishes loading.
  const identities = new Promise((resolve, reject) => {
    resolveIdentities = resolve;
    rejectIdentities = reject;
  });
  const started = [];
  const context = {
    config,
    ensureDisplayIdentities: () => identities,
    createWindow: () => started.push('window'),
    setupAutoUpdates: () => started.push('updates'),
    setupUsagePing: () => started.push('usage'),
    schedulePostWindowStartupTasks: () => started.push('post-window'),
    protocol: { handle: () => {} },
    createHaProtocolHandler: () => {},
    createElectronNetBinaryFetcher: () => {},
    createPinnedDnsBinaryFetcher: () => {},
    isAllowedHlsProxyPath: () => true,
    net: {},
    log: { warn: jest.fn() },
  };
  // Execute the actual tail of the ready handler, including its protocol registration boundary.
  const startWindow = vm.runInNewContext(`() => { ${mainSource.slice(start, end)} }`, context);
  return { startWindow, started, resolveIdentities, rejectIdentities };
}

describe('startup monitor discovery', () => {
  it.each([
    ['new configuration', {}],
    ['Automatic monitor', { windowDisplay: null }],
    ['legacy runtime monitor ID', { windowDisplay: { id: '2', offset: { x: 40, y: 50 } } }],
  ])('starts a %s synchronously while discovery is unresolved', async (_label, config) => {
    const runtime = loadStartup(config);

    const completion = runtime.startWindow();

    expect(runtime.started).toEqual(['window', 'updates', 'usage', 'post-window']);
    runtime.resolveIdentities();
    await completion;
    expect(runtime.started).toEqual(['window', 'updates', 'usage', 'post-window']);
  });

  it('waits for discovery before restoring a persistent monitor preference', async () => {
    const runtime = loadStartup({ windowDisplay: { id: '2', persistentId: 'monitor-serial' } });

    const completion = runtime.startWindow();
    expect(runtime.started).toEqual([]);

    runtime.resolveIdentities();
    await completion;
    expect(runtime.started).toEqual(['window', 'updates', 'usage', 'post-window']);
  });

  it('still starts a persistent monitor preference when discovery fails', async () => {
    const runtime = loadStartup({ windowDisplay: { id: '2', persistentId: 'monitor-serial' } });

    const completion = runtime.startWindow();
    expect(runtime.started).toEqual([]);

    runtime.rejectIdentities(new Error('Monitor query timed out'));
    await completion;
    expect(runtime.started).toEqual(['window', 'updates', 'usage', 'post-window']);
  });
});
