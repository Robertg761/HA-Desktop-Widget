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
});
