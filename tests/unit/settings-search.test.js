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
