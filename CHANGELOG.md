# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2025-08-29

Highlights
- Design tokens and layout rhythm for consistent, polished UI (spacing, radius, surfaces, shadows)
- Responsive dashboard grid with section header/toolbar pattern
- Card polish: subtle elevation, hover, compact ghost buttons, stronger focus states
- Micro-interactions: visible drop placeholder while dragging, entry animations, skeleton loaders
- Edit mode UX: Save / Discard / + Add toolbar always visible; Add Entities drawer no longer auto-opens; changes staged until Save
- Drag-and-drop: only persists on Save; better placeholder positioning in wrapping grid
- A11y: icon-only remove (×) buttons get aria-label; remove buttons always visible in edit mode
- Toolbar spacing added so buttons don’t crowd the first entity
- Camera stability: preserve dashboard camera card while Live; avoid UI teardown; keep controls visible on stop

## [1.2.0] - 2025-08-15

Dashboard & Editing
- “Reset size” button on each entity card in edit mode to clear custom sizing and revert to defaults
- Drag-and-drop logic updated to consider both horizontal and vertical pointer position for flexible wrapping layouts
- Entity selector reworked into a docked drawer with toggle; draggable header; dashboard resizes so drawer doesn’t obscure content
- Camera edit-mode growth fix: camera embed height only adjusts if a custom or inline size is set (prevents unwanted growth entering edit mode)
- Edit button moved above entities; improved entity card spacing/padding to prevent overflow and uneven layout

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

