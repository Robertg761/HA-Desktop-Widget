const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const enCatalog = require('../../locales/en.json');
const allowlist = require('../fixtures/i18n-guardrail-allowlist.json');

function collectTranslateKeys() {
  const files = [
    'renderer.js',
    'src/ui.js',
    'src/ui-utils.js',
    'src/settings.js',
    'src/alerts.js',
    'src/hotkeys.js',
    'src/camera.js',
    'main.js',
  ];
  const keyPattern = /\b(?:t|mainT)\(\s*'([^']+)'/g;
  const keys = new Set();

  files.forEach((file) => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8');
    let match;
    while ((match = keyPattern.exec(text))) {
      keys.add(match[1]);
    }
  });

  return [...keys].sort();
}

function collectDataI18nKeys() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const keyPattern = /data-i18n(?:-[a-z-]+)?="([^"]+)"/g;
  const keys = new Set();
  let match;
  while ((match = keyPattern.exec(html))) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

function collectDynamicI18nOwnershipViolations() {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const dynamicIds = [
    'desktop-pin-empty-kicker',
    'desktop-pin-empty-title',
    'desktop-pin-empty-copy',
    'media-tile-title',
    'language-current-summary',
    'language-system-summary',
    'language-fallback-summary',
    'current-version',
    'update-status-text',
    'check-updates-text',
    'install-update-text',
    'confirm-title',
    'confirm-message',
  ];

  return dynamicIds.filter((id) => {
    const pattern = new RegExp(`id="${id}"[^>]*\\sdata-i18n(?:-[a-z-]+)?=`, 'i');
    return pattern.test(html);
  });
}

function collectGuardrailViolations() {
  const targets = [
    'index.html',
    'main.js',
    'renderer.js',
    ...fs
      .readdirSync(path.resolve(__dirname, '../../src'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => `src/${file}`),
  ];
  const violations = [];

  const normalizeSource = (source) => source.replace(/\s+/g, ' ').trim();
  const getNodeSource = (text, node) => normalizeSource(text.slice(node.start, node.end));
  const isLiteralMessageNode = (node) =>
    node?.type === 'StringLiteral' || node?.type === 'TemplateLiteral';
  const getPropertyName = (node) => {
    if (!node || node.computed) return '';
    return node.key?.name || node.key?.value || '';
  };
  const getCalleeName = (node) => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'MemberExpression' && !node.computed) return node.property?.name || '';
    return '';
  };
  const walkAst = (node, visitor) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visitor(node);
    Object.entries(node).forEach(([key, value]) => {
      if (['loc', 'start', 'end', 'extra'].includes(key)) return;
      if (Array.isArray(value)) {
        value.forEach((child) => walkAst(child, visitor));
      } else if (value && typeof value === 'object') {
        walkAst(value, visitor);
      }
    });
  };

  const collectHtmlViolations = (html) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const attributes = [
      ['title', 'data-i18n-title', 'html-title'],
      ['aria-label', 'data-i18n-aria-label', 'html-aria'],
      ['placeholder', 'data-i18n-placeholder', 'html-placeholder'],
    ];

    attributes.forEach(([attribute, translatedAttribute, category]) => {
      document.querySelectorAll(`[${attribute}]`).forEach((element) => {
        const value = element.getAttribute(attribute) || '';
        if (!/[A-Za-z]/.test(value) || element.hasAttribute(translatedAttribute)) return;
        const tag = element.tagName.toLowerCase();
        const identity = element.id
          ? `${tag}#${element.id}`
          : `${tag}.${[...element.classList].join('.') || 'unclassified'}`;
        violations.push(`index.html|${category}|${identity}|${JSON.stringify(value)}`);
      });
    });
  };

  targets.forEach((file) => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8');
    if (file === 'index.html') {
      collectHtmlViolations(text);
      return;
    }

    const ast = parse(text, {
      sourceType: 'unambiguous',
      plugins: ['optionalChaining', 'nullishCoalescingOperator'],
    });
    walkAst(ast, (node) => {
      if (node.type === 'CallExpression') {
        const calleeName = getCalleeName(node.callee);
        if (
          ['showToast', 'showConfirm'].includes(calleeName) &&
          isLiteralMessageNode(node.arguments[0])
        ) {
          violations.push(`${file}|${calleeName}|${getNodeSource(text, node.arguments[0])}`);
        }
      }
      if (
        node.type === 'NewExpression' &&
        getCalleeName(node.callee) === 'Notification' &&
        isLiteralMessageNode(node.arguments[0])
      ) {
        violations.push(`${file}|notification|${getNodeSource(text, node.arguments[0])}`);
      }
      if (file === 'main.js' && node.type === 'ObjectProperty') {
        const propertyName = getPropertyName(node);
        if (['label', 'title'].includes(propertyName) && isLiteralMessageNode(node.value)) {
          const category = propertyName === 'label' ? 'menu' : 'dialog';
          violations.push(`${file}|${category}|${getNodeSource(text, node.value)}`);
        }
      }
    });
  });

  return violations.sort();
}

describe('i18n guardrails', () => {
  it('keeps all translate keys in the English source catalog', () => {
    const missing = collectTranslateKeys().filter((key) => !(key in enCatalog));
    expect(missing).toEqual([]);
  });

  it('keeps all data-i18n keys in the English source catalog', () => {
    const missing = collectDataI18nKeys().filter((key) => !(key in enCatalog));
    expect(missing).toEqual([]);
  });

  it('does not mark renderer-owned live text nodes as static i18n content', () => {
    expect(collectDynamicI18nOwnershipViolations()).toEqual([]);
  });

  it('does not add new unlocalized guardrail violations without updating the allowlist', () => {
    expect(collectGuardrailViolations().sort()).toEqual([...allowlist].sort());
  });
});
