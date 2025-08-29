# HA Desktop Widget v1.3.0

Highlights
- Design tokens and layout rhythm (spacing, radius, shadows, surface colors) for a cleaner, consistent UI
- Responsive dashboard grid (auto-fill, min card width), consistent toolbar/header structure
- Polished entity cards: subtle elevation, hover raise, compact ghost buttons, stronger focus states
- Micro-interactions: drop placeholder while dragging, entry animations for new cards, skeleton loaders for slow lists
- Edit mode UX: visible Save / Discard / + Add toolbar; Add Entities drawer no longer auto-opens; staged changes until Save

Editing & Layout
- Drag-and-drop reorder now uses a visible placeholder and only persists on Save
- Remove (×) button always visible in edit mode (including camera/doorbell cards)
- Extra spacing below toolbar so top row doesn’t crowd the first entity
Camera stability

- Dashboard camera: preserve controls and avoid teardown while Live is active; keep options visible on stop
- HLS fallback to MJPEG when necessary remains intact
Additional improvements
- A11y: aria-labels on icon-only buttons (remove)

- Skeleton placeholders for Scenes, Automations, Media, Weather lists
- Minor layout tidy-ups and consistent styling across themes





Notes
- Recommended: add custom icon at build/icon.ico (256×256) and optional tray icon.

