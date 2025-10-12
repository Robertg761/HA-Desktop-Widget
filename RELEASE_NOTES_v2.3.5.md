# HA Desktop Widget v2.3.5 Release Notes

**Release Date:** October 12, 2025

## 🎉 What's New

This release brings powerful enhancements to the Global Hotkeys system, allowing you to control your Home Assistant entities with much more precision and flexibility!

## ✨ New Features

### 🎮 Advanced Hotkey Actions

You can now choose exactly what action each hotkey performs! Previously, hotkeys could only toggle entities on/off. Now, each entity type has its own set of appropriate actions:

#### **Lights** 💡
- Toggle (on/off)
- Turn On
- Turn Off
- **Brightness Up** - Increase brightness by 20%
- **Brightness Down** - Decrease brightness by 20%

#### **Switches** 🔌
- Toggle
- Turn On
- Turn Off

#### **Scenes** ✨
- Activate

#### **Automations** 🤖
- Trigger - Run the automation once
- Toggle - Enable/disable the automation
- Enable
- Disable

#### **Fans** 🌀
- Toggle
- Turn On
- Turn Off
- **Increase Speed** - Increase speed by 33%
- **Decrease Speed** - Decrease speed by 33%

#### **Input Booleans** 🎚️
- Toggle
- Turn On
- Turn Off

### 🎨 Improved UI

The hotkeys settings now feature a sleek dropdown menu for selecting actions, styled to match the app's modern aesthetic:
- Custom dropdown design with theme-consistent colors
- Clear visual hierarchy with proper spacing
- Smooth hover and focus transitions
- Intuitive action selection per entity

## 🐛 Bug Fixes

### Critical Hotkey Fixes
This release fixes **several critical bugs** that prevented hotkeys from working properly:

1. **Hotkeys Not Executing**
   - Fixed missing export of `executeHotkeyAction` function
   - Added proper IPC handlers for config management
   - Resolved event listener timing issues

2. **Action Selection Not Saving**
   - Dropdown changes now properly save to config
   - Hotkeys are re-registered immediately after changes
   - Action preferences persist across app restarts

3. **Clear Button Not Working**
   - Fixed button functionality with new dropdown layout
   - Proper element selection after UI restructure

### Repository Cleanup
Removed unnecessary build artifacts and files:
- Deleted `builder-debug.yml` with hardcoded build paths
- Removed `latest.yml` auto-updater manifest
- Deleted `win-unpacked/` build directory
- Removed redundant release notes files
- Updated `.gitignore` to prevent future artifacts

## 🎯 How to Use New Features

### Setting Up Advanced Hotkey Actions

1. Open **Settings** → **Hotkeys** tab
2. Find your entity in the list (or search for it)
3. Click in the **hotkey input field** to record a key combination
4. **Select the action** you want from the dropdown menu
5. The hotkey is now active with your chosen action!

### Changing Existing Hotkey Actions

1. Open **Settings** → **Hotkeys** tab
2. Find your existing hotkey
3. Simply **change the dropdown** to a different action
4. The change is saved automatically!

### Example Use Cases

**Dimmer Controls:**
- `Ctrl+Alt+Up` → Brightness Up
- `Ctrl+Alt+Down` → Brightness Down

**Fan Speed:**
- `Ctrl+Shift+F` → Toggle
- `Ctrl+Shift+Up` → Increase Speed
- `Ctrl+Shift+Down` → Decrease Speed

**Automation Management:**
- `Ctrl+Alt+A` → Trigger automation
- `Ctrl+Shift+A` → Enable/Disable automation

## 📋 Technical Details

### Files Modified
- `src/hotkeys.js` - Added action dropdown support and entity-specific options
- `src/ui.js` - Enhanced `executeHotkeyAction()` with all action types
- `styles.css` - Added custom styling for action dropdown
- `main.js` - Added missing IPC handlers (`save-config`, `register-hotkeys`)
- `renderer.js` - Fixed event handling and clear button functionality
- `package.json` - Version bump to 2.3.5
- `CHANGELOG.md` - Full changelog updated
- `.gitignore` - Enhanced to prevent build artifacts

### Key Improvements
- **Dynamic Action Options**: `getActionOptionsForDomain()` generates appropriate actions per entity type
- **Event Delegation**: Proper event listener management in hotkeys list
- **Config Synchronization**: Real-time config updates between renderer and main process
- **Brightness Control**: 20% increments for precise light control (51 units out of 255)
- **Fan Speed Control**: 33% increments for smooth speed adjustments

## 🚀 Installation

Download the latest version from the [Releases page](https://github.com/Robertg761/HA-Desktop-Widget/releases/tag/v2.3.5).

### Windows Users
- **Installer (Recommended)**: `HA-Desktop-Widget-2.3.5-win-x64-Setup.exe`
- **Portable**: `HA-Desktop-Widget-2.3.5-win-x64-Portable.exe`

## 🔄 Upgrade Notes

### From v2.3.4 or Earlier
- All settings and hotkeys are preserved
- Existing hotkeys will use "Toggle" action by default
- You can change any hotkey action in Settings → Hotkeys
- No configuration changes required

### Testing After Upgrade
1. Open Settings → Hotkeys
2. Check that all your existing hotkeys are still there
3. Try changing an action dropdown and see the toast confirmation
4. Test pressing your hotkeys with different actions
5. Enjoy the enhanced control! 🎉

## 🐛 Known Issues

None at this time. Please report any issues on the [GitHub Issues page](https://github.com/Robertg761/HA-Desktop-Widget/issues).

## 📝 Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for the complete list of changes since v1.0.0.

---

**Previous Release:** [v2.3.4](RELEASE_NOTES_v2.3.4.md)

Thank you for using HA Desktop Widget! 🏠✨

