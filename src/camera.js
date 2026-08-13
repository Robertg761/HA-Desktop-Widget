import state from './state.js';
import websocket from './websocket.js';
import { escapeHtml, escapeHtmlAttribute, getEntityDisplayName } from './utils.js';
import { applyCloseButtonIcons } from './icons.js';
import { closeModal as closeModalAnimated, showToast } from './ui-utils.js';
import { formatDateTime, t } from './i18n.js';
import { getRendererHost } from '@hadw/renderer/host.js';

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
// A camera gets the full wait the first time, because some cloud cameras genuinely need 20s+ to
// negotiate a stream. Once one has failed, later attempts give up sooner rather than parking the
// tile on "Starting live stream…" for half a minute every cycle.
const CAMERA_PREVIEW_LIVE_RESTART_TIMEOUT_MS = 10000;
const CAMERA_PREVIEW_STAGGER_MS = 180;
const CAMERA_PREVIEW_MAX_STAGGER_MS = 900;
// Cameras that cannot start a stream at all (battery doorbells especially) should not be woken
// twice a minute forever. Each consecutive failure widens the gap before the next live attempt;
// the snapshot fallback keeps refreshing on its own cadence in the meantime.
const CAMERA_PREVIEW_LIVE_RETRY_STEPS_MS = Object.freeze([30000, 60000, 300000]);
const CAMERA_PREVIEW_WARMUP_REUSE_MS = 15000;
const CAMERA_PREVIEW_MJPEG_TIMEOUT_MS = 8000;
// Learned per entity rather than assumed per brand: a camera that answers the MJPEG endpoint with
// nothing usable is remembered, which covers every integration with the quirk instead of one.
const cameraMjpegUnusableEntities = new Set();
// Doorbell cameras are usually portrait, so `object-fit: cover` in a landscape tile crops the
// top of the frame — exactly where faces are. Bias the crop upward for those sources.
const CAMERA_PREVIEW_TALL_SOURCE_RATIO = 0.9;
const CAMERA_PREVIEW_TALL_OBJECT_POSITION = 'center 30%';
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

function getCameraPreviewBadgeLabel(record) {
  return record?.previewMode === 'live' && !record.snapshotFallback ? 'Live' : 'Snapshot';
}

function updateCameraPreviewBadge(record) {
  const label = t(getCameraPreviewBadgeLabel(record));
  const tileLabel = record?.tile?.querySelector('.camera-tile-preview-badge-label');
  if (tileLabel) tileLabel.textContent = label;
  const expandedLabel = record?.expandedPreview?.badgeLabel;
  if (expandedLabel) expandedLabel.textContent = label;
}

// A Quick Access tile is only about 140px wide at 9px type, so anything past roughly 28
// characters is ellipsised away. The expanded view has room for the full explanation.
function setCameraPreviewState(record, previewState, statusText, tileStatusText = statusText) {
  if (!record?.tile) return;
  const translatedStatus = statusText ? t(statusText) : '';
  const translatedTileStatus = tileStatusText ? t(tileStatusText) : '';
  record.previewState = previewState;
  record.statusText = translatedStatus;
  record.tile.dataset.cameraPreviewState = previewState;
  const status = record.tile.querySelector('.camera-tile-preview-status');
  if (status) status.textContent = translatedTileStatus;
  if (record.expandedPreview) {
    record.expandedPreview.overlay.dataset.cameraPreviewState = previewState;
    if (record.expandedPreview.status) {
      record.expandedPreview.status.textContent = translatedStatus;
    }
  }
  updateCameraPreviewBadge(record);
}

// Home Assistant marks a camera unavailable when the integration has lost it. Polling the proxy
// through that only produces failures, so the preview waits for the camera to come back instead.
function isCameraEntityOffline(entityId) {
  const entityState = state.STATES?.[entityId]?.state;
  if (entityState === undefined) return false;
  return CAMERA_OFFLINE_STATES.has(String(entityState).toLowerCase());
}

function isCameraPreviewEligible(record) {
  return !!(
    record?.tile?.isConnected &&
    record.intersecting !== false &&
    !suspendedCameraPreviewEntities.has(record.entityId) &&
    !isCameraEntityOffline(record.entityId) &&
    document.visibilityState !== 'hidden'
  );
}

function getCameraPreviewImages(record) {
  if (record?.images?.length) return record.images;
  return record?.image ? [record.image] : [];
}

// Snapshots load into the buffer that is not on screen, so a failed refresh can never blank the
// frame the tile is already showing.
function getCameraPreviewLoadTarget(record) {
  const images = getCameraPreviewImages(record);
  if (images.length < 2) return images[0] || null;
  return images.find((image) => image !== record.image) || images[0];
}

// Tracked on the tile so the placeholder icon can get out of the way of a warmup still, which
// arrives while the state is still 'loading'.
function setCameraPreviewHasFrame(record, hasFrame) {
  if (!record?.tile) return;
  record.tile.dataset.cameraPreviewHasFrame = hasFrame ? 'true' : 'false';
  if (record.expandedPreview) {
    record.expandedPreview.overlay.dataset.cameraPreviewHasFrame = hasFrame ? 'true' : 'false';
  }
}

function activateCameraPreviewImage(record, image) {
  if (!record || !image) return;
  record.image = image;
  getCameraPreviewImages(record).forEach((buffer) => {
    buffer.dataset.cameraBufferActive = buffer === image ? 'true' : 'false';
  });
  setCameraPreviewHasFrame(record, true);
}

function clearCameraPreviewImageElement(image) {
  if (!image) return;
  image.onload = null;
  image.onerror = null;
  image.removeAttribute('src');
  image.dataset.cameraBufferLoaded = 'false';
}

// Clearing one buffer can leave the tile flagged as holding a frame when it no longer does.
function clearCameraPreviewBuffer(record, image) {
  clearCameraPreviewImageElement(image);
  setCameraPreviewHasFrame(record, hasCameraPreviewFrame(record));
}

function hasCameraPreviewImageSource(record) {
  return getCameraPreviewImages(record).some((image) => image.hasAttribute('src'));
}

function applyCameraPreviewFraming(record, media) {
  if (!media) return;
  const sourceWidth = media.naturalWidth || media.videoWidth || 0;
  const sourceHeight = media.naturalHeight || media.videoHeight || 0;
  const boxWidth = record?.tile?.clientWidth || 0;
  const boxHeight = record?.tile?.clientHeight || 0;
  if (!sourceWidth || !sourceHeight || !boxWidth || !boxHeight) return;
  const isTallerThanTile =
    sourceWidth / sourceHeight < (boxWidth / boxHeight) * CAMERA_PREVIEW_TALL_SOURCE_RATIO;
  media.style.objectPosition = isTallerThanTile ? CAMERA_PREVIEW_TALL_OBJECT_POSITION : '';
}

function resetCameraPreviewImage(record) {
  if (!record) return;
  clearCameraPreviewLoadTimeout(record);
  getCameraPreviewImages(record).forEach(clearCameraPreviewImageElement);
  setCameraPreviewHasFrame(record, false);
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
  const target = getCameraPreviewLoadTarget(record);
  if (!target?.isConnected) {
    disposeCameraPreview(record.tile);
    return;
  }

  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  setCameraPreviewSource(record, 'image');
  record.snapshotFallback = liveFallback;
  record.loading = true;
  record.requestId += 1;
  const requestId = record.requestId;
  // A frame already on screen survives a failed refresh because the new snapshot decodes into
  // the spare buffer first. Without a spare buffer the failure has to fall back to the icon.
  const canRetainLastFrame = record.hasLoaded && target !== record.image;
  setCameraPreviewState(
    record,
    liveFallback ? 'loading' : record.hasLoaded ? 'refreshing' : 'loading',
    liveFallback
      ? 'Live unavailable — loading snapshot…'
      : record.hasLoaded
        ? 'Refreshing snapshot…'
        : 'Loading snapshot…',
    liveFallback ? 'Loading snapshot…' : undefined
  );

  const failSnapshot = () => {
    if (record.disposed || record.requestId !== requestId) return;
    clearCameraPreviewLoadTimeout(record);
    record.loading = false;
    record.snapshotFailureCount = (record.snapshotFailureCount || 0) + 1;
    clearCameraPreviewBuffer(record, target);
    if (canRetainLastFrame) {
      setCameraPreviewState(
        record,
        'stale',
        'Preview unavailable — showing last frame',
        'Showing last frame'
      );
    } else {
      setCameraPreviewState(record, 'error', 'Preview unavailable');
    }
    // A camera that keeps failing should not be re-requested every 30s forever.
    scheduleCameraPreview(
      record,
      Math.max(record.intervalMs, getCameraRetryDelay(record.snapshotFailureCount))
    );
  };

  target.onload = () => {
    if (record.disposed || record.requestId !== requestId) return;
    clearCameraPreviewLoadTimeout(record);
    record.loading = false;
    record.hasLoaded = true;
    record.lastLoadedAt = Date.now();
    record.snapshotFailureCount = 0;
    target.dataset.cameraBufferLoaded = 'true';
    applyCameraPreviewFraming(record, target);
    activateCameraPreviewImage(record, target);
    setCameraPreviewState(
      record,
      liveFallback ? 'fallback' : 'ready',
      liveFallback ? 'Live unavailable — showing snapshot' : 'Snapshot loaded',
      liveFallback ? 'Snapshot fallback' : undefined
    );
    scheduleCameraPreview(record, liveFallback ? CAMERA_PREVIEW_ERROR_RETRY_MS : record.intervalMs);
  };

  target.onerror = failSnapshot;

  cameraPreviewSequence += 1;
  target.src = getRendererHost().resolveMediaUrl({
    kind: 'camera_snapshot',
    entityId: record.entityId,
    preview: cameraPreviewSequence,
    cacheKey: Date.now(),
  });
  armCameraPreviewLoadTimeout(record, requestId, failSnapshot);
}

function getCameraRetryDelay(failures) {
  const steps = CAMERA_PREVIEW_LIVE_RETRY_STEPS_MS;
  return steps[Math.min(Math.max((failures || 0) - 1, 0), steps.length - 1)];
}

function getCameraLiveRetryDelay(record) {
  return getCameraRetryDelay(record?.liveFailureCount);
}

function resetCameraLiveRetryBackoff(record) {
  if (!record) return;
  record.liveFailureCount = 0;
  record.liveRetryAt = 0;
}

function isCameraLiveRetryDue(record) {
  return !record?.liveRetryAt || Date.now() >= record.liveRetryAt;
}

// A camera that has just started streaming — or come back from unavailable — is worth an
// immediate retry rather than serving out a backoff earned while it was down. 'recording' is
// deliberately excluded: motion makes cameras flip in and out of it constantly without any stream
// becoming available, which would cancel the backoff on exactly the cameras that need it.
const CAMERA_STREAMING_STATES = new Set(['streaming']);
const CAMERA_OFFLINE_STATES = new Set(['unavailable', 'unknown', '']);

function markCameraPreviewUnavailable(record) {
  clearCameraPreviewTimer(record);
  record.requestId += 1;
  record.loading = false;
  // The stream is gone with the camera, but the last frame is kept so the tile kept showing a
  // picture rather than dropping to a placeholder over a brief outage.
  resetCameraPreviewVideo(record);
  setCameraPreviewState(record, 'unavailable', 'Camera unavailable');
}

function syncCameraPreviewWithEntityState(record) {
  if (!record || record.disposed) return;
  const previousState = record.entityState;
  const nextState = String(state.STATES?.[record.entityId]?.state || '').toLowerCase();
  if (nextState === previousState) return;
  record.entityState = nextState;
  if (previousState === undefined) return;

  const wasOffline = CAMERA_OFFLINE_STATES.has(previousState);
  const isOffline = CAMERA_OFFLINE_STATES.has(nextState);

  if (isOffline && !wasOffline) {
    markCameraPreviewUnavailable(record);
    return;
  }

  if (wasOffline && !isOffline) {
    resetCameraLiveRetryBackoff(record);
    record.snapshotFailureCount = 0;
    clearCameraPreviewTimer(record);
    scheduleCameraPreview(record, 0);
    return;
  }

  if (record.previewMode !== 'live' || !record.liveFailureCount) return;
  const startedStreaming =
    CAMERA_STREAMING_STATES.has(nextState) && !CAMERA_STREAMING_STATES.has(previousState);
  if (startedStreaming) resetCameraLiveRetryBackoff(record);
}

function markCameraLivePreviewReady(record, requestId) {
  if (!record || record.disposed || record.requestId !== requestId || !record.loading) {
    return;
  }
  clearCameraPreviewLoadTimeout(record);
  record.loading = false;
  record.hasLoaded = true;
  record.lastLoadedAt = Date.now();
  applyCameraPreviewFraming(record, record.video);
  resetCameraLiveRetryBackoff(record);
  // Switch to the video before dropping the warmup still, so the tile never flashes empty. The
  // still is cleared rather than kept because an MJPEG source holds its connection open.
  setCameraPreviewSource(record, 'video');
  resetCameraPreviewImage(record);
  setCameraPreviewState(record, 'ready', 'Live now');
}

function failCameraLivePreview(record, requestId, reason = 'unknown') {
  if (!record || record.disposed || record.requestId !== requestId) return;
  // Without this the only trace of a stream that never starts is a generic protocol timeout,
  // which cannot be told apart from a slow snapshot.
  console.warn(`Camera live preview unavailable (${record.entityId}): ${reason}`);
  clearCameraPreviewLoadTimeout(record);
  record.loading = false;
  resetCameraPreviewVideo(record);
  if (reason.startsWith('mjpeg')) cameraMjpegUnusableEntities.add(record.entityId);

  record.liveFailureCount = (record.liveFailureCount || 0) + 1;
  record.liveRetryAt = Date.now() + getCameraLiveRetryDelay(record);

  // The warmup still from this same attempt is seconds old, so refetching it would double the
  // request count for every camera whose stream never starts.
  const frameAgeMs = Date.now() - (record.lastLoadedAt || 0);
  if (hasCameraPreviewFrame(record) && frameAgeMs < CAMERA_PREVIEW_WARMUP_REUSE_MS) {
    record.snapshotFallback = true;
    setCameraPreviewSource(record, 'image');
    setCameraPreviewState(
      record,
      'fallback',
      'Live unavailable — showing snapshot',
      'Snapshot fallback'
    );
    scheduleCameraPreview(record, CAMERA_PREVIEW_ERROR_RETRY_MS);
    return;
  }

  requestCameraSnapshot(record, { liveFallback: true });
}

function requestCameraMjpegPreview(record, requestId) {
  if (!record || record.disposed || record.requestId !== requestId) return;
  const target = getCameraPreviewLoadTarget(record);
  if (!target?.isConnected) {
    disposeCameraPreview(record.tile);
    return;
  }

  clearCameraPreviewLoadTimeout(record);
  resetCameraPreviewVideo(record);
  setCameraPreviewSource(record, 'image');
  record.snapshotFallback = false;

  // A failed probe must not leave a stream URL sitting on the buffer, or the browser keeps the
  // connection to a dead endpoint alive.
  const failMjpegProbe = (reason) => {
    clearCameraPreviewBuffer(record, target);
    failCameraLivePreview(record, requestId, reason);
  };

  target.onload = () => {
    if (record.disposed || record.requestId !== requestId) return;
    // Some integrations answer the stream endpoint with an empty payload, which fires load rather
    // than error. Treat a frame with no pixels as the failure it is.
    if (!target.naturalWidth || !target.naturalHeight) {
      failMjpegProbe('mjpeg-empty');
      return;
    }
    clearCameraPreviewLoadTimeout(record);
    record.loading = false;
    record.hasLoaded = true;
    record.lastLoadedAt = Date.now();
    target.dataset.cameraBufferLoaded = 'true';
    applyCameraPreviewFraming(record, target);
    activateCameraPreviewImage(record, target);
    resetCameraLiveRetryBackoff(record);
    setCameraPreviewState(record, 'ready', 'Live now');
  };
  target.onerror = () => failMjpegProbe('mjpeg-error');

  cameraPreviewSequence += 1;
  target.src = getRendererHost().resolveMediaUrl({
    kind: 'camera_stream',
    entityId: record.entityId,
    preview: cameraPreviewSequence,
    cacheKey: Date.now(),
  });
  armCameraPreviewLoadTimeout(
    record,
    requestId,
    () => failMjpegProbe('mjpeg-timeout'),
    CAMERA_PREVIEW_MJPEG_TIMEOUT_MS
  );
}

function hasCameraPreviewFrame(record) {
  return getCameraPreviewImages(record).some(
    (image) => image.dataset.cameraBufferLoaded === 'true'
  );
}

// Negotiating a stream takes anywhere from a second to half a minute depending on the camera and
// integration, and the tile is a bare icon for all of it. A still is the one thing every Home
// Assistant camera can serve quickly, so paint one underneath while the stream comes up.
function requestCameraWarmupSnapshot(record, requestId) {
  if (!record || record.disposed || hasCameraPreviewFrame(record)) return;
  const target = getCameraPreviewLoadTarget(record);
  if (!target?.isConnected) return;

  target.onload = () => {
    // The stream winning the race is the better outcome; leave it alone if it already did.
    if (record.disposed || record.requestId !== requestId) return;
    if (record.previewSource === 'video' && record.previewState === 'ready') return;
    record.hasLoaded = true;
    record.lastLoadedAt = Date.now();
    target.dataset.cameraBufferLoaded = 'true';
    applyCameraPreviewFraming(record, target);
    activateCameraPreviewImage(record, target);
    setCameraPreviewSource(record, 'image');
  };
  target.onerror = () => {
    // A failed warmup still is not itself a failure; the live attempt owns that verdict.
    clearCameraPreviewImageElement(target);
  };

  cameraPreviewSequence += 1;
  target.src = getRendererHost().resolveMediaUrl({
    kind: 'camera_snapshot',
    entityId: record.entityId,
    preview: cameraPreviewSequence,
    cacheKey: Date.now(),
  });
}

function useCameraLiveCompatibilityFallback(record, requestId) {
  if (cameraMjpegUnusableEntities.has(record.entityId)) {
    failCameraLivePreview(record, requestId, 'no-stream-url (mjpeg already ruled out)');
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
  // The source only becomes 'video' once a frame actually arrives, so the warmup still stays
  // visible for however long the stream takes to negotiate.
  setCameraPreviewSource(record, hasCameraPreviewFrame(record) ? 'image' : 'video');
  record.snapshotFallback = false;
  record.loading = true;
  record.requestId += 1;
  const requestId = record.requestId;
  setCameraPreviewState(record, 'loading', 'Starting live stream…');
  requestCameraWarmupSnapshot(record, requestId);
  armCameraPreviewLoadTimeout(
    record,
    requestId,
    () => failCameraLivePreview(record, requestId, 'live-start-timeout'),
    record.liveFailureCount
      ? CAMERA_PREVIEW_LIVE_RESTART_TIMEOUT_MS
      : CAMERA_PREVIEW_LIVE_START_TIMEOUT_MS
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
    video.onerror = () => failCameraLivePreview(record, requestId, 'video-element-error');

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
          failCameraLivePreview(record, requestId, `hls-fatal: ${data?.details || 'unknown'}`);
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
    // While the live attempt is backed off, keep the tile current with snapshots instead.
    if (isCameraLiveRetryDue(record)) {
      requestCameraLivePreview(record);
    } else {
      requestCameraSnapshot(record, { liveFallback: true });
    }
    return;
  }
  requestCameraSnapshot(record);
}

// Snapshot tiles keep their configured cadence across pauses instead of refetching the moment
// they come back, so scrolling or focusing the window cannot outpace the chosen interval.
function getCameraPreviewResumeDelay(record) {
  if (!record || record.previewMode === 'live' || !record.hasLoaded) return 0;
  const elapsed = Date.now() - (record.lastLoadedAt || 0);
  return Math.max(0, record.intervalMs - elapsed);
}

function ensureCameraPreviewLifecycle() {
  if (cameraPreviewLifecycleInstalled) return;
  cameraPreviewLifecycleInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      cameraPreviewRecords.forEach((record) => pauseCameraPreview(record));
      return;
    }
    // Resuming every camera at once hammers the proxy, so reuse the mount-time stagger.
    let index = 0;
    cameraPreviewRecords.forEach((record) => {
      clearCameraPreviewTimer(record);
      const stagger = Math.min(index * CAMERA_PREVIEW_STAGGER_MS, CAMERA_PREVIEW_MAX_STAGGER_MS);
      scheduleCameraPreview(record, getCameraPreviewResumeDelay(record) + stagger);
      index += 1;
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
        // While expanded the media lives in the dialog, so the source tile scrolling out of
        // view must not tear down the stream the user is watching.
        if (record.expandedPreview) return;
        if (!entry.isIntersecting) {
          pauseCameraPreview(record);
          return;
        }
        clearCameraPreviewTimer(record);
        scheduleCameraPreview(record, record.hasLoaded ? getCameraPreviewResumeDelay(record) : 100);
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
    syncCameraPreviewWithEntityState(existing);
    const hasActiveLiveSource =
      existing.previewMode === 'live' &&
      (existing.hls || existing.video.hasAttribute('src') || hasCameraPreviewImageSource(existing));
    if (!existing.loading && !existing.timerId && !hasActiveLiveSource) {
      scheduleCameraPreview(existing, 0);
    }
    return true;
  }

  const images = tile?.querySelectorAll
    ? Array.from(tile.querySelectorAll('.camera-tile-preview-image'))
    : [];
  const image = images[0] || null;
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

  // Older markup only had a single image element; the spare buffer is what keeps the last good
  // frame on screen when a refresh fails, so add it when it is missing.
  if (image && images.length < 2) {
    const spare = image.cloneNode(false);
    spare.removeAttribute('src');
    image.parentNode?.insertBefore(spare, image.nextSibling);
    images.push(spare);
  }

  if (!tile || !entityId || previewMode === 'off' || !image || !visual || !video) {
    if (tile) disposeCameraPreview(tile);
    return false;
  }

  images.forEach((buffer, index) => {
    buffer.dataset.cameraBufferActive = index === 0 ? 'true' : 'false';
    buffer.dataset.cameraBufferLoaded = 'false';
  });

  if (existing) disposeCameraPreview(tile);

  ensureCameraPreviewLifecycle();
  const observer = ensureCameraPreviewObserver();
  const initialDelay = Math.min(
    cameraPreviewRecords.size * CAMERA_PREVIEW_STAGGER_MS,
    CAMERA_PREVIEW_MAX_STAGGER_MS
  );
  const record = {
    disposed: false,
    entityId,
    entityState: String(state.STATES?.[entityId]?.state || '').toLowerCase(),
    hasLoaded: false,
    hls: null,
    image,
    images,
    snapshotFallback: false,
    intersecting: true,
    intervalMs,
    lastLoadedAt: 0,
    liveFailureCount: 0,
    liveRetryAt: 0,
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
  setCameraPreviewHasFrame(record, false);
  setCameraPreviewState(
    record,
    'loading',
    previewMode === 'live' ? 'Starting live stream…' : 'Loading snapshot…'
  );
  observer?.observe(tile);
  if (isCameraEntityOffline(entityId)) {
    setCameraPreviewState(record, 'unavailable', 'Camera unavailable');
  } else {
    scheduleCameraPreview(record, initialDelay);
  }
  return true;
}

function refreshCameraPreview(entityId, options = {}) {
  const force = options.force === true;
  if (force) suspendedCameraPreviewEntities.delete(entityId);
  cameraPreviewRecords.forEach((record) => {
    if (record.entityId !== entityId || record.disposed) return;
    if (record.previewMode === 'live') {
      // An explicit refresh is a deliberate ask for the stream, so start the ladder over.
      if (force) {
        resetCameraLiveRetryBackoff(record);
        pauseCameraPreview(record);
      }
      const hasActiveSource =
        record.hls || record.video.hasAttribute('src') || hasCameraPreviewImageSource(record);
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
  // Learned capability is only good for the life of the session; a camera may be reconfigured.
  cameraMjpegUnusableEntities.clear();
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
  resetCameraLiveRetryBackoff(record);
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
            <span class="camera-expanded-preview-badge-label">${escapeHtml(t(getCameraPreviewBadgeLabel(record)))}</span>
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
  const badgeLabel = overlay.querySelector('.camera-expanded-preview-badge-label');
  const originalParent = record.visual.parentNode;
  const originalNextSibling = record.visual.nextSibling;
  const sourceTile = record.tile;
  const visual = record.visual;
  visual.style.setProperty('view-transition-name', 'expanded-camera-preview-image');
  // Inside the tile the visual is decorative, but it is the dialog's only content once expanded.
  const wasVisualHidden = visual.getAttribute('aria-hidden') === 'true';
  visual.removeAttribute('aria-hidden');
  const previewAltText = `${displayName} ${t('Preview')}`;
  getCameraPreviewImages(record).forEach((image) => image.setAttribute('alt', previewAltText));

  const expandedPreview = {
    badgeLabel,
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

    if (wasVisualHidden) visual.setAttribute('aria-hidden', 'true');
    getCameraPreviewImages(record).forEach((image) => image.setAttribute('alt', ''));

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
      return getRendererHost().resolveMediaUrl({
        kind: 'camera_hls',
        path: abs.pathname,
        search: abs.search || '',
      });
    }
    console.warn(
      `Camera stream URL unavailable (${entityId}): ${res?.error?.message || 'camera/stream returned no url'}`
    );
  } catch (e) {
    console.warn(`Camera stream request failed (${entityId}):`, e?.message || e);
  }
  return null;
}

function stopHlsStream(entityId) {
  if (state.ACTIVE_HLS.has(entityId)) {
    const hls = state.ACTIVE_HLS.get(entityId);
    state.ACTIVE_HLS.delete(entityId);
    try {
      hls?.destroy();
    } catch (error) {
      console.warn('Failed to destroy HLS instance:', error);
    }
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
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `${getEntityDisplayName(camera)} ${t('Camera preview')}`);
    modal.innerHTML = `
      <div class="modal-content camera-content">
        <div class="modal-header">
          <h2>${escapeHtml(getEntityDisplayName(camera))}</h2>
          <button class="close-btn" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
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
    applyCloseButtonIcons(modal);

    const previouslyFocused = document.activeElement;
    // Escape closed the expanded preview but not this viewer, which is the one most people reach.
    const handleModalKeydown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeModal();
    };

    const img = modal.querySelector('.camera-stream');
    const snapshotBtn = modal.querySelector('#snapshot-btn');
    const liveBtn = modal.querySelector('#live-btn');
    const loadingEl = modal.querySelector('#camera-loading');
    const closeBtn = modal.querySelector('.close-btn');
    let isLive = false;
    let isStartingLive = false;
    let streamGeneration = 0;
    let closed = false;

    // `.camera-loading` is hidden by default and revealed by `.show`, so no inline display is
    // written here; the stylesheet stays the single source of truth for the overlay's layout.
    const showLoading = (show) => {
      if (closed) return;
      loadingEl?.classList.toggle('show', show);
    };

    const stopLive = () => {
      streamGeneration += 1;
      showLoading(false);
      stopHlsStream(cameraId);

      const video = modal.querySelector('video.camera-video');
      if (video) {
        try {
          video.pause();
        } catch {
          // Pausing is best-effort during teardown.
        }
        video.removeAttribute('src');
        try {
          video.load();
        } catch {
          // jsdom and some embedded media implementations do not expose load().
        }
        video.style.display = 'none';
      }

      if (img) {
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
        img.style.display = 'block';
      }
      isLive = false;
      isStartingLive = false;
      if (liveBtn) {
        liveBtn.textContent = t('Live');
        liveBtn.setAttribute('aria-busy', 'false');
      }
    };

    const loadSnapshot = () => {
      stopLive();
      if (!img) return;
      const generation = streamGeneration;
      // A snapshot that fails used to leave a broken image icon and no explanation.
      showLoading(true);
      img.onload = () => {
        if (closed || generation !== streamGeneration) return;
        showLoading(false);
      };
      img.onerror = () => {
        if (closed || generation !== streamGeneration) return;
        showLoading(false);
        showToast(t('Could not load camera snapshot'), 'error', 2500);
      };
      img.src = getRendererHost().resolveMediaUrl({
        kind: 'camera_snapshot',
        entityId: cameraId,
        cacheKey: Date.now(),
      });
    };

    const startLive = async () => {
      stopLive();
      const generation = streamGeneration;
      isStartingLive = true;
      if (liveBtn) {
        liveBtn.textContent = t('Stop');
        liveBtn.setAttribute('aria-busy', 'true');
      }
      showLoading(true);

      // Load the optional player and request the stream in parallel. Either may
      // outlive the modal, so every continuation is generation guarded.
      const [HlsLib, hlsUrl] = await Promise.all([loadHls(), getHlsStreamUrl(cameraId)]);
      if (closed || generation !== streamGeneration || !modal.isConnected) return;
      let hlsStarted = false;

      if (hlsUrl) {
        const modalBody = modal.querySelector('.modal-body');
        if (!modalBody) {
          // Bail out without parking the viewer on a spinner that nothing will ever clear.
          showLoading(false);
          return;
        }
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
          // Track the instance before setup so a synchronous load/attach failure
          // is still reachable by teardown.
          state.ACTIVE_HLS.set(cameraId, hls);
          try {
            hls.loadSource(hlsUrl);
            hls.attachMedia(video);
            hls.on(HlsLib.Events.ERROR, (_evt, data) => {
              if (
                closed ||
                generation !== streamGeneration ||
                state.ACTIVE_HLS.get(cameraId) !== hls
              ) {
                return;
              }
              console.warn('HLS error', data?.details || data);
              if (data?.fatal) {
                try {
                  hls.destroy();
                } catch (_error) {
                  console.warn('Failed to destroy HLS instance:', _error);
                }
                if (state.ACTIVE_HLS.get(cameraId) === hls) {
                  state.ACTIVE_HLS.delete(cameraId);
                }
                // Fallback to MJPEG if fatal error
                try {
                  video.pause();
                } catch {
                  // Best-effort teardown before switching transports.
                }
                video.removeAttribute('src');
                video.style.display = 'none';
                img.style.display = 'block';
                img.src = getRendererHost().resolveMediaUrl({
                  kind: 'camera_stream',
                  entityId: cameraId,
                  cacheKey: Date.now(),
                });
                showLoading(false);
              }
            });
          } catch (error) {
            if (state.ACTIVE_HLS.get(cameraId) === hls) {
              state.ACTIVE_HLS.delete(cameraId);
            }
            try {
              hls.destroy();
            } catch (destroyError) {
              console.warn('Failed to destroy HLS instance after setup error:', destroyError);
            }
            throw error;
          }
          img.style.display = 'none';
          video.style.display = 'block';
          hlsStarted = true;
          showLoading(false);
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS support
          video.src = hlsUrl;
          try {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              void playPromise.catch(() => {});
            }
          } catch {
            // Autoplay failure leaves native controls hidden but does not leak the stream.
          }
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
          try {
            video.pause();
          } catch {
            // Best-effort teardown before switching transports.
          }
          video.removeAttribute('src');
          video.style.display = 'none';
        }

        img.style.display = 'block';
        img.src = getRendererHost().resolveMediaUrl({
          kind: 'camera_stream',
          entityId: cameraId,
          cacheKey: Date.now(),
        });

        // Hide loading when MJPEG starts
        img.onload = () => {
          if (closed || generation !== streamGeneration) return;
          showLoading(false);
        };
        img.onerror = () => {
          if (closed || generation !== streamGeneration) return;
          showLoading(false);
        };
      }

      if (closed || generation !== streamGeneration || !modal.isConnected) return;
      isStartingLive = false;
      isLive = true;
      if (liveBtn) {
        liveBtn.textContent = t('Stop');
        liveBtn.setAttribute('aria-busy', 'false');
      }
    };

    // Button handlers
    if (snapshotBtn) {
      snapshotBtn.onclick = loadSnapshot;
    }

    if (liveBtn) {
      liveBtn.onclick = () => {
        if (isLive || isStartingLive) {
          loadSnapshot();
        } else {
          const startPromise = startLive();
          const generation = streamGeneration;
          void startPromise.catch((error) => {
            if (closed || generation !== streamGeneration || !isStartingLive) return;
            console.warn('Failed to start camera live stream:', error);
            loadSnapshot();
            showToast(t('Failed to open camera viewer'), 'error', 2500);
          });
        }
      };
    }

    const closeModal = () => {
      if (closed) return;
      closed = true;
      stopLive();
      document.removeEventListener('keydown', handleModalKeydown, true);
      void closeModalAnimated(modal, { remove: true });
      if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
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

    document.addEventListener('keydown', handleModalKeydown, true);
    closeBtn?.focus({ preventScroll: true });

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
