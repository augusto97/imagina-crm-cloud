import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * v0.1.351 (ADR-S94) — El script de la página pública de un formulario.
 *
 * Se compila APARTE del resto de la app, a UN archivo IIFE sin imports
 * (`dist-cloud/public-form/form.js`), porque el API lo sirve EN LÍNEA dentro
 * del HTML con el nonce de la CSP: quien abre un formulario —casi siempre
 * una sola vez— recibe todo en un solo viaje, sin esperar otro archivo.
 * Importa de shared sólo la lógica pura (`form-logic`, sin Zod): pesa poco.
 *
 * Corre DESPUÉS del build de la app (que vacía `dist-cloud`); sólo vacía su
 * propia carpeta.
 */
export default defineConfig({
    root: __dirname,
    resolve: {
        alias: [{ find: '@', replacement: path.resolve(__dirname, './app') }],
    },
    build: {
        target: 'es2019',
        outDir: path.resolve(__dirname, 'dist-cloud/public-form'),
        emptyOutDir: true,
        copyPublicDir: false,
        minify: 'esbuild',
        sourcemap: false,
        lib: {
            entry: path.resolve(__dirname, 'app/public-form/main.ts'),
            formats: ['iife'],
            name: 'ImaginaForm',
            fileName: () => 'form.js',
        },
        rollupOptions: { output: { inlineDynamicImports: true } },
    },
});
