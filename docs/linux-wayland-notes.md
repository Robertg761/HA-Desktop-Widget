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
