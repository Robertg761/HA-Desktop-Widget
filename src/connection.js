const HOME_ASSISTANT_TOKEN_PLACEHOLDER = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
const URL_PLACEHOLDER_VALUES = new Set([
  'YOUR_HOME_ASSISTANT_URL',
  'HOME_ASSISTANT_URL',
]);

function normalizePlaceholderValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlaceholderOrEmptyValue(value, placeholders = []) {
  const normalized = normalizePlaceholderValue(value);
  if (!normalized) return true;
  return placeholders.includes(normalized) || URL_PLACEHOLDER_VALUES.has(normalized);
}

function isPlaceholderOrEmptyToken(token) {
  return isPlaceholderOrEmptyValue(token, [HOME_ASSISTANT_TOKEN_PLACEHOLDER]);
}

function normalizeBaseUrl(rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed || URL_PLACEHOLDER_VALUES.has(trimmed)) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return parsed.origin.replace(/\/+$/, '');
}

function isConfigured(config) {
  const homeAssistant = config?.homeAssistant || {};
  return !!normalizeBaseUrl(homeAssistant.url) && !isPlaceholderOrEmptyToken(homeAssistant.token);
}

function buildHomeAssistantPathUrl(baseUrl, path) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  if (!normalizedBase) return null;
  const normalizedPath = typeof path === 'string' && path.startsWith('/') ? path : `/${path || ''}`;
  return `${normalizedBase}${normalizedPath}`;
}

function classifyConnectionError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || error?.error || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (code === 'invalid-url' || message.includes('invalid url')) return 'invalid-url';
  if (code === 'auth-failed' || status === 401 || status === 403) return 'auth-failed';
  if (
    code === 'unreachable' ||
    code.includes('timeout') ||
    code.includes('econn') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('unreachable') ||
    message.includes('failed to fetch')
  ) {
    return 'unreachable';
  }
  return 'unreachable';
}

export {
  HOME_ASSISTANT_TOKEN_PLACEHOLDER,
  normalizeBaseUrl,
  isConfigured,
  isPlaceholderOrEmptyToken,
  buildHomeAssistantPathUrl,
  classifyConnectionError,
};
