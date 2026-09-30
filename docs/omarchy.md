# HA Desktop Widget on Omarchy

Use the Arch package for a stable `ha-desktop-widget` command and launcher entry. Updates to that installation belong to pacman. AppImage users can continue using the in-app updater.

On Hyprland the widget uses a native Wayland desktop layer. Normal windows cover it. Drag the title area to move it within its monitor, or use the tray's Move to Monitor menu. Desktop pins keep their own positions on each monitor. Pins move in desktop-pin edit mode.

Always on top and Hide on focus loss are unavailable in desktop layer mode. Use the popup shortcut, a tray click, or `ha-desktop-widget --toggle` to raise the main widget above your windows. The same action, or clicking elsewhere after using the widget, lowers it back to the desktop. On Hyprland, where focus follows the mouse, the raised widget stays up while the pointer crosses other windows on its way to it, and lowers once the pointer has moved off to something else. Starting the widget with `--show` or `--toggle`, as app launchers and the Omarchy bar do, also raises it once it appears; autostart leaves it on the desktop. Pins stay on the desktop. The tray menu's Show/Hide still hides the widget completely.

If the widget starts at login before the bar, its tray icon appears as soon as the bar does.

## Omarchy bar

On Omarchy 4, choose Add to Omarchy Bar in the widget's tray menu. It copies the bundled plugin into `~/.config/omarchy/plugins/com.github.robertg761.hadesktopwidget` and places it on the right side of the bar. To add it by hand from the Arch package instead:

```sh
cp -r /opt/ha-desktop-widget/resources/omarchy-plugin ~/.config/omarchy/plugins/com.github.robertg761.hadesktopwidget
omarchy-shell shell rescanPlugins
omarchy plugin enable com.github.robertg761.hadesktopwidget
```

The bar shows a Home Assistant icon, dimmed while the widget is disconnected or not running. Click it to open a panel with your Quick Access tiles, drawn like the widget's: the same names, icons, and status lines, lit in the accent color while on. Clicking a tile does what clicking it in the widget does: a light, switch, fan, lock, cover, or player toggles, a scene or script runs, and a camera, sensor, thermostat, or calendar opens its dialog in the widget, which comes forward. Hold a light, fan, cover, thermostat, or player tile, or use its adjust button or a right-click, to adjust it right in the panel: brightness, color temperature and colors, fan speed, cover position, target temperature and mode, or volume and tracks. Changes apply as you drag, and Open in widget brings up the widget's full controls. Arrow keys move between tiles, and Enter or Space clicks one; in a tile's controls, Left and Right move its slider, Enter switches it on or off, and Escape goes back. Right-click the bar icon to show or hide the widget. When the panel has nothing to list, a click shows or hides the widget too.

The panel shows every Quick Access tile, under page headings when Quick Access has more than one page. To show other entities, and up to four whose values appear in the bar itself, list them on the plugin's entry in `~/.config/omarchy/shell.json`:

```json
{
  "id": "com.github.robertg761.hadesktopwidget",
  "entities": ["light.office", "switch.coffee_maker", "sensor.living_room_temperature"],
  "barEntities": ["sensor.living_room_temperature"]
}
```

To start the widget through a wrapper or a different executable when it is not running, add `"command"` to the same entry; otherwise the bar uses the command the widget last saved, then `ha-desktop-widget`.

The widget must be running for the plugin to show values; the plugin never receives Home Assistant credentials. The widget publishes the tiles to `$XDG_RUNTIME_DIR/ha-desktop-widget/omarchy-bar.json`, and the plugin sends its actions over the widget's socket, `omarchy-bar.sock` in the same directory, which only your user can open. When the widget is not running, the plugin starts it through its command line. Updating the widget also updates an installed plugin. The Omarchy shell keeps running the old version of a changed plugin until it restarts, at your next login or with `omarchy-restart-shell`. Omarchy 3 uses waybar, which cannot load these plugins; the tray icon is available there instead.

Running timers count down every second in the bar and its open panel, even while the desktop widget is hidden. This includes timer sensors such as Google Kitchen Timer. The shell calculates the time left from the timer's deadline between Home Assistant state updates.

## Shortcuts

First-run setup explains desktop-layer visibility and offers a popup shortcut check. Use Set up shortcuts to open the Hotkeys settings, configure a popup shortcut, and copy its binding into Hyprland. Return to setup, press the shortcut, then choose Check popup shortcut. Setup can also continue without a shortcut.

The widget retries when the portal is late at login and recreates shortcuts after a portal restart or session closure. Transient failures use increasing retry delays capped at 30 seconds. Cancelling or timing out shortcut approval does not reopen the dialog automatically.

Set a popup or entity shortcut in Settings, then open the Hyprland shortcuts panel. `SUPER + SHIFT + H` is unbound in Omarchy's default bindings for both Omarchy 3.8 and 4, which makes it a good choice for the popup. Choose the configuration format you use: Lua for `.lua` files or Hyprlang for `.conf` files. The Copy bindings button copies the selected format. Check for conflicts with your existing bindings before adding it to your configuration. On Omarchy 4 with Hyprland 0.56, add a Lua binding to `~/.config/hypr/bindings.lua`:

```lua
hl.bind("SUPER + SHIFT + H", hl.dsp.global("com.github.robertg761.hadesktopwidget:popup-toggle"))
```

Press the shortcut and use Refresh shortcut status to check whether the widget received it. The widget does not overwrite compositor bindings. For older Hyprland releases using hyprlang, select Hyprlang to copy the equivalent `bind = SUPER SHIFT, H, global, com.github.robertg761.hadesktopwidget:popup-toggle` syntax into your sourced `.conf` file. Newer installations that retain Hyprlang configuration can select it too.

Existing configurations using `ha_desktop_widget:` keep working: the widget also registers that retired id with the portal while a launcher for it exists. Replace the prefix with `com.github.robertg761.hadesktopwidget:` when convenient. The first shortcut received through the old id writes the replacement bind to the log, and the shortcuts panel shows it after Refresh shortcut status.

A launcher binding can also use `ha-desktop-widget --toggle`. `--show` and `--hide` are idempotent. Commands act on the existing instance rather than starting a duplicate.

## Appearance and startup

The widget follows the active Omarchy palette by default. Turn off Follow Omarchy theme under Settings → Appearance to use your own color choices again. Theme changes apply without restarting. Omarchy 4 palettes and Omarchy 3.3 and later palettes are both read, including light themes such as Catppuccin Latte, Rose Pine, and Flexoki Light, which Omarchy 3 marks with a `light.mode` file. Omarchy releases before 3.3 have no `colors.toml`, so the option does not appear there.

Notifications carry the desktop entry `com.github.robertg761.hadesktopwidget`. On Omarchy 3, a mako section such as `[desktop-entry=com.github.robertg761.hadesktopwidget]` can style them separately.

Start at login is optional. It writes a standard XDG autostart entry, which Omarchy's uwsm session starts as its own systemd unit, so no `autostart.conf` line is needed. The application preserves a working startup target when a different package or beta is launched. A custom `--user-data-dir` disables startup changes for that profile.

The shortcut syntax follows the [current Hyprland binding documentation](https://wiki.hypr.land/Configuring/Basics/Binds/) and the [Hyprland 0.54 documentation](https://wiki.hypr.land/0.54.0/Configuring/Binds/). Desktop launcher quoting follows the [freedesktop Exec specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html).

## Building and checking

```sh
npm ci
npm run build:renderer
npm run build:windowtolayer
npx electron-builder --dir --linux --x64 --publish never
node scripts/build-arch-package.cjs
cd dist/arch
makepkg --nodeps
```

The generated recipe pins the exact bundle checksum. Runtime dependencies are declared in the recipe; `--nodeps` only skips their build-host check. Install the resulting package with pacman when ready. No Rust or Node toolchain is needed to run the installed package.

Use the packaged Wayland verification script documented in `docs/TESTING.md` for compositor tests. Keep its profile, XDG config, and XDG data directories isolated. Test monitor removal, mixed scale, palette replacement, portal activation, and package upgrade in a disposable desktop session.
