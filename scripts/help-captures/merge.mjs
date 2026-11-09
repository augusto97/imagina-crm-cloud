#!/usr/bin/env node
/**
 * v0.1.390 — Junta las capturas recién grabadas con las de la versión anterior.
 *
 * Cada demo grabada ahora reemplaza ENTERA a la anterior (sus cuadros pueden
 * ser menos y no deben quedar restos); las que no se grabaron siguen como
 * estaban; las demos que ya no existen en los escenarios se borran. Al final
 * rehace `demos.json`.
 *
 *   node scripts/help-captures/merge.mjs <capturas-del-release> [<recién-grabadas>]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeManifest } from './manifest.mjs';
import { scenarioFiles } from './plan.mjs';

/**
 * @param {string} base carpeta final (parte de las capturas anteriores)
 * @param {string | null} fresh lo que se grabó en este release
 * @param {Set<string>} defined claves de las demos que existen hoy
 * @returns {{ replaced: string[], kept: number, removed: string[] }}
 */
export function mergeCaptures(base, fresh, defined) {
    const baseDemos = path.join(base, 'demos');
    mkdirSync(baseDemos, { recursive: true });
    const replaced = [];
    const freshDemos = fresh ? path.join(fresh, 'demos') : null;
    if (freshDemos && existsSync(freshDemos)) {
        for (const key of readdirSync(freshDemos)) {
            if (!existsSync(path.join(freshDemos, key, 'demo.json'))) continue;
            rmSync(path.join(baseDemos, key), { recursive: true, force: true });
            cpSync(path.join(freshDemos, key), path.join(baseDemos, key), { recursive: true });
            replaced.push(key);
        }
    }
    const removed = [];
    for (const key of readdirSync(baseDemos)) {
        if (!defined.has(key)) {
            rmSync(path.join(baseDemos, key), { recursive: true, force: true });
            removed.push(key);
        }
    }
    return { replaced: replaced.sort(), kept: readdirSync(baseDemos).length - replaced.length, removed: removed.sort() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [base, fresh] = process.argv.slice(2);
    if (!base) {
        console.error('Uso: node scripts/help-captures/merge.mjs <capturas-del-release> [<recién-grabadas>]');
        process.exit(2);
    }
    const defined = new Set((await scenarioFiles()).flatMap((f) => f.keys));
    const r = mergeCaptures(base, fresh ?? null, defined);
    const total = writeManifest(base);
    console.log(`capturas: ${r.replaced.length} grabadas ahora, ${r.kept} de la versión anterior, ${r.removed.length} quitadas · ${total} en total`);
}
