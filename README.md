# HA Desktop Widget

A semi-transparent desktop widget for Home Assistant that provides quick access to your smart home devices from your desktop.

[![CI](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml)
[![Release](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

- Download: https://github.com/Robertg761/HA-Desktop-Widget/releases

- [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-me-orange)](https://github.com/sponsors/robertg761)

![Main View](images/Main_View.png?v=20260601) ![Edit View](images/Edit_View.png?v=20260601) ![Light Adjust](images/Light_Adjust.png?v=20260601)

## Settings: Personalization

![Personalization Tab](images/Personalization_Tab.png?v=20260601)

The Settings modal is organized into General, Personalization, Hotkeys, Alerts, and Advanced. Personalization covers color themes, window effects, weather animations, primary cards, custom entity icons, and media tile selection. General includes Home Assistant connection, window behavior, language packs, profile sync, and update checks.

## Weather Effects

![Rain Effect](images/Rain_Effect.png?v=20260601) ![Snow Effect](images/Snow_Effect.png?v=20260601)

## Features

### Smart Home Control
- **Real-time Updates**: WebSocket connection for instant entity state changes
- **Quick Access Dashboard**: Customizable grid of your most-used entities
- **Entity Management**: Add, remove, rename, and reorder entities with drag-and-drop
- **Desktop Pins**: Pin selected Quick Access entities as movable, resizable desktop tiles
- **Custom Names & Icons**: Rename entities and override entity icons without changing Home Assistant
- **Tile Options**: Adjust selected Quick Access readout sizing for dense or prominent tiles
- **Interactive Controls**: Toggle lights, switches, scenes, and more with a single click

### Modern Interface
- **Rainmeter-style Design**: Clean, transparent desktop widget aesthetic
- **Responsive Layout**: Auto-sizing tiles that adapt to content
- **Dark/Light Themes**: Automatic theme switching based on system preferences
- **Color Personalization**: Built-in and custom accent/background colors with live preview
- **Weather Effects**: Optional subtle rain, snow, clouds, sun, and storm animations when frosted glass is enabled
- **Smooth Animations**: Fluid drag-and-drop and hover effects
- **Toast Notifications**: Real-time feedback for all actions

### Entity Support
- **Lights**: Toggle on/off, brightness control, and desktop-pin brightness presets
- **Switches, Fans & Input Booleans**: Simple on/off controls, with fan speed controls where available
- **Covers & Locks**: Open/close and lock/unlock controls
- **Sensors & Binary Sensors**: Real-time value display with units and state-aware icons
- **Timers**: Live countdown displays for active timers
- **Cameras**: Live feed viewing with snapshot fallback
- **Climate**: Temperature display and control
- **Media Players**: Play/pause, previous/next, artwork, seek bar, and 10-second rewind/fast-forward where supported
- **Scenes, Scripts & Buttons**: One-click scene activation, script running, and button/input-button pressing
- **Automations**: Trigger, toggle, enable, or disable from configured hotkeys

### Advanced Features
- **Auto-Updates**: GitHub release checks for packaged builds, with manual download flow for portable builds
- **System Tray**: Minimize to tray with quick access menu
- **Start at Login**: Optional OS login startup control
- **Configuration**: Easy setup with Home Assistant URL and token
- **Performance**: Optimized rendering and memory management
- **Cross-Platform**: Windows, macOS, and Linux support with transparency effects where available
- **Personalization**: Accent/background themes, custom colors, window opacity, frosted glass, weather effects, custom icons, and desktop pins
- **Localization**: Auto/system language mode with downloadable offline language packs
- **Hotkeys**: Global entity hotkeys and popup hotkey to bring the window to front
- **Alerts**: Desktop notifications for entity state changes
- **Primary Cards**: Configure the top two cards (weather/time or any entity)
- **Media Tile**: Choose a primary media player or hide the tile
- **Profile Sync (Opt-in)**: Keep personalization/settings in sync across devices via a shared cloud-folder JSON file

## Roadmap

Planned for a future release:

- **HA Assist voice**: A microphone button wired to Home Assistant's Assist pipeline (speech-to-text → intent → text-to-speech) so you can talk to your smart home from the desktop. Deferred as a standalone update because it needs the full HA server-side audio pipeline and real device testing.

## Quick Start

### Download & Install
1. Go to the [Releases](https://github.com/Robertg761/HA-Desktop-Widget/releases) page and download the latest available build for your OS.
2. Windows: run the `.exe` installer or portable build. macOS: open the `.dmg` or `.zip`. Linux: use the `.AppImage` or install the `.deb` package.
3. Run the app and click the Settings button to configure your Home Assistant connection.

### First-Time Setup
1. **Get your Home Assistant URL**: Usually `http://your-ha-ip:8123` or `https://your-ha-domain.com`
2. **Create a Long-Lived Access Token**:
   - Go to your Home Assistant profile (click your avatar)
   - Scroll down to "Long-lived access tokens"
   - Click "Create token" and give it a name like "Desktop Widget"
   - Copy the generated token
3. **Configure the widget**:
   - Paste your HA URL and token in Settings
   - Click "Save" - the widget will connect automatically
4. **Add entities**: Click the "+" button to add your favorite entities to Quick Access

## How to Use

### Quick Access Management
- **Add Entities**: Click the "+" button to search and add entities to your dashboard
- **Reorder**: Click the Reorganize button to enter reorganize mode, then drag and drop to reorder
- **Rename**: In reorganize mode, click the edit icon to set custom display names
- **Remove**: In reorganize mode, click the remove button to remove entities
- **Pin to Desktop**: In reorganize mode or the tile context menu, pin supported Quick Access entities as standalone desktop tiles

### Entity Interactions
- **Lights**: Click to toggle, long-press for brightness slider
- **Fans**: Click to toggle, long-press for speed controls
- **Covers**: Click to open/close, long-press for open/stop/close controls
- **Climate**: Long-press for target temperature and mode controls
- **Media Players**: Use the media tile controls or long-press a media player for details and seek controls
- **Cameras**: Click to view live feed in popup window
- **Sensors**: Display real-time values with automatic unit formatting
- **Timers**: Show live countdown when active
- **Scenes, Scripts & Buttons**: Click to activate, run, or press instantly

### System Integration
- **Minimize to Tray**: Click the minimize button to hide to system tray
- **Auto-Updates**: Supported packaged builds check for updates in the background; portable builds offer a GitHub download link
- **Start at Login**: Enable or disable startup from Settings > General
- **Settings**: Access via the Settings button or right-click the tray icon

### Settings Highlights
- **General**: Configure Home Assistant connection, always-on-top, startup behavior, language packs, profile sync, and updates
- **Themes**: Choose built-in or custom accent and background colors
- **Window Effects**: Adjust opacity, toggle frosted glass, and enable subtle weather effects
- **Primary Cards**: Pin weather/time or any entity to the top two cards
- **Custom Entity Icons**: Search or paste emoji/glyph overrides for entity icons
- **Media Tile**: Select the primary media player or hide the tile
- **Hotkeys**: Configure global entity hotkeys, action-specific shortcuts, and a popup hotkey (hold or toggle)
- **Alerts**: Enable desktop notifications for entity state changes or target states
- **Advanced**: Open logs and enable detailed interaction diagnostics when troubleshooting

## Advanced Usage

### Build from Source
```bash
git clone https://github.com/Robertg761/HA-Desktop-Widget.git
cd HA-Desktop-Widget
npm install
npm run dev   # Development mode (opens DevTools)
npm start     # Regular run (builds the renderer, then starts Electron)
npm run lint  # Run ESLint
npm test      # Run Jest tests
npm run dist        # Build Windows NSIS and portable artifacts
npm run dist:win    # Build Windows NSIS installer artifacts
npm run dist:mac    # Build macOS distribution artifacts
npm run dist:linux  # Build Linux AppImage and deb artifacts
```

### Release Channels
- **Stable releases**: Push a tag like `v3.5.4`. GitHub Actions publishes a normal release, and existing users receive it through the standard update path.
- **Tester prereleases**: Push a SemVer prerelease tag like `v3.5.4-beta.1`. GitHub Actions marks it as a prerelease. Only users who enable **Receive beta updates** in Settings -> Application Updates are offered these builds.
- **Portable builds**: Portable users still update manually, but the update checker will show prerelease portable downloads when beta updates are enabled.

### Configuration
- **Config Location**: Stored as `config.json` in Electron's userData directory.
  - **Windows (packaged)**: `%AppData%/Home Assistant Widget/config.json`
  - **macOS (packaged)**: `~/Library/Application Support/HA Desktop Widget/config.json`
  - **Linux (packaged)**: `~/.config/HA Desktop Widget/config.json`
  - **Development builds**: typically use `home-assistant-widget` as the folder name
- **Config Contents**: `homeAssistant` (url, token, tokenEncrypted), `favoriteEntities`, `customEntityNames`,
  `desktopPins`, `customEntityIcons`, `quickAccessTileOptions`, `tileSpans`, `selectedWeatherEntity`, `primaryMediaPlayer`,
  `globalHotkeys`, `entityAlerts`, `popupHotkey`, `windowPosition`, `windowSize`, `opacity`, `ui` (theme, accent, background,
  language, customColors, use24HourClock, weatherEffectsEnabled, weatherOverride, enableInteractionDebugLogs),
  and `customTabs`. Other stored values include `primaryCards`, `alwaysOnTop`, `frostedGlass`,
  `popupHotkeyHideOnRelease`, `popupHotkeyToggleMode`, `updates`, and `profileSync`.
- **Security**: Tokens are never committed to version control and are encrypted at rest when supported by the OS

### Profile Sync (Opt-in)
- **Providers**: `cloudFile` (generic), `googleDrive`, `icloudDrive`, and `syncthing` all use the same cloud-folder JSON sync file model.
- **Default sync folder**: Starts in the app's local data folder (`userData`) and stores profile data in `ha-widget-profile-sync.json`.
- **Folder changes**: When switching folders, the app can copy the existing sync file to the new location or keep the current folder.
- **Sync scope controls**: Choose presets (`All`, `Visual`, `Quick Access`) or use advanced custom sections for Quick Access/layout, visual personalization, automation/alerts, and connection/media preferences.
- **Need help button**: Opens profile sync setup instructions in your browser.
- **Sync behavior**: Pull on startup, push on profile changes (debounced), and periodic sync every 5 minutes (default).
- **Conflict handling**: First-time setup prompts you to keep local profile or use remote profile; ongoing conflicts use last-write-wins.
- **Encryption**: Optional passphrase encryption for synced payloads (`AES-256-GCM` with `scrypt` key derivation).
- **Schema compatibility**: Sync writes use profile sync schema v2; older app versions must update to participate in sync.
- **Local-only data**: Home Assistant URL/token, window position/size, startup setting, and profile-sync internals remain local.

## Troubleshooting

### Connection Issues
- **Verify URL**: Ensure your Home Assistant URL is accessible from your computer
- **Check Token**: Make sure your long-lived access token is valid and not expired
- **Firewall**: Ensure your OS firewall allows the app to connect to your network
- **Network**: Test connectivity by opening your HA URL in a web browser

### Performance Issues
- **Reduce Entities**: Limit the number of entities in Quick Access
- **Visual Effects**: Disable transparency if experiencing performance issues

### Common Solutions
- **Restart**: Close and reopen the app if entities aren't updating
- **Reconnect**: Go to Settings and click "Save" to reconnect to Home Assistant
- **Check Logs**: Use Settings > View Logs to open the log file location

## Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues
- **Bug Reports**: Use the [Issues](https://github.com/Robertg761/HA-Desktop-Widget/issues) page
- **Feature Requests**: Submit enhancement ideas with detailed descriptions
- **Documentation**: Help improve this README or add usage examples

### Development
- **Fork & Clone**: Fork the repository and clone your fork
- **Create Branch**: Make changes in a feature branch
- **Test**: Ensure your changes work and don't break existing functionality
- **Submit PR**: Create a pull request with a clear description of your changes

### Code Style
- **ESLint**: Follow the existing code style (run `npm run lint`)
- **Comments**: Add comments for complex logic
- **Testing**: Add tests for new features when possible

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Electron](https://electronjs.org/) for cross-platform desktop apps
- Uses [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket) for real-time updates
- Inspired by the clean aesthetic of [Rainmeter](https://www.rainmeter.net/) desktop widgets

---

**If you find this project useful, please give it a star on GitHub!**
