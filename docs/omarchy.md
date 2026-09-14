# HA Desktop Widget on Omarchy

Use the Arch package for a stable `ha-desktop-widget` command and launcher entry. Updates to that installation belong to pacman. AppImage users can continue using the in-app updater.

On Hyprland the widget uses a native Wayland desktop layer. Normal windows cover it. Drag the title area to move it within its monitor, or use the tray's Move to Monitor menu. Desktop pins keep their own positions on each monitor. Pins move in desktop-pin edit mode.

Always on top and Hide on focus loss are unavailable in desktop layer mode. Use the popup shortcut to bring the main widget forward temporarily. Pins stay on the desktop.

## Shortcuts

Set a popup or entity shortcut in Settings, then open the Hyprland shortcuts panel. Choose the configuration format you use: Lua for `.lua` files or Hyprlang for `.conf` files. The Copy bindings button copies the selected format. Check for conflicts with your existing bindings before adding it to your configuration. On Omarchy 4 with Hyprland 0.56, add a Lua binding to `~/.config/hypr/bindings.lua`:

```lua
hl.bind("CTRL + ALT + H", hl.dsp.global("com.github.robertg761.hadesktopwidget:popup-toggle"))
```

Press the shortcut and use Refresh shortcut status to check whether the widget received it. The widget does not overwrite compositor bindings. For older Hyprland releases using hyprlang, select Hyprlang to copy the equivalent `bind = CTRL ALT, H, global, com.github.robertg761.hadesktopwidget:popup-toggle` syntax into your sourced `.conf` file. Newer installations that retain Hyprlang configuration can select it too.

Existing configurations using `ha_desktop_widget:` must replace that prefix with `com.github.robertg761.hadesktopwidget:`. The latter now matches the launcher and portal identity.

A launcher binding can also use `ha-desktop-widget --toggle`. `--show` and `--hide` are idempotent. Commands act on the existing instance rather than starting a duplicate.

## Appearance and startup

Enable Follow Omarchy theme under Personalization to follow the active palette. Disabling it restores your own color choices. Theme changes apply without restarting.

Start at login is optional. The application preserves a working startup target when a different package or beta is launched. A custom `--user-data-dir` disables startup changes for that profile.

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
