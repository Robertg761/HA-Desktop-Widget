/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../renderer.js'), 'utf8');

function loadHandler({ states = {} } = {}) {
  const start = source.indexOf('window.electronAPI.onOmarchyBarEntityAction?.(');
  const end = source.indexOf('\n});\n', start) + 5;
  expect(start).toBeGreaterThan(-1);
  const ui = {
    executeQuickAccessControl: jest.fn(),
    openEntityControls: jest.fn(),
    executeEntityPrimaryAction: jest.fn(),
    openUnavailableEntityRepair: jest.fn(),
  };
  let handler = null;
  vm.runInNewContext(source.slice(start, end), {
    window: { electronAPI: { onOmarchyBarEntityAction: (fn) => (handler = fn) } },
    utils: { resolveEntityId: (id, all) => (all[id] ? id : null) },
    state: { STATES: states },
    ui,
  });
  return { handler, ui };
}

describe('a request from the Omarchy bar', () => {
  const light = { entity_id: 'light.desk', state: 'on', attributes: {} };

  it('does what the widget tile does for an entity that exists', () => {
    const { handler, ui } = loadHandler({ states: { 'light.desk': light } });

    handler({ entityId: 'light.desk', kind: 'primary' });
    expect(ui.executeEntityPrimaryAction).toHaveBeenCalledWith(light, { source: 'omarchy-bar' });
    handler({ entityId: 'light.desk', kind: 'controls' });
    expect(ui.openEntityControls).toHaveBeenCalledWith(light);
    handler({ entityId: 'light.desk', kind: 'set', command: 'brightness', value: 40 });
    expect(ui.executeQuickAccessControl).toHaveBeenCalledWith(light, 'brightness', 40);
    expect(ui.openUnavailableEntityRepair).not.toHaveBeenCalled();
  });

  // The widget came forward for the click (the tile reads as a dialog), so something has to open.
  it('offers to repair a tile whose entity has been removed from Home Assistant', () => {
    const { handler, ui } = loadHandler();

    handler({ entityId: 'light.gone', kind: 'primary' });

    expect(ui.openUnavailableEntityRepair).toHaveBeenCalledWith('light.gone');
    expect(ui.executeEntityPrimaryAction).not.toHaveBeenCalled();
  });

  it('does not open a dialog for a control change on an entity that is not there', () => {
    const { handler, ui } = loadHandler();
    handler({ entityId: 'light.gone', kind: 'set', command: 'brightness', value: 40 });
    handler({ entityId: 'light.gone', kind: 'controls' });
    expect(ui.openUnavailableEntityRepair).not.toHaveBeenCalled();
    expect(ui.executeQuickAccessControl).not.toHaveBeenCalled();
  });

  it('ignores a request with no payload', () => {
    const { handler, ui } = loadHandler();
    expect(() => handler()).not.toThrow();
    expect(ui.openUnavailableEntityRepair).toHaveBeenCalledTimes(0);
  });
});
