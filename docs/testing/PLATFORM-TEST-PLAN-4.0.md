# Cross-platform test plan for 4.0

This plan is for people with a Windows, macOS or Linux machine who can run a 4.0 build and check what automated tests and the project's Linux screenshots cannot show: real window managers and displays, real GPUs, accessibility settings, input methods, a live Home Assistant, and a machine left running for a day. Each check describes the behavior the app should have. Nothing here records a result; results go in your report.

You do not need to be a developer. Every check lists the steps, what you should see, and what to capture if you do not see it. A check that fails on your machine is a useful result, not a mistake on your part. If you cannot run a check (no second monitor, no touch screen, no tray icon), skip it and say so in the report.

The expected results describe how 4.0.0 is meant to behave. They were written against the source at commit `c2e97aa` together with the fixes planned for 4.0.0 at that time, so a few of them (the shortcut and tray name on Windows, for example) describe changes that a build made before those fixes does not have. The call for testers names the build to use. If a check fails on an older build, report it anyway; the developers know which failures are already on their list.

## Which sections to run

| Your machine                           | Run                                                                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 11 (22H2 or later)             | Shared checks, Windows 11                                                                                                                                                                                                                              |
| Windows 10                             | Shared checks, Windows 10 (it also points to a few Windows 11 checks)                                                                                                                                                                                  |
| macOS, Apple silicon or Intel          | Shared checks, macOS                                                                                                                                                                                                                                   |
| Any Linux desktop                      | Shared checks, Linux (every desktop), then the section for your desktop                                                                                                                                                                                |
| GNOME, KDE Plasma                      | The matching section, plus Ubuntu 24.04 if you use an AppImage or .deb                                                                                                                                                                                 |
| Hyprland or Omarchy, Sway, niri, river | The matching section                                                                                                                                                                                                                                   |
| Any machine with the right hardware    | Whichever of the cross-cutting sections apply: contrast themes and screen readers, several monitors, large text, Chinese or Japanese input, language packs, profile sync, a real Home Assistant, cameras, a long-running session, updates, the website |

Do the shared checks first. Later checks assume the Quick Access tiles from "Set up Home Assistant" and the pins from ALL-5. ALL-1 is the exception: it needs a profile folder that has never been started, so it does not use the one you set up (see "Use a throwaway profile"). On a Linux desktop with no tray icon, read "Check for a tray icon" before you start.

### Short on time

Run these first, in this order. They cover the problems most likely to affect the most people.

| Your machine | Checks                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows 11   | ALL-1, ALL-3, ALL-4, ALL-5, ALL-14, WIN11-1, WIN11-2, WIN11-5, WIN11-6, WIN11-8, WIN11-12                                                                                                                          |
| Windows 10   | ALL-1, ALL-3, ALL-4, ALL-5, WIN10-1, WIN11-1, WIN11-3, WIN11-5, WIN11-6, WIN11-8, WIN11-12                                                                                                                         |
| macOS        | ALL-1, ALL-3, ALL-4, ALL-5, ALL-14, MAC-1, MAC-2, MAC-3, MAC-5, MAC-6, MAC-10                                                                                                                                      |
| Linux        | ALL-1, ALL-3, ALL-4, ALL-5, ALL-14, LNX-1, LNX-2, LNX-3, LNX-6, LNX-9, then the first two checks in the section for your desktop (GNOME, KDE Plasma, Hyprland, Sway, niri or river); on stock GNOME, GNOME-2 first |

On a GNOME without a tray extension, run GNOME-2 before anything else in this list. ALL-4 needs a tray icon, so run it only after you install an extension, or skip it (see "Check for a tray icon").

## Before you start

### Get the build

The call for testers names the exact version and tag. Builds are on the [Releases page](https://github.com/Robertg761/HA-Desktop-Widget/releases). A release candidate or a numbered beta (`4.0.0-beta.N`) is marked as a pre-release. GitHub may replace the spaces in a file name with dots.

| System  | File                                                                                                          | In-app updates | Notes                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | `HA Desktop Widget-<version>-win-x64-Setup.exe`                                                               | Yes            | Installs for your user and adds Desktop and Start menu shortcuts.                                                                                                                                         |
| Windows | `HA Desktop Widget-<version>-win-x64-Portable.exe`                                                            | No             | Needs no install. The easiest way to run with a throwaway profile.                                                                                                                                        |
| macOS   | The universal `.dmg` (or the `.zip`)                                                                          | No             | One build for Intel and Apple silicon, macOS 12 or later. It is not Developer ID signed: Control-click the app and choose Open the first time, or use System Settings > Privacy & Security > Open Anyway. |
| Linux   | `HA Desktop Widget-<version>-linux-x64.AppImage`                                                              | Yes            | Make it executable (`chmod +x`). On Ubuntu 24.04 it may also need `libfuse2t64`; see the Ubuntu section.                                                                                                  |
| Linux   | `HA Desktop Widget-<version>-linux-x64.deb`                                                                   | No             | Debian, Ubuntu and derivatives. The command is `home-assistant-widget`.                                                                                                                                   |
| Arch    | Built from the tagged source with `npm run dist:arch` and `makepkg --nodeps` ([Omarchy guide](../omarchy.md)) | No (pacman)    | The Arch bundle is only published for stable releases. Omarchy testers can use the AppImage for a pre-release.                                                                                            |

### Note your machine

Put this at the top of your report. Use whatever tool you have; the commands are examples.

- Operating system and exact version or build: Windows `winver`; macOS Apple menu > About This Mac; Linux `cat /etc/os-release`.
- Linux only: desktop and session (`echo "$XDG_CURRENT_DESKTOP $XDG_SESSION_TYPE"`), and whether the widget runs through XWayland or natively on Wayland.
- Display scale of every monitor, and how many monitors you have. Windows Settings > System > Display; macOS System Settings > Displays; Linux your display settings (`hyprctl monitors` on Hyprland).
- GPU and driver. Windows Task Manager > Performance; macOS About This Mac; Linux `lspci | grep -i vga`. Say if it is a virtual machine or a remote session.
- OS theme (light or dark), OS language, input methods installed, and any accessibility settings that are on.
- Package type from the table above, and the app version (Settings > Advanced > Application updates > Version).
- Settings > General > Connection diagnostics > Copy report gives the app version, Home Assistant version and connection history without URLs or names. Paste it into your report. Check that its OS line matches the operating system you noted (see ALL-14).

### Use a throwaway profile

The app keeps its settings and credentials in one folder per user. Test with separate folders so your real widget, pins and sync file are not touched. Start the app with `--user-data-dir=<an empty folder>`:

- Windows (Portable build, from a terminal): `"HA Desktop Widget-<version>-win-x64-Portable.exe" --user-data-dir=C:\hadw-test`
- macOS: `open -n -a "HA Desktop Widget" --args --user-data-dir=/tmp/hadw-test`
- Linux AppImage: `./"HA Desktop Widget-<version>-linux-x64.AppImage" --user-data-dir=$HOME/hadw-test`; installed `.deb`: `home-assistant-widget --user-data-dir=$HOME/hadw-test`; Arch: `ha-desktop-widget --user-data-dir=$HOME/hadw-test`

Use one main test folder for most checks (`hadw-test` in the examples above). A few checks need a folder that earlier checks have not touched. Start each of those in a new empty folder and delete it afterwards:

- ALL-1 and HYP-1 need a profile that has never been started, so that the welcome screen appears. ALL-1 runs twice (OS light theme, then dark), each time in a new empty folder. They only need the welcome screen, so you do not have to connect these folders to Home Assistant.
- WIN10-1 and LNX-8 need the default appearance settings, which earlier checks change. Connect the new folder to Home Assistant, add a few tiles and leave the appearance settings alone.

ALL-15 damages `config.json` on purpose, so it uses a copy of your main folder.

The settings file is `config.json` in that folder. Start at login and some update checks do not work in a throwaway profile; the checks that need your real profile say so. Before you use your real profile with a 4.0 build, back it up as described in [Upgrading to 4.0](../MIGRATION.md): the folders are `%APPDATA%\home-assistant-widget` on Windows, `~/Library/Application Support/home-assistant-widget` on macOS and `~/.config/home-assistant-widget` on Linux (or `$XDG_CONFIG_HOME/home-assistant-widget` when `XDG_CONFIG_HOME` is set).

When you finish, delete the throwaway folders. In Home Assistant, open your profile > Security and delete the refresh tokens the test profiles created.

### Set up Home Assistant

Use your own Home Assistant, or a test instance. Do this in your main test folder. The first-run checks use their own empty folders, so this connection does not get in their way. Connect from Settings > General with the browser authorization, then add these to Quick Access if you have them (the + button, Manage Quick Access):

- a dimmable light and a switch you do not mind toggling, and a scene
- a numeric sensor, ideally one that updates every second or two
- a climate entity (a Fahrenheit setup is needed for HA-1), a fan or cover, and a media player
- a camera (CAM checks), and a person, a button or input_button that has never been used
- a Home Assistant helper such as an `input_boolean` you can delete (HYP-12)

Pin a few of them to the desktop where a check asks for pins.

### Check for a tray icon

Several checks use the tray icon (the menu-bar item on macOS). Windows, macOS, KDE Plasma and Ubuntu have one. On Hyprland, Sway, niri and river it comes from your bar (the Omarchy bar or Waybar). Stock GNOME (Fedora Workstation, Debian) has none unless you install an AppIndicator extension, and a bare window manager may have none either.

- Stock GNOME: run GNOME-2 before the shared checks. It tests the desktop as it is, with no tray, so it has to come before you install an extension. Then install an AppIndicator extension, restart the app and run the rest of the plan, ALL-4 included. If you would rather not install one, skip every step that uses the tray, including ALL-4, and say so in your report. GNOME-2 still counts.
- Any other desktop with no tray icon: skip every step that uses the tray, including ALL-4, and say so in your report.

### Report your results

A short report is better than a long one. You can post it where the call for testers asked, or open an issue on the [Issues page](https://github.com/Robertg761/HA-Desktop-Widget/issues) titled "Platform test: <system> <version>". Put your machine notes first, then one line per check you ran:

```
Machine: Windows 11 23H2 (build 22631), two monitors (150% and 100%), dark OS theme, English
Build: 4.0.0-beta.N, Setup installer from the Releases page
Diagnostics report: <pasted from Copy report>

WIN11-5 pass
WIN11-6 fail: the widget flashed a gray rectangle for about a second at sign-in
MAC-3 skipped: no second Space available
```

For a failure, add: what you did, what you saw, what you expected from the check, and the evidence the check asks for. Screenshots and screen recordings are welcome (Windows Win+Shift+S or Win+G, macOS Shift+Cmd+5, GNOME Ctrl+Alt+Shift+R for a recording). For flashes and animations, a phone video of the screen is fine.

Screenshots and logs can show your Home Assistant address, entity names, and in rare cases tokens. Crop or blur them. To attach the log, use Settings > Advanced > Show log file, which shows the log file in your file manager. Read it before you attach it.

The `Ref:` line at the end of each check lists cluster ids from the maintainers' private audit of 4.0, which is not published, so you cannot look them up. You can ignore them; the developers use them to map your result back to the audit.

## Shared checks (ALL)

Run these on every machine. Where a step is specific to one system, it says so.

### ALL-1 First launch on an empty profile

1. Start the app with a new empty profile folder, not your main test folder (see "Use a throwaway profile"). Watch the screen from the moment you start it. A phone video in slow motion helps.
2. Note what the window looks like for the first two seconds, then when the welcome screen appears.
3. Do steps 1 and 2 twice: once with the OS in the light theme and once in the dark theme (Settings > Appearance > Mode stays on Auto). Use a new empty folder each time, because a second start in the same folder is no longer a first launch.
4. Look at the welcome heading, and at any buttons under it.
5. Press Next, type your Home Assistant address, press Next again, then Connect. Leave the approval page in the browser alone for ten seconds and look at the buttons and the line of text in the widget. If no browser opened (a minimal Linux install, say), note that. Press Cancel, then Connect again.

Expected: The window appears once and is already in its final theme. There is no empty glass slab and no dark panel that turns light. The welcome heading has no box or ring around it, every button has space around it, and the reassurance text about security is not the loudest text on the screen. The welcome step has no Back button. While the widget waits for the browser, the Back button reads Cancel, and after a few seconds the text says it is waiting for you to approve in the browser and what to do if it did not open. Cancel stops the wait and stays on the same step, and Connect opens the browser again.

Capture: A recording or a sequence of screenshots covering the first seconds, the OS theme, and the display scale.

Ref: MP-17, RO1-16, RO1-32

### ALL-2 Start hidden

1. Quit the app. Start it again with `--hide` added to the command from "Use a throwaway profile". The flag works the same way on every system.
2. Watch the screen for five seconds. Note whether anything flashes, even for a moment, and whether keyboard focus leaves the window you were using.
3. Open the tray menu (the menu bar item on macOS) and choose Show/Hide. This needs a tray icon; without one, skip this step.

Expected: Nothing appears on screen and focus stays where it was. A brief flash of the window before it hides counts as a failure; say how long it lasted. If you have a tray, its icon appears and Show/Hide shows the widget normally.

Capture: A recording of the screen and a note of what lost focus.

Ref: MP-17

### ALL-3 Moving, resizing and closing the widget

In desktop-layer mode (Hyprland, Sway, niri, river) skip steps 2 to 4; the Hyprland and Sway sections cover moving there. Sway, niri and river cannot move the widget by dragging, so on them only click the buttons in step 1.

1. Drag the widget by the top edge and the bottom edge of its header (the strip with the title, the connection dot and the buttons) and by the strip to the left of the title. Then click Settings, Minimize and, if it is shown, the notification bell once each. Open Settings in a short window so the dialog reaches the top edge, and click everything in its title row.
2. Double-click the header.
3. Drag the widget against a screen edge so the system tries to snap or tile it (Windows: drag to the top or a side; GNOME and KDE: drag to an edge, or press Super or Meta + Up). Quit from the tray (this needs a tray icon) and start the app again.
4. Drag a window corner inward as far as it goes, then far past the header.
5. Close the widget three ways: the X at the right end of the header; Alt+F4 (Windows, Linux) or Cmd+W (macOS); the Minimize button. After each, bring it back from the tray, the menu bar or the popup hotkey. Each time, note whether the app is still running and what the X's tooltip says.

Expected: The whole header strip moves the window and its buttons still click, and every control of a dialog that reaches the strip clicks too, instead of the click being taken as the start of a window drag. Double-clicking or snapping does not turn the widget into a maximized or full-screen slab, and after a restart it has the size you chose. The window stops shrinking at a size where Settings, Minimize and the X are still visible. The X, Alt+F4 and Cmd+W all hide the widget to the tray: the app keeps running and its hotkeys keep working, and the X's tooltip says Hide. Quit in the tray menu ends the app. After the X, Alt+F4 or Minimize there is always a visible way back (on a desktop without a tray, see GNOME-2).

Capture: A recording of steps 1, 3 and 4, and the widget size before and after restart.

Ref: CSSA1-16, MP-18, MP-39, RO2-41, MP-41, MP-76

### ALL-4 Tray or menu-bar menu

Needs: A tray icon. Stock GNOME has none until you install an AppIndicator extension: run GNOME-2 first and then install one, or skip this check and say so in your report (see "Check for a tray icon").

On a desktop layer (Hyprland, Sway, niri, river) Always on Top is greyed out and unchecked, because a layer cannot be kept on top, so skip that entry. There a left-click raises the widget above your windows and the next click lowers it, instead of hiding it, and Reset Position returns it to the default corner (HYP-2 on Hyprland, where you can drag the widget away first; SWAY-4 for the Sway, niri and river menu entry).

1. Find the app's icon: Windows may hide it under the ^ overflow; macOS shows it in the menu bar; on Linux it appears on your bar's tray (GNOME needs an AppIndicator extension).
2. Hover for the tooltip. Open the menu (right-click; on macOS, click).
3. Use each entry: Show/Hide, Always on Top, Reset Position, Open Settings, Check for Updates, Report Issue. Leave Quit for last. DevTools and Reload are for developers.
4. Windows and Linux: left-click the icon once.

Expected: The tooltip names the app. Show/Hide shows or hides the widget. Always on Top toggles and its check mark follows the setting (not on a desktop layer; see the note above). Reset Position puts the widget fully on a connected screen, 100 px in from the main screen's top-left corner, at the size you gave it (smaller only if the screen cannot hold it). Open Settings brings the widget forward with Settings open. Check for Updates gives an answer you can see (see UPD-1). Quit ends the app and leaves no process running. A left-click toggles the widget (on a desktop layer it raises or lowers it).

Capture: A screenshot of the menu and tooltip, and the position and size after Reset Position.

Ref: MP-19, MP-22, MP-53

### ALL-5 Desktop pins

[Desktop pin QA](../DESKTOP_PIN_QA.md) has the full pin checklist. This check covers the platform-dependent parts.

Pins cannot be dragged on Sway, niri and river. On them, skip the dragging in step 4 (resizing still applies) and the parts of the expected result about snapping and saved positions; SWAY-1 covers where pins sit there.

1. Right-click a Quick Access tile and choose Pin to Desktop (or use the pin button on a tile while Reorganize Quick Access is on). Pin a light, a sensor and a scene, then pin four more.
2. Unpin the second pin, then pin another tile.
3. With Reorganize off, click the top-left corner of a pin (the bulb on a light pin). Then try to move a pin with the system's window-move gesture: hold Alt or Super and drag on Linux, or drag its title area.
4. Open Reorganize Quick Access. Drag a pin (not on Sway, niri or river), then resize it from each corner. Look for a lighter square at the pin's corners. If you have a dashboard with 30 or more tiles, note any stutter when you turn Reorganize on and off. Exit Reorganize.
5. In Settings, set Text and control size to 115%, then to 150%. At each size, open Reorganize Quick Access and drag the corner of one pin outwards and inwards, from the bottom-right corner and from the top-left one. Exit Reorganize.
6. Zoom into a pin's rounded corner at 100% display scale. Watch a new pin appear for a flash of a different background.
7. Quit the app and start it again.

Expected: Every new pin appears in its own free spot, not on top of another pin or on the widget. A click in the top-left corner of a pin works like a click anywhere on its control. Outside Reorganize, a pin cannot be moved: it does not stay where a window-move gesture or a drag put it. Where pins can be dragged (everywhere except Sway, niri and river), a pin dropped across a screen edge in Reorganize snaps to a fully visible position right away, and the same position is there after restart. Pin corners are smooth, with no stair steps, and no square or lighter patch at the corners. A pin opens without a flash. At 115% and 150% the corner you hold stays under the pointer while you resize, and the opposite corner does not move. Size is kept after the restart, and so is position wherever pins can be dragged.

Capture: A screenshot of the pins, a zoomed crop of one corner, and for any pin that moves, a recording.

Ref: MP-34, CSSA1-25, CSSA1-19, MP-37, MP-74, MP-75, CSSB2-42

### ALL-6 Hide on focus loss while arranging pins

Layer-mode desktops (Hyprland, Sway, niri, river) do not hide on focus loss; skip this check there.

1. Settings > General > Window & behavior: turn on Hide to tray when focus is lost (Hide to menu bar when focus is lost on macOS). Read its help text. Save and close.
2. Pin a tile and turn on Reorganize Quick Access. Click and drag the pin.
3. Press Escape.
4. In Settings > General, start a new browser authorization with Connect, switch to the browser, approve, and return.

Expected: The widget stays open while you work on its pins in Reorganize, and Escape ends Reorganize so the pins return to normal. After you approve in the browser the widget is visible and shows the connection result; it did not vanish while you were away. The help text under Hide to tray when focus is lost does not talk about a Linux desktop-layer mode on Windows or macOS.

Capture: A recording of steps 2 to 4 and the help text you read.

Ref: MP-09, MP-46, SM1-12

### ALL-7 Light theme

1. Set the OS to the light theme and Settings > Appearance > Mode to Auto (or choose Light).
2. In Settings > General (throwaway profile), try to connect with a wrong address, then the right one. Read the status text under the address field. In Settings > Advanced > Application updates, press Check for updates and read the status line.
3. Look at the connection dot in the header connected and disconnected (turn off Wi-Fi or stop Home Assistant for the second).
4. Open a light's controls (long-press the tile or use its Controls button). Move brightness to its minimum. Open a fan, cover and climate popup too.
5. Settings > Appearance > Colors: choose Background color in Edit colors for, then pick a background preset other than the default. Do this once with Frosted glass background on and once off.
6. Look at the weather card's condition text ("Cloudy").
7. With Mode on Auto, switch the OS theme between light and dark while the widget is running.

Expected: All status and error text is dark enough to read at a glance on the light panel. The connection dot is easy to see and clearly different when disconnected. Slider tracks in the popups are visible from their minimum end. A background preset visibly changes the window in the light theme, whether Frosted glass is on or off. The condition text is legible. Switching the OS theme updates the whole window at once, with no leftover tint and without saving or restarting.

Capture: A screenshot of each point that is hard to read, with the OS theme and display scale.

Ref: CSSA1-01, CSSB2-03, CSSC2-07, CSSA1-41, CSSA2-21, CSSA3-15, CSSA3-17, CSSA1-05, RO3-03, RO2-53

### ALL-8 Window opacity over different wallpapers

1. Settings > Appearance > Window effects. Set Window opacity to 100, then to 60. Do this with Frosted glass background on and off, in the light and the dark theme. On Linux, crossing 100 may ask you to restart the app; accept (see LNX-3).
2. Put the widget over a dark wallpaper and over a bright one (a white web page behind it is enough; on a desktop layer, where windows cover the widget, use a bright wallpaper instead).
3. Read the title, the Settings, Minimize and X buttons, the tile names, and secondary text such as the state lines.
4. Open Settings over the dashboard and look for a faint copy of the dashboard text behind the Settings headings and labels.

Expected: Opacity changes how see-through the panels are, in even steps. At 60, the header buttons, the title and secondary text stay readable over both wallpapers in both themes. With Frosted glass off, the slider does not feel twice as steep as with it on. The Settings panel shows no ghost of the dashboard text behind it.

Capture: A screenshot for each wallpaper and theme at 60, and your GPU and whether blur is available on your system.

Ref: CSSA2-27, RO3-16, CSSA1-35, CSSA1-34, CSSB1-19

### ALL-9 Settings look-over

Open each Settings page at the default window size. Note anything that looks wrong or inconsistent.

- General: open Offline language packs and Legacy access token (advanced). The language pack names are not larger than their section heading. Every expandable row uses the same chevron. Open a dropdown such as Language: the highlight uses the accent color and matches the other dropdowns.
- Appearance: the Holidays list reads as a titled list, and the Reset buttons look alike. With Holiday colors on, the switches, the focus ring and the Save and close button use one accent color.
- Advanced > Profile syncing with encryption on: spacing between the Sync passphrase label and its input is even, with no stray gap below. Switches sit level with their row title, or are clearly attached to long help text.
- Manage Quick Access (the + button): the Add and Remove buttons line up with the same width, in English and in German.
- Search settings: type "a" and scroll the results. The search box and result count stay visible or are easy to get back to, and Tab does not hide a result under the header.
- Scroll a long Settings page: the scrollbar thumb is easy to see and to grab.
- The header at 100% display scale: the Settings, Minimize and X glyphs look equally strong. The weather card's wind icon shows separate strokes, not a blob.
- Page tabs, the Add page button, preset chips and the climate, fan and cover buttons use the same typeface as the text around them.
- Add a person, a button, an input_button and a binary sensor: their icons are distinct and make sense.
- Set Text size to 150% and open Settings: it fills the window edge to edge, with no band of the dashboard around it. Back at 100%, scroll the main window with more tiles than fit, then switch to a short page: the tiles do not shift sideways.

Expected: As listed. These are polish items; report each difference you see.

Capture: One screenshot per page, with the OS and display scale.

Ref: CSSB2-40, CSSB1-46, SM1-38, SM1-47, SM1-40, CSSC2-41, CSSC2-40, CSSC2-30, CSSB1-24, CSSB2-14, CSSC2-18, CSSB1-27, SM1-22, CSSA3-16, SM1-13, CSSA1-06, CSSA2-11, RO1-51

### ALL-10 Custom color editor and saving settings

Needs: A touch screen for the last step, if you have one.

1. Settings > Appearance > Colors: open Custom color and click into a color field to start editing.
2. Read the note about the Save and close button.
3. Without leaving the field, click Save and close at a normal speed. Then do it again as fast as you can. On a touch screen, tap Save and close.
4. Edit the color again. Press Save custom color. Edit it once more and click outside the fields instead.

Expected: The note is in plain words: it says how to keep the color (Save custom color) and how to go back, and it does not mention a "Main Save". One normal click or tap on Save and close works the first time. Leaving with an unsaved draft asks what to do ("Unsaved custom color changes").

Capture: The note's text and a recording of a click that did not work.

Ref: SM1-23, SM2-21

### ALL-11 Export with unsaved edits

1. Settings > Appearance: change the accent color but do not press Save and close.
2. Settings > Advanced > Settings files: choose Export settings and save the file.
3. Open the file in a text editor and find the accent.

Expected: Either the file contains the new accent, or the app tells you at or before export that unsaved changes are not included. A plain success message that hides the omission is a failure.

Capture: The message you saw and the accent value in the file.

Ref: SM2-26

### ALL-12 Weather card and effects

1. Settings > Appearance > Window effects: turn on Frosted glass background and Subtle weather effects. Use Weather effect override to pick Sunny, Cloudy, Rainy, Snowy and Stormy in turn.
2. Look at the weather card icon and the background effect for each, in the dark and the light theme. If you have a display at 125% scale or more (or a Retina Mac), use it.

3. Turn on the OS setting that reduces motion (Windows: animation effects off; macOS: Reduce motion; a Linux desktop: animations off), restart the widget and pick Rainy, Snowy and Stormy again.

Expected: The sun, cloud and rain icons look about the same size and sit centered in the card. Rain, snow, clouds and sun are crisp, not soft, on a high-DPI display, and stay crisp after you drag the widget to a screen with another scale. The effects stay visible in the light theme; snow does not disappear. With reduced motion, rain, snow and storms show a still scatter of drops or flakes, not an empty window.

Capture: A screenshot of each condition in both themes, and the display scale.

Ref: RO1-53, RO3-19, RO3-20, RO3-21

### ALL-13 Icon picker

Most useful on Windows 10, older macOS versions, and Linux without a recent emoji font.

1. Settings > Dashboard > Custom entity icons: open Edit entity icons, and in one row press Search to open the icon grid. Look at the first screen of icons and scroll a little.
2. Choose a recent emoji (for example a family emoji or a newer Unicode emoji) for a tile and click Apply. Look at the tile and, if pinned, the pin.

Expected: The first icons shown are the useful ones for a home, not punctuation or skin-tone variants of one emoji. Every icon is drawn as a picture, with no empty boxes. Emoji your system cannot draw are not offered, or are marked.

Capture: A screenshot showing any empty boxes and your OS version.

Ref: SM2-39

### ALL-14 Connection diagnostics report

1. Leave the widget connected for a few minutes without any drop.
2. Settings > General > Connection diagnostics > Copy report. Paste it into your report.

Expected: The OS line is a name you recognize, for example the Windows or macOS version, not only a kernel number. The reconnect count is 0 after a session that never dropped.

Capture: The pasted report and the real OS version.

Ref: RO2-50

### ALL-15 Damaged settings values

Use a copy of your main test folder, never your real profile. This check damages `config.json` on purpose, and later checks need the pins from ALL-5.

1. Quit the app and copy the main test folder to a new folder. In the copy, open `config.json` in a text editor. Set `"windowSize": null` and set `"desktopPins": { "light.test": null }`, replacing any `desktopPins` value that is already there. Keep the file valid JSON and save it.
2. Start the app with `--user-data-dir` pointing at the copy.
3. Quit from the tray (this needs a tray icon) and check that no process is left.

Expected: The widget starts at its default size, without pin errors, and Settings saves normally. No invisible process is left behind.

Capture: The log (Settings > Advanced > Show log file) and what you saw on screen.

Ref: MP-35

## Windows 11 (WIN11)

Windows 11 22H2 or later (build 22621 or higher). Use the Setup installer for WIN11-1 and WIN11-6, and the Portable build for the throwaway profile.

### WIN11-1 Install, shortcuts and names

1. If you have a 3.x install, pin it to the taskbar first. Install the Setup build over it; otherwise use a clean machine or user.
2. Look at the Desktop shortcut, the Start menu entry, the entry in Settings > Apps > Installed apps, the tray tooltip and the welcome heading.
3. Look at the app icon on the Desktop, the Start menu and, while the app runs, the tray.
4. If you pinned 3.x, click the taskbar pin.

Expected: One name everywhere: "HA Desktop Widget". After an upgrade from 3.x there is no second shortcut with the old name (the installer renames or replaces the old Desktop and Start menu shortcuts), and the taskbar pin still starts the app. The icon looks like a finished app icon, not a hard-edged black square.

Must test on a real 3.11 install, not a clean machine: upgrade a 3.11 install that has a taskbar icon pinned and Desktop and Start menu shortcuts to 4.0, then check that both shortcuts are now named "HA Desktop Widget", the taskbar pin still launches the app, no duplicate shortcut appears on the Desktop or in the Start menu, and a Windows notification (see WIN11-10) shows "HA Desktop Widget" as the app name.

Capture: A screenshot of each place the name appears.

Ref: MP-53, MP-52, MP-25

### WIN11-2 Frosted glass

1. Settings > Appearance > Window effects: turn on Frosted glass background. Put the widget over a busy wallpaper and over a white window.
2. In Windows Settings > Personalization > Colors, turn Transparency effects off, look again, then turn it back on.
3. Turn Frosted glass background off in the app and look again.
4. Turn Frosted glass background on or off in the app without pressing Save and close. Alt+Tab to another app and back. Then Save and close or Cancel.

Expected: With Frosted glass and Transparency effects on, what is behind the widget is blurred and its text is easy to read over both backgrounds. With Transparency effects off, or Frosted glass off, the widget is still readable. An unsaved preview stays on screen after Alt+Tab; it does not snap back to the saved look until you Save and close or Cancel.

Capture: A screenshot over each background, and the Windows build number.

Ref: RO3-02, MP-38

### WIN11-3 Window edge and corners

The main window looks one of two ways. With Frosted glass background on, and Transparency effects on in Windows, Windows draws acrylic behind it. With Frosted glass background off, the widget draws its own solid panel, as it always does on Windows 10. The project's automated Windows screenshots come from machines without a GPU, which never draw acrylic. Only a real machine shows how Windows itself draws the window's corners and edge, with acrylic or without.

1. Put the widget over a dark wallpaper and then a bright one, with Frosted glass background on and then off.
2. Take a screenshot of each and zoom in on a corner and along the edges.
3. Compare with a pinned tile, which has rounded corners, and with an ordinary app window.

Expected: With Frosted glass background off, the widget gives the solid panel no rounded corners, border or shadow of its own; its edge is where the panel meets the wallpaper. That is the intended look for 4.0, not a failure, whether or not Windows rounds the window itself. With acrylic, the blurred window's edge is visible against both wallpapers. For each look, report whether the corners are square or rounded, whether Windows adds a border or shadow, and where the edge is hard to make out against the wallpaper. A later release uses these reports to decide whether the panel needs an edge.

Capture: Zoomed screenshots of a corner over each wallpaper, each labeled with Frosted glass on or off, and the Windows build number.

Ref: MP-28

### WIN11-4 Text weight

1. View the main window at 100% and at 150% display scale, in both themes.
2. Search the Start menu for "Adjust ClearType text" and note whether ClearType is on.
3. If you can, compare the same dashboard on a Mac or Linux machine.

Expected: Headings, tile names, state lines and captions are clearly different weights. Light text on a dark background does not look noticeably heavier than on macOS or Linux. This is subjective; describe what you see.

Capture: Screenshots at 100% and 150%, and the ClearType setting.

Ref: CSSA1-44

### WIN11-5 Tray icon

1. Make the icon always visible: Settings > Personalization > Taskbar > Other system tray icons.
2. At 100%, 125%, 150% and 200% display scale, zoom in on the icon.
3. With the widget hidden, double-click the icon quickly. Then single-click it once.

Expected: The icon is crisp at each scale and still recognizable. A single click toggles the widget. After a double-click from the hidden state the widget is visible and stays visible; it does not open and then hide again within a moment.

Capture: A zoomed screenshot at each scale, and a recording of the double-click.

Ref: MP-26, MP-45

### WIN11-6 Start at login

Use your real profile; Start at login does not work in a throwaway profile.

1. Settings > General > Window & behavior: turn on Start at login and Save and close. Sign out and back in.
2. While Windows starts, type in another app and watch for the widget.
3. Look at the entry in Windows Settings > Apps > Startup.

Expected: The widget starts without taking focus from what you are typing in and without a flash of an empty rectangle. The tray icon appears. The Startup entry is named after the app.

Capture: A recording of the first seconds after sign-in and the Startup entry's name.

Ref: MP-17, MP-52

### WIN11-7 Touch and pen

Needs: A touch screen or a pen.

1. Open Reorganize Quick Access and drag a tile with a finger or the pen.
2. Turn Windows Animation effects off (Settings > Accessibility > Visual effects) and drag again.
3. With only the touch screen (no mouse or trackpad in use), look at the buttons in a dialog, a dialog's close button and the Settings, Minimize and X buttons in the title bar.

Expected: The dragged tile follows the finger or pen with no lag, with animation effects on and off, and lands where you drop it. Buttons and close buttons are about 44px square, big enough to hit with a finger, and so are the title bar's. The title bar is taller to hold them, and the tiles below it scroll inside the window instead of being cut off at the bottom.

Capture: A recording of the drag and the animation setting.

Ref: CSSB2-23, CSSC1-42

### WIN11-8 Popup hotkey and recorder

1. Settings > Hotkeys > Popup hotkey: choose Set hotkey and press Ctrl+Space. Repeat with Ctrl+Shift+Space, Alt+Space and Ctrl+Up.
2. Try Shift+A, then Ctrl+C and Ctrl+V.
3. With a hotkey set, hold it while another app is focused. Then turn on Press to toggle and press it once, then again.
4. Press Win+Shift+A in the recorder and note how it names the Windows key. If Windows handles the combination itself and nothing is recorded, say so and try another letter.

Expected: Space, arrow keys and similar keys record as you pressed them. A combination with only Shift is refused with a clear message, and so are the common editing shortcuts. The Windows key is recorded as Win or Super, not Command. Holding the hotkey shows the widget in front and releasing it sends it back; with Press to toggle, the first press shows it and the second hides it.

Capture: The message or recorded text for each refused or odd key, and a recording of the hold and toggle behavior.

Ref: SM3-05, RO2-61, MP-49

### WIN11-9 Folder picker

1. Keep Always on top on. Settings > Advanced > Profile syncing: turn on Profile sync and choose Choose folder...

Expected: The folder dialog opens in front of the widget and Settings is blocked until you close it. It cannot end up hidden behind the widget.

Capture: A screenshot or recording of where the dialog appears.

Ref: MP-73

### WIN11-10 Notifications

1. Settings > Alerts: turn on Entity alerts and set up an alert for a switch you can toggle. Toggle it from Home Assistant.
2. Read the app name at the top of the Windows notification.

Expected: The notification names the app "HA Desktop Widget".

Capture: A screenshot of the notification.

Ref: MP-52, MP-53

### WIN11-11 Tray value icons (beta builds only)

Needs: A beta build; stable builds do not show live tray values.

1. Right-click a sensor tile and choose Show in Tray (Beta).
2. Set the Windows taskbar to dark (Settings > Personalization > Colors > Choose your mode) and the app's Mode to Light. Then the other way round.
3. Hover the tray icon and read its tooltip.

Expected: The value icon stays readable on the taskbar in both combinations, and does not repaint when only the app's theme changes. The tooltip reads like a label ("On"), not a raw lowercase state.

Capture: A zoomed screenshot of the taskbar in each combination.

Ref: RO3-24, MP-83

### WIN11-12 Installed build: language, edit menu and hotkey

Run this on the Setup or Portable build from the Releases page, not a build from source. 4.0 leaves files out of the package that earlier versions shipped, and this check is how a missing one would show. Keep Settings > General > Language on Auto (system default).

1. In Windows Settings > Time & language > Language & region, add Español (México) under Preferred languages and move it to the top. Quit the app from the tray and start it again. If the next step still names your old language, sign out and back in.
2. Open Settings > General > Language & localization and read the line about the system language. Under Offline language packs, download Spanish.
3. Right-click the Search settings field at the top of Settings, once while it is empty and once with a word typed in it.
4. Close Settings and turn on Reorganize Quick Access. Click the pencil on a tile, add the words `Kitchn lihgt` at the end of Display name and right-click `lihgt`. Then press Cancel.
5. Settings > Hotkeys > Popup hotkey: set a hotkey, then hold it while another app is in front.
6. Do steps 1 to 3 again with Chinese (Traditional, Taiwan) at the top of the list and the Chinese pack. When you finish, put your own language back at the top.

Expected: The app starts with its window and tray icon. The line names Spanish (Mexico), and once the pack is downloaded the whole app is in Spanish without picking it in Language. The app draws the right-click menu from the same pack, so it is in Spanish too: Deshacer, Rehacer, Cortar, Copiar, Pegar, Eliminar, Seleccionar todo. Spell-check is off on purpose: no word in Display name or the search field has a red underline, and right-clicking `lihgt` opens the same edit menu, with no spelling suggestions and no Add to dictionary (Añadir al diccionario). With Chinese (Taiwan) the line names it, and the app and the menu are in Chinese (撤销, 剪切, 复制, 粘贴, 全选). The Chinese pack is written in simplified characters, so Taiwan gets those too. Holding the hotkey brings the widget to the front and releasing it sends it back. The log (Settings > Advanced > Show log file) has the line "uiohook-napi loaded successfully" near the start.

Capture: A screenshot of the language line and of the right-click menu in each language. If a word is underlined or a menu offers spellings, a screenshot of it. If the hotkey does nothing, the log lines that mention uiohook-napi.

Ref: MP-78

## Windows 10 (WIN10)

Windows 10 22H2 (build 19045) is the last version. Windows 11 21H2 and sessions without acrylic (remote desktop, some virtual machines) behave the same way, so run this section there too.

### WIN10-1 Glass without acrylic

Windows 10 and Windows 11 21H2 cannot draw the Windows 11 blur. On them the widget is meant to draw the same solid panel that Frosted glass background off draws, not an unblurred tint.

1. Use a new empty profile folder with the default settings (see "Use a throwaway profile"). Put the widget over four backgrounds and take a screenshot of each: a busy photo with the dark theme; a bright photo with the dark theme; a dark wallpaper with the dark theme; a bright photo with the light theme.
2. Turn Frosted glass background off in Settings > Appearance > Window effects and repeat the first one.

Expected: With the default settings, text and icons are readable over all four backgrounds, and the widget looks the same as it does with Frosted glass background off. It does not look like a faint dark tint over a sharp desktop. If readability needs Frosted glass off, that counts as a failure of the default even though the switch fixes it.

Capture: The four screenshots and the Windows build number.

Ref: RO3-02

### WIN10-2 Other checks on Windows 10

Run these on Windows 10 too: WIN11-12 (installed build, language and hotkey), WIN11-1 (names, shortcuts and icon), WIN11-3 (window edge: Windows 10 always draws the solid panel, whose square corners and lack of a border are intended for 4.0, so the question is where its edge is hard to see), WIN11-5 (tray icon at each scale), WIN11-6 (start at login), WIN11-8 (hotkey recorder), WIN11-9 (folder picker) and WIN11-10 (notifications). Also run ALL-13 (icons): Windows 10's emoji font is older than Windows 11's. For high contrast, see A11Y-1; Windows 10 has its own settings page for it.

Ref: SM2-39

## macOS (MAC)

macOS 12 or later. The build is universal. If you have both an Apple silicon and an Intel Mac, run MAC-1 to MAC-5 on both. A non-Retina external display is useful for the 100% scale checks in ALL-9 and ALL-12.

### MAC-1 First launch, Dock and icon

1. Open the `.dmg`, drag the app to Applications and Control-click > Open. Look at the DMG window, Finder and Launchpad.
2. Quit from the menu-bar item and open the app from Launchpad a few times. Watch the Dock.
3. Press Cmd+Tab.
4. Optional, in Terminal: `plutil -p "/Applications/HA Desktop Widget.app/Contents/Info.plist" | grep -E 'LSUIElement|LSApplicationCategoryType'`

Expected: The app never puts an icon in the Dock, not even briefly or with a bounce, at launch or at login. Its icon in Finder, Launchpad and the DMG window looks like other Mac app icons (a rounded shape with a margin), not a hard-edged black square. The category is not developer tools.

Capture: A screenshot of Launchpad and Finder, a recording of the Dock at launch, and the `plutil` output.

Ref: MP-56, MP-25

### MAC-2 Menu-bar icon

1. Look at the menu-bar icon on a Retina display with a light menu bar (light wallpaper or Light appearance) and then a dark one. Zoom into a screenshot.
2. Click the icon and open its menu.

Expected: The icon is sharp, as tall as the other menu-bar icons, and adapts to the light or dark menu bar. It is not an opaque black square on a light bar, and it highlights when clicked.

Capture: A zoomed screenshot in each appearance.

Ref: MP-16

### MAC-3 Reopen while hidden

1. Hide the widget: press Cmd+W, or use Minimize, or turn on Hide to menu bar when focus is lost and click another app.
2. Open the app from Spotlight (Cmd+Space). Hide it again and open it from Launchpad, then from Finder.

Expected: Every way of opening the app brings the hidden widget back. It does not matter whether you can see the menu-bar icon.

Capture: Which of the three ways did nothing.

Ref: MP-21

### MAC-4 Minimize, Cmd+M and Cmd+W

1. Click the widget's Minimize button. Look at the Dock and Mission Control, then bring the widget back from the menu-bar icon.
2. Click the widget so it has focus and press Cmd+M. Look again, and bring it back.
3. Click the widget and press Cmd+W. Look again, and bring it back.

Expected: Each of the three puts the widget away without leaving a tile in the Dock or a window stuck in Mission Control, the app keeps running, and the menu-bar icon brings the widget back. The app shows no menu bar of its own: it lives in the menu bar, so its menus only supply these keys.

Capture: A screenshot of the Dock and Mission Control after each.

Ref: MP-76

### MAC-5 Accessibility permission for the popup hotkey

1. In System Settings > Privacy & Security > Accessibility, make sure the app is not allowed (remove it).
2. Settings > Hotkeys > Popup hotkey: choose Set hotkey and pick a suggestion.
3. Quit and start the app three times with the permission still off. Count the permission prompts.
4. Allow the app and set the hotkey again. Press it with another app in front.
5. If you can install a newer build over this one, repeat step 4 and note whether the permission is still granted.

Expected: With the permission missing, the app shows a message in the app's language that tells you to allow it under System Settings > Privacy & Security > Accessibility. It does not show a raw English error such as "Failed to enable access for assistive devices". macOS is not prompted on every launch. After you grant it, the hotkey works.

Capture: The message and a count of prompts over three launches.

Ref: MP-20

### MAC-6 Key names and reserved shortcuts

1. Press Cmd+K and then Ctrl+K to open the command palette. Read the tip in the palette.
2. Settings > Hotkeys: use Set hotkey and press Cmd+Option+K, Control+Space, an Option+letter combination, and Control+Up.
3. Under Entity Shortcuts, assign a switch the same combination and compare the names the two recorders use.
4. Try Cmd+C and Cmd+V as hotkeys. If the recorder does not receive them, note that.

Expected: The tip names Cmd+K on macOS. Both recorders show the same names for the same keys (Command, Option, Control, or the symbols). An Option combination records as the key you pressed, not as a composed character, and Space and the arrow keys record. Common editing shortcuts are refused. Two actions cannot hold the same combination under different names, such as Command+K and Super+K.

Capture: A screenshot of what each recorder shows, and whether Cmd+C or Cmd+V was accepted.

Ref: RO2-59, SM3-05, MP-49, SM1-44, SM2-69

### MAC-7 Spaces and full-screen apps

1. Turn on Always on top (Settings > General > Window & behavior). Create a second Space and put the widget in the first.
2. Switch to the second Space (Ctrl+Right).
3. Put another app in full screen and press the popup hotkey.

Expected: With Always on top on, the widget is visible on every Space, or the build offers a setting for that. The popup hotkey and the menu-bar item always bring it to the current Space, over a full-screen app too. Report what you see.

Capture: Which Spaces showed the widget and pins.

Ref: MP-40

### MAC-8 Frosted glass and pins

1. Turn on Frosted glass background over a busy wallpaper, in the light and dark appearance. Then turn on Reduce transparency in System Settings > Accessibility > Display.
2. Pin a tile and watch it appear.

Expected: With Frosted glass on, what is behind the widget is blurred. With Reduce transparency on, the widget is solid enough to read. A new pin opens without a flash of a different background.

Capture: A screenshot in each case and a recording of a pin appearing.

Ref: MP-75

### MAC-9 Folder picker

1. Settings > Advanced > Profile syncing: turn on Profile sync and choose Choose folder...

Expected: The folder dialog opens in front of the widget and attached to it (as a sheet), and the widget cannot be used until it closes.

Capture: A screenshot of the dialog.

Ref: MP-73

### MAC-10 Installed build: language, edit menu and hotkey

Run this on the `.dmg` or `.zip` from the Releases page, not a build from source. 4.0 leaves files out of the package that earlier versions shipped, and this check is how a missing one would show. Keep Settings > General > Language on Auto (system default). If you have an Intel Mac and an Apple silicon Mac, run it on both, because each loads its own copy of the hotkey library.

1. In System Settings > General > Language & Region, add Español (México) under Preferred Languages and drag it to the top. Quit the app from the menu-bar item and open it again.
2. Open Settings > General > Language & localization and read the line about the system language. Under Offline language packs, download Spanish.
3. Right-click the Search settings field at the top of Settings, once while it is empty and once with a word typed in it.
4. Close Settings and turn on Reorganize Quick Access. Click the pencil on a tile, add the words `Kitchn lihgt` at the end of Display name and right-click `lihgt`. Then press Cancel.
5. Settings > Hotkeys > Popup hotkey: set a hotkey, then hold it while another app is in front. The app needs the Accessibility permission for this (see MAC-5).
6. Do steps 1 to 3 again with 繁體中文（台灣）, Chinese Traditional (Taiwan), at the top of the list and the Chinese pack.
7. Put Português (Brasil), a language the app does not have, at the top, quit and reopen the app. Open Settings > Advanced > Export settings, look at the save panel, and cancel it. When you finish, put your own language back at the top.

Expected: The app starts with its menu-bar icon and window. The line names Spanish (Mexico), and once the pack is downloaded the whole app is in Spanish without picking it in Language. The app draws the right-click menu from the same pack, so it is in Spanish too: Deshacer, Rehacer, Cortar, Copiar, Pegar, Eliminar, Seleccionar todo. Spell-check is off on purpose: no word in Display name or the search field has a red underline, and right-clicking `lihgt` opens the same edit menu, with no spelling suggestions and no Add to dictionary (Añadir al diccionario). With Chinese (Taiwan) the line names it, and the app and the menu are in Chinese (撤销, 剪切, 复制, 粘贴, 全选). The Chinese pack is written in simplified characters, so Taiwan gets those too. Holding the hotkey brings the widget to the front and releasing it sends it back. The log (Settings > Advanced > Show log file) has the line "uiohook-napi loaded successfully" near the start.

With Portuguese (Brazil) the app starts and works, in English, and the save panel is in English too. That is expected: the package lists only the app's own languages to macOS, which shows its own panels and message boxes in the first of your languages on that list. 4.0 leaves the other languages' Chromium files out to keep the package small, and listing a language without its file is untested: Chromium picks its own language from the same list and may not cope with one it has no file for. So 4.0 lists only the languages it has files for.

Capture: A screenshot of the language line and of the right-click menu in each language, of the save panel in Portuguese (Brazil), and which kind of Mac you used. If a word is underlined or a menu offers spellings, a screenshot of it. If the hotkey does nothing, the log lines that mention uiohook-napi.

Ref: MP-78

## Linux, every desktop (LNX)

Run these on any Linux desktop, then the section for your desktop. By default the app runs through XWayland on a Wayland session, which keeps its saved position and always-on-top behavior. See [Linux Wayland window behavior](../linux-wayland-notes.md). Note whether you run through XWayland, natively on Wayland (`HA_WIDGET_LINUX_NATIVE_WAYLAND=1`) or on X11.

### LNX-1 Window without blur

1. Settings > Appearance > Window effects: read the help under Frosted glass background.
2. Open the command palette (Ctrl+K) with the clock and tiles behind it. Trigger a toast, for example by saving Settings. Hover a tile and a color swatch to see their tooltips, and hover the comparison graph.
3. Settings > Hotkeys > Popup hotkey > Set hotkey, and watch the dim backdrop appear.

Expected: The help text does not promise a blur your session cannot draw. The palette, toasts, menus and tooltips are readable, with no faint doubled text from what is behind them. The backdrop of the hotkey recorder fades in like other dialogs.

Capture: A screenshot of each panel over text, and your session type and GPU.

Ref: SM1-11, CSSC1-17, CSSC1-18, CSSB1-17, CSSB1-34, CSSB3-18

### LNX-2 Idle CPU use

Run this on a machine with working GPU acceleration, and also, if you can, on a virtual machine or other software-rendered session.

1. Find out how the session renders (for example `glxinfo -B | grep renderer`; "llvmpipe" means software rendering).
2. Turn on Holiday decorations (Settings > Appearance > Seasonal themes; pick a holiday in Holiday to show if it is not October). Leave the dashboard visible and idle for two minutes. Add up the CPU use of all the app's processes in `top`, `htop` or your system monitor.
3. Turn Holiday decorations off, wait two minutes, and read it again. Then play media on the media tile and read it a third time.
4. With decorations on, make the widget show an error or empty state (disconnect from the network) and read the text on it.

Expected: Idle CPU use is low and decorations are not the main cost. For reference, the maintainers measured about 5 to 8% of one core without decorations and about 48 to 51% with them on a session with no GPU, and about 0.1% when the widget was hidden to the tray; 4.0.0 draws the frost under tiles with a cheaper resample (a synthetic scene went from 20.5% to 11.2% of a core against 9.6% for the scene alone), so expect less than that on a software-rendered session. Report your numbers. The error or empty state text is not crossed by decoration shapes. Playing media does not raise CPU use noticeably.

Capture: The three CPU readings, the renderer, and a screenshot of the error state.

Ref: RO2-73, CSSB3-19, RO2-71

### LNX-3 Opacity 100 and the restart prompt

1. Settings > Appearance > Window effects: move Window opacity from below 100 to 100 and Save and close.
2. If a prompt appears, read it and choose Restart now.
3. After the restart, look at the pins' corners and where the widget sits. Then move opacity back below 100 and Save and close once more.

Expected: If a restart is needed, it is asked for in an in-app dialog (not an untitled system box) with buttons that say what they do, and it is visible even when the widget is a desktop layer. After Restart now the app comes back by itself, from an AppImage too. At 100 on Wayland, pins have rounded corners with no square plate behind them, and the widget stays where it was.

Capture: A screenshot of the prompt, the process list after Restart now, and the pins at 100.

Ref: MP-01, SM3-06, MP-08

### LNX-4 Show log file

1. Settings > Advanced > Diagnostics & troubleshooting: press Show log file. If you have a machine with no file manager installed (a bare tiling window manager, say), try it there too.

Expected: A file manager opens on the folder with the log file, and a message gives the file's path. With no file manager, the message says none opened and that the path was copied: paste it somewhere to check. It never does nothing.

Capture: What happened, and whether `xdg-open <profile folder>/logs` opens anything.

Ref: RO1-42

### LNX-5 Popup hotkey help

1. Settings > Hotkeys: read the Global popup trigger text and the switches below it.
2. Set a popup hotkey. On Wayland, approve the shortcut when your desktop asks.

Expected: The text matches how your session catches keys: on X11 it does not say the desktop shortcut service is used. A row that cannot work on Linux (Hide when released) is hidden or says why it is off. Press to toggle works.

Capture: A screenshot of the section and your session type.

Ref: SM3-37, SM1-30

### LNX-6 Names in startup lists and notifications

1. Turn on Start at login in Settings > General (real profile). Open your desktop's startup list (GNOME Tweaks > Startup Applications, or KDE System Settings > Autostart).
2. Set up an alert in Settings > Alerts (turn on Entity alerts), trigger it, and read the application name your notification daemon shows.

Expected: The startup list says "HA Desktop Widget", not `home-assistant-widget`. The notification's title and text name the widget as "HA Desktop Widget".

Known exception, raised with the owner: a daemon that also prints the sending application's name (dunst or swaync with `%a` in their format, KDE for an app it cannot match to a launcher) shows `home-assistant-widget` there. 4.0 still sends the package name, because the keyring entry that holds the key to saved sign-ins and the tray icon's id are named after it. Write down what your daemon shows.

Capture: A screenshot of the list and the notification, including the application name if your daemon prints one.

Ref: MP-52

### LNX-7 Tray icon on a high-DPI bar

Needs: A tray icon, and a bar or panel at 200% scale or a Wayland session with fractional scaling.

1. Zoom into the tray icon.

Expected: The icon is crisp, not an enlarged small bitmap.

Capture: A zoomed screenshot and the scale.

Ref: MP-16

### LNX-8 Window manager without compositing

Needs: A bare X11 window manager (i3, openbox, dwm), or XFCE with compositing turned off. Skip on GNOME and KDE.

1. Start the app with the default settings, in a new empty profile folder, because earlier checks changed the settings of your main folder (see "Use a throwaway profile"). Connect it to Home Assistant and look at the window in the light and the dark theme.
2. Settings > Appearance: turn on High contrast with opaque panels, or set Window opacity to 100.

Expected: With default settings the window looks as designed, not gray and muddy in the light theme or darker than designed in the dark theme. If it does not, the opaque setting fixes it.

Capture: Screenshots of both, and the window manager.

Ref: MP-29

### LNX-9 Installed build: language, edit menu and hotkey

Run this on the AppImage or the `.deb` from the Releases page, not a build from source. 4.0 leaves files out of the package that earlier versions shipped, and this check is how a missing one would show. Keep Settings > General > Language on Auto (system default).

1. Quit the app. Start it from a terminal with Mexican Spanish as the system language: `LANGUAGE=es_MX LANG=es_MX.UTF-8 ./"HA Desktop Widget-<version>-linux-x64.AppImage" --user-data-dir=$HOME/hadw-test`, or `LANGUAGE=es_MX LANG=es_MX.UTF-8 home-assistant-widget --user-data-dir=$HOME/hadw-test` for the `.deb`.
2. Open Settings > General > Language & localization and read the line about the system language. Under Offline language packs, download Spanish.
3. Right-click the Search settings field at the top of Settings, once while it is empty and once with a word typed in it.
4. Close Settings and turn on Reorganize Quick Access. Click the pencil on a tile, add the words `Kitchn lihgt` at the end of Display name and right-click `lihgt`. Then press Cancel. In a terminal, run `ls $HOME/hadw-test/session/Dictionaries`.
5. Settings > Hotkeys > Popup hotkey: set a hotkey, then press it while another app is in front. On Wayland, approve the shortcut when your desktop asks.
6. Quit, and do steps 1 to 3 again with `LANGUAGE=zh_TW LANG=zh_TW.UTF-8` and the Chinese pack.

Expected: The app starts with its window, and its tray icon if your desktop has a tray. The line names Spanish (Mexico), and once the pack is downloaded the whole app is in Spanish without picking it in Language. The app draws the right-click menu from the same pack, so it is in Spanish too: Deshacer, Rehacer, Cortar, Copiar, Pegar, Eliminar, Seleccionar todo. Spell-check is off on purpose: no word in Display name or the search field has a red underline, and right-clicking `lihgt` opens the same edit menu, with no spelling suggestions and no Add to dictionary (Añadir al diccionario). The `ls` lists no `.bdic` file, because the app downloads no spelling dictionary. The folder may exist and be empty; a `.bdic` file dated before this build's first start was left by an earlier version. With `zh_TW` the line names Chinese (Taiwan), and the app and the menu are in Chinese (撤销, 剪切, 复制, 粘贴, 全选). The Chinese pack is written in simplified characters, so Taiwan gets those too. The hotkey brings the widget to the front. On Linux it goes through the desktop's shortcut service or X11, not uiohook, so the log has "Using Electron globalShortcut for Linux popup hotkeys" and no line about uiohook-napi.

Capture: A screenshot of the language line and of the right-click menu in each language, and your session type. If a word is underlined or a menu offers spellings, a screenshot of it. If the `ls` lists a `.bdic` file, its name and date. If the hotkey does nothing, the log lines about hotkeys.

Ref: MP-78

## GNOME, Wayland and X11

Stock GNOME (Fedora Workstation, Debian) has no tray unless you install an AppIndicator extension. Ubuntu turns one on by default. If your distribution offers a GNOME on Xorg session, run GNOME-1 and GNOME-2 on both sessions.

Run GNOME-2 before the shared checks and before you install an extension, on both sessions if you test both (see "Check for a tray icon"). GNOME-3 and the tray steps of the shared checks need the extension, so they come after it.

### GNOME-1 Alt+Tab and the overview

1. Start the app with two pins on the desktop.
2. Press Alt+Tab (or Super+Tab) and open the Activities overview.
3. In a terminal run `xprop _NET_WM_STATE`, then click the widget, then run it again and click a pin. This works when the widget runs on X11 or through XWayland.

Expected: The widget and the pins are not listed in Alt+Tab or as running windows in the dock, and none of them makes the shell flash for attention. The `xprop` output for each lists `_NET_WM_STATE_SKIP_TASKBAR`.

Capture: The `xprop` output and a screenshot of the switcher.

Ref: MP-24

### GNOME-2 No tray host

Needs: A GNOME without an AppIndicator extension.

1. Click the widget's Minimize button. Look for a way back: the Dock, Alt+Tab, the overview, a tray icon.
2. Start the app again with the same command you used before (the app grid starts your real profile, not the throwaway folder). Then close the widget with the X, and again with Alt+F4, and look for a way back each time.

Expected: The widget does not vanish with no way back. Minimize minimizes it like a normal window, and it shows in the Dock, Alt+Tab and the overview. The X and Alt+F4 hide it; the first time in a run a notification says "HA Desktop Widget is still running", to open it from the app launcher and that GNOME shows its tray icon only with an AppIndicator extension. Clicking the notification, or starting the app again, brings the widget back.

Capture: What you saw after Minimize, and the notification after the X.

Ref: MP-41

### GNOME-3 Position and always on top

Needs: An AppIndicator extension. On stock GNOME, install one after GNOME-2.

1. Move the widget to a corner. Hide it from the tray (with the extension) and show it again.
2. With Always on top on, open another window over it.

Expected: The widget returns to the same position. With Always on top on, it stays above other windows.

Capture: Where the widget was before and after.

Ref: none (see [Linux Wayland window behavior](../linux-wayland-notes.md))

## KDE Plasma, Wayland and X11

Run KDE-1 and KDE-2 on a Wayland session and on an X11 session if you can.

### KDE-1 Task manager and Alt+Tab

1. Start the app with two pins.
2. Look at the task manager, Alt+Tab, and the overview. Watch whether a pin is highlighted as asking for attention.
3. On X11 and XWayland, run `xprop _NET_WM_STATE` and click the widget, then a pin.

Expected: The widget and the pins do not appear in the task manager or Alt+Tab, and none is highlighted. The `xprop` output lists `_NET_WM_STATE_SKIP_TASKBAR`. On a native Wayland session, record what you see.

Capture: A screenshot of the task manager and the `xprop` output.

Ref: MP-24

### KDE-2 Moving a pin with the window gesture

1. With Reorganize off, hold Alt or Meta (whichever moves windows on your Plasma) and drag a pin.
2. Release it, then change Window opacity and Save and close.
3. Turn on Reorganize and drag a pin so it straddles two monitors, or hangs past a screen edge. Drop it. Then change Window opacity and Save and close.
4. Quit and start the app again.

Expected: Outside Reorganize, a pin does not stay where the gesture left it. In Reorganize, a pin dropped across a monitor boundary or past an edge moves to a fully visible position straight away. It does not jump later when you change an unrelated setting, and the same position is there after restart.

Capture: A recording of the drop and what happened after you changed opacity.

Ref: MP-37

### KDE-3 Raise script left in /tmp

Needs: A native Wayland session on Plasma. Start the app with `HA_WIDGET_LINUX_NATIVE_WAYLAND=1`; the raise path is only used there.

1. Set a popup hotkey. Hide the widget behind another window and raise it with the hotkey a few times.
2. Run `ls -l "$XDG_RUNTIME_DIR"/ha-widget-raise-*.js /tmp/ha-widget-raise-*.js` while the widget is raising, and again afterwards.

Expected: No `ha-widget-raise-*.js` script is left in `/tmp` or in the runtime directory after the widget raises. While one exists it is in `$XDG_RUNTIME_DIR` (not `/tmp`), has a random name and is readable by you only (`-rw-------`).

Capture: The listing.

Ref: MP-62

### KDE-4 Tray and hotkey

1. Look at the panel tray icon at your display scale.
2. Set the popup hotkey, approve the shortcut when Plasma asks, and use it.

Expected: The icon is crisp. The hotkey brings the widget forward and, with Press to toggle, hides it.

Capture: A zoomed screenshot of the icon and the prompt text.

Ref: MP-16

## Ubuntu 24.04, AppImage and .deb

Ubuntu 23.10 and later restrict unprivileged user namespaces, which affects the AppImage. Test both package types on a clean 24.04 install or virtual machine.

### UBU-1 AppImage start

1. Download the AppImage and run `chmod +x` on it. If it will not start because it cannot mount, install `libfuse2t64` (`sudo apt install libfuse2t64`) and try again.
2. Double-click it, then run it from a terminal.
3. Run `cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns`.

Expected: The widget window appears. With the value from step 3 at 1, a double-clicked AppImage cannot start ("No usable sandbox"): that happens before the app's own code runs, so it cannot explain itself. The `.deb` is not affected, and [Running the AppImage on systems that block the Chromium sandbox](../linux-appimage.md) describes the ways around it. After the AppImage has been started once with `--no-sandbox`, the launcher it writes in `~/.local/share/applications` carries the flag, so starting it from the app grid works.

Capture: The terminal output, in particular any "No usable sandbox" message, the value from step 3, and the `Exec=` line of `~/.local/share/applications/com.github.robertg761.hadesktopwidget.desktop` if it exists.

Ref: MP-06

### UBU-2 .deb install

1. Run `dpkg -I <file>.deb` before installing. Look at the Description and Maintainer lines.
2. Install with `sudo apt install ./<file>.deb`. Open the app grid and start the app from it.
3. While the app runs, look at the dock, the Alt+Tab list on a Wayland session, and `apt show home-assistant-widget`.

Expected: The Description has a first line, and the Maintainer line includes an email address. The app grid, dock and Alt+Tab show the app's icon, not a generic placeholder. The icon is a finished app icon, not a hard-edged black square.

Capture: The `dpkg -I` and `apt show` output and a screenshot of the app grid.

Ref: MP-05, MP-79, MP-25

### UBU-3 Restart from an AppImage

1. Run LNX-3 from the AppImage.

Expected: After Restart now a new process starts and the widget comes back.

Capture: `pgrep -a -f home-assistant-widget` before and after.

Ref: MP-01

### UBU-4 Other checks on Ubuntu

On Ubuntu, also run GNOME-1, LNX-6, SYNC-2 and SYNC-3. GNOME-2 does not apply, because Ubuntu turns on an AppIndicator extension by default. For updates see UPD-1 (the AppImage updates itself) and UPD-2 (the .deb does not).

Ref: MP-24, MP-52

## Hyprland and Omarchy (HYP)

Read the [Omarchy guide](../omarchy.md) first. The widget runs as a desktop layer under normal windows. Raise it with the popup hotkey, a tray click or `ha-desktop-widget --toggle`. Omarchy 4 has the bar plugin; Omarchy 3 uses waybar, which cannot load it. Use the AppImage for a pre-release.

Some steps change your Hyprland blur setting, the Omarchy bar or the Omarchy theme. Back up `~/.config/hypr` and `~/.config/omarchy` first, and note your current blur setting.

### HYP-1 First run and tray

1. Start with a new empty profile folder (see "Use a throwaway profile"). Read the welcome screen and the step about shortcuts.
2. Zoom into the tray icon on your bar.

Expected: The heading has no box around it. The two buttons Set up hotkeys and Check popup hotkey have space between them, and the security note is not the loudest text. The tray icon is crisp at your bar's scale.

Capture: A screenshot of the shortcuts step and the zoomed icon.

Ref: RO1-16, MP-16

### HYP-2 Pins in Reorganize

1. Pin a light or a sensor at its default size. Turn on Reorganize Quick Access.
2. Read the pin. Drag it.
3. Exit Reorganize. Drag the main widget by its header, restart the app, then use Reset Position in the tray menu.

Expected: Dragging works. No block of text such as "Your desktop environment controls where this tile sits" covers the pin, because that is not true on Hyprland. The "Drag or resize" hint is readable and overlaps nothing. The main widget keeps its new position after the restart, and Reset Position returns it to the default corner.

Capture: A screenshot of the pin in Reorganize.

Ref: CSSA1-10

### HYP-3 Opacity 100 and dialogs

1. Open another window on the same workspace so the widget is under it.
2. Open Settings from the tray. Move Window opacity to 100 and Save and close.
3. If a prompt appears, read it and choose Restart now.
4. Look at the pins' corners and where the widget sits.

Expected: Any prompt is visible on top of your windows, not behind the widget. After the restart the widget is on the desktop layer again, at the same place as before (the default is 20 px from the bottom-right corner). Pins have rounded corners and no square plate.

Capture: A screenshot of the prompt and of the widget and pins at 100.

Ref: MP-08, SM3-06

### HYP-4 Layer-mode text in Settings

1. Settings > General > Window & behavior: look at Always on top.
2. Settings > Hotkeys: read the intro of the Hyprland shortcuts panel.
3. Start the widget with `HA_WIDGET_LINUX_LAYER_SHELL=0` (a floating window) and read the same panel.
4. Optional: start it with `XDG_CURRENT_DESKTOP=custom` in the environment.

Expected: Always on top is off and disabled, and the page says why in text you can see (not only in a hover tooltip). The panel says the widget sits beneath normal windows and how to bring it forward when it is in layer mode, and does not say it in the floating fallback. With a different `XDG_CURRENT_DESKTOP` the widget still offers the layer-mode features: dragging by the header, and the Hyprland shortcuts panel.

Capture: A screenshot of both texts.

Ref: SM2-67, SM3-33, MP-81

### HYP-5 Hyprland shortcuts panel

1. With no hotkeys set, open Settings > Hotkeys and look at the Hyprland shortcuts panel. Press Copy bindings.
2. Set a popup hotkey. Watch the bindings box.
3. Assign an entity hotkey to a lamp. Read the toast and the bindings box.
4. Clear the popup hotkey. Press Refresh hotkey status.
5. Switch Configuration format between Lua (.lua) and Hyprlang (.conf). Copy a binding into your Hyprland configuration, reload it, and press the shortcut.
6. Read "Last shortcut received" and the bindings text.

Expected: With no hotkeys, the panel says so and Copy bindings does not claim it copied something. A new or changed hotkey (popup or entity) shows its binding straight away, and the toast tells you to copy it. Clearing the popup hotkey empties its binding. Refresh gives visible feedback. "Last shortcut received" uses readable names. The bindings box is a readable monospace size and does not break an identifier across lines. The shortcut raises the widget.

Capture: A screenshot of the panel in each state and the text you pasted into your configuration.

Ref: SM3-09, SM3-32, SM3-40, SM1-30, CSSC1-32

### HYP-6 Widget blur toggle

1. Run `hyprctl getoption decoration:blur:enabled` and note it.
2. Settings > Appearance > Window effects: use the button to turn blur on for the widget (labeled Turn on blur for the widget), then press Cancel in Settings.
3. Run the `hyprctl` command again. Then turn it off (Turn off blur for the widget) and Save and close.

Expected: The page says the blur change takes effect immediately, because it changes the compositor without waiting for Save and close, and the two buttons are worded as a pair. The button is still reachable when Frosted glass background is off, so a blur you turned on can be turned off again. It is clear that Cancel does not undo the change.

Capture: The `hyprctl` output before and after each step and a screenshot of the section.

Ref: SM3-34, SM1-11

### HYP-7 Follow Omarchy theme

Run this with a dark Omarchy theme (for example Tokyo Night) and a light one (Catppuccin Latte or Rose Pine). Switch themes with the Omarchy menu (Style > Theme).

1. Settings > Appearance with Follow Omarchy theme on: look at the Colors section and the Mode control. Pick a different accent and press Save and close.
2. Turn Follow Omarchy theme off. Watch the window and the Save and close button before you save.
3. Look at the form fields, selects, swatches and dividers in Settings, and at secondary text (state lines such as Off, tab labels, popup captions, help text).
4. Select text in the Settings search field.
5. Change the Omarchy theme while the widget is open.

Expected: With Follow Omarchy on, the Colors and Mode controls are clearly disabled or explained and show the mode in use, so a choice never silently reverts on Save and close. Turning it off previews your own accent and mode at once. Form fields and dividers have soft borders like the stock theme, not full-strength outlines. Secondary text stays readable on both themes. Selected text uses the Omarchy selection color. A theme change updates the whole window, glass included, without a restart.

Capture: A screenshot of Appearance and a dark and a light Settings page.

Ref: SM2-18, CSSC2-22, SM2-48, RO2-01, RO2-02, RO2-52, RO2-53

### HYP-8 Bar plugin: stopped and offline states

Needs: Omarchy 4. In the widget's tray menu, choose Add to Omarchy Bar, and run `omarchy-restart-shell` if the bar does not show it.

1. Start the widget with no network (or a wrong Home Assistant address). Open the bar panel.
2. Reconnect. Open the panel again.
3. With the widget connected, find its main process (in `ps -ef`, the `home-assistant-widget` process whose command line has no `--type=`), end it with `kill -9`, and watch the bar icon and tooltip for a minute. Click a tile.

Expected: Before the first snapshot the panel shows your own tile names and icons (or friendly names) and a calm "Connecting" line, not raw entity ids with blank icons under a red status. A few seconds after the widget is killed the icon dims and the tooltip says it is not running. Clicking a tile then does not start a second widget window while the status still says Connected.

Capture: A screenshot of the panel in each state and how long the icon stayed undimmed.

Ref: MP-63, RO1-23

### HYP-9 Bar plugin: names with markup

1. In the widget, rename two tiles to `Humidity <b>zone</b> <Main>` and `R&D <i>room</i> <30%`.
2. In a terminal run `python3 -m http.server 8000`. Rename a third tile to `<img src="http://127.0.0.1:8000/x.png">`.
3. Open the bar panel and wait a minute with it closed.

Expected: The panel shows the three names as typed, with the markup visible as text. The terminal logs no request for `x.png`, with the panel open or closed.

Capture: A screenshot of the panel and the terminal output.

Ref: RO1-19

### HYP-10 Bar plugin: live updates and keyboard

1. Put a sensor that changes every second or two in Quick Access. With the panel open, hold a light tile ten times to open its controls.
2. Watch the Omarchy shell's CPU use (for example the `quickshell` process in `top`) with the panel closed.
3. Add more than 20 entities to the plugin entry in `~/.config/omarchy/shell.json` (the plugin accepts up to 48), open the panel and press Down repeatedly. Try to open a tile's controls and adjust a slider using only the keyboard.

Expected: Holding a light tile opens its controls every time while the sensor updates. CPU use with the panel closed is low. The highlighted tile always stays visible when you scroll with the arrow keys, and a keyboard-only path leads to a tile's controls. If you have more than 48 entities or 12 pages, the panel says some are not shown.

Capture: How many of the ten holds worked, the CPU reading, and a screenshot of the highlighted tile.

Ref: RO1-20, RO1-21, MP-64

### HYP-11 Bar plugin: themes and language

1. Switch between a light Omarchy theme (Catppuccin Latte, White, Flexoki Light) and a dark one. Read the panel's status text ("Connected", "45%", "Off") next to the tile names.
2. Set the widget's language to German and open the panel.
3. With two or more pages in Quick Access, at least two of them never renamed (the first one is called "All"), open the panel in English and in German. Then stop the widget and cut the network once each to read the status line in English.

Expected: Status text is dimmer than tile names but readable on every theme, and "Unavailable" is readable. The panel's own labels follow the widget's language, like the tile names do. Every page has a heading, including the first and the ones nobody renamed ("All", "View 2" in English; "Alle", "Ansicht 2" in German). In English the status line for a lost connection reads "Disconnected. Retrying automatically." and the fan slider is labelled "FAN SPEED".

Capture: A screenshot of the panel on a light and a dark theme, and in German.

Ref: RO1-22, RO1-24, RO1-56

### HYP-12 Bar plugin: controls and edge cases

1. Open a climate tile's controls. Press + three times quickly. Stop the widget and try a slider.
2. Add four media or calendar entities to `barEntities` in `~/.config/omarchy/shell.json`. If you have a vertical bar, use it.
3. Create a throwaway `input_boolean` in Home Assistant, add it to Quick Access, delete it in Home Assistant, and click its tile in the panel.
4. Give a tile a custom emoji of five or more code points (a family emoji) and a very long name, and use newer Material Design icons.

Expected: Three quick + presses raise the target by three steps. With the widget stopped, the controls say so or are disabled; they do not silently do nothing. A thermostat with a heat/cool range shows its current temperature and range. The bar readout stays within a sensible width and is usable on a vertical bar. Clicking the deleted tile either opens something useful or does not raise the widget for nothing. A long emoji is not cut into a different icon, a long name is not cut mid-character, and newer icons are drawn, not boxes.

Capture: A screenshot of each, and the request line if a control was dropped.

Ref: RO1-25, RO1-26, RO1-27, MP-65

### HYP-13 Other Hyprland checks

Run the monitor checks in MON-1 (the tray's Move to Monitor menu and Reset Position), SYNC-3 (a locked keyring and the toasts over Save and close), A11Y-1 for the contrast settings Hyprland supports, and LNX-1, LNX-4 and LNX-5.

Ref: none

## Sway, niri and river (SWAY)

Sway, niri and river use the same desktop-layer mode as Hyprland, started automatically. Dragging and per-monitor pin positions are Hyprland features today, so these checks look at what a user of another compositor sees. For the popup hotkey, bind the widget's `--toggle` command yourself; Settings > Hotkeys names it for your installation. The command depends on the package: `ha-desktop-widget` for the Arch package, `home-assistant-widget` for the `.deb`, and `~/.local/bin/ha-desktop-widget` (by its full path) for the AppImage, a link the widget points at the AppImage each time it starts. With the Arch package, Sway: `bindsym $mod+Shift+h exec ha-desktop-widget --toggle`; niri: `Mod+Shift+H { spawn "ha-desktop-widget" "--toggle"; }`; river: `riverctl map normal Super+Shift H spawn 'ha-desktop-widget --toggle'`. Replace `ha-desktop-widget` with your package's command.

### SWAY-1 Pins

1. Pin three tiles. Open Reorganize Quick Access.
2. Look at where the pins sit, and at the widget.

Expected: Each pin is in its own place and none hides another pin or the main widget. If moving pins is not supported on your compositor, the app or the docs say so. No large block of text covers a pin in Reorganize.

Capture: A screenshot of the output with the pins and the widget.

Ref: MP-07, CSSA1-10

### SWAY-2 Hotkeys page

1. Settings > Hotkeys: read the page, in particular the Global popup trigger section.
2. Press your `--toggle` key several times.
3. AppImage only, when a newer version is out: update from Settings > Advanced, let the new version start, and press the key again.

Expected: Where there is no shortcut portal, the Global popup trigger section says the feature is not available. Its suggestion buttons and switches are disabled, not clickable and inert. The page tells layer-mode users how to bring the widget forward: bind a key to a command it names, which is the command for your package (`ha-desktop-widget --toggle` for Arch, `home-assistant-widget --toggle` for the `.deb`, `/home/<you>/.local/bin/ha-desktop-widget --toggle` for the AppImage). The command sits on one line when it fits, in Arabic too. A command longer than the line keeps the comma after it on its last line. One click on it selects all of it, which Ctrl+C or right-click > Copy then copies. The Copy button under the note copies it too, also from the keyboard (Tab to it, then Enter), and says "Command copied". Paste it into a terminal to check that it matches the command shown. The key, bound to exactly that command, raises and lowers the widget, and with the AppImage it still does after the update.

Capture: A screenshot of the Hotkeys page.

Ref: SM3-30, SM3-33

### SWAY-3 Dialogs and opacity 100

1. Run LNX-3 on Sway, niri or river, with another window open over the widget.

Expected: As in LNX-3; a prompt is visible above your windows.

Capture: As in LNX-3.

Ref: SM3-06, MP-08

### SWAY-4 Tray and monitors

1. Use a bar with a tray (Waybar). Zoom into the tray icon at your scale. Click it.
2. With two monitors, open the tray menu and look for Move to Monitor. Choose the other monitor. Then use Reset Position.

Expected: The icon is crisp, and clicking toggles the widget. Move to Monitor lists your monitors and the widget restarts on the one you pick. Reset Position returns it to the default corner.

Capture: A screenshot of the menu and the widget's new place.

Ref: MP-16

## High contrast and screen readers (A11Y)

### A11Y-1 Windows contrast themes and forced colors

Switch the theme on in Windows 11 under Settings > Accessibility > Contrast themes (Aquatic, Desert, Dusk, Night sky) and in Windows 10 under Settings > Ease of Access > High contrast. Left Alt + Left Shift + Print Screen toggles the last theme. Run the checks with a dark theme and with a light one (Desert or White). Restart the app after switching, and switch back when you finish. On Linux, try your desktop's High Contrast setting; the app may not enter forced-colors mode there, so report whether it looks different.

1. Main window: look at the connection dot connected and disconnected, the media seek bar, the weather icon, the divider between the weather and clock cards, a running timer tile, the active page tab, and a disabled button (Undo, previous or next track). Look for black or white boxes behind text.
2. Long-press a light, fan, cover, climate and media tile. Try the sliders with the mouse. Look at the color swatches on an RGB light and move keyboard focus onto one. Look at the selected HVAC mode, fan preset and mute buttons. Compare the primary and secondary buttons (Save and Cancel, Turn off and Close).
3. Settings: press Tab through the text fields, selects and dropdowns on each page. On Appearance, look at the accent and background swatches and the selected one. Look at the icon of the active page in the left rail.

Expected:

- Main window: the connection dot is visible and differs between connected and disconnected. The seek bar and every other progress fill show their track and fill. The weather icon is visible. There are no black or white boxes behind text, and the translucent window background does not keep its alpha. A running timer looks different from an idle one, and the weather and clock cards have a divider. The active tab has a clean outline. Disabled buttons look disabled.
- Popups: sliders are visible and can be dragged with the mouse. Color swatches are visible and have a visible focus ring. The chosen HVAC mode, fan preset and mute button are distinguishable from the others. Primary and secondary buttons look different.
- Settings: every text field, select and dropdown shows where keyboard focus is. Accent and background swatches are visible, and the selected swatch and the selected target are marked. The active rail icon uses a system color.

Capture: A screenshot of each point that fails, with the theme name.

Ref: CSSC3-05, CSSA1-18, CSSA2-13, CSSC1-02, CSSA1-33, CSSA3-29, CSSC3-20, CSSB2-31, CSSC3-19, CSSC1-38, CSSB2-13, CSSC1-12, CSSA3-26, CSSB1-33, CSSB1-02, CSSC2-31

### A11Y-2 Narrator and other screen readers on Windows

Start Narrator with Win+Ctrl+Enter. NVDA is welcome too.

1. In Settings > General, start a browser authorization with Connect and listen. Cancel it. Try a wrong address. If you can, run the first-run welcome flow on a new profile.
2. Pin a scene or script, a media player, a fan and a light. Move through the pin buttons and listen to how each is read.
3. Tab to Check for updates in Settings > Advanced, and press Enter. Tab to a popup hotkey switch and press Space.
4. Open Manage Quick Access and Tab through a few rows. In a notification list with two or more notifications, Tab to each Dismiss. In a cover's dialog, Tab through the actions. In the light dialog, Tab to the colour swatches.

Expected: Status messages are spoken when they appear, without moving focus: "Waiting for you to approve in your browser...", the failure text after Cancel, and the address error. Row buttons say what they act on ("Add Kitchen", "Dismiss Front door left open", "Close Living Room Blinds"), not only "Add" or "Dismiss". The colour swatches say a colour name ("Amber") and which one is on. One-shot actions (run a scene, a script, pause) are read as plain buttons, not as "pressed" toggles. On/off buttons read their state. After you press Check for updates or a switch, keyboard focus stays on it.

Capture: What Narrator said for each point (a recording of the audio, or your notes).

Ref: RO2-47, UIB-09, SM3-31, UIC-12, UIC-30, UIC-37

### A11Y-3 VoiceOver on macOS

Start VoiceOver with Cmd+F5.

1. Repeat steps 1 and 2 of A11Y-2.
2. Move through the header buttons and the tray menu.
3. In System Settings > Accessibility > Display, turn on Increase contrast and look at the tile borders. A11Y-4 covers Reduce motion.

Expected: As in A11Y-2. Each header button is announced by what it does: Settings, Minimize, and Hide for the X (see ALL-3). With Increase contrast, tile borders are clearly stronger.

Capture: What VoiceOver said and a screenshot with Increase contrast on.

Ref: RO2-47, UIB-09, CSSC1-22

### A11Y-4 Reduced motion and increased contrast

1. Turn on the system's reduce-motion setting (Windows: Animation effects off; macOS: Reduce motion). Open Settings, a light's controls and the command palette.
2. Turn on the system's increased-contrast setting if it has one (macOS: Increase contrast), without a forced-colors theme.
3. With reduce motion still on, start Connect with Home Assistant in Settings (stop before approving in the browser), and open a camera that is slow to load.

Expected: Dialogs still blur what is behind them as without reduced motion; only the movement stops. With increased contrast, tiles and panels have visibly stronger borders. The waiting bar under Connect with Home Assistant fades in and out and never rests as a full bar that looks finished, and the loading rings and the Connecting icon keep turning (slowly) while the app waits.

Capture: A screenshot of a dialog with and without the setting.

Ref: CSSC1-16, CSSC1-22, CSSC1-13

### A11Y-5 Orca on Linux

Start Orca (Super+Alt+S on GNOME).

1. Repeat steps 1 to 3 of A11Y-2 as far as they apply.

Expected: As in A11Y-2.

Capture: Your notes of what Orca said.

Ref: RO2-47, UIB-09, SM3-31

## Multiple monitors and mixed scaling (MON)

Needs: Two monitors with different scale factors (for example 100% and 150%). Hot-unplugging is part of the check.

### MON-1 Placement, unplugging and replugging

1. Put the widget on monitor 2 and pins on both monitors. Quit and start the app. Look at where everything is.
2. With the widget visible on monitor 2, unplug that monitor's cable (or turn the output off in your display settings).
3. Plug it in again. Then hide the widget to the tray while it is on monitor 2, unplug the monitor, and show the widget with the popup hotkey or the tray.
4. Use the tray's Reset Position.
5. With monitor 2 unplugged, quit and start the app. Look at the pins that were on monitor 2. Plug monitor 2 in, quit and start the app again.
6. On Hyprland, Sway, niri or river, use the tray's Move to Monitor instead of dragging.

Per-monitor pin positions are a Hyprland-only feature on desktop layers. On Sway, niri and river, skip the pin parts of steps 1 and 5 and of the expected result; SWAY-1 covers where pins sit there.

Expected: After step 1 everything is where you left it, at the right size on each scale. After step 2 the widget and the pins move to the remaining monitor and are fully visible. In step 3 the widget appears on the remaining monitor. Reset Position puts it fully on a connected monitor, at the size you gave it (smaller only if the monitor cannot hold it). In step 5 the pins appear on monitor 1 while monitor 2 is missing, and go back to monitor 2, where you left them, once it is connected again (not on Sway, niri or river; see the note above). Move to Monitor lists your monitors and restarts the widget on the one you pick.

Capture: Screenshots at each step and your monitor layout.

Ref: MP-22, MP-10, MP-18

### MON-2 Resizing and new pins

1. Drag a pin's corner towards the edge between the two monitors, and across it.
2. At Text and control size 115%, 130% and 150% (Settings > Appearance > Readability), resize a pin to its minimum from each corner.
3. Pin seven tiles in a row. Unpin the second and pin another.

Expected: A pin follows the pointer while you resize it. It grows in the direction you drag, stays on one monitor, and does not jump to the other. At large text sizes the edge opposite to the corner you drag stays put, and a pin at its minimum size still shows its name and main control, or scrolls with a visible scrollbar. New pins do not land exactly on top of existing pins.

Capture: A recording of the resize and a screenshot of the pins.

Ref: RO2-44, RO2-43, CSSC1-33, MP-34

### MON-3 Sleep with a changed layout

1. Follow the "Change monitor layout while asleep" row in [Connection recovery release checks](connection-recovery.md).

Expected: As in that table: on wake the widget, pins and tray all work on each screen.

Capture: As in that table.

Ref: MP-22

## Large text and display scaling (TXT)

### TXT-1 Text and control size, and OS scaling

1. Settings > Appearance > Readability: set Text and control size to 115%, 130% and 150%, one at a time. At each, look at the widget, Settings, a popup and the pins at their default size.
2. Raise the OS scaling: Windows Settings > System > Display > Scale (125%, 150%) and Accessibility > Text size; macOS Displays > Larger Text; GNOME Settings > Accessibility > Large Text; KDE the font and scaling settings.
3. Repeat step 1 in German.

Expected: Header buttons, Settings and the popups are not clipped. A pin at its default size (168 by 148) shows its name and its main control without scrolling. Pins at their minimum size may scroll, and then they have a visible scrollbar. In German the cover pin's slider and Open button fit, the climate mode buttons are not cut to stubs, and fan presets do not overlap.

Capture: Screenshots at each size.

Ref: CSSC1-33, CSSA1-11, CSSC3-04, CSSA1-12

## Chinese, Japanese and Korean input (IME)

### IME-1 Command palette with an input method

Needs: An input method installed: Windows Microsoft Pinyin or Microsoft IME; macOS Pinyin or Japanese; Linux IBus or Fcitx5 with Pinyin, Anthy or Mozc.

1. Add a switch you do not mind toggling to Quick Access. Open the command palette (Ctrl+K, or Cmd+K on macOS).
2. Switch to the input method. Type "nihao" in Pinyin or "toukyou" in Japanese so that the candidate list appears.
3. Press the arrow keys to choose a candidate, then Enter.
4. Start another composition and press Escape once, then again.

Expected: The arrow keys move the input method's candidate list, not the palette highlight. Enter commits the text into the search box and does not run the highlighted result. The first Escape cancels only the composition; the palette stays open. The second closes it.

Capture: A recording and which keypress ran a command or closed the palette.

Ref: RO2-04

## Language packs and fonts (LANG)

System fonts differ per OS, so run these on each system. Download a pack under Settings > General > Language & localization > Offline language packs, then choose it in Language.

### LANG-1 Layout in other languages

1. In German, French and Spanish, pin a cover, a fan and a climate entity at the default size. Open Reorganize.
2. In Arabic, look at the whole app: the layout, Settings rail, the disclosure chevrons, the weather and clock cards, a gauge tile, a light pin at 80% brightness, the command palette with a temperature sensor and a long Latin name, the hex code of a custom color, and the notification list with an English notification.
3. In Hindi and Chinese, look at pin names, state words and scene names on small pins.

Expected:

- German, French and Spanish: labels fit. There is no horizontal overflow, no climate button is cut to a stub, and fan presets do not collide.
- Arabic: the layout is mirrored. The rail divider and the weather divider sit between their panes, chevrons point away from the text, a gauge's min and max labels do not cross its arc, and a light pin's fill and thumb end at the same place. `21.4 °C` reads in the right order, a long Latin name is cut at its end and not at its start, the hex code reads `#12AB34`, and the final punctuation of an English notification stays at its end.
- Hindi, Arabic and Chinese: names are not cropped at the top or bottom, and wrapped lines do not overlap.

Capture: A screenshot for each point that fails, with the language and the OS.

Ref: CSSA1-11, CSSC3-04, CSSA1-12, CSSA1-13, CSSA1-38, CSSA1-08, CSSC3-08, CSSC2-10, CSSC2-11, CSSC3-22, CSSC2-12, CSSC3-06, CSSC3-07, CSSC3-21, RO3-15, UIA-34, RO2-67, RO2-64

### LANG-2 Native-speaker review

Needs: A native speaker of Spanish, Chinese, Hindi, Arabic or French. There is no other reviewer.

1. Read a few Settings pages, a dialog and the command palette in your language.
2. Look for the same concept called by different words, English words left in the middle of a sentence, and odd punctuation. In French, look at spaces before ":" and "?".
3. In the Spanish pack, with an alarm entity on a beta build, read the tray labels for Off, Disarmed and Armed at night.

Expected: One term per concept: "configuración" for the Settings page and "ajustes" for individual settings in Spanish, and one word each for tile and card in Chinese and Hindi (Arabic still uses one word for both). No stray English. In French, a colon or a question mark does not wrap to the start of a line (the packs use a non-breaking space there). Off, Disarmed and Armed at night have different tray labels in Spanish.

Capture: The screen and the words you would change.

Ref: I18N-14, I18N-13

### LANG-3 Language packs after an upgrade

Needs: A profile that has run 3.11 (or any build before 4.0) with a language pack installed, such as Spanish or French, then the 4.0 build started on it.

1. Start the 4.0 build on that profile with the network on. Do not open Settings. Wait a minute.
2. Look at the main window, the tray menu and a Settings page.
3. Repeat on a copy of the profile with the network off (or the computer in airplane mode), then turn the network on and wait an hour or restart the widget.

Expected: A minute or so after the start the new 4.0 words appear in the pack's language on their own (Settings pages, new dialogs, the tray), without pressing Update under Offline language packs. Offline, nothing is shown to you and the old pack keeps working; the update arrives once the network is back. A profile with no pack installed makes no request.

Capture: The language, the pack version shown under Offline language packs before and after, and the log lines about language packs.

Ref: I18N-03

## Profile sync and encryption (SYNC)

Use two computers where a check says so. Use a throwaway profile and a throwaway sync folder. The sync file is `ha-widget-profile-sync.json` in the folder you choose.

### SYNC-1 Turn on encryption on a syncing profile

Run on each system you have: Windows, macOS, and Linux with a working keyring (GNOME Keyring or KWallet).

1. Settings > Advanced > Profile syncing: turn on Profile sync and choose a sync folder. Wait for the first sync.
2. Tick Encrypt synced profile with passphrase, enter a passphrase of at least eight characters in Sync passphrase, and Save and close.
3. Open the sync file in a text editor.
4. On a second computer, turn on Profile sync with the same folder and the same passphrase. Change a setting on either computer.
5. Turn encryption off again and Save and close.

Expected: After step 2 the status shows encryption on and sync keeps working; it does not say sync is paused until something is resolved. In step 3 the settings are not readable in the file. The second computer picks up changes. Turning encryption off again works, and the file becomes readable.

Capture: The status text, the first line of the file, and the log.

Ref: MP-02

### SYNC-2 Linux without a keyring

Start the app with `--password-store=basic` to act as if no keyring exists, or use a minimal session. Use a legacy long-lived token for the connection.

1. Start the app. Read the messages about secure storage.
2. Turn on Profile sync, wait for a sync, and then tick Encrypt synced profile with passphrase and Save and close.
3. Read the Linux install steps on the download page (see WEB-1).

Expected: The keyring message appears once and does not give two opposite instructions (re-enter the token versus unlock and restart). Changing encryption on an existing sync file without secure storage is refused with a message that says an unlocked system keyring is needed, before sync is paused. Sync keeps working in its current mode. The install steps name the keyring requirement.

Capture: A screenshot of the messages and the status after Save and close.

Ref: MP-11, RO1-34, RO3-31

### SYNC-3 Locked keyring and toasts over Save and close

Needs: A Linux session with a keyring (GNOME Keyring or KWallet).

1. Lock the login keyring (Passwords and Keys: right-click Login > Lock). You will need your login password to unlock it again. Start the widget with a legacy token.
2. Within 20 seconds, open Settings. Try Save and close. Then close it and open a light's controls and try Turn off and Close.

Expected: The toasts do not cover Save and close, Turn off or Close, and clicking those buttons does what they say. A toast that shows after the dialog opens does not float in the middle of the window.

Capture: A screenshot of the toasts over the buttons.

Ref: RO3-04, RO1-34

### SYNC-4 Wrong or missing passphrase

1. With encrypted sync on, turn off Remember passphrase on this device and restart the app.
2. Read the sync status. Enter a wrong passphrase, then the right one.
3. Look at the sync file's modified time before and after step 2.

Expected: With a passphrase missing, the status asks you to enter it; it does not say "Turn on encryption" while encryption is already on. A wrong passphrase is reported as wrong. Neither rewrites the shared file.

Capture: The status texts and the file's modified time.

Ref: RO1-61

### SYNC-5 Resetting keys through restore or import

Needs: Two computers, A and B, syncing the same folder.

1. On B, export a settings file (Settings > Advanced > Settings files > Export settings).
2. On A, turn on High contrast with opaque panels and Holiday decorations. Sync both. Check B picked them up.
3. On B, either restore the backup made before the pull (Settings > Advanced > Settings files > Backups > Restore) or import the file from step 1. Sync both again.

Expected: B shows the earlier values. A receives them, or B keeps them. The next sync does not put the High contrast and Holiday decoration choices back on B.

Capture: The setting values on both computers after each sync.

Ref: RO1-60

### SYNC-6 OneDrive and iCloud Drive conflict copies

Needs: Windows with OneDrive, or macOS with iCloud Drive. One computer is enough.

1. Put the sync folder inside OneDrive or iCloud Drive and turn on Profile sync.
2. In that folder, copy `ha-widget-profile-sync.json` to a conflict name. OneDrive: `ha-widget-profile-sync-<your computer name>.json`. iCloud Drive: `ha-widget-profile-sync 2.json`.
3. Open Settings > Advanced > Profile syncing.

Expected: Settings warns that a conflict copy was found.

Capture: A screenshot of the Profile syncing section.

Ref: MP-31

### SYNC-7 Machine settings in the sync scope

Needs: Two computers.

1. On A, turn off Always on top, turn on Hide to tray when focus is lost, and add a tile to the tray. Sync with all scopes.
2. Look at the same three settings on B. Read the help under Sync scope.

Expected: What B shows matches what the Sync scope help promises. A setting that only makes sense on one machine does not change another machine in a harmful way; for example Always on top on a desktop-layer machine, or a tray entry on a machine with no tray. Report what changed.

Capture: The three settings on B, and the Sync scope help text.

Ref: RO1-57

## Real Home Assistant data (HA)

### HA-1 Fahrenheit and climate steps

Needs: A Home Assistant with the Imperial unit system (Settings > System > General > Unit system) and a thermostat.

1. Pin the climate entity. Look at the pin's header, the current and target temperatures, and the range.
2. Open the climate controls in the main tile and press the target step buttons.

Expected: All of it shows degrees Fahrenheit, never Celsius. The target changes by the thermostat's own step (usually 1 °F), not by 0.5.

Capture: A screenshot of the pin and the main popup, and the entity's `target_temp_step`.

Ref: UIB-01, MP-59

### HA-2 Tiles that were never used

1. Add a scene, a button or input_button and a script that have never been run. Look at their tiles, and at the bar tiles if you use Omarchy.

Expected: The tile does not read "Unknown" and does not look unavailable. A sensor that really is unknown still says so.

Capture: A screenshot of the tiles.

Ref: UIA-12

### HA-3 Large or slow Home Assistant

Needs: A Home Assistant with thousands of entities, or a network link you can slow down.

1. Slow the link until the first state snapshot takes more than 20 seconds, or use a very large instance.
2. Start the widget and watch for two minutes.

Expected: The dashboard fills in eventually, with one connection: the first snapshot is given up to 90 seconds, and the connection is not torn down and rebuilt every second or two while it loads. The panel reads "Waiting for live Home Assistant data..." meanwhile.

Capture: How long it took, and the log.

Ref: RO1-39

### HA-4 Artwork behind a redirect

Needs: Home Assistant behind a reverse proxy or single sign-on that answers some media URLs with a redirect (a 301, 302, 307 or 308), and a media player whose artwork comes from such an address.

1. Play something on that media player and look at the media tile and its dialog.
2. In the log, search for "Redirect was cancelled" and "A JavaScript error occurred in the main process".

Expected: The artwork loads. If a redirect leaves Home Assistant's own address for a different origin, that picture is not shown, and nothing else happens: no error box appears over the app, and the log has one line about the blocked redirect.

Capture: The tile, and the log lines.

Ref: MP-23

## Camera streams (CAM)

Needs: A real Home Assistant with cameras. Turn on live view in a camera tile's settings: pencil icon, Camera Preview, Live stream while visible (Higher usage).

### CAM-1 MJPEG camera and hide/show

1. Add an MJPEG camera and a second camera, and a media player with artwork, to Quick Access. Use Home Assistant over plain `http://` if you can.
2. Hide and show the widget at least eight times (turn on Hide to tray when focus is lost and switch away and back, or use the tray).
3. Look at the other camera, the artwork, and any HLS camera.

Expected: Everything keeps loading within a normal time after the eighth hide. Nothing waits ten or fifteen seconds and fails.

Capture: Which tile stopped loading and after how many cycles.

Ref: MP-04

### CAM-2 Live tile look

1. Look at the camera name and the LIVE badge on a playing live tile, over a bright frame, in the dark and the light theme.

Expected: The name and badge stay readable for as long as the stream plays.

Capture: A screenshot of each.

Ref: RO2-12

### CAM-3 Starting a slow stream

1. Click Live on a cloud or HLS camera that takes several seconds to start.

Expected: A loading spinner shows over the snapshot you were looking at until video plays; the picture is not blanked first. If no frame arrives within about 20 seconds, the viewer switches to the camera's plain MJPEG picture (or says the preview is unavailable), not a blank pane. The Snapshot and Live buttons are a pair: the one for what you are looking at is filled, and Live keeps its name instead of changing to Stop. Pressing Live while it is filled does nothing; Snapshot is the way back to the still picture. Keyboard focus starts on Snapshot, the filled one, when the viewer opens.

Capture: A recording of the first ten seconds.

Ref: RO2-13, RO2-26, RO2-22

### CAM-4 Stream that dies

1. With a live tile playing, cut the camera's power or network.
2. Watch the tile for a minute.

Expected: The tile stops saying "Live now" and LIVE within about 20 seconds of the picture freezing (15 seconds of no movement, checked every 5), and shows a snapshot state. It does not hold the last frame labeled live. An MJPEG camera that closes its stream cleanly is meant to be treated the same way: the app notices because the picture loads a second time when the stream ends, which was seen through the app's own ha:// handler (what a real Home Assistant uses) but not with a plain multipart web server. If a tile keeps saying live over a frozen MJPEG picture, say so and note the camera and integration.

Capture: A recording and how long the label stayed.

Ref: RO2-20

### CAM-5 Recovery after Home Assistant restarts

1. With camera previews on, restart Home Assistant (or drop the network for longer than two minutes) and restore it.

Expected: Camera tiles show fresh frames within about a minute after Home Assistant is back, not after five minutes. Clicking Live during the reconnect does not leave the widget stuck on "Authentication failed".

Capture: How long the tiles stayed stale.

Ref: RO2-21, RO3-25

### CAM-6 Camera shapes

1. Open a 4:3 camera and a portrait camera (a doorbell) in the expanded viewer.

Expected: The whole frame is visible, not cropped.

Capture: A screenshot of each.

Ref: CSSC3-01

### CAM-7 The viewer: sound, hiding and the time

Needs: A camera whose HLS stream carries audio (a doorbell is the usual one).

1. Click the camera tile to open the viewer and press Live. Press Mute.
2. Hide the widget to the tray (or switch to another desktop so it is covered), wait a minute, and show it again.
3. Press Snapshot, wait a minute, and press Snapshot again. Read the line under the picture each time.
4. Open the viewer on an HLS camera and watch the network use of the app while the window is hidden.

Expected: Mute is off the first time and is pressed (sound off) until you press it; pressing it again lets you hear the camera. It is not shown for an MJPEG stream. Hiding the widget stops the stream (network use drops to nothing); showing it starts the stream again, and your choice about sound is kept. The line under the picture says when the snapshot was taken, "Updated" with the time, and reads "Live now" for a stream, not the time the camera last changed state.

Capture: Whether you heard audio, the network use while hidden, and a screenshot of the line under the picture.

Ref: RO2-28, RO2-27, RO2-25

## Long-running sessions (SOAK)

Needs: A machine you can leave running for a day or more, and a throwaway profile connected to your Home Assistant. See also [Connection recovery release checks](connection-recovery.md) for the network and sleep table.

### SOAK-1 A day and a night

1. Set up a page with a camera preview, a sensor that updates every second or two, two pins and the clock card. Switch between two Quick Access pages about 50 times.
2. Note the start time and the total memory of all the app's processes (Task Manager > Details, Activity Monitor, or `ps -o rss`), plus CPU use while idle.
3. Leave the widget visible for 24 hours or more. During that time sleep the machine for at least two minutes with the window visible, and drop the network for two minutes.
4. If you have the optional companion integration, restart Home Assistant once.
5. In the morning, look at the clock card and its date. Switch between the two pages about 50 times again. Note memory and CPU use.

Expected: Memory use stays about the same; report any steady growth. Idle CPU use is roughly what it was. After resume the clock is right within a second or two, not up to a minute late. The date changed at midnight. The widget reconnects after the network drop without help. After Home Assistant restarts, the desktop shows up again in the companion integration and its commands work.

Capture: The memory and CPU readings at start and end, the time and length of each sleep and drop, and the log.

Ref: RO1-37, RO2-19, RO2-18, RO2-21

### SOAK-2 A fast sensor

Needs: A numeric sensor that updates at least once a second, with a long history.

1. Add the sensor with a chart. Watch the widget's CPU use for five minutes. Add the same sensor to a comparison graph and leave it for an hour.

Expected: CPU use stays modest; there are no repeated stalls. The chart's line stays a few hundred points however long it runs, and still shows the day's highest and lowest readings. A sensor with more than 125,000 readings in a day still draws its chart and graph.

Capture: The CPU reading and the sensor's update rate.

Ref: UIA-32, RO1-08

### SOAK-3 Pins and alerts while the window is hidden

Needs: A Home Assistant with busy entities (a dozen state changes a second is plenty), an alert on one entity, and a desktop pin on another.

1. Hide the main window to the tray. Leave it hidden for ten minutes.
2. Change the pinned entity and the alerted entity in Home Assistant, a few times each.

Expected: The pin keeps updating while the main window is hidden, and the alert fires. This holds however many times you hide and show the window.

Capture: Whether the pin and the alert stopped, and when.

Ref: RO1-09, RO1-45

## Updates (UPD)

Update checks need a build that is older than a published one. The call for testers names an older and a newer build; install the older one.

### UPD-1 Windows installer and Linux AppImage (in-app updates)

1. Install the older build. Start it and wait about a minute for the automatic check. Hide the widget to the tray and use Check for Updates in the tray menu.
2. Open Settings > Advanced > Application updates. Press Check for updates. While an update downloads, close Settings and open it again.
3. When it is ready, press Install update.
4. After the restart, look at the version in Settings > Advanced and press What's new.
5. Turn off the network and press Check for updates.
6. With Settings open on Advanced and the network off, let the machine sleep and wake (or leave the widget running for more than six hours).

Expected: A newer build is announced in some visible way, including from the tray menu while the widget is hidden: Check for Updates in the tray brings the widget up on Settings > Advanced, with the update line saying that a check is running and then what it found. The status line reads "Update available" (with the version), then shows the download progress, then "Update v… ready to install". Reopening Settings during the download keeps that state. A system notification, if shown, names "HA Desktop Widget". Install update restarts the app (an AppImage comes back by itself) and the new version is shown. With no network the check ends with a readable error, not an endless "Checking for updates...". What's new opens this version's page on GitHub in your browser. A check the app makes by itself, such as after waking without a network, leaves the update line as it was (no "Checking for updates..." and no error), and does not replace the progress bar of a download that is running.

Capture: Screenshots of each state, the notification, and the log.

Ref: UIC-13, MP-19, MP-47, MP-52, MP-51, MP-01, MP-77

### UPD-2 macOS, .deb, Arch and Windows Portable (manual updates)

1. Install the older build. Settings > Advanced > Application updates: press Check for updates.
2. Read the status line and the button that appears.
3. Press the button. Close and reopen Settings.
4. Use Check for Updates in the tray menu with the widget hidden.
5. Leave the older build running for a day while a newer release exists.

Expected: The status is one sentence that says an update exists, with the version in it, and names the button that is shown (Download update, or Download portable update on the Portable build). The button opens the Releases page in your browser. Reopening Settings keeps the state and the button still works. The tray menu entry brings the widget up on the update line with the answer. Leaving the widget running does not leave you unaware of a newer release: the app looks every six hours (and when the machine wakes, if one is due) and shows one notification, naming HA Desktop Widget, for each new version.

Capture: Screenshots of the status line and the button.

Ref: MP-50, UIC-13, MP-19, MP-51

### UPD-3 Portable notice in other languages

Needs: The Portable build and the Hindi or Arabic pack.

1. Choose Hindi or Arabic. Press Check for updates with an older build.
2. Compare the notice with the button's label.

Expected: The notice quotes the button as it is labeled in that language, not the English button name. Hindi sentences have no English words left in them.

Capture: A screenshot of the notice and the button.

Ref: I18N-12

### UPD-4 Beta channel

1. Settings > Advanced > Application updates: turn Receive beta updates on and press Check for updates without pressing Save and close. Then turn it off and check again, again without saving.

Expected: Pre-release builds are offered only when the switch is on, as the switch shows it right now; you do not have to save first.

Capture: The status line in each state.

Ref: none

## Website (WEB)

### WEB-1 Layout, forced colors and copy

1. Open hadesktopwidget.com at widths of 768, 810, 820 and 1000 pixels (an iPad in portrait, or your browser's device toolbar).
2. On Windows with a contrast theme on, open the home page and the companion page.
3. On a Chromebook, open the download page.
4. Compare the Settings screenshots on the site with the current app, on a high-DPI screen. Read the "Running in about two minutes" steps and the Linux install steps.

Expected: The header (brand and navigation) stays on one line, headings reached by an anchor are not hidden under it, and the last feature tile does not sit alone in a half-empty row. In a contrast theme the accent swatches, the selected states and the toggle are visible. A Chromebook is not offered the Linux x86_64 AppImage as its download. Screenshots match the current app and are sharp. The steps mention the first-run setup, and the Linux steps mention the keyring.

Capture: A screenshot at each width and for each point that fails.

Ref: CSSA3-35, CSSA3-34, RO3-39, SM3-41, SM3-42, RO3-31

### WEB-2 After the next site deploy

1. Look at the download page when a stable release and a newer pre-release both exist. Read the Privacy page, and look for account deletion or subscription wording.

Expected: The stable release is not described as "the beta". No page mentions account deletion, subscriptions or "Cloud Sync is planned for 4.0". The Privacy page covers the desktop app, including update checks and language-pack downloads.

Capture: A screenshot of the page and its address.

Ref: RO3-07, RO3-08, RO3-09
