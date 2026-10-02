/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

// The title bar's X must mean what Alt+F4 and Cmd+W mean: close the window, which the window's
// close handler turns into hiding it to the tray, rather than quitting the app.
describe('title bar close button', () => {
  function loadHandler({ mainWindow, authorized = true } = {}) {
    const start = mainSource.indexOf("ipcMain.handle('close-window'");
    const source = mainSource.slice(start, mainSource.indexOf('\n});\n', start) + 4);
    const app = { quit: jest.fn() };
    const context = vm.createContext({
      ipcMain: { handle: jest.fn() },
      authorizeIpcSender: jest.fn(() => (authorized ? { type: 'main' } : null)),
      rejectUnauthorizedIpc: jest.fn(() => ({ success: false })),
      mainWindow,
      app,
      isQuitting: false,
    });
    vm.runInContext(source, context);
    const handler = context.ipcMain.handle.mock.calls[0][1];
    return { handler, app, context };
  }

  it('closes the main window and leaves the app running', () => {
    const mainWindow = { isDestroyed: () => false, close: jest.fn() };
    const { handler, app, context } = loadHandler({ mainWindow });

    handler({});

    expect(mainWindow.close).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
    // The close handler only hides the window while this is false.
    expect(vm.runInContext('isQuitting', context)).toBe(false);
  });

  it('does nothing without a main window to close', () => {
    expect(() => loadHandler({ mainWindow: null }).handler({})).not.toThrow();
    const destroyed = { isDestroyed: () => true, close: jest.fn() };
    loadHandler({ mainWindow: destroyed }).handler({});
    expect(destroyed.close).not.toHaveBeenCalled();
  });

  it('ignores a sender that is not the main window', () => {
    const mainWindow = { isDestroyed: () => false, close: jest.fn() };
    const { handler } = loadHandler({ mainWindow, authorized: false });

    expect(handler({})).toEqual({ success: false });
    expect(mainWindow.close).not.toHaveBeenCalled();
  });

  it('is labelled Hide, not Quit, since it hides the widget instead of quitting', () => {
    const start = indexHtml.indexOf('id="close-btn"');
    const button = indexHtml.slice(start, indexHtml.indexOf('>', start));

    expect(button).toContain('title="Hide"');
    expect(button).toContain('aria-label="Hide"');
    expect(button).toContain('data-i18n-title="Hide"');
    expect(button).toContain('data-i18n-aria-label="Hide"');
    expect(button).not.toContain('Quit');
  });
});
