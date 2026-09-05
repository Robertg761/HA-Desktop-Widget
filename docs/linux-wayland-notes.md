# Linux Wayland window behavior

Measured on Fedora 44, KDE Plasma 6 Wayland, Electron as bundled by this repo, using a
frameless `skipTaskbar` window and full-screen screenshots to check where the window
really is rather than trusting `getBounds()`. Keep this file next to any future work on
popup show/hide, saved positions, or always-on-top.

## What a Wayland session does not allow

| API                                   | Result on KDE Wayland                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `new BrowserWindow({ x, y })`         | Ignored. KWin places the window itself (centered, with this user's placement policy).                                             |
| `setBounds({ x, y })` / `setPosition` | Size applies; the origin is silently dropped. `getBounds()` then reports the value that was _asked for_, not where the window is. |
| `hide()` then `show()`                | The surface is unmapped and re-mapped, so KWin re-runs placement and the window comes back centered.                              |
| `minimize()` then `restore()`         | The window never reappears. `xdg_toplevel` has `set_minimized` with no client-side counterpart.                                   |
| `setOpacity(value)`                   | No-op, so the widget's opacity setting does nothing in a Wayland session.                                                         |
| `setSize(width, height)`              | Works, and anchors the existing top-left corner. This is the only lever that keeps a window's position.                           |

`getBounds()` returning what was requested rather than the truth is the trap here: code
can look correct, log correct values, and still leave the window somewhere else. Verify
window position changes with a screenshot, not with `getBounds()`.

Two other measurements from the same session, for anyone tempted by the obvious
workarounds:

- Collapsing the window to 1x1 instead of unmapping it **does** keep the position (it comes
  back exactly where it was, and 1x1 renders no visible pixels), but the collapsed window
  keeps keyboard focus and neither `blur()` nor `setFocusable(false)` can give it up, so the
  user's next keypress goes into an invisible window. That is why this route was rejected.
- KWin re-places a window the user dragged, not just one it placed itself. Verified by
  moving the window with a KWin script and then hiding and showing it.

## What the app does about it

`shouldForceX11OzonePlatform()` appends `--ozone-platform=x11` on a Linux Wayland session, so
the widget runs through XWayland and the X11 semantics above apply again: the saved position
survives hide/show and app restarts, `setOpacity` works, and always-on-top is honored rather
than advisory. Opt out with `HA_WIDGET_LINUX_NATIVE_WAYLAND=1`, an explicit
`--ozone-platform` argument, or `ELECTRON_OZONE_PLATFORM_HINT=wayland`. The switch is also
skipped when `DISPLAY` is unset, because a session without XWayland has no X11 display to
fall back to and forcing one would stop the app from starting.

XWayland is not viable everywhere. On the machine these notes were written on (NVIDIA 595.80,
Plasma 6 Wayland), Chromium's GPU process segfaults on startup under `--ozone-platform=x11`
with `MESA-LOADER: failed to open dri: /usr/lib64/gbm/dri_gbm.so` and no window ever appears.
`--disable-features=Vulkan`, `--disable-gpu-sandbox`, and ANGLE/GL made no difference; only
`--disable-gpu` starts cleanly, which is too high a price to pay by default.

So the switch heals itself: two GPU-process crashes within 20s of startup while XWayland is
forced make the app relaunch itself with an explicit `--ozone-platform=wayland` (which is also
what stops the relaunch from looping) and write a `xwayland-unavailable` marker in the user data
directory, so later starts skip the attempt instead of paying ~4s for it every time. Delete that
file to try XWayland again, for instance after a driver update.

Global hotkeys are unaffected by that switch: `isWaylandSession()` reads the session
environment, not the rendering backend, so a Wayland session keeps using the XDG
GlobalShortcuts portal, which works regardless of how the app draws. One exception: a
portal bind the user once dismissed stays approved with no trigger and rebinding never
re-prompts, so when shortcuts were requested and the portal assigns no active trigger to
any of them — or the bind fails outright — a session running through XWayland falls back
to the partial X grabs instead of leaving every hotkey inert. The fallback is sticky for
the rest of the session (re-probing the portal on every hotkey change would tear the
working grabs down for the length of a bind round trip each time); assigning the
shortcuts in the desktop's shortcut settings and restarting the app adopts the portal
again. A session with no hotkeys configured stays on the portal, and native Wayland has
no X-grab fallback, so there the portal stays active either way. A single assigned
trigger also keeps the portal: it is demonstrably approved, and the remaining triggers
can be assigned in the desktop's shortcut settings.

## Raising the popup on native Wayland: KWin scripting

Bringing an already-mapped window to the front is the other thing a Wayland client cannot
do: `moveTop()` is X11-only, `setAlwaysOnTop()` is advisory, and `focus()` needs an
xdg-activation token the compositor only grants around real user input into this client —
the GlobalShortcuts portal's `Activated` signal carries no token, and Electron exposes no
way to spend one anyway. So on native Wayland the popup hotkey's raise branch used to be a
silent no-op whenever the widget was visible but occluded: the log said "window shown" and
nothing moved. (Hiding still worked, and showing from hidden worked because a fresh map is
placed on top, which made the hotkey feel half-broken rather than dead.)

`src/kwin-window-raise.cjs` closes the gap the same way kdotool does: it loads a one-shot
script through `org.kde.KWin /Scripting` that assigns `workspace.activeWindow` (Plasma 6;
`activeClient` on Plasma 5) for the window with the widget's exact title. KWin treats that
as a compositor-side activation — focus and raise, in place, no re-placement — so the
window never loses its position the way a hide/show remap would. Verified on the machine
above with the widget occluded and unfocused. The activation also hands the widget focus,
which is what lets the next hotkey press take the toggle's hide branch.

The presenter fires the request on show and again on each raise re-assert pass, wired only
when the compositor owns placement (`usesCompositorOwnedPlacement`). Mutter and wlroots
compositors have no equivalent interface (`org.kde.KWin` has no owner there, probed once
per session), so the request degrades to a no-op and those sessions keep the previous
behavior. A deliberately rejected alternative: unmapping and re-mapping the window would
raise it everywhere, but re-runs compositor placement and re-centers the widget for anyone
without the KWin rule below.

## Keeping the position on native Wayland: a KWin rule

A compositor that will not let the app place its window will still place it itself, and KWin can
be told to reuse the last position. This is the only way to keep the widget where the user put it
on a native Wayland session, and it was verified on the machine above: move the window, hide it,
show it, and it comes back where it was.

The main window sets a stable `title: 'HA Desktop Widget'` and blocks `page-title-updated`
precisely so a rule can match it. Desktop pins load the same `index.html` but each sets its own
stable `HA Pin: <entity id>` title and blocks the same event, so a rule for the widget does not
catch them and a second rule matching one pin's title can remember that pin's position
individually. The pin titles deliberately do not contain the main window's title, so even a
substring match on `HA Desktop Widget` skips every pin.

In System Settings, this is Window Management -> Window Rules -> Add New, then "Detect Window
Properties" on the widget, match on window title, and add Position -> Remember. The equivalent
entry in `~/.config/kwinrulesrc` is:

```ini
[General]
count=1
rules=ha-desktop-widget-position

[ha-desktop-widget-position]
Description=HA Desktop Widget — remember position
position=100,1080
positionrule=4
title=HA Desktop Widget
titlematch=1
types=1
wmclassmatch=0
```

`positionrule=4` is Remember; KWin overwrites `position` itself as the window moves. Apply it
without a logout with
`gdbus call --session --dest org.kde.KWin --object-path /KWin --method org.kde.KWin.reconfigure`.

Verified against a packaged build (`electron-builder --linux dir`), not just `npm start`: the new
modules ship inside `app.asar` (`src/**/*` covers them), the XWayland attempt and its relaunch
work from a packaged binary, the marker lands in the packaged user data directory and suppresses
later attempts, and a window mapped by the packaged app is placed by the rule above.

When the native Wayland backend is in use, either through the opt-out or a compositor where
XWayland is unavailable:

- The popup presenter skips its position restore (`supportsWindowPositioning: false`); no API
  could carry it out, and writing a compositor-invented origin back into
  `config.windowPosition` corrupts the position the user chose on other platforms.
- Anything that unmaps the main window (`hide()`, close-to-tray, the tray toggle) loses its
  position, and the widget's opacity setting does nothing.
- Desktop pin windows cannot place themselves either: drags are not persisted and saved pin
  positions are not applied, though size edits still work. Their edit mode says so in the tile
  itself, and the per-pin titles above are what let a KWin rule remember each pin's position.
- Never call `minimize()` on the main window without a plan for bringing it back; the app
  cannot unminimize itself.

## Tiling compositors (Hyprland, Sway, niri): the layer-shell mode

Measured on Arch Linux, Hyprland 0.56.2, native Wayland backend (issue #79). Hyprland — like
tiling compositors generally — draws every floating toplevel above every tiled window,
unconditionally. A widget mapped as a floating toplevel therefore acts as a permanent
overlay: a tiled window on the same workspace can never be raised above it, not by
clicking, not by focusing, not by any raise the compositor offers, and independent of the
`alwaysOnTop` setting. There is no client-side fix inside xdg-shell: `setAlwaysOnTop(false)`
is advisory at best, and the protocol has no "lower this window" request at all. The only
correct shape for a desktop widget there is a wlr-layer-shell surface on the `bottom`
layer — which Electron cannot create.

So on these compositors the app does not run as an xdg-shell client at all. Before taking
the single-instance lock, a launch that detects a tiling wlr-layer-shell compositor
(`HYPRLAND_INSTANCE_SIGNATURE`, `SWAYSOCK`, or `NIRI_SOCKET` — each trusted only when
the socket it names actually exists, since `systemctl --user import-environment`
commonly leaks them into later sessions on other compositors — or any allowlisted
compositor, including river, in `XDG_CURRENT_DESKTOP`) spawns the bundled
`windowtolayer` helper around a copy of itself
and exits (`src/layer-shell.cjs`; helper source in `vendor/windowtolayer`, a patched
GPL-3.0 fork — see its PATCHES.md). The helper serves a private Wayland socket, relays
every connection to the real compositor, and rewrites xdg-shell toplevels into
wlr-layer-shell surfaces as they pass through. The relaunched app runs with an explicit
`--ozone-platform=wayland` (a layer surface only exists on the native backend, so this
outranks the XWayland forcing above) and gets a marker env var so it never hands off again.

Verified on the machine above: `hyprctl layers` shows the widget on "Layer level 1
(bottom)" with no toplevel client, tiled and floating windows render above it, it renders
and updates live, and it sits anchored bottom-right of the focused output with a 20px
margin. The surface tracks the window's real size because the helper translates
`xdg_surface.set_window_geometry` into `zwlr_layer_surface_v1.set_size`. Keyboard
interactivity is `on_demand`, so the widget only takes the keyboard when clicked.
Popups still work: the helper forwards `xdg_positioner`/`xdg_popup` to the real
compositor and links them to the layer surface with `zwlr_layer_surface_v1.get_popup`,
so context menus, `<select>` dropdowns, and tooltips open normally instead of killing
the Wayland connection.

Operational notes:

- `HA_WIDGET_LINUX_LAYER_SHELL=0` disables the mode (the widget becomes a floating
  toplevel again); `=1` forces it on a compositor the allowlist misses. KWin also
  implements wlr-layer-shell but is deliberately not auto-detected: on a stacking
  compositor the widget behaves like a normal window and should keep doing so.
- Placement defaults to `bottom,right` with a 20px margin on the compositor-chosen
  output. Override with `HA_WIDGET_LAYER_SHELL_ANCHOR` (comma-joined edges),
  `HA_WIDGET_LAYER_SHELL_MARGIN` (one value or `top,right,bottom,left`; negative
  values are allowed and bleed past the anchored edge),
  `HA_WIDGET_LAYER_SHELL_OUTPUT` (connector name, e.g. `DP-1`), and
  `HA_WIDGET_LAYER_SHELL_LAYER` (`bottom` or `background`). An invalid override is
  logged and replaced with the default. In layer mode the widget's own saved screen
  position is not applied — anchor plus margin decide where the surface sits. The
  saved `config.windowSize` seeds the surface size. `HA_WIDGET_WINDOWTOLAYER` points
  at an alternative helper binary; without it the app uses the packaged
  `resources/helpers/windowtolayer` or the in-repo cargo build.
- An in-app restart cannot use `app.relaunch()`: the clone would inherit the child
  marker and a `WAYLAND_DISPLAY` naming the dying helper's socket. The restart path
  spawns a fresh helper instead, reconnected through the preserved upstream display.
  The helper socket name carries the spawning pid so a dev run beside the installed
  widget — or a restart racing the old helper's cleanup — cannot unlink the other's
  socket, and the helper refuses to displace a socket unless a probe proves it
  stale. The restarting side keeps the single-instance lock until the fresh helper
  has spawned successfully and releases it only then, so the replacement cannot
  lose the lock race against its not-yet-exited predecessor while a failed spawn
  still falls back to `app.relaunch()` with the guarantee intact.
- The child's inherited environment (child marker + `WAYLAND_DISPLAY` naming the
  helper's private socket) is restored to the parent's
  (`restoreLayerShellParentEnv`) as the first act of `app.whenReady()`: only the
  browser process holds the Wayland connection and it is established by then, while
  any process spawned later — `app.relaunch()` after a GPU crash,
  `autoUpdater.quitAndInstall()`, a terminal opened from the widget — must see the
  real compositor socket, not one that dies with this process, and must redetect
  the compositor instead of skipping the handoff.
- From an AppImage, the helper relaunches `$APPIMAGE` rather than
  `process.execPath`: the latter lives in the runtime's FUSE mount, which vanishes
  when the handing-off process exits. The relaunched AppImage runtime stays alive
  for the app's lifetime, so the helper's child-exit detection is unaffected. The
  helper binary itself is copied out of the mount into `<userData>/helpers` before
  spawning (`materializeLayerShellHelper`) for the same reason: a demand-paged ELF
  whose backing mount disappeared dies with SIGBUS on its next cold page fault.
  The copy is skipped when the materialized helper already matches the bundled one
  by size (mtime is meaningless there — `copyFileSync` stamps the copy time).
- The handoff exits the parent only after the helper is demonstrably ready: the
  helper preflights the upstream display (connects and scans the registry for
  `zwlr_layer_shell_v1`) before binding its socket and exits nonzero otherwise;
  once bound, listening, and past spawning its child it writes a `<socket>.ready`
  marker containing its own pid. The app synchronously waits
  (`waitForLayerShellHelperReady`) for that marker to carry the pid of the helper
  it actually spawned — a stale socket or marker from a previous run therefore
  cannot fake readiness — and checks liveness via `/proc/<pid>/stat` rather than
  `kill(pid, 0)`, because during the synchronous wait an exited helper is an
  unreaped zombie and signal 0 still succeeds on zombies. A stale
  `WAYLAND_DISPLAY`, a compositor without wlr-layer-shell, or a helper binary that
  cannot execute all degrade to the normal floating window with a logged warning
  (`layer-shell-helper.log`, rotated at ~1 MB) instead of a silent no-show.
- Smoke tests (`--smoke-test`) never hand off: they must measure the process they
  launched, not a grandchild. Dev caveat: under `npm run dev`, the handoff makes the
  ELECTRON task exit immediately, which takes the renderer watcher down with it
  (`concurrently -k`); use `HA_WIDGET_LINUX_LAYER_SHELL=0 npm run dev` for watch-mode
  work on a tiling compositor, or `npm run dev:once`.
- The popup hotkey works in layer mode through the helper's control socket
  (`<socket>.ctl`, see PATCHES.md item 7): a bottom-layer surface ignores every
  window-level raise (`setAlwaysOnTop`, `moveTop`, KWin scripting), so the
  presenter instead sends `raise` — the helper hops the layer surfaces to the
  `overlay` layer via `zwlr_layer_surface_v1.set_layer` — and sends `restore`
  when the elevation ends (hide, blur in toggle mode). Wired only when running
  as a layer-shell child (`src/layer-shell.cjs` `createLayerShellRaiser`); all
  other platforms keep the existing raise paths. Requires layer-shell protocol
  version >= 2 (Hyprland advertises 5). Caveat: in unpackaged dev runs the
  GlobalShortcuts portal rejects the registration ("An app id is required"), so
  the hotkey itself only binds in packaged builds; the raise mechanism can be
  exercised directly with `raise`/`restore` lines to the control socket.
- Dragging the widget works in layer mode, but it is the helper doing the
  moving, not the compositor: a compositor drag bind (Hyprland's Super+drag)
  only targets toplevels and passes straight through a layer surface to the
  window behind it. Instead, dragging the widget's own drag regions
  (`-webkit-app-region: drag`) makes Chromium send `xdg_toplevel.move`, which
  the helper intercepts and implements by following the pointer with
  `set_margin` updates (PATCHES.md item 9). The final position persists in
  `<userData>/layer-shell-position` (passed as `--position-file`, skipped
  while `HA_WIDGET_LAYER_SHELL_MARGIN`/`..._ANCHOR` override placement), and
  the tray's "Reset Position" deletes that file and restarts, returning to
  the default corner. Dragging cannot cross outputs — a layer surface is
  bound to one `wl_output` — which is what the tray menu below is for.
  On Hyprland the app also disables the animation nodes that move a layer
  surface (`disableHyprlandLayerMoveAnimation`, tried via both the classic
  `hyprctl keyword animation <node>,...` and the Lua-config
  `hyprctl eval 'hl.animation({ leaf = "<node>", ... })'` syntaxes): with the
  animation on, the compositor glides the surface under the pointer between
  the helper's measurements, which destabilizes the drag into a feedback
  loop that flings the widget across the screen. Hyprland resolves a mapped
  layer surface's position animation through the `layersIn` node, so both
  `layers` and `layersIn` are disabled — the parent alone is not enough on
  distros like Omarchy that configure `layersIn` explicitly. `layersOut` and
  the `fadeLayersIn`/`fadeLayersOut` alpha fades stay; the only visible side
  effect is that other layer surfaces (panels, launchers) lose slide/popin
  open animations for the session. Set
  `HA_WIDGET_LAYER_SHELL_KEEP_LAYER_ANIMATIONS=1` to keep the animations (the
  helper's inject rate limit dampens the loop, but the drag stays unusable
  with a fast mouse). The tweak is session-scoped and does not edit any config
  file; Hyprland re-applies its configured animations on every config reload,
  so the app follows the compositor's event socket
  (`watchHyprlandConfigReloads`) and repeats the tweak after each
  `configreloaded` event.
- Moving the widget to another monitor happens through the tray menu, not by
  dragging (a layer surface cannot leave its output). The tray's "Move to
  Monitor" submenu asks the helper for the session's monitors (`outputs`
  control command, PATCHES.md item 8), saves the chosen `wl_output` name as
  `config.layerShellOutputName` ('' = compositor decides, the default), and
  restarts through a fresh helper spawned with `--output-name`. The submenu
  only appears when the helper answers the query — an old helper degrades to
  no menu item. A saved name whose monitor was unplugged or renamed is
  handled helper-side: it warns and falls back to the compositor's choice
  rather than killing the connection. `HA_WIDGET_LAYER_SHELL_OUTPUT` still
  outranks the saved choice as a debugging knob.
- Desktop pin windows pass through the same helper and become bottom-layer surfaces
  with the same anchor, so they stack in the same corner as the widget instead of
  taking their saved positions. Pins already cannot position themselves on native
  Wayland (above); layer mode keeps them behind normal windows at least. Per-pin
  placement in layer mode is an open follow-up.
- If the helper binary is missing, the app logs a warning and continues as a normal
  floating toplevel. For that degraded case (or an older release), a Hyprland rule can
  at least park the widget in dead screen space:
  `windowrule = move 100%-w-20 100%-h-20, class:^(com\.github\.robertg761\.hadesktopwidget)$`
  (plus `float` and `noinitialfocus` rules with the same class match).
