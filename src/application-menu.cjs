const { platform: runtimePlatform } = require('node:process');

function createApplicationMenuTemplate(platform = runtimePlatform) {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

function createEditableContextMenuTemplate(editFlags = {}) {
  return [
    { role: 'undo', enabled: !!editFlags.canUndo },
    { role: 'redo', enabled: !!editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: !!editFlags.canCut },
    { role: 'copy', enabled: !!editFlags.canCopy },
    { role: 'paste', enabled: !!editFlags.canPaste },
    { role: 'delete', enabled: !!editFlags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', enabled: !!editFlags.canSelectAll },
  ];
}

function isPasteAcceleratorInput(input = {}, platform = runtimePlatform) {
  if (input.type !== 'keyDown' || String(input.key || '').toLowerCase() !== 'v') return false;
  if (input.alt || input.shift) return false;
  return platform === 'darwin' ? !!input.meta && !input.control : !!input.control && !input.meta;
}

function installApplicationMenu(Menu, platform = runtimePlatform) {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate(platform));
  Menu.setApplicationMenu(menu);
  return menu;
}

function attachEditHandlers(targetWindow, Menu, platform = runtimePlatform) {
  const webContents = targetWindow?.webContents;
  if (!webContents) return;

  webContents.on('before-input-event', (event, input) => {
    if (!isPasteAcceleratorInput(input, platform)) return;
    event?.preventDefault?.();
    webContents.paste();
  });

  webContents.on('context-menu', (event, params = {}) => {
    if (!params.isEditable) return;
    event?.preventDefault?.();
    Menu.buildFromTemplate(createEditableContextMenuTemplate(params.editFlags)).popup({
      window: targetWindow,
    });
  });
}

module.exports = {
  attachEditHandlers,
  createApplicationMenuTemplate,
  createEditableContextMenuTemplate,
  installApplicationMenu,
  isPasteAcceleratorInput,
};
