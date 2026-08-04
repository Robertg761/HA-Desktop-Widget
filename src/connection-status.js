/**
 * Shared rendering for the Home Assistant connection status lines (settings
 * panel and first-run wizard).
 *
 * The waiting indicator lives inside the status line rather than beside the
 * action buttons. The settings modal is only about 385px wide in the default
 * window, so a free-floating spinner in the button row overflows as soon as a
 * third button appears or a translated label runs long. Anchoring it to the
 * status text gives it the full modal width and keeps the animation next to the
 * message that explains what is being waited on.
 */

function syncProgressIndicator(status) {
  const shouldShow = status.dataset.busy === 'true' && !status.classList.contains('hidden');
  const existing = status.querySelector('.connection-progress');
  if (!shouldShow) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const track = document.createElement('span');
  track.className = 'connection-progress';
  track.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('span');
  bar.className = 'connection-progress-bar';
  track.appendChild(bar);
  status.appendChild(track);
}

/**
 * Writes a status message, preserving any active progress indicator.
 *
 * The message goes in its own child node so the indicator survives repeated
 * updates; `status.textContent` still returns exactly the message.
 */
function renderConnectionStatus(status, message = '', type = '') {
  if (!status) return;
  let text = status.querySelector('.connection-status-text');
  if (!text) {
    status.textContent = '';
    text = document.createElement('span');
    text.className = 'connection-status-text';
    status.appendChild(text);
  }
  text.textContent = message;
  status.dataset.status = type || '';
  status.classList.toggle('hidden', !message);
  syncProgressIndicator(status);
}

/** Shows or hides the indeterminate waiting indicator on a status line. */
function setConnectionStatusBusy(status, isBusy) {
  if (!status) return;
  if (isBusy) status.dataset.busy = 'true';
  else delete status.dataset.busy;
  syncProgressIndicator(status);
}

export { renderConnectionStatus, setConnectionStatusBusy };
