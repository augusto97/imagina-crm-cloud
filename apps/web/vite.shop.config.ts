import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * v0.1.412 (ADR-S103) — El script de la tienda pública. Igual que el del
 * formulario y el widget: UN archivo IIFE sin imports
 * (`dist-cloud/public-shop/shop.js`) que el API sirve EN LÍNEA con la CSP por
 * hash. De shared sólo importa la lógica pura (sin zod).
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
        outDir: path.resolve(__dirname, 'dist-cloud/public-shop'),
        emptyOutDir: true,
        copyPublicDir: false,
        minify: 'esbuild',
        sourcemap: false,
        lib: {
            entry: path.resolve(__dirname, 'app/public-shop/main.ts'),
            formats: ['iife'],
            name: 'ImaginaShop',
            fileName: () => 'shop.js',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
    },
});
