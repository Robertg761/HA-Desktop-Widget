/* global console, process, setTimeout, clearTimeout, setInterval, clearInterval */

// Omarchy 4 bar plugin support. The plugin (omarchy-plugin/ in this repository) is QML running
// inside the Omarchy shell, with no Home Assistant connection or credentials of its own. The
// widget publishes a small status file for it under XDG_RUNTIME_DIR, and the plugin sends
// requests back by running the widget's own command line (`--toggle`, `--entity-toggle=<id>`),
// which the single-instance handler forwards to the running widget.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appId: APP_ID } = require('../package.json');

const OMARCHY_BAR_PLUGIN_ID = APP_ID;
const OMARCHY_BAR_STATUS_VERSION = 1;
const PLUGIN_FILES = Object.freeze(['manifest.json', 'Widget.qml']);
const MAX_PANEL_ENTITIES = 24;
const DEFAULT_PANEL_FAVORITES = 12;
const MAX_BAR_ENTITIES = 4;
const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;
// Domains the widget's toggle action (src/ui.js toggleEntity) turns on and off.
const TOGGLEABLE_DOMAINS = new Set(['fan', 'input_boolean', 'light', 'switch']);
const ENTITY_TOGGLE_ARG = '--entity-toggle';

function getOmarchyBarPaths({ env = process.env, home = os.homedir() } = {}) {
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const stateHome = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  const runtimeDir = env.XDG_RUNTIME_DIR || '';
  return {
    shellConfig: path.join(configHome, 'omarchy', 'shell.json'),
    pluginDir: path.join(configHome, 'omarchy', 'plugins', OMARCHY_BAR_PLUGIN_ID),
    statusFile: runtimeDir ? path.join(runtimeDir, 'ha-desktop-widget', 'omarchy-bar.json') : '',
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

/** Entities the panel lists (default: the first Quick Access favorites) and the bar shows. */
function resolveOmarchyBarEntities(entry, favoriteEntities = []) {
  const panel =
    entry?.entities || normalizeEntityIds(favoriteEntities, DEFAULT_PANEL_FAVORITES) || [];
  const bar = entry?.barEntities || [];
  return { panel, bar, all: [...new Set([...bar, ...panel])] };
}

function capitalize(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ') : '';
}

function describeOmarchyBarEntity(entityId, entity, customName = '') {
  const attributes =
    entity?.attributes && typeof entity.attributes === 'object' ? entity.attributes : {};
  const name =
    (typeof customName === 'string' && customName.trim()) ||
    (typeof attributes.friendly_name === 'string' && attributes.friendly_name.trim()) ||
    entityId;
  const state = typeof entity?.state === 'string' ? entity.state : '';
  const unit =
    typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : '';
  const numeric = state !== '' && Number.isFinite(Number(state));
  const value = !entity ? '' : numeric ? `${state}${unit ? ` ${unit}` : ''}` : capitalize(state);
  const domain = entityId.split('.')[0];
  return {
    id: entityId,
    name: name.slice(0, 80),
    state: state.slice(0, 64),
    value: value.slice(0, 64),
    available: !!entity && state !== 'unavailable' && state !== 'unknown',
    active: state === 'on' || state === 'open' || state === 'playing',
    toggleable: !!entity && TOGGLEABLE_DOMAINS.has(domain) && state !== 'unavailable',
  };
}

function buildOmarchyBarStatus({
  connection = 'connecting',
  states = new Map(),
  entities = { panel: [], bar: [] },
  customEntityNames = {},
  launch = null,
  now = Date.now(),
} = {}) {
  const describe = (entityId) =>
    describeOmarchyBarEntity(entityId, states.get(entityId), customEntityNames?.[entityId]);
  return {
    version: OMARCHY_BAR_STATUS_VERSION,
    updatedAt: now,
    connection,
    launch: Array.isArray(launch) && launch.length ? launch : null,
    panel: entities.panel.map(describe),
    bar: entities.bar.map(describe),
  };
}

/** The entity a `--entity-toggle=<id>` argument asks for, or ''. */
function getEntityToggleRequest(argv = []) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== 'string') continue;
    let value = null;
    if (argument.startsWith(`${ENTITY_TOGGLE_ARG}=`)) {
      value = argument.slice(ENTITY_TOGGLE_ARG.length + 1);
    } else if (argument === ENTITY_TOGGLE_ARG && typeof argv[index + 1] === 'string') {
      value = argv[index + 1];
    }
    if (value !== null) {
      const id = value.trim().toLowerCase();
      return ENTITY_ID_PATTERN.test(id) ? id : '';
    }
  }
  return '';
}

/** Bar requests may only toggle an entity the bar shows, in a domain with a toggle service. */
function isAllowedOmarchyBarToggle(entityId, entities) {
  if (!entityId || !entities?.all?.includes(entityId)) return false;
  return TOGGLEABLE_DOMAINS.has(entityId.split('.')[0]);
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
  for (const file of PLUGIN_FILES) {
    fsImpl.copyFileSync(path.join(sourceDir, file), path.join(pluginDir, file));
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
  ENTITY_TOGGLE_ARG,
  OMARCHY_BAR_PLUGIN_ID,
  OMARCHY_BAR_STATUS_VERSION,
  PLUGIN_FILES,
  TOGGLEABLE_DOMAINS,
  buildOmarchyBarStatus,
  createOmarchyBarPublisher,
  describeOmarchyBarEntity,
  getEntityToggleRequest,
  getOmarchyBarPaths,
  installOmarchyBarPluginFiles,
  isAllowedOmarchyBarToggle,
  isOmarchyShellInstalled,
  readOmarchyBarEntry,
  rememberOmarchyBarLaunch,
  resolveOmarchyBarEntities,
  updateInstalledOmarchyBarPlugin,
};
