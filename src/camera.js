const state = require('./state.js');
const websocket = require('./websocket.js');
let Hls = null;
try {
  Hls = require('hls.js');
} catch (e) {
  console.warn('hls.js not available:', e?.message || e);
}

async function getHlsStreamUrl(entityId) {
  try {
    const streamUrl = await websocket.request('camera/stream', { entity_id: entityId });
    if (!streamUrl) return null;
    const rawUrl = streamUrl.url;
    const abs = new URL(rawUrl, (state.CONFIG && state.CONFIG.homeAssistant && state.CONFIG.homeAssistant.url) || '');
    return abs.href;
  } catch (e) {
    console.warn('HLS stream request failed:', e?.message || e);
  }
  return null;
}

async function startHlsStream(video, entityId, streamUrl) {
  if (!Hls || !Hls.isSupported() || !video || !entityId) return;

  if (state.ACTIVE_HLS.has(entityId)) {
    state.ACTIVE_HLS.get(entityId).destroy();
  }

  const hls = new Hls();
  state.ACTIVE_HLS.set(entityId, hls);
  hls.loadSource(streamUrl);
  hls.attachMedia(video);
  hls.on(Hls.Events.ERROR, (_evt, data) => {
    console.warn('HLS error', data?.details || data);
    if (data?.fatal) {
      try { hls.destroy(); } catch (_error) {}
      state.ACTIVE_HLS.delete(entityId);
      video.style.display = 'none';
      img.style.display = 'block';
      img.src = `ha://camera_stream/${entityId}?t=${Date.now()}`;
    }
  });
  return true;
}

function stopHlsStream(entityId) {
  if (state.ACTIVE_HLS.has(entityId)) {
    state.ACTIVE_HLS.get(entityId).destroy();
    state.ACTIVE_HLS.delete(entityId);
  }
}

async function startSnapshotLive(img, entityId, rate = 1) {
  if (!img || !entityId) return;
  if (state.LIVE_SNAPSHOT_INTERVALS.has(entityId)) return; // Already running

  const url = `${state.CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}`;
  const headers = {
    Authorization: `Bearer ${state.CONFIG.homeAssistant.token}`,
    'Content-Type': 'application/json',
  };

  const update = async () => {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const blob = await res.blob();
        img.src = URL.createObjectURL(blob);
      } else {
        console.warn('Snapshot fetch failed:', res.status, res.statusText);
        img.src = '';
      }
    } catch (e) {
      console.warn('Snapshot fetch failed:', e?.message || e);
      img.src = '';
    }
  };
  update();
  const iv = setInterval(update, rate * 1000);
  state.LIVE_SNAPSHOT_INTERVALS.set(entityId, iv);
}

function clearSnapshotLive(entityId) {
  if (state.LIVE_SNAPSHOT_INTERVALS.has(entityId)) {
    clearInterval(state.LIVE_SNAPSHOT_INTERVALS.get(entityId));
    state.LIVE_SNAPSHOT_INTERVALS.delete(entityId);
  }
}

function stopAllCameraStreams() {
  for (const entityId of state.ACTIVE_HLS.keys()) {
    stopHlsStream(entityId);
  }
  for (const entityId of state.LIVE_SNAPSHOT_INTERVALS.keys()) {
    clearSnapshotLive(entityId);
  }
}

module.exports = {
    getHlsStreamUrl,
    startHlsStream,
    stopHlsStream,
    startSnapshotLive,
    clearSnapshotLive,
    stopAllCameraStreams,
};
