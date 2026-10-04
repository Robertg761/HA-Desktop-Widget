const { createEmojiSupportCheck } = require('../../src/emoji-support.js');

// A stand-in for the canvas: each character measures what the table says, and anything the table
// leaves out measures the missing-glyph box, as a canvas does for a character no font has.
function stubCanvas(widths, { box = 19 } = {}) {
  global.OffscreenCanvas = class {
    getContext() {
      return {
        font: '',
        measureText: (text) => ({ width: widths[text] ?? box }),
      };
    }
  };
}

describe('createEmojiSupportCheck', () => {
  const originalCanvas = global.OffscreenCanvas;
  afterEach(() => {
    global.OffscreenCanvas = originalCanvas;
  });

  const GRINNING = '\u{1F600}';
  const NEW_EMOJI = '\u{1FAE9}';
  const OLD_EMOJI = '\u{1F3E0}';

  test('drops an emoji the fonts lack, which measures like the missing-glyph box', () => {
    stubCanvas({ [GRINNING]: 40, [OLD_EMOJI]: 40 });
    const isDrawn = createEmojiSupportCheck();

    expect(isDrawn(OLD_EMOJI)).toBe(true);
    expect(isDrawn(NEW_EMOJI)).toBe(false);
  });

  test('never drops the older symbols, whose text glyphs can be the width of the box', () => {
    stubCanvas({ [GRINNING]: 40 }, { box: 19 });
    const isDrawn = createEmojiSupportCheck();

    expect(isDrawn('™')).toBe(true);
    expect(isDrawn('▪️')).toBe(true);
  });

  test('keeps everything when it cannot tell', () => {
    // No canvas at all, as in a test environment
    delete global.OffscreenCanvas;
    expect(createEmojiSupportCheck()(NEW_EMOJI)).toBe(true);

    // No emoji font on the computer: the face itself is a box, so every width would match
    stubCanvas({}, { box: 19 });
    expect(createEmojiSupportCheck()(NEW_EMOJI)).toBe(true);

    // A box with no width says nothing
    stubCanvas({ [GRINNING]: 40 }, { box: 0 });
    expect(createEmojiSupportCheck()(NEW_EMOJI)).toBe(true);
  });

  test('measures in the font stack the emoji are shown in', () => {
    let font = '';
    global.OffscreenCanvas = class {
      getContext() {
        return {
          set font(value) {
            font = value;
          },
          measureText: () => ({ width: 40 }),
        };
      }
    };
    createEmojiSupportCheck('"Segoe UI", sans-serif');

    expect(font).toBe('32px "Segoe UI", sans-serif');
  });
});
