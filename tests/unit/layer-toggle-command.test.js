/**
 * @jest-environment jsdom
 */
// On Sway, niri and river the desktop layer can only be raised by a key the user binds to the
// widget's --toggle command, and the command depends on how the widget was installed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { getToggleCommand } = require('../../src/linux-desktop.cjs');

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

  it('is the AppImage file itself, quoted, since nothing of it is on PATH', () => {
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
        env: { APPIMAGE: appImage, PATH },
        execPath: path.join(path.sep, 'tmp', '.mount_HA', 'home-assistant-widget'),
        isPackaged: true,
        realpath: realpathFrom({}),
      })
    ).toBe(`'${appImage}' --toggle`);
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
    const execPath = path.join(path.sep, 'home', 'u', 'linux-unpacked', 'home-assistant-widget');
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
    const execPath = path.join(path.sep, 'opt', 'x', 'home-assistant-widget');
    const run = (argv, isPackaged = true) =>
      getToggleCommand({
        argv,
        env: {},
        execPath,
        isPackaged,
        appPath: path.join(path.sep, 'repo'),
        realpath: realpathFrom({}),
      });
    expect(run(['widget', '--user-data-dir=/tmp/test profile'])).toBe(
      `${execPath} '--user-data-dir=/tmp/test profile' --toggle`
    );
    expect(run(['widget', '--user-data-dir', '/tmp/p'])).toBe(
      `${execPath} --user-data-dir /tmp/p --toggle`
    );
    // A run from source names the app folder, and --dev picks its own profile.
    expect(run(['electron', '.', '--dev'], false)).toBe(
      `${execPath} ${path.join(path.sep, 'repo')} --dev --toggle`
    );
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
