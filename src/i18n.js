let localeState = {
  languageSetting: 'auto',
  detectedLocale: 'en',
  requestedLocale: 'en',
  activeLocale: 'en',
  fallbackLocale: 'en',
  localeSource: 'bundled',
  packInstalled: true,
  usingEnglishFallback: false,
  messages: {},
  installedPacks: [],
};

const RTL_LANGUAGE_CODES = new Set(['ar', 'fa', 'he', 'ur']);
const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

function formatTemplate(template, vars = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(TEMPLATE_TOKEN_PATTERN, (_match, key) => {
    const value = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    return value == null ? '' : String(value);
  });
}

export function setLocaleBootstrap(bootstrap = {}) {
  localeState = {
    ...localeState,
    ...bootstrap,
    messages: bootstrap?.messages && typeof bootstrap.messages === 'object'
      ? bootstrap.messages
      : localeState.messages,
    installedPacks: Array.isArray(bootstrap?.installedPacks)
      ? bootstrap.installedPacks
      : localeState.installedPacks,
  };
  document.documentElement.lang = localeState.activeLocale || 'en';
  document.documentElement.dir = RTL_LANGUAGE_CODES.has((localeState.activeLocale || 'en').split('-')[0]) ? 'rtl' : 'ltr';
  return localeState;
}

export function getLocaleState() {
  return localeState;
}

export function t(key, vars = {}) {
  const template = localeState.messages?.[key] || key;
  return formatTemplate(template, vars);
}

export function formatDate(date, options = {}) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toLocaleDateString(localeState.activeLocale || undefined, options);
}

export function formatTime(date, options = {}) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toLocaleTimeString(localeState.activeLocale || undefined, options);
}

export function formatDateTime(date, options = {}) {
  const value = date instanceof Date ? date : new Date(date);
  return value.toLocaleString(localeState.activeLocale || undefined, options);
}

export function getLanguageDisplayName(locale, fallback = '') {
  try {
    if (!locale) return fallback || '';
    if (typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
      const displayNames = new Intl.DisplayNames([localeState.activeLocale || 'en'], { type: 'language' });
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
      element.innerHTML = translatedHtml;
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
  root.querySelectorAll?.('[data-i18n], [data-i18n-html], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder], [data-i18n-value]').forEach(translateElement);
}
