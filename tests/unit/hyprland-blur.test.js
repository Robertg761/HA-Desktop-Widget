/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TOGGLE_FILE_CONTENT,
  TOGGLE_LUA,
  applyWidgetBlurRule,
  getBlurTogglePath,
  getDesktopBlurStatus,
  readHyprlandBlurEnabled,
  setDesktopBlur,
  widgetBlurRuleLua,
} = require('../../src/hyprland-blur.cjs');

// A fake execFile that answers hyprctl calls by their arguments.
function fakeHyprctl(answers) {
  const calls = [];
  const run = jest.fn((command, args, options, callback) => {
    calls.push(args);
    const key = args[0] === '-j' ? args.slice(1).join(' ') : args[0];
    const answer = answers[key];
    if (answer instanceof Error) callback(answer, '');
    else callback(null, answer ?? '');
  });
  return { run, calls };
}

describe('widgetBlurRuleLua', () => {
  it('blurs the layer surface and the fallback window when on', () => {
    const lua = widgetBlurRuleLua(true);
    expect(lua).toContain(
      'hl.layer_rule({ match = { namespace = "^ha-widget$" }, blur = true, ignore_alpha = 0.1 })'
    );
    expect(lua).toContain(
      'hl.window_rule({ match = { class = "^com\\\\.github\\\\.robertg761\\\\.hadesktopwidget$" }, no_blur = false })'
    );
  });

  it('appends the opposite rules when off', () => {
    const lua = widgetBlurRuleLua(false);
    expect(lua).toContain('blur = false');
    expect(lua).toContain('no_blur = true');
  });
});

describe('applyWidgetBlurRule', () => {
  it('sends the rule through hyprctl eval and reports whether Hyprland accepted it', async () => {
    const accepted = fakeHyprctl({ eval: 'ok\n' });
    await expect(applyWidgetBlurRule(true, { run: accepted.run })).resolves.toBe(true);
    expect(accepted.calls[0]).toEqual(['eval', widgetBlurRuleLua(true)]);

    const refused = fakeHyprctl({ eval: 'config option <eval> is unknown' });
    await expect(applyWidgetBlurRule(true, { run: refused.run })).resolves.toBe(false);

    const missing = fakeHyprctl({ eval: new Error('ENOENT') });
    await expect(applyWidgetBlurRule(true, { run: missing.run })).resolves.toBe(false);
  });
});

describe('readHyprlandBlurEnabled', () => {
  it.each([
    ['{"option": "decoration:blur:enabled", "bool": false, "set": true }', false],
    ['{"option": "decoration:blur:enabled", "bool": true, "set": true }', true],
    ['{"option": "decoration:blur:enabled", "int": 1, "set": true }', true],
    ['{"option": "decoration:blur:enabled", "int": 0, "set": true }', false],
    ['HYPRLAND_INSTANCE_SIGNATURE was not set!', null],
  ])('reads %s as %s', async (output, expected) => {
    const { run } = fakeHyprctl({ 'getoption decoration:blur:enabled': output });
    await expect(readHyprlandBlurEnabled({ run })).resolves.toBe(expected);
  });
});

describe('desktop blur toggle file', () => {
  let home;
  let toggleDir;
  const env = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'hypr-blur-'));
    toggleDir = path.join(home, '.local', 'state', 'omarchy', 'toggles', 'hypr');
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('cannot be managed without Omarchy toggles', async () => {
    const { run, calls } = fakeHyprctl({
      'getoption decoration:blur:enabled': '{"bool": false}',
    });
    await expect(getDesktopBlurStatus({ run, env, home })).resolves.toEqual({
      supported: true,
      enabled: false,
      canManage: false,
      managed: false,
    });
    await expect(setDesktopBlur(true, { run, env, home })).resolves.toEqual({
      success: false,
      error: 'unsupported',
    });
    expect(calls).toHaveLength(1);
  });

  it('writes the file and applies it without a reload, then removes it and reloads', async () => {
    fs.mkdirSync(toggleDir, { recursive: true });
    const { run, calls } = fakeHyprctl({ eval: 'ok', reload: 'ok' });
    const file = getBlurTogglePath({ env, home });
    expect(path.dirname(file)).toBe(toggleDir);

    await expect(setDesktopBlur(true, { run, env, home })).resolves.toEqual({ success: true });
    expect(fs.readFileSync(file, 'utf8')).toBe(TOGGLE_FILE_CONTENT);
    // hyprctl would take the file's leading "--" comment for a flag, so only the code is sent.
    expect(calls).toEqual([['eval', TOGGLE_LUA]]);
    expect(TOGGLE_LUA.trimStart().startsWith('-')).toBe(false);
    expect(TOGGLE_FILE_CONTENT.endsWith(TOGGLE_LUA)).toBe(true);

    await expect(setDesktopBlur(false, { run, env, home })).resolves.toEqual({ success: true });
    expect(fs.existsSync(file)).toBe(false);
    expect(calls[1]).toEqual(['reload']);
  });

  it('keeps blur off for every window, so only the widget changes', () => {
    expect(TOGGLE_FILE_CONTENT).toContain(
      'hl.config({ decoration = { blur = { enabled = true } } })'
    );
    expect(TOGGLE_FILE_CONTENT).toContain(
      'hl.window_rule({ match = { class = ".*" }, no_blur = true })'
    );
  });

  it('follows XDG_STATE_HOME', () => {
    expect(getBlurTogglePath({ env: { XDG_STATE_HOME: '/state' }, home })).toBe(
      path.join('/state', 'omarchy', 'toggles', 'hypr', 'ha-desktop-widget-blur.lua')
    );
  });

  it('reports the managed state once the file is in place', async () => {
    fs.mkdirSync(toggleDir, { recursive: true });
    fs.writeFileSync(getBlurTogglePath({ env, home }), TOGGLE_FILE_CONTENT);
    const { run } = fakeHyprctl({ 'getoption decoration:blur:enabled': '{"bool": true}' });
    await expect(getDesktopBlurStatus({ run, env, home })).resolves.toEqual({
      supported: true,
      enabled: true,
      canManage: true,
      managed: true,
    });
  });
});
