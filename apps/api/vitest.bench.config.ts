import { defineConfig } from 'vitest/config';

// Config aparte para los benchmarks de rendimiento (STANDALONE §13). No corren
// en el `test` normal: siembran 100k records y miden latencias, así que sólo se
// invocan con `pnpm bench`. Reaper de Testcontainers deshabilitado igual que en
// la suite (runners efímeros).
process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';

export default defineConfig({
    test: {
        include: ['bench/**/*.bench.ts'],
        env: { TESTCONTAINERS_RYUK_DISABLED: 'true' },
        testTimeout: 600_000,
        hookTimeout: 600_000,
        pool: 'forks',
        fileParallelism: false,
    },
});
