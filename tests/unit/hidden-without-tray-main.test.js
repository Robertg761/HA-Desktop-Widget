/** @jest-environment node */
// Stock GNOME has no tray without an AppIndicator extension: the X, Ctrl+W and Alt+F4 still hide
// the widget (that is the owner's decision), so the app says once where it went.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const start = source.indexOf('let announcedHiddenWithoutTray');
const fn = source.slice(start, source.indexOf('\n}\n', start) + 3);

function load({ platform = 'linux', trayHostMissing = true, gnome = true } = {}) {
  const shown = [];
  class ElectronNotification {
    constructor(options) {
      this.options = options;
      this.listeners = {};
    }
    static isSupported() {
      return true;
    }
    on(name, listener) {
      this.listeners[name] = listener;
    }
    show() {
      shown.push(this);
    }
  }
  const context = {
    process: { platform },
    trayHostMissing,
    isGnome: () => gnome,
    ElectronNotification,
    mainT: (key) => key,
    showMainWindowFromTray: jest.fn(),
    log: { warn: jest.fn() },
  };
  vm.runInNewContext(fn, context);
  return { context, shown };
}

it('says once, on GNOME with no tray, that the widget is still running and how to get it back', () => {
  const { context, shown } = load();

  context.announceHiddenWithoutTray();
  context.announceHiddenWithoutTray();

  expect(shown).toHaveLength(1);
  expect(shown[0].options).toEqual({
    title: 'HA Desktop Widget is still running',
    body: 'Open it from your app launcher to bring it back. GNOME shows its tray icon only with an AppIndicator extension.',
  });
  shown[0].listeners.click();
  expect(context.showMainWindowFromTray).toHaveBeenCalled();
});

it.each([
  ['a tray is there', { trayHostMissing: false }],
  ['the desktop is not GNOME, whose bar may have its own tray', { gnome: false }],
  ['it is not Linux', { platform: 'darwin' }],
])('says nothing when %s', (_, options) => {
  const { context, shown } = load(options);
  context.announceHiddenWithoutTray();
  expect(shown).toHaveLength(0);
});

it('is said by the close handler that hides the window', () => {
  const handler = source.slice(source.indexOf("mainWindow.on('close', (e) => {"));
  const body = handler.slice(0, handler.indexOf('\n  });\n'));
  expect(body).toMatch(/mainWindow\.hide\(\);\s*announceHiddenWithoutTray\(\);/);
});
