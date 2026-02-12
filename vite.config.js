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
            emptyOutDir: true,
            rollupOptions: {
                input: resolve(__dirname, 'renderer.js'),
                output: {
                    entryFileNames: 'renderer.bundle.js',
                    chunkFileNames: 'chunks/[name]-[hash].js',
                    manualChunks: (id) => {
                        if (!id.includes('node_modules')) return null;
                        if (id.includes('hls.js')) return 'vendor-hls';
                        if (id.includes('sortablejs')) return 'vendor-sortable';
                        if (id.includes('regenerate-unicode-properties')) return 'vendor-emoji';
                        return 'vendor';
                    },
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
                // Use the lighter HLS build in renderer bundles.
                'hls.js': 'hls.js/dist/hls.light.mjs',
            },
        },
    };
});
