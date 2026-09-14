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

function attachEditHandlers(targetWindow, Menu, platform = runtimePlatform, options = {}) {
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
    const menu = Menu.buildFromTemplate(createEditableContextMenuTemplate(params.editFlags));
    const resumeAutoHide = options.suspendAutoHide?.();
    try {
      menu.popup({
        window: targetWindow,
        ...(resumeAutoHide ? { callback: resumeAutoHide } : {}),
      });
    } catch (error) {
      resumeAutoHide?.();
      throw error;
    }
  });
}

module.exports = {
  attachEditHandlers,
  createApplicationMenuTemplate,
  createEditableContextMenuTemplate,
  installApplicationMenu,
  isPasteAcceleratorInput,
};
