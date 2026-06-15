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
- `camera.` action tiles
- `media_player.` wide media tiles
- Fallback display tiles for unsupported or unknown domains

## Expected Behavior

- Normal mode shows a visible header, a dedicated drag strip, and clear actions.
- `Open` is visible for live tiles and disabled until live entity data is available.
- `Unpin` is visible as an explicit action.
- `Focus Main` is used for fallback states instead of being a permanent header action.
- Clickable controls remain outside Electron drag regions.
- Fallback states distinguish no entity selected, waiting for first data, unavailable,
  missing, and disconnected entities.
- Live updates should avoid replacing the tile root when markup can be updated in place.
- Active sliders, hover state, and keyboard focus should survive live state refreshes.

## Size And Layout Expectations

| Size class | Tile types | Minimum target | Default/open size |
| --- | --- | --- | --- |
| Tiny display tiles | `script.`, `sensor.`, `binary_sensor.`, timer | `140x110` | `168x148` |
| Scene nano tile | `scene.` | `36x56` | `168x148` |
| Small action tiles | toggle, `camera.`, fallback | `156x122` | `168x148` |
| Dense control tiles | `light.`, `fan.`, `climate.`, `cover.` | `168x148` | `168x148` |
| Wide media tiles | `media_player.` | `260x148` | `328x156` |

- Shared panel and light tiles should promote to larger layouts only when both
  width and height clear the relevant thresholds.
- Media tiles may promote earlier on width once they also clear the validated
  short-height floor.
- Left and top resize clamps should preserve the opposite anchored edge when a
  tile hits its minimum size.
- Dense tiles should degrade gracefully at their minimum sizes without internal
  scrollbars or clipped primary controls.

## Automated Coverage

Before release, keep targeted coverage passing for the desktop-pin paths:

- `tests/unit/ui.test.js`
- `tests/unit/renderer-desktop-pin.test.js`
- `tests/unit/desktop-pin-bounds.test.js`
- `tests/integration/settings-config.test.js`

Useful focused command:

```bash
npm test -- --runTestsByPath tests/unit/ui.test.js tests/unit/renderer-desktop-pin.test.js tests/unit/desktop-pin-bounds.test.js tests/integration/settings-config.test.js
```

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

Remaining risk: automated tests cover the renderer, bounds, and config paths, but
they do not prove the native packaged window lifecycle end to end.
