/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';

/**
 * Fallback SPA en el dev server (espeja lo que hace Caddy en prod): las
 * navegaciones a rutas de cliente sirven el index del SPA correcto en vez de
 * 404. `/portal/*` → build del portal; el resto (/lists, /settings, …) → cloud.
 * Sólo reescribe requests de navegación HTML; deja pasar assets y vite internals.
 */
function spaFallback(): Plugin {
    return {
        name: 'imagina-spa-fallback',
        configureServer(server) {
            server.middlewares.use((req, _res, next) => {
                const url = req.url ?? '/';
                const accept = req.headers.accept ?? '';
                const isNav = req.method === 'GET' && accept.includes('text/html');
                const isInternal =
                    url.startsWith('/@') ||
                    url.startsWith('/app/') ||
                    url.startsWith('/node_modules/') ||
                    url.includes('.'); // assets con extensión
                if (isNav && !isInternal) {
                    req.url = url.startsWith('/portal')
                        ? '/cloud-portal/index.html'
                        : '/cloud/index.html';
                }
                next();
            });
        },
    };
}

/**
 * Build/dev STANDALONE del SPA cloud de Imagina Base (sin WordPress). El
 * config `vite.config.ts` sigue produciendo el bundle del plugin (WP); este
 * sirve el shell propio (login + workspace + listas + tabla) contra el
 * backend NestJS. En dev proxya `/api` al backend (default :3001).
 *
 * Dev: navegar a http://localhost:5174/cloud/index.html
 */
export default defineConfig({
    // react-draggable (react-grid-layout) referencia process.env en el
    // browser; sin este define el drag de widgets muere con
    // "process is not defined".
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    root: __dirname,
    plugins: [react(), spaFallback()],
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
        // `@imagina-base/shared` compila a CommonJS (lo consume NestJS). En dev
        // lo resuelve optimizeDeps (esbuild); en build de producción Rollup no
        // puede analizar estáticamente sus re-exports `__exportStar`, así que le
        // pedimos al plugin commonjs que transforme también el paquete workspace.
        commonjsOptions: {
            include: [/packages[/\\]shared/, /node_modules/],
            transformMixedEsModules: true,
        },
        rollupOptions: {
            input: {
                cloud: path.resolve(__dirname, 'cloud/index.html'),
                portal: path.resolve(__dirname, 'cloud-portal/index.html'),
            },
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
            // WebSocket del realtime (socket.io) → backend.
            '/socket.io': {
                target: process.env.API_URL ?? 'http://localhost:3001',
                changeOrigin: true,
                ws: true,
            },
        },
    },
});
