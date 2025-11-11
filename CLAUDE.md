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

### Overview

The project has comprehensive automated tests using Jest with jsdom environment for testing Electron renderer processes.

**Test Statistics:**
- **403 tests** across 11 test suites
- **~5,500 lines** of test code
- **All tests passing** ✅
- **Overall coverage:** 34.73% (focused on business logic, not DOM manipulation)
- **Critical module coverage:** 77-100% on core business logic modules

**Test Implementation:**
- **Unit Tests:** Individual functions and modules tested in isolation
- **Integration Tests:** Module interactions (WebSocket + State, Settings + Config)
- **Mocking Strategy:** Custom mocks for Electron APIs, WebSocket, and external dependencies
- **Fixture Data:** Realistic Home Assistant sample data for consistent test scenarios

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage report
npm test -- --coverage

# Run specific test file
npm test -- tests/unit/state.test.js
npm test -- tests/integration/websocket-state.test.js

# Run tests in watch mode (auto-rerun on file changes)
npm test -- --watch

# List all test files
npm test -- --listTests
```

**Coverage Report:**
After running `npm test -- --coverage`, view the detailed HTML report at `coverage/lcov-report/index.html`

### Test Structure

```
tests/
├── fixtures/
│   └── ha-data.js              # Sample Home Assistant data (states, services, areas, etc.)
├── mocks/
│   ├── electron.js             # Mock Electron APIs (24 IPC methods)
│   └── websocket.js            # Mock WebSocket Manager with EventEmitter
├── integration/
│   ├── settings-config.test.js # Settings + Config integration (12 tests)
│   └── websocket-state.test.js # WebSocket + State integration (10 tests)
└── unit/
    ├── setup.test.js           # Environment verification (25 tests)
    ├── state.test.js           # State management (41 tests)
    ├── utils.test.js           # Utility functions (75 tests)
    ├── websocket.test.js       # WebSocket manager (29 tests)
    ├── alerts.test.js          # Entity alerts (31 tests)
    ├── hotkeys.test.js         # Hotkeys management (20 tests)
    ├── camera.test.js          # Camera module (59 tests)
    ├── ui-utils.test.js        # UI utilities (64 tests)
    └── ui.test.js              # UI rendering (37 tests, selective)
```

### Test Coverage by Module

| Module | Coverage | Tests | Notes |
|--------|----------|-------|-------|
| `alerts.js` | 100% | 31 | Complete coverage of alert monitoring and notifications |
| `ui-utils.js` | 96% | 64 | Toast, theme, loading, status, focus, confirmation dialog |
| `websocket.js` | 89% | 29 | Connection, messages, service calls, reconnection |
| `camera.js` | 87% | 59 | HLS streaming, snapshots, modal UI, error handling |
| `state.js` | 78% | 41 | All getters/setters, edge cases, collections |
| `utils.js` | 78% | 75 | Formatting, icons, timers, search, HTML escaping |
| `settings.js` | 35% | 12* | Tested via integration tests (Settings + Config) |
| `hotkeys.js` | 15% | 20 | Business logic tested; DOM-heavy UI not fully tested |
| `ui.js` | 14% | 37 | Selective testing of business logic (service routing, calculations) |

*Integration tests cover settings functionality through end-to-end flows

**Intentionally Untested:**
- Complex DOM manipulation in ui.js (reorganize mode, modal UIs, drag-and-drop)
- Main process code (main.js) - requires different testing approach
- Renderer initialization (renderer.js) - orchestration layer
- Icon definitions (icons.js) - static SVG data

### Testing Patterns

#### 1. Test File Structure

```javascript
/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');
const { sampleStates, sampleConfig } = require('../fixtures/ha-data.js');

// Mock dependencies
jest.mock('../../src/dependency.js');

let mockElectronAPI;

beforeAll(() => {
  mockElectronAPI = createMockElectronAPI();
  window.electronAPI = mockElectronAPI;
});

beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();
});

describe('ModuleName', () => {
  const moduleName = require('../../src/module.js');

  describe('functionName', () => {
    it('should do expected behavior', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = moduleName.functionName(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

#### 2. Mocking Electron APIs

Always use the provided mock utilities instead of creating manual mocks:

```javascript
const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');

// In beforeAll
mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// In beforeEach
resetMockElectronAPI();

// Use in tests
await window.electronAPI.updateConfig({ theme: 'dark' });
expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith({ theme: 'dark' });
```

#### 3. Mocking WebSocket

Use the MockWebSocketManager for testing WebSocket interactions:

```javascript
const { MockWebSocketManager } = require('../mocks/websocket.js');

const mockWS = new MockWebSocketManager();

// Simulate messages
mockWS.simulateMessage({ type: 'result', id: 1, result: { state: 'on' } });

// Simulate events
mockWS.simulateEvent('open');
mockWS.simulateStateChange('light.living_room', { state: 'off' });
```

#### 4. Testing Async Operations

Use `async/await` for cleaner async tests:

```javascript
it('should handle async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

#### 5. Testing DOM Interactions

Create and clean up DOM elements in each test:

```javascript
it('should render element', () => {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);

  // Run test
  renderFunction(container);
  expect(container.innerHTML).toContain('expected content');

  // Cleanup
  document.body.removeChild(container);
});
```

#### 6. Testing Error Handling

Verify error handling without failing tests:

```javascript
it('should handle errors gracefully', () => {
  const consoleError = jest.spyOn(console, 'error').mockImplementation();

  expect(() => functionThatMightError()).not.toThrow();
  expect(consoleError).toHaveBeenCalled();

  consoleError.mockRestore();
});
```

#### 7. Using Fake Timers

Test code that uses setTimeout/setInterval:

```javascript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('should call function after delay', () => {
  const callback = jest.fn();
  setTimeout(callback, 1000);

  jest.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalled();
});
```

### Mock Utilities

#### Electron Mock (`tests/mocks/electron.js`)

Provides complete mocking of all 24 IPC methods from `preload.js`:

**Available Mock Functions:**
- Config: `getConfig`, `updateConfig`, `saveConfig`
- Window: `setOpacity`, `setAlwaysOnTop`, `minimizeWindow`, `focusWindow`, `getWindowState`
- Lifecycle: `restartApp`, `quitApp`
- Hotkeys: `registerHotkey`, `unregisterHotkey`, `registerHotkeys`, `toggleHotkeys`, `validateHotkey`
- Popup Hotkey: `registerPopupHotkey`, `unregisterPopupHotkey`, `getPopupHotkey`, `isPopupHotkeyAvailable`
- Alerts: `setEntityAlert`, `removeEntityAlert`, `toggleAlerts`
- Updates: `checkForUpdates`, `quitAndInstall`
- Utility: `getAppVersion`, `openLogs`
- Event Listeners: `onHotkeyTriggered`, `onHotkeyRegistrationFailed`, `onAutoUpdate`, `onOpenSettings`

**Helper Functions:**
- `createMockElectronAPI()` - Create mock instance
- `resetMockElectronAPI()` - Reset all mock state
- `getMockConfig()` - Get mock config object
- `triggerMockEvent(event, ...args)` - Trigger mock IPC event

#### WebSocket Mock (`tests/mocks/websocket.js`)

MockWebSocketManager class with EventEmitter pattern:

**Available Methods:**
- `connect()`, `close()`, `send()`, `request()`, `callService()`

**Helper Methods:**
- `simulateMessage(message)` - Simulate incoming WebSocket message
- `simulateEvent(event, data)` - Emit WebSocket events (open, close, error)
- `simulateStateChange(entityId, newState)` - Simulate state_changed event

#### Fixtures (`tests/fixtures/ha-data.js`)

Realistic Home Assistant data for consistent testing:

**Available Exports:**
- `sampleConfig` - Complete CONFIG object with all properties
- `sampleStates` - Entity states (light, switch, sensor, weather, media_player, camera, etc.)
- `sampleServices` - Available HA services by domain
- `sampleAreas` - Area registry data
- `sampleUnitSystem` - Metric and imperial unit configurations
- `wsMessages` - Sample WebSocket messages for all message types

### Writing New Tests

When adding new tests, follow these guidelines:

1. **One test file per source module** - Mirror the `src/` directory structure
2. **Use descriptive test names** - Start with "should" (e.g., "should return friendly name when available")
3. **Follow Arrange-Act-Assert pattern** - Separate setup, execution, and verification
4. **Test edge cases** - null values, undefined, empty strings, missing data
5. **Test error handling** - Ensure functions don't throw unexpected errors
6. **Clean up after tests** - Remove DOM elements, restore mocked functions
7. **Keep tests focused** - One behavior per test
8. **Use mock utilities** - Don't create duplicate mocks
9. **Document complex tests** - Add comments explaining non-obvious test logic

**Example Test:**

```javascript
describe('formatDuration', () => {
  it('should format seconds as MM:SS', () => {
    // Arrange
    const milliseconds = 125000; // 2 minutes 5 seconds

    // Act
    const result = formatDuration(milliseconds);

    // Assert
    expect(result).toBe('2:05');
  });

  it('should handle zero duration', () => {
    expect(formatDuration(0)).toBe('0:00');
  });

  it('should handle negative duration', () => {
    expect(formatDuration(-1000)).toBe('0:00');
  });
});
```

### CI Integration

Tests run automatically in GitHub Actions on every pull request to the main branch.

**CI Workflow** (`.github/workflows/ci.yml`):
1. Runs on Windows (windows-latest)
2. Uses Node.js 20
3. Installs dependencies (`npm ci`)
4. Runs linter (`npm run lint`)
5. **Runs tests (`npm test`)**
6. Build verification

Tests must pass before PRs can be merged. If tests fail in CI:
- Check the Actions tab for detailed error logs
- Run tests locally to reproduce: `npm test`
- Fix failing tests and push changes

### Troubleshooting

**Tests fail with "Cannot find module":**
- Ensure you're in the project root directory
- Run `npm install` to install dev dependencies

**Mock not working as expected:**
- Check if `jest.clearAllMocks()` is called in `beforeEach`
- Use `resetMockElectronAPI()` to reset electron mock state

**jsdom errors about missing DOM APIs:**
- Add polyfills in test setup if needed
- Mock the missing API (see `tests/unit/alerts.test.js` for Notification example)

**Tests pass locally but fail in CI:**
- Ensure all paths are platform-independent
- Check for timing-dependent tests (use `jest.useFakeTimers()`)

**Coverage report not generated:**
- Run `npm test -- --coverage` (note the `--` separator)
- Check `coverage/` directory was created

### Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Electron Apps](https://www.electronjs.org/docs/latest/tutorial/automated-testing)
- [jsdom API](https://github.com/jsdom/jsdom)
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket)
- **Project Testing History:** See `testing-progress.md` for detailed implementation notes

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
