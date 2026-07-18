import state from './state.js';
import websocket from './websocket.js';
import { escapeHtml, escapeHtmlAttribute, getEntityDisplayName } from './utils.js';
import { showToast } from './ui-utils.js';
import { formatDateTime, t } from './i18n.js';

const CAMERA_PREVIEW_REFRESH_OPTIONS = Object.freeze([
  { value: 'off', label: 'Static icon (Default)', intervalMs: 0 },
  { value: 'live', label: 'Live stream while visible (Higher usage)', intervalMs: 0 },
  { value: '30s', label: 'Snapshot every 30 seconds (Efficient)', intervalMs: 30000 },
  { value: '10s', label: 'Snapshot every 10 seconds', intervalMs: 10000 },
  { value: '5s', label: 'Snapshot every 5 seconds (Frequent)', intervalMs: 5000 },
]);
const CAMERA_PREVIEW_REFRESH_VALUES = new Set(
  CAMERA_PREVIEW_REFRESH_OPTIONS.map((option) => option.value)
);
const CAMERA_PREVIEW_ERROR_RETRY_MS = 30000;
const CAMERA_PREVIEW_LOAD_TIMEOUT_MS = 20000;
const CAMERA_PREVIEW_LIVE_START_TIMEOUT_MS = 30000;
const cameraPreviewRecords = new Map();
const suspendedCameraPreviewEntities = new Set();
let cameraPreviewObserver = null;
let cameraPreviewSequence = 0;
let cameraPreviewLifecycleInstalled = false;
let activeExpandedCameraPreview = null;

function normalizeCameraPreviewRefresh(value) {
  if (typeof value !== 'string') return 'off';
  const normalized = value.trim().toLowerCase();
  return CAMERA_PREVIEW_REFRESH_VALUES.has(normalized) ? normalized : 'off';
}

function getCameraPreviewRefreshMs(value) {
  const normalized = normalizeCameraPreviewRefresh(value);
  return (
    CAMERA_PREVIEW_REFRESH_OPTIONS.find((option) => option.value === normalized)?.intervalMs || 0
  );
}

function getCameraPreviewMode(value) {
  const normalized = normalizeCameraPreviewRefresh(value);
  if (normalized === 'off') return 'off';
  return normalized === 'live' ? 'live' : 'snapshot';
}

function clearCameraPreviewTimer(record) {
  if (!record?.timerId) return;
  clearTimeout(record.timerId);
  record.timerId = null;
}

function clearCameraPreviewLoadTimeout(record) {
  if (!record?.loadTimeoutId) return;
  clearTimeout(record.loadTimeoutId);
  record.loadTimeoutId = null;
}

function armCameraPreviewLoadTimeout(
  record,
  requestId,
  onTimeout,
  timeoutMs = CAMERA_PREVIEW_LOAD_TIMEOUT_MS
) {
  clearCameraPreviewLoadTimeout(record);
  record.loadTimeoutId = setTimeout(() => {
    record.loadTimeoutId = null;
    if (record.disposed || record.requestId !== requestId || !record.loading) return;
    onTimeout();
  }, timeoutMs);
}

function setCameraPreviewState(record, previewState, statusText) {
  if (!record?.tile) return;
  const translatedStatus = statusText ? t(statusText) : '';
  record.previewState = previewState;
  record.statusText = translatedStatus;
  record.tile.dataset.cameraPreviewState = previewState;
  const status = record.tile.querySelector('.camera-tile-preview-status');
  if (status && translatedStatus) status.textContent = translatedStatus;
  if (record.expandedPreview) {
    record.expandedPreview.overlay.dataset.cameraPreviewState = previewState;
    if (record.expandedPreview.status && translatedStatus) {
      record.expandedPreview.status.textContent = translatedStatus;
    }
  }
}

function isCameraPreviewEligible(record) {
  return !!(
    record?.tile?.isConnected &&
    record.intersecting !== false &&
    !suspendedCameraPreviewEntities.has(record.entityId) &&
    document.visibilityState !== 'hidden'
  );
}

function resetCameraPreviewImage(record) {
  if (!record?.image) return;
  clearCameraPreviewLoadTimeout(record);
  record.image.onload = null;
  record.image.onerror = null;
  record.image.removeAttribute('src');
}

function resetCameraPreviewVideo(record) {
  if (!record) return;
  if (record.hls) {
    const hls = record.hls;
    record.hls = null;
    try {
      hls.destroy();
    } catch (error) {
      console.warn('Failed to destroy camera preview HLS stream:', error?.message || error);
    }
  }
  if (!record.video) return;
  record.video.onloadeddata = null;
  record.video.onplaying = null;
  record.video.onerror = null;
  try {
    if (!record.video.paused) record.video.pause();
  } catch {
    // The video may not have reached a playable state.
  }
  record.video.removeAttribute('src');
}

function setCameraPreviewSource(record, source) {
  if (!record?.tile) return;
  record.previewSource = source;
  record.tile.dataset.cameraPreviewSource = source;
  if (record.expandedPreview) {
    record.expandedPreview.overlay.dataset.cameraPreviewSource = source;
  }
}

function resetCameraPreviewMedia(record) {
  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  resetCameraPreviewImage(record);
}

function pauseCameraPreview(record) {
  if (!record || record.disposed) return;
  clearCameraPreviewTimer(record);
  if (record.previewMode !== 'live') return;

  record.requestId += 1;
  record.loading = false;
  resetCameraPreviewMedia(record);
  setCameraPreviewState(record, 'paused', 'Live preview paused');
}

function scheduleCameraPreview(record, delayMs) {
  if (!record || record.disposed || record.previewMode === 'off') return;
  clearCameraPreviewTimer(record);
  if (!isCameraPreviewEligible(record)) return;

  const defaultDelay = record.previewMode === 'live' ? 0 : record.intervalMs;
  const nextDelay = Number.isFinite(delayMs) ? delayMs : defaultDelay;

  record.timerId = setTimeout(
    () => {
      record.timerId = null;
      requestCameraPreview(record);
    },
    Math.max(0, nextDelay)
  );
}

function requestCameraSnapshot(record, { liveFallback = false } = {}) {
  if (!record || record.disposed || record.loading || !isCameraPreviewEligible(record)) return;
  if (!record.image?.isConnected) {
    disposeCameraPreview(record.tile);
    return;
  }

  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  setCameraPreviewSource(record, 'image');
  record.loading = true;
  record.requestId += 1;
  const requestId = record.requestId;
  setCameraPreviewState(
    record,
    liveFallback ? 'loading' : record.hasLoaded ? 'refreshing' : 'loading',
    liveFallback
      ? 'Live unavailable — loading snapshot…'
      : record.hasLoaded
        ? 'Refreshing snapshot…'
        : 'Loading snapshot…'
  );

  record.image.onload = () => {
    if (record.disposed || record.requestId !== requestId) return;
    clearCameraPreviewLoadTimeout(record);
    record.loading = false;
    record.hasLoaded = true;
    record.lastLoadedAt = Date.now();
    setCameraPreviewState(
      record,
      liveFallback ? 'fallback' : 'ready',
      liveFallback ? 'Live unavailable — showing snapshot' : 'Snapshot loaded'
    );
    scheduleCameraPreview(record, liveFallback ? CAMERA_PREVIEW_ERROR_RETRY_MS : record.intervalMs);
  };

  record.image.onerror = () => {
    if (record.disposed || record.requestId !== requestId) return;
    record.loading = false;
    resetCameraPreviewImage(record);
    setCameraPreviewState(record, 'error', 'Preview unavailable');
    scheduleCameraPreview(record, Math.max(record.intervalMs, CAMERA_PREVIEW_ERROR_RETRY_MS));
  };

  cameraPreviewSequence += 1;
  const entityPath = encodeURIComponent(record.entityId);
  record.image.src = `ha://camera/${entityPath}?preview=${cameraPreviewSequence}&t=${Date.now()}`;
  armCameraPreviewLoadTimeout(record, requestId, () => {
    record.loading = false;
    resetCameraPreviewImage(record);
    setCameraPreviewState(record, 'error', 'Preview unavailable');
    scheduleCameraPreview(record, Math.max(record.intervalMs, CAMERA_PREVIEW_ERROR_RETRY_MS));
  });
}

function markCameraLivePreviewReady(record, requestId) {
  if (!record || record.disposed || record.requestId !== requestId || !record.loading) {
    return;
  }
  clearCameraPreviewLoadTimeout(record);
  record.loading = false;
  record.hasLoaded = true;
  record.lastLoadedAt = Date.now();
  resetCameraPreviewImage(record);
  setCameraPreviewSource(record, 'video');
  setCameraPreviewState(record, 'ready', 'Live now');
}

function failCameraLivePreview(record, requestId) {
  if (!record || record.disposed || record.requestId !== requestId) return;
  clearCameraPreviewLoadTimeout(record);
  record.loading = false;
  resetCameraPreviewVideo(record);
  requestCameraSnapshot(record, { liveFallback: true });
}

function requestCameraMjpegPreview(record, requestId) {
  if (!record || record.disposed || record.requestId !== requestId) return;
  if (!record.image?.isConnected) {
    disposeCameraPreview(record.tile);
    return;
  }

  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  setCameraPreviewSource(record, 'image');
  record.image.onload = () => {
    if (record.disposed || record.requestId !== requestId) return;
    clearCameraPreviewLoadTimeout(record);
    record.loading = false;
    record.hasLoaded = true;
    record.lastLoadedAt = Date.now();
    setCameraPreviewState(record, 'ready', 'Live now');
  };
  record.image.onerror = () => failCameraLivePreview(record, requestId);

  cameraPreviewSequence += 1;
  const entityPath = encodeURIComponent(record.entityId);
  record.image.src = `ha://camera_stream/${entityPath}?preview=${cameraPreviewSequence}&t=${Date.now()}`;
  armCameraPreviewLoadTimeout(record, requestId, () => failCameraLivePreview(record, requestId));
}

function useCameraLiveCompatibilityFallback(record, requestId) {
  const camera = state.STATES?.[record.entityId] || { entity_id: record.entityId };
  if (isAarloCamera(camera)) {
    failCameraLivePreview(record, requestId);
    return;
  }
  requestCameraMjpegPreview(record, requestId);
}

async function requestCameraLivePreview(record) {
  if (!record || record.disposed || record.loading || !isCameraPreviewEligible(record)) return;
  if (!record.video?.isConnected || !record.image?.isConnected) {
    disposeCameraPreview(record.tile);
    return;
  }

  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  setCameraPreviewSource(record, 'video');
  record.loading = true;
  record.requestId += 1;
  const requestId = record.requestId;
  setCameraPreviewState(record, 'loading', 'Starting live stream…');
  armCameraPreviewLoadTimeout(
    record,
    requestId,
    () => failCameraLivePreview(record, requestId),
    CAMERA_PREVIEW_LIVE_START_TIMEOUT_MS
  );

  try {
    const HlsLib = await loadHls();
    const hlsUrl = await getHlsStreamUrl(record.entityId);
    if (record.disposed || record.requestId !== requestId) return;
    if (!hlsUrl) {
      useCameraLiveCompatibilityFallback(record, requestId);
      return;
    }

    const video = record.video;
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.onloadeddata = () => markCameraLivePreviewReady(record, requestId);
    video.onplaying = () => markCameraLivePreviewReady(record, requestId);
    video.onerror = () => failCameraLivePreview(record, requestId);

    const playVideo = () => {
      try {
        const playPromise = video.play();
        playPromise?.catch(() => {});
      } catch {
        // A later loadeddata event will retry through the browser's autoplay path.
      }
    };

    if (HlsLib && HlsLib.isSupported()) {
      const hls = new HlsLib({
        lowLatencyMode: true,
        backBufferLength: 15,
        maxBufferLength: 30,
      });
      record.hls = hls;
      hls.on(HlsLib.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          console.warn('Camera preview HLS fatal error:', data?.details || 'unknown');
          failCameraLivePreview(record, requestId);
        }
      });
      if (HlsLib.Events.MANIFEST_PARSED) {
        hls.on(HlsLib.Events.MANIFEST_PARSED, playVideo);
      }
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      return;
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl;
      playVideo();
      return;
    }

    useCameraLiveCompatibilityFallback(record, requestId);
  } catch (error) {
    console.warn('Camera preview HLS start failed:', error?.message || error);
    if (record.requestId === requestId) useCameraLiveCompatibilityFallback(record, requestId);
  }
}

function requestCameraPreview(record) {
  if (record?.previewMode === 'live') {
    requestCameraLivePreview(record);
    return;
  }
  requestCameraSnapshot(record);
}

function ensureCameraPreviewLifecycle() {
  if (cameraPreviewLifecycleInstalled) return;
  cameraPreviewLifecycleInstalled = true;

  document.addEventListener('visibilitychange', () => {
    cameraPreviewRecords.forEach((record) => {
      if (document.visibilityState === 'hidden') {
        pauseCameraPreview(record);
      } else {
        clearCameraPreviewTimer(record);
        scheduleCameraPreview(record, 0);
      }
    });
  });

  window.addEventListener('beforeunload', () => disposeAllCameraPreviews());
}

function ensureCameraPreviewObserver() {
  if (cameraPreviewObserver || typeof globalThis.IntersectionObserver !== 'function') {
    return cameraPreviewObserver;
  }

  cameraPreviewObserver = new globalThis.IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const record = cameraPreviewRecords.get(entry.target);
        if (!record || record.disposed) return;
        record.intersecting = entry.isIntersecting;
        if (!entry.isIntersecting) {
          pauseCameraPreview(record);
          return;
        }
        clearCameraPreviewTimer(record);
        scheduleCameraPreview(record, record.hasLoaded ? 0 : 100);
      });
    },
    { rootMargin: '80px' }
  );
  return cameraPreviewObserver;
}

function mountCameraPreview(tile, entityId, refreshValue) {
  const normalizedRefresh = normalizeCameraPreviewRefresh(refreshValue);
  const intervalMs = getCameraPreviewRefreshMs(normalizedRefresh);
  const previewMode = getCameraPreviewMode(normalizedRefresh);
  const existing = cameraPreviewRecords.get(tile);
  const canReuseExisting =
    existing &&
    existing.entityId === entityId &&
    existing.refreshValue === normalizedRefresh &&
    existing.image?.isConnected &&
    existing.video?.isConnected &&
    existing.visual?.isConnected;

  // The visual is deliberately moved out of the tile while expanded. Home Assistant state
  // updates can rerender Quick Access during that time, so reuse the connected preview record
  // before looking for media inside the temporarily empty source tile.
  if (canReuseExisting) {
    const hasActiveLiveSource =
      existing.previewMode === 'live' &&
      (existing.hls || existing.video.hasAttribute('src') || existing.image.hasAttribute('src'));
    if (!existing.loading && !existing.timerId && !hasActiveLiveSource) {
      scheduleCameraPreview(existing, 0);
    }
    return true;
  }

  const image = tile?.querySelector?.('.camera-tile-preview-image');
  let video = tile?.querySelector?.('.camera-tile-preview-video');
  const visual = tile?.querySelector?.('.camera-tile-visual') || image;

  if (image && !video) {
    video = document.createElement('video');
    video.className = 'camera-tile-preview-video';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    image.parentNode?.insertBefore(video, image);
  }

  if (!tile || !entityId || previewMode === 'off' || !image || !visual || !video) {
    if (tile) disposeCameraPreview(tile);
    return false;
  }

  if (existing) disposeCameraPreview(tile);

  ensureCameraPreviewLifecycle();
  const observer = ensureCameraPreviewObserver();
  const initialDelay = Math.min(cameraPreviewRecords.size * 180, 900);
  const record = {
    disposed: false,
    entityId,
    hasLoaded: false,
    hls: null,
    image,
    intersecting: true,
    intervalMs,
    lastLoadedAt: 0,
    loadTimeoutId: null,
    loading: false,
    previewMode,
    previewSource: previewMode === 'live' ? 'video' : 'image',
    previewState: 'loading',
    reconnecting: false,
    refreshValue: normalizedRefresh,
    requestId: 0,
    statusText: '',
    tile,
    timerId: null,
    expandedPreview: null,
    video,
    visual,
  };
  cameraPreviewRecords.set(tile, record);
  tile.dataset.cameraPreviewRefresh = normalizedRefresh;
  tile.dataset.cameraPreviewMode = previewMode;
  setCameraPreviewSource(record, record.previewSource);
  setCameraPreviewState(
    record,
    'loading',
    previewMode === 'live' ? 'Starting live stream…' : 'Loading snapshot…'
  );
  observer?.observe(tile);
  scheduleCameraPreview(record, initialDelay);
  return true;
}

function refreshCameraPreview(entityId, options = {}) {
  const force = options.force === true;
  if (force) suspendedCameraPreviewEntities.delete(entityId);
  cameraPreviewRecords.forEach((record) => {
    if (record.entityId !== entityId || record.disposed) return;
    if (record.previewMode === 'live') {
      if (force) pauseCameraPreview(record);
      const hasActiveSource =
        record.hls || record.video.hasAttribute('src') || record.image.hasAttribute('src');
      if (!record.loading && !record.timerId && !hasActiveSource) {
        scheduleCameraPreview(record, 0);
      }
      return;
    }
    clearCameraPreviewTimer(record);
    const elapsed = Date.now() - (record.lastLoadedAt || 0);
    const delay = force ? 0 : Math.max(0, record.intervalMs - elapsed);
    scheduleCameraPreview(record, delay);
  });
}

function disposeCameraPreview(tile) {
  const record = cameraPreviewRecords.get(tile);
  if (!record) return false;
  if (record.expandedPreview) {
    record.expandedPreview.close({ animate: false, restoreFocus: false });
  }
  record.disposed = true;
  record.requestId += 1;
  clearCameraPreviewTimer(record);
  cameraPreviewObserver?.unobserve(tile);
  resetCameraPreviewMedia(record);
  cameraPreviewRecords.delete(tile);
  return true;
}

function pruneCameraPreviews() {
  cameraPreviewRecords.forEach((record, tile) => {
    if (!tile.isConnected) disposeCameraPreview(tile);
  });
}

function disposeAllCameraPreviews() {
  Array.from(cameraPreviewRecords.keys()).forEach((tile) => disposeCameraPreview(tile));
  suspendedCameraPreviewEntities.clear();
}

function suspendLiveCameraPreviews(entityId) {
  suspendedCameraPreviewEntities.add(entityId);
  cameraPreviewRecords.forEach((record) => {
    if (record.entityId === entityId && record.previewMode === 'live') pauseCameraPreview(record);
  });
}

function isAarloCamera(camera) {
  const attributes = camera?.attributes || {};
  return [
    camera?.entity_id,
    attributes.attribution,
    attributes.brand,
    attributes.device_brand,
    attributes.model_name,
  ].some((value) => /aarlo|arlo/i.test(String(value || '')));
}

async function waitForAarloCameraIdle(entityId, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (state.STATES?.[entityId]?.state === 'idle') return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return state.STATES?.[entityId]?.state === 'idle';
}

async function reconnectCameraPreview(record, camera, button) {
  if (!record || record.disposed || record.reconnecting) return;
  record.reconnecting = true;
  if (button) {
    button.disabled = true;
    button.textContent = t('Reconnecting…');
  }

  clearCameraPreviewTimer(record);
  record.requestId += 1;
  record.loading = false;
  resetCameraPreviewMedia(record);
  suspendedCameraPreviewEntities.delete(record.entityId);
  setCameraPreviewState(record, 'loading', 'Reconnecting live stream…');

  const shouldStopAarloActivity = isAarloCamera(camera);
  const resetStartedAt = Date.now();
  if (shouldStopAarloActivity) {
    try {
      await websocket.callService('aarlo', 'camera_stop_activity', {
        entity_id: record.entityId,
      });
      await waitForAarloCameraIdle(record.entityId);
    } catch (error) {
      console.warn('Failed to clear stale Aarlo camera activity:', error?.message || error);
    }
  }

  const elapsedResetMs = Date.now() - resetStartedAt;
  const settleDelayMs = shouldStopAarloActivity ? Math.max(0, 750 - elapsedResetMs) : 100;
  await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
  if (record.disposed) return;

  record.reconnecting = false;
  if (button?.isConnected) {
    button.disabled = false;
    button.textContent = t('Reconnect');
  }
  scheduleCameraPreview(record, 0);
}

function runCameraPreviewViewTransition(update) {
  let updated = false;
  const guardedUpdate = () => {
    if (updated) return;
    updated = true;
    update();
  };
  const reduceMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduceMotion || typeof document.startViewTransition !== 'function') {
    guardedUpdate();
    return null;
  }

  try {
    return document.startViewTransition(guardedUpdate);
  } catch (error) {
    console.warn('Camera preview transition unavailable:', error?.message || error);
    guardedUpdate();
    return null;
  }
}

function openExpandedCameraPreview(record, camera) {
  if (!record || record.disposed || !record.visual?.isConnected) return false;
  if (record.expandedPreview) {
    record.expandedPreview.closeButton?.focus();
    return true;
  }
  if (activeExpandedCameraPreview) {
    activeExpandedCameraPreview.close({ animate: false, restoreFocus: false });
  }

  const displayName = getEntityDisplayName(camera);
  const overlay = document.createElement('div');
  overlay.className = 'camera-expanded-preview';
  overlay.dataset.cameraPreviewState = record.previewState || 'loading';
  overlay.dataset.cameraPreviewSource = record.previewSource || 'image';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${displayName} ${t('Camera preview')}`);
  overlay.innerHTML = `
    <div class="camera-expanded-preview-shell">
      <header class="camera-expanded-preview-header">
        <div class="camera-expanded-preview-heading">
          <span class="camera-expanded-preview-badge">
            <span class="camera-expanded-preview-dot"></span>
            ${escapeHtml(t(record.previewMode === 'live' ? 'Live' : 'Snapshot'))}
          </span>
          <h2>${escapeHtml(displayName)}</h2>
        </div>
        <button type="button" class="camera-expanded-preview-close" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
      </header>
      <div class="camera-expanded-preview-stage"></div>
      <footer class="camera-expanded-preview-footer">
        <span class="camera-expanded-preview-status" role="status">${escapeHtml(record.statusText || t('Loading preview…'))}</span>
        ${
          record.previewMode === 'live'
            ? `<button type="button" class="camera-expanded-preview-reconnect" aria-label="${escapeHtmlAttribute(t('Reconnect camera'))}">${escapeHtml(t('Reconnect'))}</button>`
            : ''
        }
      </footer>
    </div>
  `;

  const stage = overlay.querySelector('.camera-expanded-preview-stage');
  const closeButton = overlay.querySelector('.camera-expanded-preview-close');
  const reconnectButton = overlay.querySelector('.camera-expanded-preview-reconnect');
  const status = overlay.querySelector('.camera-expanded-preview-status');
  const originalParent = record.visual.parentNode;
  const originalNextSibling = record.visual.nextSibling;
  const sourceTile = record.tile;
  const visual = record.visual;
  visual.style.setProperty('view-transition-name', 'expanded-camera-preview-image');

  const expandedPreview = {
    close: null,
    closeButton,
    closed: false,
    visual,
    originalNextSibling,
    originalParent,
    overlay,
    record,
    sourceTile,
    status,
  };

  const close = ({ animate = true, restoreFocus = true } = {}) => {
    if (record.expandedPreview !== expandedPreview) return;
    expandedPreview.closed = true;
    record.expandedPreview = null;
    if (activeExpandedCameraPreview === expandedPreview) activeExpandedCameraPreview = null;
    document.removeEventListener('keydown', handleKeydown, true);

    const restoreImage = () => {
      if (originalParent?.isConnected && visual.parentNode !== originalParent) {
        const anchor =
          originalNextSibling?.parentNode === originalParent ? originalNextSibling : null;
        originalParent.insertBefore(visual, anchor);
      }
      overlay.remove();
    };
    const transition = animate ? runCameraPreviewViewTransition(restoreImage) : null;
    if (!animate) restoreImage();

    const finish = () => {
      visual.style.removeProperty('view-transition-name');
      if (restoreFocus && sourceTile?.isConnected) sourceTile.focus({ preventScroll: true });
    };
    if (transition?.finished) {
      transition.finished.then(finish, finish);
    } else {
      finish();
    }
  };

  const handleKeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const focusable = [closeButton, reconnectButton].filter(Boolean);
      const currentIndex = focusable.indexOf(document.activeElement);
      const direction = event.shiftKey ? -1 : 1;
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + direction + focusable.length) % focusable.length;
      focusable[nextIndex].focus({ preventScroll: true });
    }
  };
  expandedPreview.close = close;
  record.expandedPreview = expandedPreview;
  activeExpandedCameraPreview = expandedPreview;

  closeButton.onclick = close;
  if (reconnectButton) {
    reconnectButton.onclick = (event) => {
      event.stopPropagation();
      return reconnectCameraPreview(record, camera, reconnectButton);
    };
  }
  overlay.onclick = (event) => {
    if (event.target === overlay) close();
  };
  document.addEventListener('keydown', handleKeydown, true);

  const transition = runCameraPreviewViewTransition(() => {
    if (expandedPreview.closed) return;
    document.body.appendChild(overlay);
    stage.appendChild(visual);
  });
  const focusCloseButton = () => {
    if (!expandedPreview.closed) closeButton.focus({ preventScroll: true });
  };
  if (transition?.finished) {
    transition.finished.then(focusCloseButton, focusCloseButton);
  } else {
    focusCloseButton();
  }
  return true;
}

// Dynamic import for hls.js (large library, lazy loaded)
let Hls = null;

async function loadHls() {
  if (Hls !== null) return Hls;
  try {
    const hlsModule = await import('hls.js');
    Hls = hlsModule.default;
    return Hls;
  } catch (e) {
    console.warn('hls.js not available:', e?.message || e);
    return null;
  }
}

async function getHlsStreamUrl(entityId) {
  try {
    const res = await websocket.request({
      type: 'camera/stream',
      entity_id: entityId,
      format: 'hls',
    });
    if (res && res.success && res.result && (res.result.url || res.result)) {
      const rawUrl = typeof res.result === 'string' ? res.result : res.result.url;
      const abs = new URL(
        rawUrl,
        (state.CONFIG && state.CONFIG.homeAssistant && state.CONFIG.homeAssistant.url) || ''
      );
      // Proxy through ha://hls to keep Authorization header handling in main
      return `ha://hls${abs.pathname}${abs.search || ''}`;
    }
  } catch (e) {
    console.warn('HLS stream request failed:', e?.message || e);
  }
  return null;
}

function stopHlsStream(entityId) {
  if (state.ACTIVE_HLS.has(entityId)) {
    state.ACTIVE_HLS.get(entityId).destroy();
    state.ACTIVE_HLS.delete(entityId);
  }
}

async function openCamera(cameraId, options = {}) {
  try {
    if (!state.CONFIG || !state.CONFIG.homeAssistant.url) {
      console.error('Home Assistant not configured');
      return;
    }

    const camera = state.STATES[cameraId];
    if (!camera) {
      console.error('Camera not found:', cameraId);
      return;
    }

    const previewRecord = options.sourceTile ? cameraPreviewRecords.get(options.sourceTile) : null;
    if (previewRecord?.entityId === cameraId && openExpandedCameraPreview(previewRecord, camera)) {
      return;
    }

    // A live Quick Access tile and the modal must not hold two camera streams at once.
    // The tile is resumed by the camera-modal-closed event after the viewer closes.
    suspendLiveCameraPreviews(cameraId);

    // Create a camera popup modal
    const modal = document.createElement('div');
    modal.className = 'modal camera-modal';
    modal.innerHTML = `
      <div class="modal-content camera-content">
        <div class="modal-header">
          <h2>${escapeHtml(getEntityDisplayName(camera))}</h2>
          <button class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div style="position: relative;">
            <img alt="${escapeHtmlAttribute(getEntityDisplayName(camera))}" class="camera-stream camera-img">
            <div class="camera-loading" id="camera-loading">
              <div class="spinner"></div>
              ${escapeHtml(t('Loading live stream...'))}
            </div>
          </div>
          <div style="margin-top: 12px; display:flex; gap:8px;">
            <button class="btn btn-secondary" id="snapshot-btn">${escapeHtml(t('Snapshot'))}</button>
            <button class="btn btn-primary" id="live-btn">${escapeHtml(t('Live'))}</button>
          </div>
          <div class="camera-info">
            <p><strong>${escapeHtml(t('Status:'))}</strong> ${escapeHtml(camera.state)}</p>
            <p><strong>${escapeHtml(t('Last Updated:'))}</strong> ${escapeHtml(formatDateTime(camera.last_updated))}</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const img = modal.querySelector('.camera-stream');
    const snapshotBtn = modal.querySelector('#snapshot-btn');
    const liveBtn = modal.querySelector('#live-btn');
    const loadingEl = modal.querySelector('#camera-loading');
    const closeBtn = modal.querySelector('.close-btn');
    let isLive = false;
    let liveInterval = null;

    const showLoading = (show) => {
      if (loadingEl) {
        loadingEl.style.display = show ? 'flex' : 'none';
      }
    };

    const stopLive = () => {
      showLoading(false);
      if (liveInterval) {
        clearInterval(liveInterval);
        liveInterval = null;
      }
      stopHlsStream(cameraId);
      if (img) {
        img.style.display = 'block';
      }
      isLive = false;
      if (liveBtn) {
        liveBtn.textContent = t('Live');
      }
    };

    const loadSnapshot = async () => {
      stopLive();
      // Use ha:// protocol for snapshot (handled by main process)
      if (img) {
        img.src = `ha://camera/${cameraId}?t=${Date.now()}`;
      }
    };

    const startLive = async () => {
      stopLive();
      showLoading(true);

      // Load HLS library dynamically
      const HlsLib = await loadHls();

      // Try HLS first
      const hlsUrl = await getHlsStreamUrl(cameraId);
      let hlsStarted = false;

      if (hlsUrl) {
        const modalBody = modal.querySelector('.modal-body');
        let video = modalBody.querySelector('video.camera-video');
        if (!video) {
          video = document.createElement('video');
          video.className = 'camera-video';
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          video.controls = false;
          video.style.width = '100%';
          video.style.height = 'auto';
          modalBody.insertBefore(video, modalBody.firstChild);
        }

        if (HlsLib && HlsLib.isSupported()) {
          const hls = new HlsLib({ lowLatencyMode: true, backBufferLength: 90 });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          hls.on(HlsLib.Events.ERROR, (_evt, data) => {
            console.warn('HLS error', data?.details || data);
            if (data?.fatal) {
              try {
                hls.destroy();
              } catch (_error) {
                console.warn('Failed to destroy HLS instance:', _error);
              }
              state.ACTIVE_HLS.delete(cameraId);
              // Fallback to MJPEG if fatal error
              video.style.display = 'none';
              img.style.display = 'block';
              img.src = `ha://camera_stream/${cameraId}?t=${Date.now()}`;
              showLoading(false);
            }
          });
          state.ACTIVE_HLS.set(cameraId, hls);
          img.style.display = 'none';
          video.style.display = 'block';
          hlsStarted = true;
          showLoading(false);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS support
          video.src = hlsUrl;
          img.style.display = 'none';
          video.style.display = 'block';
          hlsStarted = true;
          showLoading(false);
        }
      }

      if (!hlsStarted) {
        // Fallback to MJPEG stream using ha:// protocol
        // Hide video element if it was created during HLS attempt
        const modalBody = modal.querySelector('.modal-body');
        const video = modalBody?.querySelector('video.camera-video');
        if (video) {
          video.style.display = 'none';
        }

        img.style.display = 'block';
        img.src = `ha://camera_stream/${cameraId}?t=${Date.now()}`;

        // Hide loading when MJPEG starts
        img.onload = () => showLoading(false);
        img.onerror = () => showLoading(false);
      }

      isLive = true;
      if (liveBtn) {
        liveBtn.textContent = t('Stop');
      }
    };

    // Button handlers
    if (snapshotBtn) {
      snapshotBtn.onclick = loadSnapshot;
    }

    if (liveBtn) {
      liveBtn.onclick = () => {
        if (isLive) {
          stopLive();
        } else {
          startLive();
        }
      };
    }

    const closeModal = () => {
      stopLive();
      modal.remove();
      // Ensure any tile visuals tied to this entity are refreshed after modal closes
      document.dispatchEvent(
        new CustomEvent('camera-modal-closed', { detail: { entityId: cameraId } })
      );
    };

    if (closeBtn) {
      closeBtn.onclick = closeModal;
    }

    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal();
      }
    };

    // Load initial snapshot
    loadSnapshot();
  } catch (error) {
    refreshCameraPreview(cameraId, { force: true });
    console.error('Error opening camera:', error);
    showToast(t('Failed to open camera viewer'), 'error', 2000);
  }
}

export {
  CAMERA_PREVIEW_REFRESH_OPTIONS,
  disposeAllCameraPreviews,
  disposeCameraPreview,
  getCameraPreviewRefreshMs,
  getHlsStreamUrl,
  mountCameraPreview,
  normalizeCameraPreviewRefresh,
  openCamera,
  pruneCameraPreviews,
  refreshCameraPreview,
  stopHlsStream,
};
