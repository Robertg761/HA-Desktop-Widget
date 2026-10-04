/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
  loadAppStylesheets,
  resolvedValue,
} = require('../helpers/css-cascade');

const stylesheet = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

beforeAll(() => {
  loadAppStylesheets();
});

describe('the title bar as a drag handle', () => {
  const HEADER = `
    <div class="widget-header">
      <div class="drag-area"><span class="widget-title">Home Assistant</span>
        <div class="connection-indicator"></div></div>
      <div class="header-controls"><button class="control-btn"></button></div>
    </div>`;
  const region = (selector) =>
    cascadedDeclaration(document.querySelector(selector), '-webkit-app-region')?.value;

  // The title is a 17px line in a 41px bar. Only that line moved the window, so grabbing the bar
  // above, below or beside the words did nothing.
  it('moves the window from anywhere in the bar', () => {
    render('', HEADER);
    expect(region('.widget-header')).toBe('drag');
  });

  it('leaves the buttons and the status dot clickable', () => {
    render('', HEADER);
    expect(region('.header-controls')).toBe('no-drag');
    expect(region('.connection-indicator')).toBe('no-drag');
  });

  it('hands the drag to the app on a desktop layer, which the compositor cannot move', () => {
    render('layer-drag-enabled', HEADER);
    expect(region('.widget-header')).toBe('no-drag');
    expect(region('.drag-area')).toBe('no-drag');
  });

  it('is the element the layer drag listens to', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/layer-drag.js'), 'utf8');
    // ".header" matched nothing; the bar is .widget-header.
    expect(source).toContain("'.widget-header, .drag-area, .drag-region,");
    expect(source).not.toMatch(/\.header[,']/);
  });
});

describe('the notice that the desktop places a tile', () => {
  it('spans the tile instead of squeezing into its right half', () => {
    render(
      'desktop-pin-mode desktop-pin-edit-mode desktop-pin-compositor-placement',
      '<div class="desktop-pin-shell"><div class="desktop-pin-placement-notice">Notice</div></div>'
    );
    const notice = document.querySelector('.desktop-pin-placement-notice');
    const value = (property) => cascadedDeclaration(notice, property)?.value;
    // Centred with left: 50% and no width, its width could only be what is left of the tile to the
    // right of its own left edge: seven lines in a default pin.
    expect(value('left')).toBe('12px');
    expect(value('right')).toBe('12px');
    expect(value('transform')).toBeUndefined();
    expect(value('display')).toBe('block');
  });
});

describe('reduced motion', () => {
  const blocks = [...stylesheet.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)].map(
    (match) => {
      let depth = 0;
      for (let index = match.index; index < stylesheet.length; index += 1) {
        if (stylesheet[index] === '{') depth += 1;
        if (stylesheet[index] === '}') {
          depth -= 1;
          if (depth === 0) return stylesheet.slice(match.index, index + 1);
        }
      }
      return '';
    }
  );

  // A blur is not motion. Taking it away flattened the dialogs and scrims of everyone who asked
  // for less movement on Windows and macOS (Linux brought it back with a rule of its own), so the
  // same dialog looked different depending on the operating system.
  it('does not take the backdrop blur away', () => {
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toMatch(/backdrop-filter:\s*none/);
    }
  });

  it('still shortens animations and transitions', () => {
    expect(blocks.some((block) => /animation-duration:\s*0\.01ms !important/.test(block))).toBe(
      true
    );
  });
});

describe('what floats over the window on Linux, where backdrop blur is off', () => {
  const FLOATERS = [
    '.command-palette-panel',
    '.toast',
    '.connection-status-tooltip',
    '.theme-tooltip-flyout',
  ];
  const dialogBackground = (selector, bodyClass) => {
    render(
      bodyClass,
      `<div class="command-palette-panel"></div><div class="toast"></div>
       <div class="connection-status-tooltip"></div><div class="theme-tooltip-flyout"></div>
       <div class="modal"><div class="modal-content"></div></div>`
    );
    const element = document.querySelector(selector);
    return {
      background: resolvedValue(element, '--dialog-bg'),
      solid: resolvedValue(element, '--dialog-bg-solid'),
    };
  };

  // Their panel is 96% opaque, which hid nothing once the blur was gone: the text of the tile
  // underneath showed through the palette rows and the toasts.
  it.each(FLOATERS)('%s is solid in performance mode', (selector) => {
    const { background, solid } = dialogBackground(selector, 'linux-performance-mode');
    expect(background).toBe(solid);
  });

  it.each(FLOATERS)('%s keeps its 96% panel where the blur is on', (selector) => {
    const { background, solid } = dialogBackground(selector, '');
    expect(background).not.toBe(solid);
  });

  // Settings and the other dialogs keep their blur on Linux, and with it their 96% panel.
  it('leaves dialogs on their 96% panel in performance mode', () => {
    const { background, solid } = dialogBackground('.modal-content', 'linux-performance-mode');
    expect(background).not.toBe(solid);
  });
});

describe('the Mode control while a followed palette decides the mode', () => {
  it('is dimmed once, by the control, not again by each disabled option', () => {
    expect(stylesheet).toMatch(
      /\.segmented-control\.is-disabled \.segmented-option:disabled \{\s*opacity: 1;\s*\}/
    );
    expect(stylesheet).toMatch(/\.segmented-control\.is-disabled \{\s*opacity: 0\.45;\s*\}/);
  });
});

describe('the colours while the Omarchy palette is followed', () => {
  it('dim the pane, not the note that says why', () => {
    render(
      '',
      `<section id="colors-group" class="settings-group is-following-palette">
         <h4 class="settings-group-caption">Colors</h4>
         <p id="colors-follow-note" class="form-help settings-group-note"></p>
         <div class="settings-group-body"></div>
       </section>`
    );
    expect(
      cascadedDeclaration(document.querySelector('.settings-group-body'), 'opacity').value
    ).toBe('0.45');
    expect(
      cascadedDeclaration(document.getElementById('colors-follow-note'), 'opacity')
    ).toBeNull();
  });

  it('leave the pane alone otherwise', () => {
    render(
      '',
      '<section id="colors-group" class="settings-group"><div class="settings-group-body"></div></section>'
    );
    expect(
      cascadedDeclaration(document.querySelector('.settings-group-body'), 'opacity')
    ).toBeNull();
  });
});
