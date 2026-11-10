#!/usr/bin/env node
/**
 * v0.1.399 — Revisa que Nest pueda inyectar todo lo que piden los
 * constructores. Carga el build (`dist/app.module.js`) en el mismo orden que
 * el arranque real y busca parámetros cuyo tipo quedó `undefined` al decorar
 * la clase: pasa cuando dos archivos se importan en ciclo y la clase todavía
 * no existía. Con `@Optional()` Nest no se queja y simplemente inyecta
 * `undefined` — así «Probar» de las automatizaciones quedó sin motor desde la
 * v0.1.371 sin que ninguna prueba lo notara (las pruebas arman los servicios a
 * mano). La salida: `@Inject(forwardRef(() => Clase))` o romper el ciclo.
 *
 * Uso: `pnpm --filter @imagina-base/api build && node apps/api/scripts/check-di.cjs`
 */
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist') + path.sep;
require(require.resolve('reflect-metadata', { paths: [root] }));
require(path.join(root, 'dist', 'app.module.js'));

const problems = [];
for (const [file, mod] of Object.entries(require.cache)) {
    if (!file.startsWith(dist)) continue;
    for (const [name, value] of Object.entries(mod.exports ?? {})) {
        if (typeof value !== 'function') continue;
        const types = Reflect.getMetadata('design:paramtypes', value);
        if (!Array.isArray(types)) continue;
        // Los que llevan `@Inject(token)` (también forwardRef) no usan el tipo.
        const explicit = new Set((Reflect.getMetadata('self:paramtypes', value) ?? []).map((d) => d.index));
        types.forEach((t, i) => {
            if (t === undefined && !explicit.has(i)) problems.push(`${path.relative(root, file)} · ${name} · parámetro #${i}`);
        });
    }
}

if (problems.length > 0) {
    console.error('Parámetros de constructor que Nest no puede resolver (ciclo de imports):');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Usa @Inject(forwardRef(() => Clase)) o rompe el ciclo.');
    process.exit(1);
}
console.log('Inyección de dependencias: sin parámetros sin resolver.');
