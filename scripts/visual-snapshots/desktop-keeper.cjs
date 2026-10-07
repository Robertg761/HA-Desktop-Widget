/**
 * Keeps a hosted Windows runner's desktop clear while the snapshots run. The workflow clears it
 * once before the run (windows-desktop.ps1), but the runner's own windows can open later: on the
 * Windows 11 image a console asking for a WSL update opened minutes after the desktop was cleared,
 * and every pin captured after that sat on it. A pin sits under every window, so a window over one
 * hides it outright.
 *
 * With SNAPSHOT_CLEAR_DESKTOP=1 on Windows, windows-desktop.ps1 -Keep runs beside the snapshots,
 * and before each screen capture it is asked to clear the screen: it ends wsl.exe and minimizes
 * every window but the app's, the desktop and the taskbar, then names what it cleared and anything
 * still on screen. A capture taken with a window left over the app is one to distrust, and the run
 * names those at its end. The keeper is best effort: if it cannot start or stops answering, the run
 * goes on without it, as before.
 *
 * The keeper answers each `sweep <app pid>` line with lines of its own and then `done`:
 *   stopped <process> (<pid>)              a process it ended (wsl.exe)
 *   cleared <process> (<pid>) <class>: <title>   a window it minimized
 *   left <process> (<pid>) <class> at <bounds>: <title>   a window still on screen after that
 *   error <message>                        the sweep failed
 * Anything else it prints (a warning about the window list) is passed on to the log.
 */

const path = require('path');
const readline = require('readline');

const SCRIPT = path.join(__dirname, 'windows-desktop.ps1');
// The first answer waits for the window list to compile; later ones take a fraction of a second.
const ANSWER_TIMEOUT_MS = 20000;
const ANSWER_LINE = /^(stopped|cleared|left|error) /;

/**
 * Start the keeper, or return null where it does not run (not Windows, or not asked for).
 * @param {Object} options
 * @param {Function} options.spawn - child_process.spawn.
 * @param {string} [options.platform] - process.platform.
 * @param {Object} [options.env] - process.env.
 * @param {(line: string) => void} [options.log]
 * @param {(line: string) => void} [options.warn]
 */
function startDesktopKeeper({
  spawn,
  platform = process.platform,
  env = process.env,
  log = console.log,
  warn = console.warn,
}) {
  if (platform !== 'win32' || env.SNAPSHOT_CLEAR_DESKTOP !== '1') return null;
  const child = spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', SCRIPT, '-Keep'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    windowsHide: true,
  });
  let stopped = false;
  let closing = false;
  let answer = [];
  const waiting = [];

  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    if (!closing) warn(`The desktop keeper stopped (${reason}); the run goes on without it.`);
    child.kill();
    while (waiting.length) waiting.shift()([]);
  };
  child.on('error', (error) => stop(error.message));
  child.on('exit', (code) => stop(`it exited with ${code}`));
  child.stdin.on('error', (error) => stop(error.message));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (line === 'done') {
      waiting.shift()?.(answer);
      answer = [];
    } else if (ANSWER_LINE.test(line)) {
      answer.push(line);
    } else {
      log(line);
    }
  });

  return {
    /** Clear the screen around the app with this process id; resolves with the keeper's lines. */
    sweep(appPid) {
      if (stopped) return Promise.resolve([]);
      return new Promise((resolve) => {
        const timer = setTimeout(() => stop('no answer'), ANSWER_TIMEOUT_MS);
        waiting.push((lines) => {
          clearTimeout(timer);
          resolve(lines);
        });
        child.stdin.write(`sweep ${Number(appPid) || 0}\n`);
      });
    },
    close() {
      closing = true;
      if (!stopped) child.stdin.end();
    },
  };
}

/** True when the keeper's answer says a window may still be over the app in the capture. */
function leftWindowOnScreen(lines) {
  return lines.some((line) => line.startsWith('left ') || line.startsWith('error '));
}

module.exports = { ANSWER_TIMEOUT_MS, leftWindowOnScreen, startDesktopKeeper };
