# Token Encryption Migration Guide

## What Changed

In this version, Home Assistant access tokens are now encrypted at rest using Electron's `safeStorage` API for improved security. This protects your credentials if someone gains access to your config file.

## Migration Scenarios

### 1. **Existing Users Upgrading** (Most Common)
- ✅ **Your existing plaintext token will be automatically encrypted** on first app launch
- ✅ No action required - the migration happens seamlessly
- ✅ Your token remains functional throughout the upgrade

### 2. **Fresh Install**
- When you enter your token in Settings, it will be automatically encrypted
- No difference from previous versions in terms of user experience

### 3. **Token Reset Cases** (Rare)
If encryption is unavailable or decryption fails, you'll see a notification:
- **"Your Home Assistant token needs to be re-entered in Settings"**
- Simply re-enter your token in Settings → it will be saved securely
- This is a one-time issue and won't recur

### 4. **Systems Without Encryption Support**
- On some systems, `safeStorage` encryption may not be available
- The token will be stored in plaintext (same as before)
- The app logs this and continues working normally

## Technical Details

### How It Works
1. **On Load**: If token is encrypted, decrypt it for runtime use
2. **In Memory**: Token is always stored as plaintext
3. **On Save**: Token is re-encrypted before writing to disk (if encryption available)

### Storage Location
- **Windows**: `%AppData%\Home Assistant Widget\config.json`
- The token field is base64-encoded encrypted data
- The `tokenEncrypted: true` flag indicates encryption status

### Logging
Check logs if you encounter issues:
- Settings → "View Logs" button
- Look for messages about "Token decrypted" or "Token migration"

## For Users Experiencing Issues

If the app won't connect after upgrading:

1. **Check the app logs** (Settings → View Logs)
2. **Re-enter your token** (Settings → Access Token field)
3. **Generate a new token if needed**:
   - Go to Home Assistant web interface
   - Profile → Long-Lived Access Tokens → Create Token
   - Copy and paste into app Settings

## Security Notes

- ✅ Tokens are encrypted using OS-level encryption (Windows Data Protection API)
- ✅ Encryption keys are managed by the OS, not stored in the app
- ✅ If encryption fails, app falls back to plaintext rather than breaking
- ✅ All HTML output is sanitized to prevent XSS attacks
- ✅ Context isolation protects against malicious code execution

## Rollback

If you need to downgrade:
1. Export your config (backup `%AppData%\Home Assistant Widget\config.json`)
2. Delete the config file
3. Install the older version
4. Re-enter your token manually

The encrypted token format is not compatible with older versions.
