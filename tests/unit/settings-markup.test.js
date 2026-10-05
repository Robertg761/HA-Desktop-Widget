/**
 * @jest-environment jsdom
 */

// The markup of Settings and the main window, read from index.html itself: what the integration
// tests build by hand cannot tell when the real page loses an id, a wrapper or a landmark.

const fs = require('fs');
const path = require('path');
const { linkSettingsHelpText, setDescribedByLine } = require('../../src/settings-help-links.js');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const english = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../locales/en.json'), 'utf8')
);

describe('index.html', () => {
  beforeEach(() => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script').forEach((script) => script.remove());
    document.body.innerHTML = parsed.body.innerHTML;
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const byId = (id) => document.getElementById(id);

  describe('Entity hotkeys', () => {
    test('the search and the list sit in the section the master switch shows and hides', () => {
      // settings.js and renderer.js toggle #hotkeys-section; without it the list looked live under an
      // off switch, and hotkeys could be assigned that never fire.
      const section = byId('hotkeys-section');
      expect(section).not.toBeNull();
      expect(section.style.display).toBe('none');
      expect(section.contains(byId('hotkey-entity-search'))).toBe(true);
      expect(section.contains(byId('hotkeys-list'))).toBe(true);
      expect(section.contains(byId('global-hotkeys-enabled'))).toBe(false);
    });
  });

  describe('sentence case', () => {
    // Names that keep their capitals inside a sentence-case label.
    const PROPER_NAMES = /Home Assistant|Quick Access|HA Desktop Widget|GitHub|Hyprland|Omarchy/g;
    const titleCased = (text) =>
      text
        .replace(PROPER_NAMES, '')
        .split(/\s+/)
        .slice(1)
        .some((word) => /^[A-Z][a-z]/.test(word));

    test('the Settings group captions, dialog titles and Settings buttons are written in it', () => {
      // "Window & Behavior" and "Add Alert" sat beside "Date & time" and "Add alert" buttons, and the
      // captions show in every search result.
      const labels = [
        ...document.querySelectorAll(
          '.settings-group-caption, .modal-header h2, #settings-modal button.btn'
        ),
      ]
        // The English the key shows ("Action: Clear" reads "Clear").
        .map((node) => english[node.getAttribute('data-i18n')] || node.textContent.trim())
        .filter(Boolean);
      expect(labels.length).toBeGreaterThan(40);
      expect(labels.filter(titleCased)).toEqual([]);
    });

    // The labels Settings and its hotkey list build as they run are not in the markup: confirm
    // titles, the profile sync buttons and the hotkey actions. A label is Title Case when every word
    // of it starts with a capital ("Keep Current", "Brightness Up"), apart from short joining words,
    // names and abbreviations. A sentence that names a setting or a key ("Press Enter or Space to
    // record a hotkey") has lower-case words in it and passes.
    const JOINING_WORDS = /^(a|an|and|at|by|for|from|in|of|on|or|the|to|with|&)$/;
    const isTitleCaseClause = (clause) => {
      const words = clause
        .replace(PROPER_NAMES, ' ')
        .split(/\s+/)
        .filter((word) => /\p{L}/u.test(word) && !JOINING_WORDS.test(word))
        .filter((word) => !/^\p{Lu}{2,}\b/u.test(word));
      return words.length > 1 && words.every((word) => /^\p{Lu}/u.test(word));
    };
    const translatedLiterals = (file) =>
      [
        ...fs
          .readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
          .matchAll(/\bt\(\s*(?:'((?:[^'\\]|\\.)+)'|"((?:[^"\\]|\\.)+)")/g),
      ].map((match) => (match[1] ?? match[2]).replace(/\\(.)/g, '$1'));

    test.each(['src/settings.js', 'src/hotkeys.js'])(
      'the labels %s builds as it runs are written in it',
      (file) => {
        // "Retry Conflict Check" and "Keep Current" sat beside "Sync up" and "Cancel", and the light
        // actions read "Toggle, Turn on, Turn off, Brightness Up" in one list.
        const titleCase = translatedLiterals(file).filter((text) =>
          text
            .replace(/\{\{\w+\}\}/g, ' ')
            .split(/[.,:;!?·•()]|\s[–—-]\s/)
            .some(isTitleCaseClause)
        );
        expect(titleCase).toEqual([]);
      }
    );
  });

  describe('the Hotkeys page', () => {
    test('calls the popup hotkey by that one name', () => {
      // The Hyprland note said "popup shortcut" and its button "Refresh shortcut status", right
      // above the setting named Popup hotkey.
      const page = byId('hotkeys-tab');
      expect(page.textContent).toContain('Popup hotkey');
      expect(page.textContent).not.toMatch(/popup shortcut|shortcut status/i);
    });
  });

  describe('landmarks and headings', () => {
    test('the window title is the h1 and Quick Access an h2, inside one main landmark', () => {
      const title = document.querySelector('.widget-title');
      expect(title.tagName).toBe('H1');
      expect(document.querySelector('.quick-access-label').tagName).toBe('H2');
      const main = document.querySelector('.widget-content');
      expect(main.getAttribute('role')).toBe('main');
      expect(main.contains(document.querySelector('.quick-access-label'))).toBe(true);
    });

    test('a Settings page header is not a banner landmark', () => {
      expect(document.querySelectorAll('#settings-modal header')).toHaveLength(0);
      const headers = document.querySelectorAll('#settings-modal .settings-page-header');
      expect(headers).toHaveLength(6);
      headers.forEach((header) => expect(header.querySelector('h3')).not.toBeNull());
    });
  });

  describe('the header buttons', () => {
    test('the minimize line sits on a pixel row at 16px, so it is one crisp row, not two at half strength', () => {
      const d = byId('minimize-btn').querySelector('path').getAttribute('d');
      const row = Number(/^M5 ([\d.]+)h14$/.exec(d)[1]) * (16 / 24);
      // The centre of a pixel row (x.5) is where a one pixel stroke is drawn without blur.
      expect(row % 1).toBeCloseTo(0.5, 5);
    });
  });

  describe('Save and Cancel', () => {
    test('end with the primary action, in the DOM so Tab follows what the eye does', () => {
      for (const [modal, cancel, save] of [
        ['settings-modal', 'cancel-settings', 'save-settings'],
        ['alert-config-modal', 'cancel-alert', 'save-alert'],
      ]) {
        const buttons = [...byId(modal).querySelectorAll('.modal-footer .btn')].map((b) => b.id);
        expect(buttons).toEqual([cancel, save]);
      }
    });
  });

  describe('Settings copy that depends on its place', () => {
    test('the top cards help comes before the search and list it points down to', () => {
      const body = byId('primary-cards-body');
      const help = body.querySelector('.form-help');
      expect(help.getAttribute('data-i18n')).toMatch(/Choose an entity below/);
      expect(
        help.compareDocumentPosition(byId('primary-cards-list')) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        help.compareDocumentPosition(byId('primary-cards-search')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    test('the weather override is a setting row like the switches around it', () => {
      const group = byId('weather-override-group');
      expect(group.classList.contains('setting-row')).toBe(true);
      expect(
        group.querySelector('.setting-text label[for="weather-override-select"]')
      ).not.toBeNull();
      expect(group.querySelector('.form-help').textContent).not.toMatch(/for testing/);
      expect(group.style.display).toBe('none');
    });

    test('Need help? is a link under the Profile sync description, not a third overwrite button', () => {
      const help = byId('profile-sync-help-btn');
      expect(
        help.closest('.setting-text').querySelector('label[for="profile-sync-enabled"]')
      ).not.toBeNull();
      expect(help.classList.contains('btn-link')).toBe(true);
      expect(help.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      const replaceRow = byId('profile-sync-push-now').parentElement;
      expect([...replaceRow.children].map((node) => node.id)).toEqual([
        'profile-sync-push-now',
        'profile-sync-pull-now',
      ]);
    });

    test('Restore dashboard has a row of its own with a title and help, outside Diagnostics', () => {
      const button = byId('dashboard-history-btn');
      const row = button.closest('.form-group');
      expect(row.querySelector('.setting-label').getAttribute('data-i18n')).toBe('Page layouts');
      expect(row.querySelector('.form-help').textContent).toMatch(/last 20 page layouts/);
      const diagnostics = byId('view-logs-btn').closest('.settings-group');
      expect(diagnostics.contains(button)).toBe(false);
    });

    test('the Language card has no "Selected language" line repeating the select', () => {
      expect(byId('language-current-summary')).toBeNull();
      expect(byId('language-select-help').hasAttribute('data-no-describe')).toBe(true);
    });

    test('the Hide to tray help does not name a Linux mode on every platform', () => {
      expect(byId('hide-on-blur-help').textContent).not.toMatch(/Linux/);
    });

    test('the suggested hotkeys are skipped by Settings search', () => {
      const chips = document.querySelectorAll('.preset-hotkey-btn');
      expect(chips.length).toBeGreaterThan(0);
      chips.forEach((chip) => expect(chip.hasAttribute('data-search-skip')).toBe(true));
    });

    test('the Holidays list has a one-line help under its caption', () => {
      const list = document.querySelector('.seasonal-holiday-list');
      expect(list.querySelector(':scope > .form-help').textContent).toMatch(/switched on/);
    });

    test('the media tile help names the media tile, like the caption above it', () => {
      expect(
        byId('primary-media-player').closest('.settings-group').querySelector('h4').textContent
      ).toBe('Media tile');
      expect(
        byId('primary-media-player').closest('.form-group').querySelector('.form-help').textContent
      ).not.toMatch(/media bar/);
    });
  });

  describe('the media tile', () => {
    test('the track is a button, so the card that looks clickable opens the player', () => {
      const info = byId('media-tile-info');
      expect(info.tagName).toBe('BUTTON');
      expect(info.type).toBe('button');
      expect(info.contains(byId('media-tile-title'))).toBe(true);
      expect(info.contains(byId('media-tile-artist'))).toBe(true);
      expect(info.getAttribute('title')).toBe('Controls');
      // The play, previous and next buttons stay beside it, not inside it
      expect(info.querySelector('button')).toBeNull();
    });
  });

  describe('help text', () => {
    test('each setting control is described by the help beside it, once Settings is built', () => {
      linkSettingsHelpText(byId('settings-modal'));

      for (const id of [
        'frosted-glass',
        'active-tile-glow',
        'ui-scale-select',
        'density-select',
        'seasonal-colors',
        'global-hotkeys-enabled',
        'entity-alerts-enabled',
        'profile-sync-enabled',
        'profile-sync-provider',
        'allow-prerelease-updates',
      ]) {
        const control = byId(id);
        const described = control.getAttribute('aria-describedby');
        expect(described).toBeTruthy();
        described.split(' ').forEach((ref) => {
          expect(byId(ref)).not.toBeNull();
          expect(byId(ref).matches('.form-help, .help-text')).toBe(true);
        });
      }
    });

    test('a row that has two controls, and status lines, are left alone', () => {
      const before = byId('seasonal-enabled').getAttribute('aria-describedby');
      linkSettingsHelpText(byId('settings-modal'));

      // The colour editor row holds a picker, a hex field and three channels: one help line would
      // describe the wrong one of them
      expect(byId('custom-color-picker').getAttribute('aria-describedby')).toBeNull();
      // The hand-written description of a switch keeps its status line
      expect(byId('seasonal-enabled').getAttribute('aria-describedby')).toBe(before);
    });

    test('ids are named after the control, so they do not change from run to run', () => {
      linkSettingsHelpText(byId('settings-modal'));
      expect(byId('ui-scale-select').getAttribute('aria-describedby')).toBe('ui-scale-select-help');
      linkSettingsHelpText(byId('settings-modal'));
      expect(byId('ui-scale-select').getAttribute('aria-describedby')).toBe('ui-scale-select-help');
    });

    test('no id appears twice once the help lines have been named', () => {
      linkSettingsHelpText(byId('settings-modal'));
      const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
      expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    });

    test('the language select is described by its own note, not by the download hint', () => {
      // The download hint is skipped (data-no-describe), so the line after it is the first to be
      // named, and it must not take the id the hint already has
      linkSettingsHelpText(byId('settings-modal'));
      const select = byId('language-select');
      const [described, ...rest] = select.getAttribute('aria-describedby').split(' ');
      expect(rest).toEqual([]);
      expect(described).not.toBe('language-select-help');
      expect(byId(described).textContent.trim()).toBe('Language changes take effect immediately.');

      // Showing and hiding the hint adds and removes only the hint
      const hint = byId('language-select-help');
      setDescribedByLine(select, hint, true);
      expect(select.getAttribute('aria-describedby').split(' ')).toEqual([
        described,
        'language-select-help',
      ]);
      setDescribedByLine(select, hint, false);
      expect(select.getAttribute('aria-describedby')).toBe(described);
    });

    test('a line is added to a description while it is shown and taken off when it is hidden', () => {
      const select = byId('language-select');
      const hint = byId('language-select-help');
      setDescribedByLine(select, hint, true);
      expect(select.getAttribute('aria-describedby')).toContain('language-select-help');
      setDescribedByLine(select, hint, false);
      expect(select.getAttribute('aria-describedby') || '').not.toContain('language-select-help');
    });
  });

  describe('the command palette tip', () => {
    test('names the shortcut through a placeholder, Ctrl+K until the platform says otherwise', () => {
      const hint = byId('command-palette-hint');
      expect(hint.getAttribute('data-i18n')).toBe(
        'Tip: press {{shortcut}} anywhere to search entities, run commands, and switch pages.'
      );
      expect(JSON.parse(hint.getAttribute('data-i18n-vars'))).toEqual({ shortcut: 'Ctrl+K' });
    });
  });
});
