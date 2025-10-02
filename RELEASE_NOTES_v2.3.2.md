# Version 2.3.2 - Bug Fixes

**Release Date**: October 2, 2025

This patch release fixes several critical bugs that were affecting functionality in v2.3.1.

---

## 🐛 Bug Fixes

### Timer Sensor Support (Google Kitchen Timer)
- **Fixed**: Timer sensors (like Google Kitchen Timer) now properly display live countdowns
- **Fixed**: Timer sensors that use state as timestamp are now correctly detected
- **Fixed**: Added support for multiple timer attribute formats (`finishes_at`, `end_time`, `finish_time`)
- **Fixed**: Live countdown updates every second for all timer types
- Timer sensors now show "Finished" when timer expires

### Update Checker
- **Fixed**: Settings → Updates tab now properly displays current version
- **Fixed**: "Check for Updates" button now works correctly in packaged builds
- **Fixed**: Update status messages are clear and informative
- **Fixed**: Shows appropriate message in development mode

### Quick Access Management
- **Fixed**: "Manage Quick Access" modal now properly loads and displays all entities
- **Fixed**: Entity list is fully populated and searchable
- **Fixed**: Add/Remove buttons work correctly
- **Fixed**: Real-time updates when adding or removing entities

### Search Functionality
- **Fixed**: Search is now much more forgiving with special characters
- **Fixed**: Apostrophes no longer prevent matches (e.g., "roberts" matches "Robert's Room")
- **Fixed**: Underscores and hyphens are normalized (e.g., "living room" matches "living_room")
- **Fixed**: Smart relevance scoring - matches at the start of names appear first
- **Fixed**: Searches both entity display names and entity IDs

---

## 🔧 Technical Improvements

- Enhanced `getSearchScore()` function with text normalization
- Added `populateQuickControlsList()` function for modal management
- Added `toggleQuickAccess()` function for entity management
- Improved timer detection logic across multiple files
- Better attribute checking for various timer sensor types

---

## 📋 What's Included

All features from v2.3.1 plus the above bug fixes:
- Global Hotkeys
- Entity Alerts
- Camera Live Streaming
- Drag-and-drop tile reordering
- Enhanced UI with entity-specific icons
- Live timer countdowns
- Light brightness control

---

## 🚀 Installation

### Windows Users
Download one of the following:
- **Installer (Recommended)**: `Home-Assistant-Widget-Setup-2.3.2.exe` - Installs to Program Files with auto-update support
- **Portable**: `Home-Assistant-Widget-2.3.2.exe` - Run from any location without installation

---

## 🔄 Upgrade Notes

**Upgrading from v2.3.1**:
- Direct upgrade - all settings preserved
- Timer sensors will now work properly
- Quick Access management now fully functional
- Search improvements are automatic

**Upgrading from v2.2.1 or earlier**:
- Your settings, favorites, and custom entity names will be preserved
- New features (Global Hotkeys and Entity Alerts) are disabled by default
- Enable them in Settings → Hotkeys/Alerts tabs

---

## 🐛 Known Issues

- Auto-updater only works in packaged builds (expected behavior)
- HLS streaming requires Home Assistant to support the `camera/stream` WebSocket command
- Some camera types may only support MJPEG streaming

---

## 📝 Full Changelog

See [CHANGELOG.md](https://github.com/Robertg761/HA-Desktop-Widget/blob/main/CHANGELOG.md) for the complete list of changes.

---

## 🔗 Links

- **Repository**: https://github.com/Robertg761/HA-Desktop-Widget
- **Issues**: https://github.com/Robertg761/HA-Desktop-Widget/issues
- **Discussions**: https://github.com/Robertg761/HA-Desktop-Widget/discussions

---

**Version**: 2.3.2  
**Release Date**: October 2, 2025

