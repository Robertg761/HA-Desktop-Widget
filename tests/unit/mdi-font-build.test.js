const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const modernMdiFontPlugin = require('../../scripts/vite-mdi-font-plugin.cjs');

describe('companion icon font build', () => {
  it('retains the installed icon catalog and its WOFF2 URL without legacy font downloads', () => {
    const file = path.join(
      path.dirname(require.resolve('@mdi/font/package.json')),
      'css/materialdesignicons.min.css'
    );
    const original = fs.readFileSync(file, 'utf8');
    const { code } = modernMdiFontPlugin().transform(original, file);
    expect(() => postcss.parse(code)).not.toThrow();
    expect(code).toContain('materialdesignicons-webfont.woff2');
    expect(code).not.toMatch(/materialdesignicons-webfont\.(?:eot|ttf|woff)(?:\?|"|')/);
    expect(code.slice(code.indexOf('.mdi:'))).toBe(original.slice(original.indexOf('.mdi:')));
  });
  it('leaves unrelated stylesheets alone and fails clearly if the dependency font format changes', () => {
    const plugin = modernMdiFontPlugin();
    expect(plugin.transform('body {color: red}', '/styles.css')).toBeNull();
    expect(() =>
      plugin.transform(
        '@font-face {src:url(x.ttf)}',
        '/node_modules/@mdi/font/css/materialdesignicons.min.css'
      )
    ).toThrow('WOFF2');
  });
});
