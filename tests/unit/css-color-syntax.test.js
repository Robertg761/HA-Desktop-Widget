/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const STYLESHEETS = ['styles.css', 'dashboard-workflows.css'];

describe('colour functions in the stylesheets', () => {
  // --accent-rgb and the other *-rgb tokens are comma triplets ("100, 181, 246"). rgb(var(--x) / 14%)
  // takes space-separated channels, so with a comma triplet the whole declaration is invalid at
  // computed-value time and is dropped without a fallback: a pill with no fill, a border that is
  // never drawn. rgba(var(--x), 0.14) is the form that works.
  it.each(STYLESHEETS)('%s never gives a comma triplet to rgb() with a slash alpha', (file) => {
    const css = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    const offenders = [...css.matchAll(/rgba?\(\s*var\(--[\w-]*rgb[\w-]*\)\s*\//g)].map(
      (match) => css.slice(0, match.index).split('\n').length
    );
    expect(offenders).toEqual([]);
  });
});
