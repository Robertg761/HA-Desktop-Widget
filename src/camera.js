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
    const res = await websocket.request({ type: 'camera/stream', entity_id: entityId, format: 'hls' });
    if (res && res.success && res.result && (res.result.url || res.result)) {
      const rawUrl = typeof res.result === 'string' ? res.result : res.result.url;
      const abs = new URL(rawUrl, (state.CONFIG && state.CONFIG.homeAssistant && state.CONFIG.homeAssistant.url) || '');
      // Proxy through ha://hls to keep Authorization header handling in main
      return `ha://hls${abs.pathname}${abs.search || ''}`;
    }
  } catch (e) {
    console.warn('HLS stream request failed:', e?.message || e);
  }
  return null;
}

async function startHlsStream(video, entityId, streamUrl, imgElement) {
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
      try { 
        hls.destroy(); 
      } catch (_error) {
        console.warn('Failed to destroy HLS instance:', _error);
      }
      state.ACTIVE_HLS.delete(entityId);
      video.style.display = 'none';
      // Fallback to img if provided
      if (imgElement) {
        imgElement.style.display = 'block';
        imgElement.src = `ha://camera_stream/${entityId}?t=${Date.now()}`;
      }
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

  // Use ha:// protocol which proxies through main process (secure, bypasses CORS)
  const update = () => {
    try {
      // Add cache buster to force refresh
      const cacheBuster = `t=${Date.now()}`;
      img.src = `ha://camera/${entityId}?${cacheBuster}`;
    } catch (e) {
      console.warn('Snapshot update failed:', e?.message || e);
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

function openCamera(cameraId) {
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
    
    const utils = require('./utils.js');
    
    // Create a camera popup modal
    const modal = document.createElement('div');
    modal.className = 'modal camera-modal';
    modal.innerHTML = `
      <div class="modal-content camera-content">
        <div class="modal-header">
          <h2>${utils.escapeHtml(utils.getEntityDisplayName(camera))}</h2>
          <button class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div style="position: relative;">
            <img alt="${utils.escapeHtml(utils.getEntityDisplayName(camera))}" class="camera-stream camera-img">
            <div class="camera-loading" id="camera-loading">
              <div class="spinner"></div>
              Loading live stream...
            </div>
          </div>
          <div style="margin-top: 12px; display:flex; gap:8px;">
            <button class="btn btn-secondary" id="snapshot-btn">Snapshot</button>
            <button class="btn btn-primary" id="live-btn">Live</button>
          </div>
          <div class="camera-info">
            <p><strong>Status:</strong> ${camera.state}</p>
            <p><strong>Last Updated:</strong> ${new Date(camera.last_updated).toLocaleString()}</p>
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
      if (liveBtn) { liveBtn.textContent = 'Live'; }
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
        
        if (Hls && Hls.isSupported()) {
          const hls = new Hls({ lowLatencyMode: true, backBufferLength: 90 });
          hls.loadSource(hlsUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
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
        img.style.display = 'block';
        img.src = `ha://camera_stream/${cameraId}?t=${Date.now()}`;
        
        // Hide loading when MJPEG starts
        img.onload = () => showLoading(false);
        img.onerror = () => showLoading(false);
      }
      
      isLive = true;
      if (liveBtn) { liveBtn.textContent = 'Stop'; }
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

    if (closeBtn) {
      closeBtn.onclick = () => {
        stopLive();
        modal.remove();
      };
    }

    // Click outside to close
    modal.onclick = (e) => {
      if (e.target === modal) {
        stopLive();
        modal.remove();
      }
    };

    // Load initial snapshot
    loadSnapshot();
    
  } catch (error) {
    console.error('Error opening camera:', error);
    const uiUtils = require('./ui-utils.js');
    uiUtils.showToast('Failed to open camera viewer', 'error', 2000);
  }
}

module.exports = {
    getHlsStreamUrl,
    startHlsStream,
    stopHlsStream,
    startSnapshotLive,
    clearSnapshotLive,
    stopAllCameraStreams,
    openCamera,
};
