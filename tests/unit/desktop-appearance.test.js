/** @jest-environment jsdom */
jest.mock('../../src/ui-utils.js', () => ({
  applyTheme: jest.fn(),
  applyAccentTheme: jest.fn(),
  applyBackgroundTheme: jest.fn(),
  applyAccentThemeFromColor: jest.fn(),
  applyBackgroundThemeFromColor: jest.fn(),
}));

let applyDesktopAppearance;
let theme;
let systemThemeChanged;
const palette = {
  mode: 'dark',
  background: '#112233',
  foreground: '#eeeeee',
  accent: '#ffaa00',
  border: '#cccccc',
  selection: '#445566',
};
beforeEach(() => {
  jest.resetModules();
  document.body.className = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
  window.matchMedia = jest.fn(() => ({
    addEventListener: (_event, callback) => {
      systemThemeChanged = callback;
    },
  }));
  ({ applyDesktopAppearance } = require('../../src/desktop-appearance.js'));
  theme = require('../../src/ui-utils.js');
});

test.each([
  { ui: {} },
  { ui: { followOmarchy: true }, desktopAppearance: null },
  { ui: { followOmarchy: false }, desktopAppearance: palette },
])(
  'leaves existing appearance and native dragging alone without an active Omarchy palette: %j',
  (config) => {
    document.body.style.setProperty('--text-primary', '#123456');
    document.documentElement.style.setProperty('--window-bg-rgb', '1, 2, 3');
    applyDesktopAppearance(config);
    expect(document.body.style.getPropertyValue('--text-primary')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--window-bg-rgb')).toBe('1, 2, 3');
    expect(document.body.classList.contains('layer-drag-enabled')).toBe(false);
    expect(theme.applyTheme).not.toHaveBeenCalled();
    expect(theme.applyAccentThemeFromColor).not.toHaveBeenCalled();
  }
);

test('only enables custom dragging when the main process grants that capability', () => {
  for (const capabilities of [
    { layerMode: true, canDrag: false },
    { layerMode: false },
    undefined,
  ]) {
    applyDesktopAppearance({ desktopCapabilities: capabilities });
    expect(document.body.classList.contains('layer-drag-enabled')).toBe(false);
  }
  applyDesktopAppearance({ desktopCapabilities: { layerMode: true, canDrag: true } });
  expect(document.body.classList.contains('layer-drag-enabled')).toBe(true);
});

test('removes its palette overrides when theme following is disabled', () => {
  applyDesktopAppearance({ ui: { followOmarchy: true }, desktopAppearance: palette });
  expect(document.body.style.getPropertyValue('--text-primary')).toBe('#eeeeee');
  applyDesktopAppearance({ ui: { followOmarchy: false }, desktopAppearance: palette });
  expect(document.body.style.getPropertyValue('--text-primary')).toBe('');
});

test('system theme changes preserve the selected accent and background in auto mode', () => {
  applyDesktopAppearance({ ui: { theme: 'auto', accent: 'rose', background: 'slate' } });
  systemThemeChanged();
  expect(theme.applyTheme).toHaveBeenCalledWith('auto');
  expect(theme.applyAccentTheme).toHaveBeenCalledWith('rose');
  expect(theme.applyBackgroundTheme).toHaveBeenCalledWith('slate');
});

test('system theme changes leave an explicit theme alone', () => {
  applyDesktopAppearance({ ui: { theme: 'light' } });
  systemThemeChanged();
  expect(theme.applyTheme).not.toHaveBeenCalled();
});
