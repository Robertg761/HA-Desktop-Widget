/**
 * Run with Electron before a start-up scene: saves a Home Assistant authorization in the scene's
 * profile, as the app does once a browser pairing finishes, so the app starts on it and shows its
 * restoring panel while it asks the server for a token. Only a real pairing makes one otherwise.
 *
 *   electron save-oauth-authorization.cjs --user-data-dir=<profile>   (SNAPSHOT_OAUTH_URL=<server>)
 *
 * The refresh token is a placeholder that no server accepts. It is encrypted with the safe storage
 * the app itself would use: on Windows a key kept in the profile's Local State, on macOS the
 * keychain item named after the app, which is why the app's name is set before Electron is ready.
 * Test-only; never shipped.
 */

const path = require('path');
const { app, safeStorage } = require('electron');
const { HomeAssistantOAuthClient, OAUTH_CALLBACK_PATH } = require('../../src/ha-oauth.cjs');
const {
  isSecureProfileSyncStorageAvailable,
} = require('../../src/profile-sync-rewrite-transaction.cjs');
const { name } = require('../../package.json');

app.setName(name);
const profileDir = app.commandLine.getSwitchValue('user-data-dir');
if (profileDir) {
  // The paths main.js gives the app: Local State, and the Windows key in it, may be kept with the
  // session data, so it has to be where the app will look for it.
  app.setPath('userData', profileDir);
  app.setPath('sessionData', path.join(profileDir, 'session'));
}

app.whenReady().then(() => {
  try {
    if (!profileDir) throw new Error('No --user-data-dir to save the authorization in');
    // Any loopback callback is one the app could have paired with; the port is never opened.
    const callbackOrigin = 'http://127.0.0.1:47123';
    new HomeAssistantOAuthClient({
      safeStorage,
      platform: process.platform,
      userDataPath: profileDir,
      isSecureStorageAvailable: isSecureProfileSyncStorageAvailable,
    }).writeCredentials({
      baseUrl: process.env.SNAPSHOT_OAUTH_URL,
      clientId: `${callbackOrigin}/`,
      redirectUri: `${callbackOrigin}${OAUTH_CALLBACK_PATH}`,
      refreshToken: 'snapshot-refresh-token',
    });
    // Quitting, not exiting, writes Local State, where Windows keeps the key the token needs.
    app.quit();
  } catch (error) {
    console.error(`Could not save an authorization: ${error.message}`);
    app.exit(1);
  }
});
