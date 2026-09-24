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

  it('formats dates and times with German regional conventions', () => {
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: {},
    });

    const date = new Date(2026, 8, 8, 14, 35, 0);
    const numericDate = i18n.formatDate(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const longDate = i18n.formatDate(date, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const time = i18n
      .formatTime(date, { hour: '2-digit', minute: '2-digit', hour12: false })
      .replace(/\s/g, '');

    expect(numericDate).toBe('08.09.2026');
    expect(longDate.toLowerCase()).toContain('dienstag');
    expect(longDate.toLowerCase()).toContain('september');
    expect(longDate).toMatch(/8/);
    expect(time).toMatch(/14:35/);
  });
  it('formats numbers with the active language', () => {
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: {} });
    expect(i18n.formatNumber(15.6)).toBe('15,6');
    expect(i18n.formatNumber(3.14159, { maximumFractionDigits: 1 })).toBe('3,1');
    expect(i18n.formatNumber(1234.5)).toBe('1.234,5');

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    expect(i18n.formatNumber(15.6)).toBe('15.6');
    // Like Home Assistant's own frontend, large values get the locale's grouping separator.
    expect(i18n.formatNumber(1234.5)).toBe('1,234.5');
    expect(i18n.formatNumber('not a number')).toBe('not a number');
    expect(i18n.formatNumber(null)).toBe('');
  });

  it('keeps the decimals Home Assistant sent when formatting numeric states', () => {
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: {} });
    expect(i18n.formatNumericState('15.6')).toBe('15,6');
    expect(i18n.formatNumericState('15.60')).toBe('15,60');
    expect(i18n.formatNumericState('-3')).toBe('-3');
    expect(i18n.formatNumericState('on')).toBe('on');
    expect(i18n.formatNumericState('2026-09-08')).toBe('2026-09-08');
    expect(i18n.formatNumericState('007')).toBe('007');
    expect(i18n.formatNumericState('0.5')).toBe('0,5');

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    expect(i18n.formatNumericState('15.60')).toBe('15.60');
  });
});
