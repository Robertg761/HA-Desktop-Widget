/**
 * @jest-environment jsdom
 */

const { animateEnter, pulse, syncSlidingIndicator } = require('../../src/motion.js');

function setRect(element, rect) {
  element.getBoundingClientRect = () => ({
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  });
}

function setReducedMotion(reduce) {
  window.matchMedia = jest.fn().mockReturnValue({ matches: reduce });
}

describe('motion helpers', () => {
  let animate;

  beforeEach(() => {
    document.body.innerHTML = '';
    setReducedMotion(false);
    animate = jest.fn();
    HTMLElement.prototype.animate = animate;
  });

  afterEach(() => {
    delete HTMLElement.prototype.animate;
  });

  function buildBar() {
    const bar = document.createElement('div');
    const first = document.createElement('button');
    const second = document.createElement('button');
    bar.append(first, second);
    document.body.appendChild(bar);
    setRect(bar, { x: 10, y: 10, width: 300, height: 40 });
    setRect(first, { x: 14, y: 14, width: 60, height: 28 });
    setRect(second, { x: 80, y: 14, width: 90, height: 28 });
    return { bar, first, second };
  }

  test('places a pill under the active item without animating the first time', () => {
    const { bar, first } = buildBar();
    const pill = syncSlidingIndicator(bar, first);
    expect(pill.classList.contains('sliding-indicator')).toBe(true);
    expect(bar.firstElementChild).toBe(pill);
    expect(bar.classList.contains('has-sliding-indicator')).toBe(true);
    expect(pill.style.transform).toBe('translate(4px, 4px)');
    expect(pill.style.width).toBe('60px');
    expect(animate).not.toHaveBeenCalled();
  });

  test('slides from the previous item, even after the bar is rebuilt', () => {
    const { bar, first } = buildBar();
    syncSlidingIndicator(bar, first);
    // Rebuild the items, as the Quick Access tab bar does on every switch.
    bar.querySelectorAll('button').forEach((button) => button.remove());
    const next = document.createElement('button');
    bar.appendChild(next);
    setRect(next, { x: 80, y: 14, width: 90, height: 28 });

    const pill = syncSlidingIndicator(bar, next);
    expect(pill.style.transform).toBe('translate(70px, 4px)');
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0];
    expect(frames[0].transform).toBe('translate(4px, 4px)');
    expect(frames[1].transform).toBe('translate(70px, 4px)');
  });

  test('does not animate when the selection has not moved', () => {
    const { bar, first } = buildBar();
    syncSlidingIndicator(bar, first);
    syncSlidingIndicator(bar, first);
    expect(animate).not.toHaveBeenCalled();
  });

  test('jumps instead of sliding under reduced motion', () => {
    const { bar, first, second } = buildBar();
    syncSlidingIndicator(bar, first);
    setReducedMotion(true);
    const pill = syncSlidingIndicator(bar, second);
    expect(pill.style.transform).toBe('translate(70px, 4px)');
    expect(animate).not.toHaveBeenCalled();
  });

  test('removes the pill when nothing is active', () => {
    const { bar, first } = buildBar();
    syncSlidingIndicator(bar, first);
    expect(syncSlidingIndicator(bar, null)).toBeNull();
    expect(bar.querySelector('.sliding-indicator')).toBeNull();
    expect(bar.classList.contains('has-sliding-indicator')).toBe(false);
  });

  test('waits for layout before placing the pill', () => {
    const { bar, first } = buildBar();
    setRect(first, { x: 0, y: 0, width: 0, height: 0 });
    expect(syncSlidingIndicator(bar, first)).toBeNull();
    expect(bar.querySelector('.sliding-indicator')).toBeNull();
  });

  test('slides content in from the direction of travel with a capped stagger', () => {
    const items = Array.from({ length: 12 }, () => document.createElement('div'));
    animateEnter(items, { direction: 1 });
    expect(animate).toHaveBeenCalledTimes(12);
    expect(animate.mock.calls[0][0][0].transform).toBe('translate(14px, 0px)');
    expect(animate.mock.calls[0][1].delay).toBe(0);
    expect(animate.mock.calls[3][1].delay).toBe(48);
    expect(animate.mock.calls[11][1].delay).toBe(animate.mock.calls[8][1].delay);

    animate.mockClear();
    animateEnter([document.createElement('div')], { direction: -1 });
    expect(animate.mock.calls[0][0][0].transform).toBe('translate(-14px, 0px)');

    animate.mockClear();
    animateEnter([document.createElement('div')]);
    expect(animate.mock.calls[0][0][0].transform).toBe('translate(0px, 6px)');
  });

  test('skips entrance and pulse under reduced motion or without WAAPI', () => {
    setReducedMotion(true);
    animateEnter([document.createElement('div')], { direction: 1 });
    pulse(document.createElement('div'));
    expect(animate).not.toHaveBeenCalled();

    setReducedMotion(false);
    delete HTMLElement.prototype.animate;
    expect(() => pulse(document.createElement('div'))).not.toThrow();
    expect(() => animateEnter([document.createElement('div')])).not.toThrow();
  });

  test('pulses an icon', () => {
    pulse(document.createElement('div'));
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][0][1].transform).toBe('scale(1.14)');
    pulse(null);
    expect(animate).toHaveBeenCalledTimes(1);
  });
});
