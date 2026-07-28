/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const afterPack = require('../../scripts/after-pack-mac-adhoc-sign.cjs');

describe('after-pack hook', () => {
  it('ships the project MIT license on every platform', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-after-pack-'));
    const projectDir = path.join(rootDir, 'project');
    const appOutDir = path.join(rootDir, 'out');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'LICENSE'), 'project license\n', 'utf8');

    await afterPack({
      electronPlatformName: 'linux',
      appOutDir,
      packager: {
        projectDir,
        appInfo: { productFilename: 'HA Desktop Widget' },
      },
    });

    expect(fs.readFileSync(path.join(appOutDir, 'resources', 'LICENSE.txt'), 'utf8')).toBe(
      'project license\n'
    );
  });
});
