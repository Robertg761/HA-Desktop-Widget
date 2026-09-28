const {
  SEASONAL_HOLIDAYS,
  getEasterSunday,
  findActiveHoliday,
  findNextHoliday,
  getUpcomingHolidayRange,
  normalizeSeasonalSettings,
  isSeasonalEnabled,
  resolveSeasonalHoliday,
  dateFromDayNumber,
} = require('../../src/seasonal-calendar.js');

// Local calendar dates, as the widget sees them. Noon keeps them clear of any DST edge.
const day = (year, month, date) => new Date(year, month - 1, date, 12);
const ymd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
const activeId = (date, enabled) => findActiveHoliday(date, enabled)?.holiday.id ?? null;

describe('seasonal calendar', () => {
  test('computes Western Easter Sunday', () => {
    expect(ymd(dateFromDayNumber(getEasterSunday(2024)))).toBe('2024-03-31');
    expect(ymd(dateFromDayNumber(getEasterSunday(2025)))).toBe('2025-04-20');
    expect(ymd(dateFromDayNumber(getEasterSunday(2026)))).toBe('2026-04-05');
    expect(ymd(dateFromDayNumber(getEasterSunday(2027)))).toBe('2027-03-28');
    expect(ymd(dateFromDayNumber(getEasterSunday(2038)))).toBe('2038-04-25');
  });

  test('runs Halloween for all of October and Christmas through Boxing Day', () => {
    expect(activeId(day(2026, 9, 30))).toBeNull();
    expect(activeId(day(2026, 10, 1))).toBe('halloween');
    expect(activeId(day(2026, 10, 31))).toBe('halloween');
    expect(activeId(day(2026, 11, 1))).toBeNull();
    expect(activeId(day(2026, 12, 1))).toBe('christmas');
    expect(activeId(day(2026, 12, 26))).toBe('christmas');
  });

  test('carries New Year across the turn of the year', () => {
    expect(activeId(day(2026, 12, 27))).toBe('new-year');
    expect(activeId(day(2027, 1, 1))).toBe('new-year');
    expect(activeId(day(2027, 1, 2))).toBe('new-year');
    expect(activeId(day(2027, 1, 3))).toBeNull();
  });

  test('gives the smaller holidays the week leading up to them', () => {
    expect(activeId(day(2026, 2, 7))).toBeNull();
    expect(activeId(day(2026, 2, 8))).toBe('valentines');
    expect(activeId(day(2026, 3, 11))).toBe('st-patricks');
    expect(activeId(day(2026, 3, 18))).toBeNull();
    // Palm Sunday through Easter Monday.
    expect(activeId(day(2026, 3, 29))).toBe('easter');
    expect(activeId(day(2026, 4, 6))).toBe('easter');
    expect(activeId(day(2026, 4, 7))).toBeNull();
    // US Thanksgiving 2026 is Thursday 26 November; the theme runs through that weekend.
    expect(activeId(day(2026, 11, 20))).toBe('thanksgiving');
    expect(activeId(day(2026, 11, 29))).toBe('thanksgiving');
    expect(activeId(day(2026, 11, 30))).toBeNull();
  });

  test('picks the holiday whose day is nearer when two overlap', () => {
    // Lunar New Year 2026 is 17 February, so its window opens on Valentine's Day itself.
    expect(activeId(day(2026, 2, 14))).toBe('valentines');
    expect(activeId(day(2026, 2, 15))).toBe('lunar-new-year');
    // Easter 2008 fell on 23 March, so Palm Sunday came the day before St. Patrick's.
    expect(activeId(day(2008, 3, 16))).toBe('st-patricks');
    expect(activeId(day(2008, 3, 18))).toBe('easter');
  });

  test('skips holidays the user switched off', () => {
    expect(activeId(day(2026, 10, 10), ['christmas'])).toBeNull();
    expect(activeId(day(2026, 2, 14), ['lunar-new-year'])).toBe('lunar-new-year');
  });

  test('has no Lunar New Year outside the listed years', () => {
    const range = getUpcomingHolidayRange('lunar-new-year', day(2041, 1, 1));
    expect(range).toBeNull();
    expect(activeId(day(2045, 2, 17), ['lunar-new-year'])).toBeNull();
  });

  test('finds the next holiday to start', () => {
    const next = findNextHoliday(day(2026, 9, 28));
    expect(next.holiday.id).toBe('halloween');
    expect(ymd(next.start)).toBe('2026-10-01');
    expect(ymd(next.end)).toBe('2026-10-31');

    expect(ymd(findNextHoliday(day(2026, 9, 28), ['valentines']).start)).toBe('2027-02-08');
    expect(findNextHoliday(day(2026, 9, 28), [])).toBeNull();
  });

  test('reports the current or next run of a holiday for the settings list', () => {
    expect(ymd(getUpcomingHolidayRange('halloween', day(2026, 10, 12)).start)).toBe('2026-10-01');
    expect(ymd(getUpcomingHolidayRange('easter', day(2026, 9, 28)).start)).toBe('2027-03-21');
    expect(ymd(getUpcomingHolidayRange('new-year', day(2026, 9, 28)).end)).toBe('2027-01-02');
    expect(getUpcomingHolidayRange('unknown', day(2026, 9, 28))).toBeNull();
  });

  test('gives every holiday colours and a unique id', () => {
    const ids = SEASONAL_HOLIDAYS.map((holiday) => holiday.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const holiday of SEASONAL_HOLIDAYS) {
      expect(holiday.colors.accent).toMatch(/^#[0-9a-f]{6}$/);
      expect(holiday.colors.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('seasonal settings', () => {
  test('normalizes missing and malformed settings to the defaults', () => {
    expect(normalizeSeasonalSettings(undefined)).toEqual({
      enabled: null,
      colors: true,
      holidays: {},
      show: 'auto',
    });
    expect(
      normalizeSeasonalSettings({
        enabled: 'yes',
        colors: 0,
        holidays: { halloween: false, christmas: true, made_up: false },
        show: 'birthday',
      })
    ).toEqual({ enabled: null, colors: true, holidays: { halloween: false }, show: 'auto' });
  });

  test('lets a picked holiday last only until its end time', () => {
    const now = day(2026, 6, 1).getTime();
    expect(normalizeSeasonalSettings({ show: 'easter', showUntil: now + 1 }, now)).toEqual(
      expect.objectContaining({ show: 'easter', showUntil: now + 1 })
    );
    const expired = normalizeSeasonalSettings({ show: 'easter', showUntil: now }, now);
    expect(expired.show).toBe('auto');
    expect(expired).not.toHaveProperty('showUntil');
    // A pick without an end time (an older or hand-edited config) is not a pick.
    expect(normalizeSeasonalSettings({ show: 'easter' }, now).show).toBe('auto');
  });

  test('starts on unless the system asks for reduced motion or high contrast is on', () => {
    const unset = normalizeSeasonalSettings({});
    expect(isSeasonalEnabled(unset)).toBe(true);
    expect(isSeasonalEnabled(unset, { reducedMotion: true })).toBe(false);
    expect(isSeasonalEnabled(unset, { highContrast: true })).toBe(false);
    // An explicit choice wins either way.
    expect(isSeasonalEnabled({ ...unset, enabled: true }, { reducedMotion: true })).toBe(true);
    expect(isSeasonalEnabled({ ...unset, enabled: false })).toBe(false);
  });

  test('resolves the holiday to show for a ui config', () => {
    const october = day(2026, 10, 15);
    expect(resolveSeasonalHoliday({}, { date: october }).id).toBe('halloween');
    expect(resolveSeasonalHoliday({ highContrast: true }, { date: october })).toBeNull();
    expect(resolveSeasonalHoliday({}, { date: october, reducedMotion: true })).toBeNull();
    expect(
      resolveSeasonalHoliday(
        { highContrast: true, seasonal: { enabled: true } },
        { date: october, reducedMotion: true }
      ).id
    ).toBe('halloween');
    expect(
      resolveSeasonalHoliday({ seasonal: { holidays: { halloween: false } } }, { date: october })
    ).toBeNull();
    // A picked holiday shows whatever the date and whatever is switched off, until it runs out.
    const june = day(2026, 6, 1);
    const pickedChristmas = {
      show: 'christmas',
      showUntil: june.getTime() + 60000,
      holidays: { christmas: false },
    };
    expect(resolveSeasonalHoliday({ seasonal: pickedChristmas }, { date: june }).id).toBe(
      'christmas'
    );
    expect(
      resolveSeasonalHoliday(
        { seasonal: pickedChristmas },
        { date: new Date(june.getTime() + 120000) }
      )
    ).toBeNull();
    expect(
      resolveSeasonalHoliday({ seasonal: { ...pickedChristmas, enabled: false } }, { date: june })
    ).toBeNull();
  });
});
