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
  detectTilingLayerShellCompositor,
  isLayerShellChild,
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
  test('recognizes tiling wlr-layer-shell compositors by their session sockets', () => {
    expect(detectTilingLayerShellCompositor(hyprlandEnv)).toBe('hyprland');
    expect(detectTilingLayerShellCompositor({ SWAYSOCK: '/run/user/1000/sway.sock' })).toBe('sway');
    expect(detectTilingLayerShellCompositor({ NIRI_SOCKET: '/run/user/1000/niri.sock' })).toBe(
      'niri'
    );
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'river' })).toBe('river');
    expect(detectTilingLayerShellCompositor({ XDG_CURRENT_DESKTOP: 'Hyprland' })).toBe('hyprland');
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

describe('waitForLayerShellHelperReady', () => {
  const socketPath = '/run/user/1000/ha-widget-layer-shell-4242';

  test('returns true once the helper has bound its socket', () => {
    let polls = 0;
    const ready = waitForLayerShellHelperReady({ pid: 100 }, socketPath, {
      pollIntervalMs: 1,
      exists: () => (polls += 1) >= 3,
      signalProcess: () => {},
      now: () => 0,
    });
    expect(ready).toBe(true);
    expect(polls).toBe(3);
  });

  test('returns false when the helper died or never spawned', () => {
    // spawn() failed asynchronously: no pid was ever assigned.
    expect(
      waitForLayerShellHelperReady({ pid: undefined }, socketPath, {
        exists: () => false,
        now: () => 0,
      })
    ).toBe(false);
    // The helper exited (preflight refused, bad binary): signal 0 throws.
    expect(
      waitForLayerShellHelperReady({ pid: 100 }, socketPath, {
        exists: () => false,
        signalProcess: () => {
          throw new Error('ESRCH');
        },
        now: () => 0,
      })
    ).toBe(false);
  });

  test('returns false after the deadline and without a socket path', () => {
    let clock = 0;
    expect(
      waitForLayerShellHelperReady({ pid: 100 }, socketPath, {
        timeoutMs: 100,
        exists: () => false,
        signalProcess: () => {},
        now: () => (clock += 200),
      })
    ).toBe(false);
    expect(waitForLayerShellHelperReady({ pid: 100 }, null, { now: () => 0 })).toBe(false);
  });

  test('keeps polling through transient stat failures', () => {
    let polls = 0;
    const ready = waitForLayerShellHelperReady({ pid: 100 }, socketPath, {
      pollIntervalMs: 1,
      exists: () => {
        polls += 1;
        if (polls === 1) throw new Error('EACCES');
        return true;
      },
      signalProcess: () => {},
      now: () => 0,
    });
    expect(ready).toBe(true);
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

  test('reports where the helper will bind, for the readiness wait', () => {
    const plan = buildLayerShellSpawnPlan(basePlanInput);
    expect(plan.socketPath).toBe(path.join('/run/user/1000', layerShellSocketName(4242)));
    const noRuntimeDir = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: { WAYLAND_DISPLAY: 'wayland-1' },
    });
    expect(noRuntimeDir.socketPath).toBe(null);
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

    const fallback = buildLayerShellSpawnPlan({
      ...basePlanInput,
      env: {
        WAYLAND_DISPLAY: 'wayland-1',
        [LAYER_SHELL_ANCHOR_ENV]: 'diagonal',
        [LAYER_SHELL_MARGIN_ENV]: '-5',
        [LAYER_SHELL_LAYER_ENV]: 'overlay',
      },
    });
    expect(fallback.args).toContain('bottom,right');
    expect(fallback.args).toContain('20');
    expect(fallback.args).toContain('bottom');
    expect(fallback.args).not.toContain('overlay');
    expect(fallback.args).not.toContain('--output-name');
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
    expect(plan.args).toContain('100x4096');
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
