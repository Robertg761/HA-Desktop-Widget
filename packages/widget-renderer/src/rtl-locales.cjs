/**
 * Languages written right to left. The renderer sets the page's `dir` from this, and the main
 * process sets it on the browser page shown after Home Assistant sign-in, so both agree.
 */
const RTL_LANGUAGE_CODES = new Set(['ar', 'fa', 'he', 'ur']);

function isRtlLocale(locale) {
  return RTL_LANGUAGE_CODES.has(
    String(locale || 'en')
      .split('-')[0]
      .toLowerCase()
  );
}

module.exports = { isRtlLocale };
