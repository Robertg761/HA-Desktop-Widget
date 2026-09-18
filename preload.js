const { contextBridge, ipcRenderer, webFrame } = require('electron');
const { createElectronApi } = require('./src/preload-api.cjs');

// With contextIsolation: true, we must use contextBridge to expose API
// This creates a secure bridge between the main and renderer processes
contextBridge.exposeInMainWorld('electronAPI', {
  ...createElectronApi(ipcRenderer, process.platform),
  setUiScale: (value) => {
    const scale = Number(value);
    webFrame.setZoomFactor([1, 1.15, 1.3, 1.5].includes(scale) ? scale : 1);
  },
});
