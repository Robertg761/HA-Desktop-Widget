/**
 * A small CSS cascade over the app's real stylesheets for jsdom tests.
 *
 * jsdom's getComputedStyle ignores selector specificity (the last matching rule wins), so it
 * cannot catch a rule that loses to a more specific one. This resolves the value a property gets
 * on an element using specificity, !important, source order, simple width/height media queries,
 * inheritance for colours and custom properties, and var() fallbacks. Interaction states are
 * modelled with attributes: give the element `data-focus-visible`, `data-focus` or `data-hover`.
 */
const fs = require('fs');
const path = require('path');

const STYLESHEETS = ['styles.css', 'dashboard-workflows.css'];
const STATE_PSEUDO_CLASSES = { 'focus-visible': 'focus-visible', focus: 'focus', hover: 'hover' };
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
const INHERITED_PROPERTIES = new Set(['color', 'font-size', 'line-height']);

function loadAppStylesheets(document = global.document) {
  const css = STYLESHEETS.map((file) =>
    fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')
  ).join('\n');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

function findClosing(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    if (text[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return text.length - 1;
}

function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(' || char === '[') depth += 1;
    if (char === ')' || char === ']') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function readIdent(text, index) {
  let end = index;
  while (end < text.length && /[\w-]/.test(text[end])) end += 1;
  return end;
}

function addSpecificity(left, right) {
  return left.map((value, index) => value + right[index]);
}

function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function maxSpecificity(selectorList) {
  return splitTopLevel(selectorList)
    .map(specificity)
    .reduce((best, value) => (compareSpecificity(value, best) > 0 ? value : best), [0, 0, 0]);
}

/** Selectors Level 4 specificity as [ids, classes/attributes/pseudo-classes, types]. */
function specificity(selector) {
  let result = [0, 0, 0];
  let index = 0;
  while (index < selector.length) {
    const char = selector[index];
    if (char === '#') {
      result = addSpecificity(result, [1, 0, 0]);
      index = readIdent(selector, index + 1);
    } else if (char === '.') {
      result = addSpecificity(result, [0, 1, 0]);
      index = readIdent(selector, index + 1);
    } else if (char === '[') {
      result = addSpecificity(result, [0, 1, 0]);
      index = selector.indexOf(']', index) + 1;
    } else if (char === ':') {
      const isElement = selector[index + 1] === ':';
      const nameStart = index + (isElement ? 2 : 1);
      const nameEnd = readIdent(selector, nameStart);
      const name = selector.slice(nameStart, nameEnd);
      let next = nameEnd;
      let argument = null;
      if (selector[nameEnd] === '(') {
        const close = findClosing(selector, nameEnd);
        argument = selector.slice(nameEnd + 1, close);
        next = close + 1;
      }
      if (isElement || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        result = addSpecificity(result, [0, 0, 1]);
      } else if (['is', 'not', 'has'].includes(name)) {
        result = addSpecificity(result, maxSpecificity(argument || ''));
      } else if (name !== 'where') {
        result = addSpecificity(result, [0, 1, 0]);
      }
      index = next;
    } else if (/[a-zA-Z_-]/.test(char)) {
      result = addSpecificity(result, [0, 0, 1]);
      index = readIdent(selector, index);
    } else {
      index += 1;
    }
  }
  return result;
}

/** Rewrites a selector so jsdom can match it, or returns null when it targets a pseudo-element. */
function toMatchableSelector(selector) {
  if (/::|:(before|after|first-line|first-letter)\b/.test(selector)) return null;
  return selector
    .replace(/:where\(/g, ':is(')
    .replace(/:(focus-visible|focus|hover)(?![\w-])/g, (match, name) => {
      return `[data-${STATE_PSEUDO_CLASSES[name]}]`;
    });
}

function selectorMatches(element, selector) {
  const matchable = toMatchableSelector(selector);
  if (!matchable) return false;
  try {
    return element.matches(matchable);
  } catch {
    // Selectors jsdom cannot parse (e.g. vendor pseudo-classes) never match in the app's tests.
    return false;
  }
}

function mediaMatches(mediaText, viewport) {
  return splitTopLevel(mediaText).some((query) =>
    query.split(/\band\b/).every((condition) => {
      const feature = condition.trim().replace(/^\(|\)$/g, '');
      let match = feature.match(/^(max|min)-(width|height):\s*(\d+)px$/);
      if (match) {
        const [, bound, axis, size] = match;
        return bound === 'max' ? viewport[axis] <= Number(size) : viewport[axis] >= Number(size);
      }
      match = feature.match(/^(width|height)\s*(<=|>=)\s*(\d+)px$/);
      if (match) {
        const [, axis, operator, size] = match;
        return operator === '<=' ? viewport[axis] <= Number(size) : viewport[axis] >= Number(size);
      }
      return false;
    })
  );
}

function collectDeclarations(document, property, viewport) {
  const declarations = [];
  let order = 0;
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.media) {
        if (mediaMatches(rule.media.mediaText, viewport)) visit(rule.cssRules);
        continue;
      }
      if (rule.cssRules && rule.conditionText !== undefined) {
        visit(rule.cssRules);
        continue;
      }
      order += 1;
      if (!rule.style || !rule.selectorText) continue;
      const value = rule.style.getPropertyValue(property);
      if (!value) continue;
      declarations.push({
        selectorText: rule.selectorText,
        value: value.trim(),
        important: rule.style.getPropertyPriority(property) === 'important',
        order,
      });
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules);
  return declarations;
}

/**
 * The winning declaration for `property` on `element` (before var() substitution), or null.
 * Returns `{ value, selector, specificity, important }`.
 */
function cascadedDeclaration(element, property, { viewport = { width: 500, height: 600 } } = {}) {
  let winner = null;
  for (const declaration of collectDeclarations(element.ownerDocument, property, viewport)) {
    for (const selector of splitTopLevel(declaration.selectorText)) {
      if (!selectorMatches(element, selector)) continue;
      const candidate = {
        value: declaration.value,
        selector,
        specificity: specificity(selector),
        important: declaration.important,
        order: declaration.order,
      };
      const beats =
        !winner ||
        (candidate.important && !winner.important) ||
        (candidate.important === winner.important &&
          (compareSpecificity(candidate.specificity, winner.specificity) > 0 ||
            (compareSpecificity(candidate.specificity, winner.specificity) === 0 &&
              candidate.order >= winner.order)));
      if (beats) winner = candidate;
    }
  }
  return winner;
}

function substituteVariables(element, value, options, depth = 0) {
  if (depth > 20 || !value.includes('var(')) return value;
  const start = value.indexOf('var(');
  const close = findClosing(value, start + 3);
  const [name, ...fallback] = splitTopLevel(value.slice(start + 4, close));
  const resolved = resolvedValue(element, name, options) ?? fallback.join(', ');
  return substituteVariables(
    element,
    value.slice(0, start) + resolved + value.slice(close + 1),
    options,
    depth + 1
  );
}

/** The cascaded value with var() references resolved and inherited properties walked up. */
function resolvedValue(element, property, options = {}) {
  const inherits = property.startsWith('--') || INHERITED_PROPERTIES.has(property);
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    const declaration = cascadedDeclaration(node, property, options);
    if (declaration && declaration.value !== 'inherit') {
      return substituteVariables(node, declaration.value, options);
    }
    if (!declaration && !inherits) return null;
  }
  return null;
}

function parseColor(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((digit) => digit + digit)
            .join('')
        : hex[1];
    return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16)).concat(1);
  }
  const functional = text.match(/^rgba?\(([^)]+)\)$/i);
  if (!functional) return null;
  const parts = functional[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function blend(foreground, background) {
  const [r, g, b, alpha] = foreground;
  return [
    r * alpha + background[0] * (1 - alpha),
    g * alpha + background[1] * (1 - alpha),
    b * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast of a (possibly translucent) foreground over an opaque background colour. */
function contrastRatio(foreground, background) {
  const bg = parseColor(background);
  const fg = blend(parseColor(foreground), bg);
  const [light, dark] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

module.exports = {
  cascadedDeclaration,
  compareSpecificity,
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
  specificity,
  splitTopLevel,
};
