/**
 * A pop-up alert card, in its own small window (see src/alert-popup-windows.cjs). It shows what
 * happened, the rule's camera live when it has one, and up to two buttons, then fades away once its
 * time is up. Pointing at it or tabbing into it holds the countdown, so a card being read or used
 * does not leave under the mouse. The time is kept by a timer, not the bar's animation, so a system
 * that asks for less motion (which cuts animations to nothing) still gets the whole time.
 *
 * The card has no websocket. The camera comes through the app's ha:// handler, which adds the
 * credentials in the main process, and a button is carried out by the widget window, which the
 * main process asks on the card's behalf.
 */

import state from './state.js';
import { t } from './i18n.js';
import { formatClockTime } from './format.js';
import { createLineIcon, renderEntityIcon } from './entity-icons.js';
import { getRendererHost } from '@hadw/renderer/host.js';
import { prefersReducedMotion } from './motion.js';

// How often a camera that has no live stream gets a new snapshot instead.
const SNAPSHOT_REFRESH_MS = 3000;
// How long the card takes to fade before it closes.
const LEAVE_MS = 320;
// A button that worked says so this long before it can be pressed again.
const DONE_MS = 2500;

function element(tagName, className, attributes = {}) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

function iconNode(name) {
  const node = createLineIcon(name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/**
 * The camera picture: the live MJPEG stream once it shows a frame, a snapshot until then, and
 * snapshots every few seconds when the camera has no stream to give. Returns a function that stops
 * it, which also ends the stream's connection.
 */
function startCameraFeed(view, cameraEntityId) {
  const host = getRendererHost();
  const { frame, snapshot, stream, badge, badgeLabel, status } = view;
  let stopped = false;
  let snapshotTimer = null;
  let sequence = 0;

  const setStatus = (text) => {
    status.textContent = text;
    status.hidden = !text;
  };
  const setBadge = (live) => {
    badge.hidden = false;
    badge.dataset.live = live ? 'true' : 'false';
    badgeLabel.textContent = live ? t('Live') : t('Snapshot');
  };
  const loadSnapshot = () => {
    if (stopped) return;
    sequence += 1;
    snapshot.src = host.resolveMediaUrl({
      kind: 'camera_snapshot',
      entityId: cameraEntityId,
      preview: `alert-${sequence}`,
      cacheKey: Date.now(),
    });
  };
  const keepRefreshing = () => {
    clearTimeout(snapshotTimer);
    if (stopped || frame.dataset.source === 'stream') return;
    snapshotTimer = setTimeout(() => {
      loadSnapshot();
      keepRefreshing();
    }, SNAPSHOT_REFRESH_MS);
  };

  setStatus(t('Loading snapshot...'));
  snapshot.onload = () => {
    if (stopped) return;
    frame.dataset.hasFrame = 'true';
    if (frame.dataset.source !== 'stream') {
      setStatus('');
      setBadge(false);
    }
    if (snapshot.naturalHeight > snapshot.naturalWidth * 0.9) frame.dataset.tall = 'true';
  };
  snapshot.onerror = () => {
    if (stopped || frame.dataset.hasFrame === 'true') return;
    setStatus(t('Preview unavailable'));
  };

  stream.onload = () => {
    if (stopped) return;
    // A stream endpoint that answers with nothing fires load too; it has no picture.
    if (!stream.naturalWidth || !stream.naturalHeight) {
      stream.onerror();
      return;
    }
    // A second load is the camera closing the stream: go back to snapshots.
    if (frame.dataset.source === 'stream') {
      stream.onerror();
      return;
    }
    frame.dataset.source = 'stream';
    frame.dataset.hasFrame = 'true';
    clearTimeout(snapshotTimer);
    setStatus('');
    setBadge(true);
  };
  stream.onerror = () => {
    if (stopped) return;
    stream.removeAttribute('src');
    frame.dataset.source = 'snapshot';
    if (frame.dataset.hasFrame === 'true') setBadge(false);
    keepRefreshing();
  };

  frame.dataset.source = 'snapshot';
  loadSnapshot();
  stream.src = host.resolveMediaUrl({
    kind: 'camera_stream',
    entityId: cameraEntityId,
    preview: 'alert-stream',
    cacheKey: Date.now(),
  });
  keepRefreshing();

  return () => {
    stopped = true;
    clearTimeout(snapshotTimer);
    snapshot.removeAttribute('src');
    stream.removeAttribute('src');
  };
}

function buildCard() {
  const root = element('section', 'alert-popup', {
    role: 'alertdialog',
    'aria-labelledby': 'alert-popup-title',
    'aria-describedby': 'alert-popup-message',
  });
  root.id = 'alert-popup-root';

  const header = element('div', 'alert-popup-header');
  const open = element('button', 'alert-popup-open', { type: 'button' });
  const icon = element('span', 'alert-popup-icon', { 'aria-hidden': 'true' });
  const heading = element('span', 'alert-popup-heading');
  const title = element('span', 'alert-popup-title', { id: 'alert-popup-title' });
  const message = element('span', 'alert-popup-message', { id: 'alert-popup-message' });
  heading.append(title, message);
  open.append(icon, heading);
  const time = element('span', 'alert-popup-time');
  const close = element('button', 'alert-popup-close', { type: 'button' });
  close.append(iconNode('x'));
  header.append(open, time, close);

  const camera = element('button', 'alert-popup-camera', { type: 'button' });
  const frame = element('span', 'alert-popup-camera-frame');
  const snapshot = element('img', 'alert-popup-camera-snapshot', { alt: '', decoding: 'async' });
  const stream = element('img', 'alert-popup-camera-stream', { alt: '', decoding: 'async' });
  const badge = element('span', 'alert-popup-camera-badge');
  badge.hidden = true;
  const badgeDot = element('span', 'alert-popup-camera-dot', { 'aria-hidden': 'true' });
  const badgeLabel = element('span', 'alert-popup-camera-badge-label');
  badge.append(badgeDot, badgeLabel);
  const status = element('span', 'alert-popup-camera-status');
  const expand = element('span', 'alert-popup-camera-expand', { 'aria-hidden': 'true' });
  expand.append(iconNode('app-window'));
  frame.append(iconNode('cctv'), snapshot, stream, status);
  camera.append(frame, badge, expand);

  const actions = element('div', 'alert-popup-actions', { role: 'group' });
  const progress = element('span', 'alert-popup-progress', { 'aria-hidden': 'true' });

  root.append(header, camera, actions, progress);
  return {
    root,
    open,
    icon,
    title,
    message,
    time,
    close,
    camera,
    frame,
    snapshot,
    stream,
    badge,
    badgeLabel,
    status,
    actions,
    progress,
  };
}

/**
 * Draws a card into `container` and runs it. `send(action, target)` tells the main process what
 * was pressed: 'dismiss', 'open' (with 'camera' for the camera's viewer) or a button's number.
 * Returns { update(popup), dispose() }.
 */
function mountAlertPopup(container, popup, { send } = {}) {
  const view = buildCard();
  container.replaceChildren(view.root);
  let stopCamera = null;
  let cameraEntityId = '';
  let leaving = false;
  let leaveTimer = null;

  const leave = () => {
    if (leaving) return;
    leaving = true;
    view.root.classList.add('is-leaving');
    leaveTimer = setTimeout(
      () => {
        stopCamera?.();
        void send?.('dismiss');
      },
      prefersReducedMotion() ? 0 : LEAVE_MS
    );
  };

  // The countdown runs on a timer, held while the card is pointed at or has the focus. The bar only
  // shows it: CSS holds its animation at the same moments, and when the system asks for less motion
  // the bar stands still (its animation is cut to nothing there, so its end cannot be the signal).
  let remainingMs = 0;
  let deadline = 0;
  let countdownTimer = null;
  let pointedAt = false;
  const isHeld = () => pointedAt || view.root.contains(document.activeElement);
  const resumeCountdown = () => {
    if (countdownTimer || !(remainingMs > 0) || leaving || isHeld()) return;
    deadline = Date.now() + remainingMs;
    countdownTimer = setTimeout(() => {
      countdownTimer = null;
      remainingMs = 0;
      leave();
    }, remainingMs);
  };
  const holdCountdown = () => {
    if (!countdownTimer) return;
    clearTimeout(countdownTimer);
    countdownTimer = null;
    remainingMs = Math.max(0, deadline - Date.now());
  };
  const startCountdown = (seconds) => {
    clearTimeout(countdownTimer);
    countdownTimer = null;
    remainingMs = seconds > 0 ? seconds * 1000 : 0;
    const bar = view.progress;
    bar.hidden = !(seconds > 0);
    bar.classList.remove('is-running');
    if (!(seconds > 0)) return;
    bar.style.animationDuration = `${seconds}s`;
    // A restart needs a style flush between taking the animation off and putting it back.
    void bar.offsetWidth;
    bar.classList.add('is-running');
    resumeCountdown();
  };
  view.root.addEventListener('pointerenter', () => {
    pointedAt = true;
    holdCountdown();
  });
  view.root.addEventListener('pointerleave', () => {
    pointedAt = false;
    resumeCountdown();
  });
  view.root.addEventListener('focusin', holdCountdown);
  // Focus moving from one button to the next passes through the body for a moment.
  view.root.addEventListener('focusout', () => setTimeout(resumeCountdown, 0));

  const runAction = async (button, index, action) => {
    if (button.disabled) return;
    button.disabled = true;
    button.dataset.state = 'busy';
    let result;
    try {
      result = await send?.(index);
    } catch (error) {
      result = { success: false, error: { message: error?.message || String(error) } };
    }
    const label = button.querySelector('.alert-popup-action-label');
    if (result?.success === false) {
      button.dataset.state = 'error';
      label.textContent = t('Retry');
      button.title = result.error?.message || '';
      button.disabled = false;
      return;
    }
    button.dataset.state = 'done';
    label.replaceChildren(iconNode('check'), document.createTextNode(t('Done')));
    button.title = '';
    setTimeout(() => {
      if (!button.isConnected) return;
      button.dataset.state = '';
      label.textContent = action.label;
      button.disabled = false;
    }, DONE_MS);
  };

  const render = (next) => {
    leaving = false;
    clearTimeout(leaveTimer);
    view.root.classList.remove('is-leaving');
    view.root.dataset.hasCamera = next.camera ? 'true' : 'false';
    renderEntityIcon(view.icon, next.icon || { entity_id: next.entityId, state: '' });
    view.title.textContent = next.title;
    view.message.textContent = next.message;
    view.message.hidden = !next.message;
    view.time.textContent = formatClockTime(new Date(next.at || Date.now()));
    view.open.setAttribute('aria-label', `${next.title}. ${t('Open widget')}`);
    view.open.title = t('Open widget');
    view.close.setAttribute('aria-label', t('Dismiss'));
    view.close.title = t('Dismiss');
    view.camera.setAttribute('aria-label', t('Open camera feed'));
    view.camera.title = t('Open camera feed');

    view.camera.hidden = !next.camera;
    if (next.camera !== cameraEntityId) {
      stopCamera?.();
      stopCamera = null;
      delete view.frame.dataset.hasFrame;
      delete view.frame.dataset.tall;
      view.badge.hidden = true;
      cameraEntityId = next.camera || '';
      if (cameraEntityId) stopCamera = startCameraFeed(view, cameraEntityId);
    }

    view.actions.hidden = !next.actions?.length;
    view.actions.setAttribute('aria-label', next.title);
    view.actions.replaceChildren(
      ...(next.actions || []).map((action, index) => {
        const button = element('button', 'alert-popup-action', { type: 'button' });
        const label = element('span', 'alert-popup-action-label');
        label.textContent = action.label;
        const name = element('span', 'alert-popup-action-name');
        name.textContent = action.name || '';
        name.hidden = !action.name;
        button.append(label, name);
        if (action.name) button.setAttribute('aria-label', `${action.label}: ${action.name}`);
        button.addEventListener('click', () => runAction(button, index, action));
        return button;
      })
    );
    startCountdown(Number(next.seconds) || 0);
  };

  view.open.addEventListener('click', () => void send?.('open'));
  view.camera.addEventListener('click', () => void send?.('open', 'camera'));
  view.close.addEventListener('click', leave);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      leave();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  render(popup);
  requestAnimationFrame(() => view.root.classList.add('is-shown'));

  return {
    update: render,
    dispose() {
      stopCamera?.();
      clearTimeout(leaveTimer);
      clearTimeout(countdownTimer);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}

/**
 * The card window's start: its config (for the theme, accent and language), then the card.
 * `applyAppearance(config)` is the renderer's own theming, passed in so this module stays small.
 */
async function initializeAlertPopup({ electronAPI, applyAppearance }) {
  document.body.classList.add('alert-popup-mode');
  const bootstrap = await electronAPI.getAlertPopupBootstrap();
  if (!bootstrap?.popup) {
    await electronAPI.alertPopupAction?.('dismiss');
    return null;
  }
  try {
    applyAppearance?.(bootstrap.config || { homeAssistant: {}, ui: {} });
  } catch (error) {
    console.error('Failed to apply the alert pop-up appearance:', error);
    state.setConfig?.(bootstrap.config || {});
  }
  const container = element('div', 'alert-popup-shell');
  document.body.append(container);
  const card = mountAlertPopup(container, bootstrap.popup, {
    send: (action, target) => electronAPI.alertPopupAction(action, target),
  });
  electronAPI.onAlertPopupUpdate?.((message) => {
    if (message?.id === bootstrap.id && message.popup) card.update(message.popup);
  });
  window.addEventListener('beforeunload', () => card.dispose());
  return card;
}

export { initializeAlertPopup, mountAlertPopup };
