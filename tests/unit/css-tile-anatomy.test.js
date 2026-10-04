/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const styles = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

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
      expect(resolvedValue(item.querySelector('.control-info'), 'padding-top')).toBe('0px');
      render('density-compact', grid(tile(), 'reorganize-mode'));
      expect(resolvedValue(document.querySelector('.control-item'), 'height')).toBe('96px');
    });

    it('does not let a name on two lines above a state line grow a tile past the floor', () => {
      // The 12px foot of the centred layout, with the name hanging from the top, filled the 104px
      // to the pixel; a number sensor reserves nothing for its sparkline.
      render('', grid(tile()));
      expect(resolvedValue(document.querySelector('.control-item'), 'padding-bottom')).toBe('8px');
      render('', grid(tile('sensor-numeric-entity')));
      expect(resolvedValue(document.querySelector('.control-item'), 'padding')).toBe('12px 8px 0');
      expect(resolvedValue(document.querySelector('.control-info'), 'padding-bottom')).toBe('0');
    });

    it('lets the media tile size itself', () => {
      render('', grid(tile('media-player-entity')));
      expect(resolvedValue(document.querySelector('.control-item'), 'height')).not.toBe('104px');
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
    // The default accent as the helper resolves it, and the pin's inset highlight.
    const ACCENT = 'rgba(100, 181, 246';
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
        expect(resolvedValue(item.querySelector('.control-state'), 'color')).toBe(colour);
      }
    });

    it('lights in its own colour, not the accent, with the glow on', () => {
      render('active-tile-glow', grid(tile('', "data-attention='warning' data-active='true'")));
      const background = resolvedValue(document.querySelector('.control-item'), 'background-color');
      expect(background).toContain('#ffb74d 24%');
      expect(background).not.toContain('rgba(100, 181, 246');
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
