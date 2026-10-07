/**
 * @jest-environment jsdom
 */

// Holiday art is decoration behind controls, and was drawn where the controls are: under a tile's
// Controls button, behind a dialog's close button, across the Settings icon rail. jsdom cannot
// lay a pseudo-element out, so these read the declarations the stylesheet makes for them.

const {
  compareSpecificity,
  loadAppStylesheets,
  specificity,
} = require('../helpers/css-cascade.js');

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
    // The Halloween web stays in the corner, and the close button gets a backing over it, in
    // Settings too, whose header is a plain panel now.
    expect(declared("body[data-season='halloween'] .modal-content::before", 'inset-inline')).toBe(
      'auto 0'
    );
    expect(
      declared(
        "body[data-season='halloween'] .modal .modal-header .close-btn:not(:hover, :focus-visible)",
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

  // The winning value of `property` on the element's `pseudo` (e.g. '::after'), by specificity and
  // then source order: the rules for it are matched on the element the pseudo-element belongs to.
  function pseudoValue(element, pseudo, property) {
    let winner = null;
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules && !rule.selectorText) {
          if (!rule.media || !/forced-colors: active/.test(rule.media.mediaText)) {
            visit(rule.cssRules);
          }
          continue;
        }
        const value = rule.style?.getPropertyValue(property);
        if (!rule.selectorText || !value) continue;
        for (const selector of rule.selectorText.split(/,(?![^(]*\))/).map(squash)) {
          if (!selector.endsWith(pseudo)) continue;
          const host = selector.slice(0, -pseudo.length);
          let matches = false;
          try {
            matches = element.matches(host);
          } catch {
            // A selector jsdom cannot parse never matches here.
          }
          if (!matches) continue;
          const weight = specificity(selector);
          if (!winner || compareSpecificity(weight, winner.weight) >= 0) {
            winner = { weight, value: value.trim() };
          }
        }
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    return winner?.value;
  }

  // Every third tile takes a gift, a pumpkin or a turkey in its bottom end corner, which is where a
  // number sensor's trend line ends with its newest reading, in the same holiday colour.
  it.each([
    ['a trend line', "data-chart-type='line'", 'none'],
    ['a gauge', "data-chart-type='gauge'", 'none'],
    ['no graph', "data-chart-type='none'", "''"],
  ])('leaves the sitting piece off a number sensor that draws %s', (_, chart, content) => {
    document.body.dataset.season = 'christmas';
    document.body.innerHTML = `<div id="quick-controls">
      <div class="control-item"></div>
      <div class="control-item sensor-numeric-entity" ${chart}></div>
      <div class="control-item"></div>
      <div class="control-item"></div>
      <div class="control-item"></div>
    </div>`;
    try {
      const [, sensor, , , lamp] = document.querySelectorAll('.control-item');
      expect(pseudoValue(sensor, '::after', 'content')).toBe(content);
      // The other tiles in that column keep theirs.
      expect(pseudoValue(lamp, '::after', 'content')).toBe("''");
    } finally {
      delete document.body.dataset.season;
      document.body.innerHTML = '';
    }
  });

  // Easter puts an egg in a bottom corner of the tiles in the first and third columns: in the third,
  // the purple egg sat on the end of the purple trend line, over the newest reading.
  it.each([
    ['a trend line', "data-chart-type='line'", 'none'],
    ['a gauge', "data-chart-type='gauge'", 'none'],
    ['no graph', "data-chart-type='none'", "''"],
  ])("leaves Easter's egg off a number sensor that draws %s", (_, chart, content) => {
    document.body.dataset.season = 'easter';
    const sensor = `<div class="control-item sensor-numeric-entity" ${chart}></div>`;
    const tile = '<div class="control-item"></div>';
    document.body.innerHTML = `<div id="quick-controls">
      ${[sensor, tile, sensor, tile, tile, tile].join('')}
    </div>`;
    try {
      const tiles = document.querySelectorAll('.control-item');
      // In the first column and in the third, where the newest reading is.
      expect(pseudoValue(tiles[0], '::before', 'content')).toBe(content);
      expect(pseudoValue(tiles[2], '::before', 'content')).toBe(content);
      // The other tiles of those columns keep theirs.
      expect(pseudoValue(tiles[3], '::before', 'content')).toBe("''");
      expect(pseudoValue(tiles[5], '::before', 'content')).toBe("''");
    } finally {
      delete document.body.dataset.season;
      document.body.innerHTML = '';
    }
  });

  it("gives the weather card the clock card's piece where it has none of its own", () => {
    expect(declared('body[data-season] .weather-card', '--season-sit')).toBe(
      'var(--season-weather-sit, var(--season-time-sit))'
    );
  });

  it('keeps the title hat on the cap line and the clock spider clear of the time', () => {
    expect(declared('body[data-season] .drag-area::before', 'top')).toBe(
      'calc(-10px - var(--season-hat-lift, 0px))'
    );
    // The bunny ears are the one hat that still touched the H, so they sit a pixel higher.
    expect(declared("body[data-season='easter']", '--season-hat-lift')).toBe('1px');
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
      '<div class="first-run-actions"><button class="btn">Full settings</button><div class="first-run-step-actions"><button class="btn btn-secondary" hidden>Back</button><button class="btn btn-primary">Next</button></div></div>';
    const [, back, next] = document.querySelectorAll('.first-run-actions .btn');
    expect(window.getComputedStyle(back).display).toBe('none');
    expect(window.getComputedStyle(next).display).not.toBe('none');
    back.hidden = false;
    expect(window.getComputedStyle(back).display).not.toBe('none');
    document.body.innerHTML = '';
  });
});
