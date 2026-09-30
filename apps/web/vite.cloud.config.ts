/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';
import { EMBED_FRAME_HOSTS } from '@imagina-base/shared';

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
                    // v0.1.199: lo que se PROXYA al backend nunca es del SPA.
                    // Este middleware corre ANTES del proxy de vite, así que
                    // sin esto una NAVEGACIÓN del navegador a un endpoint del
                    // API —el callback de OAuth, la página de una lista
                    // pública— recibía el index del SPA en vez de la respuesta
                    // del backend. En producción no pasa porque nginx y Caddy
                    // enrutan `/api/*` antes del fallback.
                    url.startsWith('/api/') ||
                    url.startsWith('/.well-known/') ||
                    url.startsWith('/socket.io/') ||
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
 * v0.1.227 — CSP del SPA dentro del propio HTML (`<meta http-equiv>`).
 *
 * Hasta acá la CSP sólo existía si el operador copiaba las cabeceras de
 * `deploy/nginx.conf`/`Caddyfile` a su servidor — y la auto-actualización no
 * toca el proxy (es de root). En un panel tipo ServerAvatar, donde se pegan
 * sólo los `location`, quedaba afuera. Ahora viaja en el bundle: cada release
 * la trae. Si el proxy TAMBIÉN manda la suya, el navegador aplica las dos
 * (la intersección) — no se contradicen.
 *
 * Lo que un `<meta>` NO puede: `frame-ancestors` (el navegador lo ignora ahí)
 * — el anti-encuadre lo cubre `lib/frameGuard.ts` en el cliente.
 *
 * `img-src https:`: los bloques de imagen del page-builder (ficha y portal)
 * aceptan una URL externa y no pasan por el proxy de imágenes (el portal no
 * tiene sesión de miembro). Una imagen no ejecuta nada; lo que importa acá es
 * que ningún SCRIPT de otro origen pueda cargarse.
 */
export const SPA_CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-src 'self' ${EMBED_FRAME_HOSTS.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ');

function cspMeta(): Plugin {
    return {
        name: 'imagina-csp-meta',
        // Sólo en el build: el dev server de vite inyecta scripts y un
        // WebSocket de HMR que esta política cortaría.
        apply: 'build',
        transformIndexHtml(html) {
            const meta = `<meta http-equiv="Content-Security-Policy" content="${SPA_CSP}" />`;
            // Después del charset (tiene que quedar en los primeros 1024 bytes)
            // y ANTES de cualquier <script>: una CSP por meta sólo rige para lo
            // que viene después de ella en el documento.
            const out = html.replace(/(<meta charset="utf-8"\s*\/?>)/i, `$1\n        ${meta}`);
            if (out === html) throw new Error('imagina-csp-meta: el index.html no tiene <meta charset>');
            return out;
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
    plugins: [react(), spaFallback(), cspMeta()],
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
            output: {
                /**
                 * v0.1.115 — Vendor chunks estables.
                 *
                 * Sin esto, React + TanStack + Radix viajan DENTRO del bundle
                 * de la app: cada auto-actualización cambia el hash de todo y
                 * el navegador se re-descarga ~330 KB gzip aunque las
                 * dependencias no hayan cambiado. Separadas, sólo se invalida
                 * el chunk de la app y el resto sale del cache del navegador.
                 */
                manualChunks: (id: string) => {
                    // v0.1.175 — el catálogo de iconos (324 paths, ~45 KB gz)
                    // cambia con los releases MUCHO menos que la app: en su
                    // propio chunk sobrevive a los deploys, como los vendors.
                    if (id.includes('listIconPaths.generated')) return 'icon-catalog';
                    if (!id.includes('node_modules')) return undefined;
                    if (/[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/.test(id)) {
                        return 'vendor-react';
                    }
                    if (id.includes('@tanstack')) return 'vendor-query';
                    if (id.includes('@radix-ui')) return 'vendor-radix';
                    if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
                    return undefined;
                },
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
                // X-Forwarded-Host/Proto (v0.1.184): el servidor OAuth deriva su
                // issuer del host público de la request — en dev es vite, no :3001.
                xfwd: true,
            },
            // Metadata de descubrimiento OAuth (RFC 8414/9728) en la raíz del host.
            '/.well-known': {
                target: process.env.API_URL ?? 'http://localhost:3001',
                changeOrigin: true,
                xfwd: true,
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
