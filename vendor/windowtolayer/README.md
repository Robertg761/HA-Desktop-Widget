# windowtolayer

This program transforms individual Wayland clients, which use the xdg-shell
protocol to display windows, into clients that use the wlr-layer-shell protocol
to render as a wallpaper. Note that wlr-layer-shell is only supported by some
compositors (like KWin, and those based on wlroots.)

Example usage:

```
windowtolayer termite -e asciiquarium
```

There is also a basic "reversed" mode which can transform clients using
wlr-layer-shell into xdg-shell windows:

```
windowtolayer -r swaybg -m tile -i example.png
```

## Building

Run `cargo build --release`; the executable will be in
`target/release/windowtolayer`.

The build script uses Python to generate Wayland protocol handling code.

## Status

This has many bugs and incompletely implemented message handlers, so certain
features (like opening popups) may not work.

An unavoidable limitation of the program design is a slight increase in latency
for clients run under `windowtolayer`. The memory usage of `windowtolayer` may
grow roughly proportional to the number of Wayland protocol objects created or
cumulative number of global objects advertised (which may grow slowly over time
if there are many output or seat changes).

## More examples

```
windowtolayer --output-name=DP-2 alacritty -e neo-matrix
windowtolayer --layer=top timeout 1 eglgears_wayland
windowtolayer --interactivity=all cage /usr/lib/xscreensaver/polyhedra
```

## Interaction with screen locking programs

`windowtolayer` can be used to adapt programs to a format compatible with lock
screen programs that delegate the screensaver drawing to another Wayland client:

- swaylock-plugin: expects wlr-layer-shell. To use xdg-layer shell clients, use
  `windowtolayer program`.
- plasma-wallpaper-application: expects xdg-shell. To use wlr-layer-shell
  clients, use `windowtolayer --reverse program`.
- xfce4-screensaver: expects xdg-shell + wle-embedding. To use wlr-layer-shell
  clients, use `windowtolayer --reverse --wle-embedding-token $token program`.
  To use regular xdg-shell clients, use
  `windowtolayer --reverse --wle-embedding-token $token windowtolayer program`.
