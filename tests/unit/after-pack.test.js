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
    fs.writeFileSync(path.join(projectDir, 'THIRD-PARTY-NOTICES.txt'), 'notices\n', 'utf8');

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

  it('ships the third-party notices next to it, so the font and library licenses travel with them', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-after-pack-'));
    const projectDir = path.join(rootDir, 'project');
    const appOutDir = path.join(rootDir, 'out');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'LICENSE'), 'project license\n', 'utf8');
    fs.writeFileSync(path.join(projectDir, 'THIRD-PARTY-NOTICES.txt'), 'notices\n', 'utf8');

    await afterPack({
      electronPlatformName: 'win32',
      appOutDir,
      packager: { projectDir, appInfo: { productFilename: 'HA Desktop Widget' } },
    });

    expect(
      fs.readFileSync(path.join(appOutDir, 'resources', 'THIRD-PARTY-NOTICES.txt'), 'utf8')
    ).toBe('notices\n');
  });

  it('has notices for every font and icon set the app ships', () => {
    const notices = fs.readFileSync(path.join(__dirname, '../../THIRD-PARTY-NOTICES.txt'), 'utf8');
    for (const name of [
      'Inter',
      'Plus Jakarta Sans',
      'SIL OPEN FONT LICENSE Version 1.1',
      'Lucide',
      'ISC License',
      '@mdi/font',
      'Apache License',
      'hls.js',
      'SortableJS',
    ]) {
      expect(notices).toContain(name);
    }
    // Each font file in fonts/ belongs to one of the two families the notices name.
    for (const file of fs.readdirSync(path.join(__dirname, '../../fonts'))) {
      expect(file).toMatch(/^(inter|plus-jakarta-sans)-/);
    }
  });

  it('ships the license inside the macOS app bundle', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-after-pack-'));
    const projectDir = path.join(rootDir, 'project');
    const appOutDir = path.join(rootDir, 'mac-universal-x64-temp');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'LICENSE'), 'project license\n', 'utf8');
    fs.writeFileSync(path.join(projectDir, 'THIRD-PARTY-NOTICES.txt'), 'notices\n', 'utf8');

    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir,
      packager: {
        projectDir,
        appInfo: { productFilename: 'HA Desktop Widget' },
      },
    });

    expect(
      fs.readFileSync(
        path.join(appOutDir, 'HA Desktop Widget.app', 'Contents', 'Resources', 'LICENSE.txt'),
        'utf8'
      )
    ).toBe('project license\n');
  });
});
