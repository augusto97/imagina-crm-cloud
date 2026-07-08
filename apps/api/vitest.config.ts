import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        // Testcontainers levanta Postgres/Redis reales: timeouts generosos.
        testTimeout: 120_000,
        hookTimeout: 240_000,
        pool: 'forks',
    },
});
