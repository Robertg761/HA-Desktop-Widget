/**
 * @jest-environment jsdom
 */

const { SCENES } = require('../../src/seasonal-scenes.js');

// Records the strength each pumpkin body is filled with. Everything else is a no-op.
function createRecordingContext() {
  const alphas = [];
  const target = { globalAlpha: 1, createRadialGradient: () => ({ addColorStop() {} }) };
  const context = new Proxy(target, {
    get(object, key) {
      if (key in object) return object[key];
      if (key === 'ellipse') return () => alphas.push(object.globalAlpha);
      return () => {};
    },
    set(object, key, value) {
      object[key] = value;
      return true;
    },
  });
  return { alphas, context };
}

describe('pumpkin rows', () => {
  const [layer] = SCENES.thanksgiving;
  const frame = (time, covered) => ({
    time,
    width: 420,
    height: 600,
    light: false,
    isCovered: jest.fn(() => covered),
  });
  const drawFrames = (...frames) => {
    const state = layer.init(420, 600);
    const drawing = createRecordingContext();
    frames.forEach((next) => layer.draw(drawing.context, state, next));
    return { state, drawing };
  };

  it('draws them at full strength when no tile is over them', () => {
    const { drawing } = drawFrames(frame(0, false));
    expect(Math.max(...drawing.alphas)).toBeCloseTo(0.85);
  });

  it('asks about a box around each of the four pumpkins at the bottom edge', () => {
    const next = frame(0, false);
    drawFrames(next);
    expect(next.isCovered).toHaveBeenCalledTimes(4);
    next.isCovered.mock.calls.forEach(([x, y, width, height]) => {
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      // Each box reaches the bottom of the window and no further.
      expect(y + height).toBeGreaterThan(600 - 10);
      expect(y + height).toBeLessThan(600 + 40);
      expect(x).toBeGreaterThanOrEqual(0);
    });
  });

  it('fades them to a hint once a tile is over them, and brings them back', () => {
    const { state, drawing } = drawFrames(frame(0, false), frame(1000, true));
    // A second after the tile arrived, the fade is complete.
    const covered = createRecordingContext();
    layer.draw(covered.context, state, frame(2000, true));
    expect(Math.max(...covered.alphas)).toBeCloseTo(0.85 * 0.3);
    expect(Math.max(...drawing.alphas)).toBeGreaterThan(Math.max(...covered.alphas));

    const uncovered = createRecordingContext();
    layer.draw(uncovered.context, state, frame(3000, false));
    expect(Math.max(...uncovered.alphas)).toBeCloseTo(0.85);
  });

  it('fades over a quarter of a second rather than flipping', () => {
    const { state } = drawFrames(frame(0, false));
    const midway = createRecordingContext();
    layer.draw(midway.context, state, frame(125, true));
    const alpha = Math.max(...midway.alphas);
    expect(alpha).toBeLessThan(0.85);
    expect(alpha).toBeGreaterThan(0.85 * 0.3);
  });

  it('still draws them where the host cannot say what is covered', () => {
    const state = layer.init(420, 600);
    const drawing = createRecordingContext();
    layer.draw(drawing.context, state, { time: 0, width: 420, height: 600, light: false });
    expect(Math.max(...drawing.alphas)).toBeCloseTo(0.85);
  });
});
