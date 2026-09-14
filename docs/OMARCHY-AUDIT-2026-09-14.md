# Omarchy compatibility audit

Follow-up: [implemented fixes, verification results, and remaining hardware checks](OMARCHY-VERIFICATION-2026-09-14.md).

Audited September 14, 2026, at commit `c0bf201`, version `3.10.0`.

HA Desktop Widget can run on Omarchy, but I would not yet recommend it for inclusion. The native Wayland desktop layer works. Several surrounding behaviors still fail, and launching the app changes compositor behavior for unrelated applications. Fix those before expanding the feature set or approaching Omarchy's maintainers.

The best initial target is a maintained, optional Arch package with a short Omarchy setup path. Whether DHH wants to include it is an editorial decision. Compatibility alone cannot establish that.

## Scope and evidence

This audit combines source review, current upstream documentation, the installed Omarchy implementation, automated checks, and a freshly built Linux package running in the real Hyprland session.

| Component            | Audited baseline                                          |
| -------------------- | --------------------------------------------------------- |
| Repository           | Clean `main` at `c0bf201` before this report              |
| Omarchy package      | `4.0.3-1`                                                 |
| Omarchy version file | Reports `4.0.0.alpha`, inconsistent with package metadata |
| Hyprland             | `0.56.2-2`, compositor reports `0.56.2`                   |
| XDG desktop portal   | `1.22.1-2`                                                |
| Hyprland portal      | `1.4.1-2`                                                 |
| GNOME Keyring        | `1:50.0-1`                                                |
| Electron             | `43.1.0`                                                  |
| Displays             | Two monitors, 2560×1080 and 1920×1080, both scale 1       |
| Live test package    | Fresh `electron-builder --dir --linux --x64` output       |

The test app used a throwaway profile, no Home Assistant credentials, and a temporary systemd user service with `Type=exec` and `ExitType=cgroup`. These match the relevant service lifetime properties in the installed UWSM launcher. Its initial process exited after handing off; the helper and app stayed alive inside the service. No sandbox-disabling switch was required.

`HA_WIDGET_LAYER_SHELL_KEEP_LAYER_ANIMATIONS=1` suppressed the known global animation mutation in the test instance. Thus the live launch proves the layer path, but does not certify dragging with stock animations. The user's existing widget remained running separately.

One unintended effect revealed finding O4: the packaged test launch repointed the shared autostart entry despite its separate profile. The entry was restored to the running production AppImage. No HA device commands were sent. No Omarchy configuration files or packaged Omarchy sources were edited.

## Priorities

P1 means a defect to fix before recommending Omarchy support. P2 means an integration or verification gap to close before proposing inclusion.

| ID  | Priority | Finding                                                            | Evidence                                     |
| --- | -------- | ------------------------------------------------------------------ | -------------------------------------------- |
| O1  | P1       | Widget disables layer animations for the entire desktop            | Confirmed in source                          |
| O2  | P1       | Hyprland popup shortcut setup fails                                | Reproduced in packaged UI and portal calls   |
| O3  | P1       | Portal identity differs from the packaged desktop identity         | Source mismatch; local launcher masks it     |
| O4  | P1       | Packaged copies overwrite shared autostart configuration           | Reproduced during this audit                 |
| O5  | P1       | Desktop pins overlap and lack independent layer placement          | Reproduced with two synthetic pins           |
| O6  | P2       | Settings report unsupported layer behavior as available            | UI and compositor state verified             |
| O7  | P2       | Release and installation flow does not fit Arch package management | Repository and installed Omarchy review      |
| O8  | P2       | No Omarchy palette integration; automatic theme is a one-time read | Source review                                |
| O9  | P2       | CI bypasses Omarchy's actual runtime path                          | CI review and test execution                 |
| O10 | P2       | Monitor loss and recovery lack a verified contract                 | Source risk; live hotplug not tested         |
| O11 | P2       | Empty visible widget consumes substantial CPU in local samples     | Repeated cgroup measurements; cause unproven |

## O1. Remove the global animation override

`disableHyprlandLayerMoveAnimation()` runs `hyprctl` commands that disable both `layers` and `layersIn`. It runs at child startup and after every Hyprland `configreloaded` event. Omarchy explicitly enables these animation nodes in its defaults. This changes panels and launchers as well as the widget, and repeats after a theme or configuration reload. There is no restoration on quit.

The code explains the underlying defect: the helper drags by changing margins while measuring pointer coordinates relative to an animated surface. The resulting feedback can fling the widget across the screen. Disabling animations globally is a workaround with an unacceptable scope for an app seeking desktop inclusion.

References: [layer-shell policy](../src/layer-shell.cjs), function `disableHyprlandLayerMoveAnimation`, around line 524; [startup and reload wiring](../main.js), lines 729–740; [vendored patch rationale](../vendor/windowtolayer/PATCHES.md), item 9. Installed defaults are `/usr/share/omarchy/default/hypr/looknfeel.lua`.

Required change: stop mutating global animation nodes. First investigate a per-surface solution against the supported compositor version. Do not assume a `no_anim` rule fixes geometry changes; the current code specifically reports that it does not. If reliable animated dragging cannot be implemented, ship explicit corner, monitor, and offset placement controls while repairing the drag algorithm. Keep any global workaround behind an explicit troubleshooting choice.

Acceptance: launch, move, resize, change theme, reload configuration, and quit. Omarchy's layer animation settings must remain unchanged, and the widget must stay within its display. Test fast physical pointer motion and fractional scale, not only synthetic events.

## O2. Implement a Hyprland shortcut setup flow

The installed Hyprland portal registers a shortcut target, ignores `preferred_trigger`, and returns an empty `trigger_description`. Hyprland expects a compositor binding to invoke that target. Its behavior differs from the settings-dialog workflow assumed by the widget. See the [Hyprland portal implementation](https://raw.githubusercontent.com/hyprwm/xdg-desktop-portal-hyprland/v1.4.1/src/portals/GlobalShortcuts.cpp) and [portal documentation](https://wiki.hypr.land/Hypr-Ecosystem/xdg-desktop-portal-hyprland/).

A direct call through this repository's portal controller returned:

```json
{ "success": true, "backend": "portal", "bound": [{ "id": "audit-popup", "trigger": "" }] }
```

While that session was open, `hyprctl globalshortcuts` listed `ha_desktop_widget:audit-popup`. The temporary registration was then closed.

In the packaged renderer, `electronAPI.registerPopupHotkey("Control+Alt+F12")` returned:

```json
{
  "success": false,
  "backend": "portal",
  "error": "The desktop portal did not assign an active popup shortcut. Assign it in system shortcut settings."
}
```

The app treats the empty display description as proof that registration failed, rolls back the requested shortcut, and leaves `popupHotkey` empty. On Hyprland, an empty description does not establish whether a compositor binding exists. The same assumption affects entity shortcuts and can incorrectly trigger the partial X11 fallback.

References: [popup registration](../main.js), around lines 8294 and 9083; [portal controller](../src/portal-global-shortcuts.cjs), around lines 515–566.

Required change: distinguish registered targets, assigned bindings, and unverified activation. Keep registered targets alive on Hyprland; provide a copyable, version-appropriate binding using the stable portal app ID and target ID. Explain the setup inline. Offer an activation test. Preserve existing user bindings and do not silently edit compositor configuration.

Also provide documented `--toggle`, `--show`, and `--hide` actions through the single-instance handler. Currently a second launch always calls `showMainWindowFromTray()` and ignores command arguments. A CLI toggle gives Omarchy a simple launcher binding and a recovery path. It does not replace entity-action shortcuts.

Acceptance: configure a shortcut on a clean installation, trigger it while a native Wayland terminal has focus, hide/show repeatedly, restart, and confirm it still works. Repeat with a conflicting binding and with the portal restarting.

## O3. Unify the application identity

The package declares `com.github.robertg761.hadesktopwidget`, and Linux packaging enables `syncDesktopName`. The portal module instead hardcodes `ha_desktop_widget`.

This machine has `~/.local/share/applications/ha_desktop_widget.desktop`, which allowed the legacy portal ID to register during testing. That file is outside the repository's packaging contract. A probe with a nonexistent audit ID was rejected by the host registry with `App info not found`; session creation then returned `An app id is required`. This is evidence that launcher presence matters here, not proof that every installation fails identically.

References: [package metadata](../package.json), lines 4–5; [Linux packaging](../electron-builder.yml), around line 104; [portal ID](../src/portal-global-shortcuts.cjs), line 28; registry registration around line 301.

Required change: derive the desktop filename, portal registration, compositor shortcut targets, and launcher identity from one constant. Handle legacy IDs deliberately so an upgrade does not silently invalidate existing bindings. Verify the actual emitted desktop entry and runtime identity, not only the JSON configuration.

Acceptance: test in a fresh account with only the installed package's desktop entry. No manually created `ha_desktop_widget.desktop` may be present. Verify portal registration, launcher discovery, icon association, and upgrades from the old ID.

## O4. Make autostart repair respect ownership and installation choice

Launching the new unpacked package with `--user-data-dir=/tmp/ha-omarchy-audit/profile` changed the shared autostart entry to the unpacked test executable. The log claimed the previous executable no longer existed. The production AppImage did exist and was running.

`syncLinuxAutostartExecutablePath()` checks whether an enabled entry exactly matches the current command. It does not check whether the old executable is missing, whether this is the user's chosen installation, or whether the current entry was generated by the app. It rewrites the whole entry, removing extra arguments and other user settings. The generated-entry ownership check is only used by legacy migration.

References: [repair implementation](../src/linux-startup.cjs), around lines 93–161; [automatic invocation](../main.js), around lines 9718–9750.

Required change: use a stable package-owned executable path for Arch installs. Restrict automatic repair to an owned entry whose previous installation is demonstrably obsolete. Preserve launch options and desktop-entry fields. Give secondary profiles an explicit isolated mode that includes autostart behavior, not just config storage. Validate desktop-entry escaping, including literal percent signs in filenames.

Acceptance: enable startup for the installed package, then launch a beta, an unpacked build, and a separate profile. The entry must stay with the chosen install. An upgrade must still start at the next login, and disabling startup must remove only app-owned entries. Include a customized `Exec` line in regression tests.

Omarchy's `xdg-desktop-autostart.target` is active on this machine. The installed UWSM code uses `ExitType=cgroup`, so the helper handoff is compatible with that service lifetime model. A blanket claim that Omarchy cannot process XDG autostart entries would be incorrect. Actual logout/login remains an acceptance test.

## O5. Give each desktop pin its own placement and layer state

Two synthetic sensor pins were created through the real renderer IPC. The app returned different saved positions:

| Pin                | Position returned by app | Actual Hyprland position | Actual size |
| ------------------ | ------------------------ | ------------------------ | ----------- |
| `sensor.audit_one` | 180, 1104                | 2528, 1992               | 168×148     |
| `sensor.audit_two` | 208, 1132                | 2528, 1992               | 168×148     |

Both were bottom-layer surfaces on the same monitor, directly overlapping. The helper receives one output, anchor, margin set, and position file for the whole application. Native Wayland pin creation deliberately omits saved x/y coordinates. This is already acknowledged as unfinished in the Linux notes, but the normal pin interface remains available.

The helper's `raise` control command also changes every live layer surface, including pins. Raising the main popup therefore has broader scope than the UI suggests.

References: [pin creation](../main.js), around line 2331; [spawn arguments](../src/layer-shell.cjs), function `buildLayerShellSpawnPlan`; [control commands](../vendor/windowtolayer/src/main.rs), around line 1495; [layer updates](../vendor/windowtolayer/src/state.rs), around line 368; [existing limitation](linux-wayland-notes.md), around line 307.

Required change: identify surfaces individually and persist placement by pin ID and output. Target popup elevation only at the main widget. If that is deferred, disable desktop pin creation in this mode with a clear explanation instead of creating overlapping windows.

Acceptance: three pins and the main widget retain distinct positions after restart, monitor changes, resize, and main-popup activation. A pin drag must not move another surface or overwrite its saved placement.

## O6. Make settings describe what the current backend supports

The live settings screen showed an enabled, checked Always on top checkbox. `getWindowState()` returned `alwaysOnTop: true`; `setAlwaysOnTop(true)` returned `success: true, applied: true`. Hyprland still reported the widget on layer 1, the bottom layer.

Hide to tray when focus is lost is also editable, although its controller explicitly disables that behavior for layer-shell children. Users should not need to read the README to discover that a checked option is inert.

References: [settings population](../src/settings.js), around line 3917; [auto-hide gate](../main.js), line 769; [always-on-top result](../main.js), around lines 6871–6921.

Required change: expose backend capabilities to the renderer. Describe Desktop layer mode explicitly, hide or explain unsupported options, and report compositor behavior separately from Electron's internal flags. Consider a separate persistent On top mode only if the helper actually changes layers to implement it.

Do not classify Linux opacity as wholly broken from the older Wayland notes. The current code enables a transparent window when configured opacity is below 1 and supports CSS transparency. What still needs visual verification is blur, opaque-to-transparent restart behavior, and mixed-scale rendering.

Acceptance: every enabled setting visibly works in the active backend. A rejected or unsupported setting must not report `applied: true`.

## O7. Add a maintained Arch installation and update path

The release targets are x64 AppImage and deb. There is no Arch package recipe in this repository. The README tells Linux users to download one of those artifacts. Omarchy's package helper installs packages through pacman, making a maintained Arch package a better fit for inclusion. See [Omarchy's package helper](https://github.com/omacom/omarchy/blob/quattro/bin/omarchy-pkg-add).

Required change: maintain a PKGBUILD, initially a binary package if that is the practical route. It should install a stable command, desktop entry, correctly sized icons, the helper, and the appropriate license files. Verify dependencies in a clean Arch environment. Do not require users to install development headers or Rust to run the binary package.

Package-manager installations should direct updates through the package manager. Keep AppImage self-updates available for AppImage users, but do not make the Arch package copy or update its executable inside the user profile. Include the vendored helper's exact source revision in release documentation and package review materials; its separate license is already shipped by the current build.

References: [Linux targets](../electron-builder.yml), lines 90–110; [build scripts](../package.json); [updater selection](../src/platform.cjs), function `supportsAutoUpdater`; [helper provenance](../vendor/windowtolayer/PATCHES.md).

Acceptance: clean install, launch from Omarchy's menu, optional startup, upgrade, downgrade, and removal. The application must leave no enabled startup entry pointing to a removed binary. Test real AppImage updates separately because unpacked-package success does not verify FUSE mount lifetime or self-update handoff.

## O8. Follow Omarchy colors without rewriting the dashboard

There is no Omarchy theme reader or theme hook in the app. `applyTheme('auto')` samples `prefers-color-scheme` when called, with no change listener in that function. This distinguishes light and dark but does not import Omarchy's palette.

The installed Omarchy 4 theme command replaces the active theme directory at `~/.local/state/omarchy/current/theme` and invokes the theme-set hook. The skill's older examples and older Omarchy installations may use different paths. Read the actual version's generated palette and account for directory replacement. See [Omarchy's theming documentation](https://raw.githubusercontent.com/omacom/omarchy/quattro/docs/theming.md).

Required change: offer Follow Omarchy as an appearance choice. Read validated color values in the main process and pass sanitized tokens to the renderer. Map background, foreground, accent, border, and selection colors while keeping explicit user overrides. React to theme changes without restarting or resaving unrelated dashboard settings. Never load arbitrary theme JavaScript or shell content into the renderer.

References: [theme application](../src/ui-utils.js), line 740; [appearance defaults](../main.js), around line 3707; installed `/usr/share/omarchy/bin/omarchy-theme-set`.

Acceptance: switch between stock dark and light themes, then a custom palette. Text, controls, weather graphics, and tray values remain readable. Restart preserves Follow Omarchy. A missing or malformed palette falls back cleanly.

## O9. Test the shipped Wayland path

The JavaScript suite passed all 81 suites and 1,609 tests. Renderer and preload builds, Rust helper build, Linux directory packaging, ESLint, CSS lint, and repository hygiene passed. Jest printed a delayed-exit warning but ultimately exited successfully.

`cargo test` completed successfully with zero tests in the library, binary, and documentation targets. It does not validate the custom protocol transformations or drag calculations.

Linux CI smoke-launches under `xvfb-run` and passes `--smoke-test`. The layer policy explicitly disables handoff for that argument, as well as for normal `--dev` runs. The CI launch therefore never tests the helper path used on Omarchy. The current JavaScript helper tests mostly validate policy and command construction.

References: [Linux CI smoke launch](../.github/workflows/ci.yml), lines 156–164; [handoff exclusions](../src/layer-shell.cjs), function `shouldRelaunchIntoLayerShell`; [helper tests](../tests/unit/layer-shell.test.js).

Required change: add an isolated Wayland test mode that retains normal handoff. Run a packaged app under a supported Hyprland version and a controlled session bus. Assert compositor geometry, protocol survival, shortcut activation, helper cleanup, and restart behavior. Keep the current X11 checks too. Add Rust tests around drag calculations and protocol translation, including malformed input and multiple surfaces.

For manual diagnosis, add a sanitized desktop diagnostics view reporting package version, rendering backend, compositor, helper readiness, namespace, output, portal ID, shortcut state, secure-storage backend, and startup target. The first failed launch in this audit produced only parent handoff logs; helper-child stderr is discarded, making some startup failures hard to diagnose.

Acceptance: a regression in pin placement, global animation mutation, or Hyprland shortcut setup must fail a test that runs before release.

## O10. Define monitor-loss and placement recovery

The helper can list outputs, remember a chosen output, and fall back when a saved output is absent at launch. Those are useful foundations. They do not prove recovery when an output disappears while the app is running.

The proxy translates a layer-surface `closed` event into `xdg_toplevel.close`. The app normally converts close into hiding to the tray. A compositor closing a layer surface on output removal may therefore leave the widget hidden without recreating it on another monitor. The main process has no explicit `display-removed`, `display-added`, or `display-metrics-changed` handlers. This is a source-based risk, not a reproduced hotplug failure.

The margin drag code clamps values nonnegative but does not establish an upper bound from the monitor's usable dimensions. Large saved offsets also need recovery when moving to a smaller display.

References: [closed-event translation](../vendor/windowtolayer/src/state.rs), around line 809; `compute_drag_margins` around line 285; [monitor selection and restart](../main.js), function `applyLayerShellMonitorChoice`; [output handling](../src/layer-shell.cjs).

Required change: keep the user's preferred output separately from the currently available output. Recreate surfaces when needed, clamp placement to usable logical coordinates, and recover after resolution or scale changes. Preserve pin-specific positions when O5 is implemented.

Acceptance: unplug the selected monitor while visible and hidden, reconnect it, change primary output, reduce resolution, and test 125%, 150%, and 200% scale. Reset Position must always recover the widget. These operations were not performed against the user's live desktop during this audit.

## O11. Investigate visible idle CPU use

After removing both test pins and clearing the synthetic entities, the disconnected dashboard was sampled without active interaction. Settings were dismissed. CPU figures measure the test service's entire cgroup, including Electron and the helper, and express usage as a percentage of one CPU core.

| State                          | Sample duration | CPU    | Cgroup memory |
| ------------------------------ | --------------- | ------ | ------------- |
| Visible, empty dashboard       | 15 seconds      | 13.91% | 224.9 MiB     |
| Explicitly hidden, no pins     | 15 seconds      | 0.21%  | 220.1 MiB     |
| Visible again, empty dashboard | 30 seconds      | 13.77% | 221.4 MiB     |

The second visible measurement confirms this was worth investigating, but these are short diagnostic samples on one machine with remote debugging attached and another widget running in a separate cgroup. They are not a release benchmark. Cgroup memory includes more than private application allocations and should not be compared directly to a process RSS figure.

Required change: profile rendering, CSS animations, GPU work, and helper traffic in this state before choosing a fix. Establish a clean-account baseline and measure a normal connected dashboard, covered windows, weather effects, cameras, and several pins. Check that inactive visuals stop repainting. The current evidence does not identify which component causes the visible CPU use.

Acceptance: publish reproducible visible and hidden idle measurements on representative hardware. Set a budget appropriate for an always-running desktop widget and include resource regressions in release review.

## What already works or deserves to stay

- Native Wayland layer-shell handoff and the bundled helper are functional in a freshly packaged build.
- The widget and pins appear on the bottom layer instead of permanently covering tiled windows.
- Onboarding and settings render in the real Electron window. Browser inspection reported no page errors during the checked UI flow.
- The test package survives the parent-exit handoff under UWSM-style cgroup lifetime management.
- The app selects `gnome-libsecret` on this Hyprland session. Omarchy includes GNOME Keyring. Actual OAuth persistence with a locked or late keyring still needs testing.
- Single-instance handling, monitor selection, config write serialization, hidden-camera handling, and popup raise/restore mechanisms already exist. Build on them.
- Linux opacity has a CSS transparency path; the older documentation is too broad when it describes opacity as a no-op.
- The helper's provenance and local modifications are documented, and its license file ships beside the executable.

## Remaining acceptance matrix

These tests need a controlled account or VM and a test Home Assistant instance. They were not certified by this audit.

| Area             | Required cases                                                 | Pass condition                                                      |
| ---------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Installation     | Fresh Arch package, AppImage, upgrade, uninstall               | Correct launcher, dependencies, startup target, and cleanup         |
| Login            | Normal login, automatic login, delayed portal/keyring          | One app instance; usable recovery when credentials are locked       |
| Authentication   | Browser OAuth, cancel, expired token, restart                  | Pairing persists securely; no repeated login requirement            |
| Input            | Portal binding, CLI toggle, native terminal focus, conflict    | Predictable activation and clear setup state                        |
| Desktop behavior | Tiled windows, fullscreen, workspace switch, lock              | Widget stays on intended layer and does not capture invisible focus |
| Menus            | Tray left/right clicks, monitor submenu, selects, file chooser | Correct placement, focus, and dismissal in Omarchy's shell          |
| Displays         | Hotplug, dock, negative origins, mixed scale                   | Visible, reachable widget and independent pins                      |
| Appearance       | Stock dark/light themes, custom palette, transparency          | Correct live colors, readable text, clean edges                     |
| Resilience       | Helper crash, renderer crash, portal restart, HA restart       | Recoverable state and actionable diagnostics                        |
| Sleep/network    | Suspend, resume, VPN change, offline login                     | Connection and state recover without stale controls                 |
| Resources        | Empty dashboard, normal dashboard, weather, camera, 0/1/5 pins | Documented CPU/memory figures and low hidden activity               |
| Updates          | AppImage self-update, pacman upgrade, version rollback         | One helper/app instance and a valid startup entry                   |

Do not treat hidden or covered layer surfaces as necessarily equivalent to Electron's hidden-window state. Camera and animation resource use should be measured while covered by normal windows as well as after an explicit hide.

## Suggested delivery order

1. Fix desktop ownership and shortcuts: O1, O2, O3, and O4. Add targeted regressions alongside each fix.
2. Make advertised behavior truthful: fix or temporarily gate pins, then add layer-mode capabilities to settings. Address O5 and O6 together.
3. Add packaged Wayland verification and monitor recovery: O9 and O10. Use both a clean account and a real multi-monitor session.
4. Prepare the Omarchy experience: Arch package, stable CLI toggle, palette following, concise setup documentation, and resource measurements. Address O7, O8, and O11.
5. Propose a small optional-app integration with a maintained package and a short demonstration of install, keyboard invocation, theme change, normal tiling, and restart persistence.

The proposal should name the tested Omarchy and Hyprland versions and list any remaining limitations. Keep credentials and app preferences inside the widget. Avoid a proposal that asks Omarchy to carry global compositor workarounds or a large fork of widget logic. Follow the [current Omarchy contribution instructions](https://raw.githubusercontent.com/omacom/omarchy/quattro/AGENTS.md) when preparing that separate contribution.

Runtime logs, the settings capture, and temporary test files for this session are in `/tmp/ha-omarchy-audit/`. They are supporting local evidence, not files required to understand this report.

The portal test session was explicitly closed. Hyprland's portal nevertheless retained the unbound `ha_desktop_widget:audit-popup` target in `hyprctl globalshortcuts`. No compositor key binding was created for it, and the test process disconnected. The portal was not restarted because that could interrupt the user's other applications. Add target cleanup and session rebinding to the portal acceptance tests.
