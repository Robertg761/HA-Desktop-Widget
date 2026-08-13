/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { cloneProductionProfile } = require('../../src/dev-profile-clone.cjs');

describe('development profile cloning', () => {
  let temporaryRoot;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-dev-profile-'));
  });

  afterEach(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  test('refreshes the isolated clone with production config and OAuth credentials', () => {
    const productionUserDataPath = path.join(temporaryRoot, 'production');
    const developmentUserDataPath = path.join(temporaryRoot, 'development');
    fs.mkdirSync(productionUserDataPath);
    fs.mkdirSync(developmentUserDataPath);
    fs.writeFileSync(path.join(productionUserDataPath, 'config.json'), 'current-production');
    fs.writeFileSync(path.join(productionUserDataPath, 'home-assistant-oauth.json'), 'encrypted');
    fs.writeFileSync(path.join(developmentUserDataPath, 'config.json'), 'stale-development');

    const result = cloneProductionProfile({
      productionUserDataPath,
      developmentUserDataPath,
    });

    expect(result).toEqual({
      copied: ['config.json', 'home-assistant-oauth.json'],
      missing: ['xwayland-unavailable'],
      failed: [],
    });
    expect(fs.readFileSync(path.join(developmentUserDataPath, 'config.json'), 'utf8')).toBe(
      'current-production'
    );
    expect(
      fs.readFileSync(path.join(developmentUserDataPath, 'home-assistant-oauth.json'), 'utf8')
    ).toBe('encrypted');
    if (process.platform !== 'win32') {
      expect(
        fs.statSync(path.join(developmentUserDataPath, 'home-assistant-oauth.json')).mode & 0o777
      ).toBe(0o600);
    }
  });

  test('refuses to clone onto the production profile', () => {
    const productionUserDataPath = path.join(temporaryRoot, 'production');
    fs.mkdirSync(productionUserDataPath);

    expect(() =>
      cloneProductionProfile({
        productionUserDataPath,
        developmentUserDataPath: productionUserDataPath,
      })
    ).toThrow('Development profile must not overwrite the production profile');
  });
});
