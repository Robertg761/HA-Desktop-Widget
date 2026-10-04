/**
 * @jest-environment jsdom
 */

// Holiday art is decoration behind controls, and was drawn where the controls are: under a tile's
// Controls button, behind a dialog's close button, across the Settings icon rail. jsdom cannot
// lay a pseudo-element out, so these read the declarations the stylesheet makes for them.

const { loadAppStylesheets } = require('../helpers/css-cascade.js');

const squash = (selector) => selector.replace(/\s+/g, ' ').trim();

// The value the last rule naming exactly `selector` gives `property`, or undefined.
function declared(selector, property) {
  let value;
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        visit(rule.cssRules);
        continue;
      }
      if (!rule.selectorText || !rule.style) continue;
      const listed = rule.selectorText.split(/,(?![^(]*\))/).map(squash);
      if (listed.includes(squash(selector))) {
        const found = rule.style.getPropertyValue(property);
        if (found) value = found.trim();
      }
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules);
  return value;
}

describe('holiday art beside controls', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  it('moves a tile with a Controls button to the start corner, except where the art is elsewhere', () => {
    const rule =
      "body[data-season]:where(:not([data-season='christmas'], [data-season='easter'])) .control-item:has(> .tile-details-button)::before";
    expect(declared(rule, 'inset-inline')).toBe('0 auto');
    expect(declared(rule, 'inset-block')).toBe('0 auto');
    // The lantern hangs 14px in from the corner, and Halloween's web is flipped to face inwards.
    expect(
      declared(
        "body[data-season='lunar-new-year'] .control-item:has(> .tile-details-button)::before",
        'inset-inline'
      )
    ).toBe('14px auto');
    expect(
      declared(
        "body[data-season='halloween'] .control-item:has(> .tile-details-button)::before",
        'transform'
      )
    ).toBe('scaleX(calc(var(--season-dir) * -1))');
  });

  it("keeps a dialog's art beside the close button, which takes the last 44px of its header", () => {
    expect(declared('body[data-season] .modal-content::before', 'inset-inline-end')).toBe('48px');
    expect(declared("body[data-season='christmas'] .modal-content::before", 'inset-inline')).toBe(
      'auto 52px'
    );
    expect(
      declared("body[data-season='lunar-new-year'] .modal-content::before", 'inset-inline-end')
    ).toBe('56px');
    // The Halloween web stays in the corner, and the close button gets a backing over it.
    expect(declared("body[data-season='halloween'] .modal-content::before", 'inset-inline')).toBe(
      'auto 0'
    );
    expect(
      declared(
        "body[data-season='halloween'] .modal:not(#settings-modal) .modal-header .close-btn:not(:hover, :focus-visible)",
        'background'
      )
    ).toMatch(/^rgba\(var\(--window-bg-rgb\), 0\.\d+\)$/);
  });

  it('fits the Settings art in its 50px header and its sitting piece in the 52px icon rail', () => {
    const settings = 'body[data-season] #settings-modal .modal-content';
    expect(declared(settings, '--season-size')).toBe('44px');
    expect(declared(`${settings}::before`, 'inset-block-start')).toBe('3px');
    // 6px in and 40px wide leaves the piece inside the 52px rail, clear of the page.
    expect(declared(settings, '--season-sit-size')).toBe('40px');
    expect(declared(`${settings}::after`, 'inset-inline-start')).toBe('6px');
    // The rail blurs what is behind it, so the piece is drawn above the rail.
    expect(declared(`${settings}::after`, 'z-index')).toBe('1');
  });

  it("gives the weather card the clock card's piece where it has none of its own", () => {
    expect(declared('body[data-season] .weather-card', '--season-sit')).toBe(
      'var(--season-weather-sit, var(--season-time-sit))'
    );
  });

  it('keeps the title hat on the cap line and the clock spider clear of the time', () => {
    expect(declared('body[data-season] .drag-area::before', 'top')).toBe('-10px');
    expect(declared('body[data-season] .drag-area::before', 'width')).toBe('18px');
    expect(declared('body[data-season] .drag-area::before', 'height')).toBe('14px');
    expect(declared('body[data-season] .drag-area::before', 'transform')).toContain('-6deg');
    expect(
      declared(
        "body[data-season='halloween'] .status-card:not(.weather-card, .primary-light-card)::after",
        'inset-inline'
      )
    ).toBe('auto 20px');
    expect(
      declared(
        "body[data-season='easter'] .status-card:not(.weather-card, .primary-light-card)::after",
        'inset-block'
      )
    ).toBe('auto -5px');
  });
});

describe('first-run wizard buttons', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  it('really hides Back on the steps where it is hidden', () => {
    document.body.innerHTML =
      '<div class="first-run-actions"><button class="btn">Full Settings</button><button class="btn btn-secondary" hidden>Back</button><button class="btn btn-primary">Next</button></div>';
    const [, back, next] = document.querySelectorAll('.first-run-actions .btn');
    expect(window.getComputedStyle(back).display).toBe('none');
    expect(window.getComputedStyle(next).display).not.toBe('none');
    back.hidden = false;
    expect(window.getComputedStyle(back).display).not.toBe('none');
    document.body.innerHTML = '';
  });
});
