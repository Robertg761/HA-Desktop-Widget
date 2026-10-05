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
        'Sync this profile across computers': 'Profilsynchronisierung',
        'Search entities...': 'Entitäten suchen...',
        'Search entities': 'Entitäten suchen',
        'Card {{index}}': 'Karte {{index}}',
        'Toggle or control entities from anywhere. Hold {{ctrl}}, {{alt}} or {{meta}} with the key, and {{shift}} too if you like (for example <code>{{example}}</code>).':
          'Schalte oder steuere Entitäten von überall aus. Halte {{ctrl}}, {{alt}} oder {{meta}} zur Taste gedrückt, auf Wunsch auch {{shift}} (zum Beispiel <code>{{example}}</code>).',
        'Show log file': 'Protokolldatei zeigen',
        'Shows the log file in your file manager': 'Zeigt die Protokolldatei im Dateimanager',
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
    expect(document.getElementById('hotkey-entity-search').getAttribute('aria-label')).toBe(
      'Entitäten suchen'
    );
    // The colour swatches take their name from the caption above them, whatever its language.
    expect(document.getElementById('theme-options').getAttribute('aria-labelledby')).toBe(
      'theme-options-label'
    );
    expect(document.getElementById('theme-options-label')).not.toBeNull();
    const viewLogs = document.getElementById('view-logs-btn');
    expect(viewLogs.title).toBe('Zeigt die Protokolldatei im Dateimanager');
    expect(viewLogs.textContent).toContain('Protokolldatei zeigen');
    expect(
      [...document.querySelectorAll('.primary-card-row .setting-label')].map(
        (label) => label.textContent
      )
    ).toEqual(['Karte 1', 'Karte 2']);
  });

  test('offers one choice per date style and starts the opacity readout at the default', () => {
    // "System default" wrote exactly what Numeric date does, so only the three styles remain.
    expect([...document.querySelectorAll('#date-format option')].map((o) => o.value)).toEqual([
      'weekday-short',
      'long',
      'numeric',
    ]);
    // The time format still follows the language by default.
    expect(document.querySelector('#time-format option').value).toBe('system');
    // The stored default is 95%, not the slider position of 90.
    expect(document.getElementById('opacity-value').textContent).toBe('95%');
  });

  test('keeps code formatting in translated help text', () => {
    const help = document.getElementById('entity-hotkeys-help');
    expect(help.textContent).toBe(
      'Schalte oder steuere Entitäten von überall aus. Halte Ctrl, Alt oder Super zur Taste gedrückt, auf Wunsch auch Shift (zum Beispiel Ctrl+Shift+A).'
    );
    expect(help.querySelector('code').textContent).toBe('Ctrl+Shift+A');
  });

  test('names the modifiers a hotkey can start from, not Shift alone or every platform’s Meta', () => {
    const help = document.getElementById('entity-hotkeys-help');
    help.setAttribute(
      'data-i18n-vars',
      JSON.stringify({
        ctrl: 'Control',
        alt: 'Option',
        meta: 'Cmd',
        shift: 'Shift',
        example: 'Shift+Cmd+A',
      })
    );
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    i18n.translateDocument(document);

    expect(help.textContent).toBe(
      'Toggle or control entities from anywhere. Hold Control, Option or Cmd with the key, and Shift too if you like (for example Shift+Cmd+A).'
    );
  });
});
