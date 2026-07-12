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

HA Desktop Widget gives you a transparent, Rainmeter-style desktop widget for controlling and monitoring your most-used Home Assistant entities without opening a browser.

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
- Cross-platform builds for Windows, macOS, and Linux
- Optional profile sync through a cloud-folder JSON file, with local-only connection/token data

## Screenshots

The README includes screenshots of the main widget, edit/reorganize mode, light controls, personalization settings, and weather effects. I kept this first post light on media because of the forum's new-user link limits.

## Setup

1. Download the latest build for your OS from the releases page.
2. Open the app and go to Settings.
3. Enter your Home Assistant URL.
4. Create a long-lived access token in Home Assistant and paste it into the app.
5. Add the entities you want in Quick Access.

Tokens are stored locally and encrypted at rest when supported by the OS. Profile sync is opt-in, and Home Assistant URL/token data stays local rather than being written into the sync file.

## Feedback welcome

I would love feedback from other Home Assistant users, especially around:

- Entity types you would expect a desktop widget to support
- Desktop pin workflows
- Notification/alert behavior
- Linux/macOS/Windows packaging quirks
- Anything that feels confusing during first setup

The project is MIT licensed and open source. Issues and pull requests are welcome.
```
