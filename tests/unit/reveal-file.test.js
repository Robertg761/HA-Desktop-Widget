const path = require('path');
const { revealFile } = require('../../src/reveal-file.cjs');

describe('showing a file in the file manager', () => {
  const file = path.join(path.sep, 'home', 'me', '.config', 'app', 'logs', 'main.log');

  const createShell = (openPathResult = '') => ({
    showItemInFolder: jest.fn(),
    openPath: jest.fn().mockResolvedValue(openPathResult),
  });

  it('selects the file in Windows Explorer and Finder', async () => {
    for (const platform of ['win32', 'darwin']) {
      const shell = createShell();

      await expect(revealFile(shell, file, platform)).resolves.toEqual({
        success: true,
        path: file,
      });

      expect(shell.showItemInFolder).toHaveBeenCalledWith(file);
      expect(shell.openPath).not.toHaveBeenCalled();
    }
  });

  it('opens the folder on Linux, where a missing file manager can be told', async () => {
    const shell = createShell();

    await expect(revealFile(shell, file, 'linux')).resolves.toEqual({ success: true, path: file });

    expect(shell.openPath).toHaveBeenCalledWith(path.dirname(file));
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reports that nothing opened, with the path, when there is no file manager', async () => {
    const shell = createShell('Failed to open path');

    await expect(revealFile(shell, file, 'linux')).resolves.toEqual({
      success: false,
      path: file,
      error: 'Failed to open path',
    });
  });
});
