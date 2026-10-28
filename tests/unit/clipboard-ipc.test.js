/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function registerHandler({ authorized = true, writeText = jest.fn() } = {}) {
  let handler;
  const start = mainSource.indexOf('const MAX_CLIPBOARD_TEXT_LENGTH');
  const end = mainSource.indexOf("ipcMain.handle('debug-log'", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const authorizeIpcSender = jest.fn(() => (authorized ? { type: 'main' } : null));
  vm.runInNewContext(mainSource.slice(start, end), {
    ipcMain: { handle: (_channel, callback) => (handler = callback) },
    authorizeIpcSender,
    rejectUnauthorizedIpc: () => ({ success: false, error: 'Unauthorized' }),
    clipboard: { writeText },
  });
  return { handler, writeText, authorizeIpcSender };
}

describe('write-clipboard-text IPC', () => {
  test('writes text from the main window to the system clipboard', async () => {
    const { handler, writeText, authorizeIpcSender } = registerHandler();
    await expect(handler({}, 'report')).resolves.toEqual({ success: true });
    expect(writeText).toHaveBeenCalledWith('report');
    // Desktop pins are not allowed to write the clipboard.
    expect(authorizeIpcSender).toHaveBeenCalledWith({}, 'write-clipboard-text');
  });

  test('rejects unauthorized senders without touching the clipboard', async () => {
    const { handler, writeText } = registerHandler({ authorized: false });
    await expect(handler({}, 'report')).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(writeText).not.toHaveBeenCalled();
  });

  test.each([[null], [42], [{ toString: () => 'x' }], ['x'.repeat(256 * 1024 + 1)]])(
    'rejects non-string or oversized text',
    async (text) => {
      const { handler, writeText } = registerHandler();
      await expect(handler({}, text)).resolves.toEqual({
        success: false,
        error: 'Invalid clipboard text',
      });
      expect(writeText).not.toHaveBeenCalled();
    }
  );

  test('reports a clipboard failure instead of throwing', async () => {
    const writeText = jest.fn(() => {
      throw new Error('no clipboard');
    });
    const { handler } = registerHandler({ writeText });
    await expect(handler({}, 'report')).resolves.toEqual({
      success: false,
      error: 'no clipboard',
    });
  });

  test('reports a rejected clipboard write', async () => {
    const writeText = jest.fn(() => Promise.reject(new Error('clipboard busy')));
    const { handler } = registerHandler({ writeText });
    await expect(handler({}, 'report')).resolves.toEqual({
      success: false,
      error: 'clipboard busy',
    });
  });
});
