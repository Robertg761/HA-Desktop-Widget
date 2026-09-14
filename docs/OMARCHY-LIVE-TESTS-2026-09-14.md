# Live Omarchy tests, September 14, 2026

These checks ran on the existing desktop with disposable widget profiles, private D-Bus sessions, a private GNOME Keyring, and invented Home Assistant credentials. Hyprland and the original widget continued running. No desktop reload, monitor reconfiguration, lock, suspend, reboot, package installation, or real Home Assistant device action was performed.

## Results

- Native packaged checks passed for independent pins, accurate capabilities, isolated startup settings, show/hide/toggle, live private palette changes, and unchanged compositor animations. Portal shortcut dispatch was not repeated in this follow-up.
- The packaged widget connected to a local WebSocket simulator, recovered from three forced connection losses, and maintained exactly one live authenticated connection after each recovery.
- Renderer reload and relaunch of the disposable widget restored the connection. Its invented legacy credential was encrypted on disk and recovered through the private keyring. Rejected authentication left the widget showing disconnected.
- A separate Electron probe exercised the production OAuth client with simulated token responses and a real loopback callback server. It verified encrypted refresh-token storage with file mode 0600, restoration from a fresh Electron process through the `gnome_libsecret` backend, rejection of an incorrect OAuth state, listener closure after pairing or cancellation, and removal of a revoked refresh credential.
- Host dynamic-library checks found no missing dependencies for the packaged executable or native helper.
- The final build and Arch package completed. Settings regression suites passed all 98 tests, and focused ESLint and formatting checks passed.

The final connected observation lasted 60.0 seconds and measured 0.29% of one CPU core. The test service's memory usage went from 243.1 MiB to 231.7 MiB. This includes private support processes and cgroup-accounted memory; it is not the application's RSS. One connection remained live. This short sample does not establish long-term stability or camera performance.

## Defect found and fixed

A renderer reload exposed an uncaught `Cannot read properties of null (reading 'profileSync')` error. Main can publish profile-sync status before the renderer receives its configuration. The settings handler now caches that status and waits for configuration before rendering the controls.

A regression test reproduced the error before the fix and passed afterward. The rebuilt packaged recovery run recorded no uncaught renderer exceptions, and its main log contained no recurrence. The security documentation was also corrected to describe browser authorization as the normal setup flow and long-lived tokens as a compatibility option.

## Preservation and remaining limits

Hashes of all files under the user's Hyprland and autostart configuration directories, their file lists, and compositor animation settings matched the initial snapshot after cleanup. Hyprland PID 1732 and original widget helper PID 2974 retained their original process start times. The disposable test service and its children were stopped.

Browser sign-in against a real Home Assistant server, unlocking the user's actual login keyring, clean-install and upgrade behavior, physical shortcut conflicts, stock-animation dragging, hotplug, fractional scaling, suspend/resume, other GPU families, and a sustained camera/weather workload remain unverified. The browser was not opened by the OAuth probe; the token exchange was simulated. No credentials from the user's real profile were read.

Evidence and disposable test drivers are under `dist/omarchy-verification/live-system-2026-09-14`. The drivers retain the temporary paths used for this run and are evidence, not portable CI scripts. That directory's `SHA256SUMS` identifies the rebuilt package and bundle; earlier audit checksums describe the preceding build. The built version is still 3.10.0, and nothing was published.

## Compatibility follow-up

Settings now offers Lua and legacy Hyprlang shortcut formats. The selected format controls the copied text and remains selected when status is refreshed. This supports older Hyprland installations and newer installations that retain `.conf` files. Both formats follow the official documentation linked in [the Omarchy guide](omarchy.md). Generated legacy fields reject config delimiters and line injection. The old compositor itself was not run.

New appearance tests reproduced a separate issue: the Omarchy appearance helper cleared inline text colors even when theme following was inactive. It now removes those overrides only after applying an Omarchy palette. Tests also cover inactive palette following, native drag capability guards, explicit theme preservation, and accent/background selection during system theme changes.

All 84 JavaScript suites and 1,651 tests passed with coverage thresholds satisfied. The runner still printed its delayed-shutdown warning before exiting successfully. ESLint, Stylelint, repository hygiene, renderer/package builds, and Arch package creation passed. A disposable packaged app supplied both formats through IPC and switched the displayed binding correctly; its screenshot was visually reviewed. Copy behavior and format retention were checked in the settings integration test without changing the user's clipboard.

The temporary service was stopped. Desktop/autostart file hashes and file lists, animation settings, and original process start times were unchanged. No Windows, macOS, Sway, niri, or older-Hyprland runtime validation is claimed. Evidence and the latest build checksums are under `dist/omarchy-verification/compatibility-2026-09-14`; the preceding directories retain historical evidence and checksums.
