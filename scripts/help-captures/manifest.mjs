#!/usr/bin/env node
/**
 * Índice de las capturas del centro de aprendizaje (ADR-S75).
 *
 * Cada demo deja su `demos/<clave>/demo.json`; `demos.json` los junta. Lo usa
 * `run.mjs` tras cada demo y el release al juntar lo que grabó cada máquina
 * (v0.1.364: las capturas se reparten en varias a la vez):
 *
 *   node scripts/help-captures/manifest.mjs apps/web/dist-cloud/help-media
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/** Tamaño de la ventana con que se graba (el reproductor escala los rectángulos). */
export const VIEWPORT = { width: 1100, height: 700 };

/** Junta los `demos/<clave>/demo.json` en un solo índice. */
export function buildManifest(out) {
    const demos = {};
    const base = path.join(out, 'demos');
    if (existsSync(base)) {
        for (const key of readdirSync(base).sort()) {
            const f = path.join(base, key, 'demo.json');
            if (existsSync(f)) demos[key] = JSON.parse(readFileSync(f, 'utf8'));
        }
    }
    return { generated_at: new Date().toISOString(), version: readFileSync(path.join(root, 'VERSION'), 'utf8').trim(), viewport: VIEWPORT, demos };
}

/** Rehace `demos.json` y devuelve cuántas demos quedaron. */
export function writeManifest(out) {
    const manifest = buildManifest(out);
    writeFileSync(path.join(out, 'demos.json'), JSON.stringify(manifest));
    return Object.keys(manifest.demos).length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const out = process.argv[2];
    if (!out) {
        console.error('Uso: node scripts/help-captures/manifest.mjs <carpeta-de-capturas>');
        process.exit(2);
    }
    if (!existsSync(path.join(out, 'demos'))) {
        console.log(`sin capturas en ${out}`);
        process.exit(0);
    }
    console.log(`${writeManifest(out)} demos en ${out}`);
}
