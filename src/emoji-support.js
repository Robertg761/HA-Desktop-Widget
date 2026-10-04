// An emoji from a newer Unicode than the computer's emoji font knows is drawn as an empty box, in
// the icon picker and then on the tile it was picked for. Windows 10 and older macOS releases are
// the usual cases. A canvas can tell without drawing anything: it measures a character no font has
// at the width of the box it would draw, so an emoji that measures like that is not there.

const PROBE_FONT_SIZE = 32;
// Matches within half a pixel, which is far finer than any two glyphs differ at 32px.
const SAME_WIDTH = 0.5;
// A noncharacter, which no font draws, so its width is the width of the missing-glyph box.
const MISSING_GLYPH = '\u{10FFFF}';
// Grinning face: in every emoji font there is, so it measures what a drawn emoji measures.
const KNOWN_GLYPH = '\u{1F600}';
// Emoji that new Unicode releases add are all out here. Below it sit the older symbols (arrows,
// ©, ™), which a plain text font draws at about the width of the box, so a width match there says
// nothing.
const FIRST_CHECKED_CODEPOINT = 0x1f000;

/**
 * Builds a check for whether this computer can draw an emoji.
 * It answers true whenever it cannot tell: no canvas, no emoji font at all, or a missing-glyph box
 * as wide as a real emoji. Hiding an emoji that was fine is worse than showing one that is not.
 * @param {string} [fontFamily] - The font stack the emoji are shown in.
 * @returns {(icon: string) => boolean} True if the emoji is drawn.
 */
function createEmojiSupportCheck(fontFamily = 'sans-serif') {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : null;
  const context = canvas?.getContext?.('2d');
  if (!context || typeof context.measureText !== 'function') return () => true;
  context.font = `${PROBE_FONT_SIZE}px ${fontFamily}`;
  const missing = context.measureText(MISSING_GLYPH).width;
  const known = context.measureText(KNOWN_GLYPH).width;
  if (!(missing > 0) || Math.abs(missing - known) < SAME_WIDTH) return () => true;

  return (icon) => {
    if (String(icon).codePointAt(0) < FIRST_CHECKED_CODEPOINT) return true;
    return Math.abs(context.measureText(icon).width - missing) >= SAME_WIDTH;
  };
}

export { createEmojiSupportCheck };
