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

// The placeholders that quote text the app did not write: an OS error such as "EACCES: permission
// denied, open '…/config.json'", the reason Home Assistant gave for refusing a call, a helper's
// warning, the name of the entity a call failed for. Under a right-to-left language each keeps its
// own direction; otherwise an English error takes the Arabic sentence's direction, and the full
// stop or quote it ends with moves to the far end of the line. A test keeps every placeholder in
// en.json that names an error, a warning, a reason or a message in this list.
const QUOTED_TEXT_VARS = Object.freeze([
  'error',
  'errorMessage',
  'warning',
  'message',
  'entityName',
]);

/**
 * The values a message is filled with, the quoted ones (QUOTED_TEXT_VARS) isolated when the
 * language is right to left. Both processes' translate functions call this, so a new message that
 * quotes an {{error}} gets it without a wrap where it is shown. The isolate is first strong rather
 * than left to right, since the quoted text can be translated already.
 * @param {string} locale The language the message is in.
 * @param {object} vars The message's values.
 * @returns {object} The same values, or a copy with the quoted ones isolated.
 */
function isolateQuotedText(locale, vars) {
  if (!vars || typeof vars !== 'object' || !isRtlLocale(locale)) return vars;
  const isolated = { ...vars };
  QUOTED_TEXT_VARS.forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return;
    const value = vars[name] == null ? '' : String(vars[name]);
    if (value) isolated[name] = `\u2068${value}\u2069`;
  });
  return isolated;
}

module.exports = { QUOTED_TEXT_VARS, isRtlLocale, isolateQuotedText };
