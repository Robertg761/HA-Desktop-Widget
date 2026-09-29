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
  createHyprlandBlurController,
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
  it.each([true, false])(
    'uses Hyprlang rules for preview %s when eval is unavailable',
    async (enabled) => {
      const { run, calls } = fakeHyprctl({ eval: 'unknown request', keyword: 'ok' });
      await expect(applyWidgetBlurRule(enabled, { run })).resolves.toBe(true);
      expect(calls).toEqual([
        ['eval', widgetBlurRuleLua(enabled)],
        [
          'keyword',
          'layerrule',
          `blur ${enabled ? 'on' : 'off'}, ignore_alpha 0.1, match:namespace ^ha-widget$`,
        ],
        [
          'keyword',
          'windowrule',
          `no_blur ${enabled ? 'off' : 'on'}, match:class ^com\\.github\\.robertg761\\.hadesktopwidget$`,
        ],
        ['keyword', 'windowrule[ha-desktop-widget-blur-refresh]:enable', '0'],
      ]);
    }
  );

  it('reports a failed Hyprlang rule and leaves an identical request retryable', async () => {
    const { run } = fakeHyprctl({ eval: 'unknown request', keyword: 'invalid rule' });
    const controller = createHyprlandBlurController({ run });
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(false);
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(false);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('reports a failed rule-engine refresh on Hyprlang', async () => {
    const run = jest.fn((_command, args, _options, callback) => {
      callback(
        null,
        args[0] === 'eval' ? 'unknown request' : args[1].includes('refresh') ? 'invalid rule' : 'ok'
      );
    });
    await expect(applyWidgetBlurRule(true, { run })).resolves.toBe(false);
    expect(run).toHaveBeenCalledTimes(4);
  });

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

  it.each([new Error('timeout'), 'reload failed'])(
    'restores the toggle after %s',
    async (failure) => {
      fs.mkdirSync(toggleDir, { recursive: true });
      const file = getBlurTogglePath({ env, home });
      const original = `${TOGGLE_FILE_CONTENT}\n-- Keep this exact content on failure.\n`;
      fs.writeFileSync(file, original);
      const { run } = fakeHyprctl({
        reload: failure,
        'getoption decoration:blur:enabled': '{"bool": true}',
      });

      await expect(setDesktopBlur(false, { run, env, home })).resolves.toEqual({
        success: false,
        error: 'hyprctl failed',
      });
      expect(fs.readFileSync(file, 'utf8')).toBe(original);
      await expect(getDesktopBlurStatus({ run, env, home })).resolves.toMatchObject({
        enabled: true,
        managed: true,
        canManage: true,
      });
      const retry = fakeHyprctl({ reload: 'ok' });
      await expect(setDesktopBlur(false, { run: retry.run, env, home })).resolves.toEqual({
        success: true,
      });
      expect(fs.existsSync(file)).toBe(false);
    }
  );

  it('does not create a toggle after a failed disable when none existed', async () => {
    fs.mkdirSync(toggleDir, { recursive: true });
    const { run } = fakeHyprctl({ reload: new Error('timeout') });
    await expect(setDesktopBlur(false, { run, env, home })).resolves.toMatchObject({
      success: false,
    });
    expect(fs.existsSync(getBlurTogglePath({ env, home }))).toBe(false);
  });
});

describe('Hyprland blur controller', () => {
  let home;
  const env = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'hypr-blur-controller-'));
    fs.mkdirSync(path.dirname(getBlurTogglePath({ env, home })), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reports a failed widget exception and clears that state after retrying enable', async () => {
    let failException = false;
    const run = jest.fn((_command, args, _options, callback) => {
      if (args[0] === '-j') return callback(null, '{"bool": true}');
      if (failException && args[1] === widgetBlurRuleLua(true)) {
        return callback(new Error('timeout'), '');
      }
      callback(null, 'ok');
    });
    const controller = createHyprlandBlurController({ run, env, home });
    await controller.applyWidgetBlur(true);
    failException = true;
    await expect(controller.setDesktopBlur(true)).resolves.toEqual({
      success: false,
      error: 'hyprctl failed',
    });
    await expect(controller.getDesktopBlurStatus()).resolves.toMatchObject({
      enabled: true,
      managed: true,
      widgetRuleFailed: true,
    });
    failException = false;
    await expect(controller.setDesktopBlur(true)).resolves.toEqual({ success: true });
    await expect(controller.getDesktopBlurStatus()).resolves.toMatchObject({
      enabled: true,
      managed: true,
      widgetRuleFailed: false,
    });
  });

  it('waits for each preview before starting the next, including a return to the initial state', async () => {
    const callbacks = [];
    const run = jest.fn((_command, _args, _options, callback) => callbacks.push(callback));
    const controller = createHyprlandBlurController({ run });
    const first = controller.applyWidgetBlur(true);
    const second = controller.applyWidgetBlur(false);
    const final = controller.applyWidgetBlur(true);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual(['eval', widgetBlurRuleLua(true)]);

    callbacks.shift()(null, 'ok');
    await first;
    await new Promise(setImmediate);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1]).toEqual(['eval', widgetBlurRuleLua(false)]);

    callbacks.shift()(null, 'ok');
    await second;
    await new Promise(setImmediate);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2][1]).toEqual(['eval', widgetBlurRuleLua(true)]);
    callbacks.shift()(null, 'ok');
    await expect(final).resolves.toBe(true);
    // Only a successfully applied state can suppress the next identical request.
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('retries an identical preview after Hyprland rejects the first attempt', async () => {
    let calls = 0;
    const run = jest.fn((_command, _args, _options, callback) =>
      callback(null, ++calls === 1 ? 'rejected' : 'ok')
    );
    const controller = createHyprlandBlurController({ run });
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(false);
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('reapplies the current preview %s after a reload', async (enabled) => {
    const { run, calls } = fakeHyprctl({ eval: 'ok' });
    const controller = createHyprlandBlurController({ run });
    await controller.applyWidgetBlur(enabled);
    await controller.reapplyWidgetBlur();
    expect(calls).toEqual([
      ['eval', widgetBlurRuleLua(enabled)],
      ['eval', widgetBlurRuleLua(enabled)],
    ]);
  });

  it.each([true, false])(
    'reapplies the widget exception after enabling with preview %s',
    async (enabled) => {
      const { run, calls } = fakeHyprctl({ eval: 'ok' });
      const controller = createHyprlandBlurController({ run, env, home });
      await controller.applyWidgetBlur(enabled);
      await expect(controller.setDesktopBlur(true)).resolves.toEqual({ success: true });
      expect(calls).toEqual([
        ['eval', widgetBlurRuleLua(enabled)],
        ['eval', TOGGLE_LUA],
        ['eval', widgetBlurRuleLua(enabled)],
      ]);
    }
  );

  it('keeps toggle application and its widget exception ahead of a concurrent preview', async () => {
    const callbacks = [];
    const run = jest.fn((_command, _args, _options, callback) => callbacks.push(callback));
    const controller = createHyprlandBlurController({ run, env, home });
    const toggle = controller.setDesktopBlur(true);
    await Promise.resolve();
    const preview = controller.applyWidgetBlur(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][1]).toEqual(['eval', TOGGLE_LUA]);

    callbacks.shift()(null, 'ok');
    await new Promise(setImmediate);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1]).toEqual(['eval', widgetBlurRuleLua(true)]);
    callbacks.shift()(null, 'ok');
    await expect(toggle).resolves.toEqual({ success: true });
    await expect(preview).resolves.toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reapplies the preview after disabling, including when reload recovery is also queued', async () => {
    const { run, calls } = fakeHyprctl({ eval: 'ok', reload: 'ok' });
    const controller = createHyprlandBlurController({ run, env, home });
    await controller.applyWidgetBlur(true);
    const disable = controller.setDesktopBlur(false);
    const recovery = controller.reapplyWidgetBlur();
    await expect(disable).resolves.toEqual({ success: true });
    await expect(recovery).resolves.toBe(true);
    expect(calls).toEqual([
      ['eval', widgetBlurRuleLua(true)],
      ['reload'],
      ['eval', widgetBlurRuleLua(true)],
      ['eval', widgetBlurRuleLua(true)],
    ]);
  });

  it('invalidates the cached widget rule after a failed toggle command', async () => {
    const { run, calls } = fakeHyprctl({ eval: 'ok', reload: new Error('timeout') });
    const controller = createHyprlandBlurController({ run, env, home });
    await controller.applyWidgetBlur(true);
    await expect(controller.setDesktopBlur(false)).resolves.toMatchObject({ success: false });
    await expect(controller.applyWidgetBlur(true)).resolves.toBe(true);
    expect(calls).toEqual([
      ['eval', widgetBlurRuleLua(true)],
      ['reload'],
      ['eval', widgetBlurRuleLua(true)],
    ]);
  });
});
