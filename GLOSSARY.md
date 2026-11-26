# Glossary

The words this codebase uses for its own concepts. Use them in code, comments, tests and docs so a
name means one thing everywhere. Architecture words (module, interface, seam, adapter, depth) follow
the deep-module vocabulary: a **deep** module hides a lot of behaviour behind a small interface.

## The widget

- **Page**: one dashboard tab of tiles. Stored as a `customTabs` entry; older code also says "tab"
  or "view". Say "page" in new code and in anything a user reads.
- **Tile**: an entity shown on a page (a Quick Access tile). Its size is its **tile span**; its
  per-tile settings are **tile options**.
- **Primary card**: the weather, time or media card above the pages.
- **Desktop pin**: one entity in its own small window on the desktop.
- **Alert rule**: a condition on an entity that raises an alert (`entityAlerts.alerts[id]`).
- **Pop-up card** (pop-up alert card): a small window an alert rule can open instead of a system
  notification, with a camera and up to two buttons (`popup` on the rule; `src/alert-popup*.cjs`,
  `src/alert-popup-view.js`). Its buttons are run by Entity Actions in the app window.
- **Profile** has three meanings; name which one:
  - **synced profile**: the document profile sync reads and writes, made of **sync sections**;
  - **HA profile**: the part of the config Home Assistant can push with `apply_profile`;
  - **profile folder**: the app's own data folder (`IS_ISOLATED_PROFILE`).

## Modules

- **Entity Actions** (`src/entity-actions.cjs`): what an entity can do and doing it.
  `describeEntity` says which actions an entity offers and what a click does; the runner made by
  `createEntityActions` sends the service call with optimistic state and debounce. Tiles, pins, the
  command palette, hotkeys and the Omarchy bar all ask it.
- **Settings field registry** (`packages/widget-renderer/src/settings-fields.cjs`): every setting
  declared once (shape, default, sync section, local-only, whether it holds entity ids). Settings
  files, profile sync, the HA profile, entity renames and defaults are views of it. A new setting
  is one entry here.
- **HA session** (`src/ha-session.js`): the Home Assistant connection protocol in the app window
  (login, bootstrap, snapshot, kept favourites) and its one batched **change feed**.
  `src/websocket.js` is its transport.
- **Config store**: owns config changes, one per process.
  - **Main config store** (`src/main-config-store.cjs`): serialized, durable, revision-stamped
    writes with rollback; effects subscribe once, keyed by the change's **origin**.
  - **Renderer config store** (`src/config-store.js`): sends a change to main through the
    renderer host, validates and adopts the answer, and rolls back on failure.
- **Profile sync engine** (`src/profile-sync-engine.cjs`): pulls, pushes, backups and key changes
  for profile sync. Its **sync target** is the seam with two adapters: a **folder** file and
  **Cloud Sync**.
- **IPC route table** (`src/ipc-routes.cjs`): every IPC channel declared once with the **sender
  roles** allowed to call it (`main`, `desktop-pin`, `alert-popup`). A new kind of window is a new
  role.
- **Login item** (`src/login-item.cjs`): start at login, with one adapter per platform.
- **Dialogs** (`src/dialogs.js`): opening and closing dialogs, focus trapping and toasts.
- **Colour maths** (`src/color-math.js`): pure colour and contrast helpers; never mocked in tests.
