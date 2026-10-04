/** @jest-environment node */
const path = require('path');
const { getWindowsTrayIconSize, loadTrayIcon } = require('../../src/tray-icon.cjs');

const ROOT = path.join(path.sep, 'app', 'build');

/** A NativeImage stand-in that records what is asked of it. */
function createFakeNativeImage(files) {
  const images = [];
  function makeImage(label, size) {
    const image = {
      label,
      size,
      representations: [],
      template: false,
      isEmpty: () => false,
      resize: jest.fn(({ width, height, quality }) => {
        const resized = makeImage(`${label}@${width}x${height}`, { width, height });
        resized.quality = quality;
        return resized;
      }),
      toDataURL: () => `data:image/png;base64,${label}`,
      addRepresentation: jest.fn((representation) => image.representations.push(representation)),
      setTemplateImage: jest.fn((value) => {
        image.template = value;
      }),
    };
    images.push(image);
    return image;
  }
  return {
    images,
    createFromPath: jest.fn((file) => {
      if (files[file] === 'empty') {
        const empty = makeImage(file, { width: 0, height: 0 });
        empty.isEmpty = () => true;
        return empty;
      }
      return makeImage(path.basename(file), { width: 847, height: 847 });
    }),
    createEmpty: jest.fn(() => makeImage('empty', { width: 0, height: 0 })),
  };
}

function load(platform, files, options = {}) {
  const nativeImage = createFakeNativeImage(files);
  const icon = loadTrayIcon({
    platform,
    searchRoots: [ROOT],
    nativeImage,
    exists: (file) => Object.hasOwn(files, file),
    log: { warn: jest.fn() },
    ...options,
  });
  return { icon, nativeImage };
}

const everything = {
  [path.join(ROOT, 'icon.png')]: true,
  [path.join(ROOT, 'icon.ico')]: true,
  [path.join(ROOT, 'trayTemplate.png')]: true,
};

describe('the macOS menu bar icon', () => {
  it('is the monochrome template image, marked as a template and never resized', () => {
    const { icon, nativeImage } = load('darwin', everything);

    expect(icon.label).toBe('trayTemplate.png');
    expect(icon.setTemplateImage).toHaveBeenCalledWith(true);
    expect(icon.resize).not.toHaveBeenCalled();
    expect(nativeImage.createFromPath).toHaveBeenCalledTimes(1);
  });

  it('falls back to the colour icon at its own 22 pt and 44 px when the template is missing', () => {
    const files = { ...everything };
    delete files[path.join(ROOT, 'trayTemplate.png')];
    const { icon } = load('darwin', files);

    expect(icon.template).toBe(false);
    expect(icon.representations.map(({ scaleFactor }) => scaleFactor)).toEqual([1, 2]);
    expect(icon.representations.map(({ dataURL }) => dataURL)).toEqual([
      'data:image/png;base64,icon.png@22x22',
      'data:image/png;base64,icon.png@44x44',
    ]);
  });

  it('ignores a template that cannot be decoded', () => {
    const { icon } = load('darwin', {
      ...everything,
      [path.join(ROOT, 'trayTemplate.png')]: 'empty',
    });
    expect(icon.template).toBe(false);
    expect(icon.representations).toHaveLength(2);
  });
});

describe('the Linux tray icon', () => {
  it('carries a true 1x and 2x bitmap, so a HiDPI bar is not shown a stretched small one', () => {
    const { icon } = load('linux', everything);

    expect(icon.representations).toEqual([
      { scaleFactor: 1, dataURL: 'data:image/png;base64,icon.png@22x22' },
      { scaleFactor: 2, dataURL: 'data:image/png;base64,icon.png@44x44' },
    ]);
  });

  it('draws both from the full-size artwork, with the best resampling', () => {
    const { nativeImage } = load('linux', everything);
    const source = nativeImage.images.find((image) => image.label === 'icon.png');
    expect(source.resize.mock.calls.map(([options]) => options)).toEqual([
      { width: 22, height: 22, quality: 'best' },
      { width: 44, height: 44, quality: 'best' },
    ]);
  });

  it('has the same size as the live value icons', () => {
    const { getTrayIconSizeForPlatform } = require('../../src/tray-entities.cjs');
    const { icon } = load('linux', everything);
    expect(icon.representations[0].dataURL).toContain(`${getTrayIconSizeForPlatform('linux')}x`);
  });
});

describe('the Windows notification-area icon', () => {
  it.each([
    [1, 16],
    [1.25, 20],
    [1.5, 24],
    [1.75, 28],
    [2, 32],
    [3, 48],
    [4, 48],
  ])('is %s x scaling: a bitmap of exactly %s px', (scaleFactor, size) => {
    expect(getWindowsTrayIconSize(scaleFactor)).toBe(size);
    const { icon } = load('win32', everything, { scaleFactor });
    expect(icon.size).toEqual({ width: size, height: size });
    expect(icon.quality).toBe('best');
  });

  it('is 16 px when the display cannot say its scaling', () => {
    for (const scaleFactor of [undefined, 0, NaN, -1]) {
      expect(getWindowsTrayIconSize(scaleFactor)).toBe(16);
    }
  });

  it('is cut from the master artwork rather than from the 256 px icon frame', () => {
    const { icon } = load('win32', everything, { scaleFactor: 1.5 });
    expect(icon.label).toBe('icon.png@24x24');
  });

  it('uses the .ico only when the PNG is not there', () => {
    const files = { ...everything };
    delete files[path.join(ROOT, 'icon.png')];
    expect(load('win32', files).icon.label).toBe('icon.ico@16x16');
  });
});

describe('without any icon file', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'says so on %s, for the caller to substitute one',
    (platform) => {
      expect(load(platform, {}).icon).toBeNull();
    }
  );

  it('keeps looking when a file cannot be decoded', () => {
    const files = {
      [path.join(ROOT, 'icon.png')]: 'empty',
      [path.join(ROOT, 'icon.ico')]: true,
    };
    const { icon } = load('linux', files);
    expect(icon.representations).toHaveLength(2);
    expect(icon.representations[0].dataURL).toContain('icon.ico@');
  });

  it('looks in an icons folder too, as the packaged layouts do', () => {
    const files = { [path.join(ROOT, 'icons', 'icon.png')]: true };
    expect(load('linux', files).icon.representations).toHaveLength(2);
  });
});
