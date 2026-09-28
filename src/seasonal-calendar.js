/**
 * Holiday calendar for the seasonal themes: when each holiday runs, which one a given day falls
 * in, and how the `ui.seasonal` settings resolve. Everything works on local calendar days, so a
 * holiday starts and ends at the user's own midnight.
 */
const DAY_MS = 86400000;

// Days since the epoch for a calendar date. UTC keeps the arithmetic clear of DST shifts.
function dayNumber(year, monthIndex, day) {
  return Math.round(Date.UTC(year, monthIndex, day) / DAY_MS);
}

function dayNumberOf(date) {
  return dayNumber(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateFromDayNumber(value) {
  const utc = new Date(value * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/**
 * Western (Gregorian) Easter Sunday, by the anonymous Meeus/Jones/Butcher algorithm.
 * @param {number} year
 * @returns {number} Day number of Easter Sunday.
 */
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(year, month - 1, day);
}

// US Thanksgiving: the fourth Thursday of November.
function getThanksgiving(year) {
  const firstWeekday = new Date(year, 10, 1).getDay();
  const firstThursday = 1 + ((4 - firstWeekday + 7) % 7);
  return dayNumber(year, 10, firstThursday + 21);
}

// The lunisolar date has no simple formula, so the next few years are listed. Years outside the
// table simply have no Lunar New Year theme.
const LUNAR_NEW_YEAR_DATES = {
  2025: [0, 29],
  2026: [1, 17],
  2027: [1, 6],
  2028: [0, 26],
  2029: [1, 13],
  2030: [1, 3],
  2031: [0, 23],
  2032: [1, 11],
  2033: [0, 31],
  2034: [1, 19],
  2035: [1, 8],
  2036: [0, 28],
  2037: [1, 15],
  2038: [1, 4],
  2039: [0, 24],
  2040: [1, 12],
};

function getLunarNewYear(year) {
  const entry = LUNAR_NEW_YEAR_DATES[year];
  return entry ? dayNumber(year, entry[0], entry[1]) : null;
}

/**
 * Each holiday runs from `before` days ahead of its day to `after` days past it. The big two get
 * their whole month; the rest get about a week. `colors` stand in for the accent and background
 * while the holiday is on.
 */
const SEASONAL_HOLIDAYS = [
  {
    id: 'new-year',
    name: 'New Year',
    getDay: (year) => dayNumber(year, 0, 1),
    before: 5,
    after: 1,
    colors: { accent: '#fbbf24', background: '#1e3a8a' },
  },
  {
    id: 'lunar-new-year',
    name: 'Lunar New Year',
    getDay: getLunarNewYear,
    before: 3,
    after: 3,
    colors: { accent: '#f43f5e', background: '#b45309' },
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    getDay: (year) => dayNumber(year, 1, 14),
    before: 6,
    after: 0,
    colors: { accent: '#ec4899', background: '#be185d' },
  },
  {
    id: 'st-patricks',
    name: "St. Patrick's Day",
    getDay: (year) => dayNumber(year, 2, 17),
    before: 6,
    after: 0,
    colors: { accent: '#22c55e', background: '#166534' },
  },
  {
    // Palm Sunday through Easter Monday.
    id: 'easter',
    name: 'Easter',
    getDay: getEasterSunday,
    before: 7,
    after: 1,
    colors: { accent: '#a78bfa', background: '#f9a8d4' },
  },
  {
    id: 'halloween',
    name: 'Halloween',
    getDay: (year) => dayNumber(year, 9, 31),
    before: 30,
    after: 0,
    colors: { accent: '#f97316', background: '#6d28d9' },
  },
  {
    // Through the long weekend that follows.
    id: 'thanksgiving',
    name: 'Thanksgiving',
    getDay: getThanksgiving,
    before: 6,
    after: 3,
    colors: { accent: '#ea580c', background: '#92400e' },
  },
  {
    id: 'christmas',
    name: 'Christmas',
    getDay: (year) => dayNumber(year, 11, 25),
    before: 24,
    after: 1,
    colors: { accent: '#ef4444', background: '#15803d' },
  },
];

const HOLIDAY_BY_ID = new Map(SEASONAL_HOLIDAYS.map((holiday) => [holiday.id, holiday]));

function getHolidayById(id) {
  return HOLIDAY_BY_ID.get(id) || null;
}

function getHolidayRange(holiday, year) {
  const day = holiday.getDay(year);
  if (day === null || day === undefined) return null;
  return { holiday, day, start: day - holiday.before, end: day + holiday.after };
}

function toPublicRange(range) {
  return {
    holiday: range.holiday,
    day: dateFromDayNumber(range.day),
    start: dateFromDayNumber(range.start),
    end: dateFromDayNumber(range.end),
  };
}

function isEnabledIn(enabledIds, id) {
  return !enabledIds || enabledIds.includes(id);
}

/**
 * The holiday running on `date`, if any. When two overlap (St. Patrick's and Palm Sunday, say),
 * the one whose day is nearer wins, then the shorter one.
 * @param {Date} date
 * @param {string[]} [enabledIds] Holidays to consider; all of them when omitted.
 * @returns {{holiday: object, day: Date, start: Date, end: Date} | null}
 */
function findActiveHoliday(date = new Date(), enabledIds) {
  const today = dayNumberOf(date);
  const year = date.getFullYear();
  let best = null;
  for (const holiday of SEASONAL_HOLIDAYS) {
    if (!isEnabledIn(enabledIds, holiday.id)) continue;
    // New Year starts in the December before its day.
    for (const candidateYear of [year - 1, year, year + 1]) {
      const range = getHolidayRange(holiday, candidateYear);
      if (!range || today < range.start || today > range.end) continue;
      const distance = Math.abs(today - range.day);
      const length = range.end - range.start;
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && length < best.length)
      ) {
        best = { range, distance, length };
      }
    }
  }
  return best ? toPublicRange(best.range) : null;
}

/**
 * The next holiday that starts after `date`.
 * @param {Date} date
 * @param {string[]} [enabledIds]
 * @returns {{holiday: object, day: Date, start: Date, end: Date} | null}
 */
function findNextHoliday(date = new Date(), enabledIds) {
  const today = dayNumberOf(date);
  const year = date.getFullYear();
  let best = null;
  for (const holiday of SEASONAL_HOLIDAYS) {
    if (!isEnabledIn(enabledIds, holiday.id)) continue;
    for (const candidateYear of [year, year + 1, year + 2]) {
      const range = getHolidayRange(holiday, candidateYear);
      if (!range || range.start <= today) continue;
      if (!best || range.start < best.start) best = range;
      break;
    }
  }
  return best ? toPublicRange(best) : null;
}

/**
 * This year's run of a holiday, or next year's once this year's has passed.
 * @param {string} id
 * @param {Date} date
 */
function getUpcomingHolidayRange(id, date = new Date()) {
  const holiday = getHolidayById(id);
  if (!holiday) return null;
  const today = dayNumberOf(date);
  const year = date.getFullYear();
  for (const candidateYear of [year - 1, year, year + 1, year + 2]) {
    const range = getHolidayRange(holiday, candidateYear);
    if (range && range.end >= today) return toPublicRange(range);
  }
  return null;
}

// "Holiday to show" is a preview: a picked holiday lasts this long, then the calendar takes over.
const SHOW_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Normalize `ui.seasonal`. `enabled` stays null until the user picks, so the default can follow
 * reduced motion and the readable preset. `holidays` only records the ones switched off. A picked
 * `show` holiday counts only until `showUntil` (ms since the epoch); after that, or without one,
 * `show` is 'auto'.
 * @param {object} [raw]
 * @param {number} [now] The time to judge `showUntil` against.
 */
function normalizeSeasonalSettings(raw, now = Date.now()) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const holidays = {};
  if (source.holidays && typeof source.holidays === 'object') {
    for (const holiday of SEASONAL_HOLIDAYS) {
      if (source.holidays[holiday.id] === false) holidays[holiday.id] = false;
    }
  }
  const showUntil = Number(source.showUntil);
  const showing = HOLIDAY_BY_ID.has(source.show) && Number.isFinite(showUntil) && showUntil > now;
  const settings = {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : null,
    colors: source.colors !== false,
    holidays,
    show: showing ? source.show : 'auto',
  };
  if (showing) settings.showUntil = showUntil;
  return settings;
}

/**
 * Whether seasonal themes are on. Unset means on, unless the system asks for reduced motion or
 * the readable (high contrast) preset is on.
 */
function isSeasonalEnabled(settings, { reducedMotion = false, highContrast = false } = {}) {
  if (typeof settings.enabled === 'boolean') return settings.enabled;
  return !reducedMotion && !highContrast;
}

function getEnabledHolidayIds(settings) {
  return SEASONAL_HOLIDAYS.filter((holiday) => settings.holidays[holiday.id] !== false).map(
    (holiday) => holiday.id
  );
}

/**
 * The holiday to show for a `ui` config: the one picked under "Show", or the one running today.
 * @param {object} ui
 * @param {{date?: Date, reducedMotion?: boolean}} [options]
 * @returns {object|null} The holiday definition.
 */
function resolveSeasonalHoliday(ui = {}, { date = new Date(), reducedMotion = false } = {}) {
  const settings = normalizeSeasonalSettings(ui.seasonal, date.getTime());
  if (!isSeasonalEnabled(settings, { reducedMotion, highContrast: !!ui.highContrast })) {
    return null;
  }
  if (settings.show !== 'auto') return getHolidayById(settings.show);
  return findActiveHoliday(date, getEnabledHolidayIds(settings))?.holiday || null;
}

export {
  SEASONAL_HOLIDAYS,
  SHOW_DURATION_MS,
  getEasterSunday,
  getHolidayById,
  findActiveHoliday,
  findNextHoliday,
  getUpcomingHolidayRange,
  normalizeSeasonalSettings,
  isSeasonalEnabled,
  getEnabledHolidayIds,
  resolveSeasonalHoliday,
  dateFromDayNumber,
};
