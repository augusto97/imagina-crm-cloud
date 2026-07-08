/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';

/**
 * Build/dev STANDALONE del SPA cloud de Imagina Base (sin WordPress). El
 * config `vite.config.ts` sigue produciendo el bundle del plugin (WP); este
 * sirve el shell propio (login + workspace + listas + tabla) contra el
 * backend NestJS. En dev proxya `/api` al backend (default :3001).
 *
 * Dev: navegar a http://localhost:5174/cloud/index.html
 */
export default defineConfig({
    root: __dirname,
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './app'),
        },
        dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    },
    optimizeDeps: {
        // shared compila a CommonJS (lo consume el backend NestJS). Forzamos
        // el pre-bundle con esbuild para exponer sus named exports al browser.
        include: ['@imagina-base/shared'],
    },
    css: {
        // No hay postcss.config en el repo; configuramos Tailwind + autoprefixer
        // inline para el build cloud (aislado del pipeline WP). Tailwind toma
        // tailwind.config.ts (content incluye ./app/**, cubre app/cloud/**).
        postcss: {
            plugins: [tailwindcss(), autoprefixer()],
        },
    },
    build: {
        target: 'es2020',
        outDir: path.resolve(__dirname, 'dist-cloud'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'cloud/index.html'),
        },
    },
    server: {
        port: 5174,
        strictPort: true,
        proxy: {
            '/api': {
                target: process.env.API_URL ?? 'http://localhost:3001',
                changeOrigin: true,
            },
        },
    },
});
