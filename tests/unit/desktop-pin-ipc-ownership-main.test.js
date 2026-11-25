/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { normalizeEntityId } = require('../../src/desktop-pin-bounds.js');
const { normalizeDesktopPinActionRequest } = require('../../src/desktop-pin-ipc.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

/** main.js's handlers for the pin channels that act on an entity, over stubbed collaborators. */
function loadHandlers() {
  const handlers = {};
  const done = () => ({ success: true });
  const context = vm.createContext({
    ipcRoutes: { handle: (channel, handler) => (handlers[channel] = handler) },
    normalizeEntityId,
    normalizeDesktopPinActionRequest,
    updateDesktopPinBounds: jest.fn(done),
    nudgeDesktopPin: jest.fn(done),
    syncDesktopPinContentMinBounds: jest.fn(done),
    forwardDesktopPinActionToMainWindow: jest.fn(done),
    focusMainWindow: jest.fn(),
    mainWindow: { isDestroyed: () => false, webContents: { send: jest.fn() } },
    performance: { now: () => 0 },
    hasPublishedHaSnapshot: true,
    desktopPinSnapshotRequestedAt: 0,
    DESKTOP_PIN_SNAPSHOT_REQUEST_COALESCE_MS: 0,
    latestEntityStates: new Map(),
    latestHaUnitSystem: null,
    latestHaConnectionState: 'connected',
    config: { desktopPins: { 'light.a': {}, 'light.b': {} } },
    usesCompositorOwnedPlacement: false,
    createDesktopPinRendererConfig: () => ({}),
    createDesktopPinConnectionState: () => ({}),
    hasDeferredSecureConfigWork: () => false,
    omarchyThemeWatcher: null,
    isLayerShellChildProcess: false,
    isHyprland: () => false,
    NATIVE_GLASS_SUPPORTED: false,
    desktopPinEditMode: false,
  });
  vm.runInContext(
    [
      sliceBetween(
        "ipcRoutes.handle('update-desktop-pin-bounds'",
        "ipcRoutes.handle('unpin-entity-from-desktop'"
      ),
      sliceBetween(
        "ipcRoutes.handle('get-desktop-pin-bootstrap'",
        "ipcRoutes.handle('publish-ha-connection-state'"
      ),
      sliceBetween(
        "ipcRoutes.handle('request-desktop-pin-action'",
        "ipcRoutes.handle('desktop-pin-action-response'"
      ),
    ].join('\n'),
    context
  );
  return { handlers, context };
}

const UNAUTHORIZED = { success: false, error: 'Unauthorized' };

// Each channel, the extra arguments a call passes after the entity, and the collaborator that
// does the work once the sender is let through.
const ENTITY_CHANNELS = [
  ['update-desktop-pin-bounds', [{ width: 200 }], 'updateDesktopPinBounds'],
  ['nudge-desktop-pin', [{ x: 1 }], 'nudgeDesktopPin'],
  ['sync-desktop-pin-content-min-bounds', [{ width: 100 }], 'syncDesktopPinContentMinBounds'],
  ['get-desktop-pin-bootstrap', [], null],
  ['request-desktop-pin-action', ['focus-main'], 'forwardDesktopPinActionToMainWindow'],
];

describe('desktop pin channels that act on an entity', () => {
  const pin = { role: 'desktop-pin', entityId: 'light.a' };

  describe.each(ENTITY_CHANNELS)('%s', (channel, args, worker) => {
    async function call(sender, entityId) {
      const { handlers, context } = loadHandlers();
      const result = await handlers[channel](sender, entityId, ...args);
      return { result, worked: worker ? context[worker].mock.calls.length > 0 : null };
    }

    it('lets a pin act on its own entity and the main window act on any', async () => {
      for (const [sender, entityId] of [
        [pin, 'light.a'],
        [{ role: 'main' }, 'light.b'],
      ]) {
        const { result, worked } = await call(sender, entityId);
        expect(result).not.toEqual(UNAUTHORIZED);
        if (worker) expect(worked).toBe(true);
        else expect(result.entityId).toBe(entityId);
      }
    });

    it.each([
      ['a pin acting on another entity', pin, 'light.b'],
      // Any role other than main is held to its own entity, so one added later starts restricted.
      ['a role added later', { role: 'alert-popup' }, 'light.a'],
      [
        'a role added later, on another entity',
        { role: 'alert-popup', entityId: 'light.a' },
        'light.b',
      ],
    ])('turns away %s', async (_label, sender, entityId) => {
      const { result, worked } = await call(sender, entityId);
      expect(result).toEqual(UNAUTHORIZED);
      if (worker) expect(worked).toBe(false);
    });
  });
});

describe('begin-layer-drag', () => {
  function beginDrag(sender, { editMode }) {
    const readHyprlandCursor = jest.fn(async () => null);
    const handlers = {};
    vm.runInNewContext(
      sliceBetween("ipcRoutes.handle('begin-layer-drag'", "ipcRoutes.handle('end-layer-drag'"),
      {
        ipcRoutes: { handle: (channel, handler) => (handlers[channel] = handler) },
        isLayerShellChildProcess: true,
        isHyprland: () => true,
        desktopPinEditMode: editMode,
        layerDrag: null,
        readHyprlandCursor,
      }
    );
    return handlers['begin-layer-drag'](sender).then(() => readHyprlandCursor.mock.calls.length);
  }

  it('lets only the main window start a drag outside edit mode', async () => {
    expect(await beginDrag({ role: 'main' }, { editMode: false })).toBe(1);
    expect(await beginDrag({ role: 'desktop-pin', entityId: 'light.a' }, { editMode: false })).toBe(
      0
    );
    expect(await beginDrag({ role: 'alert-popup' }, { editMode: false })).toBe(0);
    expect(await beginDrag({ role: 'desktop-pin', entityId: 'light.a' }, { editMode: true })).toBe(
      1
    );
  });
});
