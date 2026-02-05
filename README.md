# HA Desktop Widget

A semi-transparent, desktop widget for Home Assistant that provides quick access to your smart home devices from your desktop.

[![CI (Windows)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/ci.yml)
[![Release (Windows)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml/badge.svg)](https://github.com/Robertg761/HA-Desktop-Widget/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

- Download: https://github.com/Robertg761/HA-Desktop-Widget/releases

- [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-me-orange)](https://github.com/sponsors/robertg761)

![Main View](Main_View.png) ![Edit View](Edit_View.png) ![Light_Adjust](Light_Adjust.png)

## Features

### 🏠 Smart Home Control
- **Real-time Updates**: WebSocket connection for instant entity state changes
- **Quick Access Dashboard**: Customizable grid of your most-used entities
- **Entity Management**: Add, remove, and reorder entities with drag-and-drop
- **Custom Names**: Rename entities with custom display names that persist
- **Interactive Controls**: Toggle lights, switches, scenes, and more with a single click

### 🎨 Modern Interface
- **Rainmeter-style Design**: Clean, transparent desktop widget aesthetic
- **Responsive Layout**: Auto-sizing tiles that adapt to content
- **Dark/Light Themes**: Automatic theme switching based on system preferences
- **Smooth Animations**: Fluid drag-and-drop and hover effects
- **Toast Notifications**: Real-time feedback for all actions

### 📱 Entity Support
- **Lights**: Toggle on/off, brightness control with vertical slider
- **Switches & Fans**: Simple on/off controls
- **Sensors**: Real-time value display with units
- **Timers**: Live countdown displays for active timers
- **Cameras**: Live feed viewing with snapshot fallback
- **Climate**: Temperature display and control
- **Media Players**: Play/pause and volume controls
- **Scenes**: One-click scene activation

### ⚙️ Advanced Features
- **Auto-Updates**: Seamless background updates from GitHub
- **System Tray**: Minimize to tray with quick access menu
- **Configuration**: Easy setup with Home Assistant URL and token
- **Performance**: Optimized rendering and memory management
- **Cross-Platform**: Windows 10/11 support with transparency effects

## 🚀 Quick Start

### Download & Install
1. Go to the [Releases](https://github.com/Robertg761/HA-Desktop-Widget/releases) page and download the latest Installer (.exe) or Portable build.
2. If using the Installer: run the .exe and follow the prompts. If using the Portable build: unzip and run the executable (no installation required).
3. Run the app and click the Settings (⚙️) button to configure your Home Assistant connection.

### First-Time Setup
1. **Get your Home Assistant URL**: Usually `http://your-ha-ip:8123` or `https://your-ha-domain.com`
2. **Create a Long-Lived Access Token**:
   - Go to your Home Assistant profile (click your avatar)
   - Scroll down to "Long-lived access tokens"
   - Click "Create token" and give it a name like "Desktop Widget"
   - Copy the generated token
3. **Configure the widget**:
   - Paste your HA URL and token in Settings
   - Click "Save" - the widget will connect automatically
4. **Add entities**: Click the "+" button to add your favorite entities to Quick Access

## 🎮 How to Use

### Quick Access Management
- **Add Entities**: Click the "+" button to search and add entities to your dashboard
- **Reorder**: Click the "⋮⋮" button to enter reorganize mode, then drag and drop to reorder
- **Rename**: In reorganize mode, click the pencil (✏️) icon to set custom display names
- **Remove**: In reorganize mode, click the red "×" button to remove entities

### Entity Interactions
- **Lights**: Click to toggle, long-press for brightness slider
- **Cameras**: Click to view live feed in popup window
- **Sensors**: Display real-time values with automatic unit formatting
- **Timers**: Show live countdown when active
- **Scenes**: Click to activate instantly

### System Integration
- **Minimize to Tray**: Click the minimize button to hide to system tray
- **Auto-Updates**: The app automatically checks for and installs updates
- **Settings**: Access via the ⚙️ button or right-click the tray icon

## 🔧 Advanced Usage

### Build from Source
```bash
git clone https://github.com/Robertg761/HA-Desktop-Widget.git
cd HA-Desktop-Widget
npm install
npm start     # Development mode
npm run dist  # Build for distribution
```

### Configuration
- **Config Location**: `%AppData%/Home Assistant Widget/config.json`
- **Custom Names**: Stored in `customEntityNames` object
- **Favorites**: Stored in `favoriteEntities` array
- **Security**: Tokens are never committed to version control

## 🐛 Troubleshooting

### Connection Issues
- **Verify URL**: Ensure your Home Assistant URL is accessible from your computer
- **Check Token**: Make sure your long-lived access token is valid and not expired
- **Firewall**: Ensure Windows Firewall allows the app to connect to your network
- **Network**: Test connectivity by opening your HA URL in a web browser

### Performance Issues
- **Reduce Entities**: Limit the number of entities in Quick Access
- **Visual Effects**: Disable transparency if experiencing performance issues

### Common Solutions
- **Restart**: Close and reopen the app if entities aren't updating
- **Reconnect**: Go to Settings and click "Save" to reconnect to Home Assistant
- **Check Logs**: Look for error messages in the app's console (F12 in development mode)

## 🤝 Contributing

We welcome contributions! Here's how you can help:

### Reporting Issues
- **Bug Reports**: Use the [Issues](https://github.com/Robertg761/HA-Desktop-Widget/issues) page
- **Feature Requests**: Submit enhancement ideas with detailed descriptions
- **Documentation**: Help improve this README or add usage examples

### Development
- **Fork & Clone**: Fork the repository and clone your fork
- **Create Branch**: Make changes in a feature branch
- **Test**: Ensure your changes work and don't break existing functionality
- **Submit PR**: Create a pull request with a clear description of your changes

### Code Style
- **ESLint**: Follow the existing code style (run `npm run lint`)
- **Comments**: Add comments for complex logic
- **Testing**: Add tests for new features when possible

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Electron](https://electronjs.org/) for cross-platform desktop apps
- Uses [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket) for real-time updates
- Inspired by the clean aesthetic of [Rainmeter](https://www.rainmeter.net/) desktop widgets

---

**⭐ If you find this project useful, please give it a star on GitHub!**
