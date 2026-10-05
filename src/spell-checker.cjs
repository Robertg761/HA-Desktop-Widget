// Spell-check is off on purpose. The app's text fields take names, addresses, ids and searches,
// not prose, and spell-check was only on because Electron turns it on by default. Turning it off
// takes two steps, because the first does not stop the download:
//
// 1. spellcheck: false in the webPreferences of every window main.js creates. That removes the red
//    underlines and the spelling suggestions. tests/unit/spell-check-off.test.js fails if a window
//    leaves it out.
// 2. turnOffSpellChecker below, for the session the windows share. On Windows and Linux, Electron
//    gives the session a Hunspell spell checker and downloads its dictionary from Google's CDN
//    (redirector.gvt1.com) once main.js first uses the session, whatever the windows say. Measured
//    under Electron 43 on Linux with a new profile: with spellcheck: false in the window, and with
//    setSpellCheckerEnabled(false) as well, en-US-10-1.bdic still downloaded. An empty language
//    list stops it, but only if it is set before that first use of the session returns to the
//    event loop: set one setTimeout later, the request had already gone out. Electron fills the
//    list from the system's language again at every start, so this runs at every start.
//
// On macOS, Electron's documentation says the system's own spell checker is used and no
// dictionary is downloaded. setSpellCheckerLanguages does nothing there, and the window setting is
// what keeps the underlines away.
function turnOffSpellChecker(targetSession) {
  targetSession.setSpellCheckerEnabled(false);
  targetSession.setSpellCheckerLanguages([]);
}

module.exports = { turnOffSpellChecker };
