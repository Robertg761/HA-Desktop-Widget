# v2.2.0 - Entity Rename & UI Polish

## 🎉 New Features

### ✏️ Entity Rename Functionality
- **Rename Quick Access Entities**: Click the pencil icon (✏️) in reorganize mode to rename any entity
- **Custom Display Names**: Set custom names that persist across app restarts
- **Reset to Default**: Option to restore original entity names
- **Clean Modal Interface**: Modern rename dialog with keyboard shortcuts (Enter to save, Escape to cancel)

### 🎨 UI Improvements
- **Consistent Tile Sizing**: All Quick Access tiles now have uniform dimensions
- **Auto-sizing Layout**: Tiles automatically adjust to fit content without clipping
- **Improved Icon Display**: Icons now fit properly within tiles with better spacing
- **Enhanced Reorganize Mode**: Red X buttons persist after removing items (no need to re-enter mode)

## 🔧 Technical Improvements

### Reorganize Mode Enhancements
- **Persistent Mode**: Reorganize mode stays active after adding/removing entities
- **Drag & Drop Stability**: Improved drag and drop functionality with better visual feedback
- **Button Alignment**: Fixed vertical alignment of reorganize and add buttons in header

### Timer Entity Improvements
- **Real-time Updates**: Timer entities now reliably update countdowns after app restart
- **WebSocket Reconnection**: Timer updates properly restart when connection is restored
- **Consistent Styling**: Timer entities match the visual style of other tiles

### Code Quality
- **File Cleanup**: Removed unused development files (GEMINI.md, CODE_SIGNING_GUIDE.md, old release notes)
- **CSS Optimization**: Streamlined stylesheet with better organization
- **Performance**: Improved rendering performance for Quick Access tiles

## 🐛 Bug Fixes
- Fixed timer countdowns freezing after app restart
- Fixed reorganize mode buttons disappearing after entity removal
- Fixed inconsistent tile heights in Quick Access grid
- Fixed icon clipping issues in entity tiles
- Fixed WebSocket reconnection not restarting timer updates

## 📱 User Experience
- **Intuitive Renaming**: Easy-to-use rename interface with clear visual feedback
- **Consistent Layout**: All tiles now have the same professional appearance
- **Smooth Interactions**: Improved drag and drop with fluid animations
- **Better Organization**: Enhanced reorganize mode for easier entity management

## 🔄 Migration Notes
- Custom entity names are stored in the app configuration and will persist across updates
- All existing Quick Access entities will maintain their current order and settings
- No breaking changes to existing functionality

---

**Full Changelog**: https://github.com/yourusername/home-assistant-widget/compare/v2.1.0...v2.2.0
