# Desktop Pin QA

This checklist captures the durable desktop-pin behavior and release checks. The
old implementation plan has been completed; use this file when validating future
changes to pinned desktop tiles.

## Supported Pin Types

- `scene.` and `script.` action tiles
- `sensor.` and `binary_sensor.` display tiles
- Timer entities and timer-like sensors
- Toggle tiles: `switch.`, `input_boolean.`, and `lock.`
- Dense control tiles: `light.`, `fan.`, `climate.`, and `cover.`
- Numeric, select, weather, vacuum, person, automation and button tiles
- `camera.` action tiles
- `media_player.` wide media tiles
- Fallback display tiles for previously saved pins whose entity is now missing or unsupported.
  New pins can only be created for supported domains.

## Expected Behavior

- A pin is its tile and nothing else: there is no header or drag strip. A tile can only be
  moved or resized in edit mode, when the whole tile is the drag surface and the corner
  handles resize it (with the arrow keys too, Shift for larger steps).
- `Open widget` (or `Open` for a camera, which opens its viewer in the main window) is the
  only way to the main widget from a tile; `Focus Main` is used for fallback states.
- Hovering a tile shows the entity's name, so a name cut by the window can still be read.
- Only the light and scene tiles act wherever they are clicked; the rest show a hand only
  over their own buttons and sliders.
- Clickable controls remain outside Electron drag regions.
- Fallback states distinguish no entity selected, waiting for first data, unavailable,
  missing, and disconnected entities.
- Live updates should avoid replacing the tile root when markup can be updated in place.
- Active sliders, hover state, and keyboard focus should survive live state refreshes.

## Size And Layout Expectations

| Size class          | Tile types                                    | Minimum target | Default/open size |
| ------------------- | --------------------------------------------- | -------------- | ----------------- |
| Tiny display tiles  | `script.`, `sensor.`, `binary_sensor.`, timer | `140x110`      | `168x148`         |
| Scene nano tile     | `scene.`                                      | `36x56`        | `168x148`         |
| Small action tiles  | toggle, `camera.`, fallback                   | `156x122`      | `168x148`         |
| Dense control tiles | `light.`, `fan.`, `climate.`, `cover.`        | `168x148`      | `168x148`         |
| Wide media tiles    | `media_player.`                               | `260x148`      | `328x156`         |

- Shared panel and light tiles should promote to larger layouts only when both
  width and height clear the relevant thresholds.
- Media tiles may promote earlier on width once they also clear the validated
  short-height floor.
- Left and top resize clamps should preserve the opposite anchored edge when a
  tile hits its minimum size.
- Dense tiles should degrade gracefully at their minimum sizes without internal
  scrollbars or clipped primary controls.
- `168x148` is the baseline every family is drawn for: one spacing scale (8px padding, 6px
  gaps), captions no smaller than 9px, names of 12px or more, and buttons in sentence case.
  A longer translation ends in an ellipsis with the full text in a tooltip; it never widens
  the tile or pushes a control past the rounded bottom edge. Check every family at this size
  in English, German, French, Spanish and Arabic, and at 115%-150% interface size.

## Automated Coverage

Before release, keep targeted coverage passing for the desktop-pin paths:

- `tests/unit/ui.test.js`
- `tests/unit/renderer-desktop-pin.test.js`
- `tests/unit/desktop-pin-bounds.test.js`
- `tests/unit/desktop-pin-resize-main.test.js`
- `tests/unit/css-cascade-regressions.test.js` (the pin baseline)
- `tests/integration/settings-config.test.js`

Useful focused command:

```bash
npm test -- --runTestsByPath tests/unit/ui.test.js tests/unit/renderer-desktop-pin.test.js tests/unit/desktop-pin-bounds.test.js tests/unit/desktop-pin-resize-main.test.js tests/unit/css-cascade-regressions.test.js tests/integration/settings-config.test.js
```

The visual snapshot run (`npm run snapshots`, see [TESTING.md](TESTING.md)) has a `pin-*`
scene for every family, for the languages and interface sizes above, and for the light theme.

Also run:

```bash
npm run lint
```

## Manual Release QA

These checks need a packaged Electron build and a real close/relaunch cycle:

- [ ] Packaged edit-mode desktop pin drag/resize smoke pass: verify drag handles,
      resize handles, clamping, and content layout while edit mode is active.
- [ ] Packaged restart persistence smoke pass: resize and move representative
      desktop pins, fully quit/relaunch the app, and confirm restored position, size,
      minimum bounds, and selected entity.
- [ ] Resize a pin at 150% interface size from each corner, and drag one across the boundary
      between two monitors: the edge opposite the handle must not move, and the pin must not
      jump to the other monitor.
- [ ] On Hyprland, Sway, niri or river (layer-shell pins), resize a pin from each corner,
      after dragging it first where the compositor allows: the edge opposite the handle must
      not move, and a restart must bring the pin back at the size and position it ended with.
- [ ] Pin several tiles in a row, unpin one, and pin another: new pins open in the first free
      spot from the top-right corner of the widget's monitor and never on top of each other.

Remaining risk: automated tests cover the renderer, bounds, and config paths, but
they do not prove the native packaged window lifecycle end to end.
