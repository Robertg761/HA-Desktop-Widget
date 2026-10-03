const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const page = new DOMParser().parseFromString(html, 'text/html');
const rowOf = (selector) => page.querySelector(selector).closest('.setting-row, .settings-group');

describe('the Readable preset row in Settings', () => {
  it('explains the preset and ties the explanation to its switch', () => {
    const preset = page.getElementById('readable-preset');
    const help = page.getElementById(preset.getAttribute('aria-describedby'));
    expect(help.classList.contains('form-help')).toBe(true);
    expect(help.dataset.i18n).toBe(help.textContent.replace(/\s+/g, ' ').trim());
    expect(help.textContent).toMatch(/overrides your colors, glass and holiday colors/);
  });

  it('marks the rows the preset replaces, and only those', () => {
    const marked = [...page.querySelectorAll('[data-readable-overrides]')];
    expect(marked).toEqual([
      rowOf('#color-target-select'),
      rowOf('#frosted-glass'),
      rowOf('#opacity-slider'),
      rowOf('#seasonal-colors'),
    ]);
    expect(page.getElementById('readable-preset').closest('[data-readable-overrides]')).toBeNull();
  });
});
