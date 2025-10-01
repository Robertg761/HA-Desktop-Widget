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

For detailed release notes, see:
- [v2.2.0 Release Notes](RELEASE_NOTES_v2.2.0.md)
- [v2.1.0 Release Notes](RELEASE_NOTES_v2.1.0.md)
- [v2.0.0 Release Notes](RELEASE_NOTES_v2.0.0.md)