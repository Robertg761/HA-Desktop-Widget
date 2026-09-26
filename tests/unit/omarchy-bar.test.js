/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  OMARCHY_BAR_PLUGIN_ID,
  PLUGIN_FILES,
  buildOmarchyBarStatus,
  createOmarchyBarPublisher,
  describeOmarchyBarEntity,
  getEntityToggleRequest,
  getOmarchyBarPaths,
  installOmarchyBarPluginFiles,
  updateInstalledOmarchyBarPlugin,
  isAllowedOmarchyBarToggle,
  isOmarchyShellInstalled,
  readOmarchyBarEntry,
  rememberOmarchyBarLaunch,
  resolveOmarchyBarEntities,
} = require('../../src/omarchy-bar.cjs');
const { appId } = require('../../package.json');

const pluginDir = path.resolve(__dirname, '../../omarchy-plugin');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-omarchy-bar-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Omarchy bar plugin package', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));

  // The same checks as Omarchy's omarchy-plugin-validate.
  it('passes omarchy plugin validate', () => {
    expect(manifest.schemaVersion).toBe(1);
    ['id', 'name', 'version', 'kinds', 'entryPoints'].forEach((key) =>
      expect(manifest[key]).toBeTruthy()
    );
    expect(manifest.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(manifest.id).not.toMatch(/^omarchy\./);
    expect(manifest.id).not.toContain('..');
    expect(manifest.kinds).toEqual(['bar-widget']);
    expect(['left', 'center', 'right']).toContain(manifest.barWidget.defaultSection);
    for (const entry of Object.values(manifest.entryPoints)) {
      expect(entry).not.toMatch(/^\/|\.\.|\n/);
      expect(fs.existsSync(path.join(pluginDir, entry))).toBe(true);
    }
    for (const file of fs.readdirSync(pluginDir)) {
      expect(fs.lstatSync(path.join(pluginDir, file)).isSymbolicLink()).toBe(false);
    }
    expect(PLUGIN_FILES).toEqual(expect.arrayContaining(['manifest.json', 'Widget.qml']));
  });

  it('uses the app id for the plugin, its module name, and its status file', () => {
    expect(manifest.id).toBe(appId);
    expect(OMARCHY_BAR_PLUGIN_ID).toBe(appId);
    const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
    expect(qml).toContain(`moduleName: "${appId}"`);
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar.json"');
    // Actions go through the widget's command line, which main handles.
    expect(qml).toContain('launch(["--toggle"])');
    expect(qml).toContain('"--entity-toggle=" + entityId');
    // It reads the fields buildOmarchyBarStatus writes.
    expect(qml).toContain('parsed.version === 1');
    // The launch command it keeps for a widget that has quit.
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar-launch.json"');
    expect(qml).toContain('parsed.launch');
    ['updatedAt', 'connection', 'launch', 'panel', 'bar'].forEach((field) =>
      expect(qml).toContain(`status.${field}`)
    );
  });
});

describe('Omarchy bar settings in shell.json', () => {
  it('finds the widget entry and its inline settings in any section', () => {
    const shellJson = JSON.stringify({
      version: 1,
      bar: {
        layout: {
          left: ['omarchy.workspaces'],
          right: [
            { id: 'omarchy.tray' },
            {
              id: appId,
              entities: ['light.office', 'Sensor.Temp', 'not an id', 'light.office'],
              barEntities: ['sensor.temp'],
            },
          ],
        },
      },
    });
    expect(readOmarchyBarEntry(shellJson)).toEqual({
      present: true,
      entities: ['light.office', 'sensor.temp'],
      barEntities: ['sensor.temp'],
    });
    expect(readOmarchyBarEntry(JSON.stringify({ bar: { layout: { center: [appId] } } }))).toEqual({
      present: true,
      entities: null,
      barEntities: null,
    });
    expect(readOmarchyBarEntry('{ broken').present).toBe(false);
    expect(readOmarchyBarEntry('{}').present).toBe(false);
  });

  it('lists Quick Access favorites until entities are chosen', () => {
    const favorites = Array.from({ length: 20 }, (_, index) => `light.l${index}`);
    const byDefault = resolveOmarchyBarEntities(
      { present: true, entities: null, barEntities: null },
      favorites
    );
    expect(byDefault.panel).toHaveLength(12);
    expect(byDefault.bar).toEqual([]);
    const chosen = resolveOmarchyBarEntities(
      { present: true, entities: ['switch.fan'], barEntities: ['sensor.temp'] },
      favorites
    );
    expect(chosen).toEqual({
      panel: ['switch.fan'],
      bar: ['sensor.temp'],
      all: ['sensor.temp', 'switch.fan'],
    });
  });
});

describe('Omarchy bar status', () => {
  it('describes values, names and what can be toggled', () => {
    expect(
      describeOmarchyBarEntity('sensor.temp', {
        state: '21.5',
        attributes: { friendly_name: 'Office', unit_of_measurement: '°C' },
      })
    ).toMatchObject({ name: 'Office', value: '21.5 °C', toggleable: false, available: true });
    expect(
      describeOmarchyBarEntity('light.desk', { state: 'on', attributes: {} }, 'Desk lamp')
    ).toMatchObject({ name: 'Desk lamp', value: 'On', active: true, toggleable: true });
    expect(
      describeOmarchyBarEntity('switch.gone', { state: 'unavailable', attributes: {} })
    ).toMatchObject({ available: false, toggleable: false });
    expect(describeOmarchyBarEntity('light.missing', undefined)).toMatchObject({
      name: 'light.missing',
      value: '',
      toggleable: false,
    });
  });

  it('builds the file the plugin reads', () => {
    const status = buildOmarchyBarStatus({
      connection: 'connected',
      states: new Map([['light.desk', { state: 'off', attributes: {} }]]),
      entities: { panel: ['light.desk'], bar: [] },
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      now: 42,
    });
    expect(status).toMatchObject({
      version: 1,
      updatedAt: 42,
      connection: 'connected',
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      bar: [],
    });
    expect(status.panel[0]).toMatchObject({ id: 'light.desk', value: 'Off' });
    expect(buildOmarchyBarStatus({ launch: [] }).launch).toBeNull();
  });

  it('writes the status privately, refreshes it, and removes it on stop', () => {
    jest.useFakeTimers();
    try {
      const statusFile = path.join(root, 'run', 'ha-desktop-widget', 'omarchy-bar.json');
      let connection = 'connecting';
      const publisher = createOmarchyBarPublisher({
        statusFile,
        getStatus: () => ({ connection }),
        heartbeatMs: 60000,
      });
      expect(JSON.parse(fs.readFileSync(statusFile, 'utf8'))).toEqual({ connection: 'connecting' });
      if (process.platform !== 'win32') {
        expect(fs.statSync(statusFile).mode & 0o777).toBe(0o600);
      }
      connection = 'connected';
      publisher.update();
      publisher.update();
      jest.advanceTimersByTime(300);
      expect(JSON.parse(fs.readFileSync(statusFile, 'utf8'))).toEqual({ connection: 'connected' });
      publisher.stop();
      expect(fs.existsSync(statusFile)).toBe(false);
      expect(createOmarchyBarPublisher({ statusFile: '', getStatus: () => ({}) })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('bar requests and installation', () => {
  it('reads --entity-toggle and allows only shown, toggleable entities', () => {
    expect(getEntityToggleRequest(['widget', '--entity-toggle=Light.Desk'])).toBe('light.desk');
    expect(getEntityToggleRequest(['widget', '--entity-toggle', 'switch.fan'])).toBe('switch.fan');
    expect(getEntityToggleRequest(['widget', '--entity-toggle=rm -rf'])).toBe('');
    expect(getEntityToggleRequest(['widget', '--toggle'])).toBe('');
    const entities = { all: ['light.desk', 'lock.front', 'sensor.temp'] };
    expect(isAllowedOmarchyBarToggle('light.desk', entities)).toBe(true);
    expect(isAllowedOmarchyBarToggle('lock.front', entities)).toBe(false);
    expect(isAllowedOmarchyBarToggle('sensor.temp', entities)).toBe(false);
    expect(isAllowedOmarchyBarToggle('light.kitchen', entities)).toBe(false);
  });

  it('finds Omarchy 4 and the paths it uses', () => {
    expect(
      isOmarchyShellInstalled({
        env: { OMARCHY_PATH: '/opt/omarchy' },
        exists: (file) => file === path.join('/opt/omarchy', 'shell', 'shell.qml'),
      })
    ).toBe(true);
    expect(isOmarchyShellInstalled({ env: {}, exists: () => false })).toBe(false);
    expect(
      getOmarchyBarPaths({ env: { XDG_RUNTIME_DIR: '/run/user/1000' }, home: '/home/me' })
    ).toEqual({
      shellConfig: path.join('/home/me', '.config', 'omarchy', 'shell.json'),
      pluginDir: path.join('/home/me', '.config', 'omarchy', 'plugins', appId),
      statusFile: path.join('/run/user/1000', 'ha-desktop-widget', 'omarchy-bar.json'),
      launchFile: path.join(
        '/home/me',
        '.local',
        'state',
        'ha-desktop-widget',
        'omarchy-bar-launch.json'
      ),
    });
    expect(getOmarchyBarPaths({ env: {}, home: '/home/me' }).statusFile).toBe('');
  });

  it('copies the bundled plugin into the Omarchy plugins directory', () => {
    const target = path.join(root, 'plugins', appId);
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    expect(fs.readdirSync(target).sort()).toEqual([...PLUGIN_FILES].sort());
  });

  it('updates an installed copy only when the bundled version differs', () => {
    const target = path.join(root, 'plugins', appId);
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
    const manifestPath = path.join(target, 'manifest.json');
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...old, version: '0.0.1' }));
    fs.writeFileSync(path.join(target, 'Widget.qml'), 'old');
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(true);
    expect(fs.readFileSync(path.join(target, 'Widget.qml'), 'utf8')).toBe(
      fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8')
    );
    // Another plugin in that directory is never overwritten.
    fs.writeFileSync(manifestPath, JSON.stringify({ id: 'someone.else', version: '9' }));
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
  });

  it('keeps the launch command after the widget quits, rewriting it only when it changes', () => {
    const launchFile = path.join(root, 'state', 'ha-desktop-widget', 'omarchy-bar-launch.json');
    const launch = ['/home/me/Apps/HA-Desktop-Widget.AppImage'];
    expect(rememberOmarchyBarLaunch({ launchFile, launch })).toBe(true);
    expect(JSON.parse(fs.readFileSync(launchFile, 'utf8'))).toEqual({ version: 1, launch });
    if (process.platform !== 'win32') {
      expect(fs.statSync(launchFile).mode & 0o777).toBe(0o600);
    }
    expect(rememberOmarchyBarLaunch({ launchFile, launch })).toBe(false);
    // A development run has no launch command and leaves the saved one alone.
    expect(rememberOmarchyBarLaunch({ launchFile, launch: null })).toBe(false);
    expect(JSON.parse(fs.readFileSync(launchFile, 'utf8')).launch).toEqual(launch);
  });
});
