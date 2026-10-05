/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const { expectNoNewEntries, expectNoStaleEntries } = require('../helpers/ratchet.js');
const {
  listUnreadDefinitions,
  scanCustomProperties,
  scanScript,
  scanText,
} = require('../helpers/css-custom-properties.js');
const {
  MAX_COMPARISON_GRAPH_SERIES,
} = require('../../packages/widget-renderer/src/comparison-graphs.js');

// Steps of a scale that nothing uses yet. They stay so the scale reads whole (a 0, a 10, a 12 and
// a 16 among the spacing steps, the square corner, the relaxed line height, the ease-in curve
// beside ease-out and ease-in-out).
const SCALE_STEPS = [
  '--ease-in',
  '--line-height-relaxed',
  '--radius-none',
  '--space-0',
  '--space-10',
  '--space-12',
  '--space-16',
];

// Written by applyWindowEffects and read by nothing. The window-effects golden fixture
// (tests/fixtures/window-effects-before-glass-gate.json) records them as part of the unchanged
// glass looks, so they go together with that fixture. This list only shrinks.
const KNOWN_UNREAD = [
  '--software-acrylic-noise-alpha',
  '--software-acrylic-shadow-alpha',
  '--window-opacity',
];

function scanOf(files) {
  const scan = { definitions: new Set(), definedIn: new Map(), prefixes: new Set(), reads: [] };
  for (const [file, text] of Object.entries(files)) {
    if (/\.(?:c|m)?js$/.test(file)) scanScript(text, file, scan);
    else scanText(text, file, scan);
  }
  return scan;
}

describe('unread custom property ratchet', () => {
  const unread = listUnreadDefinitions(scanCustomProperties());
  const allowed = [...SCALE_STEPS, ...KNOWN_UNREAD];

  it('defines no property that nothing reads, apart from the scale steps and the known writes', () => {
    expectNoNewEntries(
      unread,
      allowed,
      'These custom properties are defined (in a stylesheet, or written from the renderer) but no ' +
        'var() reads them. Delete the definition, including its theme, forced-colours and ' +
        'Readable copies, and stop writing it from JavaScript:'
    );
  });

  it('keeps the lists free of properties that are read now or gone', () => {
    expectNoStaleEntries(unread, allowed, 'tests/unit/css-unread-properties.test.js', 'allow list');
  });

  it('has a colour for every comparison graph series slot in both themes', () => {
    // The graphs read var(--chart-series-N), which is now the only copy of the palette.
    const css = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');
    for (let slot = 1; slot <= MAX_COMPARISON_GRAPH_SERIES; slot += 1) {
      const declarations = css.match(new RegExp(`--chart-series-${slot}:\\s*#[0-9a-f]{6};`, 'gi'));
      expect({ slot, themes: declarations?.length }).toEqual({ slot, themes: 2 });
    }
  });
});

describe('unread definition scanner', () => {
  it('reports a declaration nothing reads, and a renderer write nothing reads', () => {
    const scan = scanOf({
      'styles.css': ':root { --used: 1; --orphan: 2; } a { margin: var(--used); }',
      'src/theme.js': "root.style.setProperty('--written', '1');",
    });
    expect(listUnreadDefinitions(scan)).toEqual(['--orphan', '--written']);
  });

  it('counts a read through an interpolated name', () => {
    const scan = scanOf({
      'styles.css': ':root { --series-1: red; --series-2: blue; }',
      'src/graph.js': 'line.setAttribute("stroke", `var(--series-${slot})`);',
    });
    expect(listUnreadDefinitions(scan)).toEqual([]);
  });

  it('ignores prose in markup and the flags main-process modules pass to programs', () => {
    const scan = scanOf({
      'index.html': '<p>Bind a key to run ha-desktop-widget --toggle.</p>',
      'src/launcher.cjs': "spawn(binary, ['--no-sandbox']);",
    });
    expect(listUnreadDefinitions(scan)).toEqual([]);
  });
});
