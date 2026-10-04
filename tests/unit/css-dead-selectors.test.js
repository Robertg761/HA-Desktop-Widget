/**
 * @jest-environment node
 */

// A stylesheet rule written for a class or id that nothing produces is dead weight, and worse, it
// hides the rules that are live (the 4.0 audit found several findings that existed only because a
// shadowed legacy rule was read as the live one). This fails when a selector in the app's
// stylesheets needs a class or an id that no markup or script names.

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const ROOT = path.resolve(__dirname, '../..');
const STYLESHEETS = ['styles.css', 'dashboard-workflows.css'];
const SOURCE_DIRS = ['src', 'packages'];
const SOURCE_FILES = ['index.html', 'renderer.js', 'preload.js', 'main.js'];

// Names a library puts on the DOM, or a rule written ahead of the markup that will use it.
const PRODUCED_ELSEWHERE = {
  // SortableJS gives the clone it drags on touch and pen its default fallbackClass.
  'sortable-fallback': 'SortableJS default',
};

// The classes ('.') and ids ('#') a selector needs its element to carry. A name inside :not(),
// :is() or :where() does not need its element to exist, and a name inside an attribute selector or
// a string is a value, not a name. This reads a selector as postcss hands it over (one selector,
// no commas at the top level) without a selector parser, which only stylelint brings in.
function classAndIdNames(selector) {
  const names = [];
  // Whether each parenthesis opened so far is one of the three that make its names optional.
  const optional = [];
  let ignoredDepth = 0;
  let inAttribute = false;
  for (let index = 0; index < selector.length; index++) {
    const char = selector[index];
    if (char === '\\') {
      index++;
    } else if (char === '"' || char === "'") {
      index = selector.indexOf(char, index + 1);
      if (index < 0) break;
    } else if (inAttribute) {
      inAttribute = char !== ']';
    } else if (char === '[') {
      inAttribute = true;
    } else if (char === '(') {
      const ignored = /:(not|is|where)$/.test(selector.slice(0, index));
      optional.push(ignored);
      if (ignored) ignoredDepth++;
    } else if (char === ')') {
      if (optional.pop()) ignoredDepth--;
    } else if ((char === '.' || char === '#') && !ignoredDepth) {
      const name = /^(?:[\w-]|\\.)+/.exec(selector.slice(index + 1));
      if (name) names.push({ type: char, name: name[0].replace(/\\(.)/g, '$1') });
    }
  }
  return names;
}

function listSources(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'dist-renderer', 'dist-preload'].includes(entry.name)) {
        found.push(...listSources(full));
      }
    } else if (/\.(js|cjs|mjs)$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function readSources() {
  const files = [
    ...SOURCE_FILES.map((file) => path.join(ROOT, file)),
    ...SOURCE_DIRS.flatMap((dir) => listSources(path.join(ROOT, dir))),
  ];
  return files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}

describe('stylesheet selectors', () => {
  const sources = readSources();
  // A name built at run time ('desktop-pin-' + family, `weather-${state}`) cannot be searched for
  // whole, so a class that starts or ends like one is taken as produced.
  const prefixes = new Set(
    [...sources.matchAll(/([\w-]+-)\$\{/g), ...sources.matchAll(/['"`]([\w-]+-)['"`]\s*\+/g)].map(
      (match) => match[1]
    )
  );
  const suffixes = new Set(
    [
      ...sources.matchAll(/\$\{[^}]*\}(-[\w-]+)/g),
      ...sources.matchAll(/\+\s*['"`](-[\w-]+)['"`]/g),
    ].map((match) => match[1])
  );

  function isProduced(name) {
    if (PRODUCED_ELSEWHERE[name]) return true;
    const pattern = new RegExp(`(?<![\\w-])${name.replace(/-/g, '\\-')}(?![\\w-])`);
    if (pattern.test(sources)) return true;
    return (
      [...prefixes].some((prefix) => name.startsWith(prefix)) ||
      [...suffixes].some((suffix) => name.endsWith(suffix))
    );
  }

  function unproducedNames(selector) {
    return classAndIdNames(selector)
      .filter(({ name }) => !isProduced(name))
      .map(({ type, name }) => `${type}${name}`);
  }

  it.each(STYLESHEETS)('%s has no selector for a class or id nothing produces', (file) => {
    const root = postcss.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const dead = [];
    root.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
      for (const selector of rule.selectors) {
        const names = unproducedNames(selector);
        if (names.length)
          dead.push(
            `${file}:${rule.source.start.line}  ${selector.replace(/\s+/g, ' ')}  (${names.join(', ')})`
          );
      }
    });
    expect(dead).toEqual([]);
  });

  it('reads the names a selector needs and leaves out the optional ones and the values', () => {
    const read = (selector) => classAndIdNames(selector).map(({ type, name }) => `${type}${name}`);
    expect(read('.a:not(.b) .c[data-x=".d"] #e > .f:is(.g, .h)')).toEqual(['.a', '.c', '#e', '.f']);
    expect(read('.a:not(:is(.b)) .c:has(.d)')).toEqual(['.a', '.c', '.d']);
    expect(read('[data-x="]"] .k, .l\\:m')).toEqual(['.k', '.l:m']);
  });

  it('knows a name that is produced from one that is not', () => {
    expect(isProduced('widget-header')).toBe(true);
    expect(isProduced('no-such-class-anywhere-in-the-app')).toBe(false);
  });
});
