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