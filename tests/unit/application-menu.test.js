const {
  attachEditHandlers,
  createApplicationMenuTemplate,
  createEditableContextMenuTemplate,
  createSelectionContextMenuTemplate,
  createSpellingContextMenuItems,
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
    // No View menu: its zoom, reload, full screen and DevTools accelerators work on the frameless
    // widget although the bar is never drawn, and fight the Text size setting.
    expect(Menu.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'appMenu' },
      { role: 'editMenu' },
      expect.objectContaining({ role: 'windowMenu' }),
    ]);
    expect(Menu.setApplicationMenu).toHaveBeenCalledWith(builtMenu);
  });

  describe("macOS's Window menu", () => {
    const windowMenu = (options) => createApplicationMenuTemplate('darwin', options).at(-1);

    // The system's own Minimize miniaturizes the window, which leaves a tile in the Dock behind a
    // widget that is then hidden.
    test('hides the widget on Cmd+M the way its minimize button does', () => {
      const onMinimize = jest.fn();
      const minimize = windowMenu({ onMinimize }).submenu.find(
        (item) => item.accelerator === 'Command+M'
      );
      expect(minimize.role).toBeUndefined();

      const widget = { id: 1 };
      minimize.click({}, widget);
      expect(onMinimize).toHaveBeenCalledWith(widget);
      expect(windowMenu({ onMinimize }).submenu).not.toContainEqual(
        expect.objectContaining({ role: 'minimize' })
      );
    });

    // The system's own Window menu has no Close, so Cmd+W did nothing.
    test('closes the window on Cmd+W, which hides the widget like the title-bar X', () => {
      expect(windowMenu().submenu).toContainEqual({ role: 'close' });
    });

    test('has nothing that zooms the window, which the widget undoes', () => {
      expect(windowMenu().submenu).not.toContainEqual(expect.objectContaining({ role: 'zoom' }));
    });
  });

  test('keeps the Edit and Window menus on Windows and Linux, and nothing that zooms or reloads', () => {
    // The Window menu carries Ctrl+W, which hides the widget like the title-bar X and Alt+F4.
    expect(createApplicationMenuTemplate('win32')).toEqual([
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]);
    expect(createApplicationMenuTemplate('linux')).toEqual([
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]);
  });

  test('gives development builds the View menu back', () => {
    expect(createApplicationMenuTemplate('linux', { isDev: true })).toEqual([
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]);
    expect(createApplicationMenuTemplate('darwin', { isDev: true })).toEqual([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      expect.objectContaining({ role: 'windowMenu' }),
    ]);
    const Menu = { buildFromTemplate: jest.fn(() => ({})), setApplicationMenu: jest.fn() };
    installApplicationMenu(Menu, 'win32', { isDev: true });
    expect(Menu.buildFromTemplate.mock.calls[0][0]).toContainEqual({ role: 'viewMenu' });
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
  describe('spelling and selected text', () => {
    function openMenu(params, translate) {
      let handler;
      const popup = jest.fn();
      const Menu = { buildFromTemplate: jest.fn(() => ({ popup })) };
      const webContents = {
        on: (eventName, callback) => {
          if (eventName === 'context-menu') handler = callback;
        },
        replaceMisspelling: jest.fn(),
        session: { addWordToSpellCheckerDictionary: jest.fn() },
      };
      attachEditHandlers({ webContents }, Menu, 'linux', { translate });
      const event = { preventDefault: jest.fn() };
      handler(event, params);
      return { Menu, webContents, event };
    }

    test('offers the dictionary suggestions and a way to add a misspelled word', () => {
      const { Menu, webContents } = openMenu(
        {
          isEditable: true,
          misspelledWord: 'recieve',
          dictionarySuggestions: ['receive', 'relieve'],
          editFlags: { canPaste: true },
        },
        (key) => (key === 'Add to dictionary' ? 'Zum Wörterbuch hinzufügen' : key)
      );
      const template = Menu.buildFromTemplate.mock.lastCall[0];

      expect(template.slice(0, 4).map((item) => item.label ?? item.type)).toEqual([
        'receive',
        'relieve',
        'Zum Wörterbuch hinzufügen',
        'separator',
      ]);
      template[1].click();
      expect(webContents.replaceMisspelling).toHaveBeenCalledWith('relieve');
      template[2].click();
      expect(webContents.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('recieve');
      // The edit actions still follow.
      expect(template.map((item) => item.role).filter(Boolean)).toContain('paste');
    });

    test('adds nothing for a field without a misspelled word', () => {
      const { Menu } = openMenu({ isEditable: true });

      expect(Menu.buildFromTemplate.mock.lastCall[0][0]).toMatchObject({ role: 'undo' });
      expect(createSpellingContextMenuItems({}, {})).toEqual([]);
    });

    test('copies selected text outside a field, and shows nothing without a selection', () => {
      const selected = openMenu({
        isEditable: false,
        selectionText: 'light.desk_lamp',
        editFlags: { canCopy: true },
      });
      expect(selected.event.preventDefault).toHaveBeenCalled();
      expect(selected.Menu.buildFromTemplate.mock.lastCall[0]).toEqual([
        { role: 'copy', label: 'Copy', enabled: true },
      ]);

      const plain = openMenu({ isEditable: false, selectionText: '   ' });
      expect(plain.Menu.buildFromTemplate).not.toHaveBeenCalled();
      expect(createSelectionContextMenuTemplate({ canCopy: false })[0].enabled).toBe(false);
    });
  });
});
