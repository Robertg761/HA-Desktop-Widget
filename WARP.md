# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Home Assistant Desktop Widget - An Electron-based Windows desktop application providing a semi-transparent widget for quick access to Home Assistant smart home entities with real-time WebSocket updates.

## Common Commands

### Development
```bash
npm start              # Run app in development mode
npm run dev           # Run app with --dev flag
```

### Building
```bash
npm run dist          # Build both NSIS installer and portable exe for Windows
npm run dist:win      # Build only NSIS installer for Windows
```

### Code Quality
```bash
npm run lint          # Check code with ESLint
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Format code with Prettier
```

### Testing
```bash
npm test              # Run Jest tests (currently only keyboard.test.js exists)
```

### Dependencies
```bash
npm install           # Install dependencies
npm ci                # Clean install (used in CI/CD)
npm run postinstall   # Install Electron app dependencies (runs automatically after install)
```

## Architecture

### Electron Multi-Process Architecture

**Main Process** (`main.js`)
- Window lifecycle management (creation, positioning, opacity)
- System tray integration
- Auto-updates via electron-updater
- IPC handlers for renderer communication
- Configuration management (loads/saves from userData/config.json)
- Global hotkey registration

**Renderer Process** (`renderer.js`)
- Orchestrates UI initialization and WebSocket events
- Coordinates between modular components
- Handles IPC events from main process
- Delegates to specialized modules (ui, websocket, settings, etc.)

### Core Modules (`src/`)

**State Management** (`state.js`)
- Central state container for CONFIG, STATES, SERVICES, AREAS
- WebSocket state (WS, PENDING_WS, WS_ID)
- UI state (tabs, layouts, filters, themes)
- Timer and camera tracking
- Provides getter/setter functions for immutable-like updates

**WebSocket Manager** (`websocket.js`)
- EventEmitter-based WebSocket connection to Home Assistant
- Handles auth, requests, subscriptions
- Request/response tracking with promise-based API
- Auto-reconnection logic
- Service call abstraction

**UI Management** (`ui.js`)
- Entity rendering and updates
- Drag-and-drop reorganization
- Quick Access management
- Entity interaction handlers (toggle, brightness, etc.)
- Tab rendering coordination

**Settings** (`settings.js`)
- Settings modal management
- Configuration persistence via IPC
- Home Assistant connection settings
- Hotkeys and alerts configuration
- Theme and UI preferences

**Utilities** (`utils.js`)
- Entity display formatting (names, states, icons)
- Timer calculations and formatting
- Search scoring for entity filtering
- Domain-specific display logic

**Hotkeys** (`hotkeys.js`)
- Global hotkey registration/management
- Hotkey capture UI
- Domain-specific action options
- IPC coordination with main process for global shortcuts

**Alerts** (`alerts.js`)
- Entity state monitoring
- Alert configuration UI
- Desktop notifications for state changes

**Camera** (`camera.js`)
- HLS streaming support
- Snapshot handling
- Live camera feed management

**UI Utilities** (`ui-utils.js`)
- Toast notifications
- Theme application
- Loading states
- Focus trapping for modals

### Data Flow

1. **Initialization**: renderer.js loads config → connects WebSocket → fetches entities/services/areas
2. **Real-time Updates**: WebSocket events → state updates → UI updates for affected entities
3. **User Actions**: UI interactions → service calls via WebSocket → state updates from events
4. **Configuration**: Settings changes → IPC to main → config.json update → app restart if needed

### Configuration

- **Location**: `%AppData%/Home Assistant Widget/config.json`
- **Structure**: 
  - `homeAssistant`: URL and token
  - `windowPosition`, `windowSize`, `alwaysOnTop`, `opacity`
  - `favoriteEntities`: Quick Access entities
  - `customEntityNames`: User-defined entity display names
  - `globalHotkeys`: Hotkey configurations
  - `entityAlerts`: Alert rules
  - `filters`: Domain and area filters
  - `ui`: Theme preferences

### Build System

- **electron-builder** creates NSIS installer and portable exe
- Icons stored in `build/` directory
- Outputs to `dist/` directory
- GitHub Actions workflows:
  - `ci.yml`: Runs on push/PR, builds artifacts without publishing
  - `release.yml`: Triggered on version tags, publishes to GitHub releases

### Entity Support

The app handles multiple Home Assistant domains:
- **Lights**: Toggle, brightness slider
- **Switches/Fans**: Simple on/off
- **Sensors**: Value display with units, timer countdown
- **Cameras**: Live HLS streams or snapshots
- **Climate**: Temperature display
- **Media Players**: Controls
- **Scenes**: One-click activation
- **Automations**: Trigger/enable/disable

### Testing

- Jest with jsdom environment for DOM testing
- Tests located in `tests/` directory
- Currently minimal test coverage (only keyboard.test.js)

### Styling

- Custom CSS in `styles.css`
- Dark/light theme support with auto-detection
- Transparent window with acrylic/glass effects
- Rainmeter-inspired aesthetic
