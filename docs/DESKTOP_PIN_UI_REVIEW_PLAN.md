# Desktop Pin UI Review Plan

**Stage 1: Interaction And Fallback Foundation**

Goal: make pinned desktop tiles usable and understandable before touching layout tuning.

- [x] Review current desktop pin interaction flow in `index.html`, `renderer.js`, `styles.css`, `src/ui.js`, and `main.js`.
- [x] Decide the intended normal-mode interaction model for pinned tiles:
  - visible header,
  - visible action rail,
  - context menu only,
  - or mixed model.
- [x] Record that interaction decision in this file once chosen.
- [x] Remove hidden-but-live action behavior so visible UI matches actual functionality.
- [x] Make primary actions discoverable in normal mode:
  - `Open`
  - `Unpin`
  - `Focus Main Widget` if still needed
- [x] Preserve proper Electron drag-region behavior:
  - drag only where dragging is intended,
  - no-drag on clickable controls.
- [x] Define the allowed desktop pin fallback states:
  - no entity selected,
  - waiting for first live data,
  - unavailable or missing entity.
- [x] Update desktop pin rendering so only one fallback surface appears at a time.
- [x] Ensure fallback copy matches the actual state being shown.

Dependencies:

- This should happen first.
- Layout work and render-stability work depend on the interaction and fallback model being stable.

**Stage 2: Size Audit And Layout Rules**

Goal: define what each pinned tile type actually needs before changing breakpoint or clamp behavior.

- [x] Review desktop pin layouts in `main.js`, `src/ui.js`, and `styles.css`.
- [x] List all supported desktop pin types:
  - scene/script,
  - sensor/binary sensor,
  - timer,
  - toggle,
  - light,
  - fan,
  - climate,
  - cover,
  - camera,
  - media,
  - fallback.
- [x] Group pin types into size classes:
  - tiny display tiles,
  - small action tiles,
  - dense control tiles,
  - wide media tiles.
- [x] Create a minimum-size matrix for those classes and record it in this file.
- [x] Review `getDesktopPinLayoutProfile()` and document how layout promotion should work.
- [x] Decide whether layout promotion should be based on:
  - both width and height,
  - area thresholds,
  - domain-specific overrides,
  - or a combination.
- [x] Preserve scene/script nano behavior unless testing shows it should change.

Dependencies:

- Depends on Stage 1 because visible actions and fallback states affect usable space.
- Should be completed before changing clamp behavior or micro-layout degradation.

**Stage 3: Breakpoints, Bounds, And Resize Safety**

Goal: stop pinned tiles from entering visually broken sizes or over-promoted layouts.

- [ ] Update `getDesktopPinLayoutProfile()` so `balanced` and `roomy` are not chosen too aggressively.
- [ ] Update any CSS selectors that rely on the old layout behavior.
- [ ] Update minimum desktop pin bounds logic in `main.js`.
- [ ] Add per-domain minimum bounds where dense tile types need more space.
- [ ] Keep scene/script minimum behavior only if validated by the size audit.
- [ ] Re-check resize clamping from all four resize handles.
- [ ] Confirm default pin bounds still feel sensible after bound updates.
- [ ] Confirm saved bounds persist correctly after resize and restart.
- [ ] Verify pinned tiles cannot be resized into clearly broken states.

Dependencies:

- Depends on Stage 2 size targets.
- Should be finished before detailed small-layout cleanup, because micro rules depend on final breakpoint behavior.

**Stage 4: Small-Size Degradation For Dense Tiles**

Goal: make dense pinned tiles degrade gracefully instead of clipping controls.

- [ ] Identify dense tile types that need special small-size handling:
  - climate,
  - fan,
  - cover,
  - media,
  - and any others discovered in review.
- [ ] Decide what should degrade first for each dense type:
  - secondary labels,
  - extra presets,
  - extra mode buttons,
  - extra metadata,
  - spacing.
- [ ] Update CSS so dense tiles simplify at smaller sizes without becoming unusable.
- [ ] Update markup logic in `src/ui.js` where layout-specific content needs to collapse.
- [ ] Keep tap targets and interactive controls large enough to remain practical.
- [ ] Avoid internal scrolling unless it is the only safe fallback.
- [ ] Re-test minimum-size behavior for each dense tile class.

Dependencies:

- Depends on Stage 3 breakpoint and bound behavior.
- Works best after final minimum sizes are known.

**Stage 5: In-Place Update Coverage**

Goal: remove unnecessary full re-renders and stabilize live updates across all supported pin types.

- [ ] Audit which desktop pin types already support update-in-place behavior in `src/ui.js`.
- [ ] Add missing update handlers for:
  - scene/script,
  - toggle,
  - camera,
  - sensor/binary sensor,
  - timer,
  - fallback.
- [ ] Extend `updateExistingDesktopPinPanelControl()` to cover all practical pin types.
- [ ] Keep root nodes stable wherever possible.
- [ ] Update only changed text, state, aria attributes, button labels, and dataset flags.
- [ ] Verify layout changes after resize still update correctly.
- [ ] Verify unavailable-to-live and live-to-unavailable transitions remain correct.

Dependencies:

- Depends partly on Stage 1 fallback cleanup.
- Should be completed after Stage 3 and Stage 4 so update logic matches the final layout model.

**Stage 6: Live Interaction Stability**

Goal: ensure live state refreshes do not interrupt active user interaction.

- [ ] Test sliders during live refreshes and confirm active interaction is not stomped.
- [ ] Test hover and focus states during live updates.
- [ ] Test normal-mode desktop pin actions during live updates.
- [ ] Test edit mode during live updates.
- [ ] Preserve optimistic UI behavior where it already exists.
- [ ] Prevent unnecessary rerenders from causing visible flicker or focus loss.

Dependencies:

- Depends on Stage 5 update coverage.
- Some work may overlap with Stage 5, but final validation should happen after Stage 5 is complete.

**Stage 7: Final QA And Handoff**

Goal: verify the full pinned-tile experience and leave a clean handoff record.

- [ ] Test scene/script pins.
- [ ] Test sensor pins.
- [ ] Test timer pins.
- [ ] Test toggle pins.
- [ ] Test light pins.
- [ ] Test fan pins.
- [ ] Test climate pins.
- [ ] Test cover pins.
- [ ] Test camera pins.
- [ ] Test media pins.
- [ ] Test unavailable state.
- [ ] Test waiting-for-data state.
- [ ] Test normal mode actions.
- [ ] Test edit mode drag and resize.
- [ ] Test minimum-size clamp behavior.
- [ ] Test persistence after app restart.
- [ ] Run lint/tests for touched code paths if available.
- [ ] Record QA notes in this file.
- [ ] Record any remaining follow-up issues in this file.

Dependencies:

- Final pass happens after Stages 1 through 6.

## Notes

### Chosen Interaction Model

- [x] Normal mode uses a visible header with a dedicated drag strip on the left and a visible action rail on the right.
- [x] `Open` stays visible in normal mode and is disabled whenever the tile does not have live entity data yet.
- [x] `Unpin` stays visible in normal mode as an explicit text action instead of a hidden or symbolic-only affordance.
- [x] `Focus Main Widget` is treated as a fallback CTA, not a permanent header action, because `Open` already focuses the main widget when a live tile can be opened there.

### Stage 1 Fallback States

- [x] `No entity selected`: show setup-oriented copy and expose `Focus Main`.
- [x] `Waiting for first live data`: show a waiting message only, with no competing unavailable tile surface.
- [x] `Unavailable`: show copy that the entity is currently unavailable in Home Assistant and expose `Focus Main`.
- [x] `Missing entity`: show copy that the pinned entity could not be found in the latest snapshot and expose `Focus Main`.

### Stage 2 Audit Notes

- [x] `main.js` currently opens standard desktop pins at `168x148`, media pins at `328x156`, clamps most pins to `140x110`, and keeps a special `scene.` minimum at `36x56`.
- [x] `src/ui.js` currently routes supported desktop pins as:
  - `scene.` and `script.` -> scene tile markup,
  - `sensor.` / `binary_sensor.` -> sensor display tile,
  - timer entities and timer-like sensors -> timer tile,
  - `switch.` / `input_boolean.` / `lock.` -> toggle tile,
  - `light.` -> light control tile,
  - `fan.` -> fan control tile,
  - `climate.` -> climate control tile,
  - `cover.` -> cover control tile,
  - `camera.` -> camera action tile,
  - `media_player.` -> media tile,
  - anything else -> fallback display tile.
- [x] `styles.css` uses one shared panel system for climate/fan/cover/media/toggle/camera/sensor/timer/fallback tiles, a dedicated light ruleset, and a scene-specific tiny/nano ruleset.
- [x] Current shared layout thresholds are:
  - `micro` when width `<= 155` or height `<= 122`,
  - `compact` otherwise,
  - `balanced` when width `>= 195` or height `>= 160`,
  - `roomy` when width `>= 260` or height `>= 190`,
  - plus a scene-only `nano` override when width `<= 96` or height `<= 82`.
- [x] The current width-or-height promotion rule is too aggressive for short-but-wide and tall-but-narrow tiles. Stage 3 should replace that with combined axis checks plus limited domain overrides.

### Stage 2 Size Classes

- [x] `Tiny display tiles`: scene/script, sensor/binary sensor, timer.
- [x] `Small action tiles`: toggle, camera, fallback.
- [x] `Dense control tiles`: light, fan, climate, cover.
- [x] `Wide media tiles`: media.

### Size Matrix

| Size class | Tile types | Minimum target | Default/open size | Why this is the floor |
| --- | --- | --- | --- | --- |
| Tiny display tiles | scene/script, sensor, binary sensor, timer | `140x110` for value tiles; keep the existing scene nano exception at `36x56` | `168x148` | Sensor/timer tiles only need a header and one large value block. Scene tiles are the only validated exception that can collapse far below the shared floor because they render as an icon-forward trigger. |
| Small action tiles | toggle, camera, fallback | `156x122` | `168x148` | These tiles need room for a visible CTA after the Stage 1 header/action rail changes. The fallback surface especially needs enough height for title, copy, and optional `Focus Main` without immediately looking cramped. |
| Dense control tiles | light, fan, climate, cover | `168x148` | `168x148` | These tiles include sliders, KPIs, and multiple actions. They can degrade visually below this range today, but they stop being comfortably usable and are the primary reason Stage 3 needs per-domain minimums. |
| Wide media tiles | media | `260x148` | `328x156` | Media is intentionally horizontal: title/artist copy, progress row, and three transport buttons need width first, but still need enough height to avoid a fake “roomy” promotion on a shallow tile. |

### Stage 2 Layout Promotion Decision

- [x] Use a combination of both dimensions plus domain-specific overrides.
- [x] General rule for panel and light tiles:
  - keep `micro` as the defensive low-size state whenever either axis drops under the micro floor,
  - do not promote to `balanced` unless both width and height clear the balanced threshold,
  - do not promote to `roomy` unless both width and height clear the roomy threshold.
- [x] Allow limited domain-specific overrides instead of pure area math:
  - media may promote earlier on width once it also clears a minimum short-height floor, because its layout is intentionally wide rather than tall,
  - scene keeps the current tiny/nano exception,
  - other domains should not get width-only `roomy` promotion by default.
- [x] Area can be used only as a secondary sanity check, not the primary promotion trigger, because equal area does not mean equal usability for a slider-heavy tile versus a wide media tile.
- [x] Preserve the current scene nano behavior during Stage 3.
  - Both `scene.` and `script.` use the same scene tile component today, but the nano selector is currently scoped to `scene.`. Keep that existing behavior unless later testing shows scripts should share the nano path too.

### QA Results

- [ ] Fill this in during Stage 7.

### Remaining Follow-Ups

- [ ] Fill this in during Stage 7 if anything remains unresolved.
