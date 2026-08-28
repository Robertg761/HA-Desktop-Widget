# Provenance and local patches

This directory is a vendored fork of
[windowtolayer](https://gitlab.freedesktop.org/mstoeckl/windowtolayer)
at upstream commit `1f77dc2` ("Make layer surface namespace configurable"),
license GPL-3.0-or-later (see COPYING). The binary built from this source is
shipped alongside the app as a **separate executable** spawned as its own
process; the app itself remains MIT-licensed (mere aggregation).

The HA Desktop Widget uses it to map the widget's window as a
wlr-layer-shell surface on the `bottom` layer, so tiling compositors
(Hyprland, Sway, niri) render the widget behind normal windows instead of
unconditionally above tiled ones. See issue #79 and
`docs/linux-wayland-notes.md`.

## Local changes vs upstream (src/main.rs, src/state.rs)

1. `--listen-socket <name>`: instead of passing a single connected socketpair
   via `WAYLAND_SOCKET` (which Electron cannot use — its GTK layer consumes
   the fd and Chromium Ozone then opens a second connection to the real
   display, and node/npm intermediaries drop inherited fds anyway), bind a
   named listening socket at `$XDG_RUNTIME_DIR/<name>`, set
   `WAYLAND_DISPLAY=<name>` for the child, and proxy **every** connection made
   to it, each on its own thread with its own upstream connection. The
   listener polls with a timeout and exits (removing the socket) when the
   child process exits. Incompatible with `--one-client`.

2. `--anchor <edges>` / `--size <WxH>` / `--margin <M | T,R,B,L>`: upstream
   always anchors the layer surface to all four edges (fullscreen wallpaper
   semantics). These options anchor to a corner/edge subset with an explicit
   size and margins, which is what a desktop widget needs. When anchored:
   - `xdg_surface.set_window_geometry` is translated into
     `zwlr_layer_surface_v1.set_size`, so client-side resizes track (the last
     sent size is tracked per surface, so multiple toplevels on one
     connection don't cross-suppress each other's updates);
   - `xdg_toplevel.set_max_size` no longer re-anchors to fullscreen;
   - the synthesized `xdg_toplevel.configure` omits the `fullscreen` state
     (upstream advertises it because its surface really is screen-sized).
   `--anchor` requires `--size` (both dimensions nonzero) and is incompatible
   with `--maximized` and `--reverse`.

3. xdg_popup forwarding: upstream errors out on `xdg_surface.get_popup`,
   which kills clients that open menus, `<select>` dropdowns, or tooltips.
   The proxy now lazily binds the real (filtered) upstream `xdg_wm_base` the
   first time the client creates an `xdg_positioner`, forwards positioners
   and popups as paired objects, creates a real upstream `xdg_surface` for
   the popup's surface, and links toplevel-parented popups to the layer
   surface via `zwlr_layer_surface_v1.get_popup` (per the layer-shell spec).
   The proxy answers the upstream `xdg_wm_base.ping` itself; downstream pings
   keep being answered by the client as before.

4. Robustness fixes to `--listen-socket` mode: startup probes an existing
   socket of the same name with a nonblocking connect and only replaces it
   when the error proves staleness (`ECONNREFUSED`/`ENOENT`); a successful
   connect, a full backlog (`EAGAIN`), or any other errno means a live or
   indeterminate owner and the helper exits 1 rather than displace it. Socket
   cleanup verifies ownership by device/inode before unlinking. After the
   child exits the listener keeps accepting and serving new connections while
   the active ones drain, then exits (the AppImage runtime and forked children
   may outlive the direct child briefly and still open connections).

5. Readiness and preflight in `--listen-socket` mode: before binding the
   listening socket or spawning the child, connect to the upstream display
   (nonblocking connect, 2 s total budget) and scan the registry
   (`wl_display.get_registry` + `sync`) for `zwlr_layer_shell_v1`, exiting 1
   with a clear stderr message when the display is unreachable, stale, or the
   compositor cannot host layer surfaces. Startup errors exit 1 instead of
   returning success. Once the socket is bound, listening, and the child is
   spawned, the helper writes a ready marker at `<socket path>.ready`
   containing its own pid (removed again on exit). A supervisor should treat
   "marker exists and its content matches the helper pid it spawned" as
   readiness — immune to stale sockets/markers from a previous run — and
   "the helper exited" as the failure signal.

6. Hardening against the `panic = "abort"` release profile and protocol edge
   cases: proxy receive buffers are 64 KiB (a single Wayland message caps at
   65535 bytes, so one message can never overflow them) and a full buffer
   closes that connection with an error instead of panicking the whole
   process; `xdg_surface.get_toplevel`/`get_popup` on a surface whose
   `wl_surface` was already destroyed raise a protocol error instead of
   panicking; the `wl_surface -> xdg_surface` map is populated on
   `get_xdg_surface` so surface-destroy cleanup actually runs; the advertised
   `xdg_wm_base` version is capped at the upstream global's version when
   known; the child's stdout/stderr are redirected to /dev/null (the helper's
   own diagnostics still go to its stderr, which the app logs to a file).

7. Runtime raise/restore control channel in `--listen-socket` mode: a second
   unix stream socket is bound at `<socket path>.ctl`. One line command per
   connection: `raise` moves every live layer surface to the `overlay` layer,
   `restore` returns them to the configured layer (both injected as
   `zwlr_layer_surface_v1.set_layer` plus a `wl_surface.commit`, and only when
   the compositor's layer shell was bound at version >= 2, where `set_layer`
   exists). This gives the app's popup hotkey a working "bring to front" on a
   bottom-layer surface, which no window-level raise can lift. Commands apply
   to all connections (each proxy thread polls a shared generation-counted
   atomic with a 50 ms poll timeout), the commanded layer also applies to
   surfaces created afterwards, and a control-socket bind failure only
   disables runtime raising, never startup.

8. Monitor selection support on the control channel, plus a softened
   `--output-name` failure mode: an `outputs` control command answers with one
   `name\tdescription` line per monitor and closes the connection (from a
   fresh registry scan over a short-lived upstream connection, in the style of
   the preflight in item 5, so hotplug stays correct; outputs advertised
   below `wl_output` version 4 have no name event and are skipped). And when
   `--output-name` names a monitor that does not exist — a saved choice can
   outlive the monitor it named — the helper now logs a warning and lets the
   compositor choose, instead of killing the client's connection. Together
   these let the app offer a "move widget to monitor" menu: query names,
   save one, relaunch with `--output-name`.

9. Client-initiated interactive move (dragging the widget), with optional
   persistence via `--position-file <path>` (requires `--anchor`): layer
   surfaces have no compositor-side interactive move, so a compositor drag
   bind (e.g. Hyprland's Super+drag) passes through them, and upstream
   silently drops `xdg_toplevel::move`. The proxy now performs the move
   itself: it observes the real seat's `wl_pointer` enter/motion/button
   events as they are forwarded, and `xdg_toplevel::move` (sent by
   Chromium/Electron when a `-webkit-app-region: drag` region is dragged)
   latches a drag when the pointer is over that toplevel's surface. During
   the drag the proxy injects `zwlr_layer_surface_v1.set_margin` plus a
   `wl_surface.commit` to follow the pointer (per anchored edge, only on
   axes anchored to exactly one edge, clamped nonnegative so the surface
   stays on the output). Several defenses make the resulting position exact
   rather than merely approximate:
   - The grab point is only seeded from pointer coordinates that lie inside
     the surface; some input paths (virtual absolute-pointer devices on
     Hyprland) emit positions computed against the wrong origin, which would
     poison the grab.
   - Motions are debounced by timestamp: a motion is held pending until one
     with a later timestamp arrives (or the drag ends), so when a bogus
     wrong-origin position is followed by the real one under the same
     timestamp, last-one-wins keeps the real one.
   - Margins are computed absolutely, not incrementally: each pending motion
     records the margins the surface sat at when the position was measured
     (its *base*), and the target is `base ∓ (local − grab)` per axis. A
     `wl_display.sync` callback brackets each injected update; while it is
     outstanding, new motions are tagged with the pre-inject margins and no
     further update is injected. This makes stale measurements
     non-compounding no matter how the compositor interleaves repositioning
     with motion events.
   - Motion-driven injects are rate-limited to one per 15 ms of event time.
     Compositors that animate layer-surface geometry changes (Hyprland's
     `layers` animation) otherwise glide the surface under the pointer
     between measurements, forming a positive feedback loop that flings the
     surface. (The app additionally disables that animation node via
     `hyprctl` on Hyprland; the rate limit is defense-in-depth for
     compositors where that fails.)
   A button release (or an early leave) flushes the pending motion
   unconditionally — its own base makes it correct even mid-sync — so the
   final position is exact, then ends the drag and, when
   `--position-file` is given, saves the margins there
   (`top,right,bottom,left`, written via rename); the file is re-read when
   each new connection starts, so all of the client's connections — and the
   next run of the helper — map surfaces where the user left them. A drag is
   dropped when its toplevel is destroyed, and a malformed or absent
   position file falls back to `--margin`.

These changes are intended to be submitted upstream. If upstream gains
equivalent functionality, prefer depending on an upstream release and drop
this vendored copy.
