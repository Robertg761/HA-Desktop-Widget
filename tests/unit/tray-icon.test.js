/** @jest-environment node */
const path = require('path');
const {
  getWindowsTrayIconSize,
  loadTrayIcon,
  pickIcoFrame,
  readIcoFrames,
} = require('../../src/tray-icon.cjs');

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
    createFromBuffer: jest.fn((buffer) => {
      const image = makeImage('png-frame', { width: buffer.readUInt32BE(16), height: 0 });
      image.buffer = buffer;
      return image;
    }),
    createFromBitmap: jest.fn((bitmap, { width, height }) => {
      const image = makeImage(`bitmap-frame-${width}`, { width, height });
      image.bitmap = bitmap;
      return image;
    }),
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

/**
 * An .ico the way build/icon.ico is stored: a PNG for the 256 px frame and 32-bit bitmaps (bottom
 * up, with the empty mask under the colours) for the small ones. Each bitmap frame is one colour
 * per row, `frame.rows[row]` being [b, g, r, a], so a test can tell which row ended up where.
 */
function buildIco(frames) {
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const payload = [];
  let offset = header.length;
  frames.forEach((frame, index) => {
    let data;
    if (frame.size >= 256) {
      data = Buffer.alloc(33);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(data);
      data.writeUInt32BE(13, 8);
      data.write('IHDR', 12, 'ascii');
      data.writeUInt32BE(frame.size, 16);
      data.writeUInt32BE(frame.size, 20);
    } else {
      const { size } = frame;
      const mask = Math.ceil(size / 32) * 4 * size;
      data = Buffer.alloc(40 + size * size * 4 + mask);
      data.writeUInt32LE(40, 0);
      data.writeInt32LE(size, 4);
      data.writeInt32LE(size * 2, 8);
      data.writeUInt16LE(1, 12);
      data.writeUInt16LE(frame.bitCount || 32, 14);
      for (let row = 0; row < size; row++) {
        const stored = size - 1 - row;
        const colour = frame.rows ? frame.rows[row % frame.rows.length] : [0, 0, 0, 255];
        for (let column = 0; column < size; column++) {
          Buffer.from(colour).copy(data, 40 + (stored * size + column) * 4);
        }
      }
    }
    const entry = 6 + index * 16;
    header.writeUInt8(frame.size % 256, entry);
    header.writeUInt8(frame.size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
    payload.push(data);
  });
  return Buffer.concat([header, ...payload]);
}

const windowsIco = buildIco(
  [256, 128, 48, 40, 32, 24, 20, 16].map((size) => ({
    size,
    rows: [
      [10, 20, 30, 255],
      [200, 100, 50, 128],
    ],
  }))
);

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

  it('is the rounded app icon the dock and the launchers show, not the old square artwork', () => {
    const files = { ...everything, [path.join(ROOT, 'icons', '512x512.png')]: true };
    const { icon, nativeImage } = load('linux', files);

    expect(nativeImage.createFromPath).toHaveBeenCalledWith(
      path.join(ROOT, 'icons', '512x512.png')
    );
    expect(icon.representations.map(({ dataURL }) => dataURL)).toEqual([
      'data:image/png;base64,512x512.png@22x22',
      'data:image/png;base64,512x512.png@44x44',
    ]);
  });

  it('is the same file the window and the launchers take their icon from', () => {
    const { getAppIconPath } = require('../../src/platform.cjs');
    expect(path.basename(getAppIconPath(path.sep, 'linux'))).toBe('512x512.png');
  });

  it('leaves Windows and macOS on their own artwork', () => {
    const files = {
      [path.join(ROOT, 'icon.png')]: true,
      [path.join(ROOT, 'icons', '512x512.png')]: true,
    };
    for (const platform of ['win32', 'darwin']) {
      const { nativeImage } = load(platform, files);
      expect(nativeImage.createFromPath).not.toHaveBeenCalledWith(
        path.join(ROOT, 'icons', '512x512.png')
      );
    }
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

  it.each([
    [1, 16],
    [1.25, 20],
    [1.5, 24],
    [2, 32],
  ])(
    "at %s x scaling is the .ico's own %s px frame, not a shrunk copy of the artwork",
    (scaleFactor, size) => {
      const { icon, nativeImage } = load('win32', everything, {
        scaleFactor,
        readFile: () => windowsIco,
      });
      expect(icon.label).toBe(`bitmap-frame-${size}`);
      expect(icon.resize).not.toHaveBeenCalled();
      expect(nativeImage.createFromPath).not.toHaveBeenCalled();
    }
  );

  it('hands the frame over top-down and premultiplied, the way a native image holds a bitmap', () => {
    const { icon } = load('win32', everything, { readFile: () => windowsIco });
    expect([...icon.bitmap.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    // The second stored row of colour is [200, 100, 50] at 128/255 opacity.
    expect([...icon.bitmap.subarray(16 * 4, 16 * 4 + 4)]).toEqual([100, 50, 25, 128]);
  });

  it('shrinks the next larger frame when the file has no frame of the size', () => {
    const { icon } = load('win32', everything, { scaleFactor: 1.75, readFile: () => windowsIco });
    expect(icon.label).toBe('bitmap-frame-32@28x28');
    expect(icon.quality).toBe('best');
  });

  it('decodes the PNG frame of the 256 px size', () => {
    const { icon, nativeImage } = load('win32', everything, {
      scaleFactor: 4,
      readFile: () => buildIco([{ size: 256 }]),
    });
    expect(nativeImage.createFromBuffer).toHaveBeenCalledTimes(1);
    expect(icon.label).toBe('png-frame@48x48');
  });

  it('is cut from the master artwork when the .ico cannot be read or has no usable frame', () => {
    const { icon } = load('win32', everything, {
      scaleFactor: 1.5,
      readFile: () => {
        throw new Error('EACCES');
      },
    });
    expect(icon.label).toBe('icon.png@24x24');
    expect(
      load('win32', everything, {
        scaleFactor: 1.5,
        readFile: () => buildIco([{ size: 16, bitCount: 8 }]),
      }).icon.label
    ).toBe('icon.png@24x24');
  });

  it('uses the .ico as an image only when neither a frame nor the PNG is there', () => {
    const files = { ...everything };
    delete files[path.join(ROOT, 'icon.png')];
    expect(load('win32', files, { readFile: () => Buffer.alloc(0) }).icon.label).toBe(
      'icon.ico@16x16'
    );
  });

  it('does not read the .ico on the other systems', () => {
    const readFile = jest.fn(() => windowsIco);
    load('linux', everything, { readFile });
    load('darwin', everything, { readFile });
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('reading an .ico', () => {
  it('lists the frames with their real sizes', () => {
    expect(readIcoFrames(windowsIco).map(({ width, height }) => [width, height])).toEqual(
      [256, 128, 48, 40, 32, 24, 20, 16].map((size) => [size, size])
    );
  });

  it.each([Buffer.alloc(0), Buffer.from('not an icon at all'), null, undefined])(
    'finds nothing in %p',
    (input) => {
      expect(readIcoFrames(input)).toEqual([]);
    }
  );

  it('skips a frame that runs past the end of the file', () => {
    const truncated = windowsIco.subarray(0, windowsIco.length - 100);
    expect(readIcoFrames(truncated)).toHaveLength(7);
  });

  it('picks the exact size, else the next larger, else the largest', () => {
    const frames = readIcoFrames(windowsIco);
    expect(pickIcoFrame(frames, 24).width).toBe(24);
    expect(pickIcoFrame(frames, 28).width).toBe(32);
    expect(pickIcoFrame(frames, 300).width).toBe(256);
    expect(pickIcoFrame([], 16)).toBeNull();
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
