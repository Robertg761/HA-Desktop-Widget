/**
 * @jest-environment node
 */

const { requireExistingSyncParentDirectory } = require('../../src/cloud-sync-path.cjs');

describe('cloud sync path safety', () => {
  it('accepts an existing provider directory', async () => {
    const fsModule = {
      promises: {
        stat: jest.fn(async () => ({ isDirectory: () => true })),
      },
    };

    await expect(
      requireExistingSyncParentDirectory('/mnt/provider/ha-widget.json', fsModule)
    ).resolves.toBe('/mnt/provider');
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

    await expect(
      requireExistingSyncParentDirectory('/mnt/provider/ha-widget.json', fsModule)
    ).rejects.toThrow('selected sync folder is unavailable');
  });

  it('rejects a parent path that is not a directory', async () => {
    const fsModule = {
      promises: {
        stat: jest.fn(async () => ({ isDirectory: () => false })),
      },
    };

    await expect(
      requireExistingSyncParentDirectory('/mnt/provider/ha-widget.json', fsModule)
    ).rejects.toThrow('not a directory');
  });
});
