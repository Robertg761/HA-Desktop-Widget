/**
 * @jest-environment jsdom
 */

/**
 * The shared formatter: one set of rules turns numbers, units, percentages, temperatures, dates,
 * durations and Home Assistant state words into text, in the language and region the user picked.
 * Tests check the structure of what Intl writes (a gap, a separator, the order of parts) rather
 * than pin whole strings, so they hold across the ICU data of the Node versions CI runs.
 */
const i18n = require('../../src/i18n.js');
const format = require('../../src/format.js');
const utils = require('../../src/utils.js');
const state = require('../../src/state.js');

const NBSP = ' ';
const NNBSP = ' ';
// A space that does not break: no-break or narrow no-break, never a plain one.
const FIXED_SPACE = `[${NBSP}${NNBSP}]`;

function useLocale(locale, extra = {}) {
  i18n.setLocaleBootstrap({
    languageSetting: locale,
    requestedLocale: locale,
    activeLocale: locale,
    messages: {},
    ...extra,
  });
}

function setClock(ui) {
  state.setConfig({ ...(state.CONFIG || {}), ui });
}

const entity = (entityId, entityState, attributes = {}) => ({
  entity_id: entityId,
  state: entityState,
  attributes,
});

beforeEach(() => {
  state.setConfig({ ui: {} });
  state.setUnitSystem({ temperature: '°C' });
  useLocale('en');
});

afterEach(() => {
  i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
});

describe('the format locale', () => {
  const bootstrap = (overrides) =>
    i18n.setLocaleBootstrap({
      languageSetting: 'auto',
      detectedLocale: 'en-US',
      systemLocale: '',
      requestedLocale: 'en-US',
      activeLocale: 'en',
      usingEnglishFallback: false,
      messages: {},
      ...overrides,
    });

  it.each([
    // Auto: the computer's region, under whichever catalog the language maps to.
    ['en-GB', { detectedLocale: 'en-GB', requestedLocale: 'en-GB' }, 'en-GB'],
    ['es-MX', { detectedLocale: 'es-MX', requestedLocale: 'es-MX', activeLocale: 'es' }, 'es-MX'],
    ['de-CH', { detectedLocale: 'de-CH', requestedLocale: 'de-CH', activeLocale: 'de' }, 'de-CH'],
    // The system region wins when it is the same language as the display language.
    ['en-AU', { systemLocale: 'en-AU' }, 'en-AU'],
    // A different language in the system region does not mix into this language's text.
    [
      'de',
      { detectedLocale: 'de', requestedLocale: 'de', activeLocale: 'de', systemLocale: 'en-GB' },
      'de',
    ],
    // No pack for the computer's language: English text, the computer's own number and date format.
    [
      'pt-BR',
      {
        detectedLocale: 'pt-BR',
        requestedLocale: 'pt-BR',
        activeLocale: 'en',
        usingEnglishFallback: true,
      },
      'pt-BR',
    ],
    // What the main process sends for a pt-BR then en-US system (system-language-detection.test.js).
    [
      'pt-BR with English second',
      {
        detectedLocale: 'pt-BR',
        systemLocale: 'pt-BR',
        requestedLocale: 'pt-BR',
        activeLocale: 'en',
        usingEnglishFallback: true,
      },
      'pt-BR',
    ],
  ])('follows the region for an automatic language: %s', (_name, overrides, expected) => {
    bootstrap(overrides);
    expect(i18n.getFormatLocale()).toBe(expected);
  });

  it('keeps the language the user picked, with a region only when it is the same language', () => {
    // A chosen language without a region takes the computer's region when the language matches.
    bootstrap({
      languageSetting: 'de',
      requestedLocale: 'de',
      activeLocale: 'de',
      detectedLocale: 'en-US',
      systemLocale: 'de-AT',
    });
    expect(i18n.getFormatLocale()).toBe('de-AT');
    // A region the user chose themselves beats the computer's.
    bootstrap({
      languageSetting: 'es-MX',
      requestedLocale: 'es-MX',
      activeLocale: 'es',
      systemLocale: 'es-ES',
    });
    expect(i18n.getFormatLocale()).toBe('es-MX');
    // A chosen language with no pack is shown in English, and formats like it.
    bootstrap({
      languageSetting: 'fr',
      requestedLocale: 'fr',
      activeLocale: 'en',
      usingEnglishFallback: true,
      detectedLocale: 'pt-BR',
      systemLocale: 'pt-BR',
    });
    expect(i18n.getFormatLocale()).toBe('en');
  });

  it('never hands Intl a malformed tag', () => {
    bootstrap({
      detectedLocale: 'not a locale',
      requestedLocale: 'not a locale',
      activeLocale: 'en',
    });
    expect(i18n.getFormatLocale()).toBe('en');
    expect(() => i18n.formatDate(new Date(2026, 8, 30))).not.toThrow();
  });

  it('writes dates, times and numbers in the region, not only the language', () => {
    const date = new Date(2026, 8, 30, 15, 5);
    bootstrap({ detectedLocale: 'en-GB', requestedLocale: 'en-GB' });
    expect(i18n.formatDate(date, { year: 'numeric', month: 'numeric', day: 'numeric' })).toBe(
      '30/09/2026'
    );
    expect(i18n.formatTime(date, { hour: 'numeric', minute: '2-digit' })).toBe('15:05');
    bootstrap({ detectedLocale: 'en-US', requestedLocale: 'en-US' });
    expect(i18n.formatDate(date, { year: 'numeric', month: 'numeric', day: 'numeric' })).toBe(
      '9/30/2026'
    );
    expect(i18n.formatNumber(1234.5)).toBe('1,234.5');
    bootstrap({
      detectedLocale: 'pt-BR',
      requestedLocale: 'pt-BR',
      usingEnglishFallback: true,
    });
    expect(i18n.formatNumber(1234.5)).toBe('1.234,5');
  });
});

describe('the Time format and Date format settings', () => {
  const morning = new Date(2026, 8, 30, 7, 31);
  const evening = new Date(2026, 8, 30, 19, 31);

  it('writes a 12-hour clock without a leading zero and a 24-hour clock with one', () => {
    setClock({ timeFormat: '12-hour' });
    const twelve = format.formatClockTime(morning, format.getClockFaceTimeOptions());
    expect(twelve).toMatch(/^7:31/);
    expect(twelve).toMatch(/AM/i);
    setClock({ timeFormat: '24-hour' });
    expect(format.formatClockTime(morning, format.getClockFaceTimeOptions())).toBe('07:31');
    expect(format.formatClockTime(evening)).toBe('19:31');
    // Every time label follows the same rule as the large clock, so 7:31 is not "7:31" in one place
    // and "07:31" in another.
    expect(format.formatClockTime(morning)).toBe('07:31');
    expect(format.formatDayAndTime(morning, morning.getTime())).toBe('Today 07:31');
    setClock({ timeFormat: '12-hour' });
    expect(format.formatClockTime(morning)).toMatch(/^7:31/);
    expect(format.formatDayAndTime(morning, morning.getTime())).toMatch(/^Today 7:31/);
  });

  it('follows the language when the setting is the default, in 12 and 24 hours', () => {
    setClock({ timeFormat: 'system' });
    expect(format.formatClockTime(evening)).toMatch(/7:31/);
    useLocale('de');
    expect(format.formatClockTime(evening)).toBe('19:31');
    // An explicit setting beats the language: a 12-hour German clock, a 24-hour English one.
    setClock({ timeFormat: '12-hour' });
    expect(format.formatClockTime(evening)).toMatch(/^7:31/);
    useLocale('en');
    setClock({ timeFormat: '24-hour' });
    expect(format.formatClockTime(evening)).toBe('19:31');
  });

  it('keeps the old use24HourClock flag working', () => {
    setClock({ use24HourClock: true });
    expect(format.formatClockTime(evening)).toBe('19:31');
  });

  it('carries the setting into dates with a time', () => {
    setClock({ timeFormat: '24-hour' });
    expect(
      format.formatClockDateTime(evening, { dateStyle: 'medium', timeStyle: 'short' })
    ).toMatch(/19:31/);
    setClock({ timeFormat: '12-hour' });
    expect(format.formatClockDateTime(evening)).toMatch(/7:31/);
  });

  it('offers three date styles, and reads a saved "system" as numeric', () => {
    const date = new Date(2026, 8, 30);
    const render = () => i18n.formatDate(date, format.getClockDateOptions());
    setClock({ dateFormat: 'weekday-short' });
    expect(render()).toMatch(/Wed/);
    setClock({ dateFormat: 'long' });
    expect(render()).toMatch(/Wednesday, September 30, 2026/);
    setClock({ dateFormat: 'numeric' });
    expect(render()).toBe('9/30/2026');
    setClock({ dateFormat: 'system' });
    expect(format.getClockDateOptions()).toEqual({
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    expect(render()).toBe('9/30/2026');
    useLocale('de');
    setClock({ dateFormat: 'long' });
    expect(render()).toMatch(/Mittwoch, 30\. September 2026/);
  });
});

describe.each(['en', 'de', 'fr', 'ar', 'hi', 'zh'])('written in %s', (locale) => {
  const evening = new Date(2026, 9, 4, 19, 31);
  const intlTime = (hour12) =>
    new Date(evening).toLocaleTimeString(locale, {
      hour: hour12 ? 'numeric' : '2-digit',
      minute: '2-digit',
      hour12,
    });

  beforeEach(() => useLocale(locale));

  it.each([
    ['metric', '°C'],
    ['imperial', '°F'],
  ])('keeps the %s temperature unit as Home Assistant sends it', (_system, unit) => {
    state.setUnitSystem({ temperature: unit });
    const climate = entity('climate.hall', 'heat', { current_temperature: 21.5 });
    const text = utils.getEntityDisplayState(climate);
    expect(text).toContain(unit);
    // The number comes first and the unit follows, with no breaking space between them.
    expect(text.indexOf(unit)).toBeGreaterThan(0);
    expect(text).not.toMatch(/ °/);
    expect(format.formatMeasurement(70.5, unit)).toContain(unit);
  });

  it('follows the Time format setting in both directions', () => {
    setClock({ timeFormat: '12-hour' });
    expect(format.formatClockTime(evening)).toBe(intlTime(true));
    setClock({ timeFormat: '24-hour' });
    expect(format.formatClockTime(evening)).toBe(intlTime(false));
  });

  it('offers three different date styles', () => {
    const writes = ['weekday-short', 'long', 'numeric'].map((dateFormat) => {
      setClock({ dateFormat });
      return i18n.formatDate(evening, format.getClockDateOptions());
    });
    expect(new Set(writes).size).toBe(3);
    // The long form names the month, the numeric one does not.
    expect(writes[2]).toMatch(/\p{Nd}/u);
  });

  it("writes a percentage and a number with the language's separators", () => {
    const expected = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(1234.5);
    expect(format.formatPercent(1234.5)).toContain(expected);
    expect(format.formatMeasurement(1234.5, 'W')).toContain(
      new Intl.NumberFormat(locale).format(1234.5)
    );
  });
});

describe('units and percentages', () => {
  it('writes percent and degree units the way the language does', () => {
    useLocale('en');
    expect(format.formatPercent(80)).toBe('80%');
    expect(format.formatMeasurement(21.4, '°C')).toBe('21.4°C');
    expect(format.formatMeasurement(70.5, '°F')).toBe('70.5°F');
    expect(format.formatMeasurement(21, '°')).toBe('21°');

    useLocale('de');
    expect(format.formatPercent(80)).toMatch(new RegExp(`^80${FIXED_SPACE}%$`));
    expect(format.formatMeasurement(21.4, '°C')).toMatch(new RegExp(`^21,4${FIXED_SPACE}°C$`));
    // A bare degree sign is never spaced.
    expect(format.formatMeasurement(21.4, '°')).toBe('21,4°');

    useLocale('fr');
    expect(format.formatPercent(80)).toMatch(new RegExp(`^80${FIXED_SPACE}%$`));
    expect(format.formatMeasurement(21.4, '°C')).toMatch(new RegExp(`^21,4${FIXED_SPACE}°C$`));

    useLocale('zh');
    expect(format.formatPercent(80)).toBe('80%');
    expect(format.formatMeasurement(21.4, '°C')).toBe('21.4°C');

    useLocale('hi');
    expect(format.formatPercent(80)).toBe('80%');
  });

  it("writes a light's colour temperature as whole kelvin with a fixed gap", () => {
    useLocale('en');
    expect(format.formatKelvin(3200)).toBe(`3,200${NBSP}K`);
    expect(format.formatKelvin(2700.4)).toBe(`2,700${NBSP}K`);

    useLocale('de');
    expect(format.formatKelvin(3200)).toMatch(new RegExp(`^3\\.200${FIXED_SPACE}K$`));

    useLocale('ar');
    const digits = new Intl.NumberFormat('ar', { maximumFractionDigits: 0 }).format(3200);
    expect(format.formatKelvin(3200)).toBe(`${digits}${NBSP}K`);
  });

  it('puts the percent sign first where the language writes it so', () => {
    // No pack for the computer's language: English text in Turkish number formats ("%50").
    useLocale('en', {
      languageSetting: 'auto',
      detectedLocale: 'tr-TR',
      systemLocale: 'tr-TR',
      requestedLocale: 'tr-TR',
      usingEnglishFallback: true,
    });
    expect(i18n.getFormatLocale()).toBe('tr-TR');
    const own = (value) =>
      new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 1 }).format(value);
    expect(format.formatPercent(50)).toBe(own(0.5));
    expect(format.formatPercent(50)).toMatch(/^%\s?50$/);
    expect(format.formatPercent(-5)).toBe(own(-0.05));
    expect(format.formatPercent(12.5)).toBe(own(0.125));
    // Other units still follow the number.
    expect(format.formatMeasurement(21.4, '°C')).toMatch(/^21,4\s?°C$/);
    expect(format.formatMeasurement(5, 'W')).toBe(`5${NBSP}W`);
  });

  it('cases English state words the English way on a Turkish computer', () => {
    // Numbers follow the region (above), but the words are English: the Turkish capital of "i" is
    // the dotted "İ", which made "İdle mode" of "idle_mode" and "İntensive" of a climate preset.
    useLocale('en', {
      languageSetting: 'auto',
      detectedLocale: 'tr-TR',
      systemLocale: 'tr-TR',
      requestedLocale: 'tr-TR',
      usingEnglishFallback: true,
    });
    expect(i18n.getFormatLocale()).toBe('tr-TR');
    expect(format.humanizeState('idle_mode')).toBe('Idle mode');
    expect(format.formatStateName('ironing')).toBe('Ironing');
    expect(format.titleCase('intensive eco')).toBe('Intensive Eco');
    // A state written with a capital "I" is not lower case, whichever way "I" is lowered.
    expect(format.humanizeState('IDLE')).toBe('IDLE');
  });

  it('keeps the unit next to the number in a right-to-left language', () => {
    useLocale('ar');
    const text = format.formatMeasurement(21.4, '°C');
    // The number, then the unit as Home Assistant spells it, with nothing but a space between.
    expect(text).toMatch(/^[\d٠-٩.,٫]+\s?°C$/);
    expect(format.formatPercent(80)).toMatch(/^[\d٠-٩]+%$/);
  });

  it('puts a no-break space before every other unit, so a unit never wraps alone', () => {
    useLocale('en');
    expect(format.formatMeasurement(1234.5, 'kWh')).toBe(`1,234.5${NBSP}kWh`);
    expect(format.formatMeasurement(0.31, 'EUR/kWh')).toBe(`0.31${NBSP}EUR/kWh`);
    useLocale('de');
    expect(format.formatMeasurement(1234.5, 'W')).toBe(`1.234,5${NBSP}W`);
    // No unit: the number alone.
    expect(format.formatMeasurement(5, '')).toBe('5');
    expect(format.formatMeasurement(5, undefined)).toBe('5');
  });

  it('formats a temperature in the unit Home Assistant uses, Celsius or Fahrenheit', () => {
    state.setUnitSystem({ temperature: '°F' });
    const climate = entity('climate.hall', 'heat', { current_temperature: 70.52, temperature: 72 });
    expect(utils.getEntityDisplayState(climate)).toBe('70.52°F');
    state.setUnitSystem({ temperature: '°C' });
    expect(utils.getEntityDisplayState(climate)).toBe('70.52°C');
    // The entity's own unit beats the installation's.
    expect(
      utils.getEntityDisplayState({
        ...climate,
        attributes: { ...climate.attributes, temperature_unit: '°F' },
      })
    ).toBe('70.52°F');
    expect(format.formatTemperature(null, '°C')).toBe('--');
  });
});

describe('sensor readings', () => {
  const sensor = (value, attributes = {}) =>
    entity('sensor.reading', String(value), { unit_of_measurement: 'W', ...attributes });
  const text = (value, attributes) => format.getSensorReading(sensor(value, attributes))?.text;

  it('rounds like the tile: one decimal for temperatures, two for everything else', () => {
    expect(text('21.456', { unit_of_measurement: '°C' })).toBe('21.5°C');
    expect(text('55.55', { unit_of_measurement: '%' })).toBe('55.6%');
    expect(text('1234.5678')).toBe(`1,234.57${NBSP}W`);
    expect(text('7')).toBe(`7${NBSP}W`);
    expect(text('0.7160215353965759')).toBe(`0.72${NBSP}W`);
  });

  it('uses the precision the integration suggests', () => {
    expect(text('21', { unit_of_measurement: '°C', suggested_display_precision: 1 })).toBe(
      '21.0°C'
    );
    expect(text('1234.5678', { suggested_display_precision: 0 })).toBe(`1,235${NBSP}W`);
  });

  it('rounds to a suggested precision even when the reading is small', () => {
    // Home Assistant shows these as 0, so the tile does too; only the built-in defaults keep two
    // significant digits to avoid hiding a small reading.
    expect(text('-0.04', { unit_of_measurement: '°C', suggested_display_precision: 0 })).toBe(
      '0°C'
    );
    expect(text('0.3', { suggested_display_precision: 0 })).toBe(`0${NBSP}W`);
    expect(text('0.0045', { suggested_display_precision: 2 })).toBe(`0.00${NBSP}W`);
    expect(text('0.3', { unit_of_measurement: '°C' })).toBe('0.3°C');
  });

  it('never writes "-0", and keeps a value that is small but not zero', () => {
    expect(text('-0.04', { unit_of_measurement: '°C' })).toBe('-0.04°C');
    expect(text('0.0045', { unit_of_measurement: 'EUR/kWh' })).toBe(`0.0045${NBSP}EUR/kWh`);
    expect(text('0', { unit_of_measurement: '°C' })).toBe('0°C');
    expect(text('-0.0', { unit_of_measurement: '°C' })).toBe('0°C');
    expect(format.formatReadingNumber(-0.04, { maximum: 1 })).toBe('-0.04');
    expect(format.formatReadingNumber(-0.4, { maximum: 0 })).toBe('-0.4');
  });

  it('leaves codes, hex and exponent forms as text', () => {
    expect(format.getSensorReading(sensor('02134', {}))).toBeNull();
    expect(format.getSensorReading(sensor('1e3'))).toBeNull();
    expect(format.getSensorReading(sensor('0x10'))).toBeNull();
    expect(format.getSensorReading(sensor('on'))).toBeNull();
    expect(format.getSensorReading(sensor('2026-09-30'))).toBeNull();
    expect(format.parseNumericState('-0.5')).toBe(-0.5);
    expect(format.parseNumericState(' 12 ')).toBe(12);
    expect(format.parseNumericState('1,5')).toBeNull();
    expect(format.parseNumericState(null)).toBeNull();
  });

  it('keeps the decimals of a bare number, which may be a version, and never groups it', () => {
    expect(format.getSensorReading(sensor('3.10', { unit_of_measurement: undefined }))?.text).toBe(
      '3.10'
    );
    expect(format.getSensorReading(sensor('2026', { unit_of_measurement: undefined }))?.text).toBe(
      '2026'
    );
    // A measurement with a state class and no unit does group.
    expect(
      format.getSensorReading(
        sensor('12345', { unit_of_measurement: undefined, state_class: 'total' })
      )?.text
    ).toBe('12,345');
  });

  it('splits the value from the unit for tiles that style them apart', () => {
    useLocale('de');
    expect(format.getSensorReading(sensor('1234.5', { unit_of_measurement: '°C' }))).toEqual({
      value: '1.234,5',
      unit: '°C',
      text: expect.stringMatching(new RegExp(`^1\\.234,5${FIXED_SPACE}°C$`)),
    });
  });

  it('shows the same text on the tile, the pin and the palette', () => {
    useLocale('de');
    const power = sensor('123456.789');
    expect(utils.getEntityDisplayState(power)).toBe(format.getSensorReading(power).text);
    expect(utils.getEntityDisplayState(power)).toBe(`123.456,79${NBSP}W`);
  });

  it('writes a duration sensor as units, not a raw count of seconds', () => {
    const uptime = (value, unit = 's') =>
      utils.getEntityDisplayState(
        entity('sensor.uptime', String(value), {
          device_class: 'duration',
          unit_of_measurement: unit,
        })
      );
    expect(uptime(4500)).toMatch(/^1\D+15\D+$/);
    // The tile's readout is the same text, with no separate unit.
    expect(
      format.getSensorReading(
        entity('sensor.uptime', '4500', { device_class: 'duration', unit_of_measurement: 's' })
      )
    ).toEqual({ value: uptime(4500), unit: '', text: uptime(4500) });
    expect(uptime(90, 'min')).toMatch(/^1\D+30\D+$/);
    expect(uptime(2, 'd')).toMatch(/^2\D+$/);
    // A few seconds stays a plain number.
    expect(uptime(1.5)).toBe(`1.5${NBSP}s`);
    expect(format.formatDurationReading(10, 'furlong')).toBeNull();
  });

  it('joins the units of a duration with a space, never the "and" Arabic and Urdu write', () => {
    for (const locale of ['ar', 'ur']) {
      useLocale(locale);
      const unit = (amount, name) =>
        new Intl.NumberFormat(locale, { style: 'unit', unit: name, unitDisplay: 'short' }).format(
          amount
        );
      expect(format.formatDurationReading(4500, 's')).toBe(
        `${unit(1, 'hour')} ${unit(15, 'minute')}`
      );
      expect(format.formatDurationReading(-4500, 's')).toBe(
        `-${unit(1, 'hour')} ${unit(15, 'minute')}`
      );
    }
  });
});

describe('state words', () => {
  it('reads a binary sensor by its device class', () => {
    const word = (deviceClass, value) =>
      utils.getEntityDisplayState(entity('binary_sensor.x', value, { device_class: deviceClass }));
    expect(word('door', 'on')).toBe('Open');
    expect(word('door', 'off')).toBe('Closed');
    expect(word('window', 'on')).toBe('Open');
    expect(word('garage_door', 'off')).toBe('Closed');
    expect(word('moisture', 'on')).toBe('Wet');
    expect(word('moisture', 'off')).toBe('Dry');
    expect(word('lock', 'on')).toBe('Unlocked');
    expect(word('lock', 'off')).toBe('Locked');
    expect(word('connectivity', 'on')).toBe('Connected');
    // An offline router must not read "Clear", a flat battery must not read "Detected".
    expect(word('connectivity', 'off')).toBe('Disconnected');
    expect(word('battery', 'on')).toBe('Low');
    expect(word('battery', 'off')).toBe('OK');
    expect(word('plug', 'on')).toBe('Plugged in');
    expect(word('plug', 'off')).toBe('Unplugged');
    expect(word('presence', 'on')).toBe('Home');
    expect(word('presence', 'off')).toBe('Away');
    expect(word('problem', 'on')).toBe('Problem');
    expect(word('smoke', 'on')).toBe('Smoke');
    expect(word('motion', 'off')).toBe('Clear');
    // No device class, or one without wording: the generic pair.
    expect(word(undefined, 'on')).toBe('Detected');
    expect(word(undefined, 'off')).toBe('Clear');
    expect(word('something_new', 'on')).toBe('Detected');
    expect(word('door', 'unavailable')).toBe('Unavailable');
    expect(word('door', 'unknown')).toBe('Unknown');
  });

  it('translates device class words through the catalog', () => {
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: { Open: 'Offen', Closed: 'Geschlossen', Disconnected: 'Getrennt' },
    });
    const word = (deviceClass, value) =>
      utils.getEntityDisplayState(entity('binary_sensor.x', value, { device_class: deviceClass }));
    expect(word('door', 'on')).toBe('Offen');
    expect(word('door', 'off')).toBe('Geschlossen');
    expect(word('connectivity', 'off')).toBe('Getrennt');
  });

  it('has a name for the common states that used to show up as raw text', () => {
    const word = (id, value) => utils.getEntityDisplayState(entity(id, value));
    expect(word('sun.sun', 'above_horizon')).toBe('Above horizon');
    expect(word('sun.sun', 'below_horizon')).toBe('Below horizon');
    expect(word('alarm_control_panel.home', 'disarming')).toBe('Disarming');
    expect(word('camera.porch', 'streaming')).toBe('Streaming');
    expect(word('camera.porch', 'recording')).toBe('Recording');
    expect(word('alarm_control_panel.home', 'triggered')).toBe('Alarm');
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: { 'Above horizon': 'Über dem Horizont', Streaming: 'Überträgt' },
    });
    expect(word('sun.sun', 'above_horizon')).toBe('Über dem Horizont');
    expect(word('camera.porch', 'streaming')).toBe('Überträgt');
  });

  it('humanises a state it has no name for, and keeps free text as written', () => {
    const word = (id, value, attributes) =>
      utils.getEntityDisplayState(entity(id, value, attributes));
    // Unmapped enum states lose their underscores.
    expect(word('water_heater.tank', 'heat_pump')).toBe('Heat pump');
    expect(word('vacuum.robot', 'mopping')).toBe('Mopping');
    // The user's own words are never re-cased or relabelled.
    expect(word('select.mode', 'heat')).toBe('heat');
    expect(word('input_select.mode', 'cool')).toBe('cool');
    expect(word('input_select.phone', 'iPhone')).toBe('iPhone');
    expect(word('input_text.note', 'auto')).toBe('auto');
    expect(word('text.label', 'some_value')).toBe('some_value');
    expect(word('device_tracker.phone', 'iPhone')).toBe('iPhone');
    // Enum sensors read in words; other text sensors are shown as sent.
    expect(word('sensor.dishwasher', 'cycle_finished', { device_class: 'enum' })).toBe(
      'Cycle finished'
    );
    expect(word('sensor.note', 'Cycle finished')).toBe('Cycle finished');
    expect(format.humanizeState('Work')).toBe('Work');
    expect(format.humanizeState('éco')).toBe('Éco');
    expect(format.titleCase('éco boost')).toBe('Éco Boost');
    expect(format.formatStateName('')).toBe('Unknown');
    expect(format.formatStateName(null)).toBe('Unknown');
  });

  it('never calls an unavailable or unknown entity by a measurement', () => {
    expect(
      utils.getEntityDisplayState(entity('sensor.t', 'unavailable', { unit_of_measurement: '°C' }))
    ).toBe('Unavailable');
    expect(
      utils.getEntityDisplayState(entity('climate.c', 'unknown', { current_temperature: 21 }))
    ).toBe('Unknown');
    expect(
      utils.getEntityDisplayState(entity('number.n', 'unavailable', { unit_of_measurement: '%' }))
    ).toBe('Unavailable');
  });

  it('does not call a button or scene that was never used "Unknown"', () => {
    expect(utils.getEntityDisplayState(entity('button.restart', 'unknown'))).toBe('Ready');
    expect(utils.getEntityDisplayState(entity('input_button.go', 'unknown'))).toBe('Ready');
    expect(utils.getEntityDisplayState(entity('scene.movie', 'unknown'))).toBe('Ready');
    expect(utils.getEntityDisplayState(entity('button.restart', '2026-09-30T08:00:00+00:00'))).toBe(
      'Ready'
    );
    expect(utils.getEntityDisplayState(entity('scene.movie', 'unavailable'))).toBe('Unavailable');
    expect(utils.getEntityDisplayState(entity('sensor.x', 'unknown'))).toBe('Unknown');
  });
});

describe('number helpers', () => {
  it('formats number, input_number and counter entities with their step and unit', () => {
    const word = (id, value, attributes) =>
      utils.getEntityDisplayState(entity(id, value, attributes));
    expect(word('number.boost', '40.0', { unit_of_measurement: '%', step: 1 })).toBe('40%');
    expect(word('input_number.offset', '1.5', { unit_of_measurement: '°C', step: 0.5 })).toBe(
      '1.5°C'
    );
    expect(
      word('input_number.setpoint', '21.500000', { unit_of_measurement: '°C', step: 0.5 })
    ).toBe('21.5°C');
    expect(word('input_number.price', '0.2', { step: 0.01 })).toBe('0.20');
    expect(word('counter.visits', '1234', { step: 1 })).toBe('1,234');
    // No step: up to three decimals, no padding.
    expect(word('number.level', '12.3456')).toBe('12.346');
    // Text stays as sent.
    expect(word('input_number.odd', 'broken')).toBe('Broken');
    useLocale('de');
    expect(word('input_number.offset', '1.5', { unit_of_measurement: '°C', step: 0.5 })).toMatch(
      new RegExp(`^1,5${FIXED_SPACE}°C$`)
    );
  });

  it('takes the decimals from the fractional part of the step, whatever its size', () => {
    const shown = (value, step) =>
      format.formatNumberEntityValue(value, entity('number.x', String(value), { step }));
    // A step above one with a fraction keeps it: 7.5 is not 8.
    expect(shown(7.5, 2.5)).toBe('7.5');
    expect(shown(12.5, 2.5)).toBe('12.5');
    expect(shown(7.25, 1.25)).toBe('7.25');
    // The decimals are padded to the step's, as they are for 0.5.
    expect(shown(1005, 10.5)).toBe('1,005.0');
    expect(shown(1005.5, 10.5)).toBe('1,005.5');
    // A whole step has none, as before.
    expect(shown(40, 1)).toBe('40');
    expect(shown(50, 10)).toBe('50');
    expect(shown(0.5, 0.5)).toBe('0.5');
    expect(shown(0.2, 0.01)).toBe('0.20');
    // Floating-point noise in the step is not a decimal place.
    expect(shown(0.6, 0.1 + 0.2)).toBe('0.6');
    expect(shown(2.5, 2.5000000000000004)).toBe('2.5');
    expect(shown(21.5, 0.1 * 3)).toBe('21.5');
    // Exponent notation reads the same as the plain number, capped at three places.
    expect(shown(0.5, 5e-1)).toBe('0.5');
    expect(shown(0.0015, 1.5e-3)).toBe('0.002');
    expect(shown(0.5, 1e-7)).toBe('0.500');
    expect(shown(4, 1e21)).toBe('4');
    // A step given as text works, one that is not a positive number falls back to up to three.
    expect(shown(7.5, '2.5')).toBe('7.5');
    expect(shown(12.3456, 0)).toBe('12.346');
    expect(shown(12.3456, -2.5)).toBe('12.346');
    expect(shown(12.3456, 'abc')).toBe('12.346');
    expect(shown(12.3456, undefined)).toBe('12.346');
    // A step the caller passes wins over the entity's.
    expect(
      format.formatNumberEntityValue(7.5, entity('number.x', '7.5', { step: 1 }), { step: 2.5 })
    ).toBe('7.5');
  });

  it('shows a thermostat reading of 0 and ignores one that is unknown', () => {
    const word = (value, attributes) =>
      utils.getEntityDisplayState(entity('climate.c', value, attributes));
    expect(word('heat', { current_temperature: 0, temperature: 21 })).toBe('0°C');
    expect(word('heat', { current_temperature: null, temperature: 0 })).toBe('0°C');
    expect(word('heat', { current_temperature: '', temperature: 21 })).toBe('21°C');
    // With no reading the tile names the mode, as Home Assistant does: 'Heat', not 'Heating',
    // which an idle thermostat in heat mode is not doing.
    expect(word('heat', { current_temperature: null, temperature: null })).toBe('Heat');
    expect(word('unknown', { current_temperature: 21 })).toBe('Unknown');
    expect(word('heat', { current_temperature: -5 })).toBe('-5°C');
    expect(
      format.getClimateTemperature(entity('climate.c', 'heat', { current_temperature: true }))
    ).toBeNull();
  });
});

describe('dates, times and relative times', () => {
  const now = new Date(2026, 8, 30, 15, 0).getTime();

  it('writes a moment as the day and time, or how far away it is', () => {
    const at = (offsetMs) => new Date(now + offsetMs);
    const hour = 3600 * 1000;
    expect(format.formatDayAndTime(at(2 * hour), now)).toMatch(/^Today 5:00/);
    expect(format.formatDayAndTime(at(-hour * 7), now)).toMatch(/^Today 8:00/);
    expect(format.formatDayAndTime(at(24 * hour), now)).toMatch(/^Tomorrow 3:00/);
    expect(format.formatDayAndTime(at(-24 * hour), now)).toMatch(/^Yesterday 3:00/);
    expect(format.formatDayAndTime(at(3 * 24 * hour), now)).toMatch(/^Sat/);
    expect(format.formatDayAndTime(at(20 * 24 * hour), now)).toMatch(/^Oct 20/);
    expect(format.formatDayAndTime(at(-10 * 24 * hour), now)).toMatch(/^Sep 20/);
    // Another year says so.
    expect(format.formatDayAndTime(new Date(2027, 0, 5, 9, 0), now)).toMatch(/2027/);
  });

  it('counts calendar days for a moment ahead, not blocks of 24 hours', () => {
    // 11 p.m. on Oct 4: 35 hours later is the day after tomorrow, not tomorrow.
    const lateNow = new Date(2026, 9, 4, 23, 0).getTime();
    expect(format.formatDayAndTime(new Date(lateNow + 35 * 3600 * 1000), lateNow)).toMatch(
      /^Tue 10:00/
    );
    expect(format.formatDayAndTime(new Date(2026, 9, 5, 8, 0), lateNow)).toMatch(/^Tomorrow 8:00/);
    expect(format.formatDayAndTime(new Date(2026, 9, 8, 10, 0), lateNow)).toMatch(/^Thu 10:00/);
    // The same through a date entity's state: a day and a time, capitalised, never a bare "tomorrow".
    const state = (raw) => format.formatDateState(raw, { now: lateNow });
    expect(state('2026-10-05 08:00:00')).toMatch(/^Tomorrow 8:00/);
    expect(state('2026-10-06T10:00:00')).toMatch(/^Tue 10:00/);
    expect(state('2026-10-04 23:30:00')).toMatch(/^Today 11:30/);
    expect(state('2026-10-02T22:00:00')).toMatch(/^Oct 2, 10:00/);
  });

  it('counts calendar days in relative times, and keeps hours under a day', () => {
    const lateNow = new Date(2026, 9, 4, 23, 0).getTime();
    const relative = (locale, value, unit) =>
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(value, unit);
    const at = (...parts) => new Date(...parts).getTime();
    // 47.5 hours back at 11 p.m. is two calendar days back, which is not "yesterday".
    expect(format.formatRelativeTime(at(2026, 9, 2, 23, 30), { now: lateNow })).toBe(
      relative('en', -2, 'day')
    );
    expect(format.formatRelativeTime(at(2026, 9, 3, 22, 0), { now: lateNow })).toBe(
      relative('en', -1, 'day')
    );
    expect(format.formatRelativeTime(at(2026, 9, 3, 23, 30), { now: lateNow })).toBe(
      relative('en', -23, 'hour')
    );
    expect(format.formatRelativeTime(at(2026, 9, 1, 10, 0), { now: lateNow })).toBe(
      relative('en', -3, 'day')
    );
    // 35 hours ahead is the day after tomorrow, not "tomorrow".
    expect(format.formatRelativeTime(at(2026, 9, 6, 10, 0), { now: lateNow })).toBe(
      relative('en', 2, 'day')
    );
    // 23.6 hours ahead is hours, not "tomorrow", even when it crosses no midnight.
    const earlyNow = at(2026, 9, 4, 0, 10);
    expect(format.formatRelativeTime(at(2026, 9, 4, 23, 46), { now: earlyNow })).toBe(
      relative('en', 24, 'hour')
    );
  });

  it('labels a calendar day for a glance', () => {
    expect(format.formatDayLabel(new Date(2026, 8, 30), now)).toBe('Today');
    expect(format.formatDayLabel(new Date(2026, 9, 1), now)).toBe('Tomorrow');
    expect(format.formatDayLabel(new Date(2026, 9, 4), now)).toBe('Sun');
    expect(format.formatDayLabel(new Date(2026, 9, 20), now)).toBe('Oct 20');
    expect(format.formatNearbyDay(new Date(2026, 9, 20), now)).toBeNull();
    useLocale('de');
    expect(format.formatDayLabel(new Date(2026, 9, 1), now)).toBe('Morgen');
  });

  it('shows timestamp and date sensors as dates instead of ISO text', () => {
    const iso = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const lastBoot = utils.getEntityDisplayState(
      entity('sensor.last_boot', iso, { device_class: 'timestamp' })
    );
    expect(lastBoot).not.toMatch(/T\d{2}:/);
    expect(lastBoot).toMatch(/\d{1,2}:\d{2}/);
    const dawn = utils.getEntityDisplayState(
      entity('sensor.next_dawn', new Date(Date.now() + 5 * 3600 * 1000).toISOString(), {
        device_class: 'timestamp',
      })
    );
    // A day and a time, not a relative label that nothing would redraw.
    expect(dawn).toMatch(/\d{1,2}:\d{2}/);
    // A full date-time with no device class is still a date.
    expect(
      utils.getEntityDisplayState(entity('sensor.seen', '2020-09-20T08:12:44+00:00'))
    ).not.toMatch(/T08:12/);
    // A sensor of the date class is a day.
    expect(
      utils.getEntityDisplayState(entity('sensor.holiday', '2020-12-25', { device_class: 'date' }))
    ).toBe('Dec 25, 2020');
    // Text that is not a date stays as sent.
    expect(
      utils.getEntityDisplayState(entity('sensor.when', 'sometime', { device_class: 'timestamp' }))
    ).toBe('sometime');
  });

  it('shows date, time and datetime entities in the clock setting', () => {
    setClock({ timeFormat: '24-hour' });
    expect(utils.getEntityDisplayState(entity('time.alarm', '07:05:00'))).toBe('07:05');
    setClock({ timeFormat: '12-hour' });
    expect(utils.getEntityDisplayState(entity('time.alarm', '19:05:00'))).toMatch(/^7:05/);
    expect(
      utils.getEntityDisplayState(entity('input_datetime.when', '2020-03-01', { has_time: false }))
    ).toBe('Mar 1, 2020');
    expect(utils.getEntityDisplayState(entity('time.alarm', 'soon'))).toBe('soon');
  });

  it('writes relative times in the language, not from hand-made strings', () => {
    const ago = (locale, style, value, unit) =>
      new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style }).format(value, unit);
    const base = Date.parse('2026-09-30T12:00:00Z');
    expect(format.formatRelativeTime(base - 15 * 60000, { now: base })).toBe(
      ago('en', 'short', -15, 'minute')
    );
    expect(format.formatRelativeTime(base - 3 * 3600000, { now: base })).toBe(
      ago('en', 'short', -3, 'hour')
    );
    expect(format.formatRelativeTime(base - 2 * 86400000, { now: base })).toBe(
      ago('en', 'short', -2, 'day')
    );
    expect(format.formatRelativeTime(base + 14 * 3600000, { now: base })).toBe(
      ago('en', 'short', 14, 'hour')
    );
    expect(format.formatRelativeTime(base - 20000, { now: base })).toBe('just now');
    expect(format.formatRelativeTime('nonsense', { now: base })).toBe('');
    for (const locale of ['de', 'ar', 'hi', 'zh']) {
      useLocale(locale);
      expect(format.formatRelativeTime(base - 5 * 60000, { now: base })).toBe(
        ago(locale, 'short', -5, 'minute')
      );
    }
  });
});

describe('lists, search and sorting', () => {
  it('joins labels with the separator each language writes, without an "and"', () => {
    const items = ['Quick Access and layout', 'Appearance', 'Weather and media'];
    // Written out, not read back from Intl: Arabic's own list pattern has an "and" in every gap.
    const separators = { en: ', ', de: ', ', fr: ', ', es: ', ', hi: ', ', zh: '、', ar: '، ' };
    for (const [locale, separator] of Object.entries(separators)) {
      useLocale(locale);
      expect(format.formatList(items)).toBe(items.join(separator));
    }
    // Persian and Urdu use the Arabic comma too, and a Persian bidi mark is not part of the gap.
    for (const locale of ['fa-IR', 'ur-PK']) {
      // No pack for the computer's language: English text in the computer's own formats.
      useLocale('en', {
        languageSetting: 'auto',
        detectedLocale: locale,
        systemLocale: locale,
        requestedLocale: locale,
        usingEnglishFallback: true,
      });
      expect(i18n.getFormatLocale()).toBe(locale);
      expect(format.formatList(['A', 'B', 'C'])).toBe('A، B، C');
    }
    useLocale('ar');
    expect(format.formatList(['A', 'B', 'C'])).toBe('A، B، C');
    useLocale('en');
    expect(format.formatList(items)).toBe('Quick Access and layout, Appearance, Weather and media');
    useLocale('zh');
    expect(format.formatList(['A', 'B'])).toBe('A、B');
    expect(format.formatList(['A'])).toBe('A');
    expect(format.formatList([])).toBe('');
    expect(format.formatList(null)).toBe('');
  });

  it('keeps the letters of every script when it prepares text for a search', () => {
    expect(format.normalizeSearchText('Küche')).toBe('kuche');
    expect(format.normalizeSearchText('Ünder-Cabinet_Light')).toBe('under cabinet light');
    expect(format.normalizeSearchText("Anna's  Zimmer")).toBe('annas zimmer');
    expect(format.normalizeSearchText('客厅 灯')).toBe('客厅 灯');
    expect(format.normalizeSearchText('غرفة المعيشة')).toBe('غرفة المعيشة');
    expect(format.normalizeSearchText('لَمْبَة')).toBe('لمبة');
    expect(format.normalizeSearchText('लिविंग रूम')).toBe(format.normalizeSearchText('लिविंग रूम'));
    expect(format.normalizeSearchText('लिविंग रूम')).not.toBe('');
    expect(format.normalizeSearchText('ＡＢＣ')).toBe('abc');
    expect(format.normalizeSearchText('')).toBe('');
    expect(format.normalizeSearchText(null)).toBe('');
  });

  it('finds a Turkish word whichever way the dotted and dotless i are typed', () => {
    // Lower-casing without a locale gives "IŞIK" -> "isik" but "ışık" -> "ısık": every spelling
    // folds to the same text, in every interface language, so a Turkish name is not missed.
    for (const spelling of ['IŞIK', 'Işık', 'ışık', 'işik', 'isik', 'ISIK']) {
      expect(format.normalizeSearchText(spelling)).toBe('isik');
    }
    expect(format.normalizeSearchText('İstanbul')).toBe(format.normalizeSearchText('ISTANBUL'));
    expect(format.normalizeSearchText('Işık Lambası')).toBe('isik lambasi');
    expect(utils.getSearchScore('Yatak Odası IŞIK', 'ışık')).toBeGreaterThan(0);
    expect(utils.getSearchScore('ışık', 'IŞIK')).toBeGreaterThan(0);
    useLocale('tr');
    expect(utils.getSearchScore('IŞIK', 'ışık')).toBeGreaterThan(0);
  });

  it('folds accents and Arabic vowel marks but keeps the marks inside a Hindi word', () => {
    expect(format.foldSearchMarks('Cafe\u0301')).toBe('Cafe');
    expect(format.foldSearchMarks('لَمْبَة')).toBe('لمبة');
    // The vowel signs and the virama are part of the word.
    expect(format.foldSearchMarks('कुत्ता')).toBe('कुत्ता'.normalize('NFKD'));
    expect(format.foldSearchMarks('कुत्ता')).not.toBe('कतत');
    expect(format.normalizeSearchText('कुत्ता')).toBe('कुत्ता');
    expect(format.foldSearchMarks(null)).toBe('');
  });

  it('scores a Chinese, Arabic or Hindi query against matching names only', () => {
    expect(utils.getSearchScore('客厅灯', '客厅')).toBe(2);
    expect(utils.getSearchScore('主卧 客厅灯', '客厅')).toBe(1);
    expect(utils.getSearchScore('卧室灯', '客厅')).toBe(0);
    // A non-Latin query used to normalise to nothing and match every entity.
    expect(utils.getSearchScore('Living Room Light', '客厅')).toBe(0);
    expect(utils.getSearchScore('غرفة المعيشة', 'غرفة')).toBe(2);
    expect(utils.getSearchScore('Kitchen', 'غرفة')).toBe(0);
    expect(utils.getSearchScore('लिविंग रूम लाइट', 'रूम')).toBe(1);
    expect(utils.getSearchScore('Kitchen', 'रूम')).toBe(0);
    // Accents do not matter, in either direction.
    expect(utils.getSearchScore('Küche Licht', 'kuche')).toBe(2);
    expect(utils.getSearchScore('Kuche Licht', 'Küche')).toBe(2);
    expect(utils.getSearchScore('Café', 'cafe')).toBe(2);
    // A query of nothing but punctuation still matches what contains it.
    expect(utils.getSearchScore('Office +1', '+')).toBe(1);
    expect(utils.getSearchScore('Office', '+')).toBe(0);
    // An empty query matches everything, as before.
    expect(utils.getSearchScore('Anything', '')).toBe(2);
  });

  it('sorts names in the language, with numbers in natural order', () => {
    const sort = (names) => [...names].sort(format.compareNames);
    useLocale('en');
    expect(sort(['Room 10', 'Room 2', 'room 1'])).toEqual(['room 1', 'Room 2', 'Room 10']);
    useLocale('de');
    // "Ärger" sorts with the A names, not after Z as a code-point sort would put it.
    expect(sort(['Zimmer', 'Ärger', 'Bad', 'Apfel'])).toEqual(['Apfel', 'Ärger', 'Bad', 'Zimmer']);
    useLocale('sv', { activeLocale: 'sv' });
    // Swedish puts å after z.
    expect(sort(['Åsa', 'Zoe', 'Anna'])).toEqual(['Anna', 'Zoe', 'Åsa']);
    expect(format.compareNames('a', 'A')).toBe(0);
    expect(format.compareNames(null, 'a')).toBeLessThan(0);
  });
});

describe('durations', () => {
  it('writes a countdown as a clock', () => {
    expect(format.formatDuration(0)).toBe('0:00');
    expect(format.formatDuration(4000)).toBe('0:04');
    expect(format.formatDuration(4 * 60000 + 12000)).toBe('4:12');
    expect(format.formatDuration(3600000 + 5 * 60000)).toBe('1:05:00');
    expect(format.formatDuration(-5)).toBe('0:00');
    expect(format.formatDuration('x')).toBe('0:00');
  });

  it('reads the unpadded remaining time Home Assistant sends for a paused timer', () => {
    const paused = (remaining) =>
      utils.getEntityDisplayState(entity('timer.tea', 'paused', { remaining }));
    expect(paused('0:04:12')).toBe('Paused 4:12');
    expect(paused('0:32:00')).toBe('Paused 32:00');
    expect(paused('1:05:00')).toBe('Paused 1:05:00');
    expect(paused('0:00:04')).toBe('Paused 0:04');
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: { Paused: 'Pausiert' } });
    expect(paused('0:04:12')).toBe('Pausiert 4:12');
  });
});

describe('what counts as a countdown', () => {
  const sensor = (id, value, attributes = {}) => entity(id, value, attributes);

  it('treats a measurement as a measurement, whatever it is called', () => {
    const travel = sensor('sensor.commute', '23.4', {
      unit_of_measurement: 'min',
      duration: 1404,
    });
    expect(utils.isTimerLikeSensor(travel)).toBe(false);
    expect(utils.getEntityDisplayState(travel)).toBe(`23.4${NBSP}min`);
    const hours = sensor('sensor.washer_timer_hours', '2.5', { unit_of_measurement: 'h' });
    expect(utils.isTimerLikeSensor(hours)).toBe(false);
    expect(utils.getEntityDisplayState(hours)).toBe(`2.5${NBSP}h`);
    expect(utils.isTimerLikeSensor(sensor('sensor.number_only_timer', '42'))).toBe(false);
  });

  it('still counts down a kitchen timer', () => {
    const finishes = new Date(Date.now() + 90 * 1000).toISOString();
    const kitchen = sensor('sensor.kitchen_timer', finishes);
    expect(utils.isTimerLikeSensor(kitchen)).toBe(true);
    expect(utils.getEntityDisplayState(kitchen)).toMatch(/^1:\d{2}$/);
    expect(utils.isTimerLikeSensor(sensor('sensor.oven', 'on', { finishes_at: finishes }))).toBe(
      true
    );
    expect(
      utils.getEntityDisplayState(sensor('sensor.oven', 'on', { finishes_at: finishes }))
    ).toMatch(/^1:\d{2}$/);
  });

  it('counts any unitless, non-numeric sensor with "timer" in its id, on purpose', () => {
    // One loose rule for the tile, the pin, the icon, the palette and the tray, so a sensor reads
    // the same everywhere. A word match would leave "sensor.timer_mode" a countdown on one surface
    // and a plain text reading on another.
    expect(utils.isTimerLikeSensor(sensor('sensor.timer_mode', 'eco'))).toBe(true);
    expect(utils.isTimerLikeSensor(sensor('sensor.egg_timer_preset', 'soft'))).toBe(true);
    expect(utils.isTimerLikeSensor(sensor('sensor.EggTimerPreset', 'soft'))).toBe(true);
    // A unit or a number still makes it a reading.
    expect(
      utils.isTimerLikeSensor(sensor('sensor.timer_mode', 'eco', { unit_of_measurement: 'min' }))
    ).toBe(false);
    expect(utils.isTimerLikeSensor(sensor('sensor.timer_mode', '3'))).toBe(false);
    // It is a sensor rule: other domains keep their own.
    expect(utils.isTimerLikeSensor(entity('switch.timer_mode', 'on'))).toBe(false);
  });

  it('shows a timestamp sensor with no timer hint as a date, not a countdown', () => {
    const future = new Date(Date.now() + 14 * 3600 * 1000).toISOString();
    const dawn = sensor('sensor.next_dawn', future, { device_class: 'timestamp' });
    expect(utils.isTimerLikeSensor(dawn)).toBe(false);
    // 14 hours ahead is later today or tomorrow, written as a day and a time.
    expect(utils.getEntityDisplayState(dawn)).toMatch(/^(Today|Tomorrow) \d{1,2}:\d{2}/);
  });
});
