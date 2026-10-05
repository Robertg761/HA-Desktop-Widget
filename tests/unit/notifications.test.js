/**
 * @jest-environment jsdom
 */

jest.mock('../../src/websocket.js', () => ({
  __esModule: true,
  default: {
    subscribeMessage: jest.fn(),
    callService: jest.fn(),
  },
}));

jest.mock('../../src/i18n.js', () => ({
  __esModule: true,
  t: jest.fn((key, vars = {}) =>
    key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name) => String(vars[name] ?? ''))
  ),
  formatNumber: require('../../packages/widget-renderer/src/i18n.js').formatNumber,
}));

jest.mock('../../src/ui-utils.js', () => ({
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
  showToast: jest.fn(),
  showConfirm: jest.fn(),
}));

const {
  applyPersistentNotificationEvent,
  formatRelativeTime,
  initializePersistentNotifications,
} = require('../../src/notifications.js');

describe('persistent notification helpers', () => {
  test('merges current, added, updated, and removed notification events', () => {
    const current = applyPersistentNotificationEvent(new Map(), {
      type: 'current',
      notifications: {
        existing: {
          notification_id: 'existing',
          title: '<b>Existing</b>',
          message: 'Current message',
          created_at: '2026-07-06T10:00:00Z',
        },
      },
    });

    expect(current.added).toEqual([]);
    expect([...current.notifications.keys()]).toEqual(['existing']);
    expect(current.notifications.get('existing').title).toBe('<b>Existing</b>');

    const added = applyPersistentNotificationEvent(current.notifications, {
      type: 'added',
      notifications: {
        fresh: {
          notification_id: 'fresh',
          title: 'Fresh',
          message: '<script>alert(1)</script>',
          created_at: '2026-07-06T10:05:00Z',
        },
      },
    });

    expect(added.added.map((notification) => notification.notification_id)).toEqual(['fresh']);
    expect(added.notifications.get('fresh').message).toBe('<script>alert(1)</script>');

    const updated = applyPersistentNotificationEvent(added.notifications, {
      type: 'updated',
      notifications: {
        fresh: {
          notification_id: 'fresh',
          title: 'Fresh',
          message: 'Updated message',
          created_at: '2026-07-06T10:05:00Z',
        },
      },
    });

    expect(updated.added).toEqual([]);
    expect(updated.notifications.get('fresh').message).toBe('Updated message');

    const removed = applyPersistentNotificationEvent(updated.notifications, {
      type: 'removed',
      notifications: {
        existing: {
          notification_id: 'existing',
        },
      },
    });

    expect([...removed.notifications.keys()]).toEqual(['fresh']);
  });

  test('formats relative notification times', () => {
    const now = Date.parse('2026-07-06T12:00:00Z');

    expect(formatRelativeTime('2026-07-06T12:00:00Z', now)).toBe('just now');
    // The language's own relative time, whatever wording this Node's Intl data has for it.
    const ago = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
    expect(formatRelativeTime('2026-07-06T11:45:00Z', now)).toBe(ago.format(-15, 'minute'));
    expect(formatRelativeTime('2026-07-06T09:00:00Z', now)).toBe(ago.format(-3, 'hour'));
    expect(formatRelativeTime('2026-07-04T12:00:00Z', now)).toBe(ago.format(-2, 'day'));
    expect(formatRelativeTime('', now)).toBe('');
    // A notification stamped ahead of this computer's clock is just now.
    expect(formatRelativeTime('2026-07-06T12:10:00Z', now)).toBe('just now');
  });

  describe('notifications panel', () => {
    const panelHtml = `
      <button id="persistent-notifications-btn"></button>
      <span id="persistent-notifications-count"></span>
      <button id="settings-btn"></button>
      <div id="persistent-notifications-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-header">
            <h2 id="persistent-notifications-title">Notifications</h2>
            <button id="close-persistent-notifications" class="close-btn">Close</button>
          </div>
          <div class="modal-body">
            <div id="persistent-notifications-list"></div>
            <div id="persistent-notifications-empty"></div>
          </div>
          <div id="persistent-notifications-toolbar" class="hidden">
            <span id="persistent-notifications-summary"></span>
            <button id="dismiss-all-notifications">Dismiss all</button>
          </div>
        </div>
      </div>
    `;
    const notification = (id, createdAt = '2026-07-06T10:00:00Z') => ({
      notification_id: id,
      title: `Title ${id}`,
      message: `Message ${id}`,
      created_at: createdAt,
    });
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    let send;
    let websocket;
    let showToast;

    // A fresh module per test: the panel wires itself to its elements once, and each test builds new ones.
    beforeEach(() => {
      jest.resetModules();
      document.body.innerHTML = panelHtml;
      websocket = require('../../src/websocket.js').default;
      showToast = require('../../src/ui-utils.js').showToast;
      require('../../src/notifications.js').initializePersistentNotifications();
      send = websocket.subscribeMessage.mock.calls.at(-1)[1];
    });

    const load = (...ids) =>
      send({
        type: 'current',
        notifications: Object.fromEntries(ids.map((id) => [id, notification(id)])),
      });
    const press = (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    test('opens as a named dialog with focus on the first notification, not on Close', async () => {
      load('a', 'b');
      const bell = document.getElementById('persistent-notifications-btn');
      bell.focus();
      bell.click();
      await nextTick();

      const modal = document.getElementById('persistent-notifications-modal');
      expect(modal.getAttribute('role')).toBe('dialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById(modal.getAttribute('aria-labelledby')).textContent).toBe(
        'Notifications'
      );
      expect(document.activeElement.textContent).toBe('Dismiss');
    });

    test('Escape closes only the panel and hands focus back to the bell', async () => {
      load('a');
      const bell = document.getElementById('persistent-notifications-btn');
      bell.focus();
      bell.click();
      await nextTick();
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);

      const escape = press(document.activeElement, 'Escape');
      await nextTick();

      expect(escape.defaultPrevented).toBe(true);
      expect(pageEscape).not.toHaveBeenCalled();
      expect(document.getElementById('persistent-notifications-modal').classList).toContain(
        'hidden'
      );
      expect(document.activeElement).toBe(bell);
      document.removeEventListener('keydown', pageEscape);
    });

    test('a click on the backdrop closes the panel, a click inside it does not', async () => {
      load('a');
      document.getElementById('persistent-notifications-btn').click();
      const modal = document.getElementById('persistent-notifications-modal');

      modal.querySelector('.modal-body').click();
      expect(modal.classList).not.toContain('hidden');
      modal.click();
      expect(modal.classList).toContain('hidden');
    });

    test('dismissing a notification moves focus to the next one instead of the page behind', async () => {
      load('a', 'b', 'c');
      document.getElementById('persistent-notifications-btn').click();
      await nextTick();
      const buttons = () => [...document.querySelectorAll('.persistent-notification-dismiss')];
      buttons()[0].focus();
      websocket.callService.mockResolvedValue({});

      buttons()[0].click();
      // Home Assistant answers with the removal, which rebuilds the list.
      send({ type: 'removed', notifications: { c: {} } });

      expect(buttons()).toHaveLength(2);
      expect(document.activeElement).toBe(buttons()[0]);
      expect(
        document.getElementById('persistent-notifications-modal').contains(document.activeElement)
      ).toBe(true);
    });

    test('keeps focus on the same notification when the list is rebuilt around it', async () => {
      load('a', 'b');
      document.getElementById('persistent-notifications-btn').click();
      await nextTick();
      const second = document.querySelectorAll('.persistent-notification-dismiss')[1];
      second.focus();
      const key = second.dataset.focusKey;

      send({ type: 'updated', notifications: { a: notification('a') } });

      expect(document.activeElement.dataset.focusKey).toBe(key);
      expect(document.activeElement).not.toBe(second);
    });

    test('says so when a dismissal fails, and gives the button back', async () => {
      load('a');
      document.getElementById('persistent-notifications-btn').click();
      websocket.callService.mockRejectedValue(new Error('offline'));
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const dismiss = document.querySelector('.persistent-notification-dismiss');

      dismiss.click();
      expect(dismiss.disabled).toBe(true);
      await nextTick();

      expect(dismiss.disabled).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Could not dismiss notification', 'error');
      consoleError.mockRestore();
    });

    test('names each Dismiss button for its notification', () => {
      load('a', 'b');
      send({ type: 'added', notifications: { c: { ...notification('c'), title: '' } } });

      const names = [...document.querySelectorAll('.persistent-notification-dismiss')].map(
        (button) => button.getAttribute('aria-label')
      );

      expect(names.sort()).toEqual([
        'Dismiss Home Assistant',
        'Dismiss Title a',
        'Dismiss Title b',
      ]);
      // The visible text stays the short word, and starts the name (label in name).
      for (const button of document.querySelectorAll('.persistent-notification-dismiss')) {
        expect(button.getAttribute('aria-label').startsWith(button.textContent)).toBe(true);
      }
    });

    test('gives the age the exact time as a tooltip', () => {
      load('a');

      const time = document.querySelector('.persistent-notification-time');

      expect(time.title).toMatch(/2026/);
      expect(time.title.length).toBeGreaterThan(8);
    });

    test('writes that time in the format of the app, not of the page', () => {
      const i18n = require('../../packages/widget-renderer/src/i18n.js');
      i18n.setLocaleBootstrap({
        languageSetting: 'de',
        requestedLocale: 'de',
        activeLocale: 'de',
        messages: {},
      });
      // The page's own language can differ from the pack in use; the tooltip follows the pack.
      document.documentElement.lang = 'en';
      try {
        load('a');
        expect(document.querySelector('.persistent-notification-time').title).toMatch(
          /^\d{2}\.\d{2}\.2026/
        );
      } finally {
        i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
        document.documentElement.lang = '';
      }
    });

    describe('with a long list', () => {
      const toolbar = () => document.getElementById('persistent-notifications-toolbar');
      const summary = () => document.getElementById('persistent-notifications-summary');
      const dismissAll = () => document.getElementById('dismiss-all-notifications');
      let confirm;

      beforeEach(() => {
        confirm = require('../../src/ui-utils.js').showConfirm;
        confirm.mockReset();
        websocket.callService.mockReset();
      });

      test('shows how many there are and a Dismiss all, for two or more', () => {
        load('a');
        expect(toolbar().classList).toContain('hidden');

        send({ type: 'added', notifications: { b: notification('b') } });
        expect(toolbar().classList).not.toContain('hidden');
        expect(summary().textContent).toBe('2 notifications');

        send({ type: 'removed', notifications: { b: {} } });
        expect(toolbar().classList).toContain('hidden');
      });

      test('writes the counts in the digits of the language', async () => {
        const i18n = require('../../packages/widget-renderer/src/i18n.js');
        // An Arabic interface on a computer set to Egypt writes Arabic-Indic digits; a raw count
        // put Latin ones beside them.
        i18n.setLocaleBootstrap({
          systemLocale: 'ar-EG',
          detectedLocale: 'ar',
          activeLocale: 'ar',
          messages: {},
        });
        try {
          load('a', 'b', 'c');
          confirm.mockResolvedValue(false);
          expect(summary().textContent).toBe('٣ notifications');
          expect(document.getElementById('persistent-notifications-count').textContent).toBe('٣');
          dismissAll().click();
          await nextTick();
          expect(confirm.mock.calls[0][1]).toBe(
            'This clears ٣ notifications in Home Assistant, on every device.'
          );
        } finally {
          i18n.setLocaleBootstrap({
            systemLocale: '',
            detectedLocale: 'en',
            activeLocale: 'en',
            messages: {},
          });
        }
      });

      test('asks before clearing everything, and does nothing when declined', async () => {
        load('a', 'b', 'c');
        confirm.mockResolvedValue(false);

        dismissAll().click();
        await nextTick();

        expect(confirm).toHaveBeenCalledWith(
          'Dismiss all notifications?',
          'This clears 3 notifications in Home Assistant, on every device.',
          expect.objectContaining({ confirmText: 'Dismiss all' })
        );
        expect(websocket.callService).not.toHaveBeenCalled();
      });

      test('clears them with one service call once confirmed', async () => {
        load('a', 'b', 'c');
        confirm.mockResolvedValue(true);
        websocket.callService.mockResolvedValue({});

        dismissAll().click();
        await nextTick();

        expect(websocket.callService).toHaveBeenCalledTimes(1);
        expect(websocket.callService).toHaveBeenCalledWith(
          'persistent_notification',
          'dismiss_all',
          {}
        );
        expect(dismissAll().disabled).toBe(false);
      });

      test('dismisses them one by one when Home Assistant has no dismiss_all', async () => {
        load('a', 'b');
        confirm.mockResolvedValue(true);
        websocket.callService.mockImplementation(async (domain, service) => {
          if (service === 'dismiss_all') throw new Error('Service not found');
          return {};
        });

        dismissAll().click();
        await nextTick();

        const dismissals = websocket.callService.mock.calls.filter(
          ([, service]) => service === 'dismiss'
        );
        expect(dismissals.map(([, , data]) => data.notification_id).sort()).toEqual(['a', 'b']);
        expect(showToast).not.toHaveBeenCalled();
      });

      test('says so when nothing could be dismissed', async () => {
        load('a', 'b');
        confirm.mockResolvedValue(true);
        websocket.callService.mockRejectedValue(new Error('offline'));
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        dismissAll().click();
        await nextTick();

        expect(showToast).toHaveBeenCalledWith('Could not dismiss notifications', 'error');
        expect(dismissAll().disabled).toBe(false);
        consoleError.mockRestore();
      });
    });

    test('refreshes the ages while the panel stays open', () => {
      jest.useFakeTimers();
      jest.setSystemTime(Date.parse('2026-07-06T10:00:30Z'));
      try {
        load('a');
        document.getElementById('persistent-notifications-btn').click();
        const time = () => document.querySelector('.persistent-notification-time').textContent;
        expect(time()).toBe('just now');

        jest.setSystemTime(Date.parse('2026-07-06T10:04:30Z'));
        jest.advanceTimersByTime(60000);
        const fiveMinutes = new Intl.RelativeTimeFormat('en', {
          numeric: 'auto',
          style: 'short',
        }).format(-5, 'minute');
        expect(time()).toBe(fiveMinutes);

        document.getElementById('close-persistent-notifications').click();
        jest.setSystemTime(Date.parse('2026-07-06T10:20:30Z'));
        jest.advanceTimersByTime(120000);
        expect(time()).toBe(fiveMinutes);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  test('clicking a desktop notification opens the widget on its notification list', async () => {
    document.body.innerHTML = `
      <button id="persistent-notifications-btn"></button>
      <span id="persistent-notifications-count"></span>
      <div id="persistent-notifications-modal" class="modal hidden">
        <div id="persistent-notifications-list"></div>
        <div id="persistent-notifications-empty"></div>
      </div>
    `;
    const created = [];
    global.Notification = class {
      constructor(title, options) {
        this.title = title;
        this.options = options;
        created.push(this);
      }
    };
    global.Notification.permission = 'granted';
    window.electronAPI = { showWindow: jest.fn(() => Promise.resolve()) };
    const websocket = require('../../src/websocket.js').default;

    initializePersistentNotifications();
    const handler = websocket.subscribeMessage.mock.calls.at(-1)[1];
    handler({
      type: 'added',
      notifications: {
        garage: {
          notification_id: 'garage',
          title: 'Garage',
          message: 'Door open',
          created_at: '2026-07-06T10:00:00Z',
        },
      },
    });

    expect(created).toHaveLength(1);
    created[0].onclick();
    expect(window.electronAPI.showWindow).toHaveBeenCalledTimes(1);
    const modal = document.getElementById('persistent-notifications-modal');
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  describe('desktop notifications for Home Assistant notifications', () => {
    // A fresh module for each: it keeps the notifications it has been told about.
    beforeEach(() => jest.resetModules());
    const arrive = () => {
      const {
        initializePersistentNotifications: initialize,
      } = require('../../src/notifications.js');
      document.body.innerHTML = `
        <button id="persistent-notifications-btn"></button>
        <span id="persistent-notifications-count"></span>
        <div id="persistent-notifications-modal" class="modal hidden">
          <div id="persistent-notifications-list"></div>
          <div id="persistent-notifications-empty"></div>
        </div>`;
      const created = [];
      global.Notification = class {
        constructor(title) {
          created.push(title);
        }
      };
      global.Notification.permission = 'granted';
      window.electronAPI = { showWindow: jest.fn(() => Promise.resolve()) };
      const websocket = require('../../src/websocket.js').default;
      initialize();
      const handler = websocket.subscribeMessage.mock.calls.at(-1)[1];
      handler({
        type: 'added',
        notifications: {
          update: {
            notification_id: 'update',
            title: 'Update ready',
            message: 'Core 2026.10',
            created_at: '2026-07-06T10:00:00Z',
          },
        },
      });
      return created;
    };
    const setConfig = (entityAlerts) => {
      require('../../src/state.js').default.setConfig({ entityAlerts });
    };
    afterEach(() => require('../../src/state.js').default.setConfig({}));

    it('show unless the switch for them is off', () => {
      setConfig({ enabled: false, alerts: {} });
      expect(arrive()).toEqual(['Update ready']);
    });

    it('stay out of the desktop when the switch is off, whether or not entity alerts are on', () => {
      setConfig({ enabled: true, persistentNotifications: false, alerts: {} });
      expect(arrive()).toEqual([]);
      setConfig({ enabled: false, persistentNotifications: false, alerts: {} });
      expect(arrive()).toEqual([]);
    });

    it('still reach the bell and its list when the desktop does not get them', () => {
      setConfig({ enabled: true, persistentNotifications: false, alerts: {} });
      arrive();

      expect(document.getElementById('persistent-notifications-count').textContent).toBe('1');
      expect(document.getElementById('persistent-notifications-btn').classList).not.toContain(
        'hidden'
      );
    });
  });

  it('describes the bell by its count, which its fixed label would otherwise hide', () => {
    // An aria-label replaces the button's content as its name, so a screen reader never reached the
    // number. The count is the button's description instead, which costs no translated string.
    const html = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../index.html'),
      'utf8'
    );
    document.body.innerHTML = html.slice(
      html.indexOf('<button'),
      html.indexOf('id="settings-btn"')
    );
    const button = document.getElementById('persistent-notifications-btn');
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBe('persistent-notifications-count');
    expect(button.contains(document.getElementById(describedBy))).toBe(true);
    expect(button.getAttribute('aria-label')).toBe('Home Assistant notifications');
  });

  it('calls the bell, its panel and the Settings switch by one name', () => {
    // The bell said "Home Assistant Notifications", the panel "Persistent Notifications" and the
    // switch "Home Assistant notifications": three names for one thing.
    const html = require('fs').readFileSync(
      require('path').resolve(__dirname, '../../index.html'),
      'utf8'
    );
    document.body.innerHTML = html.slice(html.indexOf('<body'), html.lastIndexOf('</body>'));
    const name = 'Home Assistant notifications';
    const button = document.getElementById('persistent-notifications-btn');
    expect(button.dataset.i18nAriaLabel).toBe(name);
    expect(button.dataset.i18nTitle).toBe(name);
    expect(document.getElementById('persistent-notifications-title').dataset.i18n).toBe(name);
    expect(document.querySelector('label[for="persistent-notification-toasts"]').dataset.i18n).toBe(
      name
    );
  });
});
