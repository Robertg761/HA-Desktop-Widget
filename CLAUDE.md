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

### Communication Patterns

1. **Main ↔ Renderer IPC**: Uses `ipcMain.handle()` and `ipcRenderer.invoke()` for async request/response
   - **Available IPC Channels**:
     - `get-config`, `update-config`, `save-config` - Configuration management
     - `set-opacity`, `set-always-on-top`, `get-window-state` - Window controls
     - `minimize-window`, `focus-window`, `restart-app`, `quit-app` - App lifecycle
     - `register-hotkey`, `unregister-hotkey`, `register-hotkeys`, `toggle-hotkeys`, `validate-hotkey` - Hotkey management
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
- **Structure**: Includes `homeAssistant` (url, token), `favoriteEntities`, `customEntityNames`, `globalHotkeys`, `entityAlerts`, `windowPosition`, `windowSize`, `opacity`, `ui` (theme, highContrast, opaquePanels, density), `filters`, etc.
- **Access**: Use `ipcRenderer.invoke('get-config')` and `ipcRenderer.invoke('update-config', newConfig)`
- **Theme Options**: `ui.theme` can be 'auto' (system), 'light', or 'dark'; supports high contrast mode and density settings (comfortable/compact)

### WebSocket Flow

1. Renderer calls `websocket.connect()`
2. WebSocket sends auth message with token
3. On `auth_ok`, request `get_states`, `get_services`, and area registry
4. Subscribe to `state_changed` events for real-time updates
5. Implements exponential backoff reconnection on disconnect (1s → 30s max with jitter)
6. Ping/pong heartbeat keeps connection alive

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

The `ha://` protocol proxies Home Assistant camera endpoints:
- `ha://camera/<entityId>` → Snapshot
- `ha://camera_stream/<entityId>` → MJPEG stream
- `ha://hls/<path>` → HLS manifest/segments

This bypasses CORS and authentication issues in the renderer.

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

## Testing

- Jest with jsdom environment
- Tests located in `tests/` directory
- Currently minimal coverage (only keyboard.test.js exists)
- Run with `npm test`

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
