const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');

describe('downloadable locale-pack manifest', () => {
  test('contains the current SHA-256 hash for every published pack', () => {
    const packDir = path.resolve(__dirname, '../../locale-packs');
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));

    for (const pack of manifest.packs) {
      const content = fs.readFileSync(path.join(packDir, `${pack.locale}.json`));
      const actualHash = nodeCrypto.createHash('sha256').update(content).digest('hex');
      expect(pack.sha256).toBe(actualHash);
    }
  });
});
