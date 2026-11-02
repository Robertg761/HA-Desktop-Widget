# HA Desktop Widget 4.1.0 for macOS 12 Monterey

This is a one-time build: 4.1.0 for Macs that cannot move to macOS 13. It is the final version for
macOS 12 and will not get any further updates. It lives on the `legacy/macos12` branch, which
was made from the `v4.1.0` tag and is never merged into `main`.

## Why it exists

4.1.0 runs on Electron 45, and Electron dropped macOS 12 in Electron 44, so 4.1.0 needs macOS 13.
That happened in commit 98c766d1, "Run on Electron 45", which also raised
`mac.minimumSystemVersion` from `'12.0'` to `'13.0'`. This build is 4.1.0 on the last Electron
that supports macOS 12.

## What changed from 4.1.0

| Change                                                                                                  | Where                                                                 | Why                                                                            |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Electron `45.1.0` → `43.8.6`, pinned exactly                                                            | `package.json`, `package-lock.json`                                   | 43.8.6 is the newest 43.x (npm dist-tag `43-x-y`). Chromium 150, Node 24.22.1. |
| `mac.minimumSystemVersion` `'13.0'` → `'12.0'`                                                          | `electron-builder.yml`                                                | Sets `LSMinimumSystemVersion` so macOS 12 opens the app.                       |
| Renderer build target `chrome156` → `chrome150`                                                         | `vite.config.js`                                                      | Matches Electron 43's Chromium.                                                |
| Update checks switched off (`LEGACY_UPDATES_DISABLED`)                                                  | `main.js`                                                             | See [Updates](#updates).                                                       |
| `publish: null`                                                                                         | `electron-builder.yml`                                                | No `app-update.yml` in the app and no `latest-mac.yml` from the build.         |
| Version `4.1.0-macos12`, files `HA-Desktop-Widget-4.1.0-macos12-universal.dmg` and `-universal-mac.zip` | `package.json`, `electron-builder.yml`                                | See [Version](#version).                                                       |
| A build workflow                                                                                        | `.github/workflows/legacy-macos12.yml`                                | See [Building](#building).                                                     |
| Tests for the switched-off updater                                                                      | `tests/unit/main-update-check.test.js`, `main-update-install.test.js` |                                                                                |

### Electron 44/45 changes in 4.1.0, checked against 43

- **`clipboard.writeText`** returns a promise since Electron 44, and 98c766d1 made `main.js` `await`
  it. On 43 it returns `undefined`, so the `await` does nothing, and a failed write still throws
  inside the same `try`. Left as it is.
- **Every other API.** I diffed the `electron.d.ts` of 43.8.6 and 45.1.0, then searched `main.js`,
  `preload.js`, `renderer.js`, `src/` and `packages/widget-renderer/` for anything only 45 has:
  app shims, `windowStatePersistence`, `setZoomMode`, the new clipboard `read`/`write`/`has` and
  `ClipboardItem`, the Prompt and local-AI APIs, and the new permission and event names
  (`local-network-access` and the like). The app uses none of them.
- **Renderer.** The one new CSS feature in 4.1.0 is `appearance: base-select` for selects on Linux
  only, behind `@supports`. Chromium has had it since 135. Vite now compiles the JavaScript for
  Chromium 150.
- **Fuses** (`electronFuses`, added in 4.1.0): every fuse the config sets is in Electron 43's
  fuse wire. A mac bundle packed from this branch reads back RunAsNode, NODE_OPTIONS and
  `--inspect` off, and embedded ASAR integrity and asar-only loading on. `resetAdHocDarwinSignature`
  runs `codesign` and so only runs on macOS.
- **Stripe checkout window** (`src/card-donation.cjs`, added in 4.1.0): it uses a sandboxed
  `BrowserWindow` with no preload in a throwaway partition, `setWindowOpenHandler`,
  `will-navigate`, `will-redirect` (reading `event.isMainFrame`, falling back to the positional
  argument), `did-fail-load`, `session.setPermissionRequestHandler` and `setPermissionCheckHandler`,
  `net.fetch` and `AbortSignal.timeout`. Electron 43 has all of them. Stripe's hosted checkout
  supports Chromium 150.

## Updates

**The legacy build never looks for an update.** Every later version needs macOS 13, so the only
safe answer is "none":

- macOS builds already have Squirrel.Mac off (`supportsAutoUpdater` in `src/platform.cjs`; they
  are ad-hoc signed). What they do instead is ask the GitHub API for `/releases/latest`, 30 s
  after launch and every 6 h, and if it is newer, post a notification and show
  "Update available: v… Download update". In this build `LEGACY_UPDATES_DISABLED` in `main.js`
  turns all of that off:
  - No scheduler starts, and nothing is checked on resume.
  - Settings' Check button and the tray's Check for Updates answer "You are up to date!" without
    contacting GitHub.
  - `quit-and-install` refuses.
- `publish: null` means electron-builder puts no `app-update.yml` in the app, so electron-updater
  would have nothing to read even if it were ever started. The build writes no `latest-mac.yml`
  either, so there is no manifest that could be uploaded by mistake.

The prerelease-channel switch in Settings still saves, but it no longer changes anything.

### Do 4.0.x installs on macOS 12 get offered 4.1.0?

**Yes, but not through `latest-mac.yml`.** 4.0.2 (Electron 43, minimum macOS 12) has Squirrel.Mac
off on macOS, like 4.1.0, so it never reads `latest-mac.yml`. Its manual check reads
`/releases/latest`, now 4.1.0. Because 4.1.0 is newer than 4.0.2, it posts the "update available"
notification (once per version) and sends the user to the 4.1.0 release page. Nothing in that
check looks at the OS version or at `minimumSystemVersion`. If the user installs 4.1.0's DMG
over 4.0.2, macOS 12 refuses to open it ("requires macOS 13.0 or later"). The data in
`~/Library/Application Support` is untouched, and reinstalling 4.0.2 or this build restores a
working app. The same thing happens again for every later release that becomes "latest".

**Smallest fix, which needs no code change on `main`** (the code in 4.0.x can't be changed now):
the release page that 4.0.x sends people to is the one thing the maintainer can still change.

1. Attach this build's DMG and zip to the **existing v4.1.0 release** as extra assets. Their
   names contain `-macos12`, so they don't clash with `latest-mac.yml`, which lists only
   `HA-Desktop-Widget-4.1.0-universal-mac.zip` and `.dmg`.
2. Add one line at the very top of the 4.1.0 release notes:
   _"Needs macOS 13 or later. On macOS 12 Monterey, download
   HA-Desktop-Widget-4.1.0-macos12-universal.dmg below instead. It is the final version for
   macOS 12."_ At the moment this is said only under "Removed", halfway down.
3. Repeat that line (with a link to the 4.1.0 release) at the top of each later release's notes,
   or for a while at least, because 4.0.x will point at whichever release is latest.

Once someone on macOS 12 installs this build, they stop being prompted.

**Older builds that do read `latest-mac.yml`.** Builds 3.5.1 through 3.8.0-beta.1 ran
electron-updater (Squirrel.Mac) on macOS and do fetch `latest-mac.yml` from the latest release.
4.1.0's `latest-mac.yml` has no `minimumSystemVersion`, so they are offered 4.1.0 and download
its zip. electron-updater 6.6.2 and later skip an update whose `minimumSystemVersion` is above
`os.release()`. On macOS, `os.release()` is the **Darwin** version (macOS 12 = 21.x,
macOS 13 = 22.x), so the field would have to read `minimumSystemVersion: 22.0.0`. `13.0` is not
valid semver, so the comparison fails and the update is allowed. The optional fix, also not made
here, is for `release.yml` on `main` to add that line to `latest-mac.yml` for future releases
(4.1.0's copy would need re-uploading). The install probably fails anyway, because Squirrel.Mac
rejects an ad-hoc signed update, but that has not been checked on a Mac.

## Version

**`4.1.0-macos12`**, chosen over `4.1.1-legacy`:

- It is honest: this is 4.1.0's features, not a later release. `4.1.1-legacy` claims a number
  `main` has not released and will use for something else.
- It sorts correctly in every updater. As a semver prerelease, `4.1.0-macos12` is below `4.1.0`
  and above `4.0.2`. So nothing on 4.1.0 or later, on any platform, ever sees it as newer (it
  can't pull anyone back onto Electron 43), and it is a real upgrade from 4.0.x. `4.1.1-legacy`
  sorts above 4.1.0, so if it were ever published as a release, electron-updater (Windows,
  AppImage) and the app's own release check would offer it to every 4.1.0 user.
- The app reads its own version safely: the beta-only live tray values stay off (they need
  `-beta.N`), and the locale-pack check reads it as 4.1.0.
- Finder's Get Info shows `4.1.0-macos12`, as it showed `4.1.0-beta.1` for the betas.

If the files are ever published:

- Attach them to v4.1.0 as above, or create a release with `--latest=false` that has no `*.yml`
  assets.
- **Don't mark it latest**: Windows and Linux updaters read the latest release.
- **Don't mark it a prerelease**: Windows/AppImage beta-channel updaters look for `latest.yml` in
  the newest prerelease.
- A `v4.1.0-macos12` tag matches `release.yml`'s `v*.*.*` trigger. That workflow then refuses,
  because the commit is not on `main`, but it is better not to start it at all.

## Building

`.github/workflows/legacy-macos12.yml` builds the universal DMG and zip from this branch and keeps
them **only as workflow artifacts** (90 days). It never creates a tag or release and never uploads
release assets. Its only permission is `contents: read`.

It runs on every push to `legacy/macos12`. After that first run it can also be started by hand
with `gh workflow run legacy-macos12.yml --ref legacy/macos12 -f signing=auto`. GitHub only
dispatches a workflow before it has run if the workflow is on the default branch, and this one
stays off `main`.

It checks the legacy settings, runs `npm ci`, lint and the full test suite, builds with
`npm run dist:mac -- --publish never`, and then checks the result:

- `codesign --verify --deep --strict`
- universal `lipo`
- `LSMinimumSystemVersion` is 12.0 and the version is `4.1.0-macos12`
- no `app-update.yml` and no update manifest
- a `--smoke-test` launch
- SHA-256 checksums

### Signing and notarization

No macOS release so far has been Developer ID signed or notarized: `release.yml` builds with
`CSC_IDENTITY_AUTO_DISCOVERY=false`, and `scripts/after-pack-mac-adhoc-sign.cjs` signs ad-hoc.
The repository has no Apple signing secrets. So by default the workflow (`signing: auto`) builds
**ad-hoc signed** files, the same as 4.0.2 and 4.1.0. Gatekeeper asks the user to allow the app
the first time, as it did for those versions.

To get a Developer ID signed, notarized build, add these repository secrets and run with
`signing: developer-id` (or `auto`, which uses them whenever all are set):

| Secret                 | What it is                                                               |
| ---------------------- | ------------------------------------------------------------------------ |
| `MAC_CSC_LINK`         | Developer ID Application certificate and private key, as a base64 `.p12` |
| `MAC_CSC_KEY_PASSWORD` | The `.p12`'s password                                                    |
| `APPLE_API_KEY_P8`     | App Store Connect API key, the text of the `.p8` file                    |
| `APPLE_API_KEY_ID`     | That key's ID                                                            |
| `APPLE_API_ISSUER`     | Its issuer ID                                                            |

electron-builder 26 then signs with the hardened runtime and its default Electron entitlements
(`allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`). It notarizes
the app with notarytool and staples it, and the workflow also checks `stapler validate` and
`spctl --assess`. The ad-hoc signature from `afterPack` is replaced when electron-builder signs.
This path has not been run, because the secrets don't exist.

## Not verified

- **Nothing has run on macOS 12.** GitHub retired its macOS 12 runners, and no Monterey machine
  was available. The workflow's smoke launch runs on the runner's newer macOS.
- What is known: the bundle's `LSMinimumSystemVersion` is 12.0, Electron 43 supports macOS 12,
  and the app starts on Electron 43 (Linux, Xvfb; the macOS runner).
- Not tried on any OS: the Stripe checkout window, a live Home Assistant connection, and the
  Developer ID and notarization path.
- 3.5.1–3.8.0-beta.1 failing to install 4.1.0 through Squirrel.Mac (see above).
