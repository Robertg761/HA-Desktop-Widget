/** @jest-environment node */
const { EventEmitter } = require('events');
const path = require('path');
const { PassThrough } = require('stream');
const {
  ANSWER_TIMEOUT_MS,
  leftWindowOnScreen,
  startDesktopKeeper,
} = require('../../scripts/visual-snapshots/desktop-keeper.cjs');

// On the Windows 11 runner a console asking for a WSL update opened minutes after the desktop was
// cleared, and every pin captured after it sat on that console. The run asks windows-desktop.ps1
// -Keep to clear the screen again before each capture.
describe('the desktop keeper of the Windows snapshot runs', () => {
  let child;
  let spawn;
  let written;
  let log;
  let warn;

  const fakeChild = () => {
    const fake = new EventEmitter();
    fake.stdin = new PassThrough();
    fake.stdout = new PassThrough();
    fake.kill = jest.fn();
    written = [];
    fake.stdin.on('data', (chunk) => written.push(String(chunk)));
    return fake;
  };
  const start = (options = {}) =>
    startDesktopKeeper({
      spawn,
      platform: 'win32',
      env: { SNAPSHOT_CLEAR_DESKTOP: '1' },
      log,
      warn,
      ...options,
    });
  // The keeper's lines, as windows-desktop.ps1 prints them.
  const answer = (...lines) => child.stdout.write(lines.map((line) => `${line}\n`).join(''));
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    child = fakeChild();
    spawn = jest.fn(() => child);
    log = jest.fn();
    warn = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs only on Windows, and only when the run asks for it', () => {
    expect(start({ platform: 'darwin' })).toBeNull();
    expect(start({ platform: 'linux' })).toBeNull();
    // It ends wsl.exe and minimizes every other window, which nobody wants on their own computer.
    expect(start({ env: {} })).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('starts the desktop script in its keep mode, without a window of its own', () => {
    start();
    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('pwsh');
    expect(args.slice(-2)).toEqual([
      path.resolve(__dirname, '../../scripts/visual-snapshots/windows-desktop.ps1'),
      '-Keep',
    ]);
    expect(options.windowsHide).toBe(true);
  });

  it('asks for a sweep around the app and hears what was cleared, up to done', async () => {
    const keeper = start();

    const swept = keeper.sweep(4242);
    await flush();
    expect(written.join('')).toBe('sweep 4242\n');
    answer(
      'stopped wsl (864)',
      'cleared WindowsTerminal (8828) CASCADIA_HOSTING_WINDOW_CLASS: C:\\Windows\\system32\\wsl.exe',
      'done'
    );

    const said = await swept;
    expect(said).toEqual([
      'stopped wsl (864)',
      'cleared WindowsTerminal (8828) CASCADIA_HOSTING_WINDOW_CLASS: C:\\Windows\\system32\\wsl.exe',
    ]);
    // Cleared in time, so the capture after it is clean.
    expect(leftWindowOnScreen(said)).toBe(false);
  });

  it('answers each sweep in turn, and an empty answer for a clear screen', async () => {
    const keeper = start();
    const first = keeper.sweep(1);
    const second = keeper.sweep(1);
    await flush();
    answer(
      'done',
      'left WindowsTerminal (8828) CASCADIA_HOSTING_WINDOW_CLASS at 44,52 1044x635: wsl',
      'done'
    );

    expect(await first).toEqual([]);
    const said = await second;
    expect(leftWindowOnScreen(said)).toBe(true);
  });

  it('counts a failed sweep as a capture to distrust', () => {
    expect(leftWindowOnScreen(['error Access is denied'])).toBe(true);
  });

  it('passes on what else the script prints, such as a warning for the run summary', async () => {
    start();
    answer('::warning title=Snapshot desktop::Could not list the windows on screen');
    await flush();
    expect(log).toHaveBeenCalledWith(
      '::warning title=Snapshot desktop::Could not list the windows on screen'
    );
  });

  it('lets the run go on without it when it stops answering', async () => {
    jest.useFakeTimers();
    const keeper = start();

    const swept = keeper.sweep(1);
    jest.advanceTimersByTime(ANSWER_TIMEOUT_MS);

    expect(await swept).toEqual([]);
    expect(child.kill).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/goes on without it/);
    // Later captures do not wait for it again.
    expect(await keeper.sweep(1)).toEqual([]);
    expect(written.join('')).toBe('sweep 1\n');
  });

  it('lets the run go on without it when PowerShell cannot be started', async () => {
    const keeper = start();
    child.emit('error', Object.assign(new Error('spawn pwsh ENOENT'), { code: 'ENOENT' }));

    expect(await keeper.sweep(1)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('spawn pwsh ENOENT');
  });

  it('ends quietly at the end of the run', () => {
    const keeper = start();
    const ended = jest.fn();
    child.stdin.on('finish', ended);

    keeper.close();
    child.emit('exit', 0);

    return flush().then(() => {
      expect(ended).toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
