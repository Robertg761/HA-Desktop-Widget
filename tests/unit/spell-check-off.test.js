/** @jest-environment node */
// Spell-check is off on purpose (src/spell-checker.cjs). These tests read the main process source,
// so a new window, or a change to an existing one, cannot turn it back on without failing here.
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const { turnOffSpellChecker } = require('../../src/spell-checker.cjs');

const root = path.resolve(__dirname, '../..');

// Everything the main process runs: main.js and the CommonJS modules in src/ (the .js files there
// are renderer code, which cannot open a window).
const MAIN_PROCESS_FILES = [
  'main.js',
  ...fs
    .readdirSync(path.join(root, 'src'))
    .filter((file) => file.endsWith('.cjs'))
    .map((file) => `src/${file}`),
];

function parseFile(file) {
  return parse(fs.readFileSync(path.join(root, file), 'utf8'), {
    sourceType: 'unambiguous',
    errorRecovery: false,
  });
}

// Calls visit(node, ancestors) for every node, in source order.
function walk(node, visit, ancestors = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit, next));
    else if (value && typeof value.type === 'string') walk(value, visit, next);
  }
}

const FUNCTION_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
]);

function keyName(property) {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (property.key.type === 'StringLiteral') return property.key.value;
  return null;
}

// The property a MemberExpression reads: `b` in a.b and a['b'].
function memberName(member) {
  return member.computed ? member.property.value : member.property.name;
}

function functionName(fn) {
  return fn?.id?.name || (fn?.key && keyName(fn)) || '(anonymous)';
}

function isBrowserWindow(callee) {
  if (callee.type === 'Identifier') return callee.name === 'BrowserWindow';
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'BrowserWindow'
  );
}

// The object literal a `new BrowserWindow(...)` is given: written in place, or a const declared in
// the same function. Anything else (a factory's return value, a parameter) cannot be read here.
function resolveOptions(argument, enclosingFunction) {
  if (argument?.type === 'ObjectExpression') return argument;
  if (argument?.type !== 'Identifier' || !enclosingFunction) return null;
  let found = null;
  walk(enclosingFunction.body, (node) => {
    if (
      !found &&
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === argument.name &&
      node.init?.type === 'ObjectExpression'
    ) {
      found = node.init;
    }
  });
  return found;
}

// What is wrong with a window's options as far as spell-check goes, or '' when nothing is.
function spellcheckProblem(options) {
  if (!options) return 'its options are not an object literal this test can read';
  const properties = options.properties;
  const index = properties.findIndex(
    (property) => property.type === 'ObjectProperty' && keyName(property) === 'webPreferences'
  );
  if (index === -1) return 'it has no webPreferences';
  if (properties.slice(index + 1).some((property) => property.type === 'SpreadElement')) {
    return 'a spread after webPreferences could replace it';
  }
  const webPreferences = properties[index].value;
  if (webPreferences.type !== 'ObjectExpression') {
    return 'its webPreferences are not an object literal this test can read';
  }
  const prefs = webPreferences.properties;
  const spellcheckIndex = prefs.findIndex(
    (property) => property.type === 'ObjectProperty' && keyName(property) === 'spellcheck'
  );
  if (spellcheckIndex === -1) return 'its webPreferences leave spellcheck to the default, on';
  const value = prefs[spellcheckIndex].value;
  if (value.type !== 'BooleanLiteral' || value.value !== false) {
    return 'its webPreferences set spellcheck to something other than false';
  }
  if (prefs.slice(spellcheckIndex + 1).some((property) => property.type === 'SpreadElement')) {
    return 'a spread after spellcheck: false could turn it back on';
  }
  return '';
}

function collectWindowConstructions() {
  const windows = [];
  for (const file of MAIN_PROCESS_FILES) {
    walk(parseFile(file), (node, ancestors) => {
      if (node.type !== 'NewExpression' || !isBrowserWindow(node.callee)) return;
      const enclosingFunction = [...ancestors].reverse().find((n) => FUNCTION_TYPES.has(n.type));
      const options = resolveOptions(node.arguments[0], enclosingFunction);
      windows.push({
        where: `${file}:${node.loc.start.line} (${functionName(enclosingFunction)})`,
        problem: spellcheckProblem(options),
      });
    });
  }
  return windows;
}

describe('spell-check stays off in every window', () => {
  const windows = collectWindowConstructions();

  it('finds the windows the app opens', () => {
    // The main window and the desktop pins. If this fails because a window was added or moved,
    // the next test covers it as long as it is found here.
    const owners = windows.map((window) => window.where.replace(/:\d+ /, ' '));
    expect(owners).toEqual(
      expect.arrayContaining(['main.js (createWindow)', 'main.js (createDesktopPinWindow)'])
    );
  });

  it('gives every BrowserWindow spellcheck: false in its webPreferences', () => {
    const failures = windows
      .filter((window) => window.problem)
      .map((window) => `${window.where}: ${window.problem}`);
    expect(failures).toEqual([]);
  });

  it('never assigns webPreferences, spellcheck or spellCheckerEnabled', () => {
    // windowOptions.webPreferences = {...}, options.webPreferences.spellcheck = true and
    // Object.assign(options.webPreferences, { spellcheck: true }) would undo the literal the
    // previous test reads. session.defaultSession.spellCheckerEnabled = true would undo
    // turnOffSpellChecker.
    const NAMES = new Set(['webPreferences', 'spellcheck', 'spellCheckerEnabled']);
    const isObjectAssign = (node) =>
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === 'Object' &&
      memberName(node.callee) === 'assign';
    const assignments = [];
    for (const file of MAIN_PROCESS_FILES) {
      walk(parseFile(file), (node) => {
        if (
          node.type === 'AssignmentExpression' &&
          node.left.type === 'MemberExpression' &&
          NAMES.has(memberName(node.left))
        ) {
          assignments.push(`${file}:${node.loc.start.line}`);
        }
        if (isObjectAssign(node)) {
          const [target, ...sources] = node.arguments;
          const intoNamed = target?.type === 'MemberExpression' && NAMES.has(memberName(target));
          const withNamedKey = sources.some(
            (source) =>
              source.type === 'ObjectExpression' &&
              source.properties.some(
                (property) => property.type === 'ObjectProperty' && NAMES.has(keyName(property))
              )
          );
          if (intoNamed || withNamedKey) {
            assignments.push(`${file}:${node.loc.start.line} Object.assign`);
          }
        }
      });
    }
    expect(assignments).toEqual([]);
  });

  it('never turns the session spell checker back on or offers its menu items', () => {
    const uses = [];
    for (const file of MAIN_PROCESS_FILES) {
      walk(parseFile(file), (node) => {
        if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
          const name = node.callee.property.name;
          const [argument] = node.arguments;
          const turnsOn =
            (name === 'setSpellCheckerEnabled' &&
              !(argument?.type === 'BooleanLiteral' && argument.value === false)) ||
            (name === 'setSpellCheckerLanguages' &&
              !(argument?.type === 'ArrayExpression' && argument.elements.length === 0)) ||
            name === 'replaceMisspelling' ||
            name === 'addWordToSpellCheckerDictionary';
          if (turnsOn) uses.push(`${file}:${node.loc.start.line} ${name}`);
        }
        if (node.type === 'StringLiteral' && node.value === 'toggleSpellChecker') {
          uses.push(`${file}:${node.loc.start.line} toggleSpellChecker`);
        }
      });
    }
    expect(uses).toEqual([]);
  });
});

describe('the session spell checker', () => {
  it('is turned off and left with no languages, so no dictionary downloads', () => {
    const calls = [];
    turnOffSpellChecker({
      setSpellCheckerEnabled: (...args) => calls.push(['setSpellCheckerEnabled', ...args]),
      setSpellCheckerLanguages: (...args) => calls.push(['setSpellCheckerLanguages', ...args]),
    });
    expect(calls).toEqual([
      ['setSpellCheckerEnabled', false],
      ['setSpellCheckerLanguages', []],
    ]);
  });

  it('is turned off in the ready handler before anything else uses the session', () => {
    // Chromium starts the download once the first use of the session returns to the event loop.
    // So the call has to come before anything that uses the session, and it has to run in the
    // handler's own turn: put off by a timer, a callback or an await, it comes too late, because
    // the code after it uses the session first.
    let handler = null;
    walk(parseFile('main.js'), (node) => {
      if (
        !handler &&
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property.name === 'then' &&
        node.callee.object.type === 'CallExpression' &&
        node.callee.object.callee.property?.name === 'whenReady'
      ) {
        handler = node.arguments[0];
      }
    });
    expect(handler).not.toBeNull();
    expect(handler.async).toBe(false);

    // Electron modules that use the default session: session itself, net and protocol.
    const SESSION_MODULES = new Set(['session', 'net', 'protocol']);
    // The call runs in the handler's own turn, and at every start, only as a statement of the
    // handler's body or of a try or finally block in it. Anything else around it, such as a
    // function, an await or an if, can put it off or skip it.
    const RUNS_IN_HANDLER_TURN = new Set(['BlockStatement', 'TryStatement', 'ExpressionStatement']);
    const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
    const text = (node) => source.slice(node.start, node.end);
    const isTurnOffCall = (node) =>
      node?.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'turnOffSpellChecker';

    const order = [];
    walk(handler.body, (node, ancestors) => {
      const parent = ancestors[ancestors.length - 1];
      if (isTurnOffCall(node)) {
        const heldBackBy = [...ancestors].reverse().find((n) => !RUNS_IN_HANDLER_TURN.has(n.type));
        order.push(heldBackBy ? `${text(node)} inside ${heldBackBy.type}` : text(node));
      }
      // session.defaultSession, net.fetch or protocol.handle, or a window's webContents.session.
      const usesSession =
        node.type === 'MemberExpression' &&
        ((node.object.type === 'Identifier' && SESSION_MODULES.has(node.object.name)) ||
          memberName(node) === 'session');
      // turnOffSpellChecker's own argument is already part of its entry.
      if (usesSession && !(isTurnOffCall(parent) && parent.arguments[0] === node)) {
        order.push(text(node));
      }
      if (node.type === 'NewExpression' && isBrowserWindow(node.callee)) {
        order.push('new BrowserWindow()');
      }
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        /^create\w*Window$/.test(node.callee.name)
      ) {
        order.push(`${node.callee.name}()`);
      }
    });
    expect(order[0]).toBe('turnOffSpellChecker(session.defaultSession)');
  });
});
