/* global process */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { APP_ID } = require('./linux-desktop.cjs');
const { createSerializedTaskRunner } = require('./serialized-task-runner.cjs');

// Chromium cannot blur what is behind its own window: backdrop-filter only sees the page. On
// Hyprland the compositor has to do it, which takes a rule for the widget's surface and blur
// switched on in the compositor's config. Omarchy ships with blur off for every window.

const LAYER_NAMESPACE = 'ha-widget';
// Pixels more transparent than this are not blurred. The widget's glass tint never goes below
// ~0.16 alpha (see applyWindowEffects in src/ui-utils.js), while its rounded corners and the
// soft edge of its shadow do, so this keeps the blur inside the visible glass.
const IGNORE_ALPHA = 0.1;
const TOGGLE_FILE_NAME = 'ha-desktop-widget-blur.lua';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lua for Hyprland's eval that turns blur on or off for the widget alone: the layer surface in
 * layer-shell mode, the window when it falls back to a floating window. A later rule overrides an
 * earlier one, so turning it off appends the opposite rule rather than removing anything.
 */
function widgetBlurRuleLua(enabled) {
  const on = !!enabled;
  const windowClass = `^${escapeRegex(APP_ID)}$`.replace(/\\/g, '\\\\');
  return [
    `hl.layer_rule({ match = { namespace = "^${LAYER_NAMESPACE}$" }, blur = ${on}, ignore_alpha = ${IGNORE_ALPHA} })`,
    `hl.window_rule({ match = { class = "${windowClass}" }, no_blur = ${!on} })`,
  ].join('\n');
}

// Blur on for the compositor, off for every window: only the widget's own surface, which asks for
// it itself, ends up blurred.
const TOGGLE_LUA = `hl.config({ decoration = { blur = { enabled = true } } })
hl.window_rule({ match = { class = ".*" }, no_blur = true })
`;

// Loaded by Omarchy after the user's own config, from the directory its own toggles use. Only
// TOGGLE_LUA is sent to hyprctl eval: hyprctl reads an argument that starts with "--" as a flag.
const TOGGLE_FILE_CONTENT = `-- Written by HA Desktop Widget, from "Turn on blur for the widget" in its Settings.
-- Omarchy ships with Hyprland's blur off. This turns blur on but keeps it off for every
-- window, so only the widget's own surface is blurred; the widget asks for that itself.
-- Delete this file (or use the same setting) to undo it.
${TOGGLE_LUA}`;

function getOmarchyToggleDir({ env = process.env, home = os.homedir() } = {}) {
  const stateHome = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  return path.join(stateHome, 'omarchy', 'toggles', 'hypr');
}

function getBlurTogglePath(options) {
  return path.join(getOmarchyToggleDir(options), TOGGLE_FILE_NAME);
}

function runHyprctl(args, run = execFile) {
  return new Promise((resolve) => {
    try {
      run('hyprctl', args, { encoding: 'utf8', timeout: 2000 }, (error, stdout) =>
        resolve(error ? null : String(stdout || '').trim())
      );
    } catch {
      resolve(null);
    }
  });
}

/** Ask Hyprland to blur (or stop blurring) the widget. Resolves true when it accepted the rule. */
async function applyWidgetBlurRule(enabled, { run } = {}) {
  const result = await runHyprctl(['eval', widgetBlurRuleLua(enabled)], run);
  if (result !== 'unknown request') return result === 'ok';
  // Hyprlang-based Hyprland releases have no eval command. Use their dynamic
  // rules only when the compositor explicitly reports that eval is unavailable.
  const on = enabled ? 'on' : 'off';
  const windowClass = `^${escapeRegex(APP_ID)}$`;
  const rules = [
    ['layerrule', `blur ${on}, ignore_alpha ${IGNORE_ALPHA}, match:namespace ^${LAYER_NAMESPACE}$`],
    ['windowrule', `no_blur ${enabled ? 'off' : 'on'}, match:class ${windowClass}`],
    // Hyprland 0.53 caches inline layer rules until a named window rule update
    // rebuilds the rule engine. This disabled rule refreshes both widget rules.
    ['windowrule[ha-desktop-widget-blur-refresh]:enable', '0'],
  ];
  for (const [keyword, rule] of rules) {
    if ((await runHyprctl(['keyword', keyword, rule], run)) !== 'ok') return false;
  }
  return true;
}

/** Hyprland's decoration:blur:enabled, or null when it cannot be read. */
async function readHyprlandBlurEnabled({ run } = {}) {
  const output = await runHyprctl(['-j', 'getoption', 'decoration:blur:enabled'], run);
  try {
    const option = JSON.parse(output);
    if (typeof option.bool === 'boolean') return option.bool;
    if (typeof option.int === 'number') return option.int !== 0;
  } catch {
    /* not JSON: an older hyprctl or no compositor */
  }
  return null;
}

/**
 * What Settings needs to say about desktop blur. `canManage` is true on Omarchy, whose toggles
 * directory gives the widget a file it can add and remove without touching the user's config;
 * `managed` is true while that file is in place.
 */
async function getDesktopBlurStatus({ run, env, home, exists = fs.existsSync } = {}) {
  const enabled = await readHyprlandBlurEnabled({ run });
  return {
    supported: enabled !== null,
    enabled: !!enabled,
    canManage: exists(getOmarchyToggleDir({ env, home })),
    managed: exists(getBlurTogglePath({ env, home })),
  };
}

/**
 * Turn Hyprland's blur on for the widget (Omarchy only), or undo that. Turning it on applies the
 * toggle file's Lua straight away, so nothing reloads; turning it off reloads Hyprland, the same
 * as Omarchy's own toggles, which drops the rules the file added.
 */
async function setDesktopBlur(enabled, { run, env, home, fsApi = fs } = {}) {
  const dir = getOmarchyToggleDir({ env, home });
  const file = getBlurTogglePath({ env, home });
  if (!fsApi.existsSync(dir)) return { success: false, error: 'unsupported' };
  let previousContent = null;
  try {
    if (enabled) fsApi.writeFileSync(file, TOGGLE_FILE_CONTENT);
    else {
      if (fsApi.existsSync(file)) previousContent = fsApi.readFileSync(file);
      fsApi.rmSync(file, { force: true });
    }
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
  const applied = enabled
    ? await runHyprctl(['eval', TOGGLE_LUA], run)
    : await runHyprctl(['reload'], run);
  // A failed reload can leave the runtime rules active. Keep the toggle owned by the app
  // so Settings still offers a way to retry instead of hiding the control.
  if (applied !== 'ok' && previousContent !== null) {
    try {
      fsApi.writeFileSync(file, previousContent);
    } catch (error) {
      return { success: false, error: `hyprctl failed; ${error?.message || String(error)}` };
    }
  }
  return applied === 'ok' ? { success: true } : { success: false, error: 'hyprctl failed' };
}

/** Serialize previews, toggle changes and reload recovery so later rules win in request order. */
function createHyprlandBlurController(options = {}) {
  const runSerialized = createSerializedTaskRunner();
  let desiredWidgetBlur = false;
  let appliedWidgetBlur = null;
  let widgetRuleFailed = false;

  async function apply(enabled, force = false) {
    if (!force && appliedWidgetBlur === enabled) return true;
    const accepted = await applyWidgetBlurRule(enabled, options);
    appliedWidgetBlur = accepted ? enabled : null;
    widgetRuleFailed = !accepted;
    return accepted;
  }

  return {
    async getDesktopBlurStatus() {
      const status = await getDesktopBlurStatus(options);
      return { ...status, widgetRuleFailed: desiredWidgetBlur && widgetRuleFailed };
    },
    applyWidgetBlur(enabled) {
      const requested = !!enabled;
      desiredWidgetBlur = requested;
      return runSerialized(() => apply(requested));
    },
    reapplyWidgetBlur() {
      // Use the current preview, which can differ from saved config while Settings is open.
      return runSerialized(() => apply(desiredWidgetBlur, true));
    },
    setDesktopBlur(enabled) {
      return runSerialized(async () => {
        // Even a failed command may have changed some compositor state.
        appliedWidgetBlur = null;
        const result = await setDesktopBlur(enabled, options);
        if (!result.success) {
          widgetRuleFailed = desiredWidgetBlur;
          return result;
        }
        // Enabling adds a blanket no_blur rule; reloading discards runtime rules. In both
        // cases the widget exception must be sent again, even if its desired state is unchanged.
        const accepted = await apply(desiredWidgetBlur, true);
        return accepted ? result : { success: false, error: 'hyprctl failed' };
      });
    },
  };
}

module.exports = {
  LAYER_NAMESPACE,
  TOGGLE_FILE_CONTENT,
  TOGGLE_LUA,
  applyWidgetBlurRule,
  createHyprlandBlurController,
  getBlurTogglePath,
  getDesktopBlurStatus,
  readHyprlandBlurEnabled,
  setDesktopBlur,
  widgetBlurRuleLua,
};
