# Changelog

All notable changes to HA Desktop Widget will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Nothing yet

### Changed
- Nothing yet

### Fixed
- Nothing yet

## [3.2.2] - 2026-02-05

### Added
- Portable update check now fetches the latest GitHub release and surfaces a direct Portable download link.

### Changed
- Portable builds no longer attempt in-app auto-updates and instead guide users to the Portable download.

### Fixed
- Prevented Portable installs from accidentally running the NSIS installer update path.

## [3.0.0] - 2025-11-17

### 🎉 Major Release Highlights

Version 3.0.0 represents a massive overhaul of HA Desktop Widget with **over 15,000 lines of code changed**. This release focuses on critical bug fixes, security enhancements, new media player integration, and extensive UI/UX improvements.

### 🐛 Critical Bug Fixes

- **Camera Live Streaming**: Restored camera live streaming functionality for cloud cameras (Arlo, Ring, Nest, etc.)
  - Fixed HLS streaming path resolution
  - Improved error handling for camera feeds
  - Better fallback to snapshots when streaming unavailable
- **Token Data Loss & App Freeze**: Prevented token loss and app freeze during v2.3.9 to v3.0.0 upgrade
  - Added automatic token migration system
  - Implemented version detection and upgrade handling
  - Added MIGRATION.md with detailed upgrade instructions
- **Installer Issues**: Resolved critical installer and connection issues
  - Fixed desktop shortcut creation
  - Improved installer icon embedding
  - Added custom NSIS installer script for better upgrade experience
- **Desktop Icon**: Fixed application icon showing as default Electron icon
  - Properly embedded icon in executable
  - Removed problematic `signAndEditExecutable` flag that was corrupting icon data

### ✨ New Features

#### Media Player Integration
- **Primary Media Player Tile**: Dedicated tile in main area showing now playing information
- **Album Artwork Display**: Full album art with proxy support for Spotify, YouTube, and other services
- **Advanced Media Controls**:
  - Play/pause, previous/next track buttons
  - Live-updating seek bar with drag-to-seek functionality
  - Real-time playback progress (updates every second)
  - Hour-aware timestamp formatting (h:mm:ss for long tracks)
- **Enhanced Media Tiles**: Click to toggle play/pause, long-press for detailed controls modal
- **Media Detail Modal**: Full-screen media information with visual-only progress bar and large control buttons

#### Security Enhancements
- **Token Encryption**: Home Assistant tokens now encrypted at rest using Electron's `safeStorage` API
- **Automatic Migration**: Seamless upgrade from plaintext tokens to encrypted storage
- **Graceful Fallback**: Platform-aware encryption with appropriate warnings when unavailable
- **Secure IPC**: All renderer IPC calls whitelisted through explicit `window.electronAPI` interface

#### Global Hotkeys System
- **Hold-to-Popup Hotkey**: Optional feature using `uiohook-napi` for press/release detection
  - Hold configured key to bring window to front, release to hide
  - Platform-aware with graceful fallback when unavailable
  - Configurable in Settings → Hotkeys tab
- **Enhanced Entity Hotkeys**: Assign global keyboard shortcuts to control any entity
- **Hotkey Validation**: Prevents conflicts with system shortcuts

#### Entity Alert System
- **Redesigned UI**: Inline list with entity picker modal for better organization
- **Condition Types**: Equals, greater than, less than, between, contains
- **Desktop Notifications**: System notifications when alert conditions are met
- **Toggle Control**: Easily enable/disable alerts globally from settings

#### UI Customization
- **Weather Entity Selector**: Long-press weather card to choose preferred weather entity or use auto-detect
- **Unit System Support**: Respects Home Assistant's configured units (metric/imperial) for temperature, wind speed, etc.
- **Custom Glassmorphism Dropdowns**: Replaced native selects with styled dropdowns matching app aesthetic
- **Density Settings**: Choose between comfortable and compact display modes
- **High Contrast Mode**: Enhanced visibility for accessibility

#### Logging System
- **electron-log Integration**: Comprehensive logging for troubleshooting
- **Log Viewer**: Access logs directly from Settings → Advanced → "View Logs"
- **Structured Logging**: Timestamped logs with levels (info/warn/error/debug)
- **WebSocket Heartbeat**: Automatic ping/pong to keep connections alive

### 🎨 UI/UX Improvements

#### Drag-and-Drop System
- **Transform-Based Architecture**: Complete rewrite using GPU-accelerated CSS transforms for smooth 60fps movement
- **Eliminated Thrashing**: DOM stays stable during drag, only reorders on drop
- **iOS/Android-Style Movement**: Smooth, deliberate tile animations with improved easing
- **Distance-Based Detection**: Accurate target detection using actual tile positions
- **Visual Feedback**: Clear drag indicators and drop target highlighting

#### Entity Tiles
- **Hover Glow Effects**: Subtle glow on quick access entity tiles
- **Advanced Controls**:
  - Brightness sliders for lights
  - Color temperature controls
  - Fan speed controls
  - Thermostat temperature controls
  - Volume sliders for media players
- **Better Visual Feedback**: State-based coloring, smooth transitions, and improved iconography
- **Text Handling**: Proper overflow handling with ellipsis and marquee scrolling on hover

#### Window Management
- **Improved Icon**: Custom application icon properly embedded in executable and shown in taskbar/desktop
- **Opacity Range**: Enforced minimum 50% opacity (0.5-1.0 range) for better visibility
- **Window State Persistence**: Remembers position, size, and transparency settings

#### Settings Modal
- **Reorganized Tabs**:
  - General (connection, theme, updates)
  - Quick Access (favorites management)
  - Custom Tabs (entity organization)
  - Filters (entity visibility)
  - Hotkeys (global shortcuts)
  - Alerts (entity monitoring)
  - Advanced (opacity, logs, debug options)
- **Improved Layout**: Better spacing, clearer sections, consistent styling
- **Entity Picker**: Enhanced entity selection with search and filtering

### 🔧 Additional Bug Fixes

#### UI Fixes
- **Quick Access Remove Button**: Fixed regression from SortableJS refactor that broke entity removal
- **Reorganize Mode**: Resolved 5 critical bugs in drag-and-drop system
  - Fixed grid position calculation
  - Fixed animation restart issues
  - Fixed column calculation errors
  - Added bounds checking
- **Search Bar**: Fixed unresponsiveness after entity removal via custom confirmation modal
- **Quick Access Disappearing**: Fixed items disappearing during Home Assistant restart
  - Improved WebSocket reconnection handling
  - Better state persistence
- **Media Player Controls**: Fixed setup timing and button functionality
- **Weather Card**: Removed dead camera code and completed entity selector implementation

#### Connection & Performance
- **Unnecessary Reconnects**: Prevented WebSocket reconnections when connection parameters haven't changed
- **WebSocket Stability**: Improved reconnection logic with exponential backoff (1s → 30s max with jitter)
- **Timeout Handling**: Better WebSocket timeout handling to prevent log spam
- **Memory Leaks**: Added proper cleanup for modal intervals and event listeners

### 🔧 Code Quality & Maintenance

#### Refactoring
- **Dead Code Removal**: Removed unused dependencies, UI elements, and functions to reduce bundle size
- **Module Organization**: Better separation of concerns with new `src/icons.js` module
- **State Management**: Improved centralized state management with proper getter/setter functions
- **Error Handling**: Comprehensive error handling with structured logging throughout codebase

#### Documentation
- **CLAUDE.md**: Comprehensive project documentation (655 lines)
- **TESTING.md**: Complete testing documentation (140 lines)
- **MIGRATION.md**: Upgrade guide from v2.x to v3.0.0 (73 lines)
- **UPGRADE-FIX-SUMMARY.md**: Detailed summary of upgrade-related fixes (298 lines)
- **UPGRADE-TEST-PLAN.md**: Comprehensive test plan for upgrade scenarios (314 lines)

#### Dependencies
- **Updated**: axios (1.11.0), electron-log (5.4.3), electron-updater (6.6.2)
- **Added**: sortablejs (1.15.6), hls.js (1.4.12), uiohook-napi (1.5.4, optional)
- **Removed**: Cleaned up unused dependencies to reduce bundle size

#### Testing Infrastructure (Developer)
- **Comprehensive Test Suite**: 403 automated tests across 11 test suites (~5,500 lines of test code)
  - Unit tests for all core modules (state, utils, websocket, alerts, hotkeys, camera, ui-utils)
  - Integration tests for settings/config and websocket/state interactions
  - Mock utilities for Electron APIs and WebSocket connections
- **CI Integration**: Automated testing in GitHub Actions on every pull request
- **Coverage Reporting**: Overall coverage of 34.73% focused on business logic (77-100% on critical modules)

### 📊 Statistics

- **Code Changes**: 15,040+ insertions, 1,306 deletions across 43 files
- **Test Coverage**: 403 tests, 34.73% overall coverage (77-100% on critical modules)
- **Documentation**: 1,700+ lines of new documentation
- **Commits**: 57 commits across multiple feature branches

### 🙏 Acknowledgments

This release represents months of development focused on stability, testing, and user experience. Special thanks to the Home Assistant community for feedback and bug reports.

---

## [2.3.6] - 2025-10-21

### Changed
- **Tray Icon Handling**: The app now uses the packaged executable icon (or bundled `build/icon.*`) for both the tray and desktop shortcuts, with automatic fallbacks for development builds.
- **Icon Assets**: Added `build/icon.png`/`icon.ico` so electron-builder packages the correct branding by default.

### Fixed
- **Setup Screen Controls**: Settings, minimize, and close buttons now work on first launch even when Home Assistant credentials are missing.
- **Minimize Behavior**: Minimizing the widget now consistently hides it to the system tray instead of leaving it in the taskbar.
- **Tray Visibility**: Tray icon toggles the window on click, ensuring easy restore after hiding.

## [2.3.5] - 2025-10-12

### Added
- **Advanced Hotkey Actions**: Entity-specific action options in hotkey configuration
  - Lights: Toggle, Turn On, Turn Off, Brightness Up, Brightness Down
  - Switches: Toggle, Turn On, Turn Off
  - Scenes: Activate
  - Automations: Trigger, Toggle, Enable, Disable
  - Fans: Toggle, Turn On, Turn Off, Increase Speed, Decrease Speed
  - Input Booleans: Toggle, Turn On, Turn Off
- **Action Dropdown UI**: New dropdown menu in hotkeys settings to select specific actions per entity

### Changed
- **Hotkey System Enhancements**:
  - Hotkeys now support action-specific commands beyond simple toggling
  - Brightness controls adjust lights by 20% increments
  - Fan speed controls adjust by 33% increments
  - Improved hotkey configuration UI with better styling and spacing

### Fixed
- **Hotkey Execution**: Fixed critical bug where hotkeys were not executing any actions
  - Added missing `executeHotkeyAction` export from `ui.js`
  - Fixed event listener setup timing to occur after hotkeys list is rendered
  - Added missing `save-config` IPC handler in main process
  - Added missing `register-hotkeys` IPC handler to re-register hotkeys after config changes
- **Action Persistence**: Fixed bug where selected actions were not being saved when changing dropdown
  - Event listeners now properly set up during hotkeys tab rendering
  - Config changes now properly saved and hotkeys re-registered
- **Clear Button**: Fixed hotkey clear button functionality to work with new dropdown layout
- **Repository Cleanup**: Removed unnecessary build artifacts and redundant release notes files
  - Deleted `builder-debug.yml`, `latest.yml`, and `win-unpacked/` directory
  - Removed duplicate release notes files (kept only CHANGELOG.md)
  - Updated `.gitignore` to prevent future build artifact commits

### Technical
- Implemented `getActionOptionsForDomain()` to dynamically generate appropriate actions per entity type
- Enhanced `executeHotkeyAction()` to handle all entity-specific actions
- Improved hotkey action dropdown styling with custom SVG arrow and theme-consistent colors
- Added event delegation for hotkey configuration changes
- Proper IPC communication between renderer and main process for config updates

## [2.3.4] - 2025-10-05

### Fixed
- **Reorganize Mode Button Persistence**: Fixed critical bug where pencil (✏️) and X (×) icons disappeared from entities that received state updates while in reorganize mode
  - Created targeted helper functions `addButtonsToElement()` and `addDragListenersToElement()` to restore edit functionality to updated elements
  - Ensures all entities maintain their edit buttons regardless of real-time state changes from Home Assistant
  - Prevents duplicate event listeners by only processing newly created elements
- **Numeric Sensor Display**: Fixed incorrect display of numeric sensor values (power, temperature, humidity, etc.)
  - Power sensors now correctly show "150 W" instead of weird timer-like values
  - Added regex validation `/[T\-:]/` to timestamp detection to prevent numeric values from being parsed as dates
  - Ensures tile display matches tooltip display for all numeric sensors
  - Timer sensors with actual ISO timestamps continue to work properly

## [2.3.3] - 2025-10-02

### Fixed
- **Edit Mode Pencil Icon**: Fixed critical bug where the pencil (✏️) icon in reorganize/edit mode was not clickable due to drag-and-drop interference
  - Clicking the pencil icon would trigger a drag operation instead of opening the rename modal
  - Implemented multi-layer fix with event handling, CSS, and drag prevention
  - Buttons now properly prevent drag events and respond to clicks
  - Added `addRemoveButtons()` calls after UI re-renders to ensure buttons remain functional

## [2.3.2] - 2025-10-02

### Fixed
- **Timer Sensors**: Fixed Google Kitchen Timer and other sensor-based timers to display live countdowns
  - Added support for timers that use state as timestamp instead of attributes
  - Added support for multiple timer attribute formats (finishes_at, end_time, finish_time)
  - Fixed timer detection logic to recognize sensors with timer-like timestamps
  - Timer sensors now show "Finished" when expired
- **Update Checker**: Fixed Settings → Updates tab to properly display current version and check for updates
  - Fixed "Check for Updates" button in packaged builds
  - Added clear messaging for development vs packaged modes
  - Fixed update status display and event handling
- **Quick Access Management**: Fixed "Manage Quick Access" modal to properly load and display entities
  - Fixed entity list population and rendering
  - Fixed Add/Remove buttons functionality
  - Fixed real-time updates when managing entities
- **Search Functionality**: Significantly improved search to be more forgiving and intelligent
  - Search now normalizes text to ignore apostrophes, underscores, and special characters
  - Example: "roberts" now matches "Robert's Room"
  - Smart relevance scoring prioritizes matches at the start of names
  - Searches both entity display names and entity IDs simultaneously

### Technical
- Enhanced `getSearchScore()` with text normalization for better search results
- Added `populateQuickControlsList()` and `toggleQuickAccess()` functions
- Improved timer detection across createControlElement, getEntityDisplayState, and getTimerDisplay
- Updated `initUpdateUI()` to properly handle version display and update checking

## [2.3.1] - 2025-10-01

### Added
- **Global Hotkeys**: OS-level keyboard shortcuts for controlling entities
  - Assign custom hotkey combinations (Ctrl, Alt, Shift + key) to any light, switch, scene, or automation
  - Visual hotkey capture modal for easy configuration
  - Support for all standard keys, function keys, and numpad
  - Enable/disable global hotkeys from settings
  - Search and filter entities when assigning hotkeys
- **Entity Alerts**: Desktop notifications for entity state changes
  - Configure alerts for any entity
  - Alert on any state change or specific target state
  - Desktop notification support with permission management
  - Full CRUD operations (create, edit, delete alerts)
  - Search and filter entities in alerts modal
- **Camera Live Streaming**: Real-time camera video feeds
  - HLS streaming support (primary method)
  - MJPEG fallback streaming for compatibility
  - Snapshot mode for static images
  - Live/Stop toggle for stream control
  - Custom `ha://` protocol for secure camera proxy
  - Loading indicators and error handling
- **Enhanced UI Features**:
  - Drag-and-drop tile reordering in Quick Access
  - Wiggle animation in reorganize mode
  - Entity-specific icons (lights, sensors, timers, scenes, etc.)
  - Dynamic weather icon based on current conditions
  - Live timer countdowns with visual feedback
  - Light brightness display and slider control
  - Custom entity renaming functionality

### Changed
- **Modular Architecture**: Refactored codebase into organized `src/` directory
  - Separated concerns: state management, WebSocket handling, UI rendering, utilities
  - Improved code maintainability and readability
  - Better error handling throughout the application
- **Settings Interface**: Redesigned with tabbed layout
  - General, Hotkeys, Alerts, and Updates tabs
  - Improved organization and usability
  - Real-time preview of changes
- **Entity Display Logic**: Enhanced state formatting
  - Sensors show values with units (temperature, battery, power, etc.)
  - Lights show brightness percentage or "Off"
  - Timers show live countdown or status (Idle/Paused)
  - Climate entities show temperature settings
- **Camera Handling**: Complete rewrite for better performance
  - Attempts HLS first, falls back to MJPEG automatically
  - Proper resource cleanup on modal close
  - Improved loading states and error messages
- **WebSocket Management**: Improved connection handling
  - Better error recovery and reconnection logic
  - Proper message ID tracking for request/response pairs
  - Cleaner event handling with EventEmitter pattern

### Fixed
- **Critical Module Scoping Bug**: Fixed `require()` statements being inside try-catch block, which made modules undefined
- **WebSocket ID Mismatch**: Fixed request ID tracking for proper message handling
- **Loading Spinner Stuck**: Fixed initialization flow to show UI immediately instead of waiting for WebSocket connection
- **Generic States Display**: Implemented entity-specific state formatting instead of showing raw state values
- **No Tiles in Quick Access**: Fixed entity filtering and rendering logic to properly display favorite entities
- **Duplicate Connection Indicator**: Removed extra green dot near status indicator
- **Drag-and-Drop Not Working**: Implemented proper event handlers with capture phase
- **Wiggle Animation Desync**: Fixed animation restart after dropping tiles using `requestAnimationFrame`
- **Camera Entities Not Draggable**: Fixed JavaScript error that prevented camera tiles from being draggable
- **Incorrect Icons**: Fixed icons for all entity types (lights always show bulb, scenes show sparkles, etc.)
- **Static Weather Icon**: Made weather icon dynamic based on current conditions
- **Alerts Section Incomplete**: Fully implemented alerts CRUD UI with entity selector
- **Camera Live View**: Fixed stream initialization and browser compatibility
- **UI Rendering**: Fixed Quick Access not rendering when WebSocket hasn't connected yet
- **Timer Updates**: Added live countdown updates every second
- **Memory Leaks**: Proper cleanup of intervals, event listeners, and HLS instances

### Technical Improvements
- Zero linter errors across all files
- Consistent error handling with try-catch blocks
- Proper resource management (intervals, event listeners, HLS instances)
- Removed debug console.log statements for production
- Improved code documentation and comments
- Better TypeScript-compatible JSDoc comments

## [2.2.1] - 2024-12-19

### Changed
- **Settings Window**: Improved settings window sizing and layout
- **Project Cleanup**: Removed unnecessary release notes files (RELEASE_NOTES_v2.1.0.md, RELEASE_NOTES_v2.2.0.md)
- **File Organization**: Streamlined project structure by removing redundant documentation files

### Fixed
- **Opacity Settings**: Fixed opacity slider and window transparency controls
- **Weather Icon**: Fixed current weather icon display and rendering
- **Settings UI**: Improved settings window responsiveness and usability
- **Project Maintenance**: Cleaned up project directory to remove unused files

## [2.2.0] - 2024-09-15

### Added
- **Entity Rename Functionality**: Click the pencil icon (✏️) in reorganize mode to rename any entity
- **Custom Display Names**: Set custom names that persist across app restarts
- **Reset to Default**: Option to restore original entity names
- **Clean Modal Interface**: Modern rename dialog with keyboard shortcuts (Enter to save, Escape to cancel)

### Changed
- **Consistent Tile Sizing**: All Quick Access tiles now have uniform dimensions
- **Auto-sizing Layout**: Tiles automatically adjust to fit content without clipping
- **Improved Icon Display**: Icons now fit properly within tiles with better spacing
- **Enhanced Reorganize Mode**: Red X buttons persist after removing items (no need to re-enter mode)

### Fixed
- **Timer Updates**: Timer entities now reliably update countdowns after app restart
- **WebSocket Reconnection**: Timer updates properly restart when connection is restored
- **Reorganize Mode**: Fixed buttons disappearing after entity removal
- **Tile Heights**: Fixed inconsistent tile heights in Quick Access grid
- **Icon Clipping**: Fixed icon clipping issues in entity tiles
- **Drag & Drop**: Improved drag and drop stability and visual feedback

## [2.1.0] - 2024-09-15

### Added
- **Drag & Drop Reorganize**: Click the reorganize button (⋮⋮) to enter reorganize mode
- **Wiggle Animation**: Entities shake gently when in reorganize mode, similar to mobile apps
- **Drag & Drop**: Drag entities to reorder them in Quick Access
- **Remove Buttons**: Red X buttons appear in reorganize mode to remove entities
- **Visual Feedback**: Smooth animations for drag operations and hover effects

### Changed
- **Button Layout**: Reorganize and add buttons are now properly aligned in the header
- **Animation Timing**: Improved wiggle animation to be more noticeable but not distracting
- **Drag Experience**: Enhanced drag and drop with better visual feedback

### Fixed
- **Button Alignment**: Fixed vertical alignment issues with header buttons
- **Animation Performance**: Optimized animations for better performance
- **Drag State**: Improved drag state management and cleanup

## [2.0.0] - 2024-09-15

### Added
- **Complete GUI Overhaul**: Modern, clean Rainmeter-style desktop widget design
- **Quick Access Section**: Main focus area for frequently used entities
- **Entity Search**: Robust search functionality for finding and adding entities
- **Interactive Elements**: Full interactivity for lights, cameras, sensors, scenes, etc.
- **Real-time Updates**: WebSocket connection for instant entity state changes
- **Auto-updater**: Automatic updates from GitHub releases
- **System Tray**: Minimize to tray with quick access menu
- **Weather Integration**: Configurable weather display with real-time data
- **Timer Support**: Real-time countdown displays for timer entities

### Changed
- **UI Design**: Complete redesign with modern, minimalist aesthetic
- **Layout**: Single-view design focusing on Quick Access
- **Performance**: Optimized rendering and memory management
- **User Experience**: Streamlined interface with intuitive controls

### Fixed
- **Connection Issues**: Improved Home Assistant connection reliability
- **Entity Display**: Better handling of various entity types
- **Camera Feeds**: Improved camera streaming and fallback handling
- **Light Controls**: Fixed brightness slider and toggle functionality

## [1.4.1] - 2024-09-14

### Fixed
- **Security**: Updated axios dependency to fix security vulnerability
- **Dependencies**: Updated all dependencies to latest versions
- **Linting**: Fixed ESLint errors and warnings

## [1.4.0] - 2024-09-14

### Added
- **Auto-updater**: Automatic updates from GitHub releases
- **Update Notifications**: Toast notifications for available updates
- **Background Downloads**: Updates download in the background
- **Install on Quit**: Updates install when the app is closed

### Changed
- **Update Process**: Streamlined update experience
- **User Feedback**: Better notifications for update status

## [1.3.0] - 2024-09-14

### Added
- **Design System**: Consistent design tokens and layout rhythm
- **Responsive Grid**: Auto-fill dashboard grid with minimum card width
- **Enhanced Toolbar**: Consistent header structure with essential controls
- **State Badges**: Visual indicators for entity states
- **Theming**: Auto/Light/Dark theme support with OS preference detection

### Changed
- **Visual Design**: Improved spacing, radius, shadows, and surface colors
- **Layout**: Better responsive behavior and grid system
- **Performance**: Optimized rendering and update cycles

## [1.2.0] - 2024-09-13

### Added
- **Camera Feeds**: Live camera streaming with refresh handling
- **Toast Notifications**: Real-time feedback for user actions
- **Error Handling**: Improved error handling and user feedback
- **Performance**: Various performance improvements

### Fixed
- **Memory Leaks**: Fixed camera feed memory leaks
- **Connection Issues**: Improved WebSocket connection handling
- **UI Responsiveness**: Better UI responsiveness during updates

## [1.1.0] - 2024-09-13

### Added
- **Quick Controls**: Enhanced quick controls for lights, switches, media players
- **Filter System**: Filter by domain and area with hide functionality
- **Favorites**: Favorites section on default dashboard
- **Entity Management**: Better entity organization and management

### Changed
- **Dashboard**: Improved dashboard layout and organization
- **Controls**: Enhanced control interfaces for different entity types

## [1.0.0] - 2024-09-12

### Added
- **Initial Release**: First public release of HA Desktop Widget
- **Basic Functionality**: Core Home Assistant integration
- **Entity Display**: Basic entity display and control
- **WebSocket Connection**: Real-time updates from Home Assistant
- **Windows Support**: Full Windows 10/11 support with transparency

---

## Version Numbering

This project uses [Semantic Versioning](https://semver.org/):
- **MAJOR** version for incompatible API changes
- **MINOR** version for functionality added in a backwards compatible manner
- **PATCH** version for backwards compatible bug fixes

## Release Notes

Detailed release notes for each version are available on the [GitHub Releases page](https://github.com/Robertg761/HA-Desktop-Widget/releases).
