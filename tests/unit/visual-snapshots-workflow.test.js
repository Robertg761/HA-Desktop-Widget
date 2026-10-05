/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
});
