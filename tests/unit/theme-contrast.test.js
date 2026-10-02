const baseline = require('../fixtures/theme-contrast-baseline.json');
const { expectNoNewEntries, expectNoStaleEntries } = require('../helpers/ratchet.js');
const { SCOPES, collectContrastChecks } = require('../helpers/theme-contrast.js');
const { getAccentThemes } = require('../../src/ui-utils.js');

const BASELINE_FILE = 'tests/fixtures/theme-contrast-baseline.json';
const format = (ratio) => ratio.toFixed(2);

describe('theme contrast ratchet', () => {
  const checks = collectContrastChecks();
  const failing = checks.filter((check) => check.ratio < check.minimum);
  const byKey = new Map(checks.map((check) => [check.key, check]));

  it('measures the text tokens in every theme and the accent pairs for every accent', () => {
    const keys = checks.map((check) => check.key);
    expect(Object.keys(SCOPES)).toEqual(['dark', 'light', 'high-contrast', 'high-contrast-light']);
    expect(keys).toContain('light|--text-primary on window');
    expect(keys).toContain('high-contrast|--text-faint on dialog');
    const accents = getAccentThemes();
    expect(accents.length).toBeGreaterThanOrEqual(10);
    for (const scope of ['dark', 'light']) {
      for (const { id } of accents) {
        expect(keys).toContain(`${scope}|${id}|--accent-text on window`);
        expect(keys).toContain(`${scope}|${id}|--on-accent on --accent`);
      }
    }
    // The numbers are real: near-white text on the dark window is far above AA, and the light
    // theme's primary text on its near-white window is too.
    expect(byKey.get('dark|--text-primary on window').ratio).toBeGreaterThan(15);
    expect(byKey.get('light|--text-primary on window').ratio).toBeGreaterThan(15);
  });

  it('holds every text token of the readable preset to 7:1, help text included', () => {
    // Seven tokens on three surfaces, with the preset over either theme.
    const readable = checks.filter((check) =>
      /^high-contrast(-light)?\|--(text|muted)/.test(check.key)
    );
    expect(readable.length).toBeGreaterThanOrEqual(42);
    for (const check of readable) {
      expect({ key: check.key, enough: check.ratio >= 7 }).toEqual({
        key: check.key,
        enough: true,
      });
    }
  });

  it('has no failing pair beyond the baseline', () => {
    expectNoNewEntries(
      failing.map((check) => check.key),
      Object.keys(baseline.entries),
      'These pairs fall below their WCAG minimum (4.5:1 text, 3:1 focus rings) and are not in the ' +
        `baseline. Fix the token or the on-colour (do not add to ${BASELINE_FILE}):`,
      (key) => `${format(byKey.get(key).ratio)}:1, needs ${byKey.get(key).minimum}:1`
    );
  });

  it('does not make a baselined pair any worse', () => {
    const worse = failing.filter(
      (check) => check.key in baseline.entries && check.ratio < baseline.entries[check.key] - 0.01
    );
    expectNoNewEntries(
      worse.map((check) => check.key),
      [],
      'These known failures got worse than the ratio recorded in the baseline:',
      (key) => `${format(byKey.get(key).ratio)}:1, was ${format(baseline.entries[key])}:1`
    );
  });

  it('keeps the baseline free of pairs that now pass', () => {
    expectNoStaleEntries(
      failing.map((check) => check.key),
      Object.keys(baseline.entries),
      BASELINE_FILE
    );
  });
});
