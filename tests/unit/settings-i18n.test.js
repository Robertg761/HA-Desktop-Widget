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
        'Color Themes': 'Farbthemen',
        'Enable Profile Sync (Opt-in)': 'Profilsynchronisierung aktivieren (optional)',
        'Search entities...': 'Entitäten suchen...',
        'Theme colors': 'Themenfarben',
        'Card {{index}}': 'Karte {{index}}',
        'Hex format uses <code>#RRGGBB</code> (example: <code>#34A1FF</code>).':
          'Hex-Format: <code>#RRGGBB</code> (Beispiel: <code>#34A1FF</code>).',
        'View Logs': 'Protokolle anzeigen',
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
    const toggle = document.getElementById('color-themes-toggle');
    expect(toggle.querySelector('[data-i18n]').textContent).toBe('Farbthemen');
    expect(toggle.querySelector('.section-toggle-icon svg')).not.toBeNull();
  });

  test('keeps checkboxes inside labels whose text is translated', () => {
    const checkbox = document.getElementById('profile-sync-enabled');
    expect(checkbox.parentElement.textContent).toContain(
      'Profilsynchronisierung aktivieren (optional)'
    );
    expect(checkbox.closest('label')).not.toBeNull();
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
      [...document.querySelectorAll('.primary-card-label')].map((label) => label.textContent)
    ).toEqual(['Karte 1', 'Karte 2']);
  });

  test('keeps code formatting in translated help text', () => {
    const help = document.querySelector('[data-i18n-html^="Hex format uses"]');
    expect(help.textContent).toBe('Hex-Format: #RRGGBB (Beispiel: #34A1FF).');
    expect(help.querySelectorAll('code')).toHaveLength(2);
  });
});
