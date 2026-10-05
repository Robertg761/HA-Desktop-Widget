/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const QUERY = '(prefers-reduced-motion: reduce)';

// The files that may name the media query themselves: motion.js answers "now" for everyone else,
// and the two canvases keep the query object to hear the setting change while they animate.
const ALLOWED = ['src/motion.js', 'src/seasonal-effects.js', 'src/weather-effects.js'];

function rendererSources() {
  const listed = ['renderer.js'];
  for (const dir of ['src', 'packages/widget-renderer/src']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(?:c|m)?js$/.test(name)) listed.push(`${dir}/${name}`);
    }
  }
  return listed;
}

describe('the reduced-motion setting', () => {
  it('is asked through motion.js, so a change to how it is read is made in one place', () => {
    const readers = rendererSources().filter((file) =>
      fs.readFileSync(path.join(ROOT, file), 'utf8').includes(QUERY)
    );
    expect(readers.sort()).toEqual([...ALLOWED].sort());
  });
});
