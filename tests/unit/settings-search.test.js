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
    search('Access token')
      .find((button) => button.firstChild.textContent === 'Access token')
      .click();
    expect(details.open).toBe(true);
    expect(document.activeElement.id).toBe('ha-token');
  });
  test('opens custom disclosures through their hydration handler', () => {
    const section = document.getElementById('custom-entity-icons-section');
    const toggle = section.querySelector('.section-toggle');
    toggle.onclick = jest.fn(() => section.classList.remove('collapsed'));
    const label = section.querySelector('label');
    search('custom-entity-icons-search')
      .find((button) => button.firstChild.textContent === label.textContent.trim())
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
  test('does not offer settings hidden on the current platform', () => {
    document.getElementById('follow-omarchy-group').classList.add('hidden');
    expect(search('Follow Omarchy theme')).toHaveLength(0);
  });
  test('indexes a nested-label checkbox once, with a clean title', () => {
    const results = search('Christmas');
    expect(results).toHaveLength(1);
    expect(results[0].firstChild.textContent).toBe('Christmas');
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
      ['Need Help?', 'profile-sync-help-btn'],
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
  test('lowercases independently of the host locale', () => {
    const spy = jest.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function () {
      return String(this).replace(/I/g, '\u0131').toLowerCase();
    });
    try {
      expect(search('CHRISTMAS')).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
