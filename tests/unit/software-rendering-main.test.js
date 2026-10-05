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
    `${slice('let gpuInfoReported')}\n${slice('let lastSoftwareRendering', '\n});\n')}`,
    context
  );
  return { context, listeners };
}

const ON_GPU = { '2d_canvas': 'enabled', gpu_compositing: 'enabled' };
const ON_CPU = { '2d_canvas': 'unavailable_software', gpu_compositing: 'disabled_software' };

it('tells the window it is drawn on the CPU, once Chromium has looked at the GPU', () => {
  expect(source).toMatch(/desktopCapabilities = \{[^}]*softwareRendering: rendersInSoftware\(\),/);
  const cpu = loadMain(ON_CPU);
  cpu.listeners['gpu-info-update']();
  expect(cpu.context.rendersInSoftware()).toBe(true);
  const gpu = loadMain(ON_GPU);
  gpu.listeners['gpu-info-update']();
  expect(gpu.context.rendersInSoftware()).toBe(false);
  // An answer Chromium cannot give is not taken as software.
  const broken = loadMain(new Error('not ready'));
  broken.listeners['gpu-info-update']();
  expect(broken.context.rendersInSoftware()).toBe(false);
});

// Before its first gpu-info-update Chromium reports every feature as disabled_software on any
// machine (measured with Electron 43: at ready, then "enabled" about half a second later on a GPU).
it('does not take the report from before Chromium has looked as software', () => {
  const status = { ...ON_CPU };
  const { context, listeners } = loadMain(status);
  expect(context.rendersInSoftware()).toBe(false);

  Object.assign(status, ON_GPU);
  listeners['gpu-info-update']();
  expect(context.rendersInSoftware()).toBe(false);
  expect(context.pushConfigToRenderer).not.toHaveBeenCalled();
});

it('sends the config when Chromium first finds no GPU, and when the GPU gives up later', () => {
  const cpu = loadMain(ON_CPU);
  expect(cpu.context.rendersInSoftware()).toBe(false);
  cpu.listeners['gpu-info-update']();
  expect(cpu.context.rendersInSoftware()).toBe(true);
  expect(cpu.context.pushConfigToRenderer).toHaveBeenCalledTimes(1);

  const status = { ...ON_GPU };
  const gpu = loadMain(status);
  gpu.listeners['gpu-info-update']();
  gpu.listeners['gpu-info-update']();
  expect(gpu.context.pushConfigToRenderer).not.toHaveBeenCalled();

  Object.assign(status, ON_CPU);
  gpu.listeners['gpu-info-update']();
  gpu.listeners['gpu-info-update']();
  expect(gpu.context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
});
