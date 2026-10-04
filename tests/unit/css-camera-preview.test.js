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

describe('the camera viewer toolbar', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const toolbar = () => {
    render(`
      <div class="modal camera-modal"><div class="modal-content"><div class="modal-body">
        <div class="camera-toolbar" id="toolbar">
          <p class="camera-info" id="info"></p>
          <div class="camera-mode-buttons" id="buttons"></div>
        </div>
      </div></div></div>`);
    return {
      toolbar: document.getElementById('toolbar'),
      info: document.getElementById('info'),
      buttons: document.getElementById('buttons'),
    };
  };

  it('moves the buttons under the status text when both do not fit, instead of squeezing it', () => {
    const { toolbar: bar, buttons } = toolbar();

    // Mute, Snapshot and Live are three buttons that keep their own width; in a narrow window or
    // in German the status text used to be squeezed to nothing beside them.
    expect(resolvedValue(bar, 'flex-wrap')).toBe('wrap');
    expect(resolvedValue(buttons, 'flex-wrap')).toBe('wrap');
    expect(resolvedValue(buttons, 'margin-inline-start')).toBe('auto');
  });

  it('keeps the status text able to shrink, and the buttons from running past the dialog', () => {
    const { info, buttons } = toolbar();

    expect(resolvedValue(info, 'min-width')).toBe('0');
    // They may shrink to the row and wrap among themselves; "none" held them at their full width,
    // and the last button ran past the edge of the dialog.
    expect(resolvedValue(buttons, 'flex')).toMatch(/^0 1 auto$/);
    expect(resolvedValue(buttons, 'max-width')).toBe('100%');
  });
});
