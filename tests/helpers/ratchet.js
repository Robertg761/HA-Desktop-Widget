/**
 * Shared reporting for the baseline ("ratchet") guard tests.
 *
 * A ratchet test finds every current violation of a rule and compares it with a checked-in
 * baseline of known ones. The baseline only shrinks: a violation outside it fails the test, and so
 * does a baseline entry that no longer occurs, so a fix has to delete its line. Both failures name
 * the entries, because jest's own diff of two long arrays is hard to act on.
 */

function lines(entries, detail) {
  return entries
    .map((entry) => `  ${entry}${detail?.(entry) ? `  ${detail(entry)}` : ''}`)
    .join('\n');
}

/** Throws when `found` has an entry the baseline does not list. */
function expectNoNewEntries(found, baselineEntries, advice, detail) {
  const known = new Set(baselineEntries);
  const fresh = found.filter((entry) => !known.has(entry));
  if (fresh.length) {
    throw new Error(`${advice}\n${lines(fresh, detail)}`);
  }
}

/** Throws when the baseline lists an entry that `found` no longer has: it was fixed. */
function expectNoStaleEntries(found, baselineEntries, baselineFile, noun = 'baseline') {
  const present = new Set(found);
  const fixed = baselineEntries.filter((entry) => !present.has(entry));
  if (fixed.length) {
    throw new Error(
      `${fixed.length} ${noun} ${fixed.length === 1 ? 'entry is' : 'entries are'} fixed, so the ` +
        `${noun} has to shrink. Delete ${fixed.length === 1 ? 'it' : 'them'} from ${baselineFile}:\n${lines(fixed)}`
    );
  }
}

module.exports = { expectNoNewEntries, expectNoStaleEntries };
