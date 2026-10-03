const { platform: runtimePlatform } = require('node:process');

// The menu bar is never drawn on the frameless widget, but its accelerators work: Ctrl+0 and Ctrl+/-
// zoom the page (undoing the Text size setting), Ctrl+R reloads it, F11 takes it full screen and
// Ctrl+Shift+I opens the DevTools, with no way in the interface to understand or undo any of them.
// So a packaged build keeps the Edit menu (copy and paste have to work), the Window menu (its
// Ctrl+W and Cmd+W close the window, which hides the widget like the title-bar X and Alt+F4) and,
// on macOS, the app menu the system expects; the View menu is for development builds.
function createApplicationMenuTemplate(platform = runtimePlatform, { isDev = false } = {}) {
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    ...(isDev ? [{ role: 'viewMenu' }] : []),
    { role: 'windowMenu' },
  ];
}

// Electron fills role labels with fixed English text, so the visible labels are set here.
// The menu is built each time it opens, so a language change applies to the next one.
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

// What a right-click on a misspelled word adds above the edit actions: the dictionary's
// suggestions, then a way to teach it the word. Fields that hold addresses, ids and paths turn
// spell checking off, so this shows up where prose is written.
function createSpellingContextMenuItems(params = {}, webContents, t = (text) => text) {
  const word = params.misspelledWord;
  if (!word) return [];
  const suggestions = (params.dictionarySuggestions || []).map((suggestion) => ({
    label: suggestion,
    click: () => webContents.replaceMisspelling(suggestion),
  }));
  return [
    ...suggestions,
    {
      label: t('Add to dictionary'),
      click: () => webContents.session?.addWordToSpellCheckerDictionary?.(word),
    },
    { type: 'separator' },
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
      ? [
          ...createSpellingContextMenuItems(params, webContents, options.translate),
          ...createEditableContextMenuTemplate(params.editFlags, options.translate),
        ]
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
  createSpellingContextMenuItems,
  installApplicationMenu,
  isPasteAcceleratorInput,
};
