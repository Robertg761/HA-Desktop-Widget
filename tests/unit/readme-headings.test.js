/** @jest-environment node */
const fs = require('fs');
const path = require('path');

// GitHub links each heading by its text, and a second heading of the same name gets "-1" on its
// link. Two Troubleshooting sections both called Linux split one platform's problems in two, and
// the AppImage entry ended up after Common Solutions, away from the others.
describe('the README', () => {
  const readme = fs.readFileSync(path.resolve(__dirname, '../../README.md'), 'utf8');

  // A line starting with # in a code block is a shell comment, not a heading.
  function headings(markdown) {
    let fenced = false;
    return markdown.split(/\r?\n/).flatMap((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return [];
      const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
      return heading ? [heading[1]] : [];
    });
  }

  it('names each heading once', () => {
    const all = headings(readme);
    expect(all).toContain('Troubleshooting');
    expect(all.filter((heading, index) => all.indexOf(heading) !== index)).toEqual([]);
  });

  it('leaves the shell comments in its code blocks out of the headings', () => {
    expect(headings('# Title\n\n```sh\n# a comment\n```\n\n## Part')).toEqual(['Title', 'Part']);
  });
});
