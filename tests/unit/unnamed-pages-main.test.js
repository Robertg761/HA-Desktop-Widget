/**
 * @jest-environment node
 *
 * The real update-config handler from main.js, driven the way the renderer drives it: the page
 * nobody named arrives with the name of the interface's language, and is kept without one.
 */

const { createProfileSyncHarness } = require('../helpers/profile-sync-devices.js');

const harness = createProfileSyncHarness();
const { createDevice } = harness;

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

describe('update-config and pages nobody named', () => {
  test('keeps an unnamed page without the name the renderer showed it with, and drops the marker', async () => {
    const device = createDevice('desktop', { syncing: false });

    await device.saveSettings({
      edit: (config) => {
        config.customTabs = [
          { id: 'default', name: 'Alle', nameIsDefault: true, entityIds: ['light.a'] },
          { id: 'kitchen', name: 'Küche', entityIds: ['light.b'] },
          { id: 'view-3', name: 'Ansicht 3', nameIsDefault: true, entityIds: [] },
        ];
      },
    });

    expect(device.config.customTabs).toEqual([
      { id: 'default', name: '', entityIds: ['light.a'] },
      { id: 'kitchen', name: 'Küche', entityIds: ['light.b'] },
      { id: 'view-3', name: '', entityIds: [] },
    ]);
  });

  test('keeps a name somebody typed, whatever it says', async () => {
    const device = createDevice('desktop', { syncing: false });

    await device.saveSettings({
      edit: (config) => {
        config.customTabs = [{ id: 'default', name: 'Alle', entityIds: [] }];
      },
    });

    expect(device.config.customTabs).toEqual([{ id: 'default', name: 'Alle', entityIds: [] }]);
  });
});
