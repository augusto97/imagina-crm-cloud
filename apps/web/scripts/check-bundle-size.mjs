#!/usr/bin/env node
/**
 * Presupuesto del bundle del front (corre en el CI después del build).
 *
 * Mide, sobre `dist-cloud`, el JavaScript que se baja SIN que nadie lo pida:
 *  - `login`: lo que referencia el HTML de la app y todo lo que eso importa de
 *    forma estática (lo que paga quien abre el login);
 *  - `app`: lo anterior + el chunk `App` y sus imports estáticos (lo que paga
 *    quien entra a una lista).
 * Los `import()` (rutas, diálogos, editores) no cuentan: se bajan a pedido.
 *
 * Por qué: un solo import mal puesto (un botón de la ficha que importaba una
 * pieza del editor de automatizaciones) metió ~110 KB gzip en el arranque sin
 * que ningún test lo notara. Si este chequeo falla, mira qué import estático
 * nuevo arrastra un módulo pesado y cárgalo a pedido (`lazyDialog`,
 * `lazyWithReload`); sube el presupuesto sólo si el peso nuevo es necesario
 * para la primera pantalla.
 *
 * v0.1.465 — subió de 275/820 a 285/830 por Zod 4: la librería de validación
 * que usan los esquemas de `@imagina-base/shared` desde el arranque pesa unos
 * 14 KB gzip más que la 3 (arma cada esquema con todos sus métodos, así que
 * no se recorta). Lo compensa el servidor: una automatización de 14 pasos
 * se valida en 8 µs en vez de 537, la query del listado en 3 en vez de 17, y
 * se fue la excepción de la auditoría de dependencias.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = { login: 285, app: 830 };

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', process.argv[2] ?? 'dist-cloud');
const assets = path.join(dist, 'assets');

const staticImports = (file) => {
    const src = readFileSync(path.join(assets, file), 'utf8');
    const out = new Set();
    for (const m of src.matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) out.add(m[1]);
    return out;
};
const closure = (roots) => {
    const seen = new Set();
    const stack = [...roots];
    while (stack.length > 0) {
        const file = stack.pop();
        if (seen.has(file)) continue;
        seen.add(file);
        stack.push(...staticImports(file));
    }
    return seen;
};
const gzipKb = (files) =>
    Math.round([...files].reduce((sum, f) => sum + gzipSync(readFileSync(path.join(assets, f))).length, 0) / 1024);

const html = readFileSync(path.join(dist, 'cloud', 'index.html'), 'utf8');
const entry = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
const appChunks = readdirSync(assets).filter((f) => /^App-[\w-]+\.js$/.test(f));
if (entry.length === 0 || appChunks.length !== 1) {
    console.error(`No se reconoce el build en ${dist} (entrada: ${entry.length}, chunk App: ${appChunks.length}).`);
    process.exit(1);
}

const measured = { login: gzipKb(closure(entry)), app: gzipKb(closure([...entry, ...appChunks])) };
let failed = false;
for (const [name, kb] of Object.entries(measured)) {
    const ok = kb <= BUDGET_KB[name];
    if (!ok) failed = true;
    console.log(`${ok ? 'ok ' : 'EXCEDIDO'} ${name}: ${kb} KB gzip (presupuesto ${BUDGET_KB[name]})`);
}
if (failed) {
    console.error('El JavaScript inicial superó su presupuesto: ver el comentario de este script.');
    process.exit(1);
}
