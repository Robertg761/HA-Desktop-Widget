# 4.0 release audit

Reviewed September 29, 2026, starting at `306c86b1709a75b568f4b78283e46e53669f339c`.
These results describe the original audit baseline. The later [feature audit and implementation follow-up](FEATURE-AUDIT-4.0.md) records the remaining app fixes and PR stack. Final CI and native release checks are still required.

## Findings fixed

The follow-up behavioral review reproduced these app defects before applying fixes:

- **Automation Toggle hotkeys did nothing.** Settings offered Toggle for automations,
  but its execution path sent no Home Assistant service command. It now calls
  `automation.toggle`. Regression tests cover enabled and disabled automations.
- **Alert state could remain stale after reconnecting.** If a previously notified
  threshold condition ended while disconnected, the reconnect snapshot did not clear
  its match, so the next threshold crossing could go unnoticed. State-change alerts
  could also report an old change when the first event merely repeated the new snapshot.
  Reconciliation now clears ended matches and updates the baseline while preserving
  cooldowns and duplicate suppression. Both cases failed before the fix and pass after it.

The earlier tooling and dependency review also fixed:

1. **The dependency audit skipped the shipped Electron runtime.** Both CI and release
   validation used `npm audit --omit=dev`. Electron is declared under `devDependencies`,
   so those checks passed even with runtime security advisories in the lockfile. The full
   audit found six affected packages, four high and two moderate. Electron was updated
   from 43.1.0 to 43.7.6 within the existing major version. Compatible updates to xmldom,
   Browserslist, baseline-browser-mapping, colord, fast-uri, and supporting browser data
   clear all six findings. CI and release validation now audit the entire dependency tree.
   A workflow regression test checks that development dependencies remain included.
   See the [Electron preload advisory](https://github.com/electron/electron/security/advisories/GHSA-qmv3-fv6v-rmhq)
   for one of the runtime fixes. This audit did not demonstrate an exploit against the app.
2. **Local worktrees broke lint and test discovery.** ESLint scanned the nested checkout
   under `.claude/worktrees`, reporting 16,693 unrelated errors. Jest found duplicate
   package names there. Local agent directories are now excluded from linting, Jest
   module discovery, and Git tracking. Jest also excludes generated output and the
   vendored Rust tree from module discovery. Existing worktrees remain intact.

## Verification of the updated checkout

| Check                                        | Result                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| JavaScript tests with coverage               | 119 suites, 2,473 tests passed                                     |
| Coverage                                     | 83.16% statements, 70.21% branches, 86.31% functions, 86.14% lines |
| Full dependency audit                        | Zero vulnerabilities, including development dependencies           |
| ESLint with zero warnings                    | Passed                                                             |
| CSS lint                                     | Passed                                                             |
| Formatting                                   | Passed                                                             |
| Repository hygiene and whitespace            | Passed                                                             |
| Production renderer and preload builds       | Passed                                                             |
| Home Assistant panel preview build           | Passed                                                             |
| Rust protocol tests                          | Five tests passed                                                  |
| Release layer-shell helper build             | Passed                                                             |
| Linux unpacked package using Electron 43.7.6 | Built successfully                                                 |
| Packaged Linux startup                       | Exited successfully with `HA_WIDGET_SMOKE_TEST_OK`                 |

The Linux smoke test used Xvfb, a private D-Bus session, a disposable profile, and
`--ozone-platform=x11 --no-sandbox`. It verifies packaged startup, preload, renderer,
and tray readiness. It does not establish production sandbox or native Wayland behavior.
Portal warnings in that isolated X11 environment did not prevent the smoke test from passing.

The coverage run prints Jest's one-second shutdown warning but exits with status zero.
A separate full run with `--detectOpenHandles` passed all 2,468 tests before the dependency
and workflow changes and reported no open handles.

The real renderer was also exercised through the panel preview at 500 by 760 pixels
with synthetic Home Assistant entities. Quick Access displayed eleven tiles, weather,
and media. Light-theme preview left the saved theme unchanged, Cancel and Escape
restored the dark theme, and Save persisted the light theme while keeping the tiles.
The unavailable fan showed an explanatory dialog without device controls. The brightness
dialog opened, and Halloween decorations rendered in the light theme. No browser console
errors appeared in these checks. The preview uses virtual IPC and Home Assistant services.

The follow-up checks also exercised the command palette, Quick Access search, removal
and undo, and switching between Home and Bedroom. An open thermostat dialog displayed
an unavailable message and disabled its temperature and mode controls after receiving
an unavailable state update. The renderer and panel were rebuilt after the behavioral
fixes, and a newly packaged Linux build passed the startup smoke test again.

The starting commit's [CI run](https://github.com/Robertg761/HA-Desktop-Widget/actions/runs/36636070268)
passed the Windows, Linux, and universal macOS package and smoke jobs. This is evidence
for the starting commit, not for the Electron update made during this audit.

## Before tagging 4.0.0

- Review and merge the prepared 4.0.0 package/lockfile version and nonempty
  `[4.0.0] - Unreleased` changelog section. The Tag Release workflow requires these
  on main. Replace the changelog's Unreleased date with the actual release date
  after completing the checks below. Preparation does not create a release tag.
- Check that the website is deployed from the commit being released. The live site was serving
  copy from before the audit fixes, which only a deploy of main replaces. After the website
  changes are merged, confirm in Vercel that the production branch is main, then run
  `node scripts/check-website-deploy.cjs --wait 600` (or dispatch the Website deploy check
  workflow, which also runs after each change to `website/` on main) and see it pass before the
  release is tagged. The site deploys when main changes, so it reads correctly on both sides of
  the release; it needs no edit on release day.
- Read the new app and website sections of [privacy.html](../website/privacy.html) before the
  release. They are legal wording written from what the app and the site request, and the
  maintainer should approve them.
- Run CI on the final release commit. In particular, the Electron update needs new
  Windows and universal macOS package and smoke results.
- Check a real Home Assistant login, reconnect after sleep, and profile sync between
  two computers, including a 3.x profile upgrade and encrypted sync. Automated mocks
  cover these paths but do not verify external services or physical devices.
- Complete native desktop checks on the supported systems, including pins, tray,
  shortcuts, monitor changes, scaling, and suspend/resume. Follow the existing
  [native Hyprland verification guide](TESTING.md#native-hyprland-verification) and
  [desktop pin checklist](DESKTOP_PIN_QA.md).
- In the release pull request, the last change before the tag: date the `## [4.0.0]` changelog
  heading, because the published release page and the changelog link read "Unreleased"
  otherwise, and change the Supported Versions in [SECURITY.md](../SECURITY.md) to 4.x
  supported and 3.x not. Until then that table says "After" and "Until the stable 4.0
  release", which is true while 3.11 is the latest stable release.

The behavioral fixes above address reproduced defects. These results do not establish
that every platform, device integration, or external sync provider is defect-free.
