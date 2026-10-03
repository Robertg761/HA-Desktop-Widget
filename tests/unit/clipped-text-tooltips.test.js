const { installClippedTextTooltips } = require('../../src/clipped-text-tooltips.js');

describe('clipped text tooltips', () => {
  let styles;

  // jsdom does no layout, so the style and the measured sizes are set by the test.
  const label = (text, { ellipsis = false, clamp = 'none', overflow = 'hidden' } = {}) => {
    const element = document.createElement('span');
    element.textContent = text;
    styles.set(element, {
      overflow,
      overflowX: overflow,
      textOverflow: ellipsis ? 'ellipsis' : 'clip',
      getPropertyValue: (name) => (name === '-webkit-line-clamp' ? clamp : ''),
    });
    return element;
  };
  const size = (element, { scrollWidth, clientWidth, scrollHeight = 20, clientHeight = 20 }) => {
    Object.defineProperties(element, {
      scrollWidth: { configurable: true, value: scrollWidth },
      clientWidth: { configurable: true, value: clientWidth },
      scrollHeight: { configurable: true, value: scrollHeight },
      clientHeight: { configurable: true, value: clientHeight },
    });
  };
  const hover = (element) =>
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));

  beforeEach(() => {
    styles = new Map();
    jest.spyOn(window, 'getComputedStyle').mockImplementation(
      (element) =>
        styles.get(element) || {
          overflow: 'visible',
          overflowX: 'visible',
          textOverflow: 'clip',
          getPropertyValue: () => '',
        }
    );
    document.body.innerHTML = '';
    installClippedTextTooltips(document.body);
  });

  afterEach(() => jest.restoreAllMocks());

  it('gives a label cut by an ellipsis its whole text as a tooltip', () => {
    const name = label('  Upstairs hallway   ceiling light ', { ellipsis: true });
    size(name, { scrollWidth: 240, clientWidth: 120 });
    document.body.append(name);

    hover(name);

    expect(name.title).toBe('Upstairs hallway ceiling light');
  });

  it('gives a label cut by a line clamp its whole text', () => {
    const name = label('A long name', { clamp: '2' });
    size(name, { scrollWidth: 100, clientWidth: 100, scrollHeight: 60, clientHeight: 30 });
    document.body.append(name);

    hover(name);

    expect(name.title).toBe('A long name');
  });

  it('leaves a label that fits without one', () => {
    const name = label('Desk lamp', { ellipsis: true, clamp: '2' });
    size(name, { scrollWidth: 60, clientWidth: 120 });
    document.body.append(name);

    hover(name);

    expect(name.hasAttribute('title')).toBe(false);
  });

  it('finds the label when the pointer is on something inside it', () => {
    const name = label('Kitchen under-cabinet lights', { ellipsis: true });
    size(name, { scrollWidth: 300, clientWidth: 100 });
    const inner = document.createElement('b');
    name.append(inner);
    document.body.append(name);

    hover(inner);

    expect(name.title).toBe('Kitchen under-cabinet lights');
  });

  it('keeps a title someone else set', () => {
    const id = label('light.office', { ellipsis: true });
    id.title = 'The entity id';
    size(id, { scrollWidth: 300, clientWidth: 100 });
    document.body.append(id);

    hover(id);

    expect(id.title).toBe('The entity id');
  });

  it('takes its title back once the text fits, so it never goes stale', () => {
    const name = label('Living room', { ellipsis: true });
    size(name, { scrollWidth: 200, clientWidth: 100 });
    document.body.append(name);
    hover(name);
    expect(name.title).toBe('Living room');

    size(name, { scrollWidth: 80, clientWidth: 100 });
    hover(name);

    expect(name.hasAttribute('title')).toBe(false);
  });

  it('does not touch text that does not clip its overflow', () => {
    const name = label('Plain', { ellipsis: true, overflow: 'visible' });
    size(name, { scrollWidth: 200, clientWidth: 100 });
    document.body.append(name);

    hover(name);

    expect(name.hasAttribute('title')).toBe(false);
  });
});
