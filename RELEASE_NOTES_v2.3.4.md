# HA Desktop Widget v2.3.4 Release Notes

**Release Date:** October 5, 2025

## 🐛 Bug Fixes

This patch release fixes two critical issues reported by users affecting the reorganize mode and sensor display.

### 🔧 Reorganize Mode - Button Persistence

- **Fixed Icons Disappearing**: Resolved issue where pencil (✏️) and X (×) icons disappeared from some entities while in reorganize/edit mode
- **Root Cause**: When entities received real-time state updates from Home Assistant while in edit mode, they were replaced with fresh DOM elements that didn't have edit buttons or drag listeners
- **Solution**: Created targeted helper functions that restore edit functionality only to newly updated elements
- **Impact**: All entities now maintain their edit buttons regardless of state changes

### 📊 Numeric Sensor Display

- **Fixed Incorrect Display**: Resolved issue where numeric sensors (power, temperature, etc.) showed weird values on tiles
- **Root Cause**: Timer detection logic was too permissive, parsing plain numbers like "150" (watts) as timestamps
- **Solution**: Added regex validation to only parse actual ISO date/time strings as timestamps
- **Impact**: All numeric sensors now display correctly with proper units (e.g., "150 W", "72.5 °F")

## 🎯 What Was Fixed

### Issue #1: Disappearing Edit Icons
**Before:** While in reorganize mode, if a light turned on or a sensor updated, that entity would lose its pencil and X buttons, making it impossible to rename or remove.

**After:** All entities maintain their edit buttons even when receiving state updates from Home Assistant.

### Issue #2: Weird Sensor Values
**Before:** A power sensor showing "150 W" in the tooltip would display something strange on the tile itself.

**After:** The tile display now matches the tooltip, showing "150 W" correctly for all numeric sensors.

## 📋 Technical Details

### Files Modified
- `src/ui.js`:
  - Added `addButtonsToElement()` helper function (lines 103-153)
  - Added `addDragListenersToElement()` helper function (lines 155-167)
  - Updated `updateEntityInUI()` to restore reorganize mode state (lines 276-280)
  - Updated timer detection with timestamp validation (3 locations)
  - Refactored existing functions to use new helpers

- `src/utils.js`:
  - Updated `getEntityDisplayState()` with strict timestamp validation (lines 162-171)
  - Updated `getTimerDisplay()` with strict timestamp validation (lines 229-238)

### Changes Summary
- Created helper functions to add buttons and listeners to individual elements
- Refactored bulk operations to use the new helpers for code reuse
- Added `/[T\-:]/` regex check before parsing strings as dates
- Prevents numeric sensor values from being misclassified as timer timestamps
- Ensures both tooltip and tile display use consistent logic

## 🚀 Installation

Download the latest version from the [Releases page](https://github.com/Robertg761/HA-Desktop-Widget/releases).

### System Requirements
- Windows 10/11
- Home Assistant instance with API access

## 🔄 Upgrade Notes

This is a patch release that maintains full backward compatibility. No configuration changes are required.

### What to Test After Upgrading:
1. Enter reorganize mode and toggle a light or wait for sensor updates
2. Verify all entities keep their pencil and X buttons
3. Check that power/wattage sensors display correctly (e.g., "150 W")
4. Verify temperature sensors show proper values (e.g., "72.5 °F")
5. Confirm timer entities (Google Kitchen Timer, etc.) still work normally

## 📝 Full Changelog

For the complete list of changes, see [CHANGELOG.md](CHANGELOG.md).

---

**Previous Release:** [v2.3.3](RELEASE_NOTES_v2.3.3.md)

