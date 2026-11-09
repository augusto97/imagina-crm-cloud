#!/usr/bin/env node
/**
 * v0.1.390 — Qué capturas del centro de aprendizaje hay que grabar en un release.
 *
 * Grabarlas TODAS en cada versión tardaba ~10 minutos aunque el cambio no
 * tocara ninguna pantalla. Ahora el release parte de las capturas de la
 * versión anterior (vienen dentro de su paquete) y graba sólo:
 *   - los archivos de escenarios que cambiaron desde esa versión, y
 *   - los que tienen alguna demo que falta (nueva, o que falló la última vez).
 * Todo de nuevo sólo si se pide (`--all`: el input del workflow o
 * «[capturas]» en el mensaje del commit) o si no hay capturas anteriores.
 *
 * Para regrabar UN módulo a propósito (porque su pantalla cambió), alcanza con
 * tocar su archivo de escenarios.
 *
 *   node scripts/help-captures/plan.mjs --prev <capturas-anteriores> \
 *        [--changed a.mjs,b.mjs] [--all] [--github-output $GITHUB_OUTPUT]
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DEFAULT_SECONDS } from './shard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Cuánto trabajo se le da a cada máquina (además de ~3 min de arranque). */
export const SECONDS_PER_MACHINE = 180;
export const MAX_MACHINES = 5;

/** Los archivos de escenarios con las claves de sus demos. */
export async function scenarioFiles(dir = path.join(here, 'scenarios')) {
    const out = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
        const mod = await import(pathToFileURL(path.join(dir, f)).href);
        const list = (Array.isArray(mod.default) ? mod.default : [mod.default]).filter(Boolean);
        out.push({ file: f, keys: list.map((s) => s.key) });
    }
    return out;
}

/** Las demos que ya están grabadas en una carpeta de capturas. */
export function recordedKeys(mediaDir) {
    const base = mediaDir ? path.join(mediaDir, 'demos') : null;
    if (!base || !existsSync(base)) return null;
    return new Set(readdirSync(base).filter((k) => existsSync(path.join(base, k, 'demo.json'))));
}

/**
 * @param {{ files: Array<{file: string, keys: string[]}>, recorded: Set<string> | null,
 *           changed: string[], all: boolean, timings?: Record<string, number> }} input
 */
export function planCaptures({ files, recorded, changed, all, timings = {} }) {
    const changedNames = new Set(changed.map((c) => path.basename(c.trim())).filter(Boolean));
    let reason;
    let picked;
    if (all || recorded === null) {
        reason = all ? 'todas (pedido)' : 'todas (no hay capturas anteriores)';
        picked = files;
    } else {
        picked = files.filter((f) => changedNames.has(f.file) || f.keys.some((k) => !recorded.has(k)));
        reason = picked.length === 0 ? 'ninguna: se reutilizan las de la versión anterior' : 'sólo lo que cambió o falta';
    }
    const seconds = picked.reduce(
        (s, f) => s + f.keys.reduce((t, k) => t + (Number(timings[k]) > 0 ? Number(timings[k]) : DEFAULT_SECONDS), 0),
        0,
    );
    const machines = picked.length === 0 ? 0 : Math.max(1, Math.min(MAX_MACHINES, Math.ceil(seconds / SECONDS_PER_MACHINE), picked.length));
    const defined = new Set(files.flatMap((f) => f.keys));
    const stale = recorded ? [...recorded].filter((k) => !defined.has(k)).sort() : [];
    return { reason, files: picked.map((f) => f.file), demos: picked.reduce((n, f) => n + f.keys.length, 0), seconds: Math.round(seconds), machines, stale };
}

function arg(name, def = '') {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? (process.argv[i + 1] ?? def) : def;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = await scenarioFiles();
    let timings = {};
    try {
        timings = JSON.parse(readFileSync(path.join(here, 'timings.json'), 'utf8'));
    } catch {
        /* sin tiempos: cada demo pesa lo de siempre */
    }
    const plan = planCaptures({
        files,
        recorded: recordedKeys(arg('prev')),
        changed: arg('changed').split(','),
        all: process.argv.includes('--all'),
        timings,
    });
    console.log(`capturas: ${plan.reason} · ${plan.demos} demos en ${plan.files.length} archivos · ~${plan.seconds}s · ${plan.machines} máquinas`);
    if (plan.files.length > 0) console.log(`  ${plan.files.join(', ')}`);
    const out = arg('github-output');
    if (out) {
        const machines = Math.max(1, plan.machines);
        appendFileSync(
            out,
            [
                `record=${plan.files.length > 0}`,
                `files=${plan.files.length === files.length ? '' : plan.files.join(',')}`,
                `shards=${JSON.stringify(Array.from({ length: machines }, (_, i) => i + 1))}`,
                `shard_total=${machines}`,
                '',
            ].join('\n'),
        );
    }
}
