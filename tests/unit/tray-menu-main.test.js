/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

function loadTrayMenu({ isPackaged = true, isDev = false, alwaysOnTop = true } = {}) {
  const context = {
    app: { isPackaged },
    IS_DEV_MODE: isDev,
    config: { alwaysOnTop },
    isLayerShellChildProcess: false,
    usesCompositorOwnedPlacement: false,
    layerShellRaiser: null,
    layerShellMonitors: [],
    omarchyBarPublisher: null,
    omarchyBarEntry: { present: false },
    mainWindow: {
      isDestroyed: () => false,
      reload: jest.fn(),
      webContents: { openDevTools: jest.fn() },
    },
    pkg: { bugs: { url: 'https://example.invalid/issues' } },
    shell: { openExternal: jest.fn() },
    mainT: (key) => key,
    Menu: { buildFromTemplate: (items) => items },
    protectAutoHideDuringMenu: (menu) => menu,
    toggleMainWindowFromTrayEntity: jest.fn(),
    applyAlwaysOnTopPreference: jest.fn(),
    saveConfigDurably: jest.fn(async () => ({ success: true })),
    runSerializedConfigMutation: jest.fn((task) => task()),
    log: { warn: jest.fn() },
    showMainWindowFromTray: jest.fn(),
    checkForUpdatesForCurrentPackage: jest.fn(async () => ({ status: 'none' })),
    describeUpdateError: (error) => error.message,
    fs: { rmSync: jest.fn() },
    isQuitting: false,
  };
  vm.runInNewContext(
    sliceMain('function buildTrayContextMenu()', 'function getOmarchyBarEntities()'),
    context
  );
  return context;
}

const labels = (menu) => menu.map((item) => item.label ?? '---');

describe('the tray menu', () => {
  it('leaves the debugging commands out of a release build', () => {
    const menu = loadTrayMenu({ isPackaged: true }).buildTrayContextMenu();
    expect(labels(menu)).not.toContain('DevTools');
    expect(labels(menu)).not.toContain('Reload');
    // No separator is left doubled up where they were.
    for (let index = 1; index < menu.length; index += 1) {
      expect(menu[index].type === 'separator' && menu[index - 1].type === 'separator').toBe(false);
    }
    expect(labels(menu)).toEqual(
      expect.arrayContaining(['Show/Hide', 'Always on Top', 'Open Settings', 'Quit'])
    );
  });

  it('keeps them for a build run from source and for --dev', () => {
    for (const options of [{ isPackaged: false }, { isPackaged: true, isDev: true }]) {
      const context = loadTrayMenu(options);
      const menu = context.buildTrayContextMenu();
      expect(labels(menu)).toEqual(expect.arrayContaining(['DevTools', 'Reload']));

      menu.find((item) => item.label === 'DevTools').click();
      menu.find((item) => item.label === 'Reload').click();
      expect(context.mainWindow.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' });
      expect(context.mainWindow.reload).toHaveBeenCalledTimes(1);
    }
  });

  it('does not fail when the window is gone by the time DevTools or Reload is clicked', () => {
    const context = loadTrayMenu({ isPackaged: false });
    const menu = context.buildTrayContextMenu();
    context.mainWindow = null;
    expect(() => menu.find((item) => item.label === 'DevTools').click()).not.toThrow();
    expect(() => menu.find((item) => item.label === 'Reload').click()).not.toThrow();
  });

  describe('Always on Top', () => {
    const alwaysOnTopItem = (context) =>
      context.buildTrayContextMenu().find((item) => item.label === 'Always on Top');

    it('flips the setting as it is now, even when the menu was built before Settings changed it', async () => {
      const context = loadTrayMenu({ alwaysOnTop: true });
      const item = alwaysOnTopItem(context);
      expect(item.checked).toBe(true);

      // Settings turns it off; this menu still shows the check mark it was built with.
      context.config.alwaysOnTop = false;
      item.click({ checked: false });
      await Promise.resolve();

      // One click turns it on, instead of asking for "off" again and doing nothing.
      expect(context.config.alwaysOnTop).toBe(true);
      expect(context.applyAlwaysOnTopPreference).toHaveBeenCalled();
    });

    it('turns it off again from the same menu', async () => {
      const context = loadTrayMenu({ alwaysOnTop: true });
      alwaysOnTopItem(context).click({ checked: false });
      await Promise.resolve();
      await Promise.resolve();
      expect(context.config.alwaysOnTop).toBe(false);
    });

    it('puts the setting and the check mark back when it cannot be saved', async () => {
      const context = loadTrayMenu({ alwaysOnTop: true });
      context.saveConfigDurably = jest.fn(async () => ({ success: false, error: 'disk full' }));
      const item = alwaysOnTopItem(context);
      const menuItem = { checked: false };
      item.click(menuItem);
      await new Promise((resolve) => setImmediate(resolve));

      expect(context.config.alwaysOnTop).toBe(true);
      expect(menuItem.checked).toBe(true);
    });
  });
});

describe('keeping the tray menu in step with the settings', () => {
  it('rebuilds it after Always on top changes in Settings or arrives from a sync', () => {
    const setIpc = sliceMain(
      "ipcMain.handle(\n  'set-always-on-top'",
      'async function updateLayerDrag'
    );
    expect(setIpc.match(/refreshTrayMenu\(\)/g)).toHaveLength(2);

    const sideEffects = sliceMain(
      'function applyMainWindowSettingSideEffects',
      'function configSectionChanged'
    );
    expect(sideEffects).toMatch(
      /previousConfig\?\.alwaysOnTop !== nextConfig\?\.alwaysOnTop\) \{\s*applyAlwaysOnTopPreference\(\);\s*refreshTrayMenu\(\);/
    );
  });

  it('only rebuilds a tray that exists, and not while quitting', () => {
    const createTray = jest.fn();
    const context = { tray: null, isQuitting: false, createTray };
    vm.runInNewContext(sliceMain('/** Rebuild the tray menu', 'function createTray()'), context);

    context.refreshTrayMenu();
    expect(createTray).not.toHaveBeenCalled();

    context.tray = { isDestroyed: () => false };
    context.refreshTrayMenu();
    expect(createTray).toHaveBeenCalledTimes(1);

    context.tray = { isDestroyed: () => true };
    context.refreshTrayMenu();
    context.tray = { isDestroyed: () => false };
    context.isQuitting = true;
    context.refreshTrayMenu();
    expect(createTray).toHaveBeenCalledTimes(1);
  });
});
