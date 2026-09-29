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
  test('writes text from the main window to the system clipboard', () => {
    const { handler, writeText, authorizeIpcSender } = registerHandler();
    expect(handler({}, 'report')).toEqual({ success: true });
    expect(writeText).toHaveBeenCalledWith('report');
    // Desktop pins are not allowed to write the clipboard.
    expect(authorizeIpcSender).toHaveBeenCalledWith({}, 'write-clipboard-text');
  });

  test('rejects unauthorized senders without touching the clipboard', () => {
    const { handler, writeText } = registerHandler({ authorized: false });
    expect(handler({}, 'report')).toEqual({ success: false, error: 'Unauthorized' });
    expect(writeText).not.toHaveBeenCalled();
  });

  test.each([[null], [42], [{ toString: () => 'x' }], ['x'.repeat(256 * 1024 + 1)]])(
    'rejects non-string or oversized text',
    (text) => {
      const { handler, writeText } = registerHandler();
      expect(handler({}, text)).toEqual({ success: false, error: 'Invalid clipboard text' });
      expect(writeText).not.toHaveBeenCalled();
    }
  );

  test('reports a clipboard failure instead of throwing', () => {
    const writeText = jest.fn(() => {
      throw new Error('no clipboard');
    });
    const { handler } = registerHandler({ writeText });
    expect(handler({}, 'report')).toEqual({ success: false, error: 'no clipboard' });
  });
});
