import { defineConfig } from 'vite';
import { resolve } from 'path';

// Preload scripts are SANDBOXED by default in Electron, and a sandboxed preload's `require` is a
// small polyfill: it resolves `electron` and a few Node built-ins, but it cannot load a file from
// disk. So `preload.js` requiring `./src/preload-api.cjs` fails at runtime with
// "module not found", the contextBridge never runs, and the renderer gets no `window.electronAPI`.
//
// Bundling the preload into one self-contained file fixes that without weakening the sandbox and
// without inlining the API factory back into preload.js (it stays its own unit-tested module).
// `electron` is left external because the sandbox polyfill *can* resolve that one.
export default defineConfig({
  build: {
    outDir: 'dist-preload',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    // A preload runs in Node, not the browser: don't inject browser polyfills or a module preload.
    ssr: true,
    // Both preload.js and the API module are CommonJS. Rolldown bundles CommonJS itself, so the
    // `require('./src/preload-api.cjs')` is inlined and only `electron` is left to the sandbox.
    rolldownOptions: {
      input: resolve(__dirname, 'preload.js'),
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
        // Neither source file says "use strict", and Rolldown only emits it when one does; keep the
        // preload in strict mode as the Rollup build had it.
        strict: true,
      },
    },
  },
});
