# 4.0 beta.17 verification and testing handoff

This beta carries the five fixes after beta.16 into a downloadable test build. It does not mark the native and external integration release gates complete. Website edits and deployment are on hold at the maintainer's request.

## Scope

Application baseline: `7b51f6606d06c2d9fd22903e0ccb980f668ed3b1`. The preparation commit changes release documentation only. The beta tag and its GitHub Actions release run identify the final build commit. Verification dates below use UTC (October 9, 2026).

| Fix                                                   | Regression coverage                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth cancellation while the durable commit is queued | `tests/unit/main-oauth-pairing.test.js`: canceled and superseded requests cannot overwrite authorization                                                        |
| OAuth persistence rollback                            | The same suite: failed first login, replacement login, thrown persistence failures, encrypted recovery bytes, and notification failures after a successful save |
| Update installer failure recovery                     | `tests/unit/main-update-install.test.js`: real BaseUpdater failure emission, delayed errors, thrown errors, retry, and unrelated shutdown                       |
| Climate pin zero and fractional targets               | `tests/unit/ui.test.js`: exact outgoing target values                                                                                                           |
| Artwork redirect cleanup                              | `tests/unit/ha-protocol.test.js`: stalled redirect bodies, response errors, and connection cleanup                                                              |

## Verification evidence

- [Baseline CI](https://github.com/Robertg761/HA-Desktop-Widget/actions/runs/37865827175) passed on the application baseline: Windows and Linux tests, lint and CSS lint, formatting/hygiene, dependency gate, renderer/panel builds, Rust tests, and packaged startup on Windows, Linux, and universal macOS. Windows: 7,439 passed and 8 skipped; Linux: 7,441 passed and 6 skipped, across 250 suites.
- Local full Jest run: **250 suites, 7,448 tests passed, no skipped tests**, using `npm test -- --runInBand --silent`. This includes simulated sync and companion coverage; it does not replace the external checks below.
- Focused release-note, release-workflow, and nightly-beta tests: **3 suites, 20 tests passed**. Full repository formatting and release-note extraction passed. Independent review found no issues in the preparation changes.
- Local production renderer, preload, and panel builds passed on Linux ARM64 with Node 26.10.0. The panel emitted its existing chunk-size warning; the build completed.
- Local ESLint with zero warnings, CSS lint, and repository hygiene passed.
- The dependency gate passed with the existing exception for `GHSA-vfj7-8cjw-p6xm`, reached only through development-only stylelint, expiring October 31. This is not a zero-advisory claim.
- An isolated source-build Electron 43.7.6 startup passed with `HA_WIDGET_SMOKE_TEST_OK` and exit 0 under native Wayland on Hyprland, using one 2560 × 1600 display at 160% scale. Command: `node_modules/.bin/electron . --smoke-test --ozone-platform=wayland`. Chromium's sandbox was not disabled. The disposable profile was cleaned up. A portal D-Bus teardown warning followed success. This is startup evidence, not packaged layer-shell, pin interaction, or physical monitor QA.
- [Windows and macOS monitor validation from PR #189](https://github.com/Robertg761/HA-Desktop-Widget/pull/189) records 17 Windows and 15 macOS scenarios, including scaled virtual displays, changed monitor identities, native dragging, persistence, and restart. It does not replace physical hotplug or suspend/resume checks.

The final preparation commit must pass CI before the Nightly Beta workflow can tag it. The Release workflow independently requires successful CI for that exact tag commit, builds the distributables, and publishes them as a prerelease. Consult the beta's linked Actions run for the final packaging result.

## Checks still requiring a test setup

Record actual results here or in a linked release report. Do not mark these passed from unit tests or screenshots. Use a disposable profile and copies of existing configurations and sync files; keep production originals intact.

| Check                                                   | Required result                                                                                                                                          | Status                                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fresh installation and 3.x upgrade on supported systems | Connection, pages, pins, alerts, and local preferences survive; backup and restore work                                                                  | Not signed off                                                            |
| Real Home Assistant authorization and recovery          | Login, cancel/retry, token replacement, two-server switching, and reconnect after sleep work                                                             | Not signed off                                                            |
| Two computers with a real shared sync folder            | Encrypted sync, concurrent edits, delayed writes, wrong passphrase, damaged-file recovery, and upgrade compatibility preserve data                       | Not signed off; simulated two-device tests are not two physical computers |
| Deployed companion and panel                            | Profile edit/apply/reopen, partial updates, server switching, disconnect, duplicate delivery, and acknowledgement retries reach the expected final state | Not signed off                                                            |
| Native desktop operation                                | Pins, tray, shortcuts, startup, focus, dragging/resizing, restart persistence, monitor changes, scaling, and suspend/resume work                         | Partial monitor/startup evidence above; broader QA remains open           |
| Real devices and sustained use                          | Camera/HLS reconnect, artwork redirects, calendars, to-do lists, history, service failures, and prolonged operation recover correctly                    | Not signed off                                                            |
| Actual beta install and update                          | Windows installer and Linux AppImage can update from beta.16; portable/macOS/deb manual installs work; installer failures leave the app usable           | Awaiting published beta and tester results                                |

For detailed steps use the [platform test plan](PLATFORM-TEST-PLAN-4.0.md), [connection recovery checks](connection-recovery.md), and [desktop pin checklist](../DESKTOP_PIN_QA.md).

Report: beta version and tag commit, OS/version, package type, desktop/session, display scales, Home Assistant version, scenario, expected result, actual result, and sanitized diagnostics. Never include access tokens, refresh tokens, sync passphrases, or the credential file.

## Stable release preparation

- Package and lockfile metadata already target `4.0.0`. The beta build aligns these to its prerelease tag without changing main's stable target.
- The stable changelog includes the five post-beta.16 fixes. Keep its date as `Unreleased` until the actual stable publication date.
- Keep 3.x supported during the beta. In the stable release commit, replace the transitional security support paragraph with “Security fixes target the latest stable 4.x release of HA Desktop Widget. Users on 3.x should upgrade; see the 4.0 migration guidance first.” Preserve the migration link; mark 4.x supported and 3.x unsupported in the table.
- Complete the outstanding native/integration checks above, then rerun CI on the exact final stable commit before tagging `v4.0.0`.
- Website deployment, its verification workflow, and final maintainer approval of privacy wording remain held. A source consistency review checked the install-count payload and opt-in/environment gates against `src/usage-ping.cjs`, the counter Worker and schema, and disabled Worker observability in `wrangler.toml`. It does not verify deployed provider logging or constitute maintainer/legal approval. No website files were changed.
- The smaller desktop-pin renderer remains in the [post-4.0 backlog](../BACKLOG-4.1.md).
