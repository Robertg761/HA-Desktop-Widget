# Version 2.3.1 - Global Hotkeys, Entity Alerts, and Camera Streaming

**Release Date**: October 1, 2025

This release brings powerful new features, critical bug fixes, and significant code improvements to the Home Assistant Desktop Widget.

---

## ✨ New Features

### 🎹 Global Hotkeys
Control your Home Assistant entities with OS-level keyboard shortcuts!
- Assign custom hotkey combinations (Ctrl+Alt+Key, etc.) to any light, switch, scene, or automation
- Visual hotkey capture modal for easy configuration
- Support for all standard keys, function keys, and numpad
- Search and filter entities when assigning hotkeys
- Enable/disable from settings

### 🔔 Entity Alerts
Get desktop notifications when entity states change!
- Configure alerts for any entity in your Home Assistant setup
- Alert on any state change or specific target states
- Desktop notification support with permission management
- Full CRUD operations (create, edit, delete alerts)
- Search and filter entities in alerts modal

### 📹 Camera Live Streaming
Watch your camera feeds in real-time!
- HLS streaming support (primary method)
- MJPEG fallback streaming for compatibility
- Snapshot mode for static images
- Live/Stop toggle for stream control
- Custom `ha://` protocol for secure camera proxy
- Loading indicators and proper error handling

### 🎨 Enhanced UI Features
- **Drag-and-drop tile reordering** in Quick Access with wiggle animation
- **Entity-specific icons** (lights 💡, sensors 📈, timers ⏲️, scenes ✨, etc.)
- **Dynamic weather icon** that matches current conditions ☀️🌧️❄️
- **Live timer countdowns** with visual feedback
- **Light brightness control** with slider and real-time display
- **Custom entity renaming** functionality

---

## 🐛 Critical Bug Fixes

- **Module Scoping Bug**: Fixed critical bug where modules were undefined throughout the application
- **WebSocket Handling**: Fixed message ID tracking for proper request/response pairs
- **Loading Spinner**: Fixed initialization flow so UI shows immediately
- **Entity Display**: Fixed state formatting to show meaningful values instead of raw states
- **Quick Access**: Fixed entity filtering and rendering logic
- **Drag-and-Drop**: Implemented proper event handlers with capture phase
- **Wiggle Animation**: Fixed animation desync using `requestAnimationFrame`
- **Camera Streaming**: Fixed live view not playing real-time video
- **Memory Leaks**: Proper cleanup of intervals, event listeners, and HLS instances

---

## 🔧 Technical Improvements

### Modular Architecture
- Refactored codebase into organized `src/` directory structure
- Separated concerns: state management, WebSocket handling, UI rendering, utilities
- Improved code maintainability and readability

### Code Quality
- ✅ Zero linter errors across all files
- ✅ Consistent error handling with try-catch blocks
- ✅ Proper resource management (intervals, event listeners, HLS instances)
- ✅ Removed debug console.log statements for production
- ✅ Improved code documentation and comments

### Settings Interface
- Redesigned with tabbed layout (General, Hotkeys, Alerts, Updates)
- Improved organization and usability
- Real-time preview of changes

---

## 📦 Installation

### Windows Users
Download one of the following:
- **Installer (Recommended)**: `Home-Assistant-Widget-Setup-2.3.1.exe` - Installs to Program Files with auto-update support
- **Portable**: `Home-Assistant-Widget-2.3.1.exe` - Run from any location without installation

### First-Time Setup
1. Launch the application
2. Click the settings icon (⚙️)
3. Enter your Home Assistant URL and Long-Lived Access Token
4. Configure your favorite entities in Quick Access
5. (Optional) Enable Global Hotkeys and Entity Alerts in settings

---

## 🆕 What's New in v2.3.1

### Global Hotkeys Setup
1. Open Settings → Hotkeys tab
2. Enable "Global Hotkeys"
3. Search for an entity
4. Click the hotkey input field
5. Press your desired key combination
6. The hotkey is now registered with your OS!

### Entity Alerts Setup
1. Open Settings → Alerts tab
2. Enable "Entity Alerts"
3. Click "Add New Alert"
4. Select an entity from the dropdown
5. Configure alert conditions:
   - Alert on any state change, OR
   - Alert when state equals a specific value
6. Save the alert
7. Grant notification permissions when prompted

### Camera Live View
1. Click any camera entity in Quick Access
2. Camera viewer opens with Snapshot/Live buttons
3. Click "Live" to start real-time stream
4. Click "Stop" to pause the stream
5. Click "Snapshot" to view a static image

---

## ⚠️ Known Issues

- HLS streaming requires Home Assistant to support the `camera/stream` WebSocket command
- Some camera types may only support MJPEG streaming
- Global hotkeys require OS-level permissions (Windows may prompt for permission)
- Desktop notifications require user permission grant

---

## 🔄 Upgrade Notes

**Upgrading from v2.2.1 or earlier**:
- Your settings, favorites, and custom entity names will be preserved
- New features (Global Hotkeys and Entity Alerts) are disabled by default
- Enable them in Settings → Hotkeys/Alerts tabs
- The application will automatically reconnect to your Home Assistant instance

**Clean Installation**:
- If you experience issues after upgrading, try:
  1. Close the application
  2. Delete the config file at: `%APPDATA%\home-assistant-widget\config.json`
  3. Restart the application and reconfigure

---

## 📝 Full Changelog

See [CHANGELOG.md](https://github.com/Robertg761/HA-Desktop-Widget/blob/main/CHANGELOG.md) for the complete list of changes.

---

## 🙏 Acknowledgments

Thank you to everyone who reported issues and provided feedback during development! Your input has been invaluable in making this release possible.

---

## 🔗 Links

- **Repository**: https://github.com/Robertg761/HA-Desktop-Widget
- **Issues**: https://github.com/Robertg761/HA-Desktop-Widget/issues
- **Discussions**: https://github.com/Robertg761/HA-Desktop-Widget/discussions
- **Documentation**: See README.md for setup instructions

---

**Version**: 2.3.1  
**Release Date**: October 1, 2025  
**Build**: main@71e6e15

