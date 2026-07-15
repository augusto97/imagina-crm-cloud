import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Config mínima para los tests de lógica del front (hooks/helpers puros).
// Sólo necesita el alias `@` (el mismo de vite.cloud.config.ts).
export default defineConfig({
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './app'),
        },
    },
    test: {
        include: ['app/**/*.{test,spec}.{ts,tsx}'],
        environment: 'node',
    },
});
