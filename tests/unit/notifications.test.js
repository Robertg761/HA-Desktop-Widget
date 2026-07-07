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
  t: jest.fn((key) => key),
}));

const {
  applyPersistentNotificationEvent,
  formatRelativeTime,
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
    expect(formatRelativeTime('2026-07-06T11:45:00Z', now)).toBe('15m ago');
    expect(formatRelativeTime('2026-07-06T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-07-04T12:00:00Z', now)).toBe('2d ago');
    expect(formatRelativeTime('', now)).toBe('');
  });
});
