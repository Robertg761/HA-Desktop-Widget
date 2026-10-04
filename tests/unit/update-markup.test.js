/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');
const { describeUpdateState } = require('../../src/update-status.js');

const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');

function loadIndex() {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script').forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  return parsed;
}

describe('the update controls in index.html', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('announces the result of a check to a screen reader', () => {
    loadIndex();
    const status = document.getElementById('update-status');

    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.dataset.state).toBe('idle');
    expect(status.contains(document.getElementById('update-status-text'))).toBe(true);
  });

  it('names the download bar after what the status line says and gives it a value', () => {
    loadIndex();
    const progress = document.getElementById('update-progress');

    expect(progress.getAttribute('role')).toBe('progressbar');
    expect(progress.getAttribute('aria-labelledby')).toBe('update-status-text');
    expect(progress.getAttribute('aria-valuemin')).toBe('0');
    expect(progress.getAttribute('aria-valuemax')).toBe('100');
    expect(progress.getAttribute('aria-valuenow')).toBe('0');
  });

  it('starts with the buttons the update UI expects and the install button hidden', () => {
    loadIndex();
    // Hidden until the update UI knows there is a release page for this version.
    expect(document.getElementById('whats-new-btn').classList.contains('hidden')).toBe(true);

    expect(document.getElementById('check-updates-btn').disabled).toBe(true);
    expect(document.getElementById('install-update-btn').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-update-text')).not.toBeNull();
  });
});

describe('the page policy and title', () => {
  const policy = () => {
    const parsed = loadIndex();
    return parsed
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
  };
  const directive = (name) =>
    policy()
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `));

  it('shuts the page to injected base URLs, form posts and plugins', () => {
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('form-action')).toBe("form-action 'none'");
    expect(directive('object-src')).toBe("object-src 'none'");
  });

  it('is not relaxed for workers: the player is told not to start one', () => {
    expect(policy()).not.toMatch(/worker-src/);
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('connect-src')).toBe('connect-src * ha:');
  });

  it('keeps hls.js able to reach Home Assistant', () => {
    // The playlist and its segments are fetched from the Home Assistant URL (http, https or ha:).
    expect(directive('connect-src')).toContain('*');
    expect(directive('media-src')).toContain('ha:');
  });

  it('calls the page HA Desktop Widget, as the window and the installer do', () => {
    const parsed = loadIndex();

    expect(parsed.title).toBe('HA Desktop Widget');
  });
});

describe('how a check is coloured', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  const colourFor = (tone, theme = '') => {
    document.body.className = theme;
    // As the line sits in Settings, under #settings-modal .form-help, which sets its own colour.
    document.body.innerHTML = `<div id="settings-modal"><p class="form-help update-status" data-state="${tone}" id="line"></p></div>`;
    return resolvedValue(document.getElementById('line'), 'color');
  };

  it.each(['', 'theme-light'])('sets a failure apart from the idle line (%s)', (theme) => {
    expect(colourFor('error', theme)).not.toEqual(colourFor('idle', theme));
  });

  it.each(['', 'theme-light'])('sets success and an update waiting apart too (%s)', (theme) => {
    const idle = colourFor('idle', theme);

    expect(colourFor('up-to-date', theme)).not.toEqual(idle);
    expect(colourFor('downloaded', theme)).not.toEqual(idle);
    expect(colourFor('available', theme)).not.toEqual(idle);
  });

  it('leaves the quiet states in the normal help colour', () => {
    const idle = colourFor('idle');

    expect(colourFor('checking')).toEqual(idle);
  });

  it('has a rule for every tone the status line can have, or leaves it deliberately plain', () => {
    const plain = new Set(['idle', 'checking']);
    const tones = new Set(
      [
        { status: 'idle' },
        { status: 'checking' },
        { status: 'available' },
        { status: 'none' },
        { status: 'downloading' },
        { status: 'downloaded' },
        { status: 'error' },
        { status: 'check-failed' },
        { status: 'manual' },
        { status: 'portable' },
        { status: 'dev' },
      ].map((update) => describeUpdateState(update).tone)
    );
    const idle = colourFor('idle');

    tones.forEach((tone) => {
      if (plain.has(tone)) expect(colourFor(tone)).toEqual(idle);
      else expect(colourFor(tone)).not.toEqual(idle);
    });
  });
});
