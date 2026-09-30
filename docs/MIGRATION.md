# Upgrading to 4.0

Version 4.0 retains the desktop app's local configuration and upgrades folder Profile Sync to file format version 3. Hosted Cloud Sync accounts and billing are planned separately and are not part of the 4.0 desktop app.

## Back up before upgrading

1. Quit the widget on every computer that uses the shared profile and let the folder provider finish syncing.
2. Copy the shared profile file to a separate location. Keep the original encrypted file if encryption is enabled, and keep its passphrase available.
3. Back up each computer's app user-data directory, including `config.json`, credential storage, and existing recovery backups. Settings → Advanced → View logs opens the log location; the app data directory contains `config.json`. Keep these copies private because they may contain credentials or personal configuration.
4. Upgrade every computer that writes to the same profile before resuming sync. Keep the backups until you have verified the layout, connection, and sync on each computer.

The app also makes local configuration backups before migration/save and keeps profile recovery backups, but a separate pre-upgrade copy is useful if you need to return to 3.x.

## What changes in folder Profile Sync

4.0 reads the 3.x sync file and upgrades it the first time it saves a change. Version 3 of the file stores revisions separately for Quick Access/layout, appearance, alerts, weather, and media. Changes to different sections on two computers can merge. Changes to the same section choose the newer change and preserve a recovery backup.

Each computer keeps its own sync scope. A pull does not replace that scope, and a push leaves unselected sections on the remote side intact. Home Assistant connection/credentials, window geometry, startup settings, desktop pins, hotkeys, the open page, UI scale, and Omarchy theme following stay local.

3.x cannot read version 3 and stops syncing instead of overwriting the file. Update every computer sharing the file. Do not use Sync Up from an older app to try to convert it back.

On first sync, review the sections shown in Settings and choose which copy to keep. Sync now merges both sides. Sync Up and Sync Down deliberately replace the selected side after confirmation. Settings → Advanced → Backups can restore a profile recovery backup. A restore applies locally and then syncs to other computers, so pause sync elsewhere if you need to inspect the result first.

## Companion profiles

Companion profiles preserve this computer's credentials, scale, and Omarchy theme following. Partial profile updates preserve omitted settings and pages. They can include the selected weather source, primary media player, and tile spans. Entity IDs must exist on the destination Home Assistant instance.

Folder sync keeps the active page local. A companion profile or explicit companion page-switch command can select a page, so the two workflows have different page-selection behavior.

## Connection and credential recovery

New connections use Home Assistant browser authorization. Existing long-lived tokens remain supported through the advanced connection option. The app encrypts saved credentials with the operating system's secure storage when available. An existing plaintext token is encrypted on save; if encryption is unavailable, the token can work for the current session but is omitted from the saved configuration.

If the app asks you to authorize again or re-enter a token after an upgrade, open Settings → General and reconnect. Use Advanced connection options for a long-lived token. Check the Home Assistant URL, network reachability, and whether the authorization or token was revoked. On Linux, check that the session's keyring is available if credentials cannot persist across restarts.

Encrypted credentials are tied to the OS account and its secure storage. Copying `config.json` to another computer does not transfer a working login. A changed keyring or unavailable secure storage can require recovery again; re-entering a token is not a guarantee that the issue cannot recur.

If configuration loading fails, quit the app and preserve the failed file and logs. Restore a known-good local backup on the same computer, then reconnect if needed. Avoid deleting the whole configuration as a first recovery step.

## Returning to 3.x

Quit 4.0 on every participating computer and pause the folder provider before restoring files. Keep a copy of the 4.0 data first. Restore each computer's pre-upgrade local backup and the separate pre-upgrade shared profile copy, then install 3.x and verify it before resuming sync. Do not let a running 4.0 instance immediately upgrade the restored shared file again.

There is no automatic conversion of a version 3 sync file back to the 3.x format. New 4.0 settings may be ignored by 3.x, and OS-encrypted credentials may still require a new login. Recovery backups created in 4.0 are intended for 4.0's restore flow.

## Release scope and verification

Stable 4.0 keeps the regular tray. Live tray tiles remain enabled only in numbered beta builds, matching the existing feature gate. Hosted Cloud Sync login, subscriptions, and account deletion are not desktop 4.0 features. Free folder Profile Sync remains available.

Before tagging, complete real Home Assistant, two-computer sync, native shortcut/pin/tray, installer, and update checks in the [feature audit](FEATURE-AUDIT-4.0.md#required-native-and-integration-checks) and [desktop pin checklist](DESKTOP_PIN_QA.md). Automated tests and an isolated Linux startup do not replace those checks.
