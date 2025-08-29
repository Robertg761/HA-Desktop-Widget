# HA Desktop Widget v1.2.0 (Draft)

Accessibility & UX
- ARIA roles for tabs/tabpanels; labeled tabs
- Keyboard navigation for tabs (ArrowLeft/Right, Home, End)
- Modal focus traps for Settings and Filter; focus restored on close
- Density selector (Comfortable/Compact) in Settings; compact CSS variants
- Improved typography for sensor/climate values

Tabs & Navigation
- Scrollable tab bar with ◀ ▶ buttons and mouse wheel horizontal scroll
- Active tab auto-scrolls into view
- Shortcuts: Ctrl+Tab (next), Ctrl+Shift+Tab (previous)
- Hidden scrollbar for cleaner look

Layout & Spacing
- Increased spacing in sections, entity lists, and cards
- Larger gaps between sliders/buttons; consistent label spacing
- Global line-height adjustments

Connection & Stability
- Fixed renderer syntax error that could block WebSocket init (stuck “Connecting…”) 
- Clear connection status indicator and initial subscriptions after auth

Modals & Overlays
- Correct z-index for Settings/Filter modals and loading overlay (above sticky tab bar)

Auto-update & Tray
- Integrated electron-updater; tray menu: Settings, Check for Updates
- Minimize-to-tray / close-to-tray behavior

Build & Release
- GitHub Actions (tag push v*) builds and uploads artifacts to a draft GitHub Release
- NSIS installer and Portable artifact naming

Config & Security
- Config stored in OS userData; legacy config migrated
- config.json excluded from packaging and VCS

Notes
- Recommended: add custom icon at build/icon.ico (256×256) and optional tray icon.

