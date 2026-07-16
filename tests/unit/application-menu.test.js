const {
  attachEditHandlers,
  createApplicationMenuTemplate,
  createEditableContextMenuTemplate,
  installApplicationMenu,
  isPasteAcceleratorInput,
} = require('../../src/application-menu.cjs');

describe('application edit menus', () => {
  test('installs the standard macOS app and edit menus', () => {
    const builtMenu = { id: 'application-menu' };
    const Menu = {
      buildFromTemplate: jest.fn(() => builtMenu),
      setApplicationMenu: jest.fn(),
    };

    expect(installApplicationMenu(Menu, 'darwin')).toBe(builtMenu);
    expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]);
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(builtMenu);
  });

  test('keeps the Edit menu available on Windows and Linux', () => {
    expect(createApplicationMenuTemplate('win32')).toContainEqual({ role: 'editMenu' });
    expect(createApplicationMenuTemplate('linux')).toContainEqual({ role: 'editMenu' });
  });

  test('builds editable-field actions from Chromium edit flags', () => {
    const template = createEditableContextMenuTemplate({
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
    });

    expect(template).toContainEqual({ role: 'copy', enabled: true });
    expect(template).toContainEqual({ role: 'paste', enabled: true });
    expect(template).toContainEqual({ role: 'cut', enabled: false });
    expect(template).toContainEqual({ role: 'selectAll', enabled: true });
  });

  test('recognizes only the platform paste accelerator', () => {
    expect(isPasteAcceleratorInput({ type: 'keyDown', key: 'v', meta: true }, 'darwin')).toBe(true);
    expect(isPasteAcceleratorInput({ type: 'keyDown', key: 'V', control: true }, 'win32')).toBe(
      true
    );
    expect(
      isPasteAcceleratorInput({ type: 'keyDown', key: 'v', meta: true, shift: true }, 'darwin')
    ).toBe(false);
    expect(isPasteAcceleratorInput({ type: 'keyUp', key: 'v', meta: true }, 'darwin')).toBe(false);
  });

  test('shows the editable context menu only for editable fields', () => {
    let contextMenuHandler;
    const popup = jest.fn();
    const Menu = {
      buildFromTemplate: jest.fn(() => ({ popup })),
    };
    const targetWindow = {
      webContents: {
        paste: jest.fn(),
        on: jest.fn((eventName, handler) => {
          if (eventName === 'before-input-event') pasteHandler = handler;
          if (eventName === 'context-menu') contextMenuHandler = handler;
        }),
      },
    };

    let pasteHandler;
    attachEditHandlers(targetWindow, Menu, 'darwin');
    const pasteEvent = { preventDefault: jest.fn() };
    pasteHandler(pasteEvent, { type: 'keyDown', key: 'v', meta: true });
    expect(pasteEvent.preventDefault).toHaveBeenCalled();
    expect(targetWindow.webContents.paste).toHaveBeenCalled();

    contextMenuHandler({}, { isEditable: false });
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();

    contextMenuHandler(
      { preventDefault: jest.fn() },
      { isEditable: true, editFlags: { canPaste: true } }
    );
    expect(Menu.buildFromTemplate).toHaveBeenCalled();
    expect(popup).toHaveBeenCalledWith({ window: targetWindow });
  });
});
