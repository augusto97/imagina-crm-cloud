#!/usr/bin/env node
/**
 * v0.1.364 — Refresca `timings.json` (cuánto tarda cada demo) con el log de
 * un release, para que el reparto entre máquinas siga parejo (ver shard.mjs).
 *
 *   node scripts/help-captures/timings.mjs <log-del-release> [...más logs]
 *
 * Lee las líneas «✓ clave · N cuadros · X s» que imprime run.mjs. Las demos
 * que no aparecen en el log conservan su tiempo anterior.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'timings.json');
const logs = process.argv.slice(2);
if (logs.length === 0) {
    console.error('Uso: node scripts/help-captures/timings.mjs <log-del-release> [...]');
    process.exit(2);
}

const timings = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
let found = 0;
for (const file of logs) {
    // eslint-disable-next-line no-control-regex
    const text = readFileSync(file, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
    for (const m of text.matchAll(/✓ ([a-z0-9-]+) · \d+ cuadros? · ([\d.]+) s/g)) {
        timings[m[1]] = Math.round(Number(m[2]) * 10) / 10;
        found++;
    }
}
const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(target, `${JSON.stringify(sorted, null, 4)}\n`);
console.log(`${found} tiempos leídos · ${Object.keys(sorted).length} demos en ${path.relative(process.cwd(), target)}`);
