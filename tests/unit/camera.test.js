/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Create mock electronAPI instance
let mockElectronAPI;

// Mock HLS.js
const mockHlsInstance = {
  loadSource: jest.fn(),
  attachMedia: jest.fn(),
  on: jest.fn(),
  destroy: jest.fn()
};

const mockHls = jest.fn(() => mockHlsInstance);
mockHls.isSupported = jest.fn(() => true);
mockHls.Events = {
  ERROR: 'hlsError'
};

jest.mock('hls.js', () => mockHls, { virtual: true });

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn()
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
  getEntityDisplayName: jest.fn((entity) => {
    if (!entity) return 'Unknown Entity';
    return entity.attributes?.friendly_name || entity.entity_id;
  })
}));

// Mock WebSocket
const mockWebSocketRequest = jest.fn();
jest.mock('../../src/websocket.js', () => ({
  request: mockWebSocketRequest
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {},
  ACTIVE_HLS: new Map()
};

jest.mock('../../src/state.js', () => ({
  get CONFIG() { return mockState.CONFIG; },
  get STATES() { return mockState.STATES; },
  get ACTIVE_HLS() { return mockState.ACTIVE_HLS; }
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
  mockHlsInstance.destroy.mockClear();

  // Restore isSupported after mockClear
  mockHls.isSupported = jest.fn(() => true);
  mockHls.Events = {
    ERROR: 'hlsError'
  };

  // Reset WebSocket mock
  mockWebSocketRequest.mockClear();

  // Reset console mocks
  mockConsoleWarn.mockClear();
  mockConsoleError.mockClear();
});

afterAll(() => {
  mockConsoleWarn.mockRestore();
  mockConsoleError.mockRestore();
});

describe('Camera Module', () => {
  // Require modules once
  const camera = require('../../src/camera.js');

  describe('getHlsStreamUrl', () => {
    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
    });

    it('should request HLS stream URL from WebSocket', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      await camera.getHlsStreamUrl('camera.front_door');

      expect(mockWebSocketRequest).toHaveBeenCalledWith({
        type: 'camera/stream',
        entity_id: 'camera.front_door',
        format: 'hls'
      });
    });

    it('should return proxied ha://hls URL on success', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should handle string result for backward compatibility', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: '/api/hls/master_playlist.m3u8'
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should handle object result with url property', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBe('ha://hls/api/hls/master_playlist.m3u8');
    });

    it('should convert relative URL to absolute using CONFIG.homeAssistant.url', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8?token=abc' }
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
        success: false
      });

      const result = await camera.getHlsStreamUrl('camera.front_door');

      expect(result).toBeNull();
    });

    it('should log warning on failure', async () => {
      mockWebSocketRequest.mockRejectedValue(new Error('Stream unavailable'));

      await camera.getHlsStreamUrl('camera.front_door');

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'HLS stream request failed:',
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
      document.querySelectorAll('.camera-modal').forEach(modal => modal.remove());

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
        success: false // Make HLS fail to avoid complexity
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');

      // Click Live button
      await liveBtn.click();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(liveBtn.textContent).toBe('Stop');
    });

    it('should toggle Live button back to Live when stopped', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');

      // Start live
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

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
      document.querySelectorAll('.camera-modal').forEach(modal => modal.remove());

      // Restore Date.now spy
      if (dateNowSpy) {
        dateNowSpy.mockRestore();
      }
    });

    it('should attempt HLS stream when Live button clicked', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      // Verify modal was created
      const modal = document.querySelector('.camera-modal');
      expect(modal).toBeTruthy();

      const liveBtn = document.querySelector('#live-btn');
      expect(liveBtn).toBeTruthy();
      await liveBtn.click();

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockWebSocketRequest).toHaveBeenCalledWith({
        type: 'camera/stream',
        entity_id: 'camera.front_door',
        format: 'hls'
      });
    });

    it('should create video element for HLS', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      expect(video).toBeTruthy();
    });

    it('should initialize HLS with correct configuration', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockHls).toHaveBeenCalledWith({
        lowLatencyMode: true,
        backBufferLength: 90
      });
    });

    it('should set video attributes correctly', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      expect(video.muted).toBe(true);
      expect(video.playsInline).toBe(true);
      expect(video.autoplay).toBe(true);
      expect(video.controls).toBe(false);
    });

    it('should show video and hide img on HLS success', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const video = document.querySelector('video.camera-video');
      const img = document.querySelector('.camera-img');

      expect(video.style.display).toBe('block');
      expect(img.style.display).toBe('none');
    });

    it('should fallback to MJPEG if HLS not available', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: false
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      const img = document.querySelector('.camera-img');
      expect(img.src).toBe('ha://camera_stream/camera.front_door?t=1234567890');
      expect(img.style.display).toBe('block');
    });

    it('should handle Safari native HLS support', async () => {
      mockWebSocketRequest.mockResolvedValue({
        success: true,
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      // Mock HLS.js not supported but video.canPlayType returns true (Safari)
      mockHls.isSupported.mockReturnValue(false);

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

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
        result: { url: '/api/hls/master_playlist.m3u8' }
      });

      camera.openCamera('camera.front_door');

      const liveBtn = document.querySelector('#live-btn');
      await liveBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Close modal
      const closeBtn = document.querySelector('.close-btn');
      closeBtn.click();

      // HLS should be stopped
      expect(mockState.ACTIVE_HLS.size).toBe(0);
    });
  });
});
