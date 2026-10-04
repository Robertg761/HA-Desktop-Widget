const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

function render(html) {
  document.body.className = '';
  document.body.innerHTML = html;
}

const expandedPreview = (state, hasFrame) => `
  <div class="camera-expanded-preview" data-camera-preview-state="${state}"
       data-camera-preview-source="image" data-camera-preview-has-frame="${hasFrame}">
    <div class="camera-expanded-preview-shell">
      <span class="camera-expanded-preview-dot" id="dot"></span>
      <div class="camera-expanded-preview-stage">
        <div class="camera-tile-visual">
          <img class="camera-tile-preview-image" data-camera-buffer-loaded="true" id="frame">
          <div class="camera-tile-fallback" id="fallback"></div>
        </div>
      </div>
      <span class="camera-expanded-preview-status" id="status"></span>
    </div>
  </div>`;

describe('the expanded camera preview', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('when the camera goes offline while it is open', () => {
    it('turns the dot and the status warm, as the tile does', () => {
      const colours = (state) => {
        render(expandedPreview(state, 'true'));
        return {
          dot: resolvedValue(document.getElementById('dot'), 'background'),
          status: resolvedValue(document.getElementById('status'), 'color'),
        };
      };

      const offline = colours('unavailable');

      expect(offline).toEqual(colours('stale'));
      expect(offline.dot).not.toEqual(colours('ready').dot);
      expect(offline.status).not.toEqual(colours('ready').status);
    });

    it('keeps the placeholder icon off the frame it still holds', () => {
      render(expandedPreview('unavailable', 'true'));

      expect(resolvedValue(document.getElementById('fallback'), 'opacity')).toBe('0');
    });

    it('shows the placeholder when there is no frame to keep', () => {
      render(expandedPreview('unavailable', 'false'));

      expect(resolvedValue(document.getElementById('fallback'), 'opacity')).not.toBe('0');
    });

    it('dims the retained frame so it does not pass for a current picture', () => {
      render(expandedPreview('unavailable', 'true'));

      expect(resolvedValue(document.getElementById('frame'), 'filter')).toMatch(
        /saturate\(0\.25\)/
      );
    });

    it('leaves the picture of a working camera alone', () => {
      render(expandedPreview('ready', 'true'));

      expect(resolvedValue(document.getElementById('frame'), 'filter')).toBe('none');
    });
  });
});
