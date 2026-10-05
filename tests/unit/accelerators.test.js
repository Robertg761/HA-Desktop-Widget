/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const {
  acceleratorFromKeyEvent,
  acceleratorToUiohookParts,
  acceleratorsConflict,
  formatAccelerator,
  formatRequiredModifiers,
  normalizeAccelerator,
  parseAccelerator,
  validateAccelerator,
} = require('../../src/accelerators.cjs');

const PLATFORMS = ['win32', 'darwin', 'linux'];

describe('accelerator model', () => {
  describe('normalizeAccelerator', () => {
    it.each(PLATFORMS)('gives every spelling of the Meta key one form on %s', (platform) => {
      const spellings = [
        'Command+K',
        'Cmd+K',
        'Super+K',
        'Meta+K',
        'Win+K',
        'Windows+K',
        'super+k',
      ];
      expect(spellings.map((value) => normalizeAccelerator(value, platform))).toEqual(
        spellings.map(() => 'meta+k')
      );
    });

    it('puts the modifiers in one order and lower-cases the key', () => {
      expect(normalizeAccelerator('Shift+Alt+Ctrl+Super+X', 'linux')).toBe('ctrl+alt+shift+meta+x');
      expect(normalizeAccelerator('Option+Control+k', 'darwin')).toBe('ctrl+alt+k');
    });

    it('resolves CommandOrControl to the platform key', () => {
      expect(normalizeAccelerator('CommandOrControl+K', 'darwin')).toBe('meta+k');
      expect(normalizeAccelerator('CmdOrCtrl+K', 'darwin')).toBe('meta+k');
      expect(normalizeAccelerator('CommandOrControl+K', 'win32')).toBe('ctrl+k');
      expect(normalizeAccelerator('CmdOrCtrl+K', 'linux')).toBe('ctrl+k');
    });

    it('gives the aliases of a key one name', () => {
      expect(normalizeAccelerator('Ctrl+Esc', 'linux')).toBe('ctrl+escape');
      expect(normalizeAccelerator('Ctrl+Escape', 'linux')).toBe('ctrl+escape');
      expect(normalizeAccelerator('Alt+Return', 'linux')).toBe('alt+enter');
      expect(normalizeAccelerator('Alt+ArrowUp', 'linux')).toBe('alt+up');
      expect(normalizeAccelerator('Alt+Up', 'linux')).toBe('alt+up');
    });

    it.each([[''], ['   '], ['Ctrl++K'], ['Ctrl+'], ['Ctrl+Shift'], ['K+L'], [null], [undefined]])(
      'has no form for the unusable value %p',
      (value) => {
        expect(normalizeAccelerator(value, 'linux')).toBe('');
      }
    );
  });

  describe('acceleratorsConflict', () => {
    it('treats Command+K and Super+K as the one chord', () => {
      expect(acceleratorsConflict('Command+K', 'Super+K', 'darwin')).toBe(true);
      expect(acceleratorsConflict('Command+K', 'Super+K', 'win32')).toBe(true);
      expect(acceleratorsConflict('Ctrl+Alt+K', 'Alt+Control+k', 'linux')).toBe(true);
    });

    it('treats CommandOrControl as Ctrl on Windows and Linux but not on a Mac', () => {
      expect(acceleratorsConflict('CommandOrControl+K', 'Ctrl+K', 'win32')).toBe(true);
      expect(acceleratorsConflict('CommandOrControl+K', 'Ctrl+K', 'darwin')).toBe(false);
      expect(acceleratorsConflict('CommandOrControl+K', 'Cmd+K', 'darwin')).toBe(true);
    });

    it('does not report different chords, or two unusable values, as a clash', () => {
      expect(acceleratorsConflict('Ctrl+K', 'Ctrl+Shift+K', 'linux')).toBe(false);
      expect(acceleratorsConflict('Ctrl+K', 'Alt+K', 'linux')).toBe(false);
      expect(acceleratorsConflict('', '', 'linux')).toBe(false);
      expect(acceleratorsConflict('Ctrl+', 'Ctrl+', 'linux')).toBe(false);
      expect(acceleratorsConflict(undefined, 'Ctrl+K', 'linux')).toBe(false);
    });
  });

  describe('validateAccelerator', () => {
    it('accepts an ordinary modifier and key', () => {
      for (const platform of PLATFORMS) {
        expect(validateAccelerator('Ctrl+Alt+K', platform)).toEqual({ valid: true, reason: '' });
        expect(validateAccelerator('Ctrl+Shift+Space', platform).valid).toBe(true);
        expect(validateAccelerator('Super+K', platform).valid).toBe(true);
        expect(validateAccelerator('Alt+F9', platform).valid).toBe(true);
      }
    });

    it.each(['Shift+A', 'Shift+1', 'Shift+Space', 'Shift+F5'])(
      'rejects %s, which would take a typing key system-wide',
      (hotkey) => {
        for (const platform of PLATFORMS) {
          expect(validateAccelerator(hotkey, platform)).toEqual({
            valid: false,
            reason: 'modifier',
          });
        }
      }
    );

    it('rejects a key alone as missing a modifier, and a chord with several keys as malformed', () => {
      expect(validateAccelerator('K', 'linux')).toEqual({ valid: false, reason: 'modifier' });
      expect(validateAccelerator('F9', 'linux')).toEqual({ valid: false, reason: 'modifier' });
      expect(validateAccelerator('Ctrl+K+L', 'linux')).toEqual({ valid: false, reason: 'format' });
      expect(validateAccelerator('Ctrl+Shift', 'linux')).toEqual({
        valid: false,
        reason: 'format',
      });
      expect(validateAccelerator('', 'linux')).toEqual({ valid: false, reason: 'format' });
      expect(validateAccelerator(undefined, 'linux')).toEqual({ valid: false, reason: 'format' });
    });

    it.each(['Command+C', 'Super+C', 'Cmd+V', 'Command+Q', 'Cmd+W', 'Command+H', 'Command+M'])(
      'keeps %s from being taken from every Mac application',
      (hotkey) => {
        expect(validateAccelerator(hotkey, 'darwin')).toEqual({ valid: false, reason: 'reserved' });
      }
    );

    it('reserves the Mac chords in any spelling, including the platform key', () => {
      expect(validateAccelerator('CommandOrControl+Q', 'darwin').reason).toBe('reserved');
      expect(validateAccelerator('Cmd+Tab', 'darwin').reason).toBe('reserved');
      expect(validateAccelerator('Command+Space', 'darwin').reason).toBe('reserved');
      expect(validateAccelerator('Command+Shift+4', 'darwin').reason).toBe('reserved');
      expect(validateAccelerator('Cmd+Option+Esc', 'darwin').reason).toBe('reserved');
    });

    it('does not reserve the Mac chords on other platforms, where Super+Q is a launcher key', () => {
      expect(validateAccelerator('Super+Q', 'win32').valid).toBe(true);
      expect(validateAccelerator('Super+Q', 'linux').valid).toBe(true);
      expect(validateAccelerator('Super+Space', 'linux').valid).toBe(true);
    });

    it.each(['Super+L', 'Win+R', 'Windows+E', 'Super+D', 'Super+M', 'Super+Tab'])(
      'reserves %s on Windows, now that the recorders say Super and not Win',
      (hotkey) => {
        expect(validateAccelerator(hotkey, 'win32')).toEqual({ valid: false, reason: 'reserved' });
      }
    );

    it('leaves Super chords to the desktop on Linux and the Mac', () => {
      expect(validateAccelerator('Super+L', 'linux').valid).toBe(true);
      expect(validateAccelerator('Command+L', 'darwin').valid).toBe(true);
    });

    it.each(PLATFORMS)(
      'keeps the editing and window-switching shortcuts reserved on %s',
      (platform) => {
        for (const hotkey of [
          'Ctrl+C',
          'ctrl+v',
          'Control+X',
          'Ctrl+Z',
          'Ctrl+W',
          'Alt+F4',
          'Alt+Tab',
          'Ctrl+Tab',
          'Ctrl+Shift+Tab',
          'Alt+Shift+Tab',
          'Ctrl+Alt+Del',
          'Ctrl+Alt+Delete',
        ]) {
          expect(validateAccelerator(hotkey, platform).reason).toBe('reserved');
        }
      }
    );
  });

  describe('acceleratorFromKeyEvent', () => {
    const keydown = (init) => ({
      key: '',
      code: '',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false,
      ...init,
    });

    it('records Space, which an e.key recorder turned into "Ctrl+Shift+ "', () => {
      const recorded = acceleratorFromKeyEvent(
        keydown({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
        'linux'
      );
      expect(recorded).toEqual({
        accelerator: 'Ctrl+Shift+Space',
        key: 'Space',
        complete: true,
        needsModifier: false,
      });
    });

    it('records the arrows by the names accelerators use', () => {
      const names = {
        ArrowUp: 'Up',
        ArrowDown: 'Down',
        ArrowLeft: 'Left',
        ArrowRight: 'Right',
      };
      for (const [code, name] of Object.entries(names)) {
        expect(
          acceleratorFromKeyEvent(keydown({ key: code, code, ctrlKey: true }), 'win32').accelerator
        ).toBe(`Ctrl+${name}`);
      }
    });

    it('records Shift+digit as the digit, not the symbol on the key', () => {
      expect(
        acceleratorFromKeyEvent(
          keydown({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }),
          'linux'
        ).accelerator
      ).toBe('Ctrl+Shift+1');
    });

    it("records a Mac's Option+letter as the letter, not the composed glyph", () => {
      expect(
        acceleratorFromKeyEvent(keydown({ key: 'å', code: 'KeyA', altKey: true }), 'darwin')
          .accelerator
      ).toBe('Alt+A');
      expect(
        acceleratorFromKeyEvent(keydown({ key: '˙', code: 'KeyH', altKey: true }), 'darwin').key
      ).toBe('H');
    });

    it('records letters, digits, function keys, the numpad and punctuation by position', () => {
      const record = (code, extra = {}) =>
        acceleratorFromKeyEvent(keydown({ code, ctrlKey: true, ...extra }), 'linux').accelerator;
      expect(record('KeyQ')).toBe('Ctrl+Q');
      expect(record('Digit0')).toBe('Ctrl+0');
      expect(record('F12')).toBe('Ctrl+F12');
      expect(record('F24')).toBe('Ctrl+F24');
      expect(record('Numpad7')).toBe('Ctrl+num7');
      expect(record('NumpadAdd')).toBe('Ctrl+numadd');
      expect(record('Minus')).toBe('Ctrl+-');
      expect(record('Backquote')).toBe('Ctrl+`');
      expect(record('BracketLeft')).toBe('Ctrl+[');
      expect(record('Slash')).toBe('Ctrl+/');
      expect(record('PageDown')).toBe('Ctrl+PageDown');
    });

    it('names the Meta key Command on a Mac and Super on Windows and Linux', () => {
      const event = keydown({ key: 'k', code: 'KeyK', metaKey: true, altKey: true });
      expect(acceleratorFromKeyEvent(event, 'darwin').accelerator).toBe('Alt+Command+K');
      expect(acceleratorFromKeyEvent(event, 'win32').accelerator).toBe('Alt+Super+K');
      expect(acceleratorFromKeyEvent(event, 'linux').accelerator).toBe('Alt+Super+K');
    });

    it('records the same physical chord as the same accelerator on every platform', () => {
      const event = keydown({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true });
      const normalized = PLATFORMS.map((platform) =>
        normalizeAccelerator(acceleratorFromKeyEvent(event, platform).accelerator, platform)
      );
      expect(new Set(normalized).size).toBe(1);
    });

    it('shows the modifiers held before a key, without finishing', () => {
      const recorded = acceleratorFromKeyEvent(
        keydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true }),
        'linux'
      );
      expect(recorded).toEqual({
        accelerator: 'Ctrl',
        key: '',
        complete: false,
        needsModifier: false,
      });
    });

    it('asks for a modifier when a key comes with nothing or only Shift', () => {
      const bare = acceleratorFromKeyEvent(keydown({ key: 'a', code: 'KeyA' }), 'linux');
      expect(bare).toEqual({
        accelerator: 'A',
        key: 'A',
        complete: false,
        needsModifier: true,
      });
      const shifted = acceleratorFromKeyEvent(
        keydown({ key: 'A', code: 'KeyA', shiftKey: true }),
        'linux'
      );
      expect(shifted.complete).toBe(false);
      expect(shifted.needsModifier).toBe(true);
      expect(shifted.accelerator).toBe('Shift+A');
    });

    it('ignores keys no accelerator can name', () => {
      const unnamed = {
        CapsLock: 'CapsLock',
        ContextMenu: 'ContextMenu',
        NumLock: 'NumLock',
        AudioVolumeUp: 'AudioVolumeUp',
        // The yen key and an IME's keys name nothing Electron can register.
        IntlYen: '¥',
        Lang1: 'Unidentified',
        KeyA: 'Process',
      };
      for (const platform of PLATFORMS) {
        for (const [code, key] of Object.entries(unnamed)) {
          const recorded = acceleratorFromKeyEvent(keydown({ key, code, ctrlKey: true }), platform);
          // KeyA is a mapped code: the layout fallback must not run when the code names the key.
          expect(recorded.key).toBe(code === 'KeyA' ? 'A' : '');
          expect(recorded.complete).toBe(code === 'KeyA');
        }
      }
    });

    it('records an ISO, Japanese or numpad key by the name its layout gives it', () => {
      const layouts = [
        // The extra ISO key beside the left Shift: "<" on a German layout, "\\" on a British one.
        ['IntlBackslash', '<', 'Ctrl+<'],
        ['IntlBackslash', '\\', 'Ctrl+\\'],
        ['IntlRo', '\\', 'Ctrl+\\'],
        ['NumpadEnter', 'Enter', 'Ctrl+Enter'],
      ];
      for (const platform of PLATFORMS) {
        for (const [code, key, accelerator] of layouts) {
          const recorded = acceleratorFromKeyEvent(keydown({ key, code, ctrlKey: true }), platform);
          expect(recorded).toEqual({
            accelerator,
            key: accelerator.slice('Ctrl+'.length),
            complete: true,
            needsModifier: false,
          });
          expect(validateAccelerator(recorded.accelerator, platform).valid).toBe(true);
        }
      }
    });

    it('asks for a modifier on an international key pressed alone, and ignores a composed glyph', () => {
      expect(
        acceleratorFromKeyEvent(keydown({ key: '<', code: 'IntlBackslash' }), 'win32')
      ).toEqual({
        accelerator: '<',
        key: '<',
        complete: false,
        needsModifier: true,
      });
      // A Mac's Option turns the key into a glyph outside ASCII, which nothing can register.
      const composed = acceleratorFromKeyEvent(
        keydown({ key: '≤', code: 'IntlBackslash', altKey: true }),
        'darwin'
      );
      expect(composed.key).toBe('');
      expect(composed.complete).toBe(false);
    });

    it('falls back to the key name when an event has no code', () => {
      expect(
        acceleratorFromKeyEvent({ key: 'k', ctrlKey: true, altKey: false }, 'linux').accelerator
      ).toBe('Ctrl+K');
      expect(acceleratorFromKeyEvent({ key: ' ', ctrlKey: true }, 'linux').accelerator).toBe(
        'Ctrl+Space'
      );
      expect(acceleratorFromKeyEvent({ key: 'ArrowUp', altKey: true }, 'linux').accelerator).toBe(
        'Alt+Up'
      );
      expect(acceleratorFromKeyEvent({ key: 'Control', ctrlKey: true }, 'linux').key).toBe('');
    });

    it('produces accelerators that pass the validator when they are complete', () => {
      const event = keydown({ key: ' ', code: 'Space', ctrlKey: true, altKey: true });
      for (const platform of PLATFORMS) {
        const { accelerator, complete } = acceleratorFromKeyEvent(event, platform);
        expect(complete).toBe(true);
        expect(validateAccelerator(accelerator, platform).valid).toBe(true);
      }
    });
  });

  describe('formatAccelerator', () => {
    it('names the keys as each keyboard prints them', () => {
      expect(formatAccelerator('Ctrl+Alt+Super+K', 'darwin')).toBe('Control+Option+Cmd+K');
      expect(formatAccelerator('Ctrl+Alt+Super+K', 'win32')).toBe('Ctrl+Alt+Win+K');
      expect(formatAccelerator('Ctrl+Alt+Super+K', 'linux')).toBe('Ctrl+Alt+Super+K');
    });

    it('reads a Mac-recorded Command chord on Windows as the Windows key', () => {
      expect(formatAccelerator('Command+K', 'win32')).toBe('Win+K');
      expect(formatAccelerator('Command+K', 'darwin')).toBe('Cmd+K');
    });

    it('resolves CommandOrControl for the platform', () => {
      expect(formatAccelerator('CommandOrControl+Shift+L', 'darwin')).toBe('Shift+Cmd+L');
      expect(formatAccelerator('CommandOrControl+Shift+L', 'win32')).toBe('Ctrl+Shift+L');
    });

    it('names keys the way a person reads them', () => {
      expect(formatAccelerator('ctrl+space', 'linux')).toBe('Ctrl+Space');
      expect(formatAccelerator('Ctrl+Up', 'linux')).toBe('Ctrl+Up');
      expect(formatAccelerator('Ctrl+f5', 'linux')).toBe('Ctrl+F5');
      expect(formatAccelerator('Ctrl+num7', 'linux')).toBe('Ctrl+Num7');
      expect(formatAccelerator('Ctrl+numadd', 'linux')).toBe('Ctrl+NumAdd');
      expect(formatAccelerator('Ctrl+Esc', 'linux')).toBe('Ctrl+Esc');
      expect(formatAccelerator('Ctrl+pageup', 'linux')).toBe('Ctrl+PageUp');
    });

    it('shows modifiers held before the key in the same words', () => {
      expect(formatAccelerator('Ctrl+Command', 'darwin')).toBe('Control+Cmd');
      expect(formatAccelerator('Shift', 'win32')).toBe('Shift');
    });

    it('returns what is not an accelerator as it is', () => {
      expect(formatAccelerator('', 'linux')).toBe('');
      expect(formatAccelerator(undefined, 'linux')).toBe('');
      expect(formatAccelerator('Ctrl+K+L', 'linux')).toBe('Ctrl+K+L');
      expect(formatAccelerator('Press keys...', 'linux')).toBe('Press keys...');
    });

    it('treats a platform it has no table for like Linux', () => {
      expect(formatAccelerator('Super+K', 'freebsd')).toBe('Super+K');
      expect(formatRequiredModifiers('freebsd')).toBe('Ctrl/Alt/Super');
    });
  });

  describe('formatRequiredModifiers', () => {
    it('lists the keys a hotkey can start from, by platform', () => {
      expect(formatRequiredModifiers('win32')).toBe('Ctrl/Alt/Win');
      expect(formatRequiredModifiers('darwin')).toBe('Control/Option/Cmd');
      expect(formatRequiredModifiers('linux')).toBe('Ctrl/Alt/Super');
    });
  });

  describe('parseAccelerator', () => {
    it('reports a chord with no key as partial and an empty part as nothing', () => {
      expect(parseAccelerator('Ctrl+Shift', 'linux')).toEqual({
        modifiers: ['ctrl', 'shift'],
        key: '',
        valid: false,
        partial: true,
      });
      expect(parseAccelerator('Ctrl++K', 'linux')).toEqual({
        modifiers: [],
        key: '',
        valid: false,
        partial: false,
      });
    });
  });

  describe('acceleratorToUiohookParts', () => {
    it('maps the popup hotkey to uiohook key names and modifiers', () => {
      expect(acceleratorToUiohookParts('Ctrl+Shift+Space', 'win32')).toEqual({
        keyName: 'Space',
        ctrl: true,
        alt: false,
        shift: true,
        meta: false,
      });
      expect(acceleratorToUiohookParts('Alt+1', 'linux').keyName).toBe('1');
      expect(acceleratorToUiohookParts('Ctrl+h', 'linux').keyName).toBe('H');
      expect(acceleratorToUiohookParts('Ctrl+F12', 'linux').keyName).toBe('F12');
      expect(acceleratorToUiohookParts('Ctrl+num3', 'linux').keyName).toBe('Numpad3');
    });

    it('maps the arrows, which uiohook calls ArrowUp and not Up', () => {
      expect(acceleratorToUiohookParts('Ctrl+Up', 'win32').keyName).toBe('ArrowUp');
      expect(acceleratorToUiohookParts('Ctrl+ArrowLeft', 'win32').keyName).toBe('ArrowLeft');
    });

    it('takes the platform key for CommandOrControl, and any spelling of Meta', () => {
      expect(acceleratorToUiohookParts('CommandOrControl+K', 'darwin')).toEqual(
        expect.objectContaining({ ctrl: false, meta: true })
      );
      expect(acceleratorToUiohookParts('CommandOrControl+K', 'win32')).toEqual(
        expect.objectContaining({ ctrl: true, meta: false })
      );
      for (const name of ['Command', 'Cmd', 'Super', 'Meta', 'Win']) {
        expect(acceleratorToUiohookParts(`${name}+K`, 'linux').meta).toBe(true);
      }
    });

    it('gives nothing for keys uiohook has no name for and for broken accelerators', () => {
      expect(acceleratorToUiohookParts('Ctrl+VolumeUp', 'linux')).toBeNull();
      expect(acceleratorToUiohookParts('Ctrl+Shift', 'linux')).toBeNull();
      expect(acceleratorToUiohookParts('', 'linux')).toBeNull();
      expect(acceleratorToUiohookParts(undefined, 'linux')).toBeNull();
    });

    it('only produces key names the uiohook library really has', () => {
      // The library's native module cannot be loaded here, so its list of keys is read from the
      // type declarations that ship with it.
      const declarations = fs.readFileSync(
        path.resolve(__dirname, '../../node_modules/uiohook-napi/dist/index.d.ts'),
        'utf8'
      );
      const keyNames = new Set(
        [...declarations.matchAll(/readonly (\w+): /g)].map((match) => match[1])
      );
      const codes = [
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map((key) => key.toLowerCase()),
        ...Array.from({ length: 24 }, (_, index) => `f${index + 1}`),
        ...Array.from({ length: 10 }, (_, index) => `num${index}`),
        'space',
        'enter',
        'tab',
        'backspace',
        'delete',
        'insert',
        'escape',
        'home',
        'end',
        'pageup',
        'pagedown',
        'up',
        'down',
        'left',
        'right',
        'printscreen',
        'numadd',
        'numsub',
        'nummult',
        'numdiv',
        'numdec',
        '`',
        '-',
        '=',
        '[',
        ']',
        '\\',
        ';',
        "'",
        ',',
        '.',
        '/',
      ];
      for (const key of codes) {
        const parts = acceleratorToUiohookParts(`Ctrl+${key}`, 'linux');
        expect(parts).not.toBeNull();
        expect(keyNames.has(parts.keyName)).toBe(true);
      }
    });
  });
});
