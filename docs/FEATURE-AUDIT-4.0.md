# Feature audit for 4.0

Audited on September 29, 2026, against commit `d8624b39c32ca6df0dd2312023f9974442b05eb9`, package version `3.11.0`. The initial audit made no application changes. The September 30 implementation follow-up is recorded below. The earlier [release audit](RELEASE-4.0-AUDIT.md) remains separate; its resolved tooling, automation, and alert findings are not counted again here.

**Recommendation: complete the native and integration checks before tagging 4.0.** All 17 findings below now have implementation fixes and regression coverage. The two original P1 blockers affected profile preservation and companion command execution. Their reproduction details are retained as a record of the original audit, rather than a list of currently open defects.

P1 means potential loss of dashboard configuration or incorrect execution of a remote command. P2 means a reproducible broken flow, misleading display, missing advertised behavior, or inaccessible control. Release decisions and remaining verification work appear separately below.

## Implementation follow-up

The fixes are committed in a reviewable stack. Merge from the first layer upward after review and CI.

| Findings           | Implementation                                                                                                                                            | Pull request                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A01–A06            | Partial profile preservation, complete dashboard projection, local preference policy, command serialization/deduplication, session and snapshot lifecycle | [#117](https://github.com/Robertg761/HA-Desktop-Widget/pull/117) |
| A07–A12, A15       | Availability/capability checks, read-only to-do behavior, live counts/detail values, connection-scoped caches and responses, zero climate values          | [#118](https://github.com/Robertg761/HA-Desktop-Widget/pull/118) |
| A13–A14, A16–A17   | Helper/vacuum dialogs, explicit alarm commands with code capture, read-only tile semantics, RTL arrows, keyboard hotkey capture                           | [#119](https://github.com/Robertg761/HA-Desktop-Widget/pull/119) |
| Release and polish | Calendar recovery, entity-list pagination, accessible tile values, smaller build chunks/fonts, 4.0 metadata, migration/support/service scope              | Final release-polish layer                                       |

Companion and folder profiles now both preserve UI scale and Omarchy theme following. Companion profiles can intentionally select a page, while folder sync keeps the active page local. Stable 4.0 retains the regular tray; live tray tiles remain beta-only. Hosted Cloud Sync accounts/billing are outside the desktop 4.0 scope, and the website labels their proposed policies as drafts.

Follow-up automated and preview validation is recorded at the end of this report. Real device, deployed companion, native desktop, and two-computer checks remain outstanding.

## Scope and evidence

The review covered the Electron main process and preload boundary, renderer, shared renderer package, all six settings pages, Quick Access and primary cards, entity dialogs, command palette, hotkeys, automations, alerts, history and comparison graphs, camera/media paths, desktop pins, tray and Omarchy integration, connection lifecycle, credentials, backups, folder profile sync, companion profiles and commands, panel build, localization/accessibility, updates, packaging, website, and release documentation.

Three kinds of evidence are distinguished throughout:

- **Reproduced:** a focused behavioral check or interaction with the browser preview demonstrated the result.
- **Source confirmed:** the relevant implementation exposes the behavior; the complete external integration was not exercised.
- **Release decision / unverified:** product scope or native integration needs a decision or manual verification, without a demonstrated defect.

The browser preview runs the real renderer with simulated Electron and Home Assistant APIs. It is useful for UI behavior, but does not validate real devices, native window behavior, OS zoom, global shortcuts, or a deployed companion integration. No personal Home Assistant configuration was modified.

## Original findings at a glance

| ID  | Priority | Finding                                                               | Evidence                                                     |
| --- | -------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| A01 | P1       | Partial companion profiles can clear existing pages                   | Reproduced                                                   |
| A02 | P1       | Concurrent duplicate companion commands execute twice                 | Reproduced                                                   |
| A03 | P2       | Stopping a companion session can leave a new heartbeat running        | Reproduced                                                   |
| A04 | P2       | Snapshot deduplication survives a new companion session               | Reproduced; external impact conditional                      |
| A05 | P2       | Companion profiles overwrite preferences that folder sync keeps local | Reproduced                                                   |
| A06 | P2       | Panel/profile projection omits editable dashboard settings            | Source confirmed                                             |
| A07 | P2       | Unavailable devices still expose mutating controls                    | Reproduced                                                   |
| A08 | P2       | Primary media controls ignore supported features                      | Reproduced                                                   |
| A09 | P2       | Read-only to-do lists expose writes                                   | Reproduced                                                   |
| A10 | P2       | Cached to-do items override the live active count                     | Reproduced                                                   |
| A11 | P2       | Sensor details keep a stale current reading                           | Reproduced in tests and preview                              |
| A12 | P2       | Entity caches are not scoped to the Home Assistant server             | Reproduced for sensor history; other caches source confirmed |
| A13 | P2       | Selectable Quick Access entities have inert actions                   | Reproduced                                                   |
| A14 | P2       | Alarm commands described in the changelog are absent                  | Reproduced                                                   |
| A15 | P2       | A current climate temperature of zero displays the target             | Reproduced                                                   |
| A16 | P2       | RTL grid arrow navigation follows LTR indexes                         | Reproduced in preview                                        |
| A17 | P2       | Hotkey assignment cannot be started from the keyboard                 | Reproduced in preview; missing names source confirmed        |

## Profile and companion reliability

### A01. Partial companion profiles can clear existing pages

**Impact:** a request to change only the active page can replace the user's pages and entities with an empty default page. A partial graph update can also discard graphs because normalization has no current tabs to reconcile against.

**Reproduction:** start with populated Home and Bedroom pages. Apply a valid schema-1 profile whose document is only `{ activeTabId: 'bed' }`. The resulting patch contains replacement `customTabs` and `favoriteEntities`, rather than preserving the existing pages. This contradicts the schema's documented partial-update contract.

**Cause:** `normalizeProfileDocument` treats the presence of any Quick Access field as a complete configuration, fills absent fields with empty arrays, and normalizes before `buildConfigPatchFromApplyPayload` can consult current config. Graph reconciliation similarly uses only tabs in the incoming document.

**Location:** [profile-schema.js](../packages/widget-renderer/src/profile-schema.js), `normalizeProfileDocument` and `buildConfigPatchFromApplyPayload`.

**Acceptance:** merge partial sections with current configuration before reconciliation, or reject incomplete atomic sections with a clear error. Test active-page-only, favorites-only, graphs-only, full replacement, and intentional clearing. An omitted section must not become an implicit deletion.

### A02. Concurrent duplicate companion commands execute twice

**Impact:** duplicate delivery while a command is pending can execute a visibility toggle twice, undoing the requested result, or apply the same profile twice. Completed-command deduplication exists, but does not cover commands currently executing.

**Reproduction:** invoke `handleCommand` twice with the same unexpired command ID while the first `executeCommand` promise remains pending. Execution is called twice. This demonstrates the client behavior; duplicate-delivery frequency in the deployed integration was not measured.

**Cause:** the command ID enters `commandResults` only after execution completes. The subscription dispatches asynchronous handlers without serializing them.

**Location:** [desktop-companion-client.js](../src/desktop-companion-client.js), `handleCommand` and the `subscribe_commands` callback.

**Acceptance:** register an in-flight command before awaiting execution. Duplicate deliveries should await and acknowledge the same result. Also test distinct commands arriving together and define ordering for conflicting profile/page/visibility operations.

### A03. Stopping a companion session can leave a heartbeat running

**Impact:** shutdown or reconnect during initialization can leave an orphan interval. During reconnect, an obsolete initializer can overwrite the reference to the newer session's interval.

**Reproduction:** pause the initial `report_state` response, call `stop()`, then resolve the response. `initializeSession` subsequently creates a heartbeat even though the client has stopped.

**Cause:** the generation/start guard follows registration, but not the awaited state and snapshot reports that precede interval creation. `resetSession` cannot clear an interval that has not been created yet.

**Location:** [desktop-companion-client.js](../src/desktop-companion-client.js), `initializeSession` and `resetSession`.

**Acceptance:** check the current generation and started state after asynchronous initialization stages. Test stop and reconnect during each await, asserting that only the active session owns subscriptions and timers.

### A04. Snapshot deduplication survives a new companion session

**Impact:** a new server or an integration whose stored snapshots were cleared can receive registration/state without receiving the unchanged layout. Whether an ordinary reconnect loses useful data depends on the integration's persistence; that external behavior was not verified.

**Reproduction:** initialize, reset, and initialize again with an identical layout. Only one `put_config_snapshot` request is sent across both sessions.

**Cause:** `lastConfigSnapshot` survives `resetSession` and is not scoped to server/session identity.

**Location:** [desktop-companion-client.js](../src/desktop-companion-client.js), `resetSession` and `reportConfigSnapshot`.

**Acceptance:** ensure each new destination receives an initial snapshot. Scope deduplication to the destination or reset it on registration, and prevent responses from an obsolete session from updating the active session's cache.

### A05. Companion profiles overwrite machine-local preferences

**Impact:** applying a companion profile can change UI scale and Omarchy theme following, although folder profile sync deliberately preserves both on each machine. A layout shared from a different display or desktop environment can therefore change local presentation unexpectedly.

**Reproduction:** apply a profile with `ui.scale: 1.5` and `ui.followOmarchy: true` over local values of `1` and `false`. Both local values are overwritten.

**Cause:** folder sync explicitly adds scale and Omarchy theme following to its local exclusions. Companion profiles lack that protection. The overwrite is reproduced; whether the differing policies are intentional needs a product decision.

**Location:** [profile-schema.js](../packages/widget-renderer/src/profile-schema.js), `LOCAL_ONLY_UI_KEYS`; [profile-sync-core.js](../profile-sync-core.js), corresponding exclusions.

**Acceptance:** define one shared policy for machine-local preferences, or explicitly document why companion application has different semantics. Preserve scale and platform theme following by default. An explicit companion page-switch command may intentionally change the active page; it should not be conflated with these preferences.

### A06. Panel/profile projection omits editable dashboard settings

**Impact:** the panel renderer exposes weather/media selection and tile presentation settings, but its emitted profile does not include `selectedWeatherEntity`, `primaryMediaPlayer`, or `tileSpans`. These choices cannot round-trip through the current profile document even when they change the local editor view.

**Evidence:** settings write these top-level fields. `preview-main.js` emits `currentDocument()`, which uses `buildProfileDocumentFromConfig`; the schema allowlist excludes all three. This is a confirmed client projection gap, not a claim that a deployed panel was tested end to end.

**Location:** [profile-schema.js](../packages/widget-renderer/src/profile-schema.js), `PROFILE_SECTION_KEYS`; [preview-main.js](../preview/preview-main.js), `currentDocument` / document-change emission; [settings.js](../src/settings.js), weather/media selection and editable config keys.

**Acceptance:** decide which visible settings belong to a shareable profile. Include and normalize the supported fields, with schema compatibility considered, or hide/explain controls that cannot be saved by the panel. Test edit, emit, apply, and reopen for every supported field.

## Device controls and live data

### A07. Unavailable devices still expose mutating controls

**Impact:** offline devices appear operable and can generate rejected service calls. Existing light/climate/fan/cover dialogs have an unavailable-state helper, but other interaction paths do not consistently use it.

**Reproduction:** click an unavailable fan's Quick Access tile: it sends `fan.turn_on`. Select an unavailable primary media player: playback still sends a service call. Open a media dialog, then make the player unavailable: its controls remain enabled. An unavailable to-do list still has an enabled add control in the preview.

**Location:** [ui.js](../src/ui.js), `shouldBlockInteraction`, `executeEntityPrimaryAction`, `showMediaDetail`, `showTodoDetails`, and `callMediaTileService`; [renderer.js](../renderer.js), entity-hotkey service dispatch.

**Acceptance:** apply a consistent availability check to mutating entry points, including live transitions while a dialog is open. Keep useful read-only details and recovery actions accessible. Handle domain-specific states explicitly; an indiscriminate ban on `unknown` would incorrectly block legitimate entities such as scenes.

### A08. Primary media controls ignore supported features

**Impact:** the large media card offers playback/track commands a device does not support, while other media surfaces already use capability checks.

**Reproduction:** select a media player with `supported_features: 0`. Calling the primary card's next action sends `media_next_track`; the primary buttons do not reflect the missing playback capabilities.

**Location:** [ui.js](../src/ui.js), `updateMediaTile` and `callMediaTileService`; compare capability handling in `showMediaDetail` and desktop pins.

**Acceptance:** share capability logic across media surfaces. Disable or omit unsupported controls and guard dispatch as well as rendering. Cover capability changes, unavailable players, and seek/volume/play/pause differences.

### A09. Read-only to-do lists expose writes

**Impact:** a list integration that supports reading but not adding/updating items still presents an editable list, producing errors after the user acts.

**Reproduction:** open a to-do entity with `supported_features: 0`, enter an item, and submit. The dialog calls the add-item service. Item completion controls also lack supported-feature checks.

**Location:** [ui.js](../src/ui.js), `showTodoDetails` and `renderTodoItemsInto`.

**Acceptance:** respect each to-do mutation capability independently. Provide a useful read-only view, update controls when capabilities/availability change, and guard service dispatch even if a previously enabled control remains in the DOM.

### A10. Cached to-do items override the live active count

**Impact:** the tile can report an old number of active tasks after Home Assistant reports a new count, until the item cache is refreshed.

**Reproduction:** cache one active item, then update the entity's state to `3` within the cache TTL. The tile remains at `1 active`.

**Cause:** `getTodoTileCountLabel` prefers cached items over the current entity state, and a refresh can return the still-valid cache.

**Location:** [ui.js](../src/ui.js), `getTodoTileCountLabel`, `fetchTodoItems`, and `updateExistingQuickAccessControl`.

**Acceptance:** use the live state as the count where valid, or invalidate/refetch the item cache when the list changes. Test changes from another client, zero items, invalid state, and concurrent requests.

### A11. Sensor details keep a stale current reading

**Impact:** an open detail dialog shows an old value as its current reading while the underlying tile updates. Refreshing history does not update that summary.

**Reproduction:** open a sensor at `21.4`, then publish `29`. The tile displays `29`; the dialog still displays `21.4`. A focused test reproduces the same behavior with `21` and `24`.

**Location:** [ui.js](../src/ui.js), `showSensorDetails` and sensor-history detail mounting.

**Acceptance:** subscribe the current summary to live entity changes and release the subscription when the dialog closes. Include units, availability, and precision changes. If a snapshot is intended, label it with a capture time instead of presenting it as current.

### A12. Entity caches are not scoped to the Home Assistant server

**Impact:** switching servers can temporarily display history belonging to the previous server when both expose the same entity ID. To-do cache entries have the same identity problem.

**Reproduction:** fetch history for `sensor.office_temp`, change the configured Home Assistant URL, and render the same entity ID before cache expiry. The history request count remains one, reusing the previous server's cached series.

**Cause:** sensor-history and to-do caches are keyed by entity ID alone; the renderer's config application does not reset them for connection identity changes.

**Location:** [ui.js](../src/ui.js), `sensorHistoryCache` and to-do cache; [renderer.js](../renderer.js), `applyRendererConfig`.

**Acceptance:** scope caches and pending requests to the server/connection generation. Discard late responses from the old connection. Test a URL/account change with identical entity IDs, and distinguish that from a routine reconnect to the same server.

### A13. Selectable Quick Access entities have inert actions

**Impact:** users can add tiles that advertise a clickable/toggle interaction but perform no action. Support also differs from desktop pins, which already provide numeric and enum controls.

**Reproduction:** add `number`, `select`, and `vacuum` entities through Manage Quick Access. Clicking each produces neither a service call nor a detail/control dialog. The focused checks reproduced all three cases.

**Cause:** the picker accepts almost all domains, but primary action dispatch implements a smaller set. Generic tile button semantics/tooltips do not communicate a read-only result.

**Location:** [ui.js](../src/ui.js), Manage Quick Access, tile creation, `executeEntityPrimaryAction`, and `toggleEntity`; [desktop-pin-support.cjs](../src/desktop-pin-support.cjs) for the different pin capabilities.

**Acceptance:** provide the advertised controls for supported domains, or make read-only tiles explicitly read-only and remove action hints. Publish a capability matrix for Quick Access, primary cards, pins, hotkeys, palette, and Omarchy. Do not imply that every selectable entity has a toggle.

### A14. Alarm commands described in the changelog are absent

**Impact:** alarm panels are treated as command-only entities, but have no commands to select. The changelog promises named alarm commands and typed-only disarm behavior.

**Reproduction:** build palette commands with an alarm panel and registered alarm services. The alarm's command list is empty; selecting the entity has no named command to highlight.

**Cause:** `COMMAND_ONLY_DOMAINS` includes `alarm_control_panel`, and disarm appears in query-only policy, but `buildPaletteCommands` has no alarm command construction branch.

**Location:** [command-palette.js](../src/command-palette.js), command construction and command-only policy; [CHANGELOG.md](../CHANGELOG.md), 3.11 command-palette entries.

**Acceptance:** implement capability-aware named commands with code entry where required, preserving explicit typed intent for disarm, or remove the support claim and present an intentional read-only result. Test actual supported services and required-code rejection/recovery.

### A15. A current climate temperature of zero displays the target

**Impact:** valid readings around freezing are silently replaced with the setpoint. A value of zero in both fields can disappear entirely.

**Reproduction:** render a climate entity with `current_temperature: 0` and `temperature: 22`. The tile reads `22°`.

**Cause:** multiple climate summary, signature, creation, and update paths use `current_temperature || temperature`.

**Location:** [ui.js](../src/ui.js), `getQuickAccessTileSummaryText`, climate tile signature, climate tile creation, and live updates.

**Acceptance:** distinguish missing/invalid values from zero, consistently across surfaces. Test zero, negative temperatures, null current readings, missing targets, and unavailable entities.

## Accessibility and localization

### A16. RTL grid arrow navigation follows LTR indexes

**Impact:** visual tile order reverses in RTL, but arrow keys still move through LTR indexes. Navigation can remain on the rightmost tile when Arrow Left should move to its visible neighbor.

**Reproduction:** set the preview document to RTL with three tiles in a row. Focus the rightmost/first tile and press Arrow Left. Focus stays on that tile because index zero is clamped instead of moving left visually. This exercised RTL layout directly, not a downloaded Arabic pack.

**Location:** [ui.js](../src/ui.js), `handleQuickAccessGridKeydown`; [quick-access-ui-helpers.js](../src/quick-access-ui-helpers.js), index movement.

**Acceptance:** derive horizontal movement from the grid's computed direction. Test RTL and LTR, multiple rows, partial last rows, and Home/End without changing the current focus-management guarantees.

### A17. Hotkey assignment cannot be started from the keyboard

**Impact:** keyboard users can focus a hotkey assignment field but cannot initiate capture. The fields also lack programmatically associated entity labels.

**Reproduction:** open Hotkeys, focus an entity's read-only `.hotkey-input`, and press Enter. Capture does not start. The renderer starts capture only through its click handler. Preview DOM inspection found no associated labels or accessible names on the assignment inputs.

**Location:** [renderer.js](../renderer.js), `.hotkey-input` click delegation; [hotkeys.js](../src/hotkeys.js), assignment-row rendering.

**Acceptance:** expose capture as a named keyboard-operable button, or provide equivalent Enter/Space behavior with appropriate semantics. Associate each assignment with the entity name, announce capture/conflict/results, and test escape/cancellation and focus restoration. Include a pass over unassociated settings labels, including the color-target selector.

## Feature coverage and remaining release work

These rows summarize coverage, rather than asserting that an entire feature is defect-free.
The table records the original review. The implementation follow-up above supersedes its requests to resolve A01–A17; the external and native checks still apply.

| Area                           | Result of this audit                                                         | Remaining verification / completion                                              |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Connection and credentials     | Connection, IPC, encrypted persistence/recovery, and existing tests reviewed | Real HTTPS/auth failure, token rotation, and switching two HA servers            |
| Settings and customization     | All six pages inspected in preview; save/projection paths reviewed           | Resolve A05/A06/A17; native zoom and installed language packs                    |
| Quick Access and primary cards | Layout, edit mode, page switching, and live updates inspected                | Resolve unavailable actions, inert domains, zero readings, RTL navigation        |
| Device dialogs                 | Light/climate/fan/cover/media/to-do/calendar/sensor/camera paths reviewed    | Capability and availability parity; real device errors and recovery              |
| History and comparison graphs  | Renderer paths and tests reviewed; stale detail/cache behavior reproduced    | Cross-server reset and realistic recorder responses/large series                 |
| Media and cameras              | Playback/capability paths and streaming boundaries reviewed                  | Real HLS/reconnect/auth, seek/volume support, camera dialog cleanup              |
| Command palette and hotkeys    | Search/actions and assignment inspected                                      | Alarm completion, keyboard capture, native global-shortcut conflicts             |
| Automations and alerts         | Existing fixes and tests reviewed; not re-reported as open                   | Soak test reconnect, event storms, and native notifications                      |
| Desktop pins and tray          | Capability, persistence, native composition, and tests reviewed              | Native multi-monitor/DPI/scale/focus QA using existing pin checklist             |
| Omarchy integration            | Plugin/support code reviewed; Rust tests passed                              | Real layer positioning, monitor changes, bar interactions, theme changes         |
| Backup and folder profile sync | Schema/migration/conflict/encryption paths and tests reviewed                | Two computers using a real slow cloud folder; backup/restore and upgrade         |
| Companion and HA panel         | Profile projection and command lifecycle reviewed; races reproduced          | Resolve A01–A06, then deployed integration/panel round-trip                      |
| Localization and accessibility | Narrow preview, contrast options, keyboard and RTL checked                   | Installed RTL pack, screen reader, native scale, and systematic name/state audit |
| Updates and installers         | Update paths reviewed; Linux package built and smoke-tested                  | Exact release artifacts on each supported OS/update channel                      |
| Website and documentation      | Release/product claims compared with this checkout                           | Align service scope, versions, migration, and feature claims                     |

### Product and documentation decisions resolved

- **Live tray scope:** preserve the existing beta-only gate. Stable `4.0.0` and RC builds use the regular tray. The changelog and migration guide now state this scope. See [release-features.cjs](../packages/widget-renderer/src/release-features.cjs).
- **Cloud Sync scope:** the homepage and policy pages now explicitly describe a proposed hosted service outside desktop 4.0. The terms page and the Cloud Sync part of the privacy page are marked as drafts, and account actions are described as planned. The privacy page also describes what the desktop app and the website request. Free folder Profile Sync needs no hosted account or subscription. This work did not verify a separately deployed service. See [terms.html](../website/terms.html), [privacy.html](../website/privacy.html), and [index.html](../website/index.html).
- **Support/migration documentation:** [SECURITY.md](../SECURITY.md) now describes the transition to the stable 4.x support line. [Migration guidance](MIGRATION.md) covers configuration backups, sync format version 3, local preferences, credential recovery, and restoring pre-upgrade copies for a downgrade. The README links to it beside the shared-file compatibility warning.
- **Release metadata:** the package and lockfile are prepared for `4.0.0`, and the changelog has a nonempty `[4.0.0] - Unreleased` section. No release tag or publication is created by this preparation. The website takes its version and download links from the latest GitHub release and shows no version when that lookup fails, so it reads correctly before and after 4.0 is published.

### Original polish recommendations

- Calendar load errors have an error message but no in-dialog retry/refresh action. Provide the same recoverable workflow as sensor history and to-do lists, and make the upcoming-events time window clear.
- Benchmark the entity picker with several thousand entities. It builds the result list on search without the limiting behavior used by the primary picker. No latency regression was measured, so this is a performance check rather than a confirmed defect.
- The renderer build emits a bundle-size warning; the panel also ships substantial icon/font assets. Measure cold launch, panel download, idle CPU/memory, many graphs/pins, and camera-heavy use before deciding whether splitting or asset trimming belongs in 4.0. The warning alone is not a blocker.
- Check that assistive technology receives tile values and availability as well as entity names. This audit inspected DOM semantics but did not run a screen reader.

### Required native and integration checks

1. Test fresh installation, upgrade from a representative 3.x config, backup/restore, and failed-token recovery on the supported Windows, macOS, and Linux release targets.
2. Exercise native pin positioning, scaling, click/focus behavior, monitor removal, tray, startup, global hotkeys, and app visibility on real desktop sessions. Follow [desktop pin QA](DESKTOP_PIN_QA.md) and [testing guidance](TESTING.md).
3. Connect to real HA devices with incomplete capabilities, unavailable states, authentication/service failures, actual camera/HLS streams, calendars, to-do lists, and recorder history.
4. Run folder sync on two computers, including encryption, concurrent edits, a delayed cloud-folder write, upgrade compatibility, and recovery from a damaged file. Do not substitute same-process unit tests for this check.
5. Test the deployed companion and panel together: profile edit/apply/reopen, partial updates, server switching, disconnect during initialization, duplicate delivery, acknowledgement retries, and exact final state.
6. Verify actual release artifacts and update paths at the final release SHA. The current Linux startup result does not establish native Windows/macOS or production-sandbox compatibility.

## Verification performed

| Check                                | Result                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| Existing Jest suite with coverage    | 119 suites, 2,473 tests passed                                     |
| Coverage                             | Statements 83.16%, branches 70.21%, functions 86.31%, lines 86.14% |
| ESLint with zero warnings permitted  | Passed                                                             |
| Stylelint                            | Passed                                                             |
| Prettier repository check            | Passed on audited baseline                                         |
| Repository consistency check         | Passed                                                             |
| Renderer/preload production build    | Passed; bundle-size warning                                        |
| Panel production build               | Passed                                                             |
| Dependency audit                     | Zero reported vulnerabilities, including development dependencies  |
| Rust window helper tests             | Five tests passed                                                  |
| Linux x64 unpacked package           | Built with Electron 43.7.6                                         |
| Packaged Linux isolated startup      | `HA_WIDGET_SMOKE_TEST_OK`; exit 0                                  |
| Additional focused behavioral probes | 18 failing expectations reproduced the documented gaps             |

## Follow-up verification on September 30

| Check                                            | Result                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Full Jest suite with open-handle detection       | 122 suites, 2,531 tests passed; no open handles reported                                                   |
| ESLint, Stylelint, repository formatting/hygiene | Passed                                                                                                     |
| Renderer/preload and panel production builds     | Passed; no bundle-size warning                                                                             |
| Largest desktop chunks                           | HLS 341.70 kB, device UI 246.86 kB; entry 135.18 kB, before gzip                                           |
| Panel icon font output                           | One 403,216-byte WOFF2 file; omitted about 3.2 MB of EOT/TTF/WOFF fallback files                           |
| Linux x64 package / isolated startup             | Electron 43.7.6, version 4.0.0; `HA_WIDGET_SMOKE_TEST_OK`, exit 0                                          |
| Full dependency audit                            | Zero reported vulnerabilities after patching the transitive brace-expansion versions                       |
| Release metadata                                 | Package and both root lockfile versions 4.0.0; release-note extraction succeeds                            |
| Browser preview                                  | 500 × 760, 16 tiles, no horizontal overflow or console errors; MDI glyph/font load verified                |
| Keyboard capture                                 | Enter opens a named capture dialog; Escape restores focus to the same assignment field                     |
| Large entity picker                              | 5,018 entities, 50 rows rendered; about 7 ms to open, about 160 ms to search including the 150 ms debounce |

These timings are single preview observations on this machine, not native desktop cold-launch or device benchmarks. Synthetic preview state changes also verified the live sensor summary and unavailable primary media controls. Unit tests cover alarm code cancellation/validation, dispatch revalidation, secret exclusion from recents, numeric bounds/steps, changing options and vacuum capabilities, calendar retry, and RTL endpoints/navigation.

The final dependency audit newly reported brace-expansion advisories that were not listed in the initial audit result. Only its transitive patch versions were updated, to 1.1.21, 2.1.7, and 5.0.12. The upstream [quadratic expansion advisory](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) and [recursion advisories](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [comma parsing advisory](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) describe the fixes.

The packaged smoke check used a disposable profile, Xvfb, a private D-Bus session, and `--ozone-platform=x11 --no-sandbox`. It verifies startup of the split renderer, preload, and tray without changing the user's profile. It does not prove production sandbox behavior, native Wayland interactions, or Windows/macOS installation and updates. Portal warnings during teardown did not change its successful result.

PR #117's available lint/test, audit, macOS package, and four platform snapshot jobs passed. PRs #118 and #119 passed their four platform snapshot jobs. The final layer enables full CI on stacked PRs and manual dispatch; final CI is still required. The numbered native and integration checklist above remains the release gate. No release tag, publication, or merge was performed by this follow-up.

The packaged startup ran with a disposable smoke-test profile, Xvfb, private D-Bus, X11 selection, and `--no-sandbox`. It validates package startup in that environment, not a native Wayland session or production sandbox behavior. The initial launch attempt inherited `ELECTRON_RUN_AS_NODE=1`; clearing that environment variable allowed the correct Electron startup check.

The additional probes were temporary audit checks, separate from the passing existing suite, and were removed from the active test directory after recording their results. They covered three concurrent/session companion cases, two profile cases, media availability/capability, unavailable fan dispatch, read-only to-do mutation, stale to-do count, stale sensor detail, cross-server history cache, three inert tile domains, missing alarm commands, and zero-degree climate display. Panel projection and keyboard/RTL findings also have source or browser evidence as described above.

The existing suite emitted Jest's open-handles warning before exiting successfully. Coverage does not encompass all native behavior in `main.js`; passing unit checks do not replace the native and integration work above. Audit logs and temporary reproduction files are retained under `/tmp/ha-feature-audit/` for this workspace session.

## Suggested completion order

1. Fix A01 and A02 first, with preservation and concurrent-delivery regression tests.
2. Finish the companion lifecycle/profile contract (A03–A06) before testing the deployed panel.
3. Unify availability and supported-feature policy, then fix the stale/live-data cases (A07–A12/A15).
4. Complete or clearly scope entity actions and alarm commands, and finish keyboard/RTL behavior (A13/A14/A16/A17).
5. Resolve release/product documentation decisions, complete native/integration QA, and rerun required checks on the exact versioned release commit.
