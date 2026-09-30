/* global console, process, setTimeout, clearTimeout, setInterval, clearInterval */

// Omarchy 4 bar plugin support. The plugin (omarchy-plugin/ in this repository) is QML running
// inside the Omarchy shell, with no Home Assistant connection or credentials of its own. The
// widget publishes a small status file for it under XDG_RUNTIME_DIR, and the plugin sends
// requests back by running the widget's own command line (`--toggle`, `--entity-action=<id>`,
// `--entity-controls=<id>`), which the single-instance handler forwards to the running widget.
//
// The panel mirrors the widget's Quick Access tiles. The renderer describes each tile with the
// same helpers its own tiles use (src/ui.js describeQuickAccessTile), so the bar shows the same
// names, icons and status lines, and a click does what clicking the tile in the widget does.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { appId: APP_ID } = require('../package.json');

const OMARCHY_BAR_PLUGIN_ID = APP_ID;
const OMARCHY_BAR_STATUS_VERSION = 1;
const PLUGIN_FILES = Object.freeze(['manifest.json', 'Countdown.js', 'Widget.qml']);
const MAX_PANEL_ENTITIES = 48;
const MAX_BAR_ENTITIES = 4;
const MAX_PANEL_SECTIONS = 12;
const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;
// What a tile's click does (see describeQuickAccessTile in src/ui.js).
const TILE_ACTIONS = new Set(['toggle', 'activate', 'dialog', 'none']);
// `--entity-toggle` is what plugin 1.0.x runs; it now means the tile's primary action.
const ENTITY_ACTION_ARGS = Object.freeze({
  '--entity-action': 'primary',
  '--entity-toggle': 'primary',
  '--entity-controls': 'controls',
});
const LINE_ICON_NAME_PATTERN = /^[a-z0-9-]{1,40}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MODE_PATTERN = /^[a-z0-9_]{1,32}$/;
// A request line from the bar is a small JSON object; anything longer is not one.
const MAX_SOCKET_LINE_LENGTH = 512;
const MAX_LINE_ICON_SVG_LENGTH = 4096;

function getOmarchyBarPaths({ env = process.env, home = os.homedir() } = {}) {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const stateHome = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  const runtimeDir = env.XDG_RUNTIME_DIR || '';
  return {
    shellConfig: path.join(configHome, 'omarchy', 'shell.json'),
    pluginDir: path.join(configHome, 'omarchy', 'plugins', OMARCHY_BAR_PLUGIN_ID),
    statusFile: runtimeDir ? path.join(runtimeDir, 'ha-desktop-widget', 'omarchy-bar.json') : '',
    // Where the widget listens for the bar's clicks and control changes while it runs.
    socket: runtimeDir ? path.join(runtimeDir, 'ha-desktop-widget', 'omarchy-bar.sock') : '',
    // Outlives the widget and the session, so the bar can start an AppImage after a quit.
    launchFile: path.join(stateHome, 'ha-desktop-widget', 'omarchy-bar-launch.json'),
  };
}

/** Whether the Omarchy 4 shell, which hosts bar plugins, is installed. */
function isOmarchyShellInstalled({ env = process.env, exists = fs.existsSync } = {}) {
  const omarchyPath = env.OMARCHY_PATH || '/usr/share/omarchy';
  try {
    return exists(path.join(omarchyPath, 'shell', 'shell.qml'));
  } catch {
    return false;
  }
}

function normalizeEntityIds(value, limit) {
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const item of value) {
    const id = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (ENTITY_ID_PATTERN.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

/**
 * Find the plugin's entry in the Omarchy shell.json bar layout. Omarchy keeps a widget's
 * settings inline on its layout entry, so `entities` and `barEntities` live there.
 */
function readOmarchyBarEntry(text, pluginId = OMARCHY_BAR_PLUGIN_ID) {
  let shellConfig;
  try {
    shellConfig = JSON.parse(text);
  } catch {
    return { present: false, entities: null, barEntities: null };
  }
  const layout = shellConfig?.bar?.layout;
  if (layout && typeof layout === 'object') {
    for (const section of ['left', 'center', 'right']) {
      const entries = Array.isArray(layout[section]) ? layout[section] : [];
      for (const entry of entries) {
        const id = typeof entry === 'string' ? entry : entry?.id;
        if (id !== pluginId) continue;
        const settings = entry && typeof entry === 'object' ? entry : {};
        return {
          present: true,
          entities: normalizeEntityIds(settings.entities, MAX_PANEL_ENTITIES),
          barEntities: normalizeEntityIds(settings.barEntities, MAX_BAR_ENTITIES),
        };
      }
    }
  }
  return { present: false, entities: null, barEntities: null };
}

/**
 * The Quick Access pages, in order, as [{ name, ids }]. Older configs only have favoriteEntities,
 * which then reads as a single page.
 */
function getQuickAccessPages(config = {}) {
  const tabs = Array.isArray(config?.customTabs) ? config.customTabs : [];
  const pages = tabs
    .map((tab) => ({
      name: typeof tab?.name === 'string' ? tab.name.trim().slice(0, 60) : '',
      ids: normalizeEntityIds(tab?.entityIds, MAX_PANEL_ENTITIES) || [],
    }))
    .filter((page) => page.ids.length);
  if (pages.length) return pages;
  const favorites = normalizeEntityIds(config?.favoriteEntities, MAX_PANEL_ENTITIES) || [];
  return favorites.length ? [{ name: '', ids: favorites }] : [];
}

/**
 * Entities the panel lists and the bar shows. The panel defaults to every Quick Access tile, split
 * into the widget's pages when it has more than one; `entities` on the shell.json entry replaces
 * that with a single list.
 */
function resolveOmarchyBarEntities(entry, config = {}) {
  let sections;
  if (entry?.entities) {
    sections = [{ name: '', ids: entry.entities }];
  } else {
    sections = [];
    const seen = new Set();
    for (const page of getQuickAccessPages(config)) {
      if (sections.length >= MAX_PANEL_SECTIONS || seen.size >= MAX_PANEL_ENTITIES) break;
      const ids = page.ids.filter((id) => !seen.has(id)).slice(0, MAX_PANEL_ENTITIES - seen.size);
      ids.forEach((id) => seen.add(id));
      if (ids.length) sections.push({ name: page.name, ids });
    }
    // A single page needs no heading.
    if (sections.length === 1) sections[0] = { name: '', ids: sections[0].ids };
  }
  const panel = sections.flatMap((section) => section.ids);
  const bar = entry?.barEntities || [];
  return { panel, bar, sections, all: [...new Set([...bar, ...panel])] };
}

function cleanText(value, limit) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function cleanTileIcon(icon) {
  if (icon?.kind === 'line' && LINE_ICON_NAME_PATTERN.test(icon.name)) {
    return { kind: 'line', name: icon.name };
  }
  if ((icon?.kind === 'mdi' || icon?.kind === 'custom') && typeof icon.glyph === 'string') {
    const glyph = Array.from(icon.glyph).slice(0, 4).join('');
    if (glyph.trim()) return { kind: 'glyph', glyph };
  }
  return { kind: 'line', name: 'box' };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percent(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.max(0, Math.min(100, Math.round(number)));
}

/** The controls popup's state for a tile (see getQuickAccessTileControls in src/ui.js). */
function cleanTileControls(controls) {
  if (!controls || typeof controls !== 'object') return null;
  const flag = (value) => value === true;
  switch (controls.kind) {
    case 'light': {
      const temp = controls.colorTemp;
      const min = finiteNumber(temp?.min);
      const max = finiteNumber(temp?.max);
      return {
        kind: 'light',
        on: flag(controls.on),
        brightness: percent(controls.brightness) ?? 0,
        canSetBrightness: flag(controls.canSetBrightness),
        colorTemp:
          min !== null && max !== null && min < max
            ? { kelvin: finiteNumber(temp.kelvin) ?? min, min, max }
            : null,
        colors: (Array.isArray(controls.colors) ? controls.colors : [])
          .filter((color) => typeof color === 'string' && HEX_COLOR_PATTERN.test(color))
          .slice(0, 8),
      };
    }
    case 'fan':
      return {
        kind: 'fan',
        on: flag(controls.on),
        percentage: percent(controls.percentage) ?? 0,
        canSetPercentage: flag(controls.canSetPercentage),
      };
    case 'cover':
      return {
        kind: 'cover',
        state: cleanText(controls.state, 32),
        position: percent(controls.position),
        canSetPosition: flag(controls.canSetPosition),
        canOpen: flag(controls.canOpen),
        canClose: flag(controls.canClose),
        canStop: flag(controls.canStop),
      };
    case 'climate': {
      const min = finiteNumber(controls.min);
      const max = finiteNumber(controls.max);
      const step = finiteNumber(controls.step);
      return {
        kind: 'climate',
        mode: cleanText(controls.mode, 32),
        current: finiteNumber(controls.current),
        target: finiteNumber(controls.target),
        min,
        max,
        step: step !== null && step > 0 ? step : 0.5,
        canSetTemperature: flag(controls.canSetTemperature) && min !== null && max !== null,
        modes: (Array.isArray(controls.modes) ? controls.modes : [])
          .filter((mode) => typeof mode === 'string' && MODE_PATTERN.test(mode))
          .slice(0, 8),
      };
    }
    case 'media':
      return {
        kind: 'media',
        playing: flag(controls.playing),
        title: cleanText(controls.title, 96),
        artist: cleanText(controls.artist, 96),
        canPlay: flag(controls.canPlay),
        canPause: flag(controls.canPause),
        canPrevious: flag(controls.canPrevious),
        canNext: flag(controls.canNext),
        volume: percent(controls.volume),
        canSetVolume: flag(controls.canSetVolume),
        muted: flag(controls.muted),
        canMute: flag(controls.canMute),
      };
    default:
      return null;
  }
}

/** Keep only the tile fields the plugin reads, with bounded strings. */
function cleanOmarchyBarTile(entityId, tile) {
  if (!tile || typeof tile !== 'object') return null;
  const action = TILE_ACTIONS.has(tile.action) ? tile.action : 'none';
  const endsAt = finiteNumber(tile.countdown?.endsAt);
  return {
    id: entityId,
    name: cleanText(tile.name, 80) || entityId,
    state: cleanText(tile.state, 64),
    value: cleanText(tile.value, 96),
    ...(tile.available === true && endsAt !== null && endsAt > 0
      ? {
          countdown: {
            endsAt,
            finishedValue: cleanText(tile.countdown.finishedValue, 96) || '0:00',
          },
        }
      : {}),
    icon: cleanTileIcon(tile.icon),
    available: tile.available === true,
    missing: tile.missing === true,
    active: tile.active === true,
    action,
    controls: tile.controls === true,
    controlState: tile.controls === true ? cleanTileControls(tile.controlState) : null,
  };
}

/**
 * A line icon's SVG, as the renderer drew it, if it is plainly one: an <svg> of paths and shapes
 * with no scripts, links or event handlers. The plugin recolours it by replacing currentColor.
 */
function cleanLineIconSvg(svg) {
  if (typeof svg !== 'string' || svg.length > MAX_LINE_ICON_SVG_LENGTH) return '';
  const text = svg.trim();
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) return '';
  if (/<\s*(script|foreignObject|image|use|style|a)\b|\bon[a-z]+\s*=|href|url\(/i.test(text))
    return '';
  return text;
}

function describeUnknownTile(entityId) {
  return {
    id: entityId,
    name: entityId,
    state: '',
    value: '',
    icon: { kind: 'line', name: 'box' },
    available: false,
    missing: false,
    active: false,
    action: 'none',
    controls: false,
    controlState: null,
  };
}

function buildOmarchyBarStatus({
  connection = 'connecting',
  tiles = new Map(),
  icons = new Map(),
  entities = { panel: [], bar: [], sections: [] },
  launch = null,
  issue = '',
  now = Date.now(),
} = {}) {
  const describe = (entityId) => {
    const tile = tiles.get(entityId) || describeUnknownTile(entityId);
    // `toggleable` is what plugin 1.0.x reads to make a row clickable.
    return { ...tile, toggleable: tile.action === 'toggle' || tile.action === 'activate' };
  };
  const panel = entities.panel.map(describe);
  const bar = entities.bar.map(describe);
  const usedIcons = {};
  for (const tile of [...panel, ...bar]) {
    const name = tile.icon?.kind === 'line' ? tile.icon.name : '';
    if (name && icons.has(name)) usedIcons[name] = icons.get(name);
  }
  return {
    version: OMARCHY_BAR_STATUS_VERSION,
    updatedAt: now,
    connection,
    // Why the widget cannot connect, when it is something the user must fix ('keyring').
    issue: issue || '',
    launch: Array.isArray(launch) && launch.length ? launch : null,
    panel,
    bar,
    sections: (entities.sections || []).map((section) => ({
      name: section.name,
      ids: section.ids,
    })),
    icons: usedIcons,
  };
}

/**
 * The tile request an `--entity-action=<id>`, `--entity-controls=<id>` or `--entity-toggle=<id>`
 * argument makes, as { entityId, kind }, or null.
 */
function getOmarchyBarActionRequest(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== 'string') continue;
    for (const [flag, kind] of Object.entries(ENTITY_ACTION_ARGS)) {
      let value = null;
      if (argument.startsWith(`${flag}=`)) value = argument.slice(flag.length + 1);
      else if (argument === flag && typeof argv[index + 1] === 'string') value = argv[index + 1];
      if (value === null) continue;
      const entityId = value.trim().toLowerCase();
      return ENTITY_ID_PATTERN.test(entityId) ? { entityId, kind } : null;
    }
  }
  return null;
}

function inRange(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Whether a controls-popup command and its value fit what the tile's controls offer. */
function isAllowedControlCommand(controls, command, value) {
  if (!controls) return false;
  const bool = typeof value === 'boolean';
  const none = value === undefined || value === null;
  switch (`${controls.kind}:${command}`) {
    case 'light:power':
    case 'fan:power':
      return bool;
    case 'light:brightness':
      return controls.canSetBrightness && inRange(value, 0, 100);
    case 'light:color_temp':
      return !!controls.colorTemp && inRange(value, controls.colorTemp.min, controls.colorTemp.max);
    case 'light:color':
      return (
        controls.colors.length > 0 && typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
      );
    case 'fan:percentage':
      return controls.canSetPercentage && inRange(value, 0, 100);
    case 'cover:position':
      return controls.canSetPosition && inRange(value, 0, 100);
    case 'cover:open':
      return controls.canOpen && none;
    case 'cover:close':
      return controls.canClose && none;
    case 'cover:stop':
      return controls.canStop && none;
    case 'climate:temperature':
      return controls.canSetTemperature && inRange(value, controls.min, controls.max);
    case 'climate:mode':
      return typeof value === 'string' && controls.modes.includes(value);
    case 'media:play_pause':
      return (controls.canPlay || controls.canPause) && none;
    case 'media:next':
      return controls.canNext && none;
    case 'media:previous':
      return controls.canPrevious && none;
    case 'media:volume':
      return controls.canSetVolume && inRange(value, 0, 100);
    case 'media:mute':
      return controls.canMute && bool;
    default:
      return false;
  }
}

/**
 * Bar requests may only act on an entity the bar shows, and only as its tile would: its click
 * action, its controls in the widget, or one of its controls-popup commands.
 */
function isAllowedOmarchyBarAction(request, entities, tile) {
  if (!request?.entityId || !entities?.all?.includes(request.entityId) || !tile) return false;
  if (request.kind === 'controls') return tile.controls === true;
  if (request.kind === 'set') {
    return (
      tile.controls === true &&
      isAllowedControlCommand(tile.controlState, request.command, request.value)
    );
  }
  return request.kind === 'primary' && tile.action !== 'none';
}

/**
 * One request line from the bar's socket: {"id": "<entity>", "kind": "primary" | "controls" |
 * "set", "command": "...", "value": ...}. Returns the request, or null for anything else.
 */
function parseOmarchyBarSocketLine(line) {
  if (typeof line !== 'string' || !line.trim() || line.length > MAX_SOCKET_LINE_LENGTH) {
    return null;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  const entityId = typeof message?.id === 'string' ? message.id.trim().toLowerCase() : '';
  if (!ENTITY_ID_PATTERN.test(entityId)) return null;
  if (message.kind === 'primary' || message.kind === 'controls') {
    return { entityId, kind: message.kind };
  }
  if (message.kind !== 'set' || typeof message.command !== 'string') return null;
  if (!/^[a-z_]{1,24}$/.test(message.command)) return null;
  const value = message.value;
  if (
    value !== undefined &&
    value !== null &&
    !['boolean', 'number', 'string'].includes(typeof value)
  ) {
    return null;
  }
  return { entityId, kind: 'set', command: message.command, value: value ?? null };
}

/**
 * Listen for the bar's requests on a unix socket, private to the user (the directory is 0700 and
 * the socket 0600). The bar's command line works too, but each run starts a second copy of the
 * widget just to hand the request over, which is far too slow for a slider. Returns null where
 * there is no socket path.
 */
function createOmarchyBarCommandServer({
  socketPath,
  onRequest,
  netImpl = net,
  fsImpl = fs,
  log = console,
} = {}) {
  if (!socketPath || typeof onRequest !== 'function') return null;
  try {
    fsImpl.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    // A socket left by a widget that crashed. The single-instance lock means no live widget on
    // this profile owns it.
    fsImpl.rmSync(socketPath, { force: true });
  } catch (error) {
    log.warn?.(`Omarchy bar socket setup failed: ${error?.message || error}`);
    return null;
  }
  const connections = new Set();
  const server = netImpl.createServer((connection) => {
    connections.add(connection);
    let buffer = '';
    connection.setEncoding('utf8');
    connection.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const request = parseOmarchyBarSocketLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (request) onRequest(request);
        newline = buffer.indexOf('\n');
      }
      // Never buffer an endless line from a misbehaving client.
      if (buffer.length > MAX_SOCKET_LINE_LENGTH) connection.destroy();
    });
    connection.on('error', () => {});
    connection.on('close', () => connections.delete(connection));
  });
  server.on('error', (error) => log.warn?.(`Omarchy bar socket error: ${error?.message || error}`));
  server.listen(socketPath, () => {
    try {
      fsImpl.chmodSync(socketPath, 0o600);
    } catch (error) {
      log.warn?.(`Omarchy bar socket permissions: ${error?.message || error}`);
    }
  });
  server.unref?.();
  return {
    stop() {
      connections.forEach((connection) => connection.destroy());
      connections.clear();
      server.close();
      try {
        fsImpl.rmSync(socketPath, { force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Keep the status file current: rewrite it (coalesced) whenever something changes, refresh it
 * as a heartbeat so the plugin can tell a crashed widget from a quiet one, and delete it on stop.
 */
function createOmarchyBarPublisher({
  statusFile,
  getStatus,
  fsImpl = fs,
  log = console,
  debounceMs = 250,
  heartbeatMs = 60000,
} = {}) {
  if (!statusFile) return null;
  let pending = null;
  let stopped = false;

  function write() {
    pending = null;
    if (stopped) return;
    try {
      const dir = path.dirname(statusFile);
      fsImpl.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${statusFile}.${process.pid}.tmp`;
      fsImpl.writeFileSync(temp, `${JSON.stringify(getStatus())}\n`, { mode: 0o600 });
      fsImpl.renameSync(temp, statusFile);
    } catch (error) {
      log.debug?.(`Omarchy bar status write failed: ${error?.message || error}`);
    }
  }

  function update() {
    if (stopped || pending) return;
    pending = setTimeout(write, debounceMs);
  }

  const heartbeat = setInterval(write, heartbeatMs);
  heartbeat.unref?.();
  write();

  return {
    update,
    flush: write,
    stop() {
      if (stopped) return;
      stopped = true;
      if (pending) clearTimeout(pending);
      pending = null;
      clearInterval(heartbeat);
      try {
        fsImpl.rmSync(statusFile, { force: true });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

/**
 * Remember how to start this widget for the bar plugin. The status file disappears when the
 * widget quits, and an AppImage has no `ha-desktop-widget` command to fall back to.
 * @returns {boolean} whether the file was written
 */
function rememberOmarchyBarLaunch({ launchFile, launch, fsImpl = fs } = {}) {
  if (!launchFile || !Array.isArray(launch) || !launch.length) return false;
  const content = `${JSON.stringify({ version: 1, launch })}\n`;
  try {
    if (fsImpl.readFileSync(launchFile, 'utf8') === content) return false;
  } catch {
    // not written yet
  }
  fsImpl.mkdirSync(path.dirname(launchFile), { recursive: true, mode: 0o700 });
  const temp = `${launchFile}.${process.pid}.tmp`;
  fsImpl.writeFileSync(temp, content, { mode: 0o600 });
  fsImpl.renameSync(temp, launchFile);
  return true;
}

/** Copy the bundled plugin into the user's Omarchy plugins directory. */
function installOmarchyBarPluginFiles({ sourceDir, pluginDir, fsImpl = fs } = {}) {
  fsImpl.mkdirSync(pluginDir, { recursive: true });
  // The payload goes first and the manifest last, so an interrupted upgrade never leaves a
  // manifest claiming a version whose files did not all arrive, and the next start retries it.
  // Each file lands through a dot-named temporary copy, which Omarchy's plugin reload ignores.
  const ordered = [...PLUGIN_FILES.filter((file) => file !== 'manifest.json'), 'manifest.json'];
  for (const file of ordered) {
    const target = path.join(pluginDir, file);
    const temp = path.join(pluginDir, `.${file}.${process.pid}.tmp`);
    try {
      fsImpl.copyFileSync(path.join(sourceDir, file), temp);
      fsImpl.renameSync(temp, target);
    } catch (error) {
      try {
        fsImpl.rmSync(temp, { force: true });
      } catch {
        // best-effort cleanup
      }
      throw error;
    }
  }
}

/**
 * Bring an installed copy of the plugin up to the bundled version, so updating the widget also
 * updates its bar plugin. Leaves the directory alone unless it holds this plugin.
 * @returns {boolean} whether files were replaced
 */
function updateInstalledOmarchyBarPlugin({ sourceDir, pluginDir, fsImpl = fs } = {}) {
  let installed;
  let bundled;
  try {
    installed = JSON.parse(fsImpl.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
    bundled = JSON.parse(fsImpl.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
  } catch {
    return false;
  }
  if (installed?.id !== OMARCHY_BAR_PLUGIN_ID || installed.version === bundled?.version) {
    return false;
  }
  installOmarchyBarPluginFiles({ sourceDir, pluginDir, fsImpl });
  return true;
}

module.exports = {
  OMARCHY_BAR_PLUGIN_ID,
  OMARCHY_BAR_STATUS_VERSION,
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
  isAllowedOmarchyBarAction,
  isOmarchyShellInstalled,
  parseOmarchyBarSocketLine,
  readOmarchyBarEntry,
  rememberOmarchyBarLaunch,
  resolveOmarchyBarEntities,
  updateInstalledOmarchyBarPlugin,
};
