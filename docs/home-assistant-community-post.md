# Home Assistant Community Forum Post Draft

Category: Share your Projects! -> Dashboards & Frontend

Title:

```text
HA Desktop Widget - lightweight desktop widgets and quick controls for Home Assistant
```

Post body:

```markdown
Hi everyone,

I wanted to share a project I have been working on: **HA Desktop Widget**.

It is an unofficial community project for Home Assistant, focused on being a lightweight desktop widget and quick-control surface.

GitHub / downloads:
https://github.com/Robertg761/HA-Desktop-Widget/releases

Repository:
https://github.com/Robertg761/HA-Desktop-Widget

## What it does

HA Desktop Widget gives you a frosted-glass desktop widget for controlling and monitoring your most-used Home Assistant entities without opening a browser.

Some highlights:

- Real-time Home Assistant entity updates over the WebSocket API
- Customizable quick-access grid for lights, switches, fans, covers, locks, sensors, climate, media players, cameras, scenes, scripts, buttons, timers, automations, and more
- Movable/resizable desktop pins for selected entities
- Custom names and icons without changing your Home Assistant entity names
- Light/dark themes, custom accent/background colors, opacity controls, and frosted glass effects
- Optional weather animations such as rain, snow, sun, clouds, and storms
- Global hotkeys for entities and a popup hotkey to bring the widget forward
- Desktop notifications for entity state changes
- System tray support and optional start-at-login
- Cross-platform builds for Windows x64, universal macOS (Intel and Apple Silicon), and Linux x64
- Optional profile sync through a cloud-folder JSON file, with local-only connection/token data

## Screenshots

The README includes screenshots of the main widget, edit/reorganize mode, light controls, appearance settings, and weather effects. I kept this first post light on media because of the forum's new-user link limits.

## Setup

1. Download the latest build for your OS from the releases page.
2. Open the app and enter your Home Assistant URL.
3. Approve the connection in your browser. You sign in on Home Assistant's own page, so the app never sees your password.
4. Pick a room to start from, or add the entities you want to Quick Access.

Your sign-in is stored locally and encrypted at rest with the OS's secure storage. A long-lived access token is still available as an advanced option. Profile sync is opt-in, and Home Assistant URL and sign-in data stay local rather than being written into the sync file.

## Feedback welcome

I would love feedback from other Home Assistant users, especially around:

- Entity types you would expect a desktop widget to support
- Desktop pin workflows
- Notification/alert behavior
- Linux/macOS/Windows packaging quirks
- Anything that feels confusing during first setup

The project is MIT licensed and open source. Issues and pull requests are welcome.
```
