import rtlLocales from './rtl-locales.cjs';

const { isRtlLocale } = rtlLocales;

let localeState = {
  languageSetting: 'auto',
  detectedLocale: 'en',
  systemLocale: '',
  requestedLocale: 'en',
  activeLocale: 'en',
  fallbackLocale: 'en',
  localeSource: 'bundled',
  packInstalled: true,
  usingEnglishFallback: false,
  messages: {},
  installedPacks: [],
};

// Resolved once per bootstrap (see getFormatLocale); every formatted value asks for it.
let formatLocale = null;

const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

function formatTemplate(template, vars = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(TEMPLATE_TOKEN_PATTERN, (_match, key) => {
    const value = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    return value == null ? '' : String(value);
  });
}

export function setLocaleBootstrap(bootstrap = {}) {
  formatLocale = null;
  localeState = {
    ...localeState,
    ...bootstrap,
    messages:
      bootstrap?.messages && typeof bootstrap.messages === 'object'
        ? bootstrap.messages
        : localeState.messages,
    installedPacks: Array.isArray(bootstrap?.installedPacks)
      ? bootstrap.installedPacks
      : localeState.installedPacks,
  };
  document.documentElement.lang = localeState.activeLocale || 'en';
  document.documentElement.dir = isRtlLocale(localeState.activeLocale) ? 'rtl' : 'ltr';
  return localeState;
}

export function getLocaleState() {
  return localeState;
}

// Keeps a left-to-right run such as "23°C" in order inside a right-to-left sentence ("الآن 23°C"),
// where the bidi algorithm would otherwise move the degree sign. The isolate marks are invisible
// and only added while a right-to-left language is active.
export function isolateLtr(text) {
  const value = text == null ? '' : String(text);
  return value && isRtlLocale(localeState.activeLocale) ? `\u2066${value}\u2069` : value;
}

export function t(key, vars = {}) {
  const template = localeState.messages?.[key] || key;
  return formatTemplate(template, vars);
}

function getBaseLanguage(locale) {
  return String(locale || '')
    .split(/[-_]/)[0]
    .toLowerCase();
}

function hasRegion(locale) {
  return /^[A-Za-z]{2,3}[-_](?:[A-Za-z]{2}|\d{3})\b/.test(String(locale || ''));
}

function isValidLocaleTag(locale) {
  try {
    return !!locale && Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

/**
 * The locale numbers, dates, times, units and sort order follow. It is the language the text is
 * in, with the region of the computer (en-GB, de-CH, es-MX) when that is the same language, so a
 * British user reads "30/09/2026" and a Mexican one "1,234.5" under the same English or Spanish
 * catalog. The catalog locale (activeLocale) is only a language: an English-fallback user whose
 * computer is set to pt-BR, with no Portuguese pack, still gets Brazilian formats.
 * @returns {string} A BCP 47 tag that Intl accepts.
 */
export function getFormatLocale() {
  if (!formatLocale) formatLocale = resolveFormatLocale();
  return formatLocale;
}

function resolveFormatLocale() {
  const { languageSetting, activeLocale, requestedLocale, detectedLocale, systemLocale } =
    localeState;
  const active = activeLocale || 'en';
  const activeLanguage = getBaseLanguage(active);
  const isAuto = languageSetting === 'auto';
  // For an explicit language, a region the user chose (es-MX) beats the computer's.
  const candidates = isAuto
    ? [systemLocale, detectedLocale]
    : [hasRegion(requestedLocale) ? requestedLocale : '', systemLocale, requestedLocale];
  const sameLanguage = candidates.find(
    (candidate) => getBaseLanguage(candidate) === activeLanguage && isValidLocaleTag(candidate)
  );
  if (sameLanguage) return sameLanguage;
  if (isAuto && localeState.usingEnglishFallback) {
    const own =
      getBaseLanguage(systemLocale) === getBaseLanguage(detectedLocale)
        ? systemLocale
        : detectedLocale;
    if (isValidLocaleTag(own)) return own;
  }
  return isValidLocaleTag(active) ? active : 'en';
}

// Date's toLocaleDateString, toLocaleTimeString and toLocaleString build a new Intl.DateTimeFormat
// on every call, which is most of what writing a time costs, and the clock, the tiles and the
// history lists write the same few patterns over and over. So one formatter is kept per locale,
// kind and options. Each kind fills in the fields its Date method adds when none are asked for, as
// ECMA-402 has it (CreateDateTimeFormat with the method's "required" and "defaults").
const dateTimeFormatCache = new Map();
const DATE_FIELDS = ['weekday', 'year', 'month', 'day'];
const TIME_FIELDS = ['dayPeriod', 'hour', 'minute', 'second', 'fractionalSecondDigits'];
const DATE_TIME_KINDS = {
  date: { required: 'date', defaults: 'date' },
  time: { required: 'time', defaults: 'time' },
  dateTime: { required: 'any', defaults: 'all' },
};

function withDefaultFields(options, { required, defaults }) {
  const asks = (fields) => fields.some((field) => options[field] !== undefined);
  if (required === 'date' && options.timeStyle !== undefined) {
    throw new TypeError('A date cannot be formatted with timeStyle');
  }
  if (required === 'time' && options.dateStyle !== undefined) {
    throw new TypeError('A time cannot be formatted with dateStyle');
  }
  const named =
    options.dateStyle !== undefined ||
    options.timeStyle !== undefined ||
    (required !== 'time' && asks(DATE_FIELDS)) ||
    (required !== 'date' && asks(TIME_FIELDS));
  if (named) return options;
  return {
    ...options,
    ...(defaults !== 'time' ? { year: 'numeric', month: 'numeric', day: 'numeric' } : {}),
    ...(defaults !== 'date' ? { hour: 'numeric', minute: 'numeric', second: 'numeric' } : {}),
  };
}

function formatDateTimeAs(kind, date, options) {
  const value = date instanceof Date ? date : new Date(date);
  // The Date methods write this; a formatter throws on it.
  if (Number.isNaN(value.getTime())) return 'Invalid Date';
  const locale = getFormatLocale();
  const cacheKey = `${kind}|${locale}|${JSON.stringify(options)}`;
  let formatter = dateTimeFormatCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, withDefaultFields(options, DATE_TIME_KINDS[kind]));
    dateTimeFormatCache.set(cacheKey, formatter);
  }
  return formatter.format(value);
}

export function formatDate(date, options = {}) {
  return formatDateTimeAs('date', date, options);
}

export function formatTime(date, options = {}) {
  return formatDateTimeAs('time', date, options);
}

export function formatDateTime(date, options = {}) {
  return formatDateTimeAs('dateTime', date, options);
}

const numberFormatCache = new Map();

// Formats a number for display in the user's number format ("15,6" in German). Inputs, slider
// values and anything sent to Home Assistant keep plain machine numbers; only use this for
// visible text.
export function formatNumber(value, options = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) {
    return value == null ? '' : String(value);
  }
  const locale = getFormatLocale();
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(cacheKey);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      formatter = new Intl.NumberFormat('en', options);
    }
    numberFormatCache.set(cacheKey, formatter);
  }
  return formatter.format(number);
}

export function getLanguageDisplayName(locale, fallback = '') {
  try {
    if (!locale) return fallback || '';
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const displayNames = new Intl.DisplayNames([localeState.activeLocale || 'en'], {
        type: 'language',
      });
      return displayNames.of(locale) || fallback || locale;
    }
  } catch {
    // Ignore and use fallback below.
  }
  return fallback || locale;
}

function parseI18nVars(element) {
  const raw = element?.getAttribute?.('data-i18n-vars');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Ignore malformed translation vars and preserve the existing rendered text.
  }
  return {};
}

function hasMissingTemplateVars(template, vars = {}) {
  if (typeof template !== 'string' || !template.includes('{{')) return false;
  const keys = new Set();
  let match;
  const pattern = new RegExp(TEMPLATE_TOKEN_PATTERN);
  while ((match = pattern.exec(template))) {
    keys.add(match[1]);
  }
  return [...keys].some((key) => !Object.prototype.hasOwnProperty.call(vars, key));
}

function resolveTranslation(key, vars = {}) {
  const template = localeState.messages?.[key] || key;
  if (hasMissingTemplateVars(template, vars)) {
    return null;
  }
  return formatTemplate(template, vars);
}

// Language packs are downloaded, so their text never becomes markup. The only formatting these
// strings need is <code>…</code>, which is rebuilt as real elements; anything else stays text.
function setTextWithCodeSpans(element, text) {
  const ownerDocument = element.ownerDocument || document;
  const nodes = [];
  const pattern = /<code>([\s\S]*?)<\/code>/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(ownerDocument.createTextNode(text.slice(lastIndex, match.index)));
    }
    const code = ownerDocument.createElement('code');
    code.textContent = match[1];
    nodes.push(code);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(ownerDocument.createTextNode(text.slice(lastIndex)));
  element.replaceChildren(...nodes);
}

function translateElement(element) {
  if (!element || typeof element.getAttribute !== 'function') return;
  const vars = parseI18nVars(element);

  const textKey = element.getAttribute('data-i18n');
  if (textKey) {
    const translatedText = resolveTranslation(textKey, vars);
    if (translatedText != null) {
      element.textContent = translatedText;
    }
  }

  const htmlKey = element.getAttribute('data-i18n-html');
  if (htmlKey) {
    const translatedHtml = resolveTranslation(htmlKey, vars);
    if (translatedHtml != null) {
      setTextWithCodeSpans(element, translatedHtml);
    }
  }

  const titleKey = element.getAttribute('data-i18n-title');
  if (titleKey) {
    const translatedTitle = resolveTranslation(titleKey, vars);
    if (translatedTitle != null) {
      element.setAttribute('title', translatedTitle);
    }
  }

  const ariaLabelKey = element.getAttribute('data-i18n-aria-label');
  if (ariaLabelKey) {
    const translatedAriaLabel = resolveTranslation(ariaLabelKey, vars);
    if (translatedAriaLabel != null) {
      element.setAttribute('aria-label', translatedAriaLabel);
    }
  }

  const placeholderKey = element.getAttribute('data-i18n-placeholder');
  if (placeholderKey) {
    const translatedPlaceholder = resolveTranslation(placeholderKey, vars);
    if (translatedPlaceholder != null) {
      element.setAttribute('placeholder', translatedPlaceholder);
    }
  }

  const valueKey = element.getAttribute('data-i18n-value');
  if (valueKey) {
    const translatedValue = resolveTranslation(valueKey, vars);
    if (translatedValue != null) {
      element.value = translatedValue;
    }
  }
}

export function translateDocument(root = document) {
  if (!root) return;
  if (root.nodeType === Node.ELEMENT_NODE) {
    translateElement(root);
  }
  root
    .querySelectorAll?.(
      '[data-i18n], [data-i18n-html], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-value]'
    )
    .forEach(translateElement);
}
