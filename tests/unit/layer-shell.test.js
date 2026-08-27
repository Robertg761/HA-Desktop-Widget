const path = require('path');
const {
  DEFAULT_WINDOW_SIZE,
  LAYER_SHELL_ANCHOR_ENV,
  LAYER_SHELL_CHILD_ENV,
  LAYER_SHELL_ENV_OVERRIDE,
  LAYER_SHELL_HELPER_PATH_ENV,
  LAYER_SHELL_LAYER_ENV,
  LAYER_SHELL_MARGIN_ENV,
  LAYER_SHELL_OUTPUT_ENV,
  LAYER_SHELL_UPSTREAM_DISPLAY_ENV,
  buildLayerShellSpawnPlan,
  createLayerShellRaiser,
  detectTilingLayerShellCompositor,
  getLayerShellControlSocketPath,
  isLayerShellChild,
  isProcessAlive,
  layerShellSocketName,
  materializeLayerShellHelper,
  readInitialLayerShellWindowSize,
  resolveLayerShellHelperPath,
  restoreLayerShellParentEnv,
  shouldRelaunchIntoLayerShell,
  waitForLayerShellHelperReady,
} = require('../../src/layer-shell.cjs');

const hyprlandEnv = { HYPRLAND_INSTANCE_SIGNATURE: 'abc123' };
// A live Wayland session: the handoff refuses to run without a display to proxy
// and a runtime dir for the helper's socket.
const hyprlandSessionEnv = {
  ...hyprlandEnv,
  WAYLAND_DISPLAY: 'wayland-1',
  XDG_RUNTIME_DIR: '/run/user/1000',
};

describe('layer-shell compositor detection', () => {
  const socketExists = { exists: () => true };

  test('recognizes tiling wlr-layer-shell compositors by their session sockets', () => {
    expect(detectTilingLayerShellCompositor(hyprlandEnv, socketExists)).toBe('hyprland');
    expect(
      detectTilingLayerShellCompositor({ SWAYSOCK: '/run/user/1000/sway.sock' }, socketExists)
    ).toBe('sway');
    expect(
      detectTilingLayerShellCompositor({ NIRI_SOCKET: '/run/user/1000/niri.sock' }, socketExists)
    ).toBe('niri');
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'river' })).toBe('river');
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'Hyprland' })).toBe('hyprland');
  });

  test('probes both Hyprland socket locations (XDG_RUNTIME_DIR and legacy /tmp)', () => {
    const probed = [];
    detectTilingLayerShellCompositor(
      { ...hyprlandEnv, XDG_RUNTIME_DIR: '/run/user/1000' },
      {
        exists: (candidate) => {
          probed.push(candidate);
          return false;
        },
      }
    );
    expect(probed).toEqual([
      path.join('/run/user/1000', 'hypr', 'abc123', '.socket.sock'),
      path.join('/tmp', 'hypr', 'abc123', '.socket.sock'),
    ]);
  });

  test('distrusts instance variables leaked into a foreign session (no live socket)', () => {
    // `systemctl --user import-environment` commonly carries HYPRLAND_INSTANCE_SIGNATURE
    // or SWAYSOCK into later sessions on another compositor; without the socket the
    // variable names, it proves nothing.
    const noSocket = { exists: () => false };
    expect(detectTilingLayerShellCompositor(hyprlandEnv, noSocket)).toBe(null);
    expect(
      detectTilingLayerShellCompositor({ SWAYSOCK: '/run/user/1000/sway.sock' }, noSocket)
    ).toBe(null);
    expect(
      detectTilingLayerShellCompositor({ NIRI_SOCKET: '/run/user/1000/niri.sock' }, noSocket)
    ).toBe(null);
    // A real session whose variables leaked AND whose desktop is a tiling one is
    // still caught by XDG_CURRENT_DESKTOP, which login sessions set afresh.
    expect(
      detectTilingLayerShellCompositor(
        { ...hyprlandEnv, XDG_CURRENT_DESKTOP: 'Hyprland' },
        noSocket
      )
    ).toBe('hyprland');
    // A probe that throws counts as "no socket", not as a crash.
    expect(
      detectTilingLayerShellCompositor(hyprlandEnv, {
        exists: () => {
          throw new Error('EACCES');
        },
      })
    ).toBe(null);
  });

  test('leaves stacking compositors on the existing window paths', () => {
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe(null);
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(null);
    expect(detectTilingLayerShellCompositor({})).toBe(null);
    expect(detectTilingLayerShellCompositor(undefined)).toBe(null);
  });
});

describe('shouldRelaunchIntoLayerShell', () => {
  const base = {
    platform: 'linux',
    waylandSession: true,
    env: hyprlandSessionEnv,
    argv: ['electron', '.'],
    // The detection's socket probe, satisfied: these tests exercise the policy
    // around detection, not detection itself.
    exists: () => true,
  };

  test('relaunches on a tiling Wayland compositor', () => {
    expect(shouldRelaunchIntoLayerShell(base)).toBe(true);
  });

  test('never relaunches off Linux or off Wayland', () => {
    expect(shouldRelaunchIntoLayerShell({ ...base, platform: 'win32' })).toBe(false);
    expect(shouldRelaunchIntoLayerShell({ ...base, platform: 'darwin' })).toBe(false);
    expect(shouldRelaunchIntoLayerShell({ ...base, waylandSession: false })).toBe(false);
  });

  test('the relaunched child does not hand off again', () => {
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...hyprlandSessionEnv, [LAYER_SHELL_CHILD_ENV]: '1' },
      })
    ).toBe(false);
  });

  test('smoke tests measure the process they launched, not a grandchild', () => {
    expect(shouldRelaunchIntoLayerShell({ ...base, argv: ['electron', '.', '--smoke-test'] })).toBe(
      false
    );
  });

  test('the isolated climate demo keeps its throwaway profile in this process', () => {
    expect(
      shouldRelaunchIntoLayerShell({ ...base, argv: ['electron', '.', '--demo-climate'] })
    ).toBe(false);
  });

  test('reuses a caller-provided detection result instead of detecting again', () => {
    let probes = 0;
    const spyExists = () => {
      probes += 1;
      return true;
    };
    expect(
      shouldRelaunchIntoLayerShell({ ...base, exists: spyExists, detectedCompositor: 'hyprland' })
    ).toBe(true);
    expect(
      shouldRelaunchIntoLayerShell({ ...base, exists: spyExists, detectedCompositor: null })
    ).toBe(false);
    expect(probes).toBe(0);
  });

  test('refuses without a display to proxy or a runtime dir to bind in, even when forced', () => {
    const noDisplay = { ...hyprlandSessionEnv };
    delete noDisplay.WAYLAND_DISPLAY;
    const noRuntimeDir = { ...hyprlandSessionEnv };
    delete noRuntimeDir.XDG_RUNTIME_DIR;
    expect(shouldRelaunchIntoLayerShell({ ...base, env: noDisplay })).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({ ...base, env: { ...noDisplay, WAYLAND_DISPLAY: '  ' } })
    ).toBe(false);
    expect(shouldRelaunchIntoLayerShell({ ...base, env: noRuntimeDir })).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...noDisplay, [LAYER_SHELL_ENV_OVERRIDE]: '1' },
      })
    ).toBe(false);
  });

  test('the env override forces the mode on or off regardless of detection', () => {
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...hyprlandSessionEnv, [LAYER_SHELL_ENV_OVERRIDE]: '0' },
      })
    ).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: {
          XDG_CURRENT_DESKTOP: 'KDE',
          WAYLAND_DISPLAY: 'wayland-0',
          XDG_RUNTIME_DIR: '/run/user/1000',
          [LAYER_SHELL_ENV_OVERRIDE]: '1',
        },
      })
    ).toBe(true);
  });

  test('respects an explicit X11 backend request, which cannot become a layer surface', () => {
    expect(
      shouldRelaunchIntoLayerShell({ ...base, argv: ['electron', '.', '--ozone-platform=x11'] })
    ).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({ ...base, argv: ['electron', '.', '--ozone-platform', 'x11'] })
    ).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({ ...base, argv: ['electron', '.', '--ozone-platform=wayland'] })
    ).toBe(true);
  });

  test('an X11 request via the hint argument or hint env variable also wins', () => {
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        argv: ['electron', '.', '--ozone-platform-hint=x11'],
      })
    ).toBe(false);
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...hyprlandSessionEnv, ELECTRON_OZONE_PLATFORM_HINT: 'x11' },
      })
    ).toBe(false);
    // The explicit argument outranks the hint variable, matching Chromium.
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...hyprlandSessionEnv, ELECTRON_OZONE_PLATFORM_HINT: 'x11' },
        argv: ['electron', '.', '--ozone-platform=wayland'],
      })
    ).toBe(true);
    expect(
      shouldRelaunchIntoLayerShell({
        ...base,
        env: { ...hyprlandSessionEnv, ELECTRON_OZONE_PLATFORM_HINT: 'auto' },
      })
    ).toBe(true);
  });
});

describe('resolveLayerShellHelperPath', () => {
  test('prefers the explicit override, then the packaged copy, then the dev build', () => {
    const everything = () => true;
    expect(
      resolveLayerShellHelperPath({
        env: { [LAYER_SHELL_HELPER_PATH_ENV]: '/opt/custom/windowtolayer' },
        isPackaged: true,
        resourcesPath: '/app/resources',
        appDir: '/app',
        exists: everything,
      })
    ).toBe('/opt/custom/windowtolayer');
    expect(
      resolveLayerShellHelperPath({
        env: {},
        isPackaged: true,
        resourcesPath: '/app/resources',
        appDir: '/app',
        exists: everything,
      })
    ).toBe(path.join('/app/resources', 'helpers', 'windowtolayer'));
    expect(
      resolveLayerShellHelperPath({
        env: {},
        isPackaged: false,
        resourcesPath: '/electron/resources',
        appDir: '/repo',
        exists: everything,
      })
    ).toBe(path.join('/repo', 'vendor', 'windowtolayer', 'target', 'release', 'windowtolayer'));
  });

  test('skips candidates that do not exist and returns null when none do', () => {
    expect(
      resolveLayerShellHelperPath({
        env: { [LAYER_SHELL_HELPER_PATH_ENV]: '/gone' },
        isPackaged: true,
        resourcesPath: '/app/resources',
        appDir: '/app',
        exists: (candidate) => candidate.startsWith('/app/resources'),
      })
    ).toBe(path.join('/app/resources', 'helpers', 'windowtolayer'));
    expect(
      resolveLayerShellHelperPath({
        env: {},
        isPackaged: false,
        appDir: '/repo',
        exists: () => false,
      })
    ).toBe(null);
    expect(
      resolveLayerShellHelperPath({
        env: {},
        isPackaged: false,
        appDir: '/repo',
        exists: () => {
          throw new Error('EACCES');
        },
      })
    ).toBe(null);
  });
});

describe('materializeLayerShellHelper', () => {
  const appImageEnv = { APPIMAGE: '/home/user/Widget.AppImage', APPDIR: '/tmp/.mount_widgetXYZ' };

  function fakeFs() {
    const calls = [];
    return {
      calls,
      deps: {
        copyFileSync: (from, to) => calls.push(['copy', from, to]),
        mkdirSync: (dir, opts) => calls.push(['mkdir', dir, opts]),
        chmodSync: (file, mode) => calls.push(['chmod', file, mode]),
        renameSync: (from, to) => calls.push(['rename', from, to]),
        // No previously materialized copy, so the size-skip check falls through.
        statSync: () => {
          throw new Error('ENOENT');
        },
        pid: 4242,
      },
    };
  }

  test('copies a helper inside the AppImage mount into the target dir', () => {
    const { calls, deps } = fakeFs();
    const result = materializeLayerShellHelper(
      '/tmp/.mount_widgetXYZ/resources/helpers/windowtolayer',
      {
        env: appImageEnv,
        targetDir: '/data/helpers',
        ...deps,
      }
    );
    expect(result).toBe(path.join('/data/helpers', 'windowtolayer'));
    // Staged under a temp name and renamed over, so a copy an older instance is
    // still executing is replaced instead of written through (ETXTBSY).
    const staging = path.join('/data/helpers', '.windowtolayer.4242');
    expect(calls).toEqual([
      ['mkdir', '/data/helpers', { recursive: true }],
      ['copy', '/tmp/.mount_widgetXYZ/resources/helpers/windowtolayer', staging],
      ['chmod', staging, 0o755],
      ['rename', staging, path.join('/data/helpers', 'windowtolayer')],
    ]);
  });

  test('skips the copy when an identical helper is already materialized', () => {
    const { calls, deps } = fakeFs();
    const target = path.join('/data/helpers', 'windowtolayer');
    const result = materializeLayerShellHelper(
      '/tmp/.mount_widgetXYZ/resources/helpers/windowtolayer',
      {
        env: appImageEnv,
        targetDir: '/data/helpers',
        ...deps,
        // Same size as the source: the existing copy is reused. (mtime cannot be
        // compared — copyFileSync stamps the copy time, not the source's.)
        statSync: () => ({ size: 1234 }),
      }
    );
    expect(result).toBe(target);
    expect(calls).toEqual([['mkdir', '/data/helpers', { recursive: true }]]);
  });

  test('re-copies when the materialized helper differs in size', () => {
    const { calls, deps } = fakeFs();
    const sizes = new Map([
      [path.join('/data/helpers', 'windowtolayer'), 1000],
      ['/tmp/.mount_widgetXYZ/resources/helpers/windowtolayer', 2000],
    ]);
    const result = materializeLayerShellHelper(
      '/tmp/.mount_widgetXYZ/resources/helpers/windowtolayer',
      {
        env: appImageEnv,
        targetDir: '/data/helpers',
        ...deps,
        statSync: (file) => ({ size: sizes.get(file) }),
      }
    );
    expect(result).toBe(path.join('/data/helpers', 'windowtolayer'));
    expect(calls.map(([op]) => op)).toEqual(['mkdir', 'copy', 'chmod', 'rename']);
  });

  test('recognizes the mount through APPDIR even without the .mount_ marker', () => {
    const { deps } = fakeFs();
    const result = materializeLayerShellHelper('/squashfs-root/helpers/windowtolayer', {
      env: { APPIMAGE: '/home/user/Widget.AppImage', APPDIR: '/squashfs-root' },
      targetDir: '/data/helpers',
      ...deps,
    });
    expect(result).toBe(path.join('/data/helpers', 'windowtolayer'));
  });

  test('leaves the helper alone outside an AppImage or outside the mount', () => {
    const { calls, deps } = fakeFs();
    expect(
      materializeLayerShellHelper('/usr/lib/widget/windowtolayer', {
        env: {},
        targetDir: '/data/helpers',
        ...deps,
      })
    ).toBe('/usr/lib/widget/windowtolayer');
    expect(
      materializeLayerShellHelper('/opt/custom/windowtolayer', {
        env: appImageEnv,
        targetDir: '/data/helpers',
        ...deps,
      })
    ).toBe('/opt/custom/windowtolayer');
    expect(
      materializeLayerShellHelper('/tmp/.mount_widgetXYZ/helpers/windowtolayer', {
        env: appImageEnv,
        targetDir: '',
        ...deps,
      })
    ).toBe('/tmp/.mount_widgetXYZ/helpers/windowtolayer');
    expect(calls).toEqual([]);
  });

  test('falls back to the original path and reports when the copy fails', () => {
    const errors = [];
    const result = materializeLayerShellHelper('/tmp/.mount_widgetXYZ/helpers/windowtolayer', {
      env: appImageEnv,
      targetDir: '/data/helpers',
      mkdirSync: () => {},
      copyFileSync: () => {
        throw new Error('ENOSPC');
      },
      onError: (error) => errors.push(error),
    });
    expect(result).toBe('/tmp/.mount_widgetXYZ/helpers/windowtolayer');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('ENOSPC');
  });
});

describe('isProcessAlive', () => {
  test('reads the process state from /proc, surviving parentheses in the name', () => {
    // Field 3 (state) follows the comm field; comm may itself contain ')'.
    const alive = isProcessAlive(100, {
      readFileSync: (file) => {
        expect(file).toBe('/proc/100/stat');
        return '100 (wt (evil) name) S 1 100 100 0 -1';
      },
    });
    expect(alive).toBe(true);
  });

  test('reports zombies, dead processes, and missing /proc entries as not alive', () => {
    // While this thread blocks in Atomics.wait, libuv cannot reap the exited
    // helper, so it stays a zombie — and kill(pid, 0) succeeds on zombies. The
    // /proc state is the only truthful liveness signal here.
    expect(isProcessAlive(100, { readFileSync: () => '100 (wt) Z 1 100' })).toBe(false);
    expect(isProcessAlive(100, { readFileSync: () => '100 (wt) X 1 100' })).toBe(false);
    expect(
      isProcessAlive(100, {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      })
    ).toBe(false);
  });
});

describe('waitForLayerShellHelperReady', () => {
  const readyPath = '/run/user/1000/ha-widget-layer-shell-4242.ready';

  test('returns true once the helper writes a marker carrying its own pid', () => {
    let polls = 0;
    const ready = waitForLayerShellHelperReady({ pid: 100 }, readyPath, {
      pollIntervalMs: 1,
      readFileSync: () => {
        polls += 1;
        if (polls < 3) throw new Error('ENOENT');
        return '100\n';
      },
      isAlive: () => true,
      now: () => 0,
    });
    expect(ready).toBe(true);
    expect(polls).toBe(3);
  });

  test('a stale marker from a previous instance does not count as ready', () => {
    // App-pid reuse can leave a marker (and socket) of the same name from an
    // older run; the content must match the helper we actually spawned.
    let clock = 0;
    expect(
      waitForLayerShellHelperReady({ pid: 100 }, readyPath, {
        timeoutMs: 100,
        readFileSync: () => '99887',
        isAlive: () => true,
        now: () => (clock += 200),
      })
    ).toBe(false);
  });

  test('returns false when the helper died or never spawned', () => {
    // spawn() failed asynchronously: no pid was ever assigned.
    expect(
      waitForLayerShellHelperReady({ pid: undefined }, readyPath, {
        now: () => 0,
      })
    ).toBe(false);
    // The helper exited (preflight refused, bad binary) before writing the marker.
    expect(
      waitForLayerShellHelperReady({ pid: 100 }, readyPath, {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
        isAlive: () => false,
        now: () => 0,
      })
    ).toBe(false);
  });

  test('returns false after the deadline and without a ready path', () => {
    let clock = 0;
    expect(
      waitForLayerShellHelperReady({ pid: 100 }, readyPath, {
        timeoutMs: 100,
        readFileSync: () => {
          throw new Error('ENOENT');
        },
        isAlive: () => true,
        now: () => (clock += 200),
      })
    ).toBe(false);
    expect(waitForLayerShellHelperReady({ pid: 100 }, null, { now: () => 0 })).toBe(false);
  });
});

describe('buildLayerShellSpawnPlan', () => {
  const basePlanInput = {
    helperPath: '/app/resources/helpers/windowtolayer',
    execPath: '/app/widget',
    argv: ['/app/widget', '--dev'],
    env: { WAYLAND_DISPLAY: 'wayland-1', XDG_RUNTIME_DIR: '/run/user/1000' },
    windowSize: { width: 424, height: 688 },
    pid: 4242,
  };

  test('wraps the app in the helper with bottom-layer anchored placement', () => {
    const plan = buildLayerShellSpawnPlan(basePlanInput);
    expect(plan.command).toBe('/app/resources/helpers/windowtolayer');
    expect(plan.args).toEqual([
      '--listen-socket',
      layerShellSocketName(4242),
      '--layer',
      'bottom',
      '--interactivity',
      'all',
      '--anchor',
      'bottom,right',
      '--size',
      '424x688',
      '--margin',
      '20',
      '--namespace',
      'ha-widget',
      '/app/widget',
      '--dev',
      '--ozone-platform=wayland',
    ]);
  });

  test('reports the socket and the pid-stamped ready marker the spawner polls', () => {
    const plan = buildLayerShellSpawnPlan(basePlanInput);
    expect(plan.socketPath).toBe(path.join('/run/user/1000', layerShellSocketName(4242)));
    expect(plan.readyPath).toBe(path.join('/run/user/1000', `${layerShellSocketName(4242)}.ready`));
    const noRuntimeDir = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: { WAYLAND_DISPLAY: 'wayland-1' },
    });
    expect(noRuntimeDir.socketPath).toBe(null);
    expect(noRuntimeDir.readyPath).toBe(null);
  });

  test('marks the child and preserves the real compositor socket for restarts', () => {
    const plan = buildLayerShellSpawnPlan(basePlanInput);
    expect(plan.env[LAYER_SHELL_CHILD_ENV]).toBe('1');
    expect(plan.env.WAYLAND_DISPLAY).toBe('wayland-1');
    expect(plan.env[LAYER_SHELL_UPSTREAM_DISPLAY_ENV]).toBe('wayland-1');

    // A restart from inside a child sees WAYLAND_DISPLAY pointing at the dying
    // helper's socket; the preserved upstream value must win.
    const restarted = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: {
        WAYLAND_DISPLAY: layerShellSocketName(4242),
        [LAYER_SHELL_CHILD_ENV]: '1',
        [LAYER_SHELL_UPSTREAM_DISPLAY_ENV]: 'wayland-1',
      },
      pid: 5555,
    });
    expect(restarted.env.WAYLAND_DISPLAY).toBe('wayland-1');
    expect(restarted.args).toContain(layerShellSocketName(5555));
  });

  test('does not duplicate an ozone argument the child already carries', () => {
    const plan = buildLayerShellSpawnPlan({
      ...basePlanInput,
      argv: ['/app/widget', '--ozone-platform=wayland'],
    });
    expect(plan.args.filter((arg) => arg === '--ozone-platform=wayland')).toHaveLength(1);
  });

  test('applies placement env overrides and falls back on invalid values', () => {
    const plan = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: {
        WAYLAND_DISPLAY: 'wayland-1',
        [LAYER_SHELL_ANCHOR_ENV]: 'TOP, left',
        [LAYER_SHELL_MARGIN_ENV]: '10,20,30,40',
        [LAYER_SHELL_OUTPUT_ENV]: 'DP-1',
        [LAYER_SHELL_LAYER_ENV]: 'background',
      },
    });
    expect(plan.args).toContain('top,left');
    expect(plan.args).toContain('10,20,30,40');
    expect(plan.args).toContain('--output-name');
    expect(plan.args).toContain('DP-1');
    expect(plan.args).toContain('background');

    const invalid = [];
    const fallback = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: {
        WAYLAND_DISPLAY: 'wayland-1',
        [LAYER_SHELL_ANCHOR_ENV]: 'diagonal',
        [LAYER_SHELL_MARGIN_ENV]: 'abc',
        [LAYER_SHELL_LAYER_ENV]: 'overlay',
      },
      onInvalidOverride: (name, raw, usedInstead) => invalid.push([name, raw, usedInstead]),
    });
    expect(fallback.args).toContain('bottom,right');
    expect(fallback.args).toContain('20');
    expect(fallback.args).toContain('bottom');
    expect(fallback.args).not.toContain('overlay');
    expect(fallback.args).not.toContain('--output-name');
    // Each discarded override is reported, so the spawner can log it: a silently
    // replaced override is indistinguishable from a broken one.
    expect(invalid).toEqual([
      [LAYER_SHELL_LAYER_ENV, 'overlay', 'bottom'],
      [LAYER_SHELL_ANCHOR_ENV, 'diagonal', 'bottom,right'],
      [LAYER_SHELL_MARGIN_ENV, 'abc', '20'],
    ]);
  });

  test('accepts negative margins, which bleed past the anchored edge', () => {
    const plan = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: { WAYLAND_DISPLAY: 'wayland-1', [LAYER_SHELL_MARGIN_ENV]: '-5,0,10,-20' },
    });
    expect(plan.args).toContain('-5,0,10,-20');
  });

  test('relaunches the AppImage itself, not the doomed FUSE-mounted binary', () => {
    // Inside an AppImage, execPath lives in a /tmp/.mount_* FUSE mount that vanishes
    // when this process exits; the helper must launch the AppImage so the runtime
    // creates a mount of its own.
    const plan = buildLayerShellSpawnPlan({
      ...basePlanInput,
      execPath: '/tmp/.mount_widgetXYZ/widget',
      argv: ['/tmp/.mount_widgetXYZ/widget', '--dev'],
      env: { WAYLAND_DISPLAY: 'wayland-1', APPIMAGE: '/home/user/Widget.AppImage' },
    });
    expect(plan.args).toContain('/home/user/Widget.AppImage');
    expect(plan.args).not.toContain('/tmp/.mount_widgetXYZ/widget');
    // The AppImage runtime forwards arguments to the inner binary unchanged.
    expect(plan.args.slice(plan.args.indexOf('/home/user/Widget.AppImage'))).toEqual([
      '/home/user/Widget.AppImage',
      '--dev',
      '--ozone-platform=wayland',
    ]);

    const blank = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: { WAYLAND_DISPLAY: 'wayland-1', APPIMAGE: '   ' },
    });
    expect(blank.args).toContain('/app/widget');
  });

  test('clamps the surface size to something a compositor will accept', () => {
    const plan = buildLayerShellSpawnPlan({
      ...basePlanInput,
      windowSize: { width: 8, height: 999999 },
    });
    expect(plan.args).toContain('100x16384');
    const defaulted = buildLayerShellSpawnPlan({ ...basePlanInput, windowSize: undefined });
    expect(defaulted.args).toContain(`${DEFAULT_WINDOW_SIZE.width}x${DEFAULT_WINDOW_SIZE.height}`);
  });
});

describe('readInitialLayerShellWindowSize', () => {
  test('reads the saved window size from config.json', () => {
    const readFileSync = (file) => {
      expect(file).toBe(path.join('/data', 'config.json'));
      return JSON.stringify({ windowSize: { width: 424, height: 688 } });
    };
    expect(readInitialLayerShellWindowSize('/data', { readFileSync })).toEqual({
      width: 424,
      height: 688,
    });
  });

  test('falls back to the default size on a missing or corrupt config', () => {
    expect(
      readInitialLayerShellWindowSize('/data', {
        readFileSync: () => {
          throw new Error('ENOENT');
        },
      })
    ).toEqual(DEFAULT_WINDOW_SIZE);
    expect(readInitialLayerShellWindowSize('/data', { readFileSync: () => 'not json' })).toEqual(
      DEFAULT_WINDOW_SIZE
    );
    expect(
      readInitialLayerShellWindowSize('/data', {
        readFileSync: () => JSON.stringify({ windowSize: { width: 'x', height: null } }),
      })
    ).toEqual(DEFAULT_WINDOW_SIZE);
  });
});

describe('isLayerShellChild', () => {
  test('only trusts the explicit child marker', () => {
    expect(isLayerShellChild({ [LAYER_SHELL_CHILD_ENV]: '1' })).toBe(true);
    expect(isLayerShellChild({ [LAYER_SHELL_CHILD_ENV]: '' })).toBe(false);
    expect(isLayerShellChild({})).toBe(false);
  });
});

describe('restoreLayerShellParentEnv', () => {
  test('undoes the child marker and reconnects WAYLAND_DISPLAY to the compositor', () => {
    const env = {
      WAYLAND_DISPLAY: layerShellSocketName(4242),
      [LAYER_SHELL_CHILD_ENV]: '1',
      [LAYER_SHELL_UPSTREAM_DISPLAY_ENV]: 'wayland-1',
      OTHER: 'kept',
    };
    expect(restoreLayerShellParentEnv(env)).toBe(env);
    expect(env).toEqual({ WAYLAND_DISPLAY: 'wayland-1', OTHER: 'kept' });
  });

  test('leaves WAYLAND_DISPLAY alone when no upstream value was preserved', () => {
    const env = { WAYLAND_DISPLAY: 'wayland-1', [LAYER_SHELL_CHILD_ENV]: '1' };
    restoreLayerShellParentEnv(env);
    expect(env).toEqual({ WAYLAND_DISPLAY: 'wayland-1' });
  });
});

describe('getLayerShellControlSocketPath', () => {
  const childEnv = {
    [LAYER_SHELL_CHILD_ENV]: '1',
    WAYLAND_DISPLAY: layerShellSocketName(4242),
    XDG_RUNTIME_DIR: '/run/user/1000',
  };

  test('derives the .ctl path next to the helper socket WAYLAND_DISPLAY names', () => {
    expect(getLayerShellControlSocketPath(childEnv)).toBe(
      path.join('/run/user/1000', `${layerShellSocketName(4242)}.ctl`)
    );
  });

  test('handles an absolute WAYLAND_DISPLAY without consulting XDG_RUNTIME_DIR', () => {
    expect(
      getLayerShellControlSocketPath({
        [LAYER_SHELL_CHILD_ENV]: '1',
        WAYLAND_DISPLAY: '/run/user/1000/custom-socket',
      })
    ).toBe('/run/user/1000/custom-socket.ctl');
  });

  test('returns null outside a layer-shell child or without the needed variables', () => {
    expect(getLayerShellControlSocketPath({ ...childEnv, [LAYER_SHELL_CHILD_ENV]: '' })).toBeNull();
    expect(getLayerShellControlSocketPath({ ...childEnv, WAYLAND_DISPLAY: ' ' })).toBeNull();
    expect(getLayerShellControlSocketPath({ ...childEnv, XDG_RUNTIME_DIR: '' })).toBeNull();
    expect(getLayerShellControlSocketPath({})).toBeNull();
  });
});

describe('createLayerShellRaiser', () => {
  function createConnectMock() {
    const sockets = [];
    const connect = jest.fn((options) => {
      const socket = {
        options,
        end: jest.fn(),
        on: jest.fn(),
        setTimeout: jest.fn(),
        destroy: jest.fn(),
      };
      sockets.push(socket);
      return socket;
    });
    return { connect, sockets };
  }

  test('returns null without a control socket path so callers can skip wiring it', () => {
    expect(createLayerShellRaiser({ controlSocketPath: null })).toBeNull();
    expect(createLayerShellRaiser({})).toBeNull();
  });

  test('sends one line command per connection to the control socket', () => {
    const { connect, sockets } = createConnectMock();
    const raiser = createLayerShellRaiser({
      controlSocketPath: '/run/user/1000/sock.ctl',
      connect,
      log: { debug: jest.fn() },
    });

    raiser.raise();
    raiser.restore();

    expect(connect).toHaveBeenCalledTimes(2);
    expect(sockets[0].options).toEqual({ path: '/run/user/1000/sock.ctl' });
    expect(sockets[0].end).toHaveBeenCalledWith('raise\n');
    expect(sockets[1].end).toHaveBeenCalledWith('restore\n');
  });

  test('a dead helper degrades to a logged no-op instead of an exception', () => {
    const log = { debug: jest.fn() };
    const raiser = createLayerShellRaiser({
      controlSocketPath: '/run/user/1000/sock.ctl',
      connect: () => {
        throw new Error('ECONNREFUSED');
      },
      log,
    });
    expect(() => raiser.raise()).not.toThrow();
    expect(log.debug).toHaveBeenCalled();

    // Async failure path: the error listener registered on the socket must
    // swallow the error (an unhandled 'error' event would crash the process).
    const { connect, sockets } = createConnectMock();
    const asyncRaiser = createLayerShellRaiser({
      controlSocketPath: '/run/user/1000/sock.ctl',
      connect,
      log,
    });
    asyncRaiser.restore();
    const errorHandler = sockets[0].on.mock.calls.find(([event]) => event === 'error')?.[1];
    expect(typeof errorHandler).toBe('function');
    expect(() => errorHandler(new Error('EPIPE'))).not.toThrow();
  });
});
