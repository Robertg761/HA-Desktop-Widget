jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: jest.fn() },
  ipcRenderer: {},
  webFrame: { setZoomFactor: jest.fn() },
}));
jest.mock('../../src/preload-api.cjs', () => ({
  createElectronApi: () => ({ existingCapability: true }),
}));

const { contextBridge, webFrame } = require('electron');
require('../../preload.js');
const api = contextBridge.exposeInMainWorld.mock.calls[0][1];

test('preload scales the native renderer without dropping existing capabilities', () => {
  expect(api.existingCapability).toBe(true);
  for (const value of [1, 1.15, 1.3, 1.5]) {
    api.setUiScale(value);
    expect(webFrame.setZoomFactor).toHaveBeenLastCalledWith(value);
  }
  for (const value of [0, -1, Infinity, 'invalid', 100]) {
    api.setUiScale(value);
    expect(webFrame.setZoomFactor).toHaveBeenLastCalledWith(1);
  }
});
