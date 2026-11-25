/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');

// Create mock electronAPI instance BEFORE loading ui-utils
// This is needed because ui-utils.js calls window.electronAPI.onHotkeyRegistrationFailed at module load time
const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// Mock matchMedia for theme detection
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Now load the module
const uiUtils = require('../../src/ui-utils.js');
const { SEASONAL_HOLIDAYS } = require('../../src/seasonal-calendar.js');

beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Clear document body
  document.body.innerHTML = '';

  // Reset timers
  jest.clearAllTimers();
});

describe('UI Utilities', () => {
  describe('applyTheme', () => {
    it('should apply dark theme', () => {
      uiUtils.applyTheme('dark');

      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });

    it('should apply light theme', () => {
      uiUtils.applyTheme('light');

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it('should detect dark system preference in auto mode', () => {
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      uiUtils.applyTheme('auto');

      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });

    it('should detect light system preference in auto mode', () => {
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      uiUtils.applyTheme('auto');

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it('should remove old theme class when switching', () => {
      document.body.classList.add('theme-dark');

      uiUtils.applyTheme('light');

      expect(document.body.classList.contains('theme-dark')).toBe(false);
      expect(document.body.classList.contains('theme-light')).toBe(true);
    });

    it('should default to auto mode', () => {
      uiUtils.applyTheme();

      const hasTheme =
        document.body.classList.contains('theme-dark') ||
        document.body.classList.contains('theme-light');
      expect(hasTheme).toBe(true);
    });

    it('should handle missing matchMedia gracefully', () => {
      const originalMatchMedia = window.matchMedia;
      delete window.matchMedia;

      expect(() => {
        uiUtils.applyTheme('auto');
      }).not.toThrow();

      window.matchMedia = originalMatchMedia;
    });

    it('should handle errors during theme application', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(document.body),
        'classList'
      );

      // Make classList operations throw
      Object.defineProperty(document.body, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true,
      });

      uiUtils.applyTheme('dark');

      expect(consoleError).toHaveBeenCalledWith('Error applying theme:', expect.any(Error));

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(document.body, 'classList', originalClassList);
      } else {
        delete document.body.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('applyUiPreferences', () => {
    it('scales the complete Electron interface and rejects invalid saved values', () => {
      window.electronAPI.setUiScale = jest.fn();
      uiUtils.applyUiPreferences({ scale: 1.5 });
      expect(window.electronAPI.setUiScale).toHaveBeenLastCalledWith(1.5);
      expect(document.body.classList.contains('large-interface')).toBe(true);
      uiUtils.applyUiPreferences({ scale: -4 });
      expect(window.electronAPI.setUiScale).toHaveBeenLastCalledWith(1);
      expect(document.body.classList.contains('large-interface')).toBe(false);
      delete window.electronAPI.setUiScale;
    });

    it('marks where desktop pin names sit and drops a side it does not know', () => {
      uiUtils.applyUiPreferences({ desktopPinNameAlign: 'center' });
      expect(document.body.dataset.pinNameAlign).toBe('center');
      uiUtils.applyUiPreferences({ desktopPinNameAlign: 'justify' });
      expect(document.body.dataset.pinNameAlign).toBeUndefined();
      uiUtils.applyUiPreferences({ desktopPinNameAlign: 'right' });
      uiUtils.applyUiPreferences({});
      expect(document.body.dataset.pinNameAlign).toBeUndefined();
    });

    it('should apply high contrast mode', () => {
      uiUtils.applyUiPreferences({ highContrast: true });

      expect(document.body.classList.contains('high-contrast')).toBe(true);
    });

    it('should remove high contrast mode when false', () => {
      document.body.classList.add('high-contrast');

      uiUtils.applyUiPreferences({ highContrast: false });

      expect(document.body.classList.contains('high-contrast')).toBe(false);
    });

    describe('with the Readable preset', () => {
      const themeClasses = () => [
        document.body.classList.contains('theme-light'),
        document.body.classList.contains('theme-dark'),
      ];

      afterEach(() => {
        uiUtils.applyUiPreferences({});
      });

      it('paints the dark theme over a light one and gives the light theme back', () => {
        uiUtils.applyTheme('light');
        expect(themeClasses()).toEqual([true, false]);

        uiUtils.applyUiPreferences({ highContrast: true });
        expect(themeClasses()).toEqual([false, true]);

        uiUtils.applyUiPreferences({ highContrast: false });
        expect(themeClasses()).toEqual([true, false]);
      });

      it('keeps the preset dark when a theme is applied while it is on', () => {
        uiUtils.applyUiPreferences({ highContrast: true });
        uiUtils.applyTheme('light');
        expect(themeClasses()).toEqual([false, true]);

        uiUtils.applyUiPreferences({});
        expect(themeClasses()).toEqual([true, false]);
      });

      it('leaves a dark theme alone', () => {
        uiUtils.applyTheme('dark');
        uiUtils.applyUiPreferences({ highContrast: true });
        expect(themeClasses()).toEqual([false, true]);
        uiUtils.applyUiPreferences({});
        expect(themeClasses()).toEqual([false, true]);
      });

      it('works the accent tints out for the theme the preset paints', () => {
        const accentBg = () => document.documentElement.style.getPropertyValue('--accent-bg');
        uiUtils.applyTheme('light');
        uiUtils.applyAccentTheme('original');
        const lightTint = accentBg();
        expect(lightTint).not.toBe('');

        uiUtils.applyUiPreferences({ highContrast: true });
        expect(accentBg()).not.toBe(lightTint);
        uiUtils.applyUiPreferences({});
        expect(accentBg()).toBe(lightTint);
      });
    });

    describe('with a colour that came in raw', () => {
      const rootVar = (name) => document.documentElement.style.getPropertyValue(name);

      afterEach(() => {
        uiUtils.applyUiPreferences({});
        uiUtils.applyAccentTheme('original');
        uiUtils.applyBackgroundTheme('original');
      });

      // A followed Omarchy palette or a Settings draft is applied as a bare colour, with no theme
      // key to repaint from, so the light theme's tints were left as the preset's dark ones.
      it.each([
        ['accent', '--accent-bg', (hex) => uiUtils.applyAccentThemeFromColor(hex), '#3366cc'],
        [
          'background',
          '--bg-primary',
          (hex) => uiUtils.applyBackgroundThemeFromColor(hex),
          '#e8eef7',
        ],
      ])(
        'works the %s tints out again when the Readable preset gives the light theme back',
        (_, property, applyRaw, color) => {
          uiUtils.applyUiPreferences({ highContrast: true });
          uiUtils.applyTheme('light');
          applyRaw(color);
          const underPreset = rootVar(property);

          uiUtils.applyUiPreferences({});
          expect(document.body.classList.contains('theme-light')).toBe(true);
          const afterPreset = rootVar(property);
          expect(afterPreset).not.toBe(underPreset);

          // The same colour applied directly under the light theme.
          applyRaw(color);
          expect(afterPreset).toBe(rootVar(property));
        }
      );

      it('repaints a saved theme by its key rather than by an older raw colour', () => {
        uiUtils.applyTheme('light');
        uiUtils.applyAccentThemeFromColor('#3366cc');
        uiUtils.applyAccentTheme('original');
        const saved = rootVar('--accent-bg');

        uiUtils.applyUiPreferences({ highContrast: true });
        uiUtils.applyUiPreferences({});
        expect(rootVar('--accent-bg')).toBe(saved);
      });
    });

    it('should apply opaque panels mode', () => {
      uiUtils.applyUiPreferences({ opaquePanels: true });

      expect(document.body.classList.contains('opaque-panels')).toBe(true);
    });

    it('should remove opaque panels mode when false', () => {
      document.body.classList.add('opaque-panels');

      uiUtils.applyUiPreferences({ opaquePanels: false });

      expect(document.body.classList.contains('opaque-panels')).toBe(false);
    });

    it('should apply compact density', () => {
      uiUtils.applyUiPreferences({ density: 'compact' });

      expect(document.body.classList.contains('density-compact')).toBe(true);
    });

    it('should glow active tiles unless the preference is turned off', () => {
      uiUtils.applyUiPreferences({});
      expect(document.body.classList.contains('active-tile-glow')).toBe(true);

      uiUtils.applyUiPreferences({ activeTileGlow: true });
      expect(document.body.classList.contains('active-tile-glow')).toBe(true);

      uiUtils.applyUiPreferences({ activeTileGlow: false });
      expect(document.body.classList.contains('active-tile-glow')).toBe(false);
    });

    it('should remove compact density for comfortable mode', () => {
      document.body.classList.add('density-compact');

      uiUtils.applyUiPreferences({ density: 'comfortable' });

      expect(document.body.classList.contains('density-compact')).toBe(false);
    });

    it('should default to comfortable density', () => {
      document.body.classList.add('density-compact');

      uiUtils.applyUiPreferences({});

      expect(document.body.classList.contains('density-compact')).toBe(false);
    });

    it('should apply multiple preferences simultaneously', () => {
      uiUtils.applyUiPreferences({
        highContrast: true,
        opaquePanels: true,
        density: 'compact',
      });

      expect(document.body.classList.contains('high-contrast')).toBe(true);
      expect(document.body.classList.contains('opaque-panels')).toBe(true);
      expect(document.body.classList.contains('density-compact')).toBe(true);
    });

    it('should handle undefined preferences object', () => {
      expect(() => {
        uiUtils.applyUiPreferences();
      }).not.toThrow();
    });

    it('should handle errors during UI preferences application', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(document.body),
        'classList'
      );

      Object.defineProperty(document.body, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true,
      });

      uiUtils.applyUiPreferences({ highContrast: true });

      expect(consoleError).toHaveBeenCalledWith(
        'Error applying UI preferences:',
        expect.any(Error)
      );

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(document.body, 'classList', originalClassList);
      } else {
        delete document.body.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('showLoading', () => {
    let loadingOverlay;

    beforeEach(() => {
      loadingOverlay = document.createElement('div');
      loadingOverlay.id = 'loading-overlay';
      loadingOverlay.classList.add('hidden');
      document.body.appendChild(loadingOverlay);
    });

    it('should show loading overlay when true', () => {
      uiUtils.showLoading(true);

      expect(loadingOverlay.classList.contains('hidden')).toBe(false);
    });

    it('should hide loading overlay when false', () => {
      loadingOverlay.classList.remove('hidden');

      uiUtils.showLoading(false);

      expect(loadingOverlay.classList.contains('hidden')).toBe(true);
    });

    it('should toggle loading state multiple times', () => {
      uiUtils.showLoading(true);
      expect(loadingOverlay.classList.contains('hidden')).toBe(false);

      uiUtils.showLoading(false);
      expect(loadingOverlay.classList.contains('hidden')).toBe(true);

      uiUtils.showLoading(true);
      expect(loadingOverlay.classList.contains('hidden')).toBe(false);
    });

    it('should handle missing loading overlay gracefully', () => {
      document.body.removeChild(loadingOverlay);

      expect(() => {
        uiUtils.showLoading(true);
      }).not.toThrow();
    });

    it('should handle errors during loading state change', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList =
        Object.getOwnPropertyDescriptor(loadingOverlay, 'classList') ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(loadingOverlay), 'classList');

      Object.defineProperty(loadingOverlay, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true,
      });

      uiUtils.showLoading(true);

      expect(consoleError).toHaveBeenCalledWith('Error showing loading:', expect.any(Error));

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(loadingOverlay, 'classList', originalClassList);
      } else {
        delete loadingOverlay.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('setStatus', () => {
    let statusIndicator;

    beforeEach(() => {
      statusIndicator = document.createElement('div');
      statusIndicator.id = 'connection-status';
      document.body.appendChild(statusIndicator);
    });

    it('should set connected status', () => {
      uiUtils.setStatus(true);

      expect(statusIndicator.classList.contains('connection-indicator')).toBe(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);
      expect(statusIndicator.getAttribute('aria-label')).toBe('Connected to Home Assistant');
      expect(statusIndicator.hasAttribute('title')).toBe(false);
    });

    it('should set disconnected status', () => {
      statusIndicator.classList.add('connected');

      uiUtils.setStatus(false);

      expect(statusIndicator.classList.contains('connection-indicator')).toBe(true);
      expect(statusIndicator.classList.contains('connected')).toBe(false);
      expect(statusIndicator.getAttribute('aria-label')).toBe('Disconnected from Home Assistant');
      expect(statusIndicator.hasAttribute('title')).toBe(false);
    });

    it('should clear innerHTML', () => {
      statusIndicator.innerHTML = '<span>Old content</span>';

      uiUtils.setStatus(true);

      expect(statusIndicator.innerHTML).toBe('');
    });

    it('should toggle status multiple times', () => {
      uiUtils.setStatus(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);

      uiUtils.setStatus(false);
      expect(statusIndicator.classList.contains('connected')).toBe(false);

      uiUtils.setStatus(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);
    });

    it('should store detailed status metadata when detail message is provided', () => {
      uiUtils.setStatus(false, 'No network connection detected.');

      expect(statusIndicator.dataset.statusSummary).toBe('Disconnected from Home Assistant');
      expect(statusIndicator.dataset.statusDetail).toBe('No network connection detected.');
      // The custom tooltip carries the words; a title attribute would add Chromium's own after it.
      expect(statusIndicator.hasAttribute('title')).toBe(false);
      expect(statusIndicator.getAttribute('aria-label')).toBe(
        'Disconnected from Home Assistant. No network connection detected.'
      );
    });

    it('should handle missing status indicator gracefully', () => {
      document.body.removeChild(statusIndicator);

      expect(() => {
        uiUtils.setStatus(true);
      }).not.toThrow();
    });

    it('should handle errors during status update', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original className descriptor
      const originalClassName =
        Object.getOwnPropertyDescriptor(statusIndicator, 'className') ||
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(statusIndicator), 'className');

      Object.defineProperty(statusIndicator, 'className', {
        set: () => {
          throw new Error('DOM error');
        },
        get: () => '',
        configurable: true,
      });

      uiUtils.setStatus(true);

      expect(consoleError).toHaveBeenCalledWith('Error setting status:', expect.any(Error));

      // Restore original className
      if (originalClassName) {
        Object.defineProperty(statusIndicator, 'className', originalClassName);
      } else {
        delete statusIndicator.className;
      }

      consoleError.mockRestore();
    });
  });

  describe('initializeConnectionStatusTooltip', () => {
    let statusIndicator;

    beforeEach(() => {
      statusIndicator = document.createElement('div');
      statusIndicator.id = 'connection-status';
      statusIndicator.className = 'connection-indicator';
      document.body.appendChild(statusIndicator);
      uiUtils.setStatus(false, 'Disconnected from Home Assistant. Retrying automatically.');
    });

    it('should create tooltip once and be idempotent', () => {
      uiUtils.initializeConnectionStatusTooltip();
      uiUtils.initializeConnectionStatusTooltip();

      const tooltips = document.querySelectorAll('#connection-status-tooltip');
      expect(tooltips.length).toBe(1);
    });

    // What it opens is a tooltip that repeats the dot's own label, not a menu: announced with
    // aria-haspopup, it was a menu button whose menu never came.
    it('is a button described by its tooltip, not a menu button', () => {
      uiUtils.initializeConnectionStatusTooltip();
      const tooltip = document.getElementById('connection-status-tooltip');
      expect(statusIndicator.getAttribute('role')).toBe('button');

      [false, true].forEach((open) => {
        statusIndicator.click();
        expect(tooltip.classList.contains('visible')).toBe(!open);
        expect(statusIndicator.hasAttribute('aria-haspopup')).toBe(false);
        expect(statusIndicator.hasAttribute('aria-expanded')).toBe(false);
      });
      expect(tooltip.getAttribute('role')).toBe('tooltip');
    });

    it('should show tooltip on mouseenter and hide on mouseleave', () => {
      uiUtils.initializeConnectionStatusTooltip();
      statusIndicator.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      const tooltip = document.getElementById('connection-status-tooltip');
      expect(tooltip.classList.contains('visible')).toBe(true);
      expect(tooltip.querySelector('.connection-status-tooltip-title').textContent).toBe(
        'Disconnected from Home Assistant'
      );
      // The title already says "Disconnected from Home Assistant"; the detail adds the rest.
      expect(tooltip.querySelector('.connection-status-tooltip-detail').textContent).toBe(
        'Retrying automatically.'
      );

      statusIndicator.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      expect(tooltip.classList.contains('visible')).toBe(false);
    });

    it('points the arrow at the dot, even when the tooltip is held inside the window', () => {
      const rect = (left, top, width, height) => ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      });
      uiUtils.initializeConnectionStatusTooltip();
      const tooltip = document.getElementById('connection-status-tooltip');
      tooltip.getBoundingClientRect = () => rect(0, 0, 180, 60);
      // The dot sits at the far left of the window, where a 180px tooltip cannot centre on it.
      statusIndicator.getBoundingClientRect = () => rect(15, 12, 8, 8);
      statusIndicator.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      // The tooltip is held at the 12px padding; its centre would be at 90, but the dot is at 19.
      expect(tooltip.style.left).toBe('12px');
      expect(tooltip.style.getPropertyValue('--arrow-x')).toBe('14px');

      // Away from the edge the tooltip centres on the dot and the arrow is in the middle.
      statusIndicator.getBoundingClientRect = () => rect(300, 12, 8, 8);
      statusIndicator.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(tooltip.style.left).toBe('214px');
      expect(tooltip.style.getPropertyValue('--arrow-x')).toBe('90px');
    });

    it('should show tooltip on keyboard focus and hide on blur', () => {
      uiUtils.initializeConnectionStatusTooltip();
      statusIndicator.focus();

      const tooltip = document.getElementById('connection-status-tooltip');
      expect(tooltip.classList.contains('visible')).toBe(true);

      statusIndicator.blur();
      expect(tooltip.classList.contains('visible')).toBe(false);
    });

    // Issue #214: the dot keeps focus while the widget is hidden, and Chromium focuses it again
    // when the widget opens. That reopening is not a request for the tooltip, which then covered
    // the weather on every open.
    it('does not open the tooltip when the window gives the dot its focus back', () => {
      jest.useFakeTimers();
      try {
        uiUtils.initializeConnectionStatusTooltip();
        const tooltip = document.getElementById('connection-status-tooltip');
        statusIndicator.focus();
        expect(tooltip.classList.contains('visible')).toBe(true);

        window.dispatchEvent(new FocusEvent('blur'));
        statusIndicator.dispatchEvent(new FocusEvent('blur'));
        expect(tooltip.classList.contains('visible')).toBe(false);

        window.dispatchEvent(new FocusEvent('focus'));
        statusIndicator.dispatchEvent(new FocusEvent('focus'));
        expect(tooltip.classList.contains('visible')).toBe(false);

        // Only that one focus is skipped: tabbing back to the dot later still opens it.
        jest.runAllTimers();
        statusIndicator.blur();
        statusIndicator.focus();
        expect(tooltip.classList.contains('visible')).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('closes a pinned tooltip when the window loses focus', () => {
      uiUtils.initializeConnectionStatusTooltip();
      statusIndicator.click();
      const tooltip = document.getElementById('connection-status-tooltip');
      expect(tooltip.classList.contains('visible')).toBe(true);

      window.dispatchEvent(new FocusEvent('blur'));
      expect(tooltip.classList.contains('visible')).toBe(false);
    });

    it('should toggle pinned tooltip on click and hide on outside click', () => {
      uiUtils.initializeConnectionStatusTooltip();
      statusIndicator.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const tooltip = document.getElementById('connection-status-tooltip');
      expect(tooltip.classList.contains('visible')).toBe(true);

      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(tooltip.classList.contains('visible')).toBe(false);
    });

    it('should toggle tooltip on keyboard and hide on escape', () => {
      uiUtils.initializeConnectionStatusTooltip();
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = jest.spyOn(enterEvent, 'preventDefault');
      statusIndicator.dispatchEvent(enterEvent);

      const tooltip = document.getElementById('connection-status-tooltip');
      expect(tooltip.classList.contains('visible')).toBe(true);
      expect(preventDefaultSpy).toHaveBeenCalled();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(tooltip.classList.contains('visible')).toBe(false);
      preventDefaultSpy.mockRestore();
    });

    it('builds the tooltip text in the language that is active when it opens', () => {
      const i18n = require('../../src/i18n.js');
      uiUtils.setStatus(true);
      uiUtils.initializeConnectionStatusTooltip();
      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: {
          'Connected to Home Assistant': 'Mit Home Assistant verbunden',
          'Real-time updates active.': 'Echtzeit-Updates aktiv.',
        },
      });
      try {
        statusIndicator.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const tooltip = document.getElementById('connection-status-tooltip');
        expect(tooltip.querySelector('.connection-status-tooltip-title').textContent).toBe(
          'Mit Home Assistant verbunden'
        );
        expect(tooltip.querySelector('.connection-status-tooltip-detail').textContent).toBe(
          'Echtzeit-Updates aktiv.'
        );
      } finally {
        i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      }
    });

    it('should not throw when status indicator is missing', () => {
      document.body.removeChild(statusIndicator);
      expect(() => uiUtils.initializeConnectionStatusTooltip()).not.toThrow();
    });
  });

  describe('custom theme utilities', () => {
    beforeEach(() => {
      uiUtils.setCustomThemes([]);
      document.body.innerHTML = '';
      document.body.dataset.accent = '';
      document.body.dataset.background = '';
    });

    it('appends custom themes after built-in themes', () => {
      uiUtils.setCustomThemes([
        {
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const themes = uiUtils.getAccentThemes();
      expect(themes[0].id).toBe('original');
      expect(themes[themes.length - 1]).toEqual(
        expect.objectContaining({
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          isCustom: true,
        })
      );
    });

    it('filters invalid and duplicate custom colors by normalized hex', () => {
      uiUtils.setCustomThemes([
        { id: 'bad', name: 'Invalid', color: '#GGHHII' },
        { id: 'one', name: 'One', color: '#123456' },
        { id: 'dup', name: 'Duplicate', color: '#123456' },
      ]);

      const customThemes = uiUtils.getAccentThemes().filter((theme) => theme.isCustom);
      expect(customThemes).toHaveLength(1);
      expect(customThemes[0]).toEqual(
        expect.objectContaining({
          id: 'one',
          color: '#123456',
        })
      );
    });

    it('applies a registered custom accent theme', () => {
      uiUtils.setCustomThemes([{ id: 'custom-night', name: 'Night', color: '#224466' }]);

      uiUtils.applyAccentTheme('custom-night');

      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#224466');
      expect(document.body.dataset.accent).toBe('custom-night');
    });

    it('applies unsaved accent/background preview colors from hex', () => {
      const accentApplied = uiUtils.applyAccentThemeFromColor('#ABCDEF');
      const backgroundApplied = uiUtils.applyBackgroundThemeFromColor('#445566');

      expect(accentApplied).toBe(true);
      expect(backgroundApplied).toBe(true);
      expect(document.body.dataset.accent).toBe('custom-preview');
      expect(document.body.dataset.background).toBe('custom-preview');
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ABCDEF');
      expect(document.body.style.getPropertyValue('--frosted-bg-rgb')).toMatch(/\d+,\s\d+,\s\d+/);
    });
  });

  describe('applyWindowEffects', () => {
    beforeEach(() => {
      document.body.classList.remove('theme-light');
    });

    it('applies opacity to background surfaces without fading child controls', () => {
      mockElectronAPI.platform = 'linux';

      uiUtils.applyWindowEffects({ opacity: 0.62, frostedGlass: false });

      expect(document.body.style.getPropertyValue('--window-opacity')).toBe('0.620');
      expect(document.body.style.getPropertyValue('--window-bg-alpha')).toBe('0.214');
      expect(document.body.style.getPropertyValue('--desktop-pin-window-opacity')).toBe('0.214');
      expect(document.body.classList.contains('linux-performance-mode')).toBe(true);
      expect(document.body.style.opacity).toBe('');
    });

    it('makes Linux software glass visibly more transparent at the low end', () => {
      mockElectronAPI.platform = 'linux';

      uiUtils.applyWindowEffects({ opacity: 0.5, frostedGlass: true });

      expect(document.body.classList.contains('frosted-glass')).toBe(true);
      expect(document.body.classList.contains('software-glass')).toBe(true);
      expect(document.body.classList.contains('linux-performance-mode')).toBe(true);
      expect(document.body.style.getPropertyValue('--window-bg-alpha')).toBe('0.080');
      expect(document.body.style.getPropertyValue('--software-acrylic-bg-alpha')).toBe('0.190');
      expect(
        Number(document.body.style.getPropertyValue('--frosted-glass-elevated-alpha'))
      ).toBeLessThan(0.3);
    });

    it('treats 100 percent opacity as a fully opaque window surface', () => {
      mockElectronAPI.platform = 'linux';

      uiUtils.applyWindowEffects({ opacity: 1, frostedGlass: true });

      expect(document.body.style.getPropertyValue('--window-opacity')).toBe('1.000');
      expect(document.body.style.getPropertyValue('--window-bg-alpha')).toBe('1.000');
      expect(document.body.classList.contains('frosted-glass')).toBe(true);
      expect(document.body.classList.contains('software-glass')).toBe(true);
      expect(document.body.classList.contains('native-glass')).toBe(false);
      expect(document.body.style.getPropertyValue('--software-acrylic-bg-alpha')).toBe('0.760');
      expect(
        Number(document.body.style.getPropertyValue('--frosted-glass-elevated-alpha'))
      ).toBeGreaterThan(0.5);
    });

    it('applies Windows non-glass opacity to background surfaces only', () => {
      mockElectronAPI.platform = 'win32';

      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: false });

      expect(document.body.classList.contains('linux-performance-mode')).toBe(true);
      expect(document.body.classList.contains('frosted-glass')).toBe(false);
      expect(Number(document.body.style.getPropertyValue('--window-bg-alpha'))).toBeLessThan(1);
      expect(document.body.style.opacity).toBe('');

      uiUtils.applyWindowEffects({ opacity: 1, frostedGlass: false });

      expect(document.body.style.getPropertyValue('--window-bg-alpha')).toBe('1.000');
      expect(document.body.style.opacity).toBe('');
    });

    it('names the platform on the body, since linux-performance-mode is not Linux alone', () => {
      mockElectronAPI.platform = 'win32';
      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: false });
      // Windows without Frosted glass draws the Linux class but must not read as Linux.
      expect(document.body.classList.contains('linux-performance-mode')).toBe(true);
      expect(document.body.dataset.platform).toBe('win32');

      mockElectronAPI.platform = 'linux';
      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: true });
      expect(document.body.dataset.platform).toBe('linux');

      mockElectronAPI.platform = undefined;
      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: false });
      expect('platform' in document.body.dataset).toBe(false);
    });

    it('keeps backdrop filters on Windows when frosted glass is enabled', () => {
      mockElectronAPI.platform = 'win32';

      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: true });

      expect(document.body.classList.contains('linux-performance-mode')).toBe(false);
      expect(document.body.classList.contains('frosted-glass')).toBe(true);
      expect(document.body.classList.contains('native-glass')).toBe(true);
      expect(Number(document.body.style.getPropertyValue('--window-bg-alpha'))).toBeLessThan(1);
      expect(document.body.style.opacity).toBe('');
    });

    describe('on Windows without acrylic', () => {
      const withoutAcrylic = { nativeGlassSupported: false };
      // The look the frosted glass setting being off draws, for the same opacity and theme.
      const drawnWithGlassOff = (opacity, light) => {
        document.body.className = light ? 'theme-light' : '';
        document.body.removeAttribute('style');
        uiUtils.applyWindowEffects({ opacity, frostedGlass: false });
        return { className: document.body.className, style: document.body.getAttribute('style') };
      };

      it.each([
        [0.5, false],
        [0.75, false],
        [1, false],
        [0.75, true],
      ])('draws the solid panel for a saved "on" at opacity %s (light: %s)', (opacity, light) => {
        mockElectronAPI.platform = 'win32';
        const expected = drawnWithGlassOff(opacity, light);

        document.body.className = light ? 'theme-light' : '';
        document.body.removeAttribute('style');
        uiUtils.applyWindowEffects({
          opacity,
          frostedGlass: true,
          desktopCapabilities: withoutAcrylic,
        });

        expect({
          className: document.body.className,
          style: document.body.getAttribute('style'),
        }).toEqual(expected);
        expect(document.body.classList.contains('frosted-glass')).toBe(false);
        expect(document.body.classList.contains('native-glass')).toBe(false);
        expect(document.body.classList.contains('software-glass')).toBe(false);
        expect(document.body.classList.contains('linux-performance-mode')).toBe(true);
      });

      it('clears glass left over from before the capability arrived', () => {
        mockElectronAPI.platform = 'win32';
        uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: true });
        expect(document.body.classList.contains('native-glass')).toBe(true);

        uiUtils.applyWindowEffects({
          opacity: 0.75,
          frostedGlass: true,
          desktopCapabilities: withoutAcrylic,
        });

        expect(document.body.classList.contains('frosted-glass')).toBe(false);
        expect(document.body.classList.contains('native-glass')).toBe(false);
        expect(document.body.style.getPropertyValue('--frosted-glass-elevated-alpha')).toBe('');
      });

      it('still draws the saved choice when the window can blur again', () => {
        mockElectronAPI.platform = 'win32';
        uiUtils.applyWindowEffects({
          opacity: 0.75,
          frostedGlass: true,
          desktopCapabilities: withoutAcrylic,
        });
        uiUtils.applyWindowEffects({
          opacity: 0.75,
          frostedGlass: true,
          desktopCapabilities: { nativeGlassSupported: true },
        });

        expect(document.body.className).toBe('frosted-glass native-glass');
      });
    });

    describe('where the window can blur or the platform ignores the capability', () => {
      const before = require('../fixtures/window-effects-before-glass-gate.json');
      const capabilityCases = {
        'no capability sent': undefined,
        'Windows 11 22H2 or later': { nativeGlassSupported: true },
        // The main process only ever sends false on Windows; the renderer must not read it elsewhere.
        'a stray false off Windows': { nativeGlassSupported: false },
      };

      it.each(Object.entries(before))('keeps the %s look unchanged', (key, expected) => {
        const [platform, theme, opacity, frostedGlass] = key.split('|');
        Object.entries(capabilityCases).forEach(([label, desktopCapabilities]) => {
          if (platform === 'win32' && desktopCapabilities?.nativeGlassSupported === false) return;
          document.body.className = theme === 'light' ? 'theme-light' : '';
          document.body.removeAttribute('style');
          mockElectronAPI.platform = platform;

          uiUtils.applyWindowEffects({
            opacity: Number(opacity),
            frostedGlass: frostedGlass === 'true',
            ...(desktopCapabilities ? { desktopCapabilities } : {}),
          });

          expect({
            label,
            className: document.body.className,
            style: document.body.getAttribute('style') || '',
          }).toEqual({ label, ...expected });
        });
      });
    });

    it('keeps macOS non-glass opacity on background surfaces without performance mode', () => {
      mockElectronAPI.platform = 'darwin';

      uiUtils.applyWindowEffects({ opacity: 0.75, frostedGlass: false });

      expect(document.body.classList.contains('linux-performance-mode')).toBe(false);
      expect(document.body.classList.contains('frosted-glass')).toBe(false);
      expect(Number(document.body.style.getPropertyValue('--window-bg-alpha'))).toBeLessThan(1);
      expect(document.body.style.opacity).toBe('');
    });
  });

  describe('isFrostedGlassAvailable', () => {
    it('is withheld only on Windows when the main process says acrylic is missing', () => {
      const withoutAcrylic = { desktopCapabilities: { nativeGlassSupported: false } };
      const withAcrylic = { desktopCapabilities: { nativeGlassSupported: true } };

      mockElectronAPI.platform = 'win32';
      expect(uiUtils.isFrostedGlassAvailable(withoutAcrylic)).toBe(false);
      expect(uiUtils.isFrostedGlassAvailable(withAcrylic)).toBe(true);
      expect(uiUtils.isFrostedGlassAvailable({})).toBe(true);
      expect(uiUtils.isFrostedGlassAvailable(undefined)).toBe(true);

      ['darwin', 'linux'].forEach((platform) => {
        mockElectronAPI.platform = platform;
        expect(uiUtils.isFrostedGlassAvailable(withoutAcrylic)).toBe(true);
      });
    });
  });

  describe('copyTextToClipboard', () => {
    it('copies through the main-process bridge', async () => {
      await expect(uiUtils.copyTextToClipboard('report')).resolves.toBe(true);
      expect(window.electronAPI.writeClipboardText).toHaveBeenCalledWith('report');
    });

    it('reports failure instead of rejecting', async () => {
      window.electronAPI.writeClipboardText.mockRejectedValueOnce(new Error('denied'));
      await expect(uiUtils.copyTextToClipboard('report')).resolves.toBe(false);
      const { writeClipboardText } = window.electronAPI;
      delete window.electronAPI.writeClipboardText;
      try {
        await expect(uiUtils.copyTextToClipboard('report')).resolves.toBe(false);
      } finally {
        window.electronAPI.writeClipboardText = writeClipboardText;
      }
    });
  });

  describe('Module exports', () => {
    it('should export all required functions', () => {
      expect(typeof uiUtils.applyTheme).toBe('function');
      expect(typeof uiUtils.setCustomThemes).toBe('function');
      expect(typeof uiUtils.applyAccentTheme).toBe('function');
      expect(typeof uiUtils.applyAccentThemeFromColor).toBe('function');
      expect(typeof uiUtils.applyBackgroundTheme).toBe('function');
      expect(typeof uiUtils.applyBackgroundThemeFromColor).toBe('function');
      expect(typeof uiUtils.getAccentThemes).toBe('function');
      expect(typeof uiUtils.getBackgroundThemes).toBe('function');
      expect(typeof uiUtils.applyUiPreferences).toBe('function');
      expect(typeof uiUtils.showLoading).toBe('function');
      expect(typeof uiUtils.setStatus).toBe('function');
    });
  });

  describe('applied accent and background colours', () => {
    const channels = (rgbString) => {
      const [r, g, b] = rgbString.match(/\d+/g).map(Number);
      return { r, g, b };
    };

    it('mixes a Background colour into the base of the theme that is showing', () => {
      document.body.classList.remove('theme-light');
      expect(uiUtils.getBackgroundWindowColor()).toBe('#12161e');
      // 12% of violet over the dark base.
      expect(uiUtils.getBackgroundWindowColor('#8b5cf6')).toBe('#211e38');
      expect(uiUtils.getBackgroundWindowColor('not a colour')).toBeNull();

      document.body.classList.add('theme-light');
      expect(uiUtils.getBackgroundWindowColor()).toBe('#fafafa');
      // 8% of violet over the light base, the amount applyBackgroundColor mixes.
      expect(uiUtils.getBackgroundWindowColor('#8b5cf6')).toBe('#f1edfa');
      uiUtils.applyTheme('light');
      uiUtils.applyBackgroundTheme('violet');
      const applied = document.documentElement.style.getPropertyValue('--window-bg-rgb');
      expect(applied).toBe('241, 237, 250');
      document.body.classList.remove('theme-light');
    });

    it('keeps the picked Background colour for the Settings chip, and drops it for the base', () => {
      uiUtils.applyBackgroundTheme('rose');
      expect(document.documentElement.style.getPropertyValue('--background-pick')).toBe('#F43F5E');
      uiUtils.applyBackgroundTheme('original');
      expect(document.documentElement.style.getPropertyValue('--background-pick')).toBe('');
    });

    it('flags a grey accent, which has no hue for a lit tile to show', () => {
      uiUtils.applyAccentTheme('slate');
      expect(document.body.dataset.accentNeutral).toBe('true');
      uiUtils.applyAccentTheme('original');
      expect(document.body.dataset.accentNeutral).toBeUndefined();
      uiUtils.applyAccentThemeFromColor('#808080');
      expect(document.body.dataset.accentNeutral).toBe('true');
      for (const theme of uiUtils.getAccentThemes().filter((entry) => entry.id !== 'slate')) {
        uiUtils.applyAccentTheme(theme.id);
        expect(document.body.dataset.accentNeutral).toBeUndefined();
      }
    });

    // A tile lit in an accent near the alarm's red or the warning's amber looked like a tile that
    // needs attention, so the stylesheet gives it a lighter wash with such an accent.
    it('flags an accent near the red or the amber of a tile that needs attention', () => {
      const warm = () => document.body.dataset.accentWarm === 'true';
      const flagged = uiUtils
        .getAccentThemes()
        .filter((theme) => {
          uiUtils.applyAccentTheme(theme.id);
          return warm();
        })
        .map((theme) => theme.id);
      expect(flagged).toEqual(['rose', 'coral', 'amber']);

      const holidays = SEASONAL_HOLIDAYS.filter((holiday) => {
        uiUtils.applyAccentThemeFromColor(holiday.colors.accent);
        return warm();
      }).map((holiday) => holiday.id);
      // Valentine's pink is 34 degrees from the alarm red, and lit an armed alarm more strongly
      // than one that went off.
      expect(holidays).toEqual([
        'new-year',
        'lunar-new-year',
        'valentines',
        'halloween',
        'thanksgiving',
        'christmas',
      ]);

      // Short of the pink, a fuchsia or a violet is not taken for the alarm.
      for (const color of ['#d946ef', '#c026d3', '#8b5cf6']) {
        uiUtils.applyAccentThemeFromColor(color);
        expect({ color, warm: warm() }).toEqual({ color, warm: false });
      }

      // A grey has no hue, whatever its channels say, and a seasonal accent is flagged as well.
      uiUtils.applyAccentThemeFromColor('#8a7f7c');
      expect(warm()).toBe(false);
      uiUtils.applyAccentTheme('emerald');
      expect(warm()).toBe(false);
      uiUtils.setSeasonalColors({ accent: '#ef4444', background: '#15803d' });
      expect(warm()).toBe(true);
      uiUtils.setSeasonalColors(null);
      uiUtils.applyAccentTheme('original');
      expect(warm()).toBe(false);
    });

    it('sets a text colour for both themes, and a ring colour, on the root', () => {
      uiUtils.applyAccentTheme('indigo');
      const style = document.documentElement.style;
      for (const name of [
        '--accent-text-light',
        '--accent-text-light-hover',
        '--accent-text-dark',
        '--accent-text-dark-hover',
        '--accent-ring-dark',
      ]) {
        expect(style.getPropertyValue(name)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      }
      // The ring only needs 3:1, so it stays closer to the accent than the text colour does.
      const ring = channels(style.getPropertyValue('--accent-ring-dark'));
      const text = channels(style.getPropertyValue('--accent-text-dark'));
      expect(ring.r).toBeLessThanOrEqual(text.r);
    });
  });

  describe('seasonal colours', () => {
    const accent = () => document.documentElement.style.getPropertyValue('--accent');

    afterEach(() => {
      uiUtils.suspendSeasonalColors(false);
      uiUtils.setSeasonalColors(null);
      uiUtils.setUiPreferencesObserver(null);
    });

    it('stands in for the saved accent and background, then gives them back', () => {
      uiUtils.applyAccentTheme('emerald');
      uiUtils.applyBackgroundTheme('slate');
      expect(accent()).toBe('#10B981');

      uiUtils.setSeasonalColors({ accent: '#f97316', background: '#6d28d9' });
      expect(accent()).toBe('#F97316');
      expect(document.body.dataset.accent).toBe('seasonal');
      expect(document.body.dataset.background).toBe('seasonal');

      // Re-applying the saved theme (a config echo, a theme mode change) keeps the holiday.
      uiUtils.applyAccentTheme('emerald');
      expect(accent()).toBe('#F97316');

      uiUtils.setSeasonalColors(null);
      expect(accent()).toBe('#10B981');
      expect(document.body.dataset.accent).toBe('emerald');
      expect(document.body.dataset.background).toBe('slate');
    });

    it('steps aside while Settings previews a picked colour, then comes back', () => {
      uiUtils.applyAccentTheme('emerald');
      uiUtils.setSeasonalColors({ accent: '#f97316', background: '#6d28d9' });
      expect(accent()).toBe('#F97316');

      uiUtils.suspendSeasonalColors(true);
      expect(accent()).toBe('#10B981');
      uiUtils.applyAccentTheme('rose');
      expect(accent()).toBe('#F43F5E');

      uiUtils.suspendSeasonalColors(false);
      expect(accent()).toBe('#F97316');
    });

    it('leaves a raw colour for its owner to repaint', () => {
      uiUtils.applyAccentTheme('emerald');
      uiUtils.applyAccentThemeFromColor('#123456');
      expect(uiUtils.setSeasonalColors({ accent: '#f97316', background: '#6d28d9' })).toBe(true);
      expect(accent()).toBe('#123456');
      expect(uiUtils.getSeasonalColors()).toEqual({ accent: '#f97316', background: '#6d28d9' });
      expect(uiUtils.setSeasonalColors({ accent: '#f97316', background: '#6d28d9' })).toBe(false);
    });

    it('passes every applied ui to the registered observer', () => {
      const observer = jest.fn();
      uiUtils.setUiPreferencesObserver(observer);
      const ui = { density: 'compact', seasonal: { show: 'halloween' } };
      uiUtils.applyUiPreferences(ui);
      expect(observer).toHaveBeenCalledWith(ui);

      observer.mockImplementation(() => {
        throw new Error('boom');
      });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => uiUtils.applyUiPreferences({})).not.toThrow();
      expect(document.body.classList.contains('density-compact')).toBe(false);
      console.error.mockRestore();
    });
  });
});
