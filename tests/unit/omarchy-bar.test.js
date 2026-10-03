/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  OMARCHY_BAR_PLUGIN_ID,
  PLUGIN_FILES,
  buildOmarchyBarStatus,
  createOmarchyBarPublisher,
  cleanLineIconSvg,
  cleanOmarchyBarTile,
  createOmarchyBarCommandServer,
  getOmarchyBarActionRequest,
  getQuickAccessPages,
  getOmarchyBarPaths,
  installOmarchyBarPluginFiles,
  updateInstalledOmarchyBarPlugin,
  isAllowedOmarchyBarAction,
  isOmarchyShellInstalled,
  parseOmarchyBarSocketLine,
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

const lightTile = {
  name: 'Desk lamp',
  state: 'on',
  value: '85%',
  icon: { kind: 'line', name: 'lightbulb' },
  available: true,
  missing: false,
  active: true,
  action: 'toggle',
  controls: true,
};

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
    expect(qml).toContain('"--entity-action=" + tile.id');
    expect(qml).toContain('"--entity-controls=" + tile.id');
    // It reads the fields buildOmarchyBarStatus writes.
    expect(qml).toContain('parsed.version === 1');
    // A locked keyring gets its own advice rather than the generic sign-in text.
    expect(qml).toContain('status.issue === "keyring"');
    // Tiles only act through a connected widget, and only as the widget's own tile would.
    expect(qml).toContain(
      'return connected && tile && tile.action !== undefined && tile.action !== "none"'
    );
    expect(qml).toContain('return connected && tile && tile.controls === true');
    // Clicks and control changes go over the widget's socket; the command line is the fallback.
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar.sock"');
    expect(qml).toContain('commandSocket.write(JSON.stringify(request) + "\\n")');
    expect(qml).toContain('if (!sendRequest({ id: tile.id, kind: "primary" }))');
    // Holding a tile opens its controls in the panel, as holding it in the widget does.
    expect(qml).toContain('pressAndHoldInterval: 500');
    expect(qml).toContain('var request = { id: controlsTile.id, kind: "set", command: command }');
    // Line icons are the widget's own SVGs, recoloured from currentColor.
    expect(qml).toContain('svg.split("currentColor").join(hex)');
    // The launch command it keeps for a widget that has quit.
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar-launch.json"');
    expect(qml).toContain('parsed.launch');
    // Offline, an explicit command setting wins over the remembered one.
    const launchBody = qml.slice(
      qml.indexOf('function launch('),
      qml.indexOf('function toggleWidget')
    );
    expect(launchBody.indexOf('configured !== ""')).toBeGreaterThan(-1);
    expect(launchBody.indexOf('configured !== ""')).toBeLessThan(launchBody.indexOf('savedLaunch'));
    ['updatedAt', 'connection', 'launch', 'panel', 'bar', 'sections', 'icons'].forEach((field) =>
      expect(qml).toContain(`status.${field}`)
    );
  });
});

describe('Omarchy panel keyboard support', () => {
  const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');

  it('brings the highlighted tile into view as the cursor moves, so Enter never acts on one that is off screen', () => {
    const moveBody = qml.slice(
      qml.indexOf('function moveCursor('),
      qml.indexOf('function adjustCursorTile')
    );
    // Both the first press (which only shows the cursor) and every step scroll to it.
    expect(moveBody.match(/ensureCursorVisible\(\)/g)).toHaveLength(2);
    // Each tile registers itself by position, so the scroll can find where it is drawn.
    expect(qml).toContain('Component.onCompleted: root.tileItems[tileRoot.flatIndex] = tileRoot');
    expect(qml).toContain('delete root.tileItems[tileRoot.flatIndex]');
    const scrollBody = qml.slice(
      qml.indexOf('function ensureVisible('),
      qml.indexOf('function ensureCursorVisible()')
    );
    expect(scrollBody).toContain('item.mapToItem(flick.contentItem, 0, 0).y');
    expect(scrollBody).toContain('flick.contentY =');
    const cursorScroll = qml.slice(
      qml.indexOf('function ensureCursorVisible()'),
      qml.indexOf('function moveCursor(')
    );
    // The controls view has no tiles to scroll to.
    expect(cursorScroll).toContain('if (showingControls) return');
    expect(cursorScroll).toContain('ensureVisible(tileItems[cursorIndex])');
  });

  it('shows a scrollbar while there are tiles below the fold, and none when everything fits', () => {
    expect(qml).toContain('import QtQuick.Controls as Controls');
    expect(qml).toContain(
      'policy: flick.contentHeight > flick.height ? Controls.ScrollBar.AlwaysOn : Controls.ScrollBar.AlwaysOff'
    );
  });

  it('opens the highlighted tile controls from the keyboard, where the adjustment itself is possible', () => {
    // Connected rather than bound with onTextKey, which fails the whole panel's load on a shell whose
    // key catcher has no such signal; Connections ignores a signal it does not find.
    expect(qml).not.toMatch(/^\s*onTextKey:/m);
    expect(qml).toMatch(
      /Connections \{\s*target: keyCatcher\s*ignoreUnknownSignals: true\s*function onTextKey\(text\) \{\s*if \(text === "a" \|\| text === "A"\) root\.adjustCursorTile\(\)/
    );
    const adjustBody = qml.slice(
      qml.indexOf('function adjustCursorTile()'),
      qml.indexOf('// Icon SVGs from the widget draw')
    );
    expect(adjustBody).toContain('if (showingControls || !cursorActive) return');
    expect(adjustBody).toContain('canAdjust(tile)');
    expect(adjustBody).toContain('adjustTile(tile)');
    expect(fs.readFileSync(path.resolve(__dirname, '../../docs/omarchy.md'), 'utf8')).toContain(
      'and A opens its controls'
    );
  });
});

describe('Omarchy tile controls from the keyboard', () => {
  const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
  const view = qml.slice(qml.indexOf('component ControlsView: Column'));

  it('sends the arrows to the controls view, which keeps its place as a row and a column', () => {
    const moveBody = qml.slice(
      qml.indexOf('function moveCursor('),
      qml.indexOf('function adjustCursorTile')
    );
    // Both axes go there now: Up and Down used to be dropped while a tile's controls were open.
    expect(moveBody).toContain('controlsView.move(dx, dy)');
    // A change rebuilds the buttons, so the place is not an item that would be gone a moment later.
    expect(view).toContain('property int stopRow: -1');
    expect(view).toContain('property int stopCol: 0');
    expect(view).toContain('onCtlChanged: Qt.callLater(revalidateStop)');
  });

  it('keeps Left, Right and Enter acting on the tile until a control has been selected', () => {
    const moveBody = view.slice(
      view.indexOf('function move('),
      view.indexOf('function activate()')
    );
    // Down from nothing selects the first row; Up from the first row gives the tile back.
    expect(moveBody).toContain('stopRow < 0 ? (dy > 0 ? 0 : -1) : stopRow + dy');
    expect(moveBody).toContain('if (row < 0) clearStop()');
    // With no selection, Left and Right still move the main slider.
    expect(moveBody).toContain('nudge(dx)');
    const activateBody = view.slice(
      view.indexOf('function activate()'),
      view.indexOf('function nudge(')
    );
    expect(activateBody).toContain('item.pressStop()');
    // No selection, or a slider: Enter still switches the tile (light, fan) or plays and pauses.
    expect(activateBody).toContain('root.setControl("power", !ctl.on)');
    expect(activateBody).toContain('root.setControl("play_pause")');
  });

  it('lets the keyboard reach every button, swatch and slider the pointer can', () => {
    expect(view).toContain('if (kid.keyStop === true && kid.enabled !== false) out.push(kid)');
    // Preset, cover, media and climate-mode buttons, the climate step buttons and mute, Open in
    // widget, the colour swatches, and every slider.
    expect(qml).toContain('component KeyButton: Button');
    expect(qml).toContain('component KeyActionButton: PanelActionButton');
    expect(qml.match(/delegate: KeyButton \{/g)).toHaveLength(2);
    expect(qml.match(/\bKeyActionButton \{/g)).toHaveLength(3);
    expect(qml).toMatch(/\/\/ Everything else the widget's own dialog has\.\s*KeyButton \{/);
    expect(qml).toContain('function pressStop() { root.setControl("color", modelData) }');
    expect(qml).toContain('readonly property bool isSlider: true');
    // No control the keyboard cannot see: the plain buttons are gone from the controls view.
    expect(view).not.toMatch(/delegate: Button \{/);
  });

  it('outlines the control inside its own bounds, so a full-width one keeps its sides', () => {
    expect(qml).toContain('x: controlsView.ringRect.x\n');
    expect(qml).toContain('width: controlsView.ringRect.width\n');
    expect(qml).toContain('root.ensureVisible(currentStop(rows))');
    expect(fs.readFileSync(path.resolve(__dirname, '../../docs/omarchy.md'), 'utf8')).toContain(
      'Up and Down move between its controls'
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

  it('lists every Quick Access tile, by page, until entities are chosen', () => {
    const entry = { present: true, entities: null, barEntities: null };
    const favorites = Array.from({ length: 20 }, (_, index) => `light.l${index}`);
    // A config from before pages holds favoriteEntities alone: one untitled page, all of it.
    const legacy = resolveOmarchyBarEntities(entry, { favoriteEntities: favorites });
    expect(legacy.panel).toHaveLength(20);
    expect(legacy.sections).toEqual([{ name: '', ids: favorites }]);
    expect(legacy.bar).toEqual([]);
    // One page needs no heading; several keep their names and order, and each page keeps its own
    // tiles even when another page lists them too.
    const onePage = resolveOmarchyBarEntities(entry, {
      customTabs: [{ name: 'All', entityIds: ['light.a', 'switch.b'] }],
    });
    expect(onePage.sections).toEqual([{ name: '', ids: ['light.a', 'switch.b'] }]);
    const pages = resolveOmarchyBarEntities(entry, {
      customTabs: [
        { name: 'Living room', entityIds: ['light.a', 'switch.b'] },
        { name: 'Empty', entityIds: [] },
        { name: 'Office', entityIds: ['switch.b', 'sensor.temp', 'not an id'] },
      ],
    });
    expect(pages.sections).toEqual([
      { name: 'Living room', ids: ['light.a', 'switch.b'] },
      { name: 'Office', ids: ['switch.b', 'sensor.temp'] },
    ]);
    expect(pages.panel).toEqual(['light.a', 'switch.b', 'sensor.temp']);
    expect(pages.all).toEqual(['light.a', 'switch.b', 'sensor.temp']);
    expect(getQuickAccessPages({})).toEqual([]);
    // Entities chosen on the shell.json entry replace the pages with one list.
    const chosen = resolveOmarchyBarEntities(
      { present: true, entities: ['switch.fan'], barEntities: ['sensor.temp'] },
      { favoriteEntities: favorites }
    );
    expect(chosen).toEqual({
      panel: ['switch.fan'],
      bar: ['sensor.temp'],
      sections: [{ name: '', ids: ['switch.fan'] }],
      all: ['sensor.temp', 'switch.fan'],
    });
  });

  it('keeps a duplicated page in the panel and skips its comparison graphs', () => {
    const entry = { present: true, entities: null, barEntities: null };
    const resolved = resolveOmarchyBarEntities(entry, {
      customTabs: [
        { name: 'Home', entityIds: ['light.a', 'graph:temps', 'switch.b'] },
        { name: 'Home copy', entityIds: ['light.a', 'graph:temps-copy', 'switch.b'] },
      ],
    });
    // The copy still gets its section; the tiles are listed once for the status and subscriptions.
    expect(resolved.sections).toEqual([
      { name: 'Home', ids: ['light.a', 'switch.b'] },
      { name: 'Home copy', ids: ['light.a', 'switch.b'] },
    ]);
    expect(resolved.panel).toEqual(['light.a', 'switch.b']);
    expect(resolved.all).toEqual(['light.a', 'switch.b']);
    const tiles = new Map(resolved.panel.map((id) => [id, { ...lightTile, id }]));
    const status = buildOmarchyBarStatus({ tiles, entities: resolved });
    expect(status.panel.map((tile) => tile.id)).toEqual(['light.a', 'switch.b']);
    expect(status.sections.map((section) => section.ids)).toEqual([
      ['light.a', 'switch.b'],
      ['light.a', 'switch.b'],
    ]);
  });

  it('limits the panel by distinct entities, not by repeated ones', () => {
    const ids = Array.from({ length: 48 }, (_, index) => `sensor.s${index}`);
    const resolved = resolveOmarchyBarEntities(
      { present: true, entities: null, barEntities: null },
      {
        customTabs: [
          { name: 'A', entityIds: ids },
          { name: 'B', entityIds: ['sensor.extra', ...ids.slice(0, 2)] },
        ],
      }
    );
    expect(resolved.panel).toEqual(ids);
    expect(resolved.sections[1]).toEqual({ name: 'B', ids: ids.slice(0, 2) });
  });
});

describe('Omarchy bar status', () => {
  it('bounds countdown metadata and passes it to the bar and panel', () => {
    const endsAt = Date.parse('2026-09-30T12:00:00Z');
    const raw = {
      ...lightTile,
      countdown: { endsAt, finishedValue: '  Finished\n', extra: 'dropped' },
    };
    const tile = cleanOmarchyBarTile('sensor.kitchen_timer', raw);
    expect(tile.countdown).toEqual({ endsAt, finishedValue: 'Finished' });
    const status = buildOmarchyBarStatus({
      tiles: new Map([[tile.id, tile]]),
      entities: { panel: [tile.id], bar: [tile.id] },
    });
    expect(status.panel[0].countdown).toEqual(tile.countdown);
    expect(status.bar[0].countdown).toEqual(tile.countdown);
    for (const invalid of [NaN, Infinity, -1, 0, '123', null]) {
      expect(
        cleanOmarchyBarTile(tile.id, { ...raw, countdown: { endsAt: invalid } }).countdown
      ).toBeUndefined();
    }
    expect(cleanOmarchyBarTile(tile.id, { ...raw, available: false }).countdown).toBeUndefined();
    expect(
      cleanOmarchyBarTile(tile.id, { ...raw, countdown: { endsAt } }).countdown.finishedValue
    ).toBe('0:00');
  });

  it('keeps only the tile fields the plugin reads', () => {
    expect(cleanOmarchyBarTile('light.desk', { ...lightTile, extra: 'dropped' })).toEqual({
      id: 'light.desk',
      ...lightTile,
      controlState: null,
    });
    const withControls = cleanOmarchyBarTile('light.desk', {
      ...lightTile,
      controlState: {
        kind: 'light',
        on: true,
        brightness: 250,
        canSetBrightness: true,
        colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
        colors: ['#FFB347', 'red', '#12345'],
        script: 'dropped',
      },
    });
    expect(withControls.controlState).toEqual({
      kind: 'light',
      on: true,
      brightness: 100,
      canSetBrightness: true,
      colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
      colors: ['#FFB347'],
    });
    expect(
      cleanOmarchyBarTile('light.desk', { ...lightTile, controlState: { kind: 'oven' } })
        .controlState
    ).toBeNull();
    const odd = cleanOmarchyBarTile('scene.movie', {
      name: `  Movie\n${'x'.repeat(200)}`,
      icon: { kind: 'mdi', glyph: '\u{F0510}' },
      action: 'explode',
      active: 'yes',
    });
    expect(odd.name).toHaveLength(80);
    expect(odd.name.startsWith('Movie x')).toBe(true);
    expect(odd.icon).toEqual({ kind: 'glyph', glyph: '\u{F0510}' });
    expect(odd.action).toBe('none');
    expect(odd.active).toBe(false);
    expect(
      cleanOmarchyBarTile('sensor.x', { icon: { kind: 'line', name: '../../x' } }).icon
    ).toEqual({ kind: 'line', name: 'box' });
    expect(cleanOmarchyBarTile('sensor.x', null)).toBeNull();
  });

  it('accepts only plain line-icon SVGs', () => {
    const svg =
      '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor"><path d="M9 18h6"></path></svg>';
    expect(cleanLineIconSvg(svg)).toBe(svg);
    expect(cleanLineIconSvg(`<svg><script>alert(1)</script></svg>`)).toBe('');
    expect(cleanLineIconSvg('<svg onload="x()"></svg>')).toBe('');
    expect(cleanLineIconSvg('<svg><image href="file:///etc/passwd"/></svg>')).toBe('');
    expect(cleanLineIconSvg('<div></div>')).toBe('');
    expect(cleanLineIconSvg(`<svg>${'x'.repeat(5000)}</svg>`)).toBe('');
  });

  it('builds the file the plugin reads', () => {
    const tile = cleanOmarchyBarTile('light.desk', lightTile);
    const status = buildOmarchyBarStatus({
      connection: 'connected',
      tiles: new Map([['light.desk', tile]]),
      icons: new Map([
        ['lightbulb', '<svg>bulb</svg>'],
        ['plug', '<svg>unused</svg>'],
      ]),
      entities: {
        panel: ['light.desk', 'switch.later'],
        bar: [],
        sections: [{ name: '', ids: ['light.desk', 'switch.later'] }],
      },
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      now: 42,
    });
    expect(status).toMatchObject({
      version: 1,
      updatedAt: 42,
      connection: 'connected',
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      bar: [],
      sections: [{ name: '', ids: ['light.desk', 'switch.later'] }],
      // Only the icons the tiles use.
      icons: { lightbulb: '<svg>bulb</svg>' },
    });
    // Plugin 1.0.x reads value, active, available and toggleable from the same entries.
    expect(status.panel[0]).toMatchObject({
      id: 'light.desk',
      value: '85%',
      active: true,
      toggleable: true,
      action: 'toggle',
    });
    // A tile the renderer has not described yet reads as inert.
    expect(status.panel[1]).toMatchObject({
      id: 'switch.later',
      action: 'none',
      toggleable: false,
    });
    expect(buildOmarchyBarStatus({ launch: [] }).launch).toBeNull();
    expect(buildOmarchyBarStatus({}).issue).toBe('');
    expect(buildOmarchyBarStatus({ connection: 'auth-failed', issue: 'keyring' }).issue).toBe(
      'keyring'
    );
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

describe('Omarchy shell countdowns', () => {
  const countdown = vm.runInNewContext(
    fs.readFileSync(path.join(pluginDir, 'Countdown.js'), 'utf8') + '\n({ value, isRunning })'
  );
  const now = Date.parse('2026-09-30T12:00:00Z');
  const tile = {
    available: true,
    value: 'stale snapshot',
    countdown: { endsAt: now + 90000, finishedValue: 'Finished' },
  };

  it('ticks between state updates and catches up after sleep', () => {
    expect(countdown.value(tile, now)).toBe('1:30');
    expect(countdown.value(tile, now + 1000)).toBe('1:29');
    expect(countdown.value(tile, now + 65000)).toBe('0:25');
    expect(countdown.isRunning(tile, now + 65000)).toBe(true);
    expect(countdown.value(tile, now + 90000)).toBe('Finished');
    expect(countdown.value(tile, now + 180000)).toBe('Finished');
    expect(countdown.isRunning(tile, now + 90000)).toBe(false);
  });

  it('formats hours and clamps completed native timers to zero', () => {
    const native = { ...tile, countdown: { endsAt: now + 3661000, finishedValue: '0:00' } };
    expect(countdown.value(native, now)).toBe('1:01:01');
    expect(countdown.value(native, now + 2000)).toBe('1:00:59');
    expect(countdown.value(native, now + 7200000)).toBe('0:00');
  });

  it('preserves static, paused, unavailable and older widget values', () => {
    for (const staticTile of [
      { value: '85%' },
      { ...tile, countdown: undefined, value: 'Paused' },
      { ...tile, available: false, value: 'Unavailable' },
      { ...tile, countdown: { endsAt: 'invalid' } },
    ]) {
      expect(countdown.value(staticTile, now + 180000)).toBe(staticTile.value);
      expect(countdown.isRunning(staticTile, now)).toBe(false);
    }
    expect(countdown.value(null, now)).toBe('');
  });
});

describe('bar requests and installation', () => {
  it('reads tile requests and allows only what the shown tile can do', () => {
    expect(getOmarchyBarActionRequest(['widget', '--entity-action=Light.Desk'])).toEqual({
      entityId: 'light.desk',
      kind: 'primary',
    });
    expect(getOmarchyBarActionRequest(['widget', '--entity-controls', 'fan.bedroom'])).toEqual({
      entityId: 'fan.bedroom',
      kind: 'controls',
    });
    // What plugin 1.0.x runs.
    expect(getOmarchyBarActionRequest(['widget', '--entity-toggle=switch.fan'])).toEqual({
      entityId: 'switch.fan',
      kind: 'primary',
    });
    expect(getOmarchyBarActionRequest(['widget', '--entity-action=rm -rf'])).toBeNull();
    expect(getOmarchyBarActionRequest(['widget', '--toggle'])).toBeNull();

    const entities = { all: ['light.desk', 'sensor.status'] };
    const light = { action: 'toggle', controls: true };
    const status = { action: 'none', controls: false };
    const primary = (entityId) => ({ entityId, kind: 'primary' });
    const controls = (entityId) => ({ entityId, kind: 'controls' });
    expect(isAllowedOmarchyBarAction(primary('light.desk'), entities, light)).toBe(true);
    expect(isAllowedOmarchyBarAction(controls('light.desk'), entities, light)).toBe(true);
    // A tile whose click does nothing, one without controls, one the bar does not show, or one
    // the renderer has not described.
    expect(isAllowedOmarchyBarAction(primary('sensor.status'), entities, status)).toBe(false);
    expect(isAllowedOmarchyBarAction(controls('sensor.status'), entities, status)).toBe(false);
    expect(isAllowedOmarchyBarAction(primary('light.kitchen'), entities, light)).toBe(false);
    expect(isAllowedOmarchyBarAction(primary('light.desk'), entities, undefined)).toBe(false);
    expect(isAllowedOmarchyBarAction({ entityId: 'light.desk', kind: 'x' }, entities, light)).toBe(
      false
    );
  });

  it('allows controls-popup commands only within what the tile offers', () => {
    const entities = { all: ['light.desk', 'climate.hall', 'media_player.den'] };
    const set = (entityId, command, value) => ({ entityId, kind: 'set', command, value });
    const light = cleanOmarchyBarTile('light.desk', {
      ...lightTile,
      controlState: {
        kind: 'light',
        on: true,
        brightness: 40,
        canSetBrightness: true,
        colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
        colors: ['#FFB347'],
      },
    });
    expect(isAllowedOmarchyBarAction(set('light.desk', 'brightness', 55), entities, light)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'brightness', 101), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'color_temp', 1000), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'color', '#00ff00'), entities, light)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'power', 'yes'), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'position', 5), entities, light)).toBe(
      false
    );
    const climate = cleanOmarchyBarTile('climate.hall', {
      ...lightTile,
      controlState: {
        kind: 'climate',
        mode: 'heat',
        target: 21,
        min: 7,
        max: 30,
        step: 0.5,
        canSetTemperature: true,
        modes: ['off', 'heat'],
      },
    });
    expect(
      isAllowedOmarchyBarAction(set('climate.hall', 'temperature', 22.5), entities, climate)
    ).toBe(true);
    expect(
      isAllowedOmarchyBarAction(set('climate.hall', 'temperature', 45), entities, climate)
    ).toBe(false);
    expect(isAllowedOmarchyBarAction(set('climate.hall', 'mode', 'cool'), entities, climate)).toBe(
      false
    );
    const media = cleanOmarchyBarTile('media_player.den', {
      ...lightTile,
      controlState: { kind: 'media', canNext: false, canSetVolume: true, canPlay: true },
    });
    expect(isAllowedOmarchyBarAction(set('media_player.den', 'volume', 30), entities, media)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('media_player.den', 'next', null), entities, media)).toBe(
      false
    );
    // A tile without controls takes no commands at all.
    expect(
      isAllowedOmarchyBarAction(set('light.desk', 'brightness', 50), entities, {
        ...light,
        controls: false,
      })
    ).toBe(false);
  });

  it('reads socket request lines', () => {
    expect(parseOmarchyBarSocketLine('{"id":"Light.Desk","kind":"primary"}')).toEqual({
      entityId: 'light.desk',
      kind: 'primary',
    });
    expect(
      parseOmarchyBarSocketLine(
        '{"id":"light.desk","kind":"set","command":"brightness","value":40}'
      )
    ).toEqual({ entityId: 'light.desk', kind: 'set', command: 'brightness', value: 40 });
    expect(parseOmarchyBarSocketLine('{"id":"light.desk","kind":"set","command":"stop"}')).toEqual({
      entityId: 'light.desk',
      kind: 'set',
      command: 'stop',
      value: null,
    });
    [
      'not json',
      '{"id":"rm -rf","kind":"primary"}',
      '{"id":"light.desk","kind":"delete"}',
      '{"id":"light.desk","kind":"set","command":"Bad Command"}',
      '{"id":"light.desk","kind":"set","command":"brightness","value":{"x":1}}',
      `{"id":"light.desk","kind":"primary","pad":"${'x'.repeat(600)}"}`,
    ].forEach((line) => expect(parseOmarchyBarSocketLine(line)).toBeNull());
  });

  (process.platform === 'win32' ? it.skip : it)(
    'listens on a private socket and passes each request line on',
    async () => {
      const socketPath = path.join(root, 'run', 'ha-desktop-widget', 'omarchy-bar.sock');
      const received = [];
      const server = createOmarchyBarCommandServer({
        socketPath,
        onRequest: (request) => received.push(request),
        log: { warn: jest.fn() },
      });
      await new Promise((resolve) => {
        const wait = () => (fs.existsSync(socketPath) ? resolve() : setTimeout(wait, 10));
        wait();
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(socketPath)).mode & 0o777).toBe(0o700);
      const client = require('net').createConnection(socketPath);
      await new Promise((resolve) => client.on('connect', resolve));
      // Split across writes, with a junk line between two real ones.
      client.write('{"id":"light.desk","ki');
      client.write('nd":"primary"}\nnot json\n{"id":"light.desk","kind":"controls"}\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toEqual([
        { entityId: 'light.desk', kind: 'primary' },
        { entityId: 'light.desk', kind: 'controls' },
      ]);
      client.destroy();
      server.stop();
      expect(fs.existsSync(socketPath)).toBe(false);
      expect(createOmarchyBarCommandServer({ socketPath: '', onRequest: () => {} })).toBeNull();
    }
  );

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
      socket: path.join('/run/user/1000', 'ha-desktop-widget', 'omarchy-bar.sock'),
      launchFile: path.join(
        '/home/me',
        '.local',
        'state',
        'ha-desktop-widget',
        'omarchy-bar-launch.json'
      ),
    });
    expect(getOmarchyBarPaths({ env: {}, home: '/home/me' }).statusFile).toBe('');
    expect(getOmarchyBarPaths({ env: {}, home: '/home/me' }).socket).toBe('');
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

  it('writes the manifest only after the plugin files, so a failed upgrade is retried', () => {
    const target = path.join(root, 'plugins', appId);
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    const manifestPath = path.join(target, 'manifest.json');
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...old, version: '0.0.1' }));
    const failingFs = {
      ...fs,
      copyFileSync: (from, to) => {
        if (from.endsWith('Widget.qml')) throw new Error('disk full');
        return fs.copyFileSync(from, to);
      },
    };
    expect(() =>
      updateInstalledOmarchyBarPlugin({
        sourceDir: pluginDir,
        pluginDir: target,
        fsImpl: failingFs,
      })
    ).toThrow('disk full');
    // The old version still stands, and no temporary copy is left behind.
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version).toBe('0.0.1');
    expect(fs.readdirSync(target).filter((file) => file.startsWith('.'))).toEqual([]);
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(true);
  });
});
