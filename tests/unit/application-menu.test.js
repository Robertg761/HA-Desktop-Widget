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

    expect(template).toContainEqual({ role: 'copy', label: 'Copy', enabled: true });
    expect(template).toContainEqual({ role: 'paste', label: 'Paste', enabled: true });
    expect(template).toContainEqual({ role: 'cut', label: 'Cut', enabled: false });
    expect(template).toContainEqual({ role: 'selectAll', label: 'Select All', enabled: true });
  });

  test('labels the editable context menu in the app language when it opens', () => {
    const catalog = {
      Undo: 'Rückgängig',
      Redo: 'Wiederholen',
      Cut: 'Ausschneiden',
      Copy: 'Kopieren',
      Paste: 'Einfügen',
      Delete: 'Löschen',
      'Select All': 'Alles auswählen',
    };
    let language = 'en';
    const translate = jest.fn((key) => (language === 'de' ? catalog[key] || key : key));
    let contextMenuHandler;
    const Menu = { buildFromTemplate: jest.fn(() => ({ popup: jest.fn() })) };
    const targetWindow = {
      webContents: {
        on: (eventName, handler) => {
          if (eventName === 'context-menu') contextMenuHandler = handler;
        },
      },
    };
    attachEditHandlers(targetWindow, Menu, 'linux', { translate });

    const openMenu = () => {
      contextMenuHandler({}, { isEditable: true, editFlags: { canCopy: true } });
      return Menu.buildFromTemplate.mock.lastCall[0]
        .filter((item) => item.role)
        .map((item) => item.label);
    };

    expect(openMenu()).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All']);
    // The menu is rebuilt on every open, so a language change applies without a restart.
    language = 'de';
    expect(openMenu()).toEqual([
      'Rückgängig',
      'Wiederholen',
      'Ausschneiden',
      'Kopieren',
      'Einfügen',
      'Löschen',
      'Alles auswählen',
    ]);
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
  test.each([false, true])(
    'resumes auto-hide after editable menu close or failure: %s',
    (fails) => {
      let handler;
      const resume = jest.fn();
      const suspendAutoHide = jest.fn(() => resume);
      const popup = jest.fn(() => {
        if (fails) throw new Error('menu failed');
      });
      const targetWindow = {
        webContents: {
          on: (event, callback) => {
            if (event === 'context-menu') handler = callback;
          },
        },
      };
      attachEditHandlers(targetWindow, { buildFromTemplate: () => ({ popup }) }, 'linux', {
        suspendAutoHide,
      });
      if (fails) {
        expect(() => handler({}, { isEditable: true })).toThrow('menu failed');
      } else {
        handler({}, { isEditable: true });
        expect(resume).not.toHaveBeenCalled();
        popup.mock.calls[0][0].callback();
      }
      expect(suspendAutoHide).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
    }
  );
});
