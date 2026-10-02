/**
 * Finds the CSS custom properties the app defines and the ones it reads.
 *
 * A var(--x) without a fallback whose property nobody defines is invalid at computed-value time,
 * so the declaration silently falls back to inherited or initial: a text colour turns full-bright,
 * a border shorthand vanishes. Stylelint cannot see this across files, so the tests scan for it.
 *
 * Definitions come from `--x:` declarations in the stylesheets and index.html, and from every
 * quoted custom property name in the renderer's JavaScript (setProperty('--x', ...), style
 * templates, name tables). Reads come from var(--x) in the same places, including the inline
 * styles JavaScript writes. A name that is built at run time (var(--chart-series-${n}),
 * setProperty(`--glow-${x}`)) counts as a prefix.
 *
 * The JavaScript rule is deliberately loose: a quoted `--word` that is not a custom property at all
 * (a command-line flag) also counts as a definition. That can only hide a missing definition for a
 * property that happens to share its name, and the alternative is a list of every helper that
 * forwards a name to setProperty.
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.resolve(__dirname, '../..');
const STYLE_FILES = ['styles.css', 'dashboard-workflows.css', 'index.html'];
const SCRIPT_ENTRIES = ['renderer.js', 'src', 'packages/widget-renderer/src'];
// Marks where a template literal interpolates, so a name cut off by `${...}` reads as a prefix.
const INTERPOLATION = '\u0000';

const VAR_READ = new RegExp(`var\\(\\s*(--[\\w-]+)(${INTERPOLATION})?\\s*(,)?`, 'g');
const NAME = new RegExp(`(?<![\\w-])(--[A-Za-z][\\w-]*)(${INTERPOLATION})?`, 'g');

function toPosix(file) {
  return file.split(path.sep).join('/');
}

function listScripts(root, entry) {
  const absolute = path.join(root, entry);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [entry];
  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((item) => {
      const relative = `${entry}/${item.name}`;
      if (item.isDirectory()) return listScripts(root, relative);
      return /\.(?:c|m)?js$/.test(item.name) ? [relative] : [];
    })
    .sort();
}

/** Record the reads and definitions in a piece of CSS-like text (a stylesheet or index.html). */
function scanText(text, file, scan) {
  for (const match of text.matchAll(VAR_READ)) {
    scan.reads.push({ file, name: match[1], prefix: !!match[2], fallback: !!match[3] });
  }
  const withoutReads = text.replace(/var\(\s*--[\w-]+/g, 'var(');
  for (const match of withoutReads.matchAll(NAME)) {
    (match[2] ? scan.prefixes : scan.definitions).add(match[1]);
  }
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/** Scan JavaScript source. Only string and template literals count, so comments never do. */
function scanScript(source, file, scan) {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: ['optionalChaining', 'nullishCoalescingOperator'],
  });
  walk(ast, (node) => {
    if (node.type === 'StringLiteral') scanText(node.value, file, scan);
    if (node.type === 'TemplateLiteral') {
      scanText(
        node.quasis.map((quasi) => quasi.value.cooked ?? '').join(INTERPOLATION),
        file,
        scan
      );
    }
  });
}

function scanCustomProperties(root = ROOT) {
  const scan = { definitions: new Set(), prefixes: new Set(), reads: [] };
  for (const file of STYLE_FILES) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    // Comments often name the very property they explain; they define nothing.
    scanText(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, ''), file, scan);
  }
  for (const file of SCRIPT_ENTRIES.flatMap((entry) => listScripts(root, entry))) {
    scanScript(fs.readFileSync(path.join(root, file), 'utf8'), toPosix(file), scan);
  }
  return scan;
}

function isDefined(scan, read) {
  if (read.prefix) {
    return (
      [...scan.definitions].some((name) => name.startsWith(read.name)) ||
      [...scan.prefixes].some(
        (prefix) => prefix.startsWith(read.name) || read.name.startsWith(prefix)
      )
    );
  }
  return (
    scan.definitions.has(read.name) ||
    [...scan.prefixes].some((prefix) => read.name.startsWith(prefix))
  );
}

/**
 * How many var() reads have no fallback and no definition, counted per `file|--name` and sorted by
 * that key. The count lets a ratchet catch one more read of a property that is already known to
 * be undefined, which a bare list of names cannot.
 */
function countUndefinedReads(scan) {
  const counts = new Map();
  for (const read of scan.reads) {
    if (read.fallback || isDefined(scan, read)) continue;
    const key = `${read.file}|${read.name}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.keys()].sort().map((key) => [key, counts.get(key)]));
}

module.exports = { countUndefinedReads, scanCustomProperties, scanScript, scanText };
