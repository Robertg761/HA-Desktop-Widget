const { platform: runtimePlatform } = require('node:process');

// The menu bar is never drawn on the frameless widget, but its accelerators work: Ctrl+0 and Ctrl+/-
// zoom the page (undoing the Text size setting), Ctrl+R reloads it, F11 takes it full screen and
// Ctrl+Shift+I opens the DevTools, with no way in the interface to understand or undo any of them.
// So a packaged build keeps the Edit menu (copy and paste have to work), the Window menu (its
// Ctrl+W and Cmd+W close the window, which hides the widget like the title-bar X and Alt+F4) and,
// on macOS, the app menu the system expects; the View menu is for development builds.
function createApplicationMenuTemplate(
  platform = runtimePlatform,
  { isDev = false, onMinimize = null } = {}
) {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    ...(isDev ? [{ role: 'viewMenu' }] : []),
    platform === 'darwin' ? createMacWindowMenu(onMinimize) : { role: 'windowMenu' },
  ];
}

// macOS's own Window menu has neither of the two keys that matter here. Its Minimize (Cmd+M)
// miniaturizes the window, which a 'minimize' listener cannot cancel on macOS, so the widget went
// to the Dock and was then hidden, which can leave a tile there; and it has no Close, so Cmd+W did
// nothing at all. Here Cmd+M hides the widget the way the title bar's minimize button does, and
// Cmd+W closes the window, which hides it like the title-bar X. LSUIElement keeps the menu bar
// itself out of sight, so only the keys are ever used.
function createMacWindowMenu(onMinimize) {
  return {
    role: 'windowMenu',
    submenu: [
      {
        label: 'Minimize',
        accelerator: 'Command+M',
        click: (_menuItem, browserWindow) => onMinimize?.(browserWindow),
      },
      { role: 'close' },
      { type: 'separator' },
      { role: 'front' },
    ],
  };
}

// Electron fills role labels with fixed English text, so the visible labels are set here.
// The menu is built each time it opens, so a language change applies to the next one. It has no
// spelling items: spell-check is off on purpose (see src/spell-checker.cjs).
function createEditableContextMenuTemplate(editFlags = {}, t = (text) => text) {
  return [
    { role: 'undo', label: t('Undo'), enabled: !!editFlags.canUndo },
    { role: 'redo', label: t('Redo'), enabled: !!editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', label: t('Cut'), enabled: !!editFlags.canCut },
    { role: 'copy', label: t('Copy'), enabled: !!editFlags.canCopy },
    { role: 'paste', label: t('Paste'), enabled: !!editFlags.canPaste },
    { role: 'delete', label: t('Delete'), enabled: !!editFlags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', label: t('Select All'), enabled: !!editFlags.canSelectAll },
  ];
}

// Selected text that is not in a field (an error message, an entity id, the version) can still be
// copied.
function createSelectionContextMenuTemplate(editFlags = {}, t = (text) => text) {
  return [{ role: 'copy', label: t('Copy'), enabled: editFlags.canCopy !== false }];
}

function isPasteAcceleratorInput(input = {}, platform = runtimePlatform) {
  if (input.type !== 'keyDown' || String(input.key || '').toLowerCase() !== 'v') return false;
  if (input.alt || input.shift) return false;
  return platform === 'darwin' ? !!input.meta && !input.control : !!input.control && !input.meta;
}

function installApplicationMenu(Menu, platform = runtimePlatform, options = {}) {
  const menu = Menu.buildFromTemplate(createApplicationMenuTemplate(platform, options));
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
    const hasSelection = !!String(params.selectionText || '').trim();
    if (!params.isEditable && !hasSelection) return;
    event?.preventDefault?.();
    const template = params.isEditable
      ? createEditableContextMenuTemplate(params.editFlags, options.translate)
      : createSelectionContextMenuTemplate(params.editFlags, options.translate);
    const menu = Menu.buildFromTemplate(template);
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
  createSelectionContextMenuTemplate,
  installApplicationMenu,
  isPasteAcceleratorInput,
};
