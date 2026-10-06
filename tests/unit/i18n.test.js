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

  it('keeps <code> in translated help text but renders any other markup as text', () => {
    const key = 'Press <code>ESC</code> to clear.';
    i18n.setLocaleBootstrap({
      activeLocale: 'fr',
      messages: {
        [key]: 'Appuyez sur <code>ESC</code> <img src=x onerror="window.__packXss=1"><b>vite</b>.',
      },
    });
    document.body.innerHTML = `<p id="help" data-i18n-html="${key}"></p>`;

    i18n.translateDocument(document);

    const help = document.getElementById('help');
    expect(help.querySelector('img')).toBeNull();
    expect(help.querySelector('b')).toBeNull();
    expect(Array.from(help.querySelectorAll('code'), (code) => code.textContent)).toEqual(['ESC']);
    expect(help.textContent).toBe(
      'Appuyez sur ESC <img src=x onerror="window.__packXss=1"><b>vite</b>.'
    );
    expect(window.__packXss).toBeUndefined();
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

  it('reads the direction from the language part of a regional code, in any case', () => {
    for (const [locale, dir] of [
      ['ar-EG', 'rtl'],
      ['AR', 'rtl'],
      ['he', 'rtl'],
      ['fa-IR', 'rtl'],
      ['ur', 'rtl'],
      ['hi-IN', 'ltr'],
      ['zh-CN', 'ltr'],
      ['de', 'ltr'],
    ]) {
      i18n.setLocaleBootstrap({ activeLocale: locale, messages: {} });
      expect({ locale, dir: document.documentElement.dir }).toEqual({ locale, dir });
    }
  });

  it('shares its list of right-to-left languages with the main process', () => {
    const { isRtlLocale } = require('../../packages/widget-renderer/src/rtl-locales.cjs');

    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('ar-SA')).toBe(true);
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('')).toBe(false);
    expect(isRtlLocale(undefined)).toBe(false);
  });

  it('isolates a left-to-right run only while a right-to-left language is active', () => {
    i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: {} });
    expect(i18n.isolateLtr('#AB34CD')).toBe('\u2066#AB34CD\u2069');
    i18n.setLocaleBootstrap({ activeLocale: 'ar-EG', messages: {} });
    expect(i18n.isolateLtr('#AB34CD')).toBe('\u2066#AB34CD\u2069');
    i18n.setLocaleBootstrap({ activeLocale: 'hi', messages: {} });
    expect(i18n.isolateLtr('#AB34CD')).toBe('#AB34CD');
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
  describe('dates and times, from formatters kept between calls', () => {
    const date = new Date(Date.UTC(2026, 8, 8, 14, 35, 7));
    const OPTIONS = [
      {},
      { timeZone: 'UTC' },
      { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' },
      { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' },
      { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' },
      { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' },
      { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' },
      { timeZoneName: 'short', timeZone: 'UTC' },
    ];

    // The same text the Date methods write, defaults included: a date gets day, month and year
    // when no field is named, a time gets hours, minutes and seconds, and both get both.
    it.each(['en-US', 'de-DE', 'ar-EG', 'hi-IN', 'zh-CN'])(
      'writes what the Date methods write (%s)',
      (requestedLocale) => {
        i18n.setLocaleBootstrap({
          activeLocale: requestedLocale.split('-')[0],
          requestedLocale,
          messages: {},
        });
        const locale = i18n.getFormatLocale();
        for (const options of OPTIONS) {
          if (!options.timeStyle) {
            expect(i18n.formatDate(date, options)).toBe(date.toLocaleDateString(locale, options));
          }
          if (!options.dateStyle) {
            expect(i18n.formatTime(date, options)).toBe(date.toLocaleTimeString(locale, options));
          }
          expect(i18n.formatDateTime(date, options)).toBe(date.toLocaleString(locale, options));
        }
      }
    );

    it('says Invalid Date for a date that is not one, as the Date methods do', () => {
      expect(i18n.formatDate('not a date')).toBe('Invalid Date');
      expect(i18n.formatTime(Number.NaN)).toBe('Invalid Date');
      expect(i18n.formatDateTime(new Date(Number.NaN))).toBe('Invalid Date');
    });

    it('refuses a date with only a time style, and a time with only a date style', () => {
      expect(() => i18n.formatDate(date, { timeStyle: 'short' })).toThrow(TypeError);
      expect(() => i18n.formatTime(date, { dateStyle: 'short' })).toThrow(TypeError);
    });

    it('builds a formatter once for a pattern written again and again, such as the clock', () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', requestedLocale: 'en-CA', messages: {} });
      const constructor = jest.spyOn(Intl, 'DateTimeFormat');
      try {
        const options = { hour: 'numeric', minute: '2-digit', era: 'short' };
        for (let second = 0; second < 5; second++) {
          i18n.formatTime(new Date(Date.UTC(2026, 0, 1, 10, 0, second)), options);
        }
        expect(constructor).toHaveBeenCalledTimes(1);
        // Another language is another formatter.
        i18n.setLocaleBootstrap({ activeLocale: 'de', messages: {} });
        i18n.formatTime(date, options);
        expect(constructor).toHaveBeenCalledTimes(2);
      } finally {
        constructor.mockRestore();
      }
    });

    // Chromium tells Date and new formatters when the computer's time zone changes (a laptop that
    // wakes up in another country). Here both follow a zone the test sets, as they would follow the
    // system's, so the test does not depend on the zone of the machine it runs on.
    it('writes times in the zone the computer is in now, not the one a kept formatter was built in', () => {
      const SystemDateTimeFormat = Intl.DateTimeFormat;
      let systemZone = 'Europe/London';
      // What Date#getTimezoneOffset says in a zone: minutes from local time to UTC.
      const offsetIn = (timeZone, date) => {
        const parts = Object.fromEntries(
          new SystemDateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
          })
            .formatToParts(date)
            .map(({ type, value }) => [type, Number(value)])
        );
        const wallClock = Date.UTC(
          parts.year,
          parts.month - 1,
          parts.day,
          parts.hour,
          parts.minute
        );
        return Math.round((Math.floor(date.getTime() / 60000) * 60000 - wallClock) / 60000);
      };
      const constructor = jest
        .spyOn(Intl, 'DateTimeFormat')
        .mockImplementation(
          (locale, options) =>
            new SystemDateTimeFormat(locale, { timeZone: systemZone, ...options })
        );
      const offset = jest
        .spyOn(Date.prototype, 'getTimezoneOffset')
        .mockImplementation(function () {
          return offsetIn(systemZone, this);
        });
      try {
        i18n.setLocaleBootstrap({
          languageSetting: 'en-GB',
          activeLocale: 'en',
          requestedLocale: 'en-GB',
          messages: {},
        });
        expect(i18n.getFormatLocale()).toBe('en-GB');
        const noon = new Date(Date.UTC(2026, 6, 1, 12, 0));
        const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
        expect(i18n.formatTime(noon, options)).toBe('13:00');
        expect(i18n.formatTime(noon, options)).toBe('13:00');
        expect(constructor).toHaveBeenCalledTimes(1);

        systemZone = 'Asia/Tokyo';
        expect(i18n.formatTime(noon, options)).toBe('21:00');
        expect(i18n.formatDateTime(noon, { dateStyle: 'short', timeStyle: 'short' })).toBe(
          '01/07/2026, 21:00'
        );
        // Phoenix and Denver are both seven hours behind UTC in winter, but only Denver moves its
        // clocks in summer.
        systemZone = 'America/Denver';
        expect(i18n.formatTime(noon, options)).toBe('06:00');
        systemZone = 'America/Phoenix';
        expect(i18n.formatTime(noon, options)).toBe('05:00');
      } finally {
        constructor.mockRestore();
        offset.mockRestore();
        i18n.setLocaleBootstrap({ languageSetting: 'auto', requestedLocale: 'en' });
      }
    });
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
});
