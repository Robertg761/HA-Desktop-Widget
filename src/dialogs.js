/* global process */
/**
 * Dialogs and toasts: what the widget raises over the page, and where the keyboard goes while it
 * is up.
 *
 * - openDialog(modal, options) and closeDialog(modal, options) own every dialog's role and name,
 *   the focus trap, where focus lands and returns to, which dialog Escape, Enter and the backdrop
 *   act on, stacking, and the shared entry and exit animation. showConfirm(title, message) asks a
 *   question in the shared confirmation dialog through them. releaseFocusTrap(modal) lets go of a
 *   dialog without hiding it, for an overlay that leaves by an animation of its own.
 * - showToast(message, type, timeout, options) owns the toast stack: how long each stays, what is
 *   announced, repeats, the cap, and keeping clear of the open dialog's footer. dismissToast and
 *   dismissToasts take toasts down.
 * - renderKeepingFocus, disableControlsKeepingFocus and findFocusKey keep the keyboard's place when
 *   controls are rebuilt or disabled, finding a rebuilt control the way a closing dialog finds its
 *   opener.
 *
 * Dialogs and toasts share a module because each depends on the other: an open dialog lifts the
 * toast stack above its footer, and with no dialog open Escape goes to the newest toast.
 */
import { t } from './i18n.js';
import { setIconContent } from './icons.js';
import { setLineIconContent } from './entity-icons.js';
import { prefersReducedMotion } from './motion.js';

const focusTrapHandlers = new WeakMap();
// Where focus returns when a trapped modal is released: the control that opened it, as found
// again if it is rebuilt (tile, focus key), and a last resort.
const focusTrapOpeners = new WeakMap();
const activeFocusTrapModals = new Set();
// What each open dialog does on Escape, Enter and a backdrop click; see openDialog().
const dialogLayers = new WeakMap();
// One entry per modal that is currently animating out, so a later close (or a re-open) can take
// the in-flight timer and listener away from the call that installed them.
const pendingModalCloses = new WeakMap();
// The shared modal exit animation runs for var(--duration-base) (200ms); the fallback timer only
// exists for hosts that never deliver `animationend` (reduced-motion overrides, background tabs,
// jsdom).
const MODAL_EXIT_FALLBACK_MS = 300;
const TOAST_EXIT_FALLBACK_MS = 300;
const TOAST_ICON_NAMES = {
  success: 'circle-check',
  error: 'circle-x',
  warning: 'triangle-alert',
  info: 'info',
};

/**
 * Detect the Jest environment, where CSS animations never run and close paths must settle
 * synchronously for assertions made straight after a click.
 * @returns {boolean} True when running under `NODE_ENV=test`.
 */
function isTestEnvironment() {
  return typeof process !== 'undefined' && !!process.env && process.env.NODE_ENV === 'test';
}

// Set by the test hook below so the animated close/open branch — the one that never runs under
// `NODE_ENV=test` — can still be exercised by unit tests.
let forceAnimatedModalTransitions = false;

/**
 * Test hook: force the animated exit paths (modals and toasts) even under `NODE_ENV=test`.
 *
 * Without this the `isTestEnvironment()` short-circuit settles every close synchronously, leaving
 * the `.modal-closing` animation, its fallback timer and the overlapping-call handling untested.
 * @param {boolean} [enabled=true] - True to animate, false to restore the synchronous test path.
 * @returns {void}
 */
function __forceAnimatedModalTransitions(enabled = true) {
  forceAnimatedModalTransitions = !!enabled;
}

/**
 * Decide whether animations should be skipped and the transition settled synchronously.
 * @returns {boolean} True when the caller should short-circuit straight to the end state.
 */
function shouldSkipExitAnimation() {
  if (forceAnimatedModalTransitions) return false;
  return isTestEnvironment() || prefersReducedMotion();
}

/**
 * Run the shared exit animation for a modal and then hide or remove it.
 *
 * Every modal animates open through `modalSlideIn`; without this helper the close paths flip
 * `.hidden` (a `display: none !important` rule) and the dialog snaps shut. The `.modal-closing`
 * class drives the paired fade/slide-out, and the modal is only hidden once that animation ends
 * (or the fallback timer fires). Reduced-motion hosts and tests skip the animation entirely.
 *
 * Only one close can be in flight per element: a second call supersedes the first, taking over its
 * timer, listener and awaiting callers so the earlier request can never complete this one early
 * (which would drop this call's `onClosed`) and no `await` is left hanging.
 *
 * @param {HTMLElement} modal - The modal overlay element (the `.modal` container, not its content).
 * @param {Object} [options] - Close behaviour.
 * @param {boolean} [options.remove=false] - Remove the modal from the DOM instead of hiding it with `.hidden`.
 * @param {boolean} [options.releaseFocus=false] - Release the modal's focus trap once it is hidden.
 * @param {boolean} [options.restoreFocus=true] - With `releaseFocus`, hand focus back to the opener.
 * @param {boolean} [options.animate=true] - False to hide at once, for overlays with no exit animation.
 * @param {Function} [options.onClosed] - Callback invoked after the modal is hidden or removed.
 * @returns {Promise<void>} Resolves once the modal has been hidden or removed.
 */
function closeModal(
  modal,
  {
    remove = false,
    releaseFocus = false,
    restoreFocus = true,
    animate = true,
    onClosed = null,
  } = {}
) {
  return new Promise((resolve) => {
    if (!modal || typeof modal.classList?.add !== 'function') {
      resolve();
      return;
    }

    const content = modal.querySelector?.('.modal-content') || null;
    // Callers awaiting this close, plus any inherited from a close this one supersedes.
    const waiters = [resolve];
    let settled = false;
    let animating = false;
    let fallbackTimer = null;

    const handleAnimationEnd = (event) => {
      if (event.target !== modal && event.target !== content) return;
      finish();
    };

    function detach() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      modal.removeEventListener?.('animationend', handleAnimationEnd);
      if (pendingModalCloses.get(modal) === pendingClose) pendingModalCloses.delete(modal);
    }

    function settleWaiters() {
      waiters.splice(0, waiters.length).forEach((notify) => notify());
    }

    // Stop this close without completing it, handing its awaiting callers to whoever took over.
    const pendingClose = {
      supersede() {
        if (settled) return [];
        settled = true;
        detach();
        return waiters.splice(0, waiters.length);
      },
    };

    function finish() {
      if (settled) return;
      settled = true;
      detach();
      // `openModal` disarms this close outright, but anything that reveals the dialog by clearing
      // `.modal-closing` directly still has to be honoured: without this check the pending close
      // would hide the dialog the user just asked for.
      if (animating && !modal.classList.contains('modal-closing')) {
        settleWaiters();
        return;
      }
      try {
        modal.classList.remove('modal-closing');
        if (remove) {
          modal.remove();
        } else {
          modal.classList.add('hidden');
          // Only modals opened by writing an inline display get one written back, so class-only
          // visibility toggles are not silently pinned shut by a stale inline style.
          if (modal.style?.display) modal.style.display = 'none';
        }
        // A close with no exit animation (reduced motion, or an overlay that has none) hands focus
        // back at once; one that waited for its animation does so a tick later.
        if (releaseFocus) releaseFocusTrap(modal, { restoreFocus, restoreNow: !animating });
        onClosed?.();
      } catch (error) {
        console.error('Error closing modal:', error);
      }
      settleWaiters();
    }

    const superseded = pendingModalCloses.get(modal);
    if (superseded) waiters.push(...superseded.supersede());

    if (!animate || shouldSkipExitAnimation()) {
      finish();
      return;
    }

    animating = true;
    pendingModalCloses.set(modal, pendingClose);
    modal.addEventListener?.('animationend', handleAnimationEnd);
    modal.classList.add('modal-closing');
    fallbackTimer = setTimeout(finish, MODAL_EXIT_FALLBACK_MS);
  });
}

/**
 * Reveal a modal, cancelling any exit animation still in flight.
 *
 * Pairs with {@link closeModal}: a pending close is disarmed outright (its fallback timer would
 * otherwise outlive the re-open and could complete a *later* close ahead of time), and clearing
 * `.modal-closing` restores the entry animation.
 *
 * @param {HTMLElement} modal - The modal overlay element.
 * @param {Object} [options] - Open behaviour.
 * @param {string|null} [options.display='flex'] - Inline display to write, or null to leave visibility to CSS.
 */
function openModal(modal, { display = 'flex' } = {}) {
  if (!modal || typeof modal.classList?.remove !== 'function') return;
  const pendingClose = pendingModalCloses.get(modal);
  // No close is coming, so the abandoned callers settle here rather than waiting forever.
  if (pendingClose) pendingClose.supersede().forEach((notify) => notify());
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
  if (display) {
    modal.style.display = display;
  } else {
    modal.style?.removeProperty?.('display');
  }
}

// ---------------------------------------------------------------------------------------------
// Toasts. One manager owns the stack: it keeps the container clear of the buttons of whatever
// raised them, folds repeats into one toast, caps the stack, keeps problems on screen until they
// are read, and pauses the clock while a toast is being looked at or is held back out of sight.
// ---------------------------------------------------------------------------------------------

const TOAST_FOOTER_GAP_PX = 8;
const TOAST_LIMIT = 3;
// A pin window is 168px tall, so one toast at a time is all it can hold. For the same reason an
// error there does not wait to be dismissed: it would sit over the pin's tile until someone clicked
// it, and a pin on the desktop layer may never get the keyboard focus that closes it. It lives as
// long as a warning does, with the same pause while it is being read.
const TOAST_PIN_LIMIT = 1;
// Warnings are read, not glanced at: long enough for the sentence at a reading pace.
const TOAST_MIN_WARNING_MS = 6000;
const TOAST_MS_PER_CHARACTER = 55;
// After the pointer leaves or focus moves on, the toast stays long enough to see it go.
const TOAST_RESUME_MIN_MS = 1500;
const TOAST_TYPES = new Set(['success', 'error', 'warning', 'info']);

// Where a toast must not sit: the controls its surface is waiting on. Dialogs come first, because
// anything behind an open dialog is covered by its backdrop and no longer matters.
const TOAST_DIALOG_AVOID_SELECTOR = '.modal:not(.hidden):not(.modal-closing) .modal-footer';
const TOAST_WIZARD_AVOID_SELECTOR = '.first-run-onboarding:not(.hidden) .first-run-actions';
// The connection panel is kept clear whole, not only its buttons: its title and message are the one
// explanation of a dashboard that has stopped working.
const TOAST_STATE_PANEL_SELECTOR = '.widget-state-panel';
// A scroll that moves one of these can bring it to where the stack rests, or take it away.
const TOAST_SCROLLED_SURFACES = `${TOAST_WIZARD_AVOID_SELECTOR}, ${TOAST_STATE_PANEL_SELECTOR}`;

// While one of these is on screen Escape is not for the toasts: it ends a mode.
const TOAST_ESCAPE_YIELD_SELECTOR = '#quick-controls.reorganize-mode';

// Timing per toast: how long is left, what is stopping its clock, and the live timer.
const toastTiming = new WeakMap();
// Names each message, so the close button can say which one it closes.
let toastMessageCounter = 0;

/**
 * Play the toast exit animation and then detach the toast.
 *
 * Safe to call repeatedly: the first call marks the toast as dismissing so the auto-dismiss timer
 * and a user click cannot double-remove it.
 * @param {HTMLElement} toast - The toast element to dismiss.
 */
function dismissToast(toast) {
  if (!toast || toast.dataset?.dismissing === 'true') return;
  if (toast.dataset) toast.dataset.dismissing = 'true';
  const timing = toastTiming.get(toast);
  clearTimeout(timing?.timer);
  toastTiming.delete(toast);
  // A toast that had keyboard focus hands it back to where the user was, not to <body>.
  if (timing?.returnTo?.isConnected && toast.contains(document.activeElement)) {
    timing.returnTo.focus({ preventScroll: true });
  }

  let settled = false;
  let fallbackTimer = null;

  const handleAnimationEnd = (event) => {
    if (event.target !== toast) return;
    finish();
  };

  function finish() {
    if (settled) return;
    settled = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    toast.removeEventListener?.('animationend', handleAnimationEnd);
    toast.remove();
    layoutToasts();
  }

  if (shouldSkipExitAnimation()) {
    finish();
    return;
  }

  toast.addEventListener?.('animationend', handleAnimationEnd);
  toast.classList.add('toast-closing');
  fallbackTimer = setTimeout(finish, TOAST_EXIT_FALLBACK_MS);
}

/**
 * Dismiss every toast that was shown with the given `source`.
 * @param {string} source - The tag passed to {@link showToast}.
 */
function dismissToasts(source) {
  const container = document.getElementById('toast-container');
  getLiveToasts(container)
    .filter((toast) => toast.dataset.source === source)
    .forEach(dismissToast);
}

function getLiveToasts(container) {
  return Array.from(container?.querySelectorAll?.('.toast') || []).filter(
    (toast) => toast.dataset?.dismissing !== 'true'
  );
}

function scheduleToastDismiss(toast, delay) {
  const timing = toastTiming.get(toast);
  if (!timing) return;
  clearTimeout(timing.timer);
  timing.timer = null;
  timing.remaining = delay;
  timing.startedAt = Date.now();
  if (!timing.paused && Number.isFinite(delay)) {
    timing.timer = setTimeout(() => dismissToast(toast), delay);
  }
}

// The clock stops while anything holds the toast: the pointer or the keyboard focus on it, or no
// room for it on screen. Each reason is kept apart, so the pointer leaving a toast that has just
// been held back out of sight does not start its clock again.
function holdToastClock(toast, reason, holding) {
  const timing = toastTiming.get(toast);
  if (!timing) return;
  if (holding) timing.holds.add(reason);
  else timing.holds.delete(reason);
  setToastPaused(toast, timing.holds.size > 0);
}

function setToastPaused(toast, paused) {
  const timing = toastTiming.get(toast);
  if (!timing || timing.paused === paused) return;
  timing.paused = paused;
  if (paused) {
    clearTimeout(timing.timer);
    timing.timer = null;
    if (Number.isFinite(timing.remaining)) {
      timing.remaining = Math.max(0, timing.remaining - (Date.now() - timing.startedAt));
    }
    return;
  }
  if (Number.isFinite(timing.remaining)) {
    scheduleToastDismiss(toast, Math.max(timing.remaining, TOAST_RESUME_MIN_MS));
  }
}

function isPinWindow() {
  return !!document.body?.classList.contains('desktop-pin-mode');
}

// How long a toast stays when nobody is reading it. Problems wait to be dismissed: an error that
// vanishes after two seconds is an error the user may never learn about, and it is announced as an
// alert for the same reason. A pin window cannot hold one that long (see TOAST_PIN_LIMIT).
function getToastLifetime(type, message, timeout, inPin = false) {
  if (type === 'error' && !inPin) return Infinity;
  if (type === 'warning' || type === 'error') {
    return Math.max(timeout, TOAST_MIN_WARNING_MS, 1500 + TOAST_MS_PER_CHARACTER * message.length);
  }
  return timeout;
}

/**
 * Keep the toast stack clear of what its surface is waiting on.
 *
 * Toasts sit at the bottom of the window, which is also where a dialog keeps its footer buttons
 * (Close, Save, Turn On) and where the first-run wizard keeps Next. A stack that would cover one of
 * those where it rests is lifted above it. The connection panel is kept clear whole (see
 * layoutToastsBesidePanel). The layout is recomputed whenever one of them opens or closes, as well
 * as when a toast is added, so a stack that was already up does not end up covering a footer that
 * appeared afterwards, or float where one used to be. A scroll that moves the connection panel
 * recomputes it too: in a short window the panel can come up from below the fold to where the
 * stack rests.
 */
function layoutToasts() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toast-container');
  if (!container) return;
  placeToastStack(container);
  // A toast held back is not on screen to be read, so its clock waits for it to come back. This runs
  // after the stack is placed, because placing it lets every held toast back before it holds some
  // again.
  getLiveToasts(container).forEach((toast) =>
    holdToastClock(toast, 'out-of-sight', toast.classList.contains('toast-held'))
  );
}

function placeToastStack(container) {
  container.style.removeProperty('bottom');
  // Held back beside the connection panel, a toast comes back whenever the stack is laid out again.
  container
    .querySelectorAll('.toast-held')
    .forEach((toast) => toast.classList.remove('toast-held'));
  if (!container.querySelector('.toast')) return;
  const footers = visibleToastObstacles(TOAST_DIALOG_AVOID_SELECTOR);
  if (footers.length || document.querySelector('.modal:not(.hidden):not(.modal-closing)')) {
    dockToastsAbove(container, footers);
    return;
  }
  const [panel] = visibleToastObstacles(TOAST_STATE_PANEL_SELECTOR);
  if (panel) {
    layoutToastsBesidePanel(container, panel);
    return;
  }
  dockToastsAbove(container, visibleToastObstacles(TOAST_WIZARD_AVOID_SELECTOR));
}

function visibleToastObstacles(selector) {
  return (
    Array.from(document.querySelectorAll(selector))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect())
      // A surface scrolled out of view has nothing for a toast to cover.
      .filter((rect) => rect.bottom > 0 && rect.top < window.innerHeight)
  );
}

// From where the stack rests, then from the lowest control up: each one it would cover, or come
// closer to than the gap, moves it above that control. One that it would not cover leaves it down:
// lifting it above buttons higher up the window put it over what they belong to.
function dockToastsAbove(container, obstacles) {
  if (!obstacles.length) return;
  const rest = container.getBoundingClientRect();
  const height = rest.bottom - rest.top;
  let floor = rest.bottom;
  obstacles
    .sort((a, b) => b.bottom - a.bottom)
    .forEach((rect) => {
      if (rect.top < floor && rect.bottom + TOAST_FOOTER_GAP_PX > floor - height) {
        floor = rect.top - TOAST_FOOTER_GAP_PX;
      }
    });
  if (floor !== rest.bottom) placeToastFloor(container, floor);
}

function placeToastFloor(container, floor) {
  container.style.bottom = `${Math.round(Math.max(0, window.innerHeight - floor))}px`;
}

/**
 * The connection panel sits above Quick Access, so in the default window the stack rests below it,
 * over the dimmed tiles. Where it would cover the panel instead (a narrow window, a full stack), it
 * goes above the panel, over the weather and media cards, which say nothing new while Home
 * Assistant is away, as long as it fits there under the window's header. A stack too tall for
 * either place holds back its oldest toasts until it fits; they come back once there is room again,
 * when the panel goes or the window grows, with the time they had left when they went (never less
 * than the short moment a toast gets after the pointer leaves it). Docked
 * above the panel's buttons, as the stack once was, it covered the panel's own message, and an
 * error toast stays until it is dismissed. Only a single toast with no room on either side still
 * does that, to keep Retry within reach.
 */
function layoutToastsBesidePanel(container, panel) {
  const header = document.querySelector('.widget-header')?.getBoundingClientRect();
  const ceiling = (header?.bottom > 0 ? header.bottom : 0) + TOAST_FOOTER_GAP_PX;
  // Oldest first, never the newest, and never one the keyboard focus is in: hiding that one would
  // drop the focus to the page, out of the toast the user had tabbed to.
  const holdable = getLiveToasts(container)
    .slice(0, -1)
    .filter((toast) => !toast.contains(document.activeElement));
  for (let held = 0; ; held += 1) {
    const rest = container.getBoundingClientRect();
    const height = rest.bottom - rest.top;
    const clear =
      rest.top >= panel.bottom + TOAST_FOOTER_GAP_PX ||
      rest.bottom + TOAST_FOOTER_GAP_PX <= panel.top;
    if (clear) return;
    const floor = panel.top - TOAST_FOOTER_GAP_PX;
    if (floor - height >= ceiling) {
      placeToastFloor(container, floor);
      return;
    }
    if (held >= holdable.length) break;
    holdable[held].classList.add('toast-held');
  }
  dockToastsAbove(
    container,
    visibleToastObstacles(`${TOAST_STATE_PANEL_SELECTOR} .widget-state-actions`)
  );
}

// At most once a frame, and only while a toast is showing and the scroll moved a surface the stack
// keeps clear of: a scroll anywhere else changes nothing for the toasts.
let toastScrollFrame = 0;
function layoutToastsOnScroll(event) {
  if (toastScrollFrame || !document.querySelector('#toast-container .toast')) return;
  if (!event.target?.querySelector?.(TOAST_SCROLLED_SURFACES)) return;
  toastScrollFrame = window.requestAnimationFrame(() => {
    toastScrollFrame = 0;
    layoutToasts();
  });
}

let toastLayoutWired = false;
function wireToastLayout() {
  if (toastLayoutWired || typeof window === 'undefined') return;
  toastLayoutWired = true;
  installDialogKeyRouter();
  window.addEventListener('resize', layoutToasts);
  // Scroll events do not bubble; caught on the way down, one listener hears the dashboard's.
  document.addEventListener('scroll', layoutToastsOnScroll, { capture: true, passive: true });
  // The wizard, the connection panel and the like announce themselves with a class on <body>.
  if (typeof MutationObserver === 'function' && document.body) {
    new MutationObserver(layoutToasts).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}

// A dialog is often filled in after it opens: createEntityDetailModal hands its caller an open,
// empty dialog, and the caller builds the body and sometimes the footer. A stack that was already
// up would stay docked where the footer was going to be, over buttons that did not exist when it
// was placed. So while a dialog is open, whatever is added to or taken out of it re-docks the stack.
const dialogLayoutWatchers = new WeakMap();

function watchDialogLayout(modal) {
  if (dialogLayoutWatchers.has(modal) || typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => layoutToasts());
  observer.observe(modal, { childList: true, subtree: true });
  dialogLayoutWatchers.set(modal, observer);
}

function unwatchDialogLayout(modal) {
  dialogLayoutWatchers.get(modal)?.disconnect();
  dialogLayoutWatchers.delete(modal);
}

// With no dialog open, Escape sends away the newest toast. Errors stay until dismissed, and
// reaching one by Tab means walking the whole page first.
function dismissNewestToastForEscape(event) {
  // Reorganizing Quick Access ends on Escape (its notice says "Esc to finish"), and that mode's
  // handler can sit before or after this one on the document. A toast that took the key first,
  // the notice itself included, would make the shortcut need a second press. This is only reached
  // with no dialog open and the key not used yet, the two tests the mode applies before it takes
  // the key, so yielding here never leaves Escape with nobody to answer it.
  if (document.querySelector(TOAST_ESCAPE_YIELD_SELECTOR)) return;
  const container = document.getElementById('toast-container');
  const newest = getLiveToasts(container).pop();
  if (!newest) return;
  // Typing in a field is not a request to clear the notice.
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  dismissToast(newest);
}

/**
 * Display a toast notification in the element with id "toast-container".
 *
 * The toast leads with a status icon matching its type and exits through the shared
 * `.toast-closing` animation. Errors and warnings are announced as alerts and carry a close
 * button, which is the keyboard's way to them; errors stay until dismissed (in a pin window, as
 * long as a warning) and warnings stay long enough to read. Every toast pauses while the pointer
 * or keyboard focus is on it, or while it is held back out of sight beside the connection panel.
 * Each is dismissed by click or by Escape, and is folded into an identical toast already showing.
 * At most three stay on screen at once (one in a pin window).
 *
 * @param {string} message - Text to show inside the toast.
 * @param {string} [type='success'] - Visual variant/class to apply ('success', 'error', 'warning' or 'info').
 * @param {number} [timeout=2000] - Time in milliseconds before a success or info toast begins animating out.
 * @param {Object} [options] - Extra behaviour.
 * @param {boolean} [options.passive=false] - A notice that asks nothing of the user: it ignores the pointer, so it never swallows a drag aimed at what is under it, and cannot take focus.
 * @param {string} [options.source] - Tags the toast so its caller can take it down later with {@link dismissToasts}, without keeping hold of the element.
 * @param {string} [options.detail] - A second, quieter line under the message.
 * @param {Array<{id?: string, label: string, icon?: string, onClick: Function}>} [options.actions] - Buttons under the message. A press runs its action and dismisses the toast; a toast with actions also carries a close button, so the keyboard can reach and leave it.
 * @returns {HTMLElement|undefined} The toast element, or undefined when it could not be shown.
 */
function showToast(
  message,
  type = 'success',
  timeout = 2000,
  { passive = false, source = '', detail = '', actions = [] } = {}
) {
  try {
    const container = document.getElementById('toast-container');
    if (!container) return undefined;
    wireToastLayout();
    const kind = TOAST_TYPES.has(type) ? type : 'info';
    const text = String(message ?? '');
    const inPin = isPinWindow();
    const lifetime = getToastLifetime(kind, text, timeout, inPin);

    // The same message twice at once is one problem reported twice: the first stays, with a fresh
    // clock, instead of a second toast joining the stack.
    const showing = getLiveToasts(container).find(
      (existing) =>
        existing.classList.contains(kind) &&
        existing.querySelector('.toast-message')?.textContent === text
    );
    if (showing) {
      scheduleToastDismiss(showing, lifetime);
      layoutToasts();
      return showing;
    }

    // A full stack makes room by letting go of the oldest notice, an error last: it is the one
    // the user has not necessarily seen.
    const limit = inPin ? TOAST_PIN_LIMIT : TOAST_LIMIT;
    let live = getLiveToasts(container);
    while (live.length >= limit) {
      const evicted = live.find((existing) => !existing.classList.contains('error')) || live[0];
      dismissToast(evicted);
      live = live.filter((existing) => existing !== evicted);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    if (source) toast.dataset.source = source;
    // The container is a polite live region for the quiet kinds; a problem is interrupting.
    if (kind === 'error' || kind === 'warning') toast.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    setLineIconContent(icon, TOAST_ICON_NAMES[kind]);
    toast.appendChild(icon);

    const body = document.createElement('span');
    body.className = 'toast-message';
    body.textContent = text;
    const toastActions = passive || !Array.isArray(actions) ? [] : actions.filter(Boolean);
    if (detail || toastActions.length) {
      // The message keeps its own element, which the duplicate check above reads; the detail line
      // and the buttons stack under it.
      const column = document.createElement('div');
      column.className = 'toast-body';
      column.appendChild(body);
      if (detail) {
        const detailEl = document.createElement('span');
        detailEl.className = 'toast-detail';
        detailEl.textContent = String(detail);
        column.appendChild(detailEl);
      }
      if (toastActions.length) {
        const row = document.createElement('div');
        row.className = 'toast-actions';
        toastActions.forEach((action) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'toast-action';
          if (action.id) button.dataset.action = action.id;
          if (action.icon) {
            const glyph = document.createElement('span');
            glyph.className = 'toast-action-icon';
            glyph.setAttribute('aria-hidden', 'true');
            setLineIconContent(glyph, action.icon);
            button.appendChild(glyph);
          }
          button.appendChild(document.createTextNode(String(action.label ?? '')));
          button.addEventListener('click', (event) => {
            // The toast's own click handler would dismiss it as well; once is enough.
            event.stopPropagation();
            dismissToast(toast);
            try {
              action.onClick?.(event);
            } catch (error) {
              console.error('Toast action failed:', error);
            }
          });
          row.appendChild(button);
        });
        column.appendChild(row);
      }
      toast.appendChild(column);
    } else {
      toast.appendChild(body);
    }

    toastTiming.set(toast, {
      remaining: lifetime,
      startedAt: Date.now(),
      timer: null,
      holds: new Set(),
    });

    if (passive) {
      toast.classList.add('toast-passive');
    } else {
      // A click anywhere on it dismisses it, and so does Escape with focus inside it.
      toast.addEventListener('click', () => dismissToast(toast));
      toast.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        dismissToast(toast);
      });
      if (kind === 'error' || kind === 'warning' || toastActions.length) {
        // The keyboard's way to a problem that waits: a real button, so a screen reader that
        // reaches it by Tab hears what it does, and which message it closes. The toast itself is
        // not a Tab stop: a focusable box with no role said only its text.
        body.id = `toast-message-${++toastMessageCounter}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.setAttribute('aria-label', t('Close'));
        close.setAttribute('aria-describedby', body.id);
        setIconContent(close, 'close', { size: 14 });
        toast.appendChild(close);
      }
      // Reading takes longer than the clock allows for: hold it while it is under the pointer
      // or focused, then give it a moment more.
      toast.addEventListener('pointerenter', () => holdToastClock(toast, 'pointer', true));
      toast.addEventListener('pointerleave', () => holdToastClock(toast, 'pointer', false));
      toast.addEventListener('focusin', (event) => {
        const timing = toastTiming.get(toast);
        if (timing && event.relatedTarget && !toast.contains(event.relatedTarget)) {
          timing.returnTo = event.relatedTarget;
        }
        holdToastClock(toast, 'focus', true);
      });
      toast.addEventListener('focusout', () => holdToastClock(toast, 'focus', false));
    }

    container.appendChild(toast);
    scheduleToastDismiss(toast, lifetime);
    layoutToasts();
    return toast;
  } catch (error) {
    console.error('Error showing toast:', error);
    return undefined;
  }
}

const FOCUSABLE_SELECTOR =
  'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';

// Read at key time rather than when the trap starts: dialogs add, remove and disable controls
// while open, and a stale list lets Tab walk out of the dialog.
function getFocusableElements(modal) {
  return Array.from(modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || []).filter(
    (element) =>
      !element.disabled &&
      !element.closest('[hidden], .hidden') &&
      element.checkVisibility?.() !== false
  );
}

function isFocusTrapModalShown(modal) {
  if (!modal?.isConnected || modal.hidden) return false;
  if (modal.classList.contains('hidden') || modal.classList.contains('modal-closing')) return false;
  return modal.style?.display !== 'none';
}

function getTopFocusTrapModal() {
  const modals = Array.from(activeFocusTrapModals);
  for (let index = modals.length - 1; index >= 0; index -= 1) {
    if (isFocusTrapModalShown(modals[index])) return modals[index];
  }
  return null;
}

/**
 * Whether a dialog is open. While one is, Escape and Enter belong to it and not to the dashboard
 * behind it (leaving Reorganize mode, for one).
 * @returns {boolean}
 */
function hasOpenDialog() {
  return getTopFocusTrapModal() !== null;
}

/**
 * Keep Tab working in an open dialog after focus has fallen back to `<body>`.
 *
 * A dialog's keydown listeners only hear keys while focus is inside it, and the browser drops
 * focus to `<body>` whenever the focused control is disabled or re-rendered. Tab then walks the
 * page behind an `aria-modal` dialog. This brings Tab back into the top dialog. Escape needs no
 * help: the document-level router (see routeDialogKeydown) hears it wherever focus is.
 * @param {KeyboardEvent} event - A keydown event seen on the window before any other listener.
 */
function handleKeydownWithoutFocus(event) {
  if (event.key !== 'Tab') return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const modal = getTopFocusTrapModal();
  if (!modal) return;
  // Let the browser move focus first: after a click on the dialog's text it continues from that
  // spot. Only bring focus back if it went to the page behind the dialog.
  const backwards = event.shiftKey;
  setTimeout(() => {
    if (!isFocusTrapModalShown(modal) || modal.contains(document.activeElement)) return;
    const focusable = getFocusableElements(modal);
    (backwards ? focusable[focusable.length - 1] : focusable[0])?.focus();
  }, 0);
}

let keydownWithoutFocusInstalled = false;
function installKeydownWithoutFocusHandler() {
  if (keydownWithoutFocusInstalled || typeof window === 'undefined') return;
  keydownWithoutFocusInstalled = true;
  window.addEventListener('keydown', handleKeydownWithoutFocus, true);
}

// Entity tiles are rebuilt when their entity changes, so a dialog opened from a tile may close
// after the tile it would return focus to has been replaced. Remember enough to find the new one.
function describeTileFocusTarget(element) {
  const tile = element?.closest?.('[data-entity-id]');
  if (!tile) return null;
  return {
    entityId: tile.dataset.entityId,
    scopeId: tile.parentElement?.closest('[id]')?.id || null,
    className: element === tile ? null : element.classList?.[0] || null,
  };
}

function findTileFocusTarget(descriptor) {
  if (!descriptor) return null;
  const scope = (descriptor.scopeId && document.getElementById(descriptor.scopeId)) || document;
  const tile = Array.from(scope.querySelectorAll('[data-entity-id]')).find(
    (candidate) => candidate.dataset.entityId === descriptor.entityId
  );
  if (!tile) return null;
  return (descriptor.className && tile.getElementsByClassName(descriptor.className)[0]) || tile;
}

// Lists inside and behind a dialog are rebuilt while it is open, so the control that opened it may
// be replaced by an equivalent one. A rebuilt control keeps its id, or carries `data-focus-key`
// when it has none (several rows share one button class), and that says which one it was.
function describeFocusKey(element) {
  if (!element || element === document.body) return null;
  const key = element.dataset?.focusKey || null;
  const id = element.id || null;
  return key || id ? { key, id } : null;
}

/**
 * Find the control carrying a `data-focus-key`.
 * @param {string} key - The key a rebuilt list gave the control.
 * @param {ParentNode} [scope=document] - Where to look.
 * @returns {HTMLElement|null}
 */
function findFocusKey(key, scope = document) {
  if (!key) return null;
  return (
    Array.from(scope.querySelectorAll('[data-focus-key]')).find(
      (candidate) => candidate.dataset.focusKey === key
    ) || null
  );
}

function findFocusKeyTarget(descriptor, scope = document) {
  if (!descriptor) return null;
  return (
    findFocusKey(descriptor.key, scope) || document.getElementById(descriptor.id || '') || null
  );
}

/**
 * Run a render that rebuilds part of the page and keep the keyboard where it was.
 *
 * Replacing the focused control sends focus to `<body>`, so the next Tab starts from the top of
 * the page. When focus was inside `container`, the equivalent control (same id or
 * `data-focus-key`) takes it back after `render`; failing that the `fallback`, then the control now
 * at the same position, so deleting a row lands on its neighbour.
 *
 * @param {HTMLElement|null} container - The element whose children `render` rebuilds.
 * @param {Function} render - Rebuilds the container; its return value is passed through.
 * @param {Object} [options] - Focus behaviour.
 * @param {HTMLElement|string|Function} [options.fallback] - Element, selector or callback used when the
 *   focused control no longer exists.
 * @returns {*} Whatever `render` returned.
 */
function renderKeepingFocus(container, render, { fallback = null } = {}) {
  const active = document.activeElement;
  const hadFocus = !!container && !!active && active !== container && container.contains(active);
  if (!hadFocus) return render();
  const descriptor = describeFocusKey(active);
  const position = getFocusableElements(container).indexOf(active);
  const result = render();
  const now = document.activeElement;
  if (now && now !== document.body && now.isConnected) return result;
  // A control that came back hidden (a Clear button with nothing left to clear) cannot take focus.
  let target = findFocusKeyTarget(descriptor, container);
  if (target?.checkVisibility?.() === false) target = null;
  if (!target && fallback) {
    const resolved = typeof fallback === 'function' ? fallback() : fallback;
    target = typeof resolved === 'string' ? document.querySelector(resolved) : resolved;
  }
  if (!target) {
    const remaining = getFocusableElements(container);
    target = remaining[Math.min(Math.max(position, 0), remaining.length - 1)] || null;
  }
  target?.focus?.({ preventScroll: true });
  return result;
}

/**
 * Disable controls while something is saved, and hand keyboard focus back when they are enabled
 * again. The browser drops focus to `<body>` when the focused control becomes disabled and does not
 * restore it on re-enable, so a keyboard user loses their place after every save.
 * @param {Iterable<HTMLElement|null>} controls - The controls to disable; nulls are skipped.
 * @returns {Function} Re-enables them and restores focus if the page was left with none.
 */
function disableControlsKeepingFocus(controls) {
  const list = Array.from(controls).filter(Boolean);
  const focused = document.activeElement;
  const hadFocus = list.includes(focused);
  list.forEach((control) => {
    control.disabled = true;
  });
  return () => {
    list.forEach((control) => {
      control.disabled = false;
    });
    const active = document.activeElement;
    if (hadFocus && focused.isConnected && (!active || active === document.body)) {
      focused.focus({ preventScroll: true });
    }
  };
}

/**
 * Pick the control a dialog should focus when it opens: the one the caller asked for, one marked
 * `data-initial-focus`, or else the first control that is not in the header. The header's Close
 * button comes first in the DOM, and landing there means a stray Enter or Space dismisses the
 * dialog and the user has to Tab before they can type.
 * @param {HTMLElement} modal - The dialog overlay.
 * @param {HTMLElement|string|Function|undefined} initialFocus - Element, selector inside the dialog,
 *   or a callback returning one.
 * @returns {HTMLElement|null}
 */
function resolveInitialFocus(modal, initialFocus) {
  const requested =
    typeof initialFocus === 'function'
      ? initialFocus(modal)
      : typeof initialFocus === 'string'
        ? modal.querySelector(initialFocus)
        : initialFocus;
  if (requested && requested.isConnected !== false && !requested.disabled) return requested;
  const marked = modal.querySelector('[data-initial-focus]:not(:disabled)');
  if (marked) return marked;
  const focusable = getFocusableElements(modal);
  return focusable.find((element) => !element.closest('.modal-header')) || focusable[0] || null;
}

// A text field that opens with a value in it (a name being edited) starts selected, so typing
// replaces the name instead of landing in front of it.
function focusInitialControl(control) {
  if (!control) return;
  control.focus();
  if (control.matches?.('input:not([type]), input[type="text"], input[type="search"]')) {
    if (control.value) control.select?.();
  }
}

/**
 * Activate a focus trap inside a modal element so keyboard Tab navigation cycles within it.
 *
 * Attaches a keydown handler to the provided modal that confines Tab (and Shift+Tab) focus movement to the modal's focusable descendants, sets focus to the first meaningful control, and records the previously focused element for later restoration. The handler is stored in the module-level `focusTrapHandlers` WeakMap keyed by the modal.
 * Only {@link openDialog} calls this, after giving the modal its dialog layer.
 * @param {HTMLElement} modal - The modal container element within which focus should be trapped.
 * @param {Object} [options] - Trap behaviour.
 * @param {HTMLElement|string|Function|false} [options.initialFocus] - Element (or selector, or callback returning one) to focus instead of the first control outside the header, or false to leave focus where the caller puts it.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus goes on release when the opener has been replaced and cannot be found again.
 * @param {Object} [options.opener] - The opener record of a dialog this one replaces (internal).
 */
function trapFocus(modal, { initialFocus, focusFallback = null, opener = null } = {}) {
  try {
    const existingHandler = focusTrapHandlers.get(modal);
    if (existingHandler) {
      modal.removeEventListener('keydown', existingHandler);
    }
    // A dialog that replaces another takes over the first one's opener, so Escape still lands
    // where the user started and not on a control inside the dialog that went away.
    focusTrapOpeners.set(
      modal,
      opener || {
        element: document.activeElement,
        tile: describeTileFocusTarget(document.activeElement),
        key: describeFocusKey(document.activeElement),
        fallback: focusFallback,
      }
    );
    const handler = (e) => {
      // Overlays with their own Tab order (camera preview, command palette) already moved focus.
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const focusable = getFocusableElements(modal);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modal.addEventListener('keydown', handler);
    focusTrapHandlers.set(modal, handler);
    activeFocusTrapModals.delete(modal);
    activeFocusTrapModals.add(modal);
    installKeydownWithoutFocusHandler();
    if (initialFocus !== false) {
      // Resolved when the timer fires, not now: callers add content in the tick after opening.
      setTimeout(() => {
        if (!modal.isConnected) return;
        focusInitialControl(resolveInitialFocus(modal, initialFocus));
      }, 0);
    }
  } catch (error) {
    console.error('Error trapping focus:', error);
  }
}

/**
 * Decide whether a modal being released still owns the focus it is about to hand back.
 *
 * {@link closeModal} defers the release until the exit animation ends, so a handler that closes one
 * dialog in order to open another (entity picker -> alert config) will already have focused the new
 * dialog's first field by the time the release runs. Restoring the old focus there would drop the
 * caret behind an open `aria-modal` dialog, so only restore when nothing else has claimed focus:
 * either it sits on `document.body` (the browser's landing spot once a focused element is hidden or
 * detached) or it is still inside the modal being released.
 *
 * @param {HTMLElement} modal - The modal whose focus trap is being released.
 * @returns {boolean} True when the previously focused element should be refocused.
 */
function canRestorePreviousFocus(modal) {
  try {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    return !!modal?.contains?.(active);
  } catch {
    return true;
  }
}

/**
 * Release a focus trap started by {@link trapFocus} and hand focus back to where it was.
 *
 * The opener is found again if it was rebuilt meanwhile: by its id or `data-focus-key`, as the
 * Quick Access tile it belonged to, or failing both through the `focusFallback` given to the trap.
 * @param {HTMLElement} [modal] - The modal to release; the top trapped modal when omitted.
 * @param {Object} [options] - Release behaviour.
 * @param {boolean} [options.restoreFocus=true] - False when the caller moves focus itself.
 * @param {boolean} [options.restoreNow=false] - Hand focus back before returning, and not only on
 *   the next tick. For a dialog that closes at once, because the next thing the caller does may
 *   open another dialog, which then records the control that has focus as the one to return to.
 */
function releaseFocusTrap(modal, { restoreFocus = true, restoreNow = false } = {}) {
  try {
    let targetModal = modal;
    if (!targetModal) {
      const activeModals = Array.from(activeFocusTrapModals);
      for (let index = activeModals.length - 1; index >= 0; index -= 1) {
        const candidate = activeModals[index];
        if (!candidate?.isConnected) {
          activeFocusTrapModals.delete(candidate);
          continue;
        }
        targetModal = candidate;
        break;
      }
    }
    if (!targetModal) return;

    const handler = focusTrapHandlers.get(targetModal);
    if (handler) targetModal.removeEventListener('keydown', handler);
    focusTrapHandlers.delete(targetModal);
    activeFocusTrapModals.delete(targetModal);
    dialogLayers.delete(targetModal);
    unwatchDialogLayout(targetModal);
    targetModal.style?.removeProperty('--dialog-depth');

    const {
      element: previousFocus,
      tile: previousTile,
      key: previousKey,
      fallback,
    } = focusTrapOpeners.get(targetModal) || {};
    focusTrapOpeners.delete(targetModal);
    if (restoreFocus && (previousFocus?.focus || fallback)) {
      const restore = () => {
        // The opener can have been replaced, or can sit in a dialog that has closed since.
        const usable = (element) => !!element?.isConnected && element.checkVisibility?.() !== false;
        const resolveFallback = () => {
          const resolved = typeof fallback === 'function' ? fallback() : fallback;
          return typeof resolved === 'string' ? document.querySelector(resolved) : resolved;
        };
        const target = [
          previousFocus === document.body ? null : previousFocus,
          findFocusKeyTarget(previousKey),
          findTileFocusTarget(previousTile),
          fallback ? resolveFallback() : null,
        ].find(usable);
        if (!target) return;
        if (!canRestorePreviousFocus(targetModal)) return;
        target.focus();
      };
      // On the next tick, once whatever closed this dialog has finished with focus; or now as well
      // for a dialog that closed at once (the palette running a command that opens a pop-up), so
      // the pop-up finds focus back on the tile and returns there in turn.
      if (restoreNow) restore();
      setTimeout(restore, 0);
    }
  } catch (error) {
    console.error('Error releasing focus trap:', error);
  }
}

// ---------------------------------------------------------------------------------------------
// Dialog layers. Every dialog opens and closes through openDialog()/closeDialog(), which own the
// parts that must agree between dialogs: the ARIA role and name, the focus trap, where focus lands
// and returns to, which dialog Escape/Enter/backdrop act on, and stacking.
// ---------------------------------------------------------------------------------------------

let dialogLabelCounter = 0;

function ensureElementId(element, prefix) {
  if (!element.id) {
    dialogLabelCounter += 1;
    element.id = `${prefix}-${dialogLabelCounter}`;
  }
  return element.id;
}

function labelDialog(modal, { label, labelledBy }) {
  const requested =
    typeof labelledBy === 'string' ? document.getElementById(labelledBy) : labelledBy;
  if (requested) {
    modal.setAttribute('aria-labelledby', ensureElementId(requested, 'dialog-title'));
    return;
  }
  if (label) {
    modal.setAttribute('aria-label', label);
    modal.removeAttribute('aria-labelledby');
    return;
  }
  // A name that points at nothing (or at a whole content container) names nothing useful.
  const existing = modal.getAttribute('aria-labelledby');
  if (existing && document.getElementById(existing)) return;
  if (modal.getAttribute('aria-label')) return;
  const heading =
    modal.querySelector('.modal-header h1, .modal-header h2, .modal-header h3') ||
    modal.querySelector('h1, h2, h3');
  if (heading) modal.setAttribute('aria-labelledby', ensureElementId(heading, 'dialog-title'));
}

function describeDialog(modal, describedBy) {
  if (!describedBy) return;
  const ids = (Array.isArray(describedBy) ? describedBy : [describedBy])
    .map((node) => (typeof node === 'string' ? node : node && ensureElementId(node, 'dialog-desc')))
    .filter(Boolean);
  if (ids.length) modal.setAttribute('aria-describedby', ids.join(' '));
}

// Presses that start on the dialog and end on the backdrop (selecting text, dragging a slider
// past the edge) are not clicks on the backdrop, and must not dismiss it.
const dialogBackdropWired = new WeakSet();
function wireDialogBackdrop(modal) {
  if (dialogBackdropWired.has(modal)) return;
  dialogBackdropWired.add(modal);
  let pressStartedInside = false;
  modal.addEventListener('pointerdown', (event) => {
    pressStartedInside = event.target !== modal;
  });
  modal.addEventListener('click', (event) => {
    const startedInside = pressStartedInside;
    pressStartedInside = false;
    if (event.target !== modal || startedInside) return;
    const layer = dialogLayers.get(modal);
    if (!layer?.dismiss || !layer.dismissOnBackdrop || getTopFocusTrapModal() !== modal) return;
    void layer.dismiss('backdrop');
  });
}

// Keys that a control activates itself, so Enter there is that control's click and not the
// dialog's default action.
const ENTER_NATIVE_SELECTOR =
  'button, a[href], summary, select, textarea, [role="button"], [role="option"], [role="tab"], ' +
  'input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';

/**
 * Send Escape and Enter to the top dialog, and only to it.
 *
 * One document-level listener instead of one per dialog, so a dialog that opens over another
 * (a confirmation over Settings) is the only one that hears the key, wherever focus happens to
 * be, and the dashboard behind never sees an Escape a dialog used. It runs after the controls
 * inside the dialog, so a dropdown, field or picker that handled the key itself (and called
 * preventDefault) keeps it.
 * @param {KeyboardEvent} event
 */
function routeDialogKeydown(event) {
  // An IME's last key can arrive after the composition has ended with isComposing already false;
  // keyCode 229 still marks it.
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (event.key !== 'Escape' && event.key !== 'Enter') return;
  const modal = getTopFocusTrapModal();
  const layer = modal && dialogLayers.get(modal);
  if (!layer) {
    if (!modal && event.key === 'Escape') dismissNewestToastForEscape(event);
    return;
  }
  // The key that opened this dialog is still on its way up to the document: it was meant for what
  // raised the dialog, so it must not answer the dialog that just appeared.
  if (event === layer.openingEvent) return;
  if (event.key === 'Escape') {
    if (!layer.dismiss) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void layer.dismiss('escape');
    return;
  }
  if (!layer.onEnter || event.repeat || event.target?.closest?.(ENTER_NATIVE_SELECTOR)) return;
  event.preventDefault();
  void layer.onEnter(event);
}

let dialogKeyRouterInstalled = false;
function installDialogKeyRouter() {
  if (dialogKeyRouterInstalled || typeof document === 'undefined') return;
  dialogKeyRouterInstalled = true;
  document.addEventListener('keydown', routeDialogKeydown);
}

/**
 * Open a dialog: reveal it, give it its role, name and description, trap focus in it, move focus
 * to its first meaningful control, and make it the layer Escape, Enter and the backdrop act on.
 *
 * Opening over another dialog stacks above it, and closing returns focus to whatever opened it
 * (or `focusFallback` when that was rebuilt meanwhile). Pair with {@link closeDialog}.
 *
 * @param {HTMLElement} modal - The dialog overlay element (the `.modal` container).
 * @param {Object} [options] - Dialog behaviour.
 * @param {string|null} [options.display='flex'] - Inline display to write, or null to leave visibility to CSS.
 * @param {boolean} [options.alert=false] - Use role="alertdialog": a confirmation or error the user must answer.
 * @param {string} [options.label] - Accessible name when the dialog has no visible heading to point at.
 * @param {string|HTMLElement} [options.labelledBy] - Heading (or its id) that names the dialog; defaults to the first heading in the header.
 * @param {string|HTMLElement|Array} [options.describedBy] - Text (or its id) that describes the dialog, read after the name.
 * @param {HTMLElement|string|Function|false} [options.initialFocus] - First control to focus; defaults to the first one outside the header, or false to leave focus to the caller.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus returns if the opener was rebuilt and cannot be found.
 * @param {Function|null} [options.dismiss] - Called with 'escape' or 'backdrop' when the user dismisses this dialog; defaults to {@link closeDialog}. Null makes it undismissable.
 * @param {boolean} [options.dismissOnBackdrop=true] - False when only Escape and the buttons close it.
 * @param {Function} [options.onEnter] - Called when Enter is pressed outside a button or link, to run the dialog's default action.
 * @param {HTMLElement} [options.replaces] - A dialog being rebuilt in place (a pop-up that gains controls while open). The new one takes its place in the stack and its opener, skips the entry animation, and the caller removes the old element.
 */
function openDialog(modal, options = {}) {
  if (!modal || typeof modal.classList?.remove !== 'function') return;
  const {
    display = 'flex',
    alert = false,
    label,
    labelledBy,
    describedBy,
    initialFocus,
    focusFallback = null,
    dismissOnBackdrop = true,
    onEnter = null,
    replaces = null,
  } = options;
  const dismiss = 'dismiss' in options ? options.dismiss : () => closeDialog(modal);

  modal.setAttribute('role', alert ? 'alertdialog' : 'dialog');
  modal.setAttribute('aria-modal', 'true');
  labelDialog(modal, { label, labelledBy });
  describeDialog(modal, describedBy);

  const alreadyOpen = dialogLayers.has(modal) && isFocusTrapModalShown(modal);
  // The pop-up the user is looking at is rebuilt rather than opened: no second entrance, and the
  // old one's place in the stack and its opener carry over before it is released.
  const inheritedOpener = replaces ? focusTrapOpeners.get(replaces) : null;
  const inheritedDepth = replaces ? replaces.style.getPropertyValue('--dialog-depth') : '';
  if (replaces) {
    modal.classList.add('modal-rebuilt');
    releaseFocusTrap(replaces, { restoreFocus: false });
  }
  openModal(modal, { display });
  // A dialog raised from a keydown handler (Enter on a row, Escape on a field) is opened while that
  // very event is still being dispatched, so the router would otherwise hand it to the new dialog.
  const openingEvent = typeof window !== 'undefined' ? window.event : null;
  dialogLayers.set(modal, {
    dismiss,
    dismissOnBackdrop,
    onEnter,
    openingEvent: openingEvent?.type === 'keydown' ? openingEvent : null,
  });
  wireDialogBackdrop(modal);
  installDialogKeyRouter();

  if (alreadyOpen) {
    // Re-opened while showing (a second long-press): keep the opener it will return focus to. A
    // caller that took focus for itself (initialFocus: false) keeps it.
    if (initialFocus !== false) focusInitialControl(resolveInitialFocus(modal, initialFocus));
  } else {
    // Each dialog opened over another sits one step higher, so the newest is always on top
    // whatever order the elements happen to be in the document.
    const depth = Array.from(activeFocusTrapModals).reduce((highest, other) => {
      if (other === modal || !isFocusTrapModalShown(other)) return highest;
      return Math.max(highest, Number(other.style.getPropertyValue('--dialog-depth') || 0) + 1);
    }, 0);
    modal.style.setProperty('--dialog-depth', inheritedDepth || String(depth));
    trapFocus(modal, { initialFocus, focusFallback, opener: inheritedOpener });
  }
  watchDialogLayout(modal);
  layoutToasts();
}

/**
 * Close a dialog opened with {@link openDialog}: play the exit animation, release the focus trap
 * and return focus to the opener, then re-dock the toasts it was holding up.
 * @param {HTMLElement} modal - The dialog overlay element.
 * @param {Object} [options] - Close behaviour.
 * @param {boolean} [options.remove=false] - Remove the element instead of hiding it (dialogs built per open).
 * @param {boolean} [options.restoreFocus=true] - False when the caller moves focus itself.
 * @param {boolean} [options.animate=true] - False to hide at once, for overlays with no exit animation.
 * @param {Function} [options.onClosed] - Callback invoked after the dialog is hidden or removed.
 * @returns {Promise<void>} Resolves once the dialog has been hidden or removed.
 */
function closeDialog(
  modal,
  { remove = false, restoreFocus = true, animate = true, onClosed = null } = {}
) {
  const closed = closeModal(modal, {
    remove,
    releaseFocus: true,
    restoreFocus,
    animate,
    onClosed: () => {
      layoutToasts();
      onClosed?.();
    },
  });
  // The exit class is already on, so the footer being animated away no longer holds toasts up.
  layoutToasts();
  return closed;
}

/**
 * Ask the user to confirm something, in the shared confirmation dialog.
 *
 * Focus starts on Cancel, so a stray Enter or Space declines. Enter elsewhere in the dialog
 * confirms; Escape and a click outside decline.
 *
 * @param {string} title - Dialog title.
 * @param {string|Node} message - What is being asked; also the dialog's accessible description. Text
 *   is shown as it is, with line breaks kept; a node (a fragment of rows, say) is shown as built, for
 *   a question with facts to read and one thing to heed.
 * @param {Object} [options] - Wording and behaviour.
 * @param {string} [options.confirmText] - Label of the confirm button.
 * @param {string} [options.cancelText] - Label of the cancel button.
 * @param {string} [options.confirmClass='btn-danger'] - Style class of the confirm button.
 * @param {string} [options.alternateText] - Adds a third choice with this label, for questions with
 *   two ways forward and a way back (save, discard, keep editing).
 * @param {string} [options.alternateClass='btn-secondary'] - Style class of the third button.
 * @param {boolean} [options.confirmFirst=false] - Start on the confirm button, for a question whose
 *   safe answer is yes. Only then does Enter outside a button confirm; otherwise it does just what
 *   the focused button does.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus goes afterwards if the
 *   control that raised the question is replaced meanwhile.
 * @returns {Promise<boolean|string>} True for confirm; false for cancel, Escape or a click outside;
 *   'alternate' for the third button.
 */
function showConfirm(title, message, options = {}) {
  return new Promise((resolve) => {
    try {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const messageEl = document.getElementById('confirm-message');
      const cancelBtn = document.getElementById('confirm-cancel-btn');
      const okBtn = document.getElementById('confirm-ok-btn');
      const alternateBtn = document.getElementById('confirm-alternate-btn');

      if (!modal || !titleEl || !messageEl || !cancelBtn || !okBtn) {
        console.error('Confirm modal elements not found');
        resolve(false);
        return;
      }

      // Set content
      titleEl.textContent = title || t('Confirm action');
      if (message && typeof message === 'object' && typeof message.nodeType === 'number') {
        messageEl.replaceChildren(message);
      } else {
        messageEl.textContent = message || t('Are you sure?');
      }
      okBtn.textContent = options.confirmText || t('Confirm');
      cancelBtn.textContent = options.cancelText || t('Cancel');

      // Configure buttons
      okBtn.className = `btn ${options.confirmClass || 'btn-danger'}`;
      if (alternateBtn) {
        alternateBtn.hidden = !options.alternateText;
        alternateBtn.textContent = options.alternateText || '';
        alternateBtn.className = `btn ${options.alternateClass || 'btn-secondary'}`;
      }

      const settle = (result) => {
        cleanup();
        resolve(result);
      };
      const handleConfirm = () => settle(true);
      const handleCancel = () => settle(false);
      const handleAlternate = () => settle('alternate');

      const cleanup = () => {
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        alternateBtn?.removeEventListener('click', handleAlternate);
        void closeDialog(modal);
      };

      // Wire up events
      okBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      alternateBtn?.addEventListener('click', handleAlternate);

      // Show modal. Enter on a focused button is that button's own click, so the dialog's Enter
      // (confirm) only applies elsewhere, and not while the key that opened it is held down. It
      // applies only to a question whose safe answer is yes: one that starts on Cancel is asking
      // about something that cannot be undone, and an Enter that lands on the message text (after
      // a click there) must not be the one that runs it.
      openDialog(modal, {
        alert: true,
        describedBy: messageEl,
        initialFocus: options.confirmFirst ? okBtn : cancelBtn,
        focusFallback: options.focusFallback,
        dismiss: handleCancel,
        onEnter: options.confirmFirst ? handleConfirm : null,
      });
    } catch (error) {
      console.error('Error showing confirm dialog:', error);
      resolve(false);
    }
  });
}

export {
  openDialog,
  closeDialog,
  hasOpenDialog,
  releaseFocusTrap,
  showConfirm,
  showToast,
  dismissToast,
  dismissToasts,
  renderKeepingFocus,
  disableControlsKeepingFocus,
  findFocusKey,
  __forceAnimatedModalTransitions,
};
