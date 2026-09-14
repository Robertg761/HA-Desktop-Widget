const fs = require('fs');
const path = require('path');
const os = require('os');
const nodeCrypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Arch recipes require a stable version');
const out = path.join(root, 'dist');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-arch-'));
try {
  for (const [source, target] of [
    ['LICENSE', 'LICENSE'],
    ['build/icon.png', 'icon.png'],
    ['docs/omarchy.md', 'omarchy.md'],
    [
      'packaging/arch/com.github.robertg761.hadesktopwidget.desktop',
      'com.github.robertg761.hadesktopwidget.desktop',
    ],
  ]) {
    fs.copyFileSync(path.join(root, source), path.join(staging, target));
  }
  const archive = `ha-desktop-widget-${version}-linux-x64.tar.gz`;
  execFileSync('tar', [
    '-czf',
    path.join(out, archive),
    '-C',
    out,
    'linux-unpacked',
    '-C',
    staging,
    '.',
  ]);
  const checksum = nodeCrypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(out, archive)))
    .digest('hex');
  const recipe = fs
    .readFileSync(path.join(root, 'packaging/arch/PKGBUILD.in'), 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@SHA256@', checksum);
  const recipeDir = path.join(out, 'arch');
  fs.mkdirSync(recipeDir, { recursive: true });
  fs.writeFileSync(path.join(recipeDir, 'PKGBUILD'), recipe);
  fs.copyFileSync(path.join(out, archive), path.join(recipeDir, archive));
  fs.writeFileSync(path.join(out, 'PKGBUILD'), recipe);
  console.log(
    `Created ${archive} and checksum-pinned PKGBUILD. Build locally with: cd dist/arch && makepkg --nodeps`
  );
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
