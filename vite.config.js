import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Read package.json for version injection
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig(({ mode }) => {
    const isProduction = mode === 'production';

    return {
        build: {
            outDir: 'dist-renderer',
            emptyDirBeforeBuild: true,
            rollupOptions: {
                input: resolve(__dirname, 'renderer.js'),
                output: {
                    entryFileNames: 'renderer.bundle.js',
                    format: 'iife', // Immediately Invoked Function Expression for browser
                    inlineDynamicImports: true, // Bundle dynamic imports inline
                },
            },
            target: 'chrome114', // Electron's Chromium version
            minify: isProduction,
            sourcemap: !isProduction,
        },
        define: {
            // Inject app version at build time
            __APP_VERSION__: JSON.stringify(pkg.version),
        },
        resolve: {
            alias: {
                '@': resolve(__dirname, 'src'),
                // Node.js polyfills for browser
                'events': 'events',
            },
        },
    };
});
