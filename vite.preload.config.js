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
    // Both preload.js and the API module are CommonJS, and Vite's CJS interop only covers
    // node_modules by default — without this the `require('./src/preload-api.cjs')` survives into
    // the bundle and we are back to the same runtime failure.
    commonjsOptions: {
      include: [/preload\.js$/, /preload-api\.cjs$/, /node_modules/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: resolve(__dirname, 'preload.js'),
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
      },
    },
  },
});
