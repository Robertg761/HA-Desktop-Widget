/**
 * @jest-environment jsdom
 */

const {
  notificationMarkdownToPlainText,
  renderNotificationMarkdown,
  resolveNotificationLink,
  tokenizeInline,
} = require('../../src/notification-markdown.js');

const render = (message, options = {}) => {
  const container = document.createElement('div');
  renderNotificationMarkdown(container, message, options);
  return container;
};

describe('notification Markdown', () => {
  describe('what it draws', () => {
    it('draws bold, italic, strikethrough and code', () => {
      const html = render('**bold** and *italic* and ~~gone~~ and `code`').innerHTML;
      expect(html).toBe(
        '<p><strong>bold</strong> and <em>italic</em> and <s>gone</s> and <code>code</code></p>'
      );
    });

    it('keeps the line breaks of a paragraph and splits paragraphs on a blank line', () => {
      const container = render('one\ntwo\n\nthree');
      expect([...container.children].map((node) => node.innerHTML)).toEqual([
        'one<br>two',
        'three',
      ]);
    });

    it('draws bulleted and numbered lists', () => {
      const container = render('Intro\n\n- a\n- b\n\n1. first\n2) second');
      expect(container.querySelector('ul').children).toHaveLength(2);
      expect(container.querySelector('ol').children).toHaveLength(2);
      expect(container.querySelector('ol li').textContent).toBe('first');
    });

    it('draws headings as plain emphasised lines, quotes and fenced code', () => {
      const container = render('## Heading\n\n> quoted\n\n```\nlet x = 1;\n```');
      expect(container.querySelector('.persistent-notification-heading').textContent).toBe(
        'Heading'
      );
      expect(container.querySelector('blockquote').textContent).toBe('quoted');
      expect(container.querySelector('pre code').textContent).toBe('let x = 1;');
    });

    it('leaves snake_case words and unbalanced markers as the text they are', () => {
      expect(render('sensor_living_room_temp is *not closed and 2 * 3').textContent).toBe(
        'sensor_living_room_temp is *not closed and 2 * 3'
      );
      expect(render('a\\*b').textContent).toBe('a*b');
    });

    it('shows an image as its description, since nothing can be fetched', () => {
      const container = render('![A camera](http://x.test/a.png) done');
      expect(container.querySelector('img')).toBeNull();
      expect(container.textContent).toBe('A camera done');
    });

    it('replaces what it held', () => {
      const container = render('one');
      renderNotificationMarkdown(container, 'two');
      expect(container.textContent).toBe('two');
    });
  });

  describe('links', () => {
    const options = { baseUrl: 'http://homeassistant.local:8123', openLink: jest.fn() };

    it('makes an address a link, without the full stop after it', () => {
      const link = render('See https://example.com/docs. Thanks', options).querySelector('a');
      expect(link.href).toBe('https://example.com/docs');
      expect(link.parentElement.textContent).toBe('See https://example.com/docs. Thanks');
      expect(link.rel).toBe('noopener noreferrer');
    });

    it('turns a Markdown link into one, with its text', () => {
      const link = render('Open [Repairs](/config/repairs).', options).querySelector('a');
      expect(link.textContent).toBe('Repairs');
      expect(link.href).toBe('http://homeassistant.local:8123/config/repairs');
    });

    it('opens it through the app, not in this window', () => {
      const openLink = jest.fn();
      const link = render('[Docs](https://example.com)', { openLink }).querySelector('a');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(openLink).toHaveBeenCalledWith('https://example.com/');
    });

    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'vbscript:x',
      'mailto:a@b.c',
    ])('shows %s as its text and never as a link', (address) => {
      const container = render(`[click me](${address})`, options);
      expect(container.querySelector('a')).toBeNull();
      expect(container.textContent).toBe('click me');
    });

    it('does not resolve a relative address without a Home Assistant URL', () => {
      expect(resolveNotificationLink('/config', '')).toBeNull();
      expect(resolveNotificationLink('/config', 'http://ha.local')).toBe('http://ha.local/config');
      expect(resolveNotificationLink('https://a.test/x', '')).toBe('https://a.test/x');
      expect(resolveNotificationLink('', 'http://ha.local')).toBeNull();
    });
  });

  describe('markup in the text', () => {
    it.each([
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '**<b onmouseover=alert(1)>x</b>**',
      '[<img src=x onerror=alert(1)>](https://a.test)',
      '`<svg onload=alert(1)>`',
    ])('never builds an element out of %s', (message) => {
      const container = render(message);
      expect(container.querySelector('script, img, svg, b')).toBeNull();
      expect(container.innerHTML).not.toMatch(/<(script|img|svg|b)[\s>]/i);
    });
  });

  describe('tokenizing', () => {
    it('nests inline styles', () => {
      expect(tokenizeInline('**bold *both***')).toEqual([
        {
          type: 'bold',
          children: [
            { type: 'text', text: 'bold ' },
            { type: 'italic', children: [{ type: 'text', text: 'both' }] },
          ],
        },
      ]);
    });
  });

  describe('as plain text for the system toast', () => {
    it('drops the syntax and keeps the words', () => {
      expect(
        notificationMarkdownToPlainText(
          '**2 issues.** Open [Repairs](/config/repairs):\n\n- `backup` is late\n- *Zigbee* update\n\nhttps://example.com'
        )
      ).toBe('2 issues. Open Repairs:\n\n• backup is late\n• Zigbee update\n\nhttps://example.com');
    });

    it('numbers an ordered list, and is empty for nothing', () => {
      expect(notificationMarkdownToPlainText('1. a\n2. b')).toBe('1. a\n2. b');
      expect(notificationMarkdownToPlainText('')).toBe('');
      expect(notificationMarkdownToPlainText(undefined)).toBe('');
    });
  });
});
