const fs = require('fs');
const path = require('path');

const enCatalog = require('../../locales/en.json');
const allowlist = require('../fixtures/i18n-guardrail-allowlist.json');

function collectTranslateKeys() {
  const files = ['renderer.js', 'src/ui.js', 'src/ui-utils.js', 'src/settings.js', 'src/alerts.js', 'src/hotkeys.js', 'src/camera.js', 'main.js'];
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
  const targets = ['index.html', 'main.js', 'renderer.js', ...fs.readdirSync(path.resolve(__dirname, '../../src')).filter((file) => file.endsWith('.js')).map((file) => `src/${file}`)];
  const violations = [];

  targets.forEach((file) => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../', file), 'utf8');
    const lines = text.split(/\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (/showToast\(\s*['"`]/.test(line)) violations.push(`${file}|showToast|${trimmed}`);
      if (/showConfirm\(\s*['"`]/.test(line)) violations.push(`${file}|showConfirm|${trimmed}`);
      if (/new Notification\(\s*['"`]/.test(line)) violations.push(`${file}|notification|${trimmed}`);
      if (file === 'main.js' && /label:\s*['"`]/.test(line)) violations.push(`${file}|menu|${trimmed}`);
      if (file === 'main.js' && /title:\s*['"`]/.test(line)) violations.push(`${file}|dialog|${trimmed}`);
      if (file === 'index.html' && /title="[^"]+[A-Za-z][^"]*"/.test(line) && !/data-i18n-title=/.test(line)) violations.push(`${file}|html-title|${trimmed}`);
      if (file === 'index.html' && /aria-label="[^"]+[A-Za-z][^"]*"/.test(line) && !/data-i18n-aria-label=/.test(line)) violations.push(`${file}|html-aria|${trimmed}`);
      if (file === 'index.html' && /placeholder="[^"]+[A-Za-z][^"]*"/.test(line) && !/data-i18n-placeholder=/.test(line)) violations.push(`${file}|html-placeholder|${trimmed}`);
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
