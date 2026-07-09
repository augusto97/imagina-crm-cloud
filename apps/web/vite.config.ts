/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { v4wp } from '@kucrut/vite-for-wp';
import path from 'node:path';

export default defineConfig({
    plugins: [
        // El plugin `v4wp` produce el `dist/manifest.json` que el
        // PHP `AdminAssets` lee para resolver el bundle del admin SPA.
        // Le pasamos AMBOS entry points (admin + público) para que el
        // manifest los liste juntos y el PHP los resuelva por nombre.
        // El bundle público (`app/public.tsx`) se enqueuea aparte
        // desde `PublicAssets` con un path directo, sin pasar por el
        // manifest — pero igual queremos que Vite lo procese en el
        // mismo build pipeline.
        v4wp({
            input: ['app/main.tsx', 'app/public.tsx', 'app/portal.tsx'],
            outDir: 'dist',
        }),
        react(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './app'),
        },
        // Garantiza una sola copia de cada dep con CONTEXT (React,
        // React-Query) en el bundle, incluso a través de deps transitivas
        // de @xyflow/react / @tanstack que también las listan como peer.
        //
        // Sin esto, Vite puede bundlear copias locales en chunks lazy:
        // - React → "Invalid hook call (#321)" cuando los hooks de React
        //   Flow corren contra un React distinto del Provider del SPA.
        // - React-Query → "No QueryClient set, use QueryClientProvider"
        //   cuando un useQuery del chunk lazy busca el provider en su
        //   propia copia (que jamás fue inicializado).
        dedupe: ['react', 'react-dom', '@tanstack/react-query'],
    },
    optimizeDeps: {
        // Pre-bundlea estas deps en un solo paquete consistente — evita
        // que cada chunk lazy resuelva su propia copia.
        //
        // `@imagina-base/shared` compila a CommonJS (lo consume el backend
        // NestJS); forzamos su pre-bundle con esbuild para exponer sus named
        // exports al bundle del admin (mismo tratamiento que vite.cloud.config).
        include: [
            'react',
            'react-dom',
            'react/jsx-runtime',
            '@tanstack/react-query',
            '@imagina-base/shared',
        ],
    },
    build: {
        target: 'es2020',
        // `@imagina-base/shared` compila a CommonJS. En build de producción
        // Rollup no puede analizar estáticamente sus re-exports `__exportStar`,
        // así que le pedimos al plugin commonjs que transforme también el
        // paquete workspace (espeja vite.cloud.config.ts).
        commonjsOptions: {
            include: [/packages[/\\]shared/, /node_modules/],
            transformMixedEsModules: true,
        },
        // Sourcemaps SOLO en dev (`vite dev`). En `vite build` van
        // deshabilitados porque (1) duplican el tamaño del bundle
        // (de ~1.6 MB a ~7.5 MB en dist/), y (2) exponen el código
        // fuente original sin ofuscar a cualquiera que inspeccione
        // el browser — innecesario en un release de producción.
        // El dev server de Vite tiene sourcemaps inline por default
        // así que DX no se ve afectada.
        sourcemap: false,
        emptyOutDir: true,
        rollupOptions: {
            output: {
                // React/ReactDOM van a un chunk compartido (`vendor-react`)
                // que tanto el admin SPA como el bundle público importan.
                //
                // Motivo: el bundle público (`app/public.tsx`, Fase 8)
                // debe ser autosuficiente — un visitante del frontend no
                // tiene por qué descargar el bundle del admin completo.
                // Con un chunk vendor común, ambos entries comparten una
                // sola copia de React (single-instance garantizada) y el
                // browser puede cachear `vendor-react.js` entre admin y
                // frontend.
                //
                // TanStack Query va aparte porque solo lo usa el admin
                // (el bundle público hace fetch nativo).
                manualChunks(id) {
                    if (
                        id.includes('node_modules/react/') ||
                        id.includes('node_modules/react-dom/')
                    ) {
                        return 'vendor-react';
                    }
                    if (id.includes('node_modules/@tanstack/react-query/')) {
                        return 'vendor-query';
                    }
                    return undefined;
                },
            },
        },
    },
    server: {
        port: 5173,
        strictPort: true,
        cors: true,
    },
    // Vitest config (Fase 13.A). El runner detecta los specs en
    // `tests/unit/**` automáticamente. `environment: 'jsdom'` permite
    // testear componentes React; los tests puros (resolver, helpers)
    // ignoran DOM via `// @vitest-environment node` per-file si
    // necesitan máxima velocidad.
    test: {
        environment: 'jsdom',
        globals: false,
        setupFiles: ['./tests/unit/setup.ts'],
        include: ['tests/unit/**/*.test.{ts,tsx}'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['app/**/*.{ts,tsx}'],
            exclude: ['app/**/*.test.{ts,tsx}', 'app/**/types.ts'],
        },
    },
});
