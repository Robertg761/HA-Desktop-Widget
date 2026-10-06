/**
 * @jest-environment jsdom
 */
// On Sway, niri and river the desktop layer can only be raised by a key the user binds to the
// widget's --toggle command, and the command depends on how the widget was installed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  forgetInheritedAppImage,
  getAppImageCommandLink,
  getToggleCommand,
} = require('../../src/linux-desktop.cjs');
const {
  ensureAppImageCommandLink,
  getAppImageCommandLinkRecord,
} = require('../../src/linux-desktop-entry.cjs');
const { getRelaunchOptions, supportsAutoUpdater } = require('../../src/platform.cjs');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

describe('the command that toggles the widget', () => {
  const bin = path.join(path.sep, 'usr', 'bin');
  const localBin = path.join(path.sep, 'usr', 'local', 'bin');
  const PATH = [localBin, bin].join(path.delimiter);
  // A file system of symlinks: each name on PATH and where it leads.
  const realpathFrom = (links) => (file) => {
    if (Object.hasOwn(links, file)) return links[file];
    if (Object.values(links).includes(file)) return file;
    throw new Error('ENOENT');
  };

  it('is the AppImage file itself, quoted, when it has no link in ~/.local/bin', () => {
    const appImage = path.join(
      path.sep,
      'home',
      'u',
      'Apps',
      'HA Desktop Widget-4.0.0-linux-x64.AppImage'
    );
    expect(
      getToggleCommand({
        argv: ['widget'],
        env: { APPIMAGE: appImage, APPDIR: path.join(path.sep, 'tmp', '.mount_HA'), PATH },
        execPath: path.join(path.sep, 'tmp', '.mount_HA', 'home-assistant-widget'),
        isPackaged: true,
        realpath: realpathFrom({}),
      })
    ).toBe(`'${appImage}' --toggle`);
  });

  it("is not another AppImage's path, inherited by a widget started from inside it", () => {
    const execPath = path.join(path.sep, 'opt', 'HA Desktop Widget', 'home-assistant-widget');
    expect(
      getToggleCommand({
        argv: ['widget'],
        env: {
          APPIMAGE: path.join(path.sep, 'home', 'u', 'Apps', 'Editor.AppImage'),
          APPDIR: path.join(path.sep, 'tmp', '.mount_Editor'),
          PATH,
        },
        execPath,
        isPackaged: true,
        realpath: realpathFrom({ [path.join(bin, 'home-assistant-widget')]: execPath }),
      })
    ).toBe('home-assistant-widget --toggle');
  });

  it('is the name the .deb puts on PATH', () => {
    const execPath = path.join(path.sep, 'opt', 'HA Desktop Widget', 'home-assistant-widget');
    expect(
      getToggleCommand({
        argv: ['widget'],
        env: { PATH },
        execPath,
        isPackaged: true,
        realpath: realpathFrom({ [path.join(bin, 'home-assistant-widget')]: execPath }),
      })
    ).toBe('home-assistant-widget --toggle');
  });

  it('is the name the Arch package puts on PATH', () => {
    const execPath = path.join(path.sep, 'opt', 'ha-desktop-widget', 'home-assistant-widget');
    expect(
      getToggleCommand({
        argv: ['widget'],
        env: { PATH },
        execPath,
        isPackaged: true,
        realpath: realpathFrom({ [path.join(bin, 'ha-desktop-widget')]: execPath }),
      })
    ).toBe('ha-desktop-widget --toggle');
  });

  it('is the executable when the name on PATH leads to another copy, or there is none', () => {
    // Written the Linux way, as it is shown: a Windows path.join would add backslashes to quote.
    const execPath = '/home/u/linux-unpacked/home-assistant-widget';
    expect(
      getToggleCommand({
        argv: ['widget'],
        env: { PATH },
        execPath,
        isPackaged: true,
        realpath: realpathFrom({
          [path.join(bin, 'ha-desktop-widget')]: path.join(path.sep, 'opt', 'other'),
        }),
      })
    ).toBe(`${execPath} --toggle`);
  });

  it('keeps the profile this widget runs on, so the command reaches it', () => {
    const execPath = '/opt/x/home-assistant-widget';
    const run = (argv, isPackaged = true) =>
      getToggleCommand({
        argv,
        env: {},
        execPath,
        isPackaged,
        appPath: '/repo',
        realpath: realpathFrom({}),
      });
    expect(run(['widget', '--user-data-dir=/tmp/test profile'])).toBe(
      `${execPath} '--user-data-dir=/tmp/test profile' --toggle`
    );
    expect(run(['widget', '--isolated-profile'])).toBe(`${execPath} --toggle`);
    // A run from source names the app folder, and --dev picks its own profile.
    expect(run(['electron', '.', '--dev'], false)).toBe(`${execPath} /repo --dev --toggle`);
  });
});

// The AppImage's file name carries its version, and an update installs the next build under its
// own name and deletes the old file (electron-updater keeps the name only when it has no version).
// Written the Linux way: these are Linux paths whatever system runs the test.
describe("an AppImage's command, which outlasts its updates", () => {
  const home = '/home/u';
  const link = '/home/u/.local/bin/ha-desktop-widget';
  const v400 = '/home/u/Applications/HA Desktop Widget-4.0.0-linux-x64.AppImage';
  const v401 = '/home/u/Applications/HA Desktop Widget-4.0.1-linux-x64.AppImage';
  const record = '/home/u/.local/state/ha-desktop-widget/command-link.json';

  // A file system of files and symlinks, as far as the link and the command look at it.
  function fakeFs(entries = {}) {
    const nodes = new Map(Object.entries(entries));
    const missing = (file) => Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    const follow = (file) => {
      let at = file;
      while (nodes.get(at)?.link) at = nodes.get(at).link;
      return nodes.has(at) ? at : null;
    };
    return {
      nodes,
      lstatSync(file) {
        if (!nodes.has(file)) throw missing(file);
        return { isSymbolicLink: () => !!nodes.get(file).link };
      },
      readlinkSync(file) {
        if (!nodes.get(file)?.link) throw missing(file);
        return nodes.get(file).link;
      },
      existsSync: (file) => follow(file) !== null,
      realpathSync(file) {
        const at = follow(file);
        if (at === null) throw missing(file);
        return at;
      },
      mkdirSync: jest.fn(),
      readFileSync(file) {
        if (typeof nodes.get(file)?.content !== 'string') throw missing(file);
        return nodes.get(file).content;
      },
      writeFileSync(file, content) {
        nodes.set(file, { file: true, content: String(content) });
      },
      unlinkSync(file) {
        if (!nodes.delete(file)) throw missing(file);
      },
      symlinkSync: jest.fn((target, file) => {
        if (nodes.has(file)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
        nodes.set(file, { link: target });
      }),
    };
  }

  const PATH = ['/home/u/.local/bin', '/usr/local/bin', '/usr/bin'].join(':');
  const command = (fsModule, appImage) =>
    getToggleCommand({
      argv: ['widget'],
      env: { APPIMAGE: appImage, PATH },
      execPath: '/tmp/.mount_HA/home-assistant-widget',
      isPackaged: true,
      home,
      realpath: fsModule.realpathSync,
    });

  it('lives in ~/.local/bin under the Arch package’s name', () => {
    expect(getAppImageCommandLink(home)).toBe(link);
  });

  it('is noted where the widget keeps its state, which tells it from a link of the user’s', () => {
    expect(getAppImageCommandLinkRecord({ env: {}, home })).toBe(record);
    expect(getAppImageCommandLinkRecord({ env: { XDG_STATE_HOME: '/data/state' }, home })).toBe(
      '/data/state/ha-desktop-widget/command-link.json'
    );
    const fsModule = fakeFs({ [v400]: { file: true } });
    ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule });
    expect(JSON.parse(fsModule.readFileSync(record))).toEqual({ target: v400 });
  });

  it('is the same link before and after an update renames the AppImage', () => {
    const fsModule = fakeFs({ [v400]: { file: true } });
    // Without the link the command would be the versioned path, which the update deletes.
    expect(command(fsModule, v400)).toBe(`'${v400}' --toggle`);

    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule })).toBe(true);
    expect(fsModule.mkdirSync).toHaveBeenCalledWith('/home/u/.local/bin', { recursive: true });
    const bound = command(fsModule, v400);
    expect(bound).toBe(`${link} --toggle`);

    // The update: 4.0.1 under its own name, 4.0.0 deleted, and 4.0.1 starts.
    fsModule.nodes.delete(v400);
    fsModule.nodes.set(v401, { file: true });
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v401, PATH }, home, fsModule })).toBe(true);
    expect(fsModule.readlinkSync(link)).toBe(v401);
    expect(command(fsModule, v401)).toBe(bound);

    // Nothing to do once it already leads there.
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v401, PATH }, home, fsModule })).toBe(
      false
    );
    expect(fsModule.symlinkSync).toHaveBeenCalledTimes(2);
  });

  // Settings names a link that leads to the running AppImage, so its key must survive the update
  // even when the widget lost its note (its state folder was cleared) or the user made the link.
  it('takes a link that already leads to the AppImage as its own when it has no note', () => {
    const fsModule = fakeFs({ [v400]: { file: true }, [link]: { link: v400 } });
    const bound = command(fsModule, v400);
    expect(bound).toBe(`${link} --toggle`);
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule })).toBe(
      false
    );
    expect(JSON.parse(fsModule.readFileSync(record))).toEqual({ target: v400 });
    expect(fsModule.symlinkSync).not.toHaveBeenCalled();

    fsModule.nodes.delete(v400);
    fsModule.nodes.set(v401, { file: true });
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v401, PATH }, home, fsModule })).toBe(true);
    expect(fsModule.readlinkSync(link)).toBe(v401);
    expect(command(fsModule, v401)).toBe(bound);
  });

  // A note of another target means the user moved the widget's link here, so it stays theirs.
  it('leaves a link the user re-pointed at the running AppImage as the user’s', () => {
    const noted = JSON.stringify({ target: v401 });
    const fsModule = fakeFs({
      [v400]: { file: true },
      [link]: { link: v400 },
      [record]: { file: true, content: noted },
    });
    const before = new Map(fsModule.nodes);
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule })).toBe(
      false
    );
    expect(fsModule.nodes).toEqual(before);
  });

  it('follows the AppImage that ran last, when there are two', () => {
    const fsModule = fakeFs({ [v400]: { file: true }, [v401]: { file: true } });
    ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule });
    ensureAppImageCommandLink({ env: { APPIMAGE: v401, PATH }, home, fsModule });
    expect(fsModule.readlinkSync(link)).toBe(v401);
  });

  // The note and the link are two files, so a move can stop between them. The note used to name
  // the new AppImage before the link moved, and when the link could not move, every later start
  // took the mismatch for a link the user had moved and left it on the deleted file for good.
  describe('when moving the link stops part-way', () => {
    const v402 = '/home/u/Applications/HA Desktop Widget-4.0.2-linux-x64.AppImage';
    const run = (fsModule, appImage) =>
      ensureAppImageCommandLink({ env: { APPIMAGE: appImage, PATH }, home, fsModule });
    // The file system after an update: the widget's link on 4.0.0, which has gone, and 4.0.1.
    function afterUpdate() {
      const fsModule = fakeFs({ [v400]: { file: true } });
      run(fsModule, v400);
      fsModule.nodes.delete(v400);
      fsModule.nodes.set(v401, { file: true });
      return fsModule;
    }
    // Make the nth call of a file system method throw, as a read-only folder does, or as if the
    // widget had quit at that point.
    function failAt(fsModule, method, call, error) {
      const real = fsModule[method];
      let calls = 0;
      fsModule[method] = (...args) => {
        calls += 1;
        if (calls === call) throw error;
        return real(...args);
      };
      return () => {
        fsModule[method] = real;
      };
    }

    it.each([
      [
        'the old link cannot be removed: ~/.local/bin is read-only, or the widget quit first',
        'unlinkSync',
        1,
        'EROFS',
      ],
      ['the new link cannot be made after the old one was removed', 'symlinkSync', 1, 'EACCES'],
      ['the widget quits after the link moved, before its note says so', 'writeFileSync', 2, 'EIO'],
    ])('finishes the move at the next start when %s', (_, method, call, code) => {
      const fsModule = afterUpdate();
      const error = Object.assign(new Error(code), { code });
      const restore = failAt(fsModule, method, call, error);
      expect(() => run(fsModule, v401)).toThrow(error);
      restore();

      run(fsModule, v401);
      expect(fsModule.readlinkSync(link)).toBe(v401);
      expect(JSON.parse(fsModule.readFileSync(record))).toEqual({ target: v401 });
      // And it is still the widget's at the update after.
      fsModule.nodes.set(v402, { file: true });
      expect(run(fsModule, v402)).toBe(true);
      expect(fsModule.readlinkSync(link)).toBe(v402);
    });

    // Another start of the build the link still leads to settles the note there.
    it('keeps the link on the AppImage it still leads to when that one starts again', () => {
      const fsModule = fakeFs({ [v400]: { file: true }, [v401]: { file: true } });
      run(fsModule, v400);
      const restore = failAt(fsModule, 'unlinkSync', 1, new Error('EROFS'));
      expect(() => run(fsModule, v401)).toThrow('EROFS');
      restore();

      expect(run(fsModule, v400)).toBe(false);
      expect(fsModule.readlinkSync(link)).toBe(v400);
      expect(JSON.parse(fsModule.readFileSync(record))).toEqual({ target: v400 });
    });
  });

  it.each([
    ['a file of that name', { [link]: { file: true } }],
    [
      'a link the user pointed at something else',
      {
        [link]: { link: '/home/u/scripts/widget.sh' },
        '/home/u/scripts/widget.sh': { file: true },
      },
    ],
    ['the Arch package’s command, which the link would hide', { '/usr/bin/ha-desktop-widget': {} }],
    // An AppImage name does not make a link the widget's: only the one it noted is.
    [
      'a link the user pointed at another AppImage',
      {
        [link]: { link: '/home/u/Applications/Nightly.AppImage' },
        '/home/u/Applications/Nightly.AppImage': { file: true },
      },
    ],
    ['a link of the user’s whose file is gone', { [link]: { link: '/home/u/Old.AppImage' } }],
    [
      'a link the user pointed elsewhere after the widget made its own',
      {
        [link]: { link: '/home/u/Applications/Nightly.AppImage' },
        '/home/u/Applications/Nightly.AppImage': { file: true },
        [record]: { file: true, content: JSON.stringify({ target: v401 }) },
      },
    ],
    [
      'a link the user pointed elsewhere while a move of the widget’s own had stopped part-way',
      {
        [link]: { link: '/home/u/Applications/Nightly.AppImage' },
        '/home/u/Applications/Nightly.AppImage': { file: true },
        [record]: {
          file: true,
          content: JSON.stringify({ target: v401, previous: '/home/u/Applications/Old.AppImage' }),
        },
      },
    ],
  ])('leaves %s alone, and names the AppImage itself', (_, entries) => {
    const fsModule = fakeFs({ [v400]: { file: true }, ...entries });
    const before = new Map(fsModule.nodes);
    expect(ensureAppImageCommandLink({ env: { APPIMAGE: v400, PATH }, home, fsModule })).toBe(
      false
    );
    expect(fsModule.nodes).toEqual(before);
    expect(command(fsModule, v400)).toBe(`'${v400}' --toggle`);
  });

  it('does nothing outside an AppImage', () => {
    const fsModule = fakeFs();
    expect(ensureAppImageCommandLink({ env: { PATH }, home, fsModule })).toBe(false);
    expect(fsModule.symlinkSync).not.toHaveBeenCalled();
  });
});

// A widget started from inside another AppImage (a terminal or an editor packaged as one) inherits
// that app's APPIMAGE and APPDIR. Main drops them at startup, so nothing acts on the other app.
describe('an APPIMAGE inherited from another AppImage', () => {
  // System paths, as the rule compares them with the system's own path module.
  const widgetAppImage = path.join(path.sep, 'home', 'u', 'Apps', 'HA Desktop Widget.AppImage');
  const widgetMount = path.join(path.sep, 'tmp', '.mount_HA');
  const missing = () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const forget = (env, execPath, realpath = missing) =>
    forgetInheritedAppImage({ env, execPath, realpath });

  it("is this widget's own when it runs from the AppImage's mount, and is kept", () => {
    const env = { APPIMAGE: widgetAppImage, APPDIR: widgetMount };
    expect(forget(env, path.join(widgetMount, 'home-assistant-widget'))).toBe('');
    expect(env).toEqual({ APPIMAGE: widgetAppImage, APPDIR: widgetMount });
  });

  it('is kept for the same mount reached through a symlink, such as a linked TMPDIR', () => {
    const linkedMount = path.join(path.sep, 'home', 'u', 'tmp', '.mount_HA');
    const execPath = path.join(widgetMount, 'home-assistant-widget');
    const env = { APPIMAGE: widgetAppImage, APPDIR: linkedMount };
    const realpath = (file) => (file === linkedMount ? widgetMount : file);
    expect(forget(env, execPath, realpath)).toBe('');
    expect(env.APPIMAGE).toBe(widgetAppImage);
  });

  it('is kept when there is no APPDIR to check it against', () => {
    const env = { APPIMAGE: widgetAppImage };
    expect(forget(env, path.join(path.sep, 'opt', 'x', 'home-assistant-widget'))).toBe('');
    expect(env.APPIMAGE).toBe(widgetAppImage);
  });

  describe('is dropped, with its APPDIR, for a widget outside that mount', () => {
    const terminal = path.join(path.sep, 'home', 'u', 'Apps', 'Terminal.AppImage');
    const terminalMount = path.join(path.sep, 'tmp', '.mount_Term');
    const installed = path.join(path.sep, 'opt', 'HA Desktop Widget', 'home-assistant-widget');

    it.each([
      ['installed', terminalMount, installed, (file) => file],
      [
        'installed, after the terminal closed and its mount went away',
        terminalMount,
        installed,
        missing,
      ],
      [
        'in a folder whose name only starts like the mount',
        terminalMount,
        path.join(path.sep, 'tmp', '.mount_Term2', 'home-assistant-widget'),
        (file) => file,
      ],
    ])('%s', (_, appDir, execPath, realpath) => {
      const env = { APPIMAGE: terminal, APPDIR: appDir, PATH: '/usr/bin' };
      expect(forget(env, execPath, realpath)).toBe(terminal);
      expect(env).toEqual({ PATH: '/usr/bin' });
    });
  });

  it('leaves the other app alone: no command link, restart or AppImage update', () => {
    // Linux paths, as getAppImageCommandLink builds them whatever system runs the test.
    const env = {
      APPIMAGE: '/home/u/Apps/Terminal.AppImage',
      APPDIR: '/tmp/.mount_Term',
      PATH: '/usr/bin',
    };
    forget(env, '/opt/HA Desktop Widget/home-assistant-widget', (file) => file);

    const fsModule = {
      lstatSync: jest.fn(missing),
      readlinkSync: jest.fn(missing),
      existsSync: jest.fn(() => false),
      mkdirSync: jest.fn(),
      unlinkSync: jest.fn(),
      symlinkSync: jest.fn(),
    };
    expect(ensureAppImageCommandLink({ env, home: '/home/u', fsModule })).toBe(false);
    expect(fsModule.symlinkSync).not.toHaveBeenCalled();
    expect(getRelaunchOptions({ argv: ['widget'], env }).execPath).toBeUndefined();
    expect(supportsAutoUpdater('linux', env)).toBe(false);
  });

  it('is dropped in main before anything reads it', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const drop = main.indexOf('\nconst inheritedAppImage = forgetInheritedAppImage();\n');
    expect(drop).toBeGreaterThan(-1);
    // The desktop-layer handoff runs while main.js loads; the rest run later, but are listed so
    // that none of them moves above the drop.
    for (const reader of [
      'spawnLayerShellHelper()',
      'process.env.APPIMAGE',
      'ensureAppImageDesktopEntry(',
      'ensureAppImageCommandLink(',
      'repairStaleAppImageLaunchers(',
      'getLinuxStartupExecutablePath(app, process.env)',
      'getRelaunchOptions(',
      'supportsAutoUpdater(process.platform, process.env)',
    ]) {
      expect({ reader, afterTheDrop: main.indexOf(reader) > drop }).toEqual({
        reader,
        afterTheDrop: true,
      });
    }
  });
});

describe('the note under the popup hotkey in a desktop layer', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/settings.js'), 'utf8');
  const start = source.indexOf('function renderLayerModeGuidance()');
  const fn = source.slice(start, source.indexOf('\n}\n', start) + 3);
  const i18n = require('../../src/i18n.js');

  function render(info) {
    const context = vm.createContext({
      document,
      JSON,
      translateDocument: i18n.translateDocument,
      desktopIntegrationInfo: info,
    });
    vm.runInContext(fn, context);
    vm.runInContext('renderLayerModeGuidance()', context);
    return document.getElementById('layer-toggle-note');
  }

  beforeEach(() => {
    document.documentElement.innerHTML = fs.readFileSync(
      path.resolve(__dirname, '../../index.html'),
      'utf8'
    );
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
  });

  it('names the command for this installation, as code to copy', () => {
    const note = render({
      layerMode: true,
      hyprland: false,
      toggleCommand: 'home-assistant-widget --toggle',
    });

    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(
      'Bind a key in your window manager to run home-assistant-widget --toggle, which shows or hides the widget.'
    );
    expect(note.querySelector('code').textContent).toBe('home-assistant-widget --toggle');
  });

  // The window cannot be selected, so the command, a whole path on an AppImage, could only be
  // typed out by hand, and in Arabic it broke over two lines at the hyphen in its name.
  it('lets the command be selected, all of it at one click, on a line of its own', () => {
    const note = render({
      layerMode: true,
      hyprland: false,
      toggleCommand: '/home/u/.local/bin/ha-desktop-widget --toggle',
    });
    loadAppStylesheets(document);
    const code = note.querySelector('code');
    expect(resolvedValue(document.body, 'user-select')).toBe('none');
    expect(resolvedValue(code, 'user-select')).toBe('all');
    expect(resolvedValue(code, '-webkit-user-select')).toBe('all');
    expect(resolvedValue(code, 'display')).toBe('inline-block');
    expect(resolvedValue(code, 'max-width')).toBe('100%');
  });

  it('keeps the command when the language changes', () => {
    render({ layerMode: true, hyprland: false, toggleCommand: "'/a b/HA.AppImage' --toggle" });
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: {
        'Bind a key in your window manager to run <code>{{command}}</code>, which shows or hides the widget.':
          'Belege im Fenstermanager eine Taste mit <code>{{command}}</code>, das das Widget ein- oder ausblendet.',
      },
    });
    i18n.translateDocument(document);

    const note = document.getElementById('layer-toggle-note');
    expect(note.querySelector('code').textContent).toBe("'/a b/HA.AppImage' --toggle");
    expect(note.textContent.startsWith('Belege')).toBe(true);
  });

  it.each([
    [
      'on Hyprland, which lists its binds instead',
      { layerMode: true, hyprland: true, toggleCommand: 'ha-desktop-widget --toggle' },
    ],
    [
      'outside a desktop layer',
      { layerMode: false, hyprland: false, toggleCommand: 'ha-desktop-widget --toggle' },
    ],
    [
      'before main has said which command',
      { layerMode: true, hyprland: false, toggleCommand: null },
    ],
  ])('is hidden %s', (_, info) => {
    expect(render(info).hidden).toBe(true);
  });
});
