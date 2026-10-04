const fs = require('fs');
const { initializeSettingsSearch, settingsSearchEntries } = require('../../src/settings-search.js');

describe('settings search', () => {
  let modal, input;
  beforeEach(() => {
    document.body.innerHTML = fs.readFileSync(
      require('path').resolve(__dirname, '../../index.html'),
      'utf8'
    );
    modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    input = document.getElementById('settings-search');
    initializeSettingsSearch(modal);
    window.requestAnimationFrame = (callback) => callback();
    modal.querySelectorAll('.modal-tabs button').forEach((button) => {
      button.addEventListener('click', () => {
        modal
          .querySelectorAll('.tab-content')
          .forEach((panel) =>
            panel.classList.toggle('active', panel.id === `${button.dataset.tab}-tab`)
          );
      });
    });
  });
  const search = (text) => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
    return [...document.querySelectorAll('.settings-search-result')];
  };
  test('finds controls across inactive pages using label and help text', () => {
    expect(
      search('beta updates').some((button) => button.textContent.includes('Receive beta updates'))
    ).toBe(true);
    search('beta updates')
      .find((button) => button.textContent.includes('Receive beta updates'))
      .click();
    expect(document.getElementById('advanced-tab').classList.contains('active')).toBe(true);
    expect(document.activeElement.id).toBe('allow-prerelease-updates');
    expect(input.value).toBe('');
  });
  test('opens collapsed native disclosures before focusing their control', () => {
    const details = document.getElementById('legacy-ha-token-settings');
    expect(details.open).toBe(false);
    search('access token')
      .find((button) => /access token$/i.test(button.firstChild.textContent))
      .click();
    expect(details.open).toBe(true);
    expect(document.activeElement.id).toBe('ha-token');
  });
  test('opens custom disclosures through their hydration handler', () => {
    const section = document.getElementById('custom-entity-icons-section');
    const toggle = section.querySelector('.section-toggle');
    toggle.onclick = jest.fn(() => section.classList.remove('collapsed'));
    const label = section.querySelector('label');
    // "Search entities" is also on the top cards; the group says which result is this one.
    search(label.textContent.trim())
      .find((button) => button.lastChild.textContent.endsWith('Custom Entity Icons'))
      .click();
    expect(toggle.onclick).toHaveBeenCalledTimes(1);
    expect(section.classList.contains('collapsed')).toBe(false);
  });
  test('uses current translated labels and does not index credentials', () => {
    document.querySelector('label[for="ha-token"]').textContent = 'Clé secrète';
    document.getElementById('ha-token').value = 'secret-do-not-index';
    expect(search('cle secrete')).toHaveLength(1);
    expect(search('secret-do-not-index')).toHaveLength(0);
    expect(
      settingsSearchEntries(modal).some((entry) => entry.text.includes('secret-do-not-index'))
    ).toBe(false);
    expect(document.getElementById('settings-search-status').textContent).toBe(
      'No matching settings'
    );
  });
  test('Escape clears the query first, and reopening clears old results', () => {
    search('theme');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(modal.classList.contains('settings-searching')).toBe(false);
    search('theme');
    initializeSettingsSearch(modal);
    expect(input.value).toBe('');
    expect(document.querySelectorAll('.settings-search-result')).toHaveLength(0);
  });
  describe('keyboard and the rail while results stand in for the page', () => {
    const press = (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    const tabs = () => [...modal.querySelectorAll('.modal-tabs .tab-link')];

    test('Escape on a result backs out of the search and does not leave Settings', () => {
      const results = search('theme');
      expect(results.length).toBeGreaterThan(1);
      results[1].focus();
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);

      const event = press(results[1], 'Escape');

      document.removeEventListener('keydown', pageEscape);
      expect(event.defaultPrevented).toBe(true);
      // Stopped here: Settings would have closed and thrown away every unsaved edit.
      expect(pageEscape).not.toHaveBeenCalled();
      expect(input.value).toBe('');
      expect(modal.classList.contains('settings-searching')).toBe(false);
      expect(document.activeElement).toBe(input);
    });

    test.each([
      ['isComposing', { isComposing: true }],
      ['keyCode 229', { keyCode: 229 }],
    ])('leaves the Enter and arrows of an input method composition (%s) to it', (_label, init) => {
      const results = search('theme');
      expect(results.length).toBeGreaterThan(0);
      input.focus();

      for (const key of ['Enter', 'ArrowDown']) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        });
        input.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(input);
      }
      // Escape cancels the composition, not the query.
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      input.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(false);
      expect(input.value).toBe('theme');
      // And once the composition is over Enter moves on to the first result again.
      press(input, 'Enter');
      expect(document.activeElement).toBe(results[0]);
    });

    test('the arrows walk the results, and Up from the first returns to the field', () => {
      const results = search('theme');
      results[0].focus();

      press(results[0], 'ArrowDown');
      expect(document.activeElement).toBe(results[1]);
      press(results[1], 'ArrowUp');
      expect(document.activeElement).toBe(results[0]);
      press(results[0], 'ArrowUp');
      expect(document.activeElement).toBe(input);
      // The last result has nowhere further to go, and stays put.
      const last = results.at(-1);
      last.focus();
      press(last, 'ArrowDown');
      expect(document.activeElement).toBe(last);
    });

    test('no page is selected in the rail while results stand in for it, and the current one returns after', () => {
      expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toContain('true');
      const selected = tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
      selected.classList.add('active');

      search('theme');
      expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(
        Array(tabs().length).fill('false')
      );

      input.value = '';
      input.dispatchEvent(new Event('input'));
      expect(selected.getAttribute('aria-selected')).toBe('true');
    });

    test('choosing a page from the rail while searching selects that page, not the one before', () => {
      const first = tabs()[0];
      first.classList.add('active');
      search('theme');
      const other = tabs()[1];
      other.addEventListener('click', () => {
        tabs().forEach((tab) => {
          tab.classList.toggle('active', tab === other);
          tab.setAttribute('aria-selected', String(tab === other));
        });
      });

      other.click();

      expect(other.getAttribute('aria-selected')).toBe('true');
      expect(first.getAttribute('aria-selected')).toBe('false');
    });

    test('names the results region by the count it announces', () => {
      const region = document.getElementById('settings-search-results');

      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('aria-labelledby')).toBe('settings-search-status');
    });

    test('marks the setting a result jumped to, for a moment', () => {
      jest.useFakeTimers();
      try {
        search('beta updates')
          .find((button) => button.textContent.includes('Receive beta updates'))
          .click();
        const target = document.querySelector('.settings-search-target');

        expect(target).not.toBeNull();
        expect(target.contains(document.getElementById('allow-prerelease-updates'))).toBe(true);
        jest.advanceTimersByTime(1700);
        expect(document.querySelector('.settings-search-target')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
  test('does not offer settings hidden on the current platform', () => {
    document.getElementById('follow-omarchy-group').classList.add('hidden');
    expect(search('Follow Omarchy theme')).toHaveLength(0);
  });
  test('indexes a nested-label checkbox once, with a clean title', () => {
    const results = search('Christmas');
    // The one-day preview offers Christmas as a choice, so it is found too, after the setting
    // that is called Christmas.
    expect(results.map((button) => button.firstChild.textContent)).toEqual([
      'Christmas',
      'Holiday to show',
    ]);
  });
  test('focuses the matched checkbox in a multi-checkbox group', () => {
    search('Christmas')[0].click();
    expect(document.activeElement.dataset.holiday).toBe('christmas');
    search('Thanksgiving')[0].click();
    expect(document.activeElement.dataset.holiday).toBe('thanksgiving');
  });
  test('does not offer controls hidden with inline display', () => {
    const group = document.getElementById('weather-override-group');
    expect(group.style.display).toBe('none');
    expect(search('Weather effect override')).toHaveLength(0);
    // The index is rebuilt per query, so a later reveal makes it findable.
    group.style.display = '';
    expect(search('Weather effect override')).toHaveLength(1);
  });
  test('finds and focuses a control named only through aria-label', () => {
    const results = search('Weather source');
    expect(results.map((button) => button.firstChild.textContent)).toContain('Weather source');
    results.find((button) => button.firstChild.textContent === 'Weather source').click();
    expect(document.activeElement.id).toBe('weather-entity-select');
  });
  test('skips a label the stylesheet hides in favor of its visible duplicate', () => {
    const style = document.createElement('style');
    style.textContent =
      '#settings-modal .form-group.custom-color-editor > label:first-child { display: none; }';
    document.head.appendChild(style);
    try {
      const titles = search('Custom color').map((button) => button.firstChild.textContent);
      expect(titles.filter((title) => title === 'Custom color')).toHaveLength(1);
    } finally {
      style.remove();
    }
  });
  test('offers an ARIA-named control whose own labels are all hidden', () => {
    const style = document.createElement('style');
    // The editor's own stylesheet hides both labels for the picker.
    style.textContent = [
      '#settings-modal .form-group.custom-color-editor > label:first-child { display: none; }',
      '#settings-modal .custom-color-editor-grid > :nth-child(1) .custom-color-field-label { display: none; }',
    ].join('\n');
    document.head.appendChild(style);
    try {
      const result = search('Color picker').find(
        (button) => button.firstChild.textContent === 'Color picker'
      );
      expect(result).toBeDefined();
      result.click();
      expect(document.activeElement.id).toBe('custom-color-picker');
    } finally {
      style.remove();
    }
  });
  test('focuses the visible radio group for a label it references', () => {
    search('Edit colors for')
      .find((button) => button.firstChild.textContent === 'Edit colors for')
      .click();
    expect(document.activeElement.dataset.colorTarget).toBe('accent');
  });
  test('finds settings action buttons by their label', () => {
    for (const [query, id] of [
      ['Sync now', 'profile-sync-now'],
      ['Sync Up', 'profile-sync-push-now'],
      ['Support this project', 'open-donate-modal-btn'],
    ]) {
      document
        .querySelectorAll('.profile-sync-settings')
        .forEach((el) => el.classList.remove('hidden'));
      const result = search(query).find((button) => button.firstChild.textContent === query);
      expect(result).toBeDefined();
      result.click();
      expect(document.activeElement.id).toBe(id);
    }
  });
  test('does not index the Details button of the live sync status', () => {
    document
      .querySelectorAll('.profile-sync-settings, #profile-sync-error-toggle')
      .forEach((el) => el.classList.remove('hidden'));
    expect(
      settingsSearchEntries(modal).some((entry) => entry.label.id === 'profile-sync-error-toggle')
    ).toBe(false);
    // The settings beside it are still found.
    expect(search('Sync now').length).toBeGreaterThan(0);
  });
  test('finds action buttons whose labels are set by JavaScript', () => {
    // The app enables the update check once it knows the update channel.
    document.getElementById('check-updates-btn').disabled = false;
    for (const [query, id] of [
      ['Connect with Home Assistant', 'connect-ha-oauth-btn'],
      ['Set hotkey', 'popup-hotkey-set-btn'],
      ['Check for updates', 'check-updates-btn'],
    ]) {
      const result = search(query).find((button) => button.firstChild.textContent === query);
      expect(result).toBeDefined();
      result.click();
      expect(document.activeElement.id).toBe(id);
    }
  });
  test('does not index generated entity list rows', () => {
    const list = document.getElementById('custom-entity-icons-list');
    for (const id of ['light.one', 'light.two', 'light.three']) {
      const input = document.createElement('input');
      input.setAttribute('aria-label', `Custom icon for ${id}`);
      list.appendChild(input);
    }
    expect(search('Custom icon for')).toHaveLength(0);
  });
  test('does not index buttons generated for alerts or language packs', () => {
    const removeResults = () =>
      search('Remove').filter((button) => button.firstChild.textContent === 'Remove').length;
    const before = removeResults();
    for (const id of ['inline-alerts-list', 'language-packs-list']) {
      for (let i = 0; i < 3; i += 1) {
        const button = document.createElement('button');
        button.className = 'btn btn-secondary';
        button.textContent = 'Remove';
        document.getElementById(id).appendChild(button);
      }
    }
    expect(removeResults()).toBe(before);
  });
  test('searches help text translated as HTML or set by JavaScript, but not status lines', () => {
    expect(search('Modifiers').length).toBeGreaterThan(0);
    expect(search('brings the window to front').length).toBeGreaterThan(0);
    document.getElementById('update-status').textContent = 'Version 9.9.9 is ready';
    expect(search('9.9.9')).toHaveLength(0);
  });
  test('lowercases independently of the host locale', () => {
    const spy = jest.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function () {
      return String(this).replace(/I/g, '\u0131').toLowerCase();
    });
    try {
      expect(search('CHRISTMAS')[0].firstChild.textContent).toBe('Christmas');
    } finally {
      spy.mockRestore();
    }
  });

  describe('what is searched, and in what order', () => {
    const titles = (results) => results.map((button) => button.firstChild.textContent);

    test('does not match on control ids nobody sees', () => {
      expect(search('weather-effects-enabled')).toHaveLength(0);
      expect(search('enabled')).toHaveLength(0);
      expect(
        settingsSearchEntries(modal).some((entry) => entry.text.includes('language-select'))
      ).toBe(false);
    });

    test('finds a setting by the names of its choices', () => {
      expect(titles(search('dark'))).toEqual(['Mode']);
      expect(titles(search('24-hour'))).toContain('Time format');
    });

    test('English words still find a setting in a translated interface', () => {
      const label = document.getElementById('theme-mode-label');
      label.textContent = 'Darstellung';
      expect(titles(search('darstellung'))).toEqual(['Darstellung']);
      // The label is data-i18n="Mode": the English the docs and the community use.
      expect(titles(search('mode'))).toContain('Darstellung');
    });

    test('a page is one result, not a match on every row of it', () => {
      // The Appearance description names themes, colours and glass; the rows are not all "theme".
      expect(titles(search('readability')).filter((title) => title === 'Appearance')).toHaveLength(
        1
      );
      const hits = titles(search('readability'));
      expect(hits).toContain('Layout density');
      expect(hits).not.toContain('Mode');
    });

    test('the setting of that name leads, ahead of rows that only mention it', () => {
      const hits = titles(search('hotkey'));
      expect(hits[0]).toBe('Hotkeys');
      expect(hits.indexOf('Popup hotkey')).toBeLessThan(
        hits.indexOf('Hide to tray when focus is lost')
      );
      // Example key combinations are values to press, not settings.
      expect(hits.some((title) => /^Ctrl\+/.test(title))).toBe(false);
    });

    test('a caption over the example chips and a help link are not settings', () => {
      expect(titles(search('suggestions'))).not.toContain('Suggestions');
      // "Need Help?" opens the docs; the settings it sits among are the results for "sync"
      expect(titles(search('need help'))).not.toContain('Need Help?');
      expect(titles(search('sync'))).not.toContain('Need Help?');
    });

    test('finds a page although the stylesheet shows only the current one', () => {
      const style = document.createElement('style');
      style.textContent = '#settings-modal .tab-content:not(.active) { display: none; }';
      document.head.appendChild(style);
      try {
        document.getElementById('general-tab').classList.add('active');
        const hits = titles(search('hotkeys'));
        // The Hotkeys page is not the current one, and still leads
        expect(hits[0]).toBe('Hotkeys');
      } finally {
        style.remove();
      }
    });

    test('says which group a result is in, beside its page', () => {
      expect(search('Christmas')[0].lastChild.textContent).toBe('Appearance › Seasonal Themes');
    });

    test('does not offer a button that cannot be pressed', () => {
      document.getElementById('check-updates-btn').disabled = true;
      expect(titles(search('Check for updates'))).not.toContain('Check for updates');
      document.getElementById('check-updates-btn').disabled = false;
      expect(titles(search('Check for updates'))).toContain('Check for updates');
    });
  });

  describe('the empty and the single result', () => {
    const status = () => document.getElementById('settings-search-status').textContent;

    test('a query of only separators leaves the page as it was', () => {
      for (const query of ['-', '_', ' - _ ']) {
        search(query);
        expect(modal.classList.contains('settings-searching')).toBe(false);
        expect(document.getElementById('settings-search-results').hidden).toBe(true);
        expect(status()).toBe('');
      }
    });

    test('says "1 matching setting" for a single result', () => {
      expect(search('Restore dashboard')).toHaveLength(1);
      expect(status()).toBe('1 matching setting');
      search('sync');
      expect(status()).toMatch(/^\d+ matching settings$/);
    });

    test('no match draws an empty state naming the query, and keeps the plain status line', () => {
      search('zzzz');
      const empty = document.querySelector('#settings-search-results .settings-search-empty');
      expect(empty).not.toBeNull();
      expect(empty.querySelector('.settings-search-empty-title').textContent).toBe(
        'No settings match “zzzz”'
      );
      expect(empty.textContent).toContain('clear the search');
      expect(status()).toBe('No matching settings');
    });

    test('the plain status line is for assistive technology only while the empty state is shown', () => {
      const statusLine = document.getElementById('settings-search-status');
      search('zzzz');
      expect(statusLine.classList.contains('sr-only')).toBe(true);
      // Any other search, and clearing it, brings the line back for the eye
      search('theme');
      expect(statusLine.classList.contains('sr-only')).toBe(false);
      search('zzzz');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      expect(statusLine.classList.contains('sr-only')).toBe(false);
    });
  });
});
