/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { WINDOW_POSITION } = require('../../scripts/visual-snapshots/fixture.cjs');

// The workflow photographs the app on each OS. A capture is only worth reviewing if the runner can
// draw its text and nothing of the runner's own sits in the picture.
describe('the visual snapshot workflow', () => {
  const workflow = yaml.load(
    fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/visual-snapshots.yml'), 'utf8')
  );
  const steps = workflow.jobs.snapshots.steps;
  const order = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  // The image has no Devanagari font and the app bundles none, so every Hindi string was boxes.
  it('installs a Devanagari font on Linux before the snapshots', () => {
    const install = steps.find(
      (step) => step.if === "runner.os == 'Linux'" && /apt-get install/.test(step.run)
    );
    expect(install.run).toMatch(/\bfonts-noto-core\b/);
    expect(order(install.name)).toBeLessThan(order('Take snapshots (Linux)'));
  });

  // The agent's console covered the Windows 11 pin captures, and the pointer, resting where the
  // widget opens, left a tile's native tooltip in the first capture.
  it('minimizes the open windows and parks the pointer before the Windows snapshots', () => {
    const clear = steps[order('Clear the desktop (Windows)')];
    expect(clear.if).toBe("runner.os == 'Windows'");
    expect(clear.run).toContain('ShowWindow($_.MainWindowHandle, 6)');
    expect(clear.run).toContain('SetCursorPos(0, 0)');
    // After the Windows 11 first-run windows are closed, and before anything is captured.
    expect(order('Close first-run windows (Windows 11)')).toBeLessThan(
      order('Clear the desktop (Windows)')
    );
    expect(order('Clear the desktop (Windows)')).toBeLessThan(
      order('Take snapshots (Windows, macOS)')
    );
    // The top-left corner is clear of the widget and the 32 px margin its screen capture takes.
    expect(WINDOW_POSITION.x - 32).toBeGreaterThan(32);
  });
});
