# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HA Desktop Widget is an Electron-based desktop application that provides a semi-transparent, customizable widget for controlling Home Assistant smart home devices. It features real-time updates via WebSocket, drag-and-drop customization, and Rainmeter-style aesthetics.

## Development Commands

```bash
# Development
npm install          # Install dependencies
npm start            # Run in production mode
npm run dev          # Run in development mode (opens DevTools)

# Quality Assurance
npm run lint         # Run ESLint
npm run lint:fix     # Fix auto-fixable lint issues
npm run format       # Format code with Prettier
npm test             # Run Jest tests

# Building
npm run dist         # Build Windows installer and portable
npm run dist:win     # Build Windows installer only
```

## Architecture

### Process Structure

This is a standard Electron app with two main processes:

- **Main Process** (`main.js`): Handles window management, system tray, IPC communication, auto-updates, global hotkeys, and custom protocol (`ha://`) for camera proxying
- **Renderer Process** (`renderer.js`): Initializes UI modules, manages WebSocket event handlers, and coordinates the application state

### Module Organization

The `src/` directory contains modular JavaScript files:

- `state.js`: Centralized state management (CONFIG, STATES, SERVICES, AREAS, etc.)
- `websocket.js`: WebSocket connection manager with EventEmitter pattern for Home Assistant API
- `ui.js`: UI rendering, entity interaction, drag-and-drop, reorganize mode
- `ui-utils.js`: Toast notifications, loading states, status indicators, theme management
- `settings.js`: Settings modal, configuration persistence
- `hotkeys.js`: Global hotkey registration and management
- `alerts.js`: Entity alert configuration and notifications
- `camera.js`: Camera feed handling (snapshots, MJPEG streams, HLS)
- `utils.js`: Utility functions for formatting, time conversion, etc.
- `icons.js`: SVG icon definitions and emoji replacement

### State Management (state.js)

The `state.js` module provides centralized state management with getter/setter functions:

**Core State Properties:**
- `CONFIG` - Application configuration (read-only, use `setConfig()` to update)
- `STATES` - Home Assistant entity states (use `setStates()`, `updateEntityState()`)
- `SERVICES` - Available HA services (use `setServices()`)
- `AREAS` - Area registry (use `setAreas()`)
- `UNIT_SYSTEM` - HA unit preferences (temperature, wind_speed, etc., use `setUnitSystem()`)
- `WS` - WebSocket instance (use `setWS()`)
- `PENDING_WS` - Pending WebSocket requests map
- `FILTERS` - Entity filtering state

**UI State:**
- Camera state: `LIVE_CAMERAS`, `CAMERA_REFRESH_INTERVAL`, `ACTIVE_HLS`
- Timer state: `TIMER_MAP`, `TIMER_TICK`, `TIMER_SENSOR_MAP`
- Motion popup: `MOTION_POPUP`, `MOTION_POPUP_TIMER`, `MOTION_POPUP_CAMERA`
- Layout: `TAB_LAYOUTS`, `EDIT_MODE_TAB_ID`

**Important:** Always use setter functions (e.g., `setConfig()`) instead of direct assignment. Direct assignment to read-only getters will fail.

### Communication Patterns

1. **Main ↔ Renderer IPC**: Uses `ipcMain.handle()` and `ipcRenderer.invoke()` for async request/response
   - **Available IPC Channels**:
     - `get-config`, `update-config`, `save-config` - Configuration management
     - `set-opacity`, `set-always-on-top`, `get-window-state` - Window controls
     - `minimize-window`, `focus-window`, `restart-app`, `quit-app` - App lifecycle
     - `register-hotkey`, `unregister-hotkey`, `register-hotkeys`, `toggle-hotkeys`, `validate-hotkey` - Hotkey management
     - `register-popup-hotkey`, `unregister-popup-hotkey`, `get-popup-hotkey`, `is-popup-hotkey-available` - Popup hotkey (optional feature)
     - `set-entity-alert`, `remove-entity-alert`, `toggle-alerts` - Alert management
     - `check-for-updates`, `quit-and-install` - Auto-updates
     - `get-app-version`, `open-logs` - Utility functions
   - **Main → Renderer Events**:
     - `hotkey-triggered` - Global hotkey activated
     - `hotkey-registration-failed` - Hotkey registration error
     - `auto-update` - Update status changes
     - `open-settings` - Triggered from tray menu
2. **WebSocket Events**: `websocket.js` emits events (`open`, `message`, `close`, `error`) that `renderer.js` listens to
3. **State Updates**: Modules read from centralized `state.js` and call setter functions to update state
4. **Circular Dependency Prevention**: `settings.js` receives UI functions as `uiHooks` parameter instead of importing `ui.js` directly

### Configuration

- **Storage**: Config stored in `%AppData%/Home Assistant Widget/config.json`
- **Structure**: Main config properties include:
  - `homeAssistant` (url, token, tokenEncrypted, tokenResetReason)
  - `favoriteEntities`, `customEntityNames` - Quick Access customization
  - `selectedWeatherEntity` - User-selected weather entity (null for auto-detect)
  - `primaryMediaPlayer` - Preferred media player entity
  - `globalHotkeys`, `entityAlerts`, `popupHotkey` - Automation and notifications
  - `windowPosition`, `windowSize`, `opacity` - Window preferences
  - `ui` (theme, highContrast, opaquePanels, density) - UI customization
  - `filters`, `customTabs` - Entity filtering and organization
- **Access**: Use `window.electronAPI.getConfig()` and `window.electronAPI.updateConfig(newConfig)` from renderer
- **Theme Options**: `ui.theme` can be 'auto' (system), 'light', or 'dark'; supports high contrast mode and density settings (comfortable/compact)

### WebSocket Flow

1. Renderer calls `websocket.connect()`
2. WebSocket sends auth message with token
3. On `auth_ok`, request `get_states`, `get_services`, `get_config` (for unit system), and area registry
4. Subscribe to `state_changed` events for real-time updates
5. Implements exponential backoff reconnection on disconnect (1s → 30s max with jitter)
6. Ping/pong heartbeat keeps connection alive
7. Reconnection only triggered when connection parameters (URL, token, updateInterval) change in settings

### Application Initialization

1. `DOMContentLoaded` event triggers `init()` in renderer.js
2. Load configuration via `ipcRenderer.invoke('get-config')`
3. Wire up UI event listeners (`wireUI()`)
4. Replace emoji icons with SVG (`replaceEmojiIcons()`)
5. Apply theme and UI preferences
6. Initialize hotkeys and alerts modules
7. Show UI (even if disconnected)
8. Connect to WebSocket in background
9. On WebSocket open → Auth → Fetch states/services/areas
10. Render UI with fetched data

### Custom Protocol

The `ha://` protocol proxies Home Assistant endpoints:
- `ha://camera/<entityId>` → Camera snapshot
- `ha://camera_stream/<entityId>` → MJPEG camera stream
- `ha://hls/<path>` → HLS manifest/segments for cameras
- `ha://media_artwork/<base64-encoded-url>` → Media player artwork (Spotify, YouTube, etc.)

This bypasses CORS and authentication issues in the renderer. The media_artwork endpoint handles both external URLs and HA-relative paths, adding authentication headers and caching as needed.

## Key Features Implementation

### Quick Access (Favorites)

- Stored in `config.favoriteEntities` array
- Drag-and-drop reordering in reorganize mode
- Custom entity names stored in `config.customEntityNames` object
- Rendered by `ui.js` functions

### Global Hotkeys

- Main process registers shortcuts via `globalShortcut.register()`
- Validates hotkeys to avoid system shortcut conflicts
- Sends `hotkey-triggered` IPC event to renderer
- Config stored in `config.globalHotkeys.hotkeys` (entityId → {hotkey, action})

### Entity Alerts

- Monitor entity states and trigger notifications
- Conditions: equals, greater than, less than, between, contains
- Config stored in `config.entityAlerts.alerts` (entityId → alert config)

### Auto-Updates

- Uses `electron-updater` with GitHub releases
- Automatically downloads and installs updates
- Sends `auto-update` events to renderer for UI feedback

### Popup Hotkey (Optional Feature)

- **Dependency**: Requires `uiohook-napi` (optional dependency in package.json)
- **Behavior**: Hold a configured key to bring window to front, release to hide
- **Platform Support**: Works on platforms where uiohook-napi compiles (Windows, some Linux/macOS)
- **Graceful Fallback**: If unavailable, feature is disabled with UI feedback in settings
- **Config**: Stored in `config.popupHotkey` (key, enabled)
- **IPC Channels**: `register-popup-hotkey`, `unregister-popup-hotkey`, `get-popup-hotkey`, `is-popup-hotkey-available`

### Weather Entity Selector

- **Feature**: Long-press weather card to select preferred weather entity
- **Config**: `config.selectedWeatherEntity` (null for auto-detect, or entity_id string)
- **Auto-detect**: When null, uses first alphabetically-sorted weather entity
- **UI**: Modal shows all weather entities with visual distinction between selected and auto-detected
- **Real-time Update**: Weather card updates immediately when entity is selected

### Unit System Support

- **State**: `UNIT_SYSTEM` in state.js stores HA's unit preferences
- **Fetched Via**: `get_config` WebSocket request on authentication
- **Units Tracked**: temperature, length, wind_speed, pressure, precipitation, volume, mass
- **Usage**: Weather card and other UI components respect user's configured units (metric/imperial)
- **Fallback**: Entity-provided units take precedence over global unit system

### Media Player Features

- **Primary Player**: `config.primaryMediaPlayer` stores preferred media player entity
- **Media Tile**: Displays artwork, playback controls, seek bar for selected media player
- **Artwork Proxy**: Uses `ha://media_artwork` protocol to load album art from Spotify, YouTube, etc.
- **Controls**: Play/pause, previous/next track, seek bar with live updates
- **Auto-update**: Seek bar updates every second during playback

## Testing

- Jest configured with jsdom environment
- No tests currently exist (tests/ directory not created yet)
- Jest configuration present in package.json
- Run with `npm test` (will report "no tests found")

## Security

### Renderer Process Isolation

- **Context Isolation**: `contextIsolation: false` (set for CommonJS compatibility)
- **Node Integration**: `nodeIntegration: true` (required for CommonJS modules)
- **IPC Whitelisting**: Despite the above settings, `preload.js` provides a security boundary by exposing only whitelisted IPC channels through `window.electronAPI`
- **Sandboxed Communication**: All renderer IPC calls must go through the explicit `window.electronAPI` interface defined in preload.js

### Token Encryption

- **Secure Storage**: Home Assistant tokens are encrypted at rest using Electron's `safeStorage` API
- **Automatic Migration**: Plaintext tokens from older versions are automatically migrated to encrypted storage on first launch
- **Graceful Fallback**: If encryption is unavailable on the platform, tokens are stored in plaintext with appropriate warnings
- **Token Reset**: Includes mechanisms for token reset when encryption becomes available or when migration is needed
- **Config Properties**: `tokenEncrypted` (boolean) and `tokenResetReason` (string) track encryption status

### Access Control

- All IPC channels are explicitly whitelisted in `preload.js`
- No direct Node.js or Electron API access from renderer without going through preload
- WebSocket connections authenticated with encrypted tokens

## Important Patterns

### Error Handling and Logging

- Both main and renderer use `electron-log` for structured logging
- Uncaught errors are caught with `log.errorHandler.startCatching()`
- WebSocket errors trigger reconnection with exponential backoff
- Log files accessible via Settings → "View Logs" button (`ipcRenderer.invoke('open-logs')`)
- Log levels: error, warn, info, debug, verbose, silly

### UI State Management

- Loading states controlled via `uiUtils.showLoading()`
- Connection status shown via `uiUtils.setStatus()`
- Toast notifications via `uiUtils.showToast(message, type, duration)`

### Entity Control

- Call services via `websocket.callService(domain, service, serviceData)`
- Returns a promise that resolves when Home Assistant responds
- Entity state updates arrive via WebSocket `state_changed` events

## Window Management

- **Window Type**: Transparent frameless window (`transparent: true, frame: false`)
- **Draggable Regions**: Elements with CSS `-webkit-app-region: drag` can drag the window
- **Transparency**: Opacity configurable from 50-100% (0.5-1.0)
- **Always on Top**: Configurable via settings or tray menu
- **System Tray**: Click to toggle visibility, right-click for context menu
  - Menu options: Show/Hide, Always on Top, Reset Position, DevTools, Reload, Settings, Check for Updates, Report Issue, Quit
- **Minimize Behavior**: Minimizes to tray instead of taskbar (`skipTaskbar: true`)

## Building and Distribution

- Uses `electron-builder` for packaging
- Targets: NSIS installer and portable executable
- Icon located in `build/icon.ico`
- GitHub Actions workflows handle CI (`ci.yml`) and releases (`release.yml`)
- Auto-updates via `electron-updater` pull from GitHub releases
