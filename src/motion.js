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

/**
 * An element's box relative to its container's content, from layout offsets rather than
 * getBoundingClientRect: the offsets ignore transforms, so a bar measured while its dialog is
 * still scaling in (the settings modal opens at 95%) gets its real size, not a shrunken one.
 * Falls back to client rects when the container is not in the element's offset-parent chain.
 */
function rectWithin(container, element) {
  let x = 0;
  let y = 0;
  let node = element;
  while (node && node !== container) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  if (node === container) {
    return { x, y, width: element.offsetWidth, height: element.offsetHeight };
  }
  const outer = container.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  return {
    x: inner.left - outer.left + container.scrollLeft - container.clientLeft,
    y: inner.top - outer.top + container.scrollTop - container.clientTop,
    width: inner.width,
    height: inner.height,
  };
}

// The frame an indicator is drawn at this moment. While it slides, its computed transform and size
// are the animated ones, between the item it left and the item it is heading for.
function drawnFrame(indicator) {
  const style = window.getComputedStyle(indicator);
  const matrix = /^matrix\(([^)]+)\)$/.exec(style.transform || '');
  const values = matrix ? matrix[1].split(',').map(Number) : [];
  const [x, y] = values.length === 6 ? values.slice(4) : [0, 0];
  return { transform: `translate(${x}px, ${y}px)`, width: style.width, height: style.height };
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
  const moved =
    previous &&
    (Math.abs(previous.x - rect.x) > 0.5 ||
      Math.abs(previous.y - rect.y) > 0.5 ||
      Math.abs(previous.width - rect.width) > 0.5);
  // A switch that comes while the pill is still sliding starts from where the pill is drawn, not
  // from the item it was heading for, or it would hop there first.
  const running = moved && canAnimate(indicator) ? (indicator.getAnimations?.() ?? []) : [];
  const start = running.length ? drawnFrame(indicator) : previous && frameFor(previous);
  running.forEach((animation) => animation.cancel());
  Object.assign(indicator.style, next);
  indicatorRects.set(container, rect);

  if (moved && canAnimate(indicator)) {
    indicator.animate([start, next], { duration: 320, easing: EASE_EMPHASIZED });
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

// How a tile that is going away fades, and the class it carries while it does. It is drawn where
// it last stood, out of the grid's flow, so the others can already slide into its place.
const LEAVING_CLASS = 'layout-leaving';
const MOVE_ANIMATION_ID = 'layout-move';

/**
 * Where each item of a list is drawn now, to animate from once the list has changed (see
 * animateLayoutChange). Null when nothing would animate (reduced motion, jsdom).
 * @param {HTMLElement} container - The list; its direct children are the items.
 * @returns {{ items: Map<HTMLElement, DOMRect> }|null}
 */
function captureLayout(container) {
  if (!canAnimate(container)) return null;
  const items = new Map();
  for (const element of container.children) {
    if (element.classList.contains(LEAVING_CLASS)) continue;
    items.set(element, element.getBoundingClientRect());
  }
  return { items };
}

function leave(container, element, rect, box) {
  if (!rect.width || !rect.height) return;
  Object.assign(element.style, {
    position: 'absolute',
    left: `${rect.left - box.left - container.clientLeft + container.scrollLeft}px`,
    top: `${rect.top - box.top - container.clientTop + container.scrollTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  element.classList.add(LEAVING_CLASS);
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
  container.append(element);
  const animation = element.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: 'scale(0.92)' },
    ],
    { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' }
  );
  const done = () => element.remove();
  animation.onfinish = done;
  animation.oncancel = done;
}

/**
 * Animate a list from the layout captureLayout saw to the one it has now: items that went away
 * fade and shrink where they stood, the ones that stayed glide to their new places, and new ones
 * fade and grow in once there is room for them. Call it after the list's children are updated.
 * Items that went away must be detached by then; they are put back only for as long as they fade.
 * @param {HTMLElement} container - The list, which must be positioned (it holds the fading items).
 * @param {{ items: Map<HTMLElement, DOMRect> }|null} before - From captureLayout.
 */
function animateLayoutChange(container, before) {
  if (!before || !canAnimate(container)) return;
  const box = container.getBoundingClientRect();
  let left = 0;
  before.items.forEach((rect, element) => {
    if (element.parentNode === container) return;
    leave(container, element, rect, box);
    left += 1;
  });

  let entering = 0;
  for (const element of container.children) {
    if (element.classList.contains(LEAVING_CLASS)) continue;
    const from = before.items.get(element);
    if (!from) {
      element.animate(
        [
          { opacity: 0, transform: 'scale(0.92)' },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: 360,
          // After what left has made way, and one after another when several arrive together.
          delay: (left ? 140 : 0) + Math.min(entering, 6) * 40,
          easing: EASE_EMPHASIZED,
          fill: 'backwards',
        }
      );
      entering += 1;
      continue;
    }
    // A slide that is still running is replaced by one from where the item is drawn now.
    (element.getAnimations?.() ?? [])
      .filter((animation) => animation.id === MOVE_ANIMATION_ID)
      .forEach((animation) => animation.cancel());
    const to = element.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    const animation = element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: 420, easing: EASE_EMPHASIZED }
    );
    animation.id = MOVE_ANIMATION_ID;
  }
}

/** Whether an item is only on the page while it fades out. */
function isLeaving(element) {
  return !!element?.classList?.contains(LEAVING_CLASS);
}

export {
  animateEnter,
  animateLayoutChange,
  canAnimate,
  captureLayout,
  isLeaving,
  prefersReducedMotion,
  pulse,
  syncSlidingIndicator,
};
