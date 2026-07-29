/**
 * @jest-environment node
 */

const path = require('path');

const { requireExistingSyncParentDirectory } = require('../../src/cloud-sync-path.cjs');

// Build fixtures through path.resolve so expectations survive Windows drive-letter
// resolution (path.resolve('/mnt') === 'D:\\mnt' on CI runners).
const PROVIDER_DIR = path.resolve('/mnt/provider');
const SYNC_FILE_PATH = path.join(PROVIDER_DIR, 'ha-widget.json');

describe('cloud sync path safety', () => {
  it('accepts an existing provider directory', async () => {
    const fsModule = {
      promises: {
        stat: jest.fn(async () => ({ isDirectory: () => true })),
      },
    };

    await expect(requireExistingSyncParentDirectory(SYNC_FILE_PATH, fsModule)).resolves.toBe(
      PROVIDER_DIR
    );
  });

  it('does not recreate a vanished provider mount', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const fsModule = {
      promises: {
        stat: jest.fn(async () => {
          throw missing;
        }),
      },
    };

    await expect(requireExistingSyncParentDirectory(SYNC_FILE_PATH, fsModule)).rejects.toThrow(
      'selected sync folder is unavailable'
    );
  });

  it('rejects a parent path that is not a directory', async () => {
    const fsModule = {
      promises: {
        stat: jest.fn(async () => ({ isDirectory: () => false })),
      },
    };

    await expect(requireExistingSyncParentDirectory(SYNC_FILE_PATH, fsModule)).rejects.toThrow(
      'not a directory'
    );
  });
});
