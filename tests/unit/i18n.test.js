/**
 * @jest-environment jsdom
 */

const i18n = require('../../src/i18n.js');

describe('renderer i18n helpers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    i18n.setLocaleBootstrap({
      activeLocale: 'fr',
      messages: {
        Hello: 'Bonjour',
        Greeting: 'Salut {{name}}',
        'Selected language: {{language}}': 'Langue choisie : {{language}}',
        Title: 'Titre',
        Placeholder: 'Valeur',
      },
    });
  });

  it('formats translated strings with variables', () => {
    expect(i18n.t('Hello')).toBe('Bonjour');
    expect(i18n.t('Greeting', { name: 'Alex' })).toBe('Salut Alex');
  });

  it('falls back to source text when a key is missing', () => {
    expect(i18n.t('Missing string')).toBe('Missing string');
  });

  it('translates DOM text and attributes', () => {
    document.body.innerHTML = `
      <button id="text" data-i18n="Hello">Hello</button>
      <input id="input" data-i18n-placeholder="Placeholder" placeholder="Placeholder" />
      <div id="title" data-i18n-title="Title" title="Title"></div>
    `;

    i18n.translateDocument(document);

    expect(document.getElementById('text').textContent).toBe('Bonjour');
    expect(document.getElementById('input').getAttribute('placeholder')).toBe('Valeur');
    expect(document.getElementById('title').getAttribute('title')).toBe('Titre');
  });

  it('preserves existing DOM text when placeholder variables are missing', () => {
    document.body.innerHTML = `
      <p id="summary" data-i18n="Selected language: {{language}}">Selected language: English</p>
    `;

    i18n.translateDocument(document);

    expect(document.getElementById('summary').textContent).toBe('Selected language: English');
  });

  it('interpolates DOM text when data-i18n-vars are provided', () => {
    document.body.innerHTML = `
      <p
        id="summary"
        data-i18n="Selected language: {{language}}"
        data-i18n-vars='{"language":"French"}'
      >Selected language: English</p>
    `;

    i18n.translateDocument(document);

    expect(document.getElementById('summary').textContent).toBe('Langue choisie : French');
  });

  it('switches document direction for RTL locales', () => {
    i18n.setLocaleBootstrap({
      activeLocale: 'ar',
      messages: {
        Hello: 'مرحبا',
      },
    });

    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});
