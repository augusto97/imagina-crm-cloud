import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * v0.1.394 (ADR-S99) — El script del widget de contacto (la página que
 * `embed.js` pone en la esquina del sitio). Igual que el del formulario: UN
 * archivo IIFE sin imports (`dist-cloud/public-widget/widget.js`) que el API
 * sirve EN LÍNEA con la CSP por hash. Sólo importa TIPOS de shared.
 *
 * Corre después del build de la app; sólo vacía su propia carpeta.
 */
export default defineConfig({
    root: __dirname,
    resolve: {
        alias: [{ find: '@', replacement: path.resolve(__dirname, './app') }],
    },
    build: {
        target: 'es2019',
        outDir: path.resolve(__dirname, 'dist-cloud/public-widget'),
        emptyOutDir: true,
        copyPublicDir: false,
        minify: 'esbuild',
        sourcemap: false,
        lib: {
            entry: path.resolve(__dirname, 'app/public-widget/main.ts'),
            formats: ['iife'],
            name: 'ImaginaWidget',
            fileName: () => 'widget.js',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
    },
});
