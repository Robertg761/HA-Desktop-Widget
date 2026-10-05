/** @jest-environment node */
// The window holds its seasonal art still when Chromium draws it on the CPU; main is what knows.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { isSoftwareRendering } = require('../../src/platform.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function slice(marker, end = '\n}\n') {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf(end, start) + end.length);
}

function loadMain(featureStatus) {
  const listeners = {};
  const context = {
    app: {
      getGPUFeatureStatus: jest.fn(() => {
        if (featureStatus instanceof Error) throw featureStatus;
        return featureStatus;
      }),
      on: (name, listener) => (listeners[name] = listener),
    },
    isSoftwareRendering,
    pushConfigToRenderer: jest.fn(),
  };
  vm.runInNewContext(
    `${slice('function rendersInSoftware()')}\n${slice('let lastSoftwareRendering', '\n});\n')}`,
    context
  );
  return { context, listeners };
}

const ON_GPU = { '2d_canvas': 'enabled', gpu_compositing: 'enabled' };
const ON_CPU = { '2d_canvas': 'unavailable_software', gpu_compositing: 'disabled_software' };

it('tells the window it is drawn on the CPU', () => {
  expect(source).toMatch(/desktopCapabilities = \{[^}]*softwareRendering: rendersInSoftware\(\),/);
  expect(loadMain(ON_CPU).context.rendersInSoftware()).toBe(true);
  expect(loadMain(ON_GPU).context.rendersInSoftware()).toBe(false);
  // An answer Chromium cannot give is not taken as software.
  expect(loadMain(new Error('not ready')).context.rendersInSoftware()).toBe(false);
});

it('sends the config again when the GPU gives up while the app runs, and only then', () => {
  const status = { ...ON_GPU };
  const { context, listeners } = loadMain(status);

  listeners['gpu-info-update']();
  listeners['gpu-info-update']();
  expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);

  Object.assign(status, ON_CPU);
  listeners['gpu-info-update']();
  expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(2);
});
