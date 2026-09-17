/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  APP_ID,
  getLaunchAction,
  hasIsolatedProfile,
  isHyprland,
  isPortalBindingRegistered,
  hyprlandBinding,
  LEGACY_PORTAL_APP_IDS,
  legacyPortalBindingNotice,
} = require('../../src/linux-desktop.cjs');
const {
  readHyprlandMonitors,
  chooseLayerMonitor,
  clampLayerPosition,
  readHyprlandCursor,
} = require('../../src/layer-placement.cjs');
const { parseOmarchyColors, createOmarchyThemeWatcher } = require('../../src/omarchy-theme.cjs');
const {
  ensureAppImageDesktopEntry,
  repairStaleAppImageLaunchers,
} = require('../../src/linux-desktop-entry.cjs');
const {
  syncLinuxAutostartExecutablePath,
  quoteDesktopExecArg,
  buildDesktopExecPrefix,
  parseDesktopExecCommand,
} = require('../../src/linux-startup.cjs');

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-omarchy-test-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test.each([
  ['--hide', 'hide'],
  ['--toggle', 'toggle'],
  ['--show', 'show'],
])('recognizes launch action %s', (arg, expected) => {
  expect(getLaunchAction(['widget', arg])).toBe(expected);
});
test('isolated profiles cannot adopt desktop startup settings', () => {
  expect(hasIsolatedProfile(['widget', '--user-data-dir=/tmp/profile'])).toBe(true);
  expect(hasIsolatedProfile(['widget', '--user-data-dir', '/tmp/profile'])).toBe(true);
  expect(hasIsolatedProfile(['widget', '--show'])).toBe(false);
});
test('Hyprland targets remain registered without a portal-assigned trigger', () => {
  expect(isHyprland({ XDG_CURRENT_DESKTOP: 'Hyprland:KDE' })).toBe(true);
  expect(isPortalBindingRegistered({ trigger: '', requiresCompositorBinding: true })).toBe(true);
  expect(isPortalBindingRegistered({ trigger: '' })).toBe(false);
  expect(hyprlandBinding('Control+Alt+H', 'popup-toggle')).toBe(
    `hl.bind("CTRL + ALT + H", hl.dsp.global("${APP_ID}:popup-toggle"))`
  );
});
test.each([
  ['Control+Alt+H', 'CTRL ALT, H'],
  ['Super+Shift+Space', 'SUPER SHIFT, space'],
  ['F8', ', F8'],
  ['Control+Plus', 'CTRL, plus'],
  ['Control+,', 'CTRL, comma'],
])('generates legacy Hyprland bindings for %s', (accelerator, fields) => {
  expect(hyprlandBinding(accelerator, 'popup-toggle', APP_ID, 'hyprlang')).toBe(
    `bind = ${fields}, global, ${APP_ID}:popup-toggle`
  );
});
test.each(['Control+H\nbind = , X, exec, bad', 'Control+$key', 'Control+H#comment'])(
  'refuses unsafe legacy key fields: %s',
  (accelerator) => {
    expect(hyprlandBinding(accelerator, 'popup-toggle', APP_ID, 'hyprlang')).toBe('');
  }
);
test('refuses legacy target injection', () => {
  expect(hyprlandBinding('Control+H', 'popup\nexec = bad', APP_ID, 'hyprlang')).toBe('');
});
test('names the retired portal app id and spells out its replacement', () => {
  expect(LEGACY_PORTAL_APP_IDS).toContain('ha_desktop_widget');
  expect(LEGACY_PORTAL_APP_IDS).not.toContain(APP_ID);
  const notice = legacyPortalBindingNotice({
    legacyAppId: 'ha_desktop_widget',
    id: 'popup-toggle',
    accelerator: 'Control+Shift+Z',
  });
  expect(notice).toContain('"ha_desktop_widget"');
  expect(notice).toContain(`"${APP_ID}:popup-toggle"`);
  expect(notice).toContain(`hl.bind("CTRL + SHIFT + Z", hl.dsp.global("${APP_ID}:popup-toggle"))`);
  expect(
    legacyPortalBindingNotice({ legacyAppId: 'ha_desktop_widget', id: 'popup-toggle' })
  ).not.toContain('hl.bind');
});
test('repairs a menu launcher an integration tool left pointing at a deleted AppImage', () => {
  const current = path.join(root, 'HA-Desktop-Widget-3.11.0-linux-x86_64.AppImage');
  fs.writeFileSync(current, 'app');
  const gone = path.join(root, 'HA-Desktop-Widget-3.10.0-linux-x86_64.AppImage');
  const env = { APPIMAGE: current, XDG_DATA_HOME: path.join(root, 'data') };
  const dir = path.join(env.XDG_DATA_HOME, 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, 'ha_desktop_widget.desktop');
  fs.writeFileSync(
    stale,
    `[Desktop Entry]\nType=Application\nName=HA Desktop Widget\nTryExec=${gone}\nExec=env DESKTOPINTEGRATION=1 "${gone}" --no-sandbox %U\nX-AppImage-Version=3.9.0-beta.1\nX-AppImage-Name=HA Desktop Widget\n`
  );
  // Hand-written entries and other apps are left alone; generated canonical entries are repaired.
  const custom = path.join(dir, 'ha-desktop-widget-custom.desktop');
  const customContent = `[Desktop Entry]\nName=HA Desktop Widget\nExec="${gone}" --show\n`;
  fs.writeFileSync(custom, customContent);
  const other = path.join(dir, 'home-assistant-widget-fork.desktop');
  const otherContent = `[Desktop Entry]\nName=Other Widget\nExec="${gone}"\nX-AppImage-Version=1.0\n`;
  fs.writeFileSync(other, otherContent);
  const own = path.join(dir, `${APP_ID}.desktop`);
  const ownContent = `[Desktop Entry]\nName=HA Desktop Widget\nExec="${gone}" --show\nX-AppImage-Version=3.10.0\nX-HA-Widget-Launcher=true\n`;
  fs.writeFileSync(own, ownContent);

  expect(repairStaleAppImageLaunchers({ env })).toEqual([own, stale]);
  const repaired = fs.readFileSync(stale, 'utf8');
  expect(repaired).toContain(`\nTryExec=${current}\n`);
  expect(repaired).toContain(`\nExec="${current}" --no-sandbox %U\n`);
  expect(repaired).toContain('\nX-AppImage-Version=3.9.0-beta.1\n');
  expect(fs.readFileSync(custom, 'utf8')).toBe(customContent);
  expect(fs.readFileSync(other, 'utf8')).toBe(otherContent);
  expect(fs.readFileSync(own, 'utf8')).toBe(ownContent.replace(gone, current));
  // A launcher that names a working installation is not adopted.
  expect(repairStaleAppImageLaunchers({ env })).toEqual([]);
  expect(repairStaleAppImageLaunchers({ env: { XDG_DATA_HOME: path.join(root, 'nope') } })).toEqual(
    []
  );
  expect(
    repairStaleAppImageLaunchers({ env: { ...env, XDG_DATA_HOME: path.join(root, 'nope') } })
  ).toEqual([]);
});
test('parses the env prefix AppImage integration tools write', () => {
  expect(
    parseDesktopExecCommand(
      'Exec=env DESKTOPINTEGRATION=1 "/opt/HA Widget.AppImage" --no-sandbox %U'
    )
  ).toEqual({
    executable: '/opt/HA Widget.AppImage',
    rawToken: 'env DESKTOPINTEGRATION=1 "/opt/HA Widget.AppImage"',
    suffix: ' --no-sandbox %U',
  });
});
test('monitor geometry accounts for scaling, rotation, and panel reservations', () => {
  const monitors = readHyprlandMonitors(() =>
    JSON.stringify([
      {
        name: 'DP-1',
        width: 3840,
        height: 2160,
        scale: 2,
        transform: 0,
        x: -1920,
        y: 0,
        reserved: [0, 30, 0, 0],
      },
      { name: 'DP-2', width: 1920, height: 1080, scale: 1, transform: 1, focused: true },
    ])
  );
  expect(monitors[0].workArea).toEqual({ x: 0, y: 30, width: 1920, height: 1050 });
  expect(monitors[1].width).toBe(1080);
  expect(monitors[1].height).toBe(1920);
  expect(chooseLayerMonitor(monitors, 'DP-1').name).toBe('DP-1');
  expect(chooseLayerMonitor(monitors, 'unplugged').name).toBe('DP-2');
  expect(clampLayerPosition({ x: 9000, y: -30 }, { width: 500, height: 600 }, monitors[0])).toEqual(
    { x: 1420, y: 30 }
  );
  expect(clampLayerPosition({ x: 50, y: 50 }, { width: 3000, height: 3000 }, monitors[0])).toEqual({
    x: 0,
    y: 30,
  });
});
test('invalid or unavailable compositor data is recoverable', async () => {
  expect(
    readHyprlandMonitors(() => {
      throw new Error('offline');
    })
  ).toEqual([]);
  expect(readHyprlandMonitors(() => 'invalid')).toEqual([]);
  expect(chooseLayerMonitor([], 'DP-1')).toBeUndefined();
  expect(await readHyprlandCursor((_a, _b, _c, done) => done(null, '{"x":-20,"y":50}'))).toEqual({
    x: -20,
    y: 50,
  });
  expect(await readHyprlandCursor((_a, _b, _c, done) => done(null, '{}'))).toBeNull();
});
const palette = 'background = "#112233"\nforeground = "#eeeeee"\naccent = "#0088ff"\n';
test('parses bounded theme data without executing TOML content', () => {
  expect(parseOmarchyColors(palette)).toMatchObject({ background: '#112233', mode: 'dark' });
  expect(parseOmarchyColors(palette + 'mode = "light"')).toMatchObject({ mode: 'light' });
  expect(parseOmarchyColors('background = "oops"')).toBeNull();
  expect(parseOmarchyColors('x'.repeat(65537))).toBeNull();
});
test('theme watcher follows atomic replacement and stops cleanly', async () => {
  const file = path.join(root, 'state/omarchy/current/theme/colors.toml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, palette);
  const onChange = jest.fn();
  const watcher = createOmarchyThemeWatcher({
    home: root,
    env: { XDG_STATE_HOME: path.join(root, 'state'), XDG_CONFIG_HOME: path.join(root, 'config') },
    onChange,
  });
  try {
    expect(watcher.get().accent).toBe('#0088ff');
    fs.writeFileSync(file + '.next', palette.replace('#0088ff', '#ff8800'));
    fs.renameSync(file + '.next', file);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect(watcher.get().accent).toBe('#ff8800');
    expect(onChange).toHaveBeenCalledTimes(2);
  } finally {
    watcher.stop();
  }
});
test('AppImage launcher supplies canonical portal identity and repairs only its obsolete path', () => {
  const icon = path.join(root, 'icon.png');
  fs.writeFileSync(icon, 'icon');
  const env = {
    APPIMAGE: path.join(root, 'first.AppImage'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_DATA_DIRS: path.join(root, 'system'),
  };
  fs.writeFileSync(env.APPIMAGE, 'app');
  expect(ensureAppImageDesktopEntry({ env, iconPath: icon })).toBe(true);
  const file = path.join(env.XDG_DATA_HOME, 'applications', `${APP_ID}.desktop`);
  expect(fs.readFileSync(file, 'utf8')).toContain(' --show');
  const next = { ...env, APPIMAGE: path.join(root, 'next.AppImage') };
  expect(ensureAppImageDesktopEntry({ env: next, iconPath: icon })).toBe(false);
  fs.unlinkSync(env.APPIMAGE);
  expect(ensureAppImageDesktopEntry({ env: next, iconPath: icon })).toBe(true);
  fs.writeFileSync(file, '[Desktop Entry]\nExec=/custom/widget\n');
  expect(ensureAppImageDesktopEntry({ env, iconPath: icon })).toBe(false);
});
test('an installed package supplies its desktop entry without user overrides', () => {
  const env = {
    APPIMAGE: path.join(root, 'app'),
    XDG_DATA_HOME: path.join(root, 'data'),
    // XDG lists use colons, so a Windows temporary drive path is not a valid fixture.
    XDG_DATA_DIRS: '/system-one:/system-two',
  };
  const entry = path.join('/system-two', 'applications', `${APP_ID}.desktop`);
  const fsModule = {
    existsSync: jest.fn((file) => file === entry),
    mkdirSync: jest.fn(),
    copyFileSync: jest.fn(),
    writeFileSync: jest.fn(),
  };
  expect(ensureAppImageDesktopEntry({ env, fsModule })).toBe(false);
  expect(fsModule.existsSync).toHaveBeenCalledWith(entry);
  expect(fsModule.writeFileSync).not.toHaveBeenCalled();
  expect(fsModule.copyFileSync).not.toHaveBeenCalled();
  expect(fs.existsSync(env.XDG_DATA_HOME)).toBe(false);
});
test('startup repair preserves a working installation and arguments on an obsolete one', () => {
  const old = path.join(root, 'old.AppImage');
  fs.writeFileSync(old, 'app');
  const env = { XDG_CONFIG_HOME: root };
  const pkg = { appId: APP_ID };
  const file = path.join(root, 'autostart', `${APP_ID}.desktop`);
  fs.mkdirSync(path.dirname(file));
  const content = `[Desktop Entry]\nExec=${quoteDesktopExecArg(old)} --hide\nOnlyShowIn=Hyprland;\nX-HA-Widget-Autostart=true\n`;
  fs.writeFileSync(file, content);
  const options = { pkg, env, executablePath: path.join(root, 'new.AppImage') };
  expect(syncLinuxAutostartExecutablePath(options).reason).toBe('existing-installation');
  expect(fs.readFileSync(file, 'utf8')).toBe(content);
  fs.unlinkSync(old);
  expect(syncLinuxAutostartExecutablePath(options).repaired).toBe(true);
  expect(fs.readFileSync(file, 'utf8')).toBe(
    content.replace(quoteDesktopExecArg(old), () => quoteDesktopExecArg(options.executablePath))
  );
});
test('desktop Exec escapes field codes and rejects line injection', () => {
  expect(quoteDesktopExecArg('/tmp/100% app')).toBe('"/tmp/100%% app"');
  expect(() => quoteDesktopExecArg('/tmp/app\nExec=other')).toThrow();
});

test.each(['/tmp/$app`name`', '/tmp/back\\slash', '/tmp/"quoted"', '/tmp/100% widget'])(
  'desktop Exec preserves special filename %s',
  (executable) => {
    const command = parseDesktopExecCommand(`Exec=${quoteDesktopExecArg(executable)} --hide`);
    expect(command.executable).toBe(executable);
    expect(command.suffix).toBe(' --hide');
  }
);

test('percent filenames use a fixed executable for desktop registry validation', () => {
  const prefix = buildDesktopExecPrefix('/tmp/100% widget');
  expect(prefix).toBe('/usr/bin/env "/tmp/100%% widget"');
  expect(parseDesktopExecCommand(`Exec=${prefix} --hide`)).toEqual({
    executable: '/tmp/100% widget',
    rawToken: prefix,
    suffix: ' --hide',
  });
});

test.each(['ha_desktop_widget.desktop', `${APP_ID}.desktop`])(
  'repairs generated unquoted launchers including the canonical id: %s',
  (name) => {
    const env = { APPIMAGE: path.join(root, 'current.AppImage'), XDG_DATA_HOME: root };
    const dir = path.join(root, 'applications');
    fs.mkdirSync(dir);
    const file = path.join(dir, name);
    fs.writeFileSync(
      file,
      `[Desktop Entry]\nName=HA Desktop Widget\nExec=/gone/widget.AppImage --show %U\nTryExec=/gone/widget.AppImage\nX-AppImage-Version=3.11\n`
    );
    expect(repairStaleAppImageLaunchers({ env })).toEqual([file]);
    expect(fs.readFileSync(file, 'utf8')).toContain(`Exec="${env.APPIMAGE}" --show %U`);
    expect(fs.readFileSync(file, 'utf8')).toContain(`TryExec=${env.APPIMAGE}`);
  }
);

test('an unwritable launcher does not prevent repairing the remaining launchers', () => {
  const env = { APPIMAGE: '/current.AppImage', XDG_DATA_HOME: root };
  const onError = jest.fn();
  const fsModule = {
    readdirSync: () => ['ha-desktop-widget-a.desktop', 'ha-desktop-widget-b.desktop'],
    readFileSync: () =>
      '[Desktop Entry]\nName=HA Desktop Widget\nExec=/gone.AppImage\nX-AppImage-Version=3.11\n',
    existsSync: () => false,
    writeFileSync: jest.fn().mockImplementationOnce(() => {
      throw new Error('read-only');
    }),
  };
  expect(repairStaleAppImageLaunchers({ env, fsModule, onError })).toEqual([
    path.join(root, 'applications/ha-desktop-widget-b.desktop'),
  ]);
  expect(onError).toHaveBeenCalledTimes(1);
});

test('repairing an owned launcher updates TryExec along with Exec', () => {
  const env = {
    APPIMAGE: path.join(root, 'current.AppImage'),
    XDG_DATA_HOME: root,
    XDG_DATA_DIRS: path.join(root, 'system'),
  };
  const dir = path.join(root, 'applications');
  fs.mkdirSync(dir);
  const file = path.join(dir, `${APP_ID}.desktop`);
  fs.writeFileSync(
    file,
    '[Desktop Entry]\nExec=/gone/widget.AppImage --show\nTryExec=/gone/widget.AppImage\nX-HA-Widget-Launcher=true\n'
  );
  expect(ensureAppImageDesktopEntry({ env })).toBe(true);
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain(`Exec="${env.APPIMAGE}" --show`);
  expect(content).toContain(`TryExec=${env.APPIMAGE}`);
});
