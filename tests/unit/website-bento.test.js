/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '../../website', file), 'utf8');
const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

// The grid is six columns wide and a tile spans two, three or four of them, so a rule that picks
// tiles by position fits one page's tile count and breaks another's. The tablet layout once gave the
// homepage's second and last tiles a whole row with a selector that every bento matched, which put
// the companion page's four half-width tiles in a column of alternating halves and wholes.
describe('the website bento grid', () => {
  const positional = css
    .split('{')
    .flatMap((chunk) => chunk.split('}').pop().split(','))
    .map((selector) => selector.trim())
    .filter(
      (selector) =>
        selector.includes('.bento') && /:(?:first|last|only)-(?:child|of-type)|:nth-/.test(selector)
    );

  it('picks tiles by position only inside the homepage bento', () => {
    // Found in the tablet layout and in the single-column reset that undoes it.
    expect(positional.length).toBeGreaterThanOrEqual(4);
    for (const selector of positional) {
      expect(selector).toMatch(/^\.bento-home > /);
    }
  });

  const bentoClasses = (page) => read(page).match(/<div class="(bento(?: [^"]*)?)"/)?.[1];

  it('marks the homepage bento and leaves the companion page its natural pairs', () => {
    expect(bentoClasses('index.html').split(' ')).toContain('bento-home');
    expect(bentoClasses('companion.html')).toBe('bento');
  });
});
