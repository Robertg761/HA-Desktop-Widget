const { contextBridge, ipcRenderer } = require('electron');
const { createElectronApi } = require('./src/preload-api.cjs');

// With contextIsolation: true, we must use contextBridge to expose API
// This creates a secure bridge between the main and renderer processes
contextBridge.exposeInMainWorld('electronAPI', createElectronApi(ipcRenderer, process.platform));
