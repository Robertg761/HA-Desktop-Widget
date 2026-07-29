/**
 * @jest-environment jsdom
 */

const {
  createMockElectronAPI,
  resetMockElectronAPI,
  getMockConfig,
} = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Create mock electronAPI instance
let mockElectronAPI;
let mediaPauseSpy;
let mediaPlaySpy;

// Mock HLS.js
const mockHlsInstance = {
  loadSource: jest.fn(),
  attachMedia: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn(),
};
let mockHlsEventHandlers = {};

const mockHls = jest.fn(() => mockHlsInstance);
mockHls.isSupported = jest.fn(() => true);
mockHls.Events = {
  ERROR: 'hlsError',
  MANIFEST_PARSED: 'manifestParsed',
};

jest.mock('hls.js', () => mockHls, { virtual: true });

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
}));

jest.mock('../../src/utils.js', () => ({
  escapeHtml: jest.fn((str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }),
  escapeHtmlAttribute: jest.fn((str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }),
  getEntityDisplayName: jest.fn((entity) => {
    if (!entity) return 'Unknown Entity';
    return entity.attributes?.friendly_name || entity.entity_id;
  }),
}));

// Mock WebSocket
const mockWebSocketRequest = jest.fn();
const mockWebSocketCallService = jest.fn();
jest.mock('../../src/websocket.js', () => ({
  request: mockWebSocketRequest,
  callService: mockWebSocketCallService,
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {},
  ACTIVE_HLS: new Map(),
};

jest.mock('../../src/state.js', () => ({
  get CONFIG() {
    return mockState.CONFIG;
  },
  get STATES() {
    return mockState.STATES;
  },
  get ACTIVE_HLS() {
    return mockState.ACTIVE_HLS;
  },
}));

// Mock console methods
const mockConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();

// Setup global mocks
beforeAll(() => {
  // Create electronAPI instance
  mockElectronAPI = createMockElectronAPI();

  // Set electronAPI on window object (jsdom)
  window.electronAPI = mockElectronAPI;
  mediaPlaySpy = jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  mediaPauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

// Reset state before each test
beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Reset mock state
  mockState.CONFIG = null;
  mockState.STATES = {};
  mockState.ACTIVE_HLS.clear();

  // Reset HLS mock
  mockHls.mockClear();
  mockHlsInstance.loadSource.mockClear();
  mockHlsInstance.attachMedia.mockClear();
  mockHlsInstance.on.mockClear();
  mockHlsEventHandlers = {};
  mockHlsInstance.on.mockImplementation((event, handler) => {
    mockHlsEventHandlers[event] = handler;
  });
  mockHlsInstance.destroy.mockClear();

  // Restore isSupported after mockClear
  mockHls.isSupported = jest.fn(() => true);
  mockHls.Events = {
    ERROR: 'hlsError',
    MANIFEST_PARSED: 'manifestParsed',
  };

  // Reset WebSocket mock
  mockWebSocketRequest.mockClear();
  mockWebSocketCallService.mockReset();
  mockWebSocketCallService.mockResolvedValue({ success: true });

  // Reset console mocks
  mockConsoleWarn.mockClear();
  mockConsoleError.mockClear();
});

afterAll(() => {
  mediaPlaySpy.mockRestore();
  mediaPauseSpy.mockRestore();
  mockConsoleWarn.mockRestore();
  mockConsoleError.mockRestore();
});

describe('Camera Module', () => {
  // Require modules once
  const camera = require('../../src/camera.js');

  describe('Quick Access camera previews', () => {
    let visibilityState;
    let intersectionCallback = null;

    // jsdom has no IntersectionObserver, so stand one up and keep the callback the module
    // registers. The module caches its observer, so the stub has to outlive individual tests.
    beforeAll(() => {
      globalThis.IntersectionObserver = class {
        constructor(callback) {
          intersectionCallback = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });

    const setTileIntersecting = (tile, isIntersecting) => {
      intersectionCallback([{ target: tile, isIntersecting }]);
    };

    const createPreviewTile = () => {
      const tile = document.createElement('button');
      tile.innerHTML = `
        <div class="camera-tile-visual">
          <video class="camera-tile-preview-video" muted autoplay playsinline></video>
          <img class="camera-tile-preview-image" data-camera-buffer-active="true" alt="">
          <img class="camera-tile-preview-image" data-camera-buffer-active="false" alt="">
          <div class="camera-tile-fallback"></div>
        </div>
        <div class="camera-tile-preview-badge">
          <span class="camera-tile-preview-dot"></span>
          <span class="camera-tile-preview-badge-label"></span>
        </div>
        <span class="camera-tile-preview-status"></span>
      `;
      document.body.appendChild(tile);
      return tile;
    };

    // Snapshots decode into the buffer that is off screen, so the element under test is whichever
    // buffer is currently inactive.
    const pendingImage = (tile) =>
      tile.querySelector('.camera-tile-preview-image[data-camera-buffer-active="false"]');
    const activeImage = (tile) =>
      tile.querySelector('.camera-tile-preview-image[data-camera-buffer-active="true"]');
    const hasAnyImageSource = (tile) =>
      Array.from(tile.querySelectorAll('.camera-tile-preview-image')).some((image) =>
        image.hasAttribute('src')
      );
    const badgeLabel = (tile) =>
      tile.querySelector('.camera-tile-preview-badge-label')?.textContent || '';
    // jsdom reports naturalWidth 0 for every image, which the MJPEG path reads as an empty
    // response, so a decoded frame has to be simulated explicitly.
    const markDecoded = (image, width = 1280, height = 720) => {
      Object.defineProperty(image, 'naturalWidth', { configurable: true, value: width });
      Object.defineProperty(image, 'naturalHeight', { configurable: true, value: height });
      return image;
    };
    const flushLivePreviewStart = async () => {
      await jest.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await Promise.resolve();
      }
    };

    beforeEach(() => {
      camera.disposeAllCameraPreviews();
      document.body.innerHTML = '';
      visibilityState = 'visible';
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibilityState,
      });
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-07-17T12:00:00.000Z'));
      mockState.CONFIG = getMockConfig();
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });
    });

    afterEach(() => {
      camera.disposeAllCameraPreviews();
      jest.useRealTimers();
    });

    it('normalizes supported modes and defaults invalid values to off', () => {
      expect(camera.normalizeCameraPreviewRefresh(' 10S ')).toBe('10s');
      expect(camera.normalizeCameraPreviewRefresh(' LIVE ')).toBe('live');
      expect(camera.normalizeCameraPreviewRefresh('continuous')).toBe('off');
      expect(camera.normalizeCameraPreviewRefresh(null)).toBe('off');
      expect(camera.getCameraPreviewRefreshMs('30s')).toBe(30000);
      expect(camera.getCameraPreviewRefreshMs('off')).toBe(0);
    });

    it('loads immediately and refreshes only after the configured cadence', () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      expect(camera.mountCameraPreview(tile, 'camera.front_door', '10s')).toBe(true);
      expect(tile.dataset.cameraPreviewState).toBe('loading');
      jest.advanceTimersByTime(0);

      const firstBuffer = pendingImage(tile);
      const firstSrc = firstBuffer.getAttribute('src');
      expect(firstSrc).toMatch(/^ha:\/\/camera\/camera\.front_door\?preview=\d+&t=\d+$/);
      firstBuffer.onload();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(status.textContent).toBe('Snapshot loaded');
      expect(activeImage(tile)).toBe(firstBuffer);
      expect(firstBuffer.dataset.cameraBufferLoaded).toBe('true');

      jest.advanceTimersByTime(9999);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      jest.advanceTimersByTime(1);
      const secondBuffer = pendingImage(tile);
      expect(secondBuffer).not.toBe(firstBuffer);
      expect(secondBuffer.getAttribute('src')).not.toBe(firstSrc);
      expect(tile.dataset.cameraPreviewState).toBe('refreshing');
      // The previous frame stays on screen until the incoming snapshot has decoded.
      expect(activeImage(tile)).toBe(firstBuffer);
    });

    it('stops polling and says so while the camera is unavailable', () => {
      const tile = createPreviewTile();
      mockState.STATES = {
        'camera.front_door': { ...sampleStates['camera.front_door'], state: 'idle' },
      };

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      const loaded = pendingImage(tile);
      loaded.onload();
      const loadedSrc = loaded.getAttribute('src');

      mockState.STATES['camera.front_door'].state = 'unavailable';
      camera.mountCameraPreview(tile, 'camera.front_door', '10s');

      expect(tile.dataset.cameraPreviewState).toBe('unavailable');
      expect(tile.querySelector('.camera-tile-preview-status').textContent).toBe(
        'Camera unavailable'
      );
      // The last frame is kept rather than dropping the tile to a placeholder mid-outage.
      expect(loaded.getAttribute('src')).toBe(loadedSrc);

      // Polling an offline camera only produces failures, which would bury the real reason for
      // the tile under a generic error state.
      jest.advanceTimersByTime(120000);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      expect(tile.dataset.cameraPreviewState).toBe('unavailable');

      // Nothing that normally resumes a preview may restart it while the camera is down.
      setTileIntersecting(tile, false);
      setTileIntersecting(tile, true);
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(60000);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      expect(tile.dataset.cameraPreviewState).toBe('unavailable');

      mockState.STATES['camera.front_door'].state = 'idle';
      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('does not start requesting for a camera that is already unavailable', () => {
      const tile = createPreviewTile();
      mockState.STATES = {
        'camera.front_door': { ...sampleStates['camera.front_door'], state: 'unavailable' },
      };

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(60000);

      expect(tile.dataset.cameraPreviewState).toBe('unavailable');
      expect(hasAnyImageSource(tile)).toBe(false);
    });

    it('widens the retry gap for a camera whose snapshots keep failing', () => {
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      pendingImage(tile).onerror();

      // First failure keeps the 30s floor.
      jest.advanceTimersByTime(29999);
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(1);
      pendingImage(tile).onerror();

      // Second failure stretches to a minute rather than hammering every 30s forever.
      jest.advanceTimersByTime(30000);
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(30000);
      const retry = pendingImage(tile);
      expect(retry.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);

      // A success puts the cadence straight back to normal.
      retry.onload();
      jest.advanceTimersByTime(10000);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('holds the configured cadence when a tile scrolls out of view and back', () => {
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', '30s');
      jest.advanceTimersByTime(0);
      pendingImage(tile).onload();

      jest.advanceTimersByTime(5000);
      setTileIntersecting(tile, false);
      setTileIntersecting(tile, true);

      // Scrolling back into view must not restart the 30s cadence early.
      jest.advanceTimersByTime(0);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      jest.advanceTimersByTime(24999);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      jest.advanceTimersByTime(1);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('keeps an expanded live stream running when its tile scrolls out of view', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      video.onloadeddata();
      await camera.openCamera('camera.front_door', { sourceTile: tile });

      setTileIntersecting(tile, false);

      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
      expect(document.querySelector('.camera-expanded-preview').dataset.cameraPreviewState).toBe(
        'ready'
      );
    });

    it('staggers resumed previews when the window becomes visible again', () => {
      const firstTile = createPreviewTile();
      const secondTile = createPreviewTile();

      camera.mountCameraPreview(firstTile, 'camera.front_door', '5s');
      camera.mountCameraPreview(secondTile, 'camera.back_door', '5s');
      jest.advanceTimersByTime(200);
      pendingImage(firstTile).onload();
      pendingImage(secondTile).onload();

      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(30000);

      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(0);
      expect(pendingImage(firstTile).hasAttribute('src')).toBe(true);
      expect(pendingImage(secondTile).hasAttribute('src')).toBe(false);

      jest.advanceTimersByTime(180);
      expect(pendingImage(secondTile).hasAttribute('src')).toBe(true);
    });

    it('biases the crop upward for camera sources taller than the tile', () => {
      const tile = createPreviewTile();
      Object.defineProperty(tile, 'clientWidth', { configurable: true, value: 160 });
      Object.defineProperty(tile, 'clientHeight', { configurable: true, value: 96 });

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      const portraitBuffer = pendingImage(tile);
      Object.defineProperty(portraitBuffer, 'naturalWidth', { configurable: true, value: 1200 });
      Object.defineProperty(portraitBuffer, 'naturalHeight', { configurable: true, value: 1600 });
      portraitBuffer.onload();
      expect(portraitBuffer.style.objectPosition).toBe('center 30%');

      jest.advanceTimersByTime(10000);
      const landscapeBuffer = pendingImage(tile);
      Object.defineProperty(landscapeBuffer, 'naturalWidth', { configurable: true, value: 1920 });
      Object.defineProperty(landscapeBuffer, 'naturalHeight', { configurable: true, value: 1080 });
      landscapeBuffer.onload();
      expect(landscapeBuffer.style.objectPosition).toBe('');
    });

    it('keeps the last good frame when a snapshot refresh fails', () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      const loadedBuffer = pendingImage(tile);
      const loadedSrc = loadedBuffer.getAttribute('src');
      loadedBuffer.onload();

      jest.advanceTimersByTime(10000);
      pendingImage(tile).onerror();

      expect(tile.dataset.cameraPreviewState).toBe('stale');
      expect(status.textContent).toBe('Showing last frame');
      expect(activeImage(tile)).toBe(loadedBuffer);
      expect(loadedBuffer.getAttribute('src')).toBe(loadedSrc);
      expect(loadedBuffer.dataset.cameraBufferLoaded).toBe('true');

      jest.advanceTimersByTime(30000);
      const retryBuffer = pendingImage(tile);
      expect(retryBuffer.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      retryBuffer.onload();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(activeImage(tile)).toBe(retryBuffer);
    });

    it('keeps one authenticated HLS stream open while the tile is visible', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const status = tile.querySelector('.camera-tile-preview-status');

      expect(camera.mountCameraPreview(tile, 'camera.front_door', 'live')).toBe(true);
      expect(tile.dataset.cameraPreviewMode).toBe('live');
      expect(tile.dataset.cameraPreviewState).toBe('loading');
      await flushLivePreviewStart();

      expect(mockWebSocketRequest).toHaveBeenCalledWith({
        type: 'camera/stream',
        entity_id: 'camera.front_door',
        format: 'hls',
      });
      expect(mockHlsInstance.loadSource).toHaveBeenCalledWith(
        'ha://hls/api/hls/master_playlist.m3u8'
      );
      expect(mockHlsInstance.attachMedia).toHaveBeenCalledWith(video);
      video.onloadeddata();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(tile.dataset.cameraPreviewSource).toBe('video');
      expect(status.textContent).toBe('Live now');

      jest.advanceTimersByTime(60000);
      expect(mockHls).toHaveBeenCalledTimes(1);
      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
    });

    it('stops a live stream while hidden and starts a new one when visible again', async () => {
      const tile = createPreviewTile();
      const image = tile.querySelector('.camera-tile-preview-image');
      const video = tile.querySelector('.camera-tile-preview-video');
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      video.onloadeddata();

      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      expect(image.hasAttribute('src')).toBe(false);
      expect(mockHlsInstance.destroy).toHaveBeenCalledTimes(1);
      expect(tile.dataset.cameraPreviewState).toBe('paused');
      expect(status.textContent).toBe('Live preview paused');

      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
      expect(mockHlsInstance.loadSource).toHaveBeenLastCalledWith(
        'ha://hls/api/hls/master_playlist.m3u8'
      );
    });

    it('shows a snapshot fallback and retries when HLS reports a fatal error', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });

      const image = pendingImage(tile);
      const fallbackSrc = image.getAttribute('src');
      expect(fallbackSrc).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      // The tile is too narrow for the full explanation; the expanded view carries that.
      expect(status.textContent).toBe('Loading snapshot…');
      image.onload();
      expect(tile.dataset.cameraPreviewState).toBe('fallback');
      expect(status.textContent).toBe('Snapshot fallback');
      expect(badgeLabel(tile)).toBe('Snapshot');

      jest.advanceTimersByTime(29999);
      expect(image.getAttribute('src')).toBe(fallbackSrc);
      await jest.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      expect(mockHls).toHaveBeenCalledTimes(2);
    });

    it('paints a still while the live stream is still negotiating', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();

      const warmup = pendingImage(tile);
      expect(warmup.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      expect(tile.dataset.cameraPreviewHasFrame).toBe('false');

      warmup.onload();
      // Still waiting on the stream, but the tile has a picture and still says so honestly.
      expect(tile.dataset.cameraPreviewState).toBe('loading');
      expect(tile.dataset.cameraPreviewSource).toBe('image');
      expect(tile.dataset.cameraPreviewHasFrame).toBe('true');
      expect(activeImage(tile)).toBe(warmup);
      expect(status.textContent).toBe('Starting live stream…');
      expect(badgeLabel(tile)).toBe('Live');

      video.onloadeddata();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(tile.dataset.cameraPreviewSource).toBe('video');
      expect(hasAnyImageSource(tile)).toBe(false);
    });

    it('does not let a late warmup still displace a running stream', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      const warmup = pendingImage(tile);

      video.onloadeddata();
      expect(tile.dataset.cameraPreviewSource).toBe('video');

      // Switching to the stream tears the buffer down, so a still that lands afterwards has
      // nothing left to display into.
      expect(warmup.onload).toBeNull();
      expect(warmup.hasAttribute('src')).toBe(false);
      expect(tile.dataset.cameraPreviewHasFrame).toBe('false');
      expect(tile.dataset.cameraPreviewState).toBe('ready');
    });

    it('reuses the warmup still instead of refetching when the stream fails', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      const warmup = pendingImage(tile);
      const warmupSrc = warmup.getAttribute('src');
      warmup.onload();

      mockHlsEventHandlers.hlsError(null, { fatal: true });

      // No second request: the still from this attempt is seconds old and already on screen.
      expect(hasAnyImageSource(tile)).toBe(true);
      expect(activeImage(tile)).toBe(warmup);
      expect(warmup.getAttribute('src')).toBe(warmupSrc);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      expect(tile.dataset.cameraPreviewState).toBe('fallback');
      expect(status.textContent).toBe('Snapshot fallback');
      expect(badgeLabel(tile)).toBe('Snapshot');
    });

    it('widens the gap between live attempts while snapshots keep refreshing', async () => {
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(1);

      // First failure: the next live attempt is still one snapshot cycle away.
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);

      // Second failure: the cycle 30s later must refresh the snapshot without touching HLS.
      // MJPEG was ruled out on the first failure, so it is not probed again.
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      const secondFallback = pendingImage(tile);
      secondFallback.onload();
      const secondSrc = secondFallback.getAttribute('src');
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
      const backedOffSrc = pendingImage(tile).getAttribute('src');
      expect(backedOffSrc).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      expect(backedOffSrc).not.toBe(secondSrc);

      // A minute after the second failure the live attempt is due again.
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(3);
    });

    it('drops the live backoff when the camera starts streaming again', async () => {
      const tile = createPreviewTile();
      mockState.STATES = {
        'camera.front_door': { ...sampleStates['camera.front_door'], state: 'idle' },
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      expect(mockHls).toHaveBeenCalledTimes(2);

      // Backed off to a minute, so the next cycle would normally be a snapshot only.
      mockState.STATES['camera.front_door'].state = 'streaming';
      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(3);
    });

    it('ignores motion churn between idle and recording for the live backoff', async () => {
      const tile = createPreviewTile();
      mockState.STATES = {
        'camera.front_door': { ...sampleStates['camera.front_door'], state: 'idle' },
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      expect(mockHls).toHaveBeenCalledTimes(2);

      // idle -> recording is routine motion activity, not evidence the stream now works.
      mockState.STATES['camera.front_door'].state = 'recording';
      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
    });

    it('restarts the live retry ladder once the stream recovers', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();

      // The cycle 30s on is a backed-off snapshot; the live attempt lands 30s after that.
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(3);
      video.onloadeddata();
      expect(tile.dataset.cameraPreviewState).toBe('ready');

      mockHlsEventHandlers.hlsError(null, { fatal: true });
      pendingImage(tile).onload();
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(4);
    });

    it('retains the MJPEG compatibility path when a non-Aarlo camera has no HLS URL', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');
      mockWebSocketRequest.mockResolvedValue({ success: false });

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();

      const image = pendingImage(tile);
      expect(image.getAttribute('src')).toMatch(
        /^ha:\/\/camera_stream\/camera\.front_door\?preview=\d+&t=\d+$/
      );
      expect(tile.dataset.cameraPreviewSource).toBe('image');
      markDecoded(image).onload();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(status.textContent).toBe('Live now');
      expect(badgeLabel(tile)).toBe('Live');
    });

    it('stops calling a stalled MJPEG stream live once it drops', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');
      mockWebSocketRequest.mockResolvedValue({ success: false });

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      const stream = pendingImage(tile);
      markDecoded(stream).onload();
      expect(tile.dataset.cameraPreviewState).toBe('ready');
      expect(badgeLabel(tile)).toBe('Live');

      // The main process ends a stream that stops sending frames, which reaches the renderer as
      // an ordinary image error rather than a silent freeze.
      stream.onerror();

      expect(tile.dataset.cameraPreviewState).not.toBe('ready');
      expect(stream.hasAttribute('src')).toBe(false);
      const snapshot = pendingImage(tile);
      expect(snapshot.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      snapshot.onload();
      expect(status.textContent).toBe('Snapshot fallback');
      expect(badgeLabel(tile)).toBe('Snapshot');
    });

    it('treats an empty MJPEG response as a failure and stops probing that camera', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');
      const entityId = 'camera.aarlo_doorbell_cam';
      mockState.STATES = {
        [entityId]: {
          ...sampleStates['camera.front_door'],
          entity_id: entityId,
          attributes: {
            ...sampleStates['camera.front_door'].attributes,
            brand: 'Arlo',
          },
        },
      };
      mockWebSocketRequest.mockResolvedValue({ success: false });

      camera.mountCameraPreview(tile, entityId, 'live');
      await flushLivePreviewStart();

      // Some integrations answer the stream endpoint with nothing at all, firing load rather
      // than error. A frame with no pixels is not a live stream.
      const probe = pendingImage(tile);
      expect(probe.getAttribute('src')).toMatch(/^ha:\/\/camera_stream\//);
      probe.onload();

      const snapshot = pendingImage(tile);
      expect(snapshot.getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.aarlo_doorbell_cam\?preview=\d+&t=\d+$/
      );
      expect(status.textContent).toBe('Loading snapshot…');
      snapshot.onload();
      expect(tile.dataset.cameraPreviewState).toBe('fallback');

      // The camera is remembered as MJPEG-incapable, so the next attempt skips the probe.
      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(pendingImage(tile).getAttribute('src')).toMatch(/^ha:\/\/camera\//);
    });

    it('falls back instead of waiting forever when HLS never produces a frame', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();

      jest.advanceTimersByTime(29999);
      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
      expect(status.textContent).toBe('Starting live stream…');

      jest.advanceTimersByTime(1);
      expect(mockHlsInstance.destroy).toHaveBeenCalledTimes(1);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
      expect(status.textContent).toBe('Loading snapshot…');
    });

    it('gives a camera the full wait once, then gives up on the stream sooner', async () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();

      // A cloud camera can legitimately need 20s+, so the first attempt waits the full time.
      jest.advanceTimersByTime(29999);
      expect(status.textContent).toBe('Starting live stream…');
      jest.advanceTimersByTime(1);
      expect(status.textContent).toBe('Loading snapshot…');
      pendingImage(tile).onload();

      await jest.advanceTimersByTimeAsync(30000);
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
      expect(status.textContent).toBe('Starting live stream…');

      // This camera has already failed once, so the tile stops claiming to be starting a stream
      // long before another 30 seconds have gone by.
      jest.advanceTimersByTime(9999);
      expect(status.textContent).toBe('Starting live stream…');
      jest.advanceTimersByTime(1);
      expect(status.textContent).toBe('Loading snapshot…');
      pendingImage(tile).onload();
      expect(tile.dataset.cameraPreviewState).toBe('fallback');
      expect(badgeLabel(tile)).toBe('Snapshot');
    });

    it('expands and collapses the exact preview visual without restarting HLS', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const visual = tile.querySelector('.camera-tile-visual');
      const originalParent = visual.parentNode;
      mockState.CONFIG = getMockConfig();
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      video.onloadeddata();

      await camera.openCamera('camera.front_door', { sourceTile: tile });

      const expanded = document.querySelector('.camera-expanded-preview');
      expect(expanded).toBeTruthy();
      expect(expanded.getAttribute('role')).toBe('dialog');
      expect(expanded.dataset.cameraPreviewState).toBe('ready');
      expect(expanded.querySelector('.camera-expanded-preview-stage .camera-tile-visual')).toBe(
        visual
      );
      expect(expanded.querySelector('.camera-expanded-preview-stage video')).toBe(video);
      expect(expanded.querySelector('.camera-expanded-preview-status').textContent).toBe(
        'Live now'
      );
      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
      expect(document.querySelector('.camera-modal')).toBeNull();

      expect(camera.mountCameraPreview(tile, 'camera.front_door', 'live')).toBe(true);
      expect(document.querySelector('.camera-expanded-preview')).toBe(expanded);
      expect(expanded.querySelector('.camera-expanded-preview-stage .camera-tile-visual')).toBe(
        visual
      );
      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();

      expanded.querySelector('.camera-expanded-preview-close').click();

      expect(document.querySelector('.camera-expanded-preview')).toBeNull();
      expect(visual.parentNode).toBe(originalParent);
      expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
      expect(visual.style.getPropertyValue('view-transition-name')).toBe('');
    });

    it('updates the expanded status and falls back when startup stalls', async () => {
      const tile = createPreviewTile();
      const buffers = Array.from(tile.querySelectorAll('.camera-tile-preview-image'));
      mockState.CONFIG = getMockConfig();
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      await camera.openCamera('camera.front_door', { sourceTile: tile });

      jest.advanceTimersByTime(30000);

      // The expanded stage reuses the tile's own buffers rather than cloning the media.
      const expanded = document.querySelector('.camera-expanded-preview');
      expect(expanded.querySelector('.camera-expanded-preview-stage img')).toBe(buffers[0]);
      expect(expanded.querySelector('.camera-expanded-preview-status').textContent).toBe(
        'Live unavailable — loading snapshot…'
      );
      const loadingBuffer = buffers.find((buffer) => buffer.hasAttribute('src'));
      expect(loadingBuffer.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
    });

    it('clears stale Aarlo activity and retries HLS from the expanded Reconnect action', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const entityId = 'camera.aarlo_doorbell_cam';
      const aarloCamera = {
        ...sampleStates['camera.front_door'],
        entity_id: entityId,
        attributes: {
          ...sampleStates['camera.front_door'].attributes,
          friendly_name: 'Doorbell Cam',
          brand: 'Arlo',
        },
      };
      mockState.CONFIG = getMockConfig();
      mockState.STATES = { [entityId]: aarloCamera };
      mockWebSocketRequest.mockResolvedValueOnce({ success: false }).mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.mountCameraPreview(tile, entityId, 'live');
      await flushLivePreviewStart();
      // No stream URL, so MJPEG is probed once; jsdom decodes it to zero pixels, which the
      // preview treats as an empty response and drops to stills.
      pendingImage(tile).onload();
      pendingImage(tile).onload();
      await camera.openCamera(entityId, { sourceTile: tile });

      const expanded = document.querySelector('.camera-expanded-preview');
      const reconnect = expanded.querySelector('.camera-expanded-preview-reconnect');
      expect(expanded.dataset.cameraPreviewState).toBe('fallback');
      const reconnectPromise = reconnect.onclick(new MouseEvent('click', { bubbles: true }));

      expect(mockWebSocketCallService).toHaveBeenCalledWith('aarlo', 'camera_stop_activity', {
        entity_id: entityId,
      });
      expect(reconnect.disabled).toBe(true);
      expect(reconnect.textContent).toBe('Reconnecting…');
      expect(expanded.querySelector('.camera-expanded-preview-status').textContent).toBe(
        'Reconnecting live stream…'
      );

      await mockWebSocketCallService.mock.results[0].value;
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(749);
      expect(mockHls).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await reconnectPromise;
      await jest.advanceTimersByTimeAsync(1);
      await flushLivePreviewStart();

      expect(mockHls).toHaveBeenCalledTimes(1);
      expect(mockHlsInstance.loadSource).toHaveBeenCalledWith(
        'ha://hls/api/hls/master_playlist.m3u8'
      );
      video.onloadeddata();
      expect(expanded.dataset.cameraPreviewState).toBe('ready');
      expect(expanded.dataset.cameraPreviewSource).toBe('video');
      expect(expanded.querySelector('.camera-expanded-preview-status').textContent).toBe(
        'Live now'
      );
      expect(reconnect.disabled).toBe(false);
      expect(reconnect.textContent).toBe('Reconnect');
    });

    it('still retries HLS when clearing stale Aarlo activity reports an error', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const entityId = 'camera.aarlo_doorbell_cam';
      const aarloCamera = {
        ...sampleStates['camera.front_door'],
        entity_id: entityId,
        attributes: {
          ...sampleStates['camera.front_door'].attributes,
          brand: 'Arlo',
        },
      };
      mockState.CONFIG = getMockConfig();
      mockState.STATES = { [entityId]: aarloCamera };

      camera.mountCameraPreview(tile, entityId, 'live');
      await flushLivePreviewStart();
      video.onloadeddata();
      await camera.openCamera(entityId, { sourceTile: tile });
      mockWebSocketCallService.mockRejectedValueOnce(new Error('Service unavailable'));

      const reconnect = document.querySelector('.camera-expanded-preview-reconnect');
      const reconnectPromise = reconnect.onclick(new MouseEvent('click', { bubbles: true }));
      await mockWebSocketCallService.mock.results[0].value.catch(() => {});
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(750);
      await reconnectPromise;
      await jest.advanceTimersByTimeAsync(1);
      await flushLivePreviewStart();

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'Failed to clear stale Aarlo camera activity:',
        'Service unavailable'
      );
      expect(mockHls).toHaveBeenCalledTimes(2);
    });

    it('waits for an Aarlo camera to return to idle before restarting HLS', async () => {
      const tile = createPreviewTile();
      const video = tile.querySelector('.camera-tile-preview-video');
      const entityId = 'camera.aarlo_doorbell_cam';
      const aarloCamera = {
        ...sampleStates['camera.front_door'],
        entity_id: entityId,
        state: 'streaming',
        attributes: {
          ...sampleStates['camera.front_door'].attributes,
          brand: 'Arlo',
        },
      };
      mockState.STATES = { [entityId]: aarloCamera };

      camera.mountCameraPreview(tile, entityId, 'live');
      await flushLivePreviewStart();
      video.onloadeddata();
      await camera.openCamera(entityId, { sourceTile: tile });

      const reconnect = document.querySelector('.camera-expanded-preview-reconnect');
      const reconnectPromise = reconnect.onclick(new MouseEvent('click', { bubbles: true }));
      await mockWebSocketCallService.mock.results[0].value;
      await Promise.resolve();
      expect(jest.getTimerCount()).toBe(1);

      await jest.advanceTimersByTimeAsync(249);
      expect(mockHls).toHaveBeenCalledTimes(1);
      mockState.STATES[entityId].state = 'idle';
      await jest.advanceTimersByTimeAsync(1);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(499);
      expect(mockHls).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await reconnectPromise;
      await jest.advanceTimersByTimeAsync(1);
      await flushLivePreviewStart();

      expect(mockHls).toHaveBeenCalledTimes(2);
      expect(mockHlsInstance.loadSource).toHaveBeenLastCalledWith(
        'ha://hls/api/hls/master_playlist.m3u8'
      );
    });

    it('returns the shared preview to its tile when Escape closes the expanded view', async () => {
      const tile = createPreviewTile();
      const visual = tile.querySelector('.camera-tile-visual');
      mockState.CONFIG = getMockConfig();
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', '10s');
      jest.advanceTimersByTime(0);
      const image = pendingImage(tile);
      image.onload();
      await camera.openCamera('camera.front_door', { sourceTile: tile });

      expect(visual.getAttribute('aria-hidden')).toBeNull();
      expect(image.getAttribute('alt')).toBe('Front Door Camera Preview');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.querySelector('.camera-expanded-preview')).toBeNull();
      expect(visual.parentNode).toBe(tile);
      expect(image.parentNode).toBe(visual);
      expect(image.hasAttribute('src')).toBe(true);
      expect(image.getAttribute('alt')).toBe('');
    });

    it('removes an expanded preview and its pending request when the tile is disposed', async () => {
      const tile = createPreviewTile();
      mockState.CONFIG = getMockConfig();
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      jest.advanceTimersByTime(0);
      await camera.openCamera('camera.front_door', { sourceTile: tile });
      expect(document.querySelector('.camera-expanded-preview')).toBeTruthy();

      expect(camera.disposeCameraPreview(tile)).toBe(true);

      expect(document.querySelector('.camera-expanded-preview')).toBeNull();
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(60000);
      expect(hasAnyImageSource(tile)).toBe(false);
    });

    it('times out a stalled snapshot request and backs off before retrying', () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', '5s');
      jest.advanceTimersByTime(0);
      expect(hasAnyImageSource(tile)).toBe(true);

      jest.advanceTimersByTime(20000);
      expect(hasAnyImageSource(tile)).toBe(false);
      expect(tile.dataset.cameraPreviewState).toBe('error');
      expect(status.textContent).toBe('Preview unavailable');

      jest.advanceTimersByTime(29999);
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(1);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('suspends the tile stream while the full camera viewer is open', async () => {
      const tile = createPreviewTile();
      const image = tile.querySelector('.camera-tile-preview-image');
      const video = tile.querySelector('.camera-tile-preview-video');
      mockState.CONFIG = getMockConfig();
      mockState.STATES = {
        'camera.front_door': sampleStates['camera.front_door'],
      };

      camera.mountCameraPreview(tile, 'camera.front_door', 'live');
      await flushLivePreviewStart();
      video.onloadeddata();
      expect(tile.dataset.cameraPreviewSource).toBe('video');

      await camera.openCamera('camera.front_door');
      expect(mockHlsInstance.destroy).toHaveBeenCalledTimes(1);
      expect(tile.dataset.cameraPreviewState).toBe('paused');

      document.querySelector('.camera-modal .close-btn').click();
      camera.refreshCameraPreview('camera.front_door', { force: true });
      await flushLivePreviewStart();
      expect(mockHls).toHaveBeenCalledTimes(2);
      expect(mockHlsInstance.loadSource).toHaveBeenLastCalledWith(
        'ha://hls/api/hls/master_playlist.m3u8'
      );
      expect(image.hasAttribute('src')).toBe(false);
    });

    it('backs off failed snapshots for at least thirty seconds', () => {
      const tile = createPreviewTile();
      const status = tile.querySelector('.camera-tile-preview-status');

      camera.mountCameraPreview(tile, 'camera.front_door', '5s');
      jest.advanceTimersByTime(0);
      pendingImage(tile).onerror();

      // Nothing has loaded yet, so there is no frame worth keeping on screen.
      expect(hasAnyImageSource(tile)).toBe(false);
      expect(tile.dataset.cameraPreviewState).toBe('error');
      expect(status.textContent).toBe('Preview unavailable');
      jest.advanceTimersByTime(29999);
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(1);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('pauses refreshes while the document is hidden and resumes on visibility', () => {
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', '5s');
      jest.advanceTimersByTime(0);
      const loadedBuffer = pendingImage(tile);
      loadedBuffer.onload();
      const firstSrc = loadedBuffer.getAttribute('src');

      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(30000);
      expect(pendingImage(tile).hasAttribute('src')).toBe(false);
      expect(loadedBuffer.getAttribute('src')).toBe(firstSrc);

      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(0);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('does not request snapshots when mounted while hidden', () => {
      visibilityState = 'hidden';
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', '5s');
      jest.advanceTimersByTime(60000);
      expect(hasAnyImageSource(tile)).toBe(false);

      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      jest.advanceTimersByTime(0);
      expect(pendingImage(tile).getAttribute('src')).toMatch(
        /^ha:\/\/camera\/camera\.front_door\?/
      );
    });

    it('cleans up pending refreshes when a tile is disposed', () => {
      const tile = createPreviewTile();

      camera.mountCameraPreview(tile, 'camera.front_door', '5s');
      jest.advanceTimersByTime(0);
      pendingImage(tile).onload();

      expect(camera.disposeCameraPreview(tile)).toBe(true);
      expect(hasAnyImageSource(tile)).toBe(false);
      jest.advanceTimersByTime(30000);
      expect(hasAnyImageSource(tile)).toBe(false);
      expect(camera.disposeCameraPreview(tile)).toBe(false);
    });
  });

  describe('getHlsStreamUrl', () => {
    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
    });

    it('should request HLS stream URL from WebSocket', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      await camera.getHlsStreamUrl('camera.front_door');

      expect(mockWebSocketRequest).toHaveBeenCalledWith({
        type: 'camera/stream',
        entity_id: 'camera.front_door',
        format: 'hls',
      });
    });

    it('should return proxied ha://hls URL on success', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should handle string result for backward compatibility', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: '/api/hls/master_playlist.m3u8',
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should handle object result with url property', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should convert relative URL to absolute using CONFIG.homeAssistant.url', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8?token=abc' },
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8?token=abc');
    });

    it('should return null on WebSocket error', async () => {
      mockWebSocketRequest.mockRejectedValue(new Error('Connection failed'));

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBeNull();
    });

    it('should return null when result.success is false', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false,
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBeNull();
    });

    it('should log warning on failure', async () => {
      mockWebSocketRequest.mockRejectedValue(new Error('Stream unavailable'));

      await camera.getHlsStreamUrl('camera.front_door');

      // The entity has to be named or a multi-camera log cannot be read.
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'Camera stream request failed (camera.front_door):',
        'Stream unavailable'
      );
    });
  });

  describe('openCamera - Modal Creation', () => {
    const utils = require('../../src/utils.js');
    let originalGetEntityDisplayName;
    let originalEscapeHtml;
    let dateNowSpy;

    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
      mockState.STATES = sampleStates;

      // Mock Date.now() for snapshot URLs
      dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);

      // Save original mock implementations
      originalGetEntityDisplayName = utils.getEntityDisplayName.getMockImplementation();
      originalEscapeHtml = utils.escapeHtml.getMockImplementation();
    });

    afterEach(() => {
      // Clean up any modals created during tests
      document.querySelectorAll('.camera-modal').forEach((modal) => modal.remove());

      // Restore Date.now spy
      if (dateNowSpy) {
        dateNowSpy.mockRestore();
      }

      // Restore original mock implementations
      if (originalGetEntityDisplayName) {
        utils.getEntityDisplayName.mockImplementation(originalGetEntityDisplayName);
      }
      if (originalEscapeHtml) {
        utils.escapeHtml.mockImplementation(originalEscapeHtml);
      }
    });

    it('should create modal element and append to document.body', () => {
      camera.openCamera('camera.front_door');

      const modal = document.querySelector('.camera-modal');
      expect(modal).toBeTruthy();
      expect(document.body.contains(modal)).toBe(true);
    });

    it('should display camera name and info', () => {
      camera.openCamera('camera.front_door');

      const modal = document.querySelector('.camera-modal');
      const header = modal.querySelector('.modal-header h2');
      expect(header.textContent).toBe('Front Door Camera');
    });

    it('should create Snapshot and Live buttons', () => {
      camera.openCamera('camera.front_door');

      const snapshotBtn = document.querySelector('#snapshot-btn');
      const liveBtn = document.querySelector('#live-btn');

      expect(snapshotBtn).toBeTruthy();
      expect(snapshotBtn.textContent).toBe('Snapshot');
      expect(liveBtn).toBeTruthy();
      expect(liveBtn.textContent).toBe('Live');
    });

    it('should load initial snapshot on open', () => {
      camera.openCamera('camera.front_door');

      const img = document.querySelector('.camera-img');
      expect(img.src).toBe('ha://camera/camera.front_door?t=1234567890');
    });

    it('closes on Escape and restores focus to the opener', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();

      await camera.openCamera('camera.front_door');
      const modal = document.querySelector('.camera-modal');
      expect(modal.getAttribute('role')).toBe('dialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(modal.querySelector('.close-btn'));

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(document.querySelector('.camera-modal')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('reports a failed snapshot instead of leaving a broken image', async () => {
      const { showToast } = require('../../src/ui-utils.js');
      await camera.openCamera('camera.front_door');
      const img = document.querySelector('.camera-modal .camera-stream');

      expect(img.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
      img.onerror();

      expect(showToast).toHaveBeenCalledWith('Could not load camera snapshot', 'error', 2500);
      expect(document.getElementById('camera-loading').style.display).toBe('none');
    });

    it('should close modal when close button clicked', () => {
      camera.openCamera('camera.front_door');

      const closeBtn = document.querySelector('.close-btn');
      closeBtn.click();

      const modal = document.querySelector('.camera-modal');
      expect(modal).toBeNull();
    });

    it('should close modal when clicking outside', () => {
      camera.openCamera('camera.front_door');

      const modal = document.querySelector('.camera-modal');

      // Simulate click on modal background
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal, writable: false });
      modal.dispatchEvent(clickEvent);

      // Modal should be removed
      expect(document.querySelector('.camera-modal')).toBeNull();
    });

    it('should not close modal when clicking inside content', () => {
      camera.openCamera('camera.front_door');

      const modal = document.querySelector('.camera-modal');
      const content = modal.querySelector('.modal-content');

      // Simulate click on content area
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: content, writable: false });
      modal.dispatchEvent(clickEvent);

      // Modal should still exist
      expect(document.querySelector('.camera-modal')).toBeTruthy();
    });

    it('should handle missing CONFIG error', () => {
      mockState.CONFIG = null;

      camera.openCamera('camera.front_door');

      expect(mockConsoleError).toHaveBeenCalledWith('Home Assistant not configured');
      expect(document.querySelector('.camera-modal')).toBeNull();
    });

    it('should handle missing camera entity error', () => {
      camera.openCamera('camera.nonexistent');

      expect(mockConsoleError).toHaveBeenCalledWith('Camera not found:', 'camera.nonexistent');
      expect(document.querySelector('.camera-modal')).toBeNull();
    });

    it('should load snapshot when Snapshot button clicked', () => {
      camera.openCamera('camera.front_door');

      const img = document.querySelector('.camera-img');
      img.src = ''; // Reset src

      const snapshotBtn = document.querySelector('#snapshot-btn');
      snapshotBtn.click();

      expect(img.src).toBe('ha://camera/camera.front_door?t=1234567890');
    });

    it('should toggle Live button text to Stop when live started', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false, // Make HLS fail to avoid complexity
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');

      // Click Live button
      await liveBtn.click();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(liveBtn.textContent).toBe('Stop');
    });

    it('should toggle Live button back to Live when stopped', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false,
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');

      // Start live
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Stop live
      await liveBtn.click();

      expect(liveBtn.textContent).toBe('Live');
    });

    it('should show camera status and last updated time', () => {
      camera.openCamera('camera.front_door');

      const modal = document.querySelector('.camera-modal');
      const cameraInfo = modal.querySelector('.camera-info');

      expect(cameraInfo.textContent).toContain('Status:');
      expect(cameraInfo.textContent).toContain('Last Updated:');
    });
  });

  describe('openCamera - HLS Integration', () => {
    let dateNowSpy;

    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
      mockState.STATES = sampleStates;

      // Mock Date.now() for snapshot URLs
      dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    });

    afterEach(() => {
      document.querySelectorAll('.camera-modal').forEach((modal) => modal.remove());

      // Restore Date.now spy
      if (dateNowSpy) {
        dateNowSpy.mockRestore();
      }
    });

    it('should attempt HLS stream when Live button clicked', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      // Verify modal was created
      const modal = document.querySelector('.camera-modal');
      expect(modal).toBeTruthy();

      const liveBtn = document.querySelector('#live-btn');
      expect(liveBtn).toBeTruthy();
      await liveBtn.click();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockWebSocketRequest).toHaveBeenCalledWith({
        type: 'camera/stream',
        entity_id: 'camera.front_door',
        format: 'hls',
      });
    });

    it('should create video element for HLS', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      expect(video).toBeTruthy();
    });

    it('should initialize HLS with correct configuration', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockHls).toHaveBeenCalledWith({
        lowLatencyMode: true,
        backBufferLength: 90,
      });
    });

    it('should set video attributes correctly', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      expect(video.muted).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.autoplay).toBe(true);
      expect(video.controls).toBe(false);
    });

    it('should show video and hide img on HLS success', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      const img = document.querySelector('.camera-img');

      expect(video.style.display).toBe('block');
      expect(img.style.display).toBe('none');
    });

    it('should fallback to MJPEG if HLS not available', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false,
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const img = document.querySelector('.camera-img');
      expect(img.src).toBe('ha://camera_stream/camera.front_door?t=1234567890');
      expect(img.style.display).toBe('block');
    });

    it('should handle Safari native HLS support', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      // Mock HLS.js not supported but video.canPlayType returns true (Safari)
      mockHls.isSupported.mockReturnValue(false);

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Create video element with canPlayType mock
      const video = document.querySelector('video.camera-video');
      if (video) {
        video.canPlayType = jest.fn(() => 'maybe');
      }

      // Since we're testing after the fact, just verify the video element was created
      expect(video).toBeTruthy();
    });

    it('should destroy HLS when modal is closed', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Close modal
      const closeBtn = document.querySelector('.close-btn');
      closeBtn.click();

      // HLS should be stopped
      expect(mockState.ACTIVE_HLS.size).toBe(0);
    });

    it('should replace an MJPEG live source with a finite snapshot when stopped', async () => {
      mockWebSocketRequest.mockResolvedValue({ success: false });
      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const img = document.querySelector('.camera-img');
      expect(img.getAttribute('src')).toContain('ha://camera_stream/');

      liveBtn.click();

      expect(img.getAttribute('src')).toBe('ha://camera/camera.front_door?t=1234567890');
      expect(img.getAttribute('src')).not.toContain('camera_stream');
      expect(liveBtn.textContent).toBe('Live');
    });

    it('should pause and clear a native HLS source when stopped', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });
      mockHls.isSupported.mockReturnValue(false);
      const canPlayTypeSpy = jest
        .spyOn(HTMLMediaElement.prototype, 'canPlayType')
        .mockReturnValue('maybe');
      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      liveBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const video = document.querySelector('video.camera-video');
      expect(video.hasAttribute('src')).toBe(true);

      mediaPauseSpy.mockClear();
      liveBtn.click();

      expect(video.hasAttribute('src')).toBe(false);
      expect(video.style.display).toBe('none');
      expect(mediaPauseSpy).toHaveBeenCalled();
      canPlayTypeSpy.mockRestore();
    });

    it('should not attach a stream after the modal closes during startup', async () => {
      let resolveStreamRequest;
      mockWebSocketRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveStreamRequest = resolve;
          })
      );
      camera.openCamera('camera.front_door');

      document.querySelector('#live-btn').click();
      await Promise.resolve();
      document.querySelector('.close-btn').click();
      resolveStreamRequest({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelector('.camera-modal')).toBeNull();
      expect(mockHls).not.toHaveBeenCalled();
      expect(mockState.ACTIVE_HLS.size).toBe(0);
    });

    it('should treat a second click during startup as cancellation, not another start', async () => {
      let resolveStreamRequest;
      mockWebSocketRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveStreamRequest = resolve;
          })
      );
      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      liveBtn.click();
      liveBtn.click();
      resolveStreamRequest({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockWebSocketRequest).toHaveBeenCalledTimes(1);
      expect(mockHls).not.toHaveBeenCalled();
      expect(document.querySelector('.camera-img').getAttribute('src')).toBe(
        'ha://camera/camera.front_door?t=1234567890'
      );
      expect(liveBtn.textContent).toBe('Live');
    });

    it('should not report an intentional startup cancellation as a viewer failure', async () => {
      const { showToast } = require('../../src/ui-utils.js');
      let rejectStreamRequest;
      mockWebSocketRequest.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectStreamRequest = reject;
          })
      );
      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      liveBtn.click();
      await Promise.resolve();
      liveBtn.click();
      rejectStreamRequest(new Error('request cancelled'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelector('.camera-img').getAttribute('src')).toBe(
        'ha://camera/camera.front_door?t=1234567890'
      );
      expect(showToast).not.toHaveBeenCalledWith('Failed to open camera viewer', 'error', 2500);
      expect(liveBtn.textContent).toBe('Live');
    });

    it('should destroy a partially initialized HLS instance when attachment throws', async () => {
      const { showToast } = require('../../src/ui-utils.js');
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' },
      });
      mockHlsInstance.attachMedia.mockImplementationOnce(() => {
        throw new Error('attach failed');
      });
      camera.openCamera('camera.front_door');

      document.querySelector('#live-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockHlsInstance.destroy).toHaveBeenCalledTimes(1);
      expect(mockState.ACTIVE_HLS.size).toBe(0);
      expect(document.querySelector('.camera-img').getAttribute('src')).toBe(
        'ha://camera/camera.front_door?t=1234567890'
      );
      expect(showToast).toHaveBeenCalledWith('Failed to open camera viewer', 'error', 2500);
    });
  });
});
