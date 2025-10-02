# HA Desktop Widget v2.3.3 Release Notes

**Release Date:** October 2, 2025

## 🐛 Bug Fixes

This patch release fixes a critical issue with the entity rename functionality in edit mode.

### 🔧 Edit Mode Fixes

- **Fixed Pencil Icon Not Clickable**: Resolved issue where the pencil (✏️) icon in reorganize/edit mode was unresponsive due to drag-and-drop interference
- **Improved Button Event Handling**: Enhanced event propagation handling for edit buttons to prevent drag events from blocking clicks
- **CSS Drag Prevention**: Added CSS properties (`user-drag: none`, `pointer-events: auto`) to prevent buttons from being draggable
- **Multi-Layer Fix**: Implemented multiple layers of protection against drag interference:
  - HTML attribute level (`draggable="false"`)
  - JavaScript event listener level (capture phase event handling)
  - CSS level (user-drag prevention)
  - Parent handler level (dragstart check)

### 🎯 What Was Fixed

**Before:** Clicking the pencil icon in edit mode would trigger a drag operation instead of opening the rename modal, making it impossible to rename entities.

**After:** The pencil icon now properly opens the rename modal, allowing users to:
- Rename entities with custom display names
- Reset entity names to their defaults
- Edit multiple entities in one session without losing button functionality

## 📋 Technical Details

### Files Modified
- `src/ui.js` - Enhanced button event handling and drag prevention logic
- `styles.css` - Added CSS properties to prevent button dragging

### Changes Summary
- Updated `addRemoveButtons()` function to use `addEventListener` with capture phase
- Added explicit `dragstart` event prevention on buttons
- Modified `handleDragStart()` to check for button clicks and prevent drag initiation
- Added `addRemoveButtons()` calls after UI re-renders in edit mode
- Applied CSS `user-drag: none` and `pointer-events: auto` to edit buttons

## 🚀 Installation

Download the latest version from the [Releases page](https://github.com/Robertg761/HA-Desktop-Widget/releases).

### System Requirements
- Windows 10/11
- Home Assistant instance with API access

## 🔄 Upgrade Notes

This is a patch release that maintains full backward compatibility. No configuration changes are required.

## 📝 Full Changelog

For the complete list of changes, see [CHANGELOG.md](CHANGELOG.md).

---

**Previous Release:** [v2.3.2](RELEASE_NOTES_v2.3.2.md)

