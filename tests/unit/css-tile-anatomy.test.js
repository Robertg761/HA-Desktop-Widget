/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
  loadAppStylesheets,
  resolvedValue,
} = require('../helpers/css-cascade.js');

const styles = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

/** The declarations of the first rule with exactly this selector. */
const ruleBody = (selector) => {
  const start = styles.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return styles.slice(start, styles.indexOf('\n}', start));
};
/** A value with the line breaks Prettier puts in long declarations collapsed to single spaces. */
const flat = (value) => String(value).replace(/\s+/g, ' ');
// The default accent as the helper resolves it, as an edge and as a fill.
const ACCENT = 'rgba(100, 181, 246';
const ACCENT_RGB = '100, 181, 246';

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

const tile = (classes = '', attributes = '') =>
  `<div class="control-item ${classes}" ${attributes}>
    <div class="control-icon"></div>
    <div class="control-info"><div class="control-name"></div><div class="control-state"></div></div>
  </div>`;
const grid = (inner, gridClass = '') =>
  `<div id="quick-controls" class="${gridClass}">${inner}</div>`;

describe('Quick Access tile anatomy', () => {
  beforeAll(() => {
    loadAppStylesheets();
  });

  describe('where a tile hangs its name', () => {
    const infoOf = (classes = '', attributes = '', bodyClass = '') => {
      render(bodyClass, grid(tile(classes, attributes)));
      return document.querySelector('.control-info');
    };

    it('starts the icon, name and state at the top, at one offset, for the standard tiles', () => {
      for (const classes of [
        '',
        'timer-entity',
        'sensor-entity sensor-numeric-entity',
        'unavailable-entity',
      ]) {
        const info = infoOf(classes);
        expect({ classes, justify: resolvedValue(info, 'justify-content') }).toEqual({
          classes,
          justify: 'flex-start',
        });
        expect(resolvedValue(info, 'padding-top')).toBe('4px');
      }
    });

    it('keeps the tiles that lay themselves out centred: graph, media, camera preview and gauge', () => {
      for (const [classes, attributes] of [
        ['comparison-graph-tile', ''],
        ['media-player-entity', ''],
        ['camera-preview-tile', ''],
        ['sensor-numeric-entity', "data-chart-type='gauge'"],
      ]) {
        const info = infoOf(classes, attributes);
        expect(resolvedValue(info, 'justify-content')).not.toBe('flex-start');
      }
    });

    it('uses the same offset in compact density, and the compact row height', () => {
      const info = infoOf('', '', 'density-compact');
      expect(resolvedValue(info, 'justify-content')).toBe('flex-start');
      expect(resolvedValue(info, 'padding-top')).toBe('4px');
    });
  });

  describe('tile height', () => {
    it('is a floor, so a tile can follow a taller media tile in its row', () => {
      render('', grid(tile()));
      const item = document.querySelector('.control-item');
      expect(resolvedValue(item, 'height')).toBe('auto');
      expect(resolvedValue(item, 'min-height')).toBe('104px');
      render('density-compact', grid(tile()));
      expect(resolvedValue(document.querySelector('.control-item'), 'min-height')).toBe('78px');
    });

    it('keeps the fixed row height while the tiles are being edited, with the buttons above the icon', () => {
      render('', grid(tile(), 'reorganize-mode'));
      const item = document.querySelector('.control-item');
      expect(resolvedValue(item, 'height')).toBe('104px');
      // A row a taller media tile has made deeper still takes the tile to its foot.
      expect(resolvedValue(item, 'min-height')).toBe('100%');
      expect(resolvedValue(item.querySelector('.control-info'), 'padding-top')).toBe('0px');
      render('density-compact', grid(tile(), 'reorganize-mode'));
      expect(resolvedValue(document.querySelector('.control-item'), 'height')).toBe('96px');
    });

    it('does not let a name on two lines above a state line grow a tile past the floor', () => {
      // The 12px foot of the centred layout, with the name hanging from the top, filled the 104px
      // to the pixel; a number sensor's foot is the band its sparkline lies in (below).
      render('', grid(tile()));
      expect(resolvedValue(document.querySelector('.control-item'), 'padding-bottom')).toBe('8px');
      render('', grid(tile('sensor-numeric-entity')));
      expect(resolvedValue(document.querySelector('.control-item'), 'padding-bottom')).toBe('0');
    });

    it.each([
      ['the default window', { width: 500, height: 600 }],
      ['a window narrowed by enlarged text', { width: 333, height: 600 }],
      ['the narrowest window', { width: 280, height: 600 }],
    ])('hangs a sensor tile from the same top as the others in %s', (_name, viewport) => {
      // A fixed 12px top stayed put when a narrow window tightened the other tiles to 4px, which
      // put the sensor's icon 8px and its name 6px below its neighbours'.
      render('', grid(tile() + tile('sensor-numeric-entity')));
      const [standard, sensor] = document.querySelectorAll('.control-item');
      for (const property of ['padding', 'gap']) {
        expect({
          property,
          sensor: resolvedValue(sensor, property, { viewport }),
        }).toEqual({ property, sensor: resolvedValue(standard, property, { viewport }) });
      }
    });

    it('keeps the sensor close to the top while editing, where its hidden icon sits under the buttons', () => {
      render('', grid(tile() + tile('sensor-numeric-entity'), 'reorganize-mode'));
      const [standard, sensor] = document.querySelectorAll('.control-item');
      expect(resolvedValue(sensor, 'padding-top')).toBe('12px');
      expect(resolvedValue(standard, 'padding-top')).toBe('calc(0.5rem + 28px)');
    });

    it('lets the media tile size itself', () => {
      render('', grid(tile('media-player-entity')));
      expect(resolvedValue(document.querySelector('.control-item'), 'height')).not.toBe('104px');
    });
  });

  describe('a number sensor and its sparkline', () => {
    const sensorTile = (
      attributes = ''
    ) => `<div class="control-item sensor-numeric-entity" ${attributes}>
      <div class="control-icon"></div>
      <div class="control-info">
        <div class="control-name"></div>
        <div class="control-sensor-readout"><span class="control-sensor-value"></span></div>
        <div class="control-sensor-sparkline"></div>
      </div>
    </div>`;
    const pixels = (text) =>
      (text.match(/[\d.]+(?=px)/g) || []).reduce((sum, n) => sum + Number(n), 0);
    const bandOf = (bodyClass, attributes) => {
      render(bodyClass, grid(sensorTile(attributes)));
      const sparkline = document.querySelector('.control-sensor-sparkline');
      return {
        reserved: pixels(resolvedValue(document.querySelector('.control-info'), 'padding-bottom')),
        drawn:
          pixels(resolvedValue(sparkline, 'bottom')) + pixels(resolvedValue(sparkline, 'height')),
      };
    };

    it('keeps the text out of the band the line is drawn in, so a wrapped name pushes the tile taller', () => {
      // The line is 14px tall and sits 4px above the foot; the info block pads its bottom by both.
      // With nothing reserved, a name on two lines put the value in the band and the line ran
      // through the digits.
      const { reserved, drawn } = bandOf('', '');
      expect(drawn).toBe(18);
      expect(reserved).toBe(drawn);
    });

    it.each(['small', 'normal', 'large', 'extra-large'])(
      'reserves the same band at the %s value size, where the readout is what grows',
      (size) => {
        const { reserved, drawn } = bandOf('', `data-value-size='${size}'`);
        expect(reserved).toBe(drawn);
      }
    );

    it('reserves it in compact density too', () => {
      const { reserved, drawn } = bandOf('density-compact', '');
      expect(reserved).toBe(drawn);
    });

    it('reserves nothing for a tile with no chart, and leaves the gauge to its arc', () => {
      expect(bandOf('', "data-chart-type='none'").reserved).toBe(0);
      render('', grid(sensorTile("data-chart-type='gauge'")));
      expect(resolvedValue(document.querySelector('.control-info'), 'padding-bottom')).toBe('10px');
    });
  });

  describe('a tile that does nothing', () => {
    it('shows the default cursor, but a grab in edit mode where it can be dragged', () => {
      render('', grid(tile('', "data-readonly='true'")));
      expect(resolvedValue(document.querySelector('.control-item'), 'cursor')).toBe('default');
      render('', grid(tile('', "data-readonly='true'"), 'reorganize-mode'));
      expect(resolvedValue(document.querySelector('.control-item'), 'cursor')).toBe('grab');
      render('', grid(tile()));
      expect(resolvedValue(document.querySelector('.control-item'), 'cursor')).toBe('pointer');
    });

    it('takes no hover tint, and a tile that does something still does', () => {
      render('', grid(tile('', "data-readonly='true' data-hover"), ''));
      const inert = document.querySelector('.control-item');
      const resting = resolvedValue(inert, 'border-color');
      render('', grid(tile('', 'data-hover')));
      const live = document.querySelector('.control-item');
      expect(resolvedValue(live, 'border-color')).not.toBe(resting);
    });
  });

  describe('the lit state of a tile', () => {
    // The pin's inset highlight.
    const HIGHLIGHT = 'inset 0 1px 0 rgba(255, 255, 255, 0.08)';

    it('is the glow setting and nothing else: a media player Home Assistant calls on does not glow', () => {
      render('', grid(tile('media-player-entity', "data-state='on'")));
      const item = document.querySelector('.control-item');
      expect(resolvedValue(item, 'box-shadow')).toBeNull();
      expect(resolvedValue(item, 'border')).not.toContain(ACCENT);
    });

    it('still draws a pin from its own state', () => {
      render(
        'desktop-pin-mode',
        tile('desktop-pin-control desktop-pin-light-control', "data-state='on'")
      );
      expect(resolvedValue(document.querySelector('.control-item'), 'box-shadow')).toContain(
        HIGHLIGHT
      );
    });

    it('tints a playing player only while the glow is on', () => {
      render('', grid(tile('media-player-entity', "data-state='playing'")));
      expect(resolvedValue(document.querySelector('.control-item'), 'background')).not.toContain(
        ACCENT
      );
      render(
        'active-tile-glow',
        grid(tile('media-player-entity', "data-state='playing' data-active='true'"))
      );
      expect(resolvedValue(document.querySelector('.control-item'), 'background')).toContain(
        ACCENT
      );
    });
  });

  describe('a tile that needs attention', () => {
    it.each([
      ['an unlocked lock', 'warning', '#ffb74d'],
      ['an alarm that went off', 'danger', '#ff8a80'],
    ])('colours %s whether or not the glow is on', (_label, attention, colour) => {
      for (const bodyClass of ['', 'active-tile-glow']) {
        render(bodyClass, grid(tile('', `data-attention='${attention}' data-active='true'`)));
        const item = document.querySelector('.control-item');
        expect(resolvedValue(item.querySelector('.control-icon'), 'color')).toBe(colour);
        // The state line is the colour lifted toward the text, to stay readable on the wash.
        expect(flat(resolvedValue(item.querySelector('.control-state'), 'color'))).toBe(
          `color-mix(in srgb, ${colour} 70%, #f5f5f5)`
        );
      }
    });

    // A holiday's orange or red, or the Amber accent, lit an armed alarm the same way an unlocked
    // lock or an alarm that went off was lit, so these tiles have a look the accent never gives.
    it.each(['', 'active-tile-glow', 'theme-light', 'active-tile-glow theme-light'])(
      'washes and edges it in its own colour and never the accent (%s)',
      (bodyClass) => {
        render(bodyClass, grid(tile('', "data-attention='warning' data-active='true'")));
        const item = document.querySelector('.control-item');
        const colour = resolvedValue(item, '--attention-color');
        // As strong as a lit tile's wash of the accent in either theme, so a tile that needs
        // attention is never the quieter of the two.
        const wash = bodyClass.includes('theme-light') ? '18%' : '24%';
        expect(resolvedValue(item, '--dash-attention-wash')).toBe(
          resolvedValue(document.body, '--dash-tile-wash')
        );

        expect(flat(resolvedValue(item, 'background-image'))).toContain(`${colour} ${wash}`);
        expect(String(resolvedValue(item, 'background-color'))).not.toContain(ACCENT_RGB);
        expect(resolvedValue(item, 'border-color')).toBe(colour);
        // The edge is two pixels: the border and an outline just inside it.
        expect(resolvedValue(item, 'outline')).toBe(`1px solid ${colour}`);
        expect(resolvedValue(item, 'outline-offset')).toBe('-2px');
      }
    );

    it('keeps its own look over the solid panels and in the Readable preset', () => {
      render(
        'active-tile-glow opaque-panels',
        grid(tile('', "data-attention='danger' data-active='true'"))
      );
      let item = document.querySelector('.control-item');
      const image = cascadedDeclaration(item, 'background-image');
      // The solid fill is an !important shorthand; the wash is laid back over it the same way.
      expect(image.important).toBe(true);
      expect(flat(resolvedValue(item, 'background-image'))).toContain('#ff8a80 24%');

      render(
        'active-tile-glow high-contrast opaque-panels',
        grid(tile('', "data-attention='danger' data-active='true'"))
      );
      item = document.querySelector('.control-item');
      // The preset's accent edge marked it as an "on" tile, the same as an armed alarm.
      expect(resolvedValue(item, 'outline-color')).toBeNull();
      expect(resolvedValue(item, 'outline')).toBe(
        `1px solid ${resolvedValue(item, '--error-text')}`
      );
      expect(resolvedValue(item, 'outline-width')).toBe('2px');
      expect(resolvedValue(item, 'border-color')).toBe(resolvedValue(item, '--error-text'));
      expect(String(resolvedValue(item, 'background-color'))).not.toContain('0.26');
    });

    it('marks it with a badge that does not depend on the colour', () => {
      const badge = ruleBody(
        '#quick-controls .control-item[data-attention] > .control-icon::after'
      );
      expect(badge).toMatch(/content:\s*''/);
      expect(badge).toMatch(/background:\s*var\(--attention-color\)/);
      // An exclamation mark cut out of a disc, as a mask, so it is the tile's own wash.
      expect(badge).toMatch(/mask:\s*url\("data:image\/svg\+xml,[^"]*evenodd/);
      expect(badge).toMatch(/inset-inline-start:/);
      // Forced colours would paint the disc Canvas on Canvas.
      const forced = styles.slice(styles.lastIndexOf('@media (forced-colors: active)'));
      expect(styles).toMatch(
        /#quick-controls \.control-item\[data-attention\] > \.control-icon::after \{\s*forced-color-adjust: none;\s*background: CanvasText;/
      );
      expect(forced.length).toBeGreaterThan(0);
    });

    // The slot a dragged tile leaves in Reorganize is the same dashed accent slot for every tile:
    // the status edge outranked it, and the wash lay over its fill.
    it.each(['', 'active-tile-glow high-contrast opaque-panels'])(
      'leaves the drop slot of a dragged tile alone (%s)',
      (bodyClass) => {
        render(bodyClass, grid(tile('sortable-ghost', "data-attention='danger'")));
        const item = document.querySelector('.control-item');
        expect(resolvedValue(item, 'outline')).toMatch(/^2px dashed /);
        expect(resolvedValue(item, 'outline-width')).toBeNull();
        expect(resolvedValue(item, 'background-image')).toBeNull();
        expect(resolvedValue(item, 'border-color')).not.toBe(resolvedValue(item, '--error-text'));
      }
    );

    it('leaves the drop slot alone in forced colours', () => {
      render('', grid(tile('sortable-ghost', "data-attention='danger'")));
      const item = document.querySelector('.control-item');
      expect(resolvedValue(item, 'outline', { forcedColors: true })).toMatch(/^2px dashed /);
    });

    it('leaves the accent to the tiles that are only on', () => {
      render('active-tile-glow', grid(tile('', "data-active='true'")));
      const item = document.querySelector('.control-item');
      expect(resolvedValue(item, 'background-color')).toContain(ACCENT_RGB);
      expect(resolvedValue(item, 'outline')).toBeNull();
    });
  });

  describe('a camera tile with a preview', () => {
    const cameraTile = (attributes = '') =>
      `<div class="control-item camera-preview-tile" ${attributes}>
        <div class="camera-tile-visual"><div class="camera-tile-fallback">
          <div class="control-icon"></div></div></div>
        <div class="camera-tile-copy"><div class="control-name"></div>
          <div class="control-state camera-tile-preview-status"></div></div>
      </div>`;

    it('keeps its caption at the foot, which the tile-fit centring took up under the icon', () => {
      render('', grid(cameraTile("data-camera-preview-state='error'")));
      expect(resolvedValue(document.querySelector('.control-item'), 'justify-content')).toBe(
        'flex-end'
      );
      // The other tiles keep the centring that loses only their foot when they are too full.
      render('', grid(tile()));
      expect(resolvedValue(document.querySelector('.control-item'), 'justify-content')).toBe(
        'safe center'
      );
    });

    it.each([
      ['', '32px'],
      ['density-compact', '25px'],
    ])(
      'puts the icon of a tile with no picture above the caption, not over it (%s)',
      (bodyClass, top) => {
        render(bodyClass, grid(cameraTile("data-camera-preview-state='error'")));
        const fallback = document.querySelector('.camera-tile-fallback');
        expect(resolvedValue(fallback, 'place-items')).toBe('start center');
        expect(resolvedValue(fallback, 'padding-top')).toBe(top);
        // A plain glyph like its neighbours', not the 38px circle the dark stage seats it in.
        const icon = fallback.querySelector('.control-icon');
        expect(resolvedValue(icon, 'width')).toBe('auto');
        expect(resolvedValue(icon, 'border')).toBe('0');
      }
    );

    it('lowers that icon below the edit buttons while editing', () => {
      for (const bodyClass of ['', 'density-compact']) {
        render(bodyClass, grid(cameraTile(), 'reorganize-mode'));
        expect(resolvedValue(document.querySelector('.camera-tile-fallback'), 'padding-top')).toBe(
          '36px'
        );
      }
    });

    it('leaves the picture of a camera that sent one centred under its scrim', () => {
      render('', grid(cameraTile("data-camera-preview-has-frame='true'")));
      expect(resolvedValue(document.querySelector('.camera-tile-fallback'), 'place-items')).toBe(
        'center'
      );
    });
  });

  describe('motion that is dropped', () => {
    it('shows a pressed scene as a still tint for the 600 ms the class lasts', () => {
      const reduced = styles.slice(
        styles.indexOf('@media (prefers-reduced-motion: reduce) {\n  *,')
      );
      const block = reduced.slice(0, reduced.indexOf('\n}\n'));
      expect(block).toMatch(/\.control-item\.activating\s*{[^}]*animation:\s*none/);
      expect(block).toMatch(/\.control-item\.activating\s*{[^}]*background-color:/);
    });
  });
});
