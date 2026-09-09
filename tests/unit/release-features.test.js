const {
  supportsLiveTrayValues,
} = require('../../packages/widget-renderer/src/release-features.cjs');
const { createElectronHost } = require('@hadw/renderer/electron-host.js');

describe('beta-only live tray values', () => {
  it.each([
    ['3.10.0', false],
    ['3.11.0-beta.1', true],
    ['3.10.0-beta.9', true],
    ['3.11.0-beta.1+test', true],
    ['3.11.0-rc.1', false],
    ['', false],
    ['dev', false],
    ['3.10.0+beta.1', false],
  ])('gates main and renderer consistently for %s', (version, expected) => {
    expect(supportsLiveTrayValues(version)).toBe(expected);
    expect(createElectronHost({}, version).capabilities.supportsTray).toBe(expected);
  });
});
