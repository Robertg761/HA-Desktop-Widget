# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2025-08-29

Highlights
- Accessibility & UX
  - Added proper ARIA roles for tabs and tabpanels, and labeled tabs.
  - Keyboard navigation for tabs (ArrowLeft/Right, Home, End).
  - Focus trap for Settings and Filter modals; restores focus on close.
  - Density selector (Comfortable/Compact) in Settings; compact CSS variants.
  - Improved typography for sensor/climate values.
- Tabs & navigation
  - Scrollable tab bar with left/right chevrons; mouse wheel scroll support.
  - Active tab auto-scrolls into view; hidden scrollbar for cleaner look.
  - Shortcuts: Ctrl+Tab (next), Ctrl+Shift+Tab (previous).
- Layout & spacing
  - Increased spacing in sections, lists, and cards.
  - Better gaps between buttons/sliders and label spacing.
  - Global line-height adjustments to reduce cramped appearance.
- Connection & stability
  - Fixed a renderer syntax error that could block WebSocket initialization (stuck "Connecting…").
  - Clear connection status indicator and initial state/event subscriptions after auth.
- Modals & overlays
  - Correct z-index layering for Settings/Filter modals and loading overlay so they appear above the tab bar and content.
- Auto-update & tray
  - Integrated electron-updater; tray menu options for Settings and Check for Updates.
  - Minimize-to-tray / close-to-tray behavior.
- Build & release
  - GitHub Actions release workflow (tag push v*). Artifacts uploaded to a draft GitHub Release.
  - Artifact names for NSIS installer and Portable builds.
- Config & security
  - Config stored in OS userData directory; legacy config migrated from app folder.
  - config.json excluded from packaging and VCS.

Notes
- Recommended: add custom icon at build/icon.ico (256×256) and optional tray icon.
- To trigger CI build: create and push tag v1.1.0; a draft release will be created/updated with artifacts.

## [1.0.0] - 2025-01-01
- Initial public release.

