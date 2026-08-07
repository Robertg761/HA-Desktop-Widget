'use strict';

/**
 * Shared kernel for one-shot HTTP fetches: timeout via AbortSignal plus the
 * non-2xx -> throw check. Takes the fetch implementation as an argument so
 * callers can pass Electron's net.fetch or an injectable test double.
 */
async function fetchChecked(
  fetchImpl,
  url,
  { timeoutMs, headers, errorPrefix = 'Request failed' } = {}
) {
  const init = { signal: AbortSignal.timeout(timeoutMs) };
  if (headers) {
    init.headers = headers;
  }
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(`${errorPrefix} with status code ${response.status}`);
  }
  return response;
}

module.exports = { fetchChecked };
