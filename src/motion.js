/**
 * Small, subtle motion for the renderer.
 *
 * Everything here uses the Web Animations API so it needs no cleanup classes, and everything is
 * skipped when the OS asks for reduced motion (the stylesheet's global reduced-motion rule does
 * not reach WAAPI animations) or when the element cannot animate (jsdom in tests).
 */

// The app's one expressive curve (--ease-emphasized in styles.css).
const EASE_EMPHASIZED = 'cubic-bezier(0.16, 1, 0.3, 1)';

const indicatorRects = new WeakMap();
const indicatorObservers = new WeakMap();

function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

function canAnimate(element) {
  return !!element && typeof element.animate === 'function' && !prefersReducedMotion();
}

/** An element's box relative to its container's scrollable content. */
function rectWithin(container, element) {
  const outer = container.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  return {
    x: inner.left - outer.left + container.scrollLeft - container.clientLeft,
    y: inner.top - outer.top + container.scrollTop - container.clientTop,
    width: inner.width,
    height: inner.height,
  };
}

function frameFor(rect) {
  return {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

/**
 * Keep a highlight pill under the active item of a tab bar, sliding it from the previous item
 * when the selection moves. The container keeps its last position across re-renders, so a bar
 * that is rebuilt on every switch (the Quick Access pages) still slides.
 * @param {HTMLElement} container - Tab bar; gets .has-sliding-indicator (and must be positioned).
 * @param {HTMLElement|null} activeElement - Selected item, or null to hide the pill.
 * @returns {HTMLElement|null} The indicator element.
 */
function syncSlidingIndicator(container, activeElement) {
  if (!container) return null;
  let indicator = container.querySelector(':scope > .sliding-indicator');
  if (!activeElement || !container.contains(activeElement)) {
    indicator?.remove();
    container.classList.remove('has-sliding-indicator');
    indicatorRects.delete(container);
    return null;
  }

  const rect = rectWithin(container, activeElement);
  // Not laid out yet (hidden bar, closed dialog): try again when it is.
  if (!rect.width || !rect.height) return indicator;

  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'sliding-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    container.prepend(indicator);
  }
  container.classList.add('has-sliding-indicator');

  const previous = indicatorRects.get(container);
  const next = frameFor(rect);
  Object.assign(indicator.style, next);
  indicatorRects.set(container, rect);

  const moved =
    previous &&
    (Math.abs(previous.x - rect.x) > 0.5 ||
      Math.abs(previous.y - rect.y) > 0.5 ||
      Math.abs(previous.width - rect.width) > 0.5);
  if (moved && canAnimate(indicator)) {
    indicator.animate([frameFor(previous), next], { duration: 320, easing: EASE_EMPHASIZED });
  }

  // Re-measure when the bar resizes (window resize, text size change), without animating.
  if (!indicatorObservers.has(container) && typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      const current = container.querySelector(
        ':scope .active:is(.tab-link, .segmented-option), :scope .btn-primary'
      );
      const pill = container.querySelector(':scope > .sliding-indicator');
      if (!current || !pill) return;
      const box = rectWithin(container, current);
      if (!box.width) return;
      Object.assign(pill.style, frameFor(box));
      indicatorRects.set(container, box);
    });
    observer.observe(container);
    indicatorObservers.set(container, observer);
  }
  return indicator;
}

/**
 * Slide freshly shown content in from the side it logically came from, with a slight stagger.
 * @param {Iterable<HTMLElement>} elements - Items to animate, in reading order.
 * @param {Object} [options]
 * @param {number} [options.direction=0] - 1 when moving forward (enter from the right), -1 when
 *   moving back, 0 to rise in place.
 * @param {number} [options.maxStagger=8] - Items after this many share the last delay.
 */
function animateEnter(elements, { direction = 0, maxStagger = 8 } = {}) {
  let index = 0;
  for (const element of elements) {
    if (!canAnimate(element)) return;
    const dx = direction * 14;
    const dy = direction === 0 ? 6 : 0;
    element.animate(
      [
        { opacity: 0, transform: `translate(${dx}px, ${dy}px)` },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 280,
        delay: Math.min(index, maxStagger) * 16,
        easing: EASE_EMPHASIZED,
        fill: 'backwards',
      }
    );
    index += 1;
  }
}

/**
 * A short swell on an icon when its tile turns on, so the change registers without a flash.
 * @param {HTMLElement|null} element - Icon container.
 */
function pulse(element) {
  if (!canAnimate(element)) return;
  element.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
    { duration: 360, easing: EASE_EMPHASIZED }
  );
}

export { animateEnter, canAnimate, prefersReducedMotion, pulse, syncSlidingIndicator };
