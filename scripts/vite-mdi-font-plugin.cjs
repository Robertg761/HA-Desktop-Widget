// Electron and the supported HA browsers use WOFF2. Keep the full icon catalog, but avoid
// emitting three legacy font files that add 3.2 MB to the companion panel download.
function modernMdiFontPlugin() {
  return {
    name: 'mdi-woff2-only',
    enforce: 'pre',
    transform(code, id) {
      if (
        !id.replace(/\\/g, '/').split('?')[0].endsWith('/@mdi/font/css/materialdesignicons.min.css')
      )
        return null;
      const fontFace = code.match(/@font-face\s*\{[^}]*\}/)?.[0];
      const woff2 = fontFace?.match(/url\([^)]*\.woff2[^)]*\)\s*format\(["']woff2["']\)/)?.[0];
      if (!woff2) throw new Error('The MDI font stylesheet no longer exposes a WOFF2 source.');
      const modernFace = fontFace.replace(/src\s*:[^;]+;/g, '').replace('}', `;src:${woff2};}`);
      return { code: code.replace(fontFace, modernFace), map: null };
    },
  };
}

module.exports = modernMdiFontPlugin;
