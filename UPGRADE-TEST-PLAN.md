# Upgrade Migration Test Plan - v2.3.9 to v3.0.0

## Overview
This document outlines test scenarios to verify the token encryption migration from v2.3.9 to v3.0.0-rc.2 works correctly and doesn't cause user-facing issues.

## Prerequisites
- v2.3.9 installed with a working Home Assistant connection
- Test Home Assistant instance
- Ability to build and run v3.0.0-rc.2

## Test Scenarios

### Scenario 1: Successful Encryption Migration (Happy Path)
**Description:** User upgrades from v2.3.9 with plaintext token on a system with encryption available.

**Steps:**
1. Install and configure v2.3.9 with working HA token
2. Verify app works and connects successfully
3. Close v2.3.9
4. Install v3.0.0-rc.2 over v2.3.9
5. Launch v3.0.0-rc.2

**Expected Results:**
- App launches without freezing or delays
- Connection to Home Assistant works immediately
- No error messages or toasts appear
- Log shows: "Token migration complete - token is now encrypted at rest"
- Config backup created at `%AppData%/Home Assistant Widget/config.backup.json`
- Config has `tokenEncrypted: true` and `migrationInfo` with version and date
- User sees no visible changes in functionality

**Pass Criteria:** ✅ No user-visible changes, seamless upgrade

---

### Scenario 2: Encryption Unavailable During Migration
**Description:** User upgrades from v2.3.9 on a system where encryption is not available (e.g., portable app, certain Windows configurations).

**Steps:**
1. Install v2.3.9 with working HA token
2. Close v2.3.9
3. Install v3.0.0-rc.2
4. Mock or trigger encryption unavailable scenario
5. Launch v3.0.0-rc.2

**Expected Results:**
- App launches normally (no freeze)
- Connection to Home Assistant works immediately with plaintext token
- No data loss - token remains functional
- Log shows: "Encryption not available, keeping token in plaintext"
- Config has `tokenEncrypted: false` and `migrationInfo.reason: 'encryption_unavailable'`
- Config backup created
- No error toasts appear to user

**Pass Criteria:** ✅ App continues working with plaintext token, no data loss

---

### Scenario 3: Encryption Fails During Migration
**Description:** Encryption check succeeds but encryption operation fails.

**Steps:**
1. Install v2.3.9 with working HA token
2. Close v2.3.9
3. Install v3.0.0-rc.2
4. Simulate encryption failure (mock safeStorage.encryptString to throw)
5. Launch v3.0.0-rc.2

**Expected Results:**
- App launches normally (no freeze)
- Connection works with plaintext token
- Log shows: "Token encryption failed, keeping plaintext"
- Config has `tokenEncrypted: false` and `migrationInfo.reason: 'encryption_failed'`
- Config backup exists
- Token remains functional

**Pass Criteria:** ✅ Graceful fallback to plaintext, no data loss

---

### Scenario 4: Encrypted Token, Encryption Unavailable
**Description:** User has encrypted token from previous installation, moves to system without encryption support.

**Steps:**
1. Install v3.0.0-rc.2 with encrypted token
2. Copy config to system without encryption support
3. Launch app

**Expected Results:**
- App launches normally (no freeze)
- Encrypted token cannot be decrypted
- In-memory token set to default (setup required)
- Encrypted token **preserved on disk** (not deleted)
- Log shows: "Encrypted token preserved in config file"
- Warning toast: "Your Home Assistant token needs to be re-entered. Token encryption is not available on this system. Click the gear icon to open Settings."
- Toast duration: 20 seconds
- User can access settings and re-enter token
- If config is moved back to system with encryption, original token can be decrypted

**Pass Criteria:** ✅ Encrypted token preserved, clear user feedback, recovery possible

---

### Scenario 5: Corrupted Encrypted Token
**Description:** Encrypted token exists but is corrupted/invalid.

**Steps:**
1. Create config with `tokenEncrypted: true` and invalid base64 token
2. Launch v3.0.0-rc.2

**Expected Results:**
- App launches normally
- Decryption fails gracefully
- In-memory token set to default
- Corrupted token **preserved on disk**
- Log shows: "Failed to decrypt token (may be corrupted)"
- Warning toast: "Your Home Assistant token needs to be re-entered. The stored token could not be decrypted."
- Toast includes "Click the gear icon to open Settings"
- User can access settings and re-enter token

**Pass Criteria:** ✅ No crash, clear error message, recovery path available

---

### Scenario 6: Authentication Failure After Migration
**Description:** Token becomes invalid after migration (expired, revoked, wrong server).

**Steps:**
1. Complete successful migration
2. Invalidate token on HA server (revoke/delete)
3. Launch app

**Expected Results:**
- App launches normally
- WebSocket connection attempts authentication
- Auth fails with `auth_invalid` message
- Error toast: "Authentication failed. Please check your Home Assistant token in Settings."
- Toast duration: 15 seconds
- Loading spinner hides
- UI renders showing "Setup Required" message
- User can access settings via gear icon
- Status indicator shows "Not Connected"

**Pass Criteria:** ✅ Clear error message, UI accessible, settings reachable

---

### Scenario 7: No App Freeze During Migration
**Description:** Verify app doesn't freeze if encryption operations are slow.

**Steps:**
1. Install v2.3.9 with working token
2. Install v3.0.0-rc.2
3. Monitor for any delays during launch

**Expected Results:**
- App window appears within 3 seconds
- No "Not Responding" in Task Manager
- User can close app with X button if needed
- Progress indicated by loading spinner
- Log shows detailed debug messages for each encryption step

**Pass Criteria:** ✅ App launches promptly, no freeze

---

### Scenario 8: Config Backup Created
**Description:** Verify backup is created before migration.

**Steps:**
1. Install v2.3.9 with working token
2. Note contents of config.json
3. Install and launch v3.0.0-rc.2

**Expected Results:**
- File exists: `%AppData%/Home Assistant Widget/config.backup.json`
- Backup contains plaintext token from v2.3.9
- Backup created before migration (timestamp check)
- Log shows: "Config backup created at [path]"
- If migration fails, backup can be used for recovery

**Pass Criteria:** ✅ Backup exists with original plaintext config

---

### Scenario 9: Migration Info Tracked
**Description:** Verify migration information is recorded.

**Steps:**
1. Complete any migration scenario
2. Check config.json

**Expected Results:**
- Config contains `migrationInfo` object with:
  - `version`: "3.0.0-rc.2"
  - `date`: ISO timestamp
  - `tokenEncrypted`: true/false
  - `reason`: (if failed) "encryption_unavailable", "encryption_failed", or "migration_error"
- Migration doesn't repeat on subsequent launches

**Pass Criteria:** ✅ Migration info recorded, no repeated attempts

---

### Scenario 10: Settings Still Accessible When Connection Fails
**Description:** User can access settings to fix token even if connection fails.

**Steps:**
1. Launch app with invalid/missing token
2. Observe UI state

**Expected Results:**
- Loading screen shows briefly then clears
- UI renders showing "Setup Required" or similar message
- Gear icon (settings) is visible and clickable
- Clicking settings opens settings modal
- User can enter new token
- After saving, connection attempt restarts

**Pass Criteria:** ✅ Settings accessible when disconnected

---

## Test Environment Setup

### Creating Test Configs

**v2.3.9 Config (Plaintext Token):**
```json
{
  "homeAssistant": {
    "url": "http://homeassistant.local:8123",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "favoriteEntities": [],
  "customEntityNames": {}
}
```

**v3.0.0 Config (Encrypted Token):**
```json
{
  "homeAssistant": {
    "url": "http://homeassistant.local:8123",
    "token": "AQAAANCMnd8BF...",
    "tokenEncrypted": true
  },
  "migrationInfo": {
    "version": "3.0.0-rc.2",
    "date": "2025-11-11T10:00:00.000Z",
    "tokenEncrypted": true
  }
}
```

**Config Path:**
- Windows: `%AppData%\Home Assistant Widget\config.json`

### Viewing Logs

Logs accessible via:
- Settings → "View Logs" button
- Or directly at: `%AppData%\Home Assistant Widget\logs\`

Key log messages to look for:
- `Detected plaintext token from pre-encryption version - attempting migration...`
- `Token migration complete - token is now encrypted at rest`
- `Encryption not available, keeping token in plaintext`
- `Config backup created at...`
- `Token decrypted successfully`
- `Encrypted token preserved in config file`

## Success Criteria Summary

All test scenarios must pass with these outcomes:
1. ✅ No data loss in any scenario
2. ✅ App never freezes during migration
3. ✅ Encrypted tokens preserved even when encryption unavailable
4. ✅ Clear user feedback for any token issues
5. ✅ Config backup created before migration
6. ✅ Settings accessible even when connection fails
7. ✅ Migration info tracked in config
8. ✅ Plaintext fallback works when encryption unavailable

## Regression Testing

After fixes, also verify these existing features still work:
- [ ] Home Assistant connection and authentication
- [ ] Entity control (lights, switches, etc.)
- [ ] WebSocket real-time updates
- [ ] Settings modal (all tabs)
- [ ] Global hotkeys
- [ ] Entity alerts
- [ ] Camera feeds
- [ ] Media player controls
- [ ] Weather display
- [ ] Auto-updates
- [ ] System tray menu
- [ ] Window drag/resize
- [ ] Always-on-top toggle

## Automated Test Coverage

Existing automated tests verify:
- ✅ 403 tests passing
- ✅ State management
- ✅ Utility functions
- ✅ WebSocket manager
- ✅ Entity alerts
- ✅ Hotkeys
- ✅ Camera module
- ✅ UI utilities

Main process migration logic requires manual testing due to Electron environment dependencies.
