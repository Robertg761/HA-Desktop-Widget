/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const { DROP_FOCUS } = require('../../scripts/visual-snapshots/fixture.cjs');

// The runner closes what a scene left open with Escape, which puts the page in keyboard mode, so
// the control a closing dialog hands focus to draws its ring. The notifications panel hands it to
// the header gear, which then had a ring in the captures of every scene that followed.
describe('the snapshot runner dropping focus between scenes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('leaves nothing focused', () => {
    document.body.innerHTML = '<button id="settings-btn" type="button"></button>';
    document.getElementById('settings-btn').focus();
    expect(document.activeElement.id).toBe('settings-btn');

    window.eval(DROP_FOCUS);

    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing when nothing has focus', () => {
    expect(() => window.eval(DROP_FOCUS)).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('runs after the dialogs are closed, as closing one is what hands focus back', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../scripts/visual-snapshots/run.cjs'),
      'utf8'
    );
    const start = source.indexOf('async function restore()');
    const restore = source.slice(start, source.indexOf('\n    }\n', start));
    const close = restore.indexOf('await closeDialogs();');
    const drop = restore.indexOf('await cdp.evaluate(DROP_FOCUS);');

    expect(close).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(close);
  });
});
