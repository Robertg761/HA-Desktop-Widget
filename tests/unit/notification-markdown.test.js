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

    it('lays out lists and quotes in the language of their own text', () => {
      // An English list in an Arabic window keeps its bullets, and a quote its bar, at the start of
      // its lines; paragraphs and code need no attribute (see styles.css).
      const container = render('Intro\n\n- a\n\n1. first\n\n> quoted\n\n```\ncode\n```');
      expect(
        [...container.children].map((node) => `${node.tagName}:${node.getAttribute('dir')}`)
      ).toEqual(['P:null', 'UL:auto', 'OL:auto', 'BLOCKQUOTE:auto', 'PRE:null']);
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

  // Issue #214: Home Assistant's Markdown takes HTML too, and older automations bold with <b>.
  describe('inline HTML', () => {
    it('draws bold, italic, underline, strikethrough and line breaks', () => {
      const html = render(
        '<b>bold</b> <strong>strong</strong> <i>italic</i> <em>em</em> <u>under</u> <s>gone</s> <del>del</del><br>next<br/>last'
      ).innerHTML;
      expect(html).toBe(
        '<p><strong>bold</strong> <strong>strong</strong> <em>italic</em> <em>em</em> <u>under</u> <s>gone</s> <s>del</s><br>next<br>last</p>'
      );
    });

    it('reads tags in either case, nested in each other and in Markdown', () => {
      expect(render('<B>Front door</B> is **<i>open</i>**').innerHTML).toBe(
        '<p><strong>Front door</strong> is <strong><em>open</em></strong></p>'
      );
      // An element of the same name inside it is passed over to find its own closing tag.
      expect(render('<b>a <b>b</b> c</b>').innerHTML).toBe(
        '<p><strong>a <strong>b</strong> c</strong></p>'
      );
    });

    it('keeps no attribute of a tag', () => {
      expect(render('<b onmouseover="alert(1)" style="color:red">x</b>').innerHTML).toBe(
        '<p><strong>x</strong></p>'
      );
    });

    it('turns an anchor into a link, through the app, and an unsafe one into its text', () => {
      const openLink = jest.fn();
      const container = render(
        `<a href="/config/repairs">Repairs</a>, <a href='https://a.test/?x=1&amp;y=2' target="_blank">site</a>, <a href=https://b.test>b</a>, <a href="javascript:alert(1)">bad</a>, <a name="x">plain</a>`,
        { baseUrl: 'http://ha.local:8123', openLink }
      );
      const anchors = [...container.querySelectorAll('a')];
      expect(anchors.map((anchor) => [anchor.textContent, anchor.getAttribute('href')])).toEqual([
        ['Repairs', 'http://ha.local:8123/config/repairs'],
        ['site', 'https://a.test/?x=1&y=2'],
        ['b', 'https://b.test/'],
      ]);
      expect(anchors[1].hasAttribute('target')).toBe(false);
      expect(container.textContent).toBe('Repairs, site, b, bad, plain');
      anchors[0].click();
      expect(openLink).toHaveBeenCalledWith('http://ha.local:8123/config/repairs');
    });

    it('leaves other tags, tags left open and a lone < as the text they are', () => {
      expect(render('<span>x</span> <b>never closed').textContent).toBe(
        '<span>x</span> <b>never closed'
      );
      expect(render('2 < 3 and <b>4</b> > 1').innerHTML).toBe(
        '<p>2 &lt; 3 and <strong>4</strong> &gt; 1</p>'
      );
      // A tag in code is the code.
      expect(render('`<b>x</b>`').innerHTML).toBe('<p><code>&lt;b&gt;x&lt;/b&gt;</code></p>');
    });

    it('reads character references as the characters, without making markup of them', () => {
      expect(
        render('Tom &amp; Jerry&nbsp;&#39;s &#x2014; &lt;b&gt;x&lt;/b&gt; &bogus;').textContent
      ).toBe("Tom & Jerry\u00a0's \u2014 <b>x</b> &bogus;");
      expect(render('&lt;b&gt;x&lt;/b&gt;').querySelector('strong')).toBeNull();
      // Code is shown as it was written.
      expect(render('`&amp;`').textContent).toBe('&amp;');
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

    it('drops HTML tags and keeps the words, a <br> as a new line', () => {
      expect(
        notificationMarkdownToPlainText(
          'Front door <b>open</b><br>Since <i>10:00</i>, <a href="https://a.test">details</a> &amp; <u>more</u>'
        )
      ).toBe('Front door open\nSince 10:00, details & more');
    });

    it('numbers an ordered list, and is empty for nothing', () => {
      expect(notificationMarkdownToPlainText('1. a\n2. b')).toBe('1. a\n2. b');
      expect(notificationMarkdownToPlainText('')).toBe('');
      expect(notificationMarkdownToPlainText(undefined)).toBe('');
    });
  });
});
