import { defineConfig } from 'vitest/config';

// Testcontainers gestiona Postgres/Redis reales. Deshabilitamos el reaper
// "Ryuk" (contenedor privilegiado que no aporta en runners efímeros y no
// siempre se puede descargar): la limpieza la hace el `stop()` de cada suite
// y el entorno efímero de CI. Se setea acá para no depender de env externas
// (turbo filtra las no declaradas).
process.env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';

export default defineConfig({
    test: {
        include: ['test/**/*.spec.ts'],
        env: {
            TESTCONTAINERS_RYUK_DISABLED: 'true',
        },
        // Testcontainers levanta Postgres/Redis reales: timeouts generosos.
        testTimeout: 120_000,
        hookTimeout: 240_000,
        pool: 'forks',
        // Cada archivo de test levanta su propio Postgres/Redis. Corremos los
        // archivos en SERIE para no saturar el daemon (varios contenedores a
        // la vez timeoutean bajo carga, p.ej. cuando turbo corre build+test
        // en paralelo). Determinístico > rápido para tests de integración.
        fileParallelism: false,
    },
});
