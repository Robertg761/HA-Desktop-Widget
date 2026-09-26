/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const i18n = require('../../src/i18n.js');

function loadIndexBody() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
}

describe('index.html static Settings text', () => {
  beforeEach(() => {
    loadIndexBody();
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: {
        'Show an entity on a card': 'Entität auf einer Karte anzeigen',
        'Profile sync': 'Profilsynchronisierung',
        'Search entities...': 'Entitäten suchen...',
        'Theme colors': 'Themenfarben',
        'Card {{index}}': 'Karte {{index}}',
        'Click the button and press your desired key combination. Press <code>ESC</code> to clear.':
          'Klicke auf die Schaltfläche und drücke die Tastenkombination. <code>ESC</code> löscht sie.',
        'View logs': 'Protokolle anzeigen',
        'Opens the log file location in your file explorer':
          'Öffnet den Speicherort der Protokolldatei im Dateimanager',
      },
    });
    i18n.translateDocument(document);
  });

  afterEach(() => {
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    document.body.innerHTML = '';
  });

  test('translates section headings without dropping their toggle icons', () => {
    const toggle = document.getElementById('primary-cards-toggle');
    expect(toggle.querySelector('[data-i18n]').textContent).toBe(
      'Entität auf einer Karte anzeigen'
    );
    expect(toggle.querySelector('svg.section-toggle-icon')).not.toBeNull();
  });

  test('keeps switches labelled by translated text', () => {
    const checkbox = document.getElementById('profile-sync-enabled');
    expect(document.querySelector('label[for="profile-sync-enabled"]').textContent).toBe(
      'Profilsynchronisierung'
    );
    const remember = document.getElementById('profile-sync-remember-passphrase');
    expect(remember.closest('label').querySelector('[data-i18n]')).not.toBeNull();
    expect(checkbox.closest('.setting-row')).not.toBeNull();
  });

  test('translates placeholders, aria labels, titles and templated labels', () => {
    expect(document.getElementById('primary-cards-search').placeholder).toBe('Entitäten suchen...');
    expect(document.getElementById('alert-entity-picker-search').placeholder).toBe(
      'Entitäten suchen...'
    );
    expect(document.getElementById('theme-options').getAttribute('aria-label')).toBe(
      'Themenfarben'
    );
    const viewLogs = document.getElementById('view-logs-btn');
    expect(viewLogs.title).toBe('Öffnet den Speicherort der Protokolldatei im Dateimanager');
    expect(viewLogs.textContent).toContain('Protokolle anzeigen');
    expect(
      [...document.querySelectorAll('.primary-card-row .setting-label')].map(
        (label) => label.textContent
      )
    ).toEqual(['Karte 1', 'Karte 2']);
  });

  test('keeps code formatting in translated help text', () => {
    const help = document.querySelector('[data-i18n-html^="Click the button and press"]');
    expect(help.textContent).toBe(
      'Klicke auf die Schaltfläche und drücke die Tastenkombination. ESC löscht sie.'
    );
    expect(help.querySelectorAll('code')).toHaveLength(1);
  });
});
