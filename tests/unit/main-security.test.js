/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isAllowedHlsProxyPath,
  normalizeEntityIdForObjectKey,
  validateProfileSyncCopyPaths,
} = require('../../src/main-security.cjs');

describe('main-process security helpers', () => {
  describe('normalizeEntityIdForObjectKey', () => {
    const normalizeEntityId = (value) => (typeof value === 'string' ? value.trim() : '');

    it('accepts normal Home Assistant entity IDs', () => {
      expect(normalizeEntityIdForObjectKey(' light.kitchen_2 ', normalizeEntityId)).toBe(
        'light.kitchen_2'
      );
      expect(normalizeEntityIdForObjectKey('input_button.TVMode', normalizeEntityId)).toBe(
        'input_button.TVMode'
      );
    });

    it('rejects invalid and prototype-polluting object keys', () => {
      expect(normalizeEntityIdForObjectKey('__proto__', normalizeEntityId)).toBe('');
      expect(normalizeEntityIdForObjectKey('constructor.prototype', normalizeEntityId)).toBe('');
      expect(normalizeEntityIdForObjectKey('light.__proto__', normalizeEntityId)).toBe('');
      expect(normalizeEntityIdForObjectKey('Light.kitchen', normalizeEntityId)).toBe('');
      expect(normalizeEntityIdForObjectKey('light.kitchen.extra', normalizeEntityId)).toBe('');
    });
  });

  describe('isAllowedHlsProxyPath', () => {
    it('allows only Home Assistant camera and HLS media paths', () => {
      expect(isAllowedHlsProxyPath('/api/hls/abc/master_playlist.m3u8')).toBe(true);
      expect(isAllowedHlsProxyPath('/api/hls/abc/playlist.m3u8')).toBe(true);
      expect(isAllowedHlsProxyPath('/api/hls/abc/segment/1.ts')).toBe(true);
      expect(isAllowedHlsProxyPath('/api/camera_proxy/camera.front')).toBe(true);
      expect(isAllowedHlsProxyPath('/api/camera_proxy_stream/camera.front')).toBe(true);
      expect(isAllowedHlsProxyPath('/api/states')).toBe(false);
      expect(isAllowedHlsProxyPath('/api/services/light/turn_on')).toBe(false);
    });
  });

  describe('validateProfileSyncCopyPaths', () => {
    let tempDir;

    beforeEach(() => {
      tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-main-security-')));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('accepts default-named files when both sides are in their allowed folders', async () => {
      const sourceDir = path.join(tempDir, 'sync');
      const destinationDir = path.join(tempDir, 'other');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(destinationDir, { recursive: true });

      const result = await validateProfileSyncCopyPaths({
        fromPath: path.join(sourceDir, 'ha-widget-profile-sync.json'),
        toPath: path.join(destinationDir, 'ha-widget-profile-sync.json'),
        defaultFileName: 'ha-widget-profile-sync.json',
        allowedSourceFolders: [sourceDir],
        allowedDestinationFolders: [destinationDir],
        fsModule: fs,
      });

      // Match production's async realpath (validateProfileSyncCopyPaths uses
      // fs.promises.realpath); on Windows sync vs async realpath can return
      // different 8.3 short/long name forms for the same directory.
      const realSourceDir = await fs.promises.realpath(sourceDir);
      const realDestinationDir = await fs.promises.realpath(destinationDir);
      expect(result.sourcePath).toBe(path.join(realSourceDir, 'ha-widget-profile-sync.json'));
      expect(result.destinationPath).toBe(
        path.join(realDestinationDir, 'ha-widget-profile-sync.json')
      );
    });

    it('rejects wrong filenames and copies outside allowed folders', async () => {
      const sourceDir = path.join(tempDir, 'sync');
      const otherDir = path.join(tempDir, 'other');
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(otherDir, { recursive: true });

      await expect(
        validateProfileSyncCopyPaths({
          fromPath: path.join(sourceDir, 'not-the-profile.json'),
          toPath: path.join(otherDir, 'ha-widget-profile-sync.json'),
          defaultFileName: 'ha-widget-profile-sync.json',
          allowedSourceFolders: [sourceDir],
          allowedDestinationFolders: [otherDir],
          fsModule: fs,
        })
      ).rejects.toThrow('Profile sync copies are limited');

      await expect(
        validateProfileSyncCopyPaths({
          fromPath: path.join(otherDir, 'ha-widget-profile-sync.json'),
          toPath: path.join(sourceDir, 'ha-widget-profile-sync.json'),
          defaultFileName: 'ha-widget-profile-sync.json',
          allowedSourceFolders: [sourceDir],
          allowedDestinationFolders: [sourceDir],
          fsModule: fs,
        })
      ).rejects.toThrow('copy source must be inside');

      await expect(
        validateProfileSyncCopyPaths({
          fromPath: path.join(sourceDir, 'ha-widget-profile-sync.json'),
          toPath: path.join(tempDir, 'outside', 'ha-widget-profile-sync.json'),
          defaultFileName: 'ha-widget-profile-sync.json',
          allowedSourceFolders: [sourceDir],
          allowedDestinationFolders: [otherDir],
          fsModule: fs,
        })
      ).rejects.toThrow('copy destination must be');
    });
  });
});
