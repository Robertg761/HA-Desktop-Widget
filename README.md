# HA Desktop Widget

A transparent, always-on-top desktop widget for Home Assistant that provides quick access to your smart home devices from your desktop.

[![CI (Windows)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml)
[![Release (Windows)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Current version: 1.1.0

- Download: https://github.com/Robertg761/HA-Desktop-Widget/releases

## Features

- Real-time entity updates (WebSocket)
- Drag-and-drop custom dashboard layout (edit mode)
- Tabs: Dashboard, Scenes, Automations, Media, Cameras, Weather, History, Services
- Quick controls for lights, switches, media players, climate
- Filter by domain and area; hide entities you don’t want
- Favorites section on default dashboard
- Camera feeds with refresh handling and cleanup
- Toast notifications, clean error handling, performance improvements
- State badges for many domains (light, switch, media, climate, automation, lock, cover, binary_sensor, person/device_tracker, alarm, fan, vacuum)
- Theming: Auto/Light/Dark with OS preference support
- Close-to-tray behavior; tray shortcuts for Settings, Update check, Report Issue
- Auto-updates from GitHub Releases (background download, install on quit)

## Installation

### Option A: Download a build
1) Go to Releases: https://github.com/Robertg761/HA-Desktop-Widget/releases
2) Download one of the artifacts:
   - HA Desktop Widget-<version>-win-x64-Setup.exe (recommended)
   - HA Desktop Widget-<version>-win-x64-Portable.exe (no installer)
3) Run the app. On first launch, open Settings (⚙️), set your Home Assistant URL and Long-Lived Access Token.

### Option B: Build from source (Windows)
```bash
npm install
npm start     # dev run
# Packaging
npm run dist:win   # NSIS installer
npm run dist       # NSIS + Portable
```
Artifacts are written to `dist/`.

## Configuration
- Stored at the OS user data directory, e.g. `%AppData%/Home Assistant Widget/config.json`.
- Legacy `config.json` in the app folder is migrated on first run.
- Never commit tokens. `config.json` is ignored by .gitignore.

## Using the app
- Header buttons: Filter, Layout (edit mode), Settings, Refresh, Minimize, Close
- Tabs render only when active for performance
- Edit mode lets you add/remove/reorder dashboard entities via drag-and-drop
- Tray menu: Open Settings, Check for Updates, Report Issue, Quit

## Updates
- Packaged builds auto-check for updates, download in the background, and install on quit.
- You can also trigger a manual check from the tray: Check for Updates.

## Building & Releasing
- We use electron-builder for Windows packaging.
- GitHub Actions builds on pull requests (artifacts attached) and on tag push (v*) publishes a Release.
  - Create a new release tag to publish:
    ```bash
    git tag v1.0.0
    git push origin v1.0.0
    ```

## Troubleshooting
- Can’t connect: verify HA URL, token validity, and local network reachability. Check firewall.
- Transparency: requires Windows 10/11 (or a compositor on Linux). macOS not targeted here.
- Performance: increase update interval, reduce rendered entities, or reduce visual effects.

## Contributing
- Issues and PRs are welcome: https://github.com/Robertg761/HA-Desktop-Widget/issues

## License
MIT
