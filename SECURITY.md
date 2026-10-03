# Security Policy

## Supported Versions

Security fixes target the latest stable release line of HA Desktop Widget. Until 4.0 is released, that is 3.x. After the stable 4.0 release, fixes target 4.x and users should upgrade from 3.x.

| Version | Supported                    |
| ------- | ---------------------------- |
| 4.x     | After the stable 4.0 release |
| 3.x     | Until the stable 4.0 release |
| 2.x     | No                           |
| < 2.0   | No                           |

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

- **Keep the app updated**: Use the latest stable release. See [4.0 migration guidance](docs/MIGRATION.md) before upgrading computers that share a profile.
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

### Dependency Audit Exceptions

CI and the release workflow run `node scripts/check-audit.cjs` instead of a bare `npm audit`. It fails on any high or critical advisory in the whole dependency tree, development dependencies included, because Electron's runtime ships in every package. It also fails if the audit report lists a high or critical package that it cannot trace back to an advisory, rather than passing it unchecked.

An advisory with no patched release yet can be excused in [`.github/audit-exceptions.json`](.github/audit-exceptions.json) so one unfixable advisory in a build tool does not turn every branch red. Each entry names the advisory (`ghsa`) and the vulnerable `package`, the newest affected version (`affectedUpTo`), the top-level packages it may be reached through (`allowedVia`), a one-sentence `reason`, and `added` and `expires` dates.

Keep exceptions narrow, dated, and temporary:

- **Narrow**: Only for advisories that are reached solely through build, lint, or packaging tools that never ship in the app. Never excuse something in the packaged runtime. Every `allowedVia` name must be listed only under `devDependencies` in `package.json` and must not ship in the app, and an advisory that starts reaching any package outside `allowedVia` fails the check. So does one whose own package, or any package between it and the `allowedVia` ones, ships: if `main.js` imports `braces`, an exception for `braces` through `stylelint` no longer applies, and the failure names the package and the file that imports it. A package ships when it is Electron (its runtime is in every package), is listed under `dependencies` or `optionalDependencies`, or is imported by source the app loads (`main.js`, `preload.js`, `renderer.js`, `profile-sync-core.js`, `src/`, `packages/`, `preview/`, and the paths in the `files` list of `electron-builder.yml`), in scripts, stylesheets, and HTML pages, whether through an import or a path into `node_modules` such as the `@mdi/font` link in `index.html`. A directory named `tests` or `coverage` inside those paths is scanned like any other, because it is packed with the rest. The import rule is what catches `hls.js` and `sortablejs`, which are `devDependencies` that vite bundles into the renderer. What `package-lock.json` installs for any of those ships too, except for what Electron's own npm package needs, because only its runtime is packed. This is checked apart from `npm audit`, which leaves out a dependent whose version range allows a fixed release.
- **Dated**: Set `expires` about a month out. After that date CI fails until someone re-checks for a patched release and either updates the dependency or renews the entry with a new date.
- **Removed as soon as a fix exists**: The check fails when the registry has a version newer than `affectedUpTo`, and when an entry no longer matches any current advisory. Update the dependency and delete the entry in the same change. If the registry cannot be reached, only the newer-version check is skipped, with a warning. A registry answer that is not a version fails the check instead.

## Current Security Model

### Local Data And Profile Sync

- **Local by default**: Configuration is stored in Electron's user data directory on the local machine.
- **Token storage**: Home Assistant tokens are encrypted with Electron `safeStorage` when the OS supports it. If encryption is unavailable or fails, the token remains usable for the current session but is omitted from the saved config. The app asks the user to re-enter it instead of persisting plaintext.
- **Profile Sync is opt-in**: Profile Sync writes selected personalization/settings data to a user-chosen JSON file. The app does not call Google Drive, iCloud, or Syncthing APIs directly; those labels use the same local/cloud-folder file model.
- **Sync exclusions**: Home Assistant connection and credentials, window position/size, startup settings, desktop pins, hotkeys, the active page, UI scale, Omarchy theme following, and Profile Sync internals remain local. Companion layout profiles also preserve UI scale and Omarchy theme following; explicit companion page commands can change the active page.
- **Sync encryption**: Profile Sync can encrypt the synced payload with a passphrase using `AES-256-GCM` and `scrypt` key derivation.

### Network Access

- **Home Assistant**: The app connects to the configured Home Assistant URL with HTTP(S), WebSocket, and media/camera requests needed for entity control and display.
- **Updates**: Windows installer and Linux AppImage builds can download and install GitHub releases through Electron updater. Portable, macOS, and Linux deb builds check GitHub Releases and send the user to the matching download instead of self-installing.
- **Language packs**: Packaged builds can fetch the language-pack manifest from the project GitHub repository and download selected language packs. Downloaded packs are validated, including SHA-256 verification when the manifest provides a hash.
- **External links**: Actions such as Report Issue, Releases, and Profile Sync help can open GitHub pages in the user's default browser.
- **Entity-provided media**: Home Assistant entity attributes may reference remote artwork, camera, or stream URLs. Authenticated Home Assistant media remains restricted to the configured server. External artwork requests reject local, private, link-local, and reserved destinations, including redirect targets.

### Application Security

- **Electron isolation**: The renderer uses `contextIsolation: true` and `nodeIntegration: false`; privileged operations are exposed through the preload IPC bridge.
- **Updates and authenticity**: Update delivery is based on the GitHub release channel and Electron updater behavior for supported package types. Current macOS artifacts are not Apple Developer-ID signed or notarized. Their ad-hoc packaging signature checks bundle integrity only; it does not authenticate the developer or satisfy Gatekeeper. Treat other platform artifacts as unsigned unless a release explicitly states otherwise.
- **Build formats**: Windows installer and portable builds, macOS archives, and Linux packages may have different updater and signing capabilities.

## Known Security Considerations

### Home Assistant Integration

- **Authorization**: New setups use Home Assistant browser authorization. Long-lived access tokens remain available as an advanced compatibility option.
- **Local machine trust**: Anyone with access to the user's OS account may be able to read local config, logs, or sync files depending on platform encryption support and file permissions.
- **Network trust**: The app has the same network reachability to Home Assistant that the desktop user has.

### Profile Sync

- **Cloud-backed folders are outside the app boundary**: If the selected sync file lives in a provider-synced folder, that provider controls transport, retention, sharing, and account security.
- **Optional encryption depends on passphrase strength**: Use a unique passphrase if the sync file will leave the local machine.
- **Conflict behavior**: First enable prompts for a local-vs-remote choice. Version 4.0 merges changes to different sections independently. Concurrent changes to the same section choose the newer revision and retain a recovery backup. The sync scope is local to each computer.

### Updates And Downloads

- **External availability**: GitHub update and language-pack checks require network access and may fail offline.
- **Manual-update packages**: Portable, macOS, and Linux deb builds do not replace themselves automatically.
- **Release verification**: When in doubt, compare downloads against the release page and avoid third-party mirrors.

## Security Updates

Security updates may be released as:

- **Patch releases**: For critical or narrowly scoped security fixes, such as `4.0.1`
- **Minor releases**: For broader security improvements, such as `4.1.0`
- **Major releases**: For significant security architecture changes, such as `4.0.0`

## Contact Information

- **GitHub**: [@Robertg761](https://github.com/Robertg761)
- **Repository**: [HA Desktop Widget](https://github.com/Robertg761/HA-Desktop-Widget)

## Acknowledgments

Thank you to security researchers and community members who help keep HA Desktop Widget safer by reporting issues responsibly.

---

**Last updated**: October 2, 2026
