/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const baseline = require('../fixtures/css-undefined-properties-baseline.json');
const { expectNoNewEntries } = require('../helpers/ratchet.js');
const {
  countUndefinedReads,
  scanCustomProperties,
  scanScript,
  scanText,
} = require('../helpers/css-custom-properties.js');

const BASELINE_FILE = 'tests/fixtures/css-undefined-properties-baseline.json';

function scanOf(text, { script = false } = {}) {
  const scan = { definitions: new Set(), prefixes: new Set(), reads: [] };
  (script ? scanScript : scanText)(text, 'sample', scan);
  return scan;
}

describe('undefined custom property ratchet', () => {
  const scan = scanCustomProperties();
  const found = countUndefinedReads(scan);
  const foundKeys = Object.keys(found);
  const known = Object.keys(baseline.entries);

  it('finds the properties the app defines and reads', () => {
    // A scanner that silently matches nothing would pass every other test here.
    expect(scan.definitions.size).toBeGreaterThan(100);
    expect(scan.definitions).toContain('--accent');
    expect(scan.definitions).toContain('--chart-series-1');
    expect(scan.reads.length).toBeGreaterThan(1000);
  });

  it('reads no property that is defined nowhere, apart from the baseline', () => {
    expectNoNewEntries(
      foundKeys,
      known,
      'These var() reads have no fallback and name a custom property that nothing defines, so the ' +
        'declaration is silently dropped. Define the property, add a fallback, or use the token ' +
        `that exists (do not add to ${BASELINE_FILE}):`
    );
  });

  it('does not read a baselined property more often than recorded', () => {
    expectNoNewEntries(
      foundKeys.filter((key) => key in baseline.entries && found[key] > baseline.entries[key]),
      [],
      'These known undefined properties are read more often than the baseline records. Use a ' +
        `token that exists instead of another undefined read (do not raise the count in ${BASELINE_FILE}):`,
      (key) => `${found[key]} reads, was ${baseline.entries[key]}`
    );
  });

  it('keeps the baseline free of reads that were fixed', () => {
    expectNoNewEntries(
      known.filter((key) => (found[key] || 0) < baseline.entries[key]),
      [],
      'These baseline entries have fewer reads than recorded, so the baseline has to shrink. ' +
        `Lower the count in ${BASELINE_FILE}, or delete the entry when it reaches zero:`,
      (key) => `${found[key] || 0} reads, was ${baseline.entries[key]}`
    );
  });

  it('keeps the baseline sorted, with a positive count for every entry', () => {
    expect(known).toEqual([...known].sort());
    for (const count of Object.values(baseline.entries)) {
      expect(Number.isInteger(count) && count > 0).toBe(true);
    }
  });
});

describe('custom property scanner', () => {
  it('reports a read with no fallback and no definition', () => {
    expect(countUndefinedReads(scanOf('a { color: var(--missing); }'))).toEqual({
      'sample|--missing': 1,
    });
  });

  it('accepts a fallback, but still checks a var() used as the fallback', () => {
    expect(countUndefinedReads(scanOf('a { color: var(--optional, red); }'))).toEqual({});
    expect(countUndefinedReads(scanOf('a { color: var(--optional, var(--missing)); }'))).toEqual({
      'sample|--missing': 1,
    });
  });

  it('counts every read of an undefined property, per file', () => {
    const scan = scanOf(
      'a { color: var(--missing); }\nb { color: var(--missing); border-color: var(--missing, red); }'
    );
    scanText('c { color: var(--missing); }', 'other', scan);
    expect(countUndefinedReads(scan)).toEqual({ 'other|--missing': 1, 'sample|--missing': 2 });
  });

  it('accepts a property declared anywhere, including with a line break before the name', () => {
    const css = ':root { --a: 1; }\nb { color: var(\n    --a\n  ); }';
    expect(countUndefinedReads(scanOf(css))).toEqual({});
  });

  it('scans a project root and ignores names that only appear in comments', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'css-properties-test-'));
    try {
      const write = (file, text) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
      };
      write(
        'styles.css',
        '/* --only-in-comment: 1; */\n:root { --real: 1; }\na { color: var(--only-in-comment); }'
      );
      write('dashboard-workflows.css', 'b { color: var(--from-html); }');
      write('index.html', '<!-- --hidden: 1 --><div style="--from-html: 2"></div>');
      write('renderer.js', "// --only-in-js-comment\nel.style.color = 'var(--real)';");
      write(
        'src/nested/deep.js',
        "x.style.setProperty('--deep', '1'); y.style.top = 'var(--deep)';"
      );

      const scan = scanCustomProperties(root);
      expect([...scan.definitions].sort()).toEqual(['--deep', '--from-html', '--real']);
      expect(countUndefinedReads(scan)).toEqual({ 'styles.css|--only-in-comment': 1 });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes JavaScript string and template names as definitions', () => {
    const source = `
      root.style.setProperty('--set-from-js', '1');
      node.style.cssText = \`--templated: \${value}; color: var(--set-from-js)\`;
      el.style.color = 'var(--templated)';
    `;
    expect(countUndefinedReads(scanOf(source, { script: true }))).toEqual({});
  });

  it('reports a var() inside a JavaScript string whose property is undefined', () => {
    const source = "node.style.color = 'var(--nowhere)'; // --nowhere is only named in a comment";
    expect(countUndefinedReads(scanOf(source, { script: true }))).toEqual({
      'sample|--nowhere': 1,
    });
  });

  it('treats a name built with an interpolation as a prefix', () => {
    const source =
      "el.style.fill = `var(--series-${index})`; root.style.setProperty('--series-1', 'red');";
    expect(countUndefinedReads(scanOf(source, { script: true }))).toEqual({});
    const orphan = 'el.style.fill = `var(--series-${index})`;';
    expect(countUndefinedReads(scanOf(orphan, { script: true }))).toEqual({
      'sample|--series-': 1,
    });
    const dynamicDefinition = "set(`--glow-${name}`); el.style.color = 'var(--glow-warm)';";
    expect(countUndefinedReads(scanOf(dynamicDefinition, { script: true }))).toEqual({});
  });
});
