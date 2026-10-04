# Running the AppImage on systems that block the Chromium sandbox

Ubuntu 23.10 and later (and distributions that follow it) set
`kernel.apparmor_restrict_unprivileged_userns=1`, which stops an unprivileged process from creating
the user namespace Chromium's sandbox needs. The `.deb` is not affected: its `chrome-sandbox` helper
is installed setuid. An AppImage cannot be, so on such a system a double-clicked AppImage exits at
start with "No usable sandbox" and shows no window.

Any one of these gets it running:

- Install the `.deb` instead.
- Start the AppImage once from a terminal with `--no-sandbox`:
  `./HA-Desktop-Widget-<version>-linux-x86_64.AppImage --no-sandbox`. When it is started that way on
  a system with the restriction, the launcher the widget writes for itself
  (`~/.local/share/applications/com.github.robertg761.hadesktopwidget.desktop`) keeps the flag, so
  starting it from the application menu works afterwards. A launcher the widget wrote earlier,
  without the flag, gets it the same way the next time the AppImage is started with `--no-sandbox`.
  So does a menu launcher an integration tool such as AppImageLauncher made for an earlier version:
  when the widget repoints it from the deleted AppImage to this one, it adds the flag too.
- Let the AppImage create the namespace with an AppArmor profile, as Ubuntu does for Chromium and
  Electron packages it ships.

`--no-sandbox` turns off Chromium's renderer sandbox, which is why the widget never adds it on its
own.

The same restriction applies to the start-at-login entry of an AppImage. Turning that on writes a
launcher without the flag, so on an affected system either use the `.deb` or add `--no-sandbox` to
the `Exec=` line of `~/.config/autostart/com.github.robertg761.hadesktopwidget.desktop` yourself.
