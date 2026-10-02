const {
  WINDOWS_ACRYLIC_MIN_BUILD,
  getWindowsBuildNumber,
  isGlassAvailable,
  resolveGlassMode,
  supportsNativeGlass,
} = require('../../src/window-glass.cjs');

describe('getWindowsBuildNumber', () => {
  it('reads the build out of an os.release() string', () => {
    expect(getWindowsBuildNumber('10.0.22631')).toBe(22631);
    expect(getWindowsBuildNumber('10.0.19045')).toBe(19045);
  });

  it('returns null when the string carries no build', () => {
    expect(getWindowsBuildNumber('')).toBeNull();
    expect(getWindowsBuildNumber(undefined)).toBeNull();
    expect(getWindowsBuildNumber('10.0')).toBeNull();
    expect(getWindowsBuildNumber('10.0.unknown')).toBeNull();
  });
});

describe('supportsNativeGlass', () => {
  it('draws acrylic on Windows 11 22H2 and later', () => {
    expect(WINDOWS_ACRYLIC_MIN_BUILD).toBe(22621);
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.22621' })).toBe(true); // 22H2
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.22631' })).toBe(true); // 23H2
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.26100' })).toBe(true); // 24H2
  });

  it('withholds it on Windows 11 before 22H2', () => {
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.22620' })).toBe(false);
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.22000' })).toBe(false); // 21H2
  });

  it('withholds it on Windows 10 and older', () => {
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.19045' })).toBe(false); // 22H2
    expect(supportsNativeGlass({ platform: 'win32', release: '10.0.10240' })).toBe(false);
    expect(supportsNativeGlass({ platform: 'win32', release: '6.1.7601' })).toBe(false);
  });

  it('keeps the existing look when a Windows release string cannot be read', () => {
    expect(supportsNativeGlass({ platform: 'win32', release: '' })).toBe(true);
    expect(supportsNativeGlass({ platform: 'win32' })).toBe(true);
    expect(supportsNativeGlass({ platform: 'win32', release: 'unexpected' })).toBe(true);
  });

  it('never withholds it from macOS or Linux, whatever the release string says', () => {
    expect(supportsNativeGlass({ platform: 'darwin', release: '24.6.0' })).toBe(true);
    expect(supportsNativeGlass({ platform: 'darwin', release: '10.0.19045' })).toBe(true);
    expect(supportsNativeGlass({ platform: 'linux', release: '6.8.0-45-generic' })).toBe(true);
    expect(supportsNativeGlass({ platform: 'linux', release: '10.0.19045' })).toBe(true);
  });
});

describe('isGlassAvailable', () => {
  it('is withheld only by an explicit false on Windows', () => {
    expect(isGlassAvailable({ platform: 'win32', nativeGlassSupported: false })).toBe(false);
    expect(isGlassAvailable({ platform: 'win32', nativeGlassSupported: true })).toBe(true);
    expect(isGlassAvailable({ platform: 'win32' })).toBe(true);
    expect(isGlassAvailable({ platform: 'win32', nativeGlassSupported: undefined })).toBe(true);
    expect(isGlassAvailable()).toBe(true);
  });

  it('ignores the capability off Windows', () => {
    ['darwin', 'linux', null].forEach((platform) => {
      expect(isGlassAvailable({ platform, nativeGlassSupported: false })).toBe(true);
    });
  });
});

describe('resolveGlassMode', () => {
  const release = (build) => `10.0.${build}`;
  const modeFor = (platform, frostedGlass, build) =>
    resolveGlassMode({
      platform,
      frostedGlass,
      nativeGlassSupported: supportsNativeGlass({ platform, release: release(build) }),
    });

  it('keeps native glass on Windows 11 22H2 and later', () => {
    expect(modeFor('win32', true, 22631)).toBe('native');
    expect(modeFor('win32', true, 22621)).toBe('native');
    expect(modeFor('win32', false, 22631)).toBe('off');
  });

  it('draws the solid panel on Windows 10 even with Frosted glass saved on', () => {
    expect(modeFor('win32', true, 19045)).toBe('off');
    expect(modeFor('win32', false, 19045)).toBe('off');
  });

  it('draws the solid panel on Windows 11 before 22H2', () => {
    expect(modeFor('win32', true, 22000)).toBe('off');
  });

  it('leaves macOS on native glass and Linux on software glass', () => {
    expect(modeFor('darwin', true, 19045)).toBe('native');
    expect(modeFor('darwin', false, 19045)).toBe('off');
    expect(modeFor('linux', true, 19045)).toBe('software');
    expect(modeFor('linux', false, 19045)).toBe('off');
  });

  it('keeps the existing look when the platform or capability is unknown', () => {
    expect(resolveGlassMode({ platform: 'win32', frostedGlass: true })).toBe('native');
    expect(resolveGlassMode({ platform: null, frostedGlass: true })).toBe('software');
    expect(resolveGlassMode({})).toBe('off');
    expect(resolveGlassMode()).toBe('off');
  });
});
