# Security Policy

## Supported Versions

Security fixes target the current `3.x` release line of HA Desktop Widget unless a release note says otherwise.

| Version | Supported |
| ------- | --------- |
| 3.x     | Yes       |
| 2.x     | No        |
| < 2.0   | No        |

## Reporting a Vulnerability

Please do not create a public issue for a suspected security vulnerability.

If GitHub private vulnerability reporting is available on the repository, use that first. Otherwise, contact the maintainer privately through GitHub with:

- **Subject**: `[SECURITY] HA Desktop Widget Vulnerability Report`
- **Description**: What the vulnerability is and which versions or builds are affected
- **Steps to reproduce**: Clear reproduction steps, sample config, or screenshots when helpful
- **Impact**: What an attacker could do and what access they would need
- **Suggested fix**: Optional, if you already have a mitigation in mind

Expected handling is best effort for a maintainer-run project:

- **Acknowledgment**: Usually within 48 hours
- **Initial assessment**: Usually within 1 week
- **Fix development**: Depends on severity, affected platform, and release complexity
- **Public disclosure**: After a fix or mitigation is available and users have had time to update

## Security Best Practices

### For Users

- **Keep the app updated**: Use the latest `3.x` release when possible.
- **Download from the project releases**: Prefer the official GitHub Releases page for installers and portable builds.
- **Secure Home Assistant**: Use strong passwords, 2FA where practical, and a least-privilege network setup.
- **Prefer HTTPS for remote Home Assistant access**: Use HTTPS when connecting outside your trusted local network.
- **Manage tokens carefully**: Treat Home Assistant long-lived access tokens as secrets and rotate them if exposed.
- **Review opt-in sync folders**: If Profile Sync writes to a cloud-backed folder, protect that cloud account and consider enabling sync payload encryption.

### For Developers

- **Dependency updates**: Keep Electron, Electron Builder, and runtime dependencies current.
- **Code review**: Review changes that touch IPC, update handling, token storage, sync, file access, and external URLs.
- **Input validation**: Validate renderer-to-main IPC input and data read from config, Home Assistant, sync files, and downloaded language packs.
- **Error handling**: Avoid logging Home Assistant tokens, sync passphrases, or other secrets.
- **Token storage**: Preserve the existing token encryption and recovery behavior when changing config persistence.

## Current Security Model

### Local Data And Profile Sync

- **Local by default**: Configuration is stored in Electron's user data directory on the local machine.
- **Token storage**: Home Assistant tokens are encrypted with Electron `safeStorage` when the OS supports it. If encryption is unavailable or fails, the app may store the token in plaintext in the local config file.
- **Profile Sync is opt-in**: Profile Sync writes selected personalization/settings data to a user-chosen JSON file. The app does not call Google Drive, iCloud, or Syncthing APIs directly; those labels use the same local/cloud-folder file model.
- **Sync exclusions**: Home Assistant URL/token, window position/size, startup setting, and Profile Sync internals remain local.
- **Sync encryption**: Profile Sync can encrypt the synced payload with a passphrase using `AES-256-GCM` and `scrypt` key derivation.

### Network Access

- **Home Assistant**: The app connects to the configured Home Assistant URL with HTTP(S), WebSocket, and media/camera requests needed for entity control and display.
- **Updates**: Packaged non-portable builds can check GitHub Releases through Electron updater and download updates in the background when supported. Portable builds use a GitHub release check and send the user to the portable download instead of self-installing.
- **Language packs**: Packaged builds can fetch the language-pack manifest from the project GitHub repository and download selected language packs. Downloaded packs are validated, including SHA-256 verification when the manifest provides a hash.
- **External links**: Actions such as Report Issue, Releases, and Profile Sync help can open GitHub pages in the user's default browser.
- **Entity-provided media**: Home Assistant entity attributes may reference remote artwork, camera, or stream URLs. Those URLs should be treated as part of the user's Home Assistant environment.

### Application Security

- **Electron isolation**: The renderer uses `contextIsolation: true` and `nodeIntegration: false`; privileged operations are exposed through the preload IPC bridge.
- **Updates and authenticity**: Update delivery is based on the GitHub release channel and Electron updater behavior for supported package types. Code signing is not guaranteed for every platform or artifact; treat unsigned builds as possible unless a release explicitly states otherwise.
- **Build formats**: Windows installer and portable builds, macOS archives, and Linux packages may have different updater and signing capabilities.

## Known Security Considerations

### Home Assistant Integration

- **Long-lived tokens**: A valid Home Assistant long-lived access token is required for normal operation.
- **Local machine trust**: Anyone with access to the user's OS account may be able to read local config, logs, or sync files depending on platform encryption support and file permissions.
- **Network trust**: The app has the same network reachability to Home Assistant that the desktop user has.

### Profile Sync

- **Cloud-backed folders are outside the app boundary**: If the selected sync file lives in a provider-synced folder, that provider controls transport, retention, sharing, and account security.
- **Optional encryption depends on passphrase strength**: Use a unique passphrase if the sync file will leave the local machine.
- **Conflict behavior**: First enable prompts for local-vs-remote choice; ongoing conflicts are resolved by last write.

### Updates And Downloads

- **External availability**: GitHub update and language-pack checks require network access and may fail offline.
- **Portable updates are manual**: Portable builds do not replace themselves automatically.
- **Release verification**: When in doubt, compare downloads against the release page and avoid third-party mirrors.

## Security Updates

Security updates may be released as:

- **Patch releases**: For critical or narrowly scoped security fixes, such as `3.4.12`
- **Minor releases**: For broader security improvements, such as `3.5.0`
- **Major releases**: For significant security architecture changes, such as `4.0.0`

## Contact Information

- **GitHub**: [@Robertg761](https://github.com/Robertg761)
- **Repository**: [HA Desktop Widget](https://github.com/Robertg761/HA-Desktop-Widget)

## Acknowledgments

Thank you to security researchers and community members who help keep HA Desktop Widget safer by reporting issues responsibly.

---

**Last updated**: May 18, 2026
