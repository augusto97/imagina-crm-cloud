// v0.1.390 — Qué capturas se graban en un release y cómo se juntan con las anteriores.
//   node --test scripts/help-captures/plan.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { mergeCaptures } from './merge.mjs';
import { planCaptures, recordedKeys, scenarioFiles } from './plan.mjs';

const FILES = [
    { file: 'formularios.mjs', keys: ['form-crear', 'form-publicar'] },
    { file: 'cobros.mjs', keys: ['cobro-link'] },
    { file: 'vistas.mjs', keys: ['vista-kanban', 'vista-tabla'] },
];

function media(keys, frames = 2) {
    const dir = mkdtempSync(path.join(tmpdir(), 'hc-'));
    for (const k of keys) {
        mkdirSync(path.join(dir, 'demos', k), { recursive: true });
        writeFileSync(path.join(dir, 'demos', k, 'demo.json'), JSON.stringify({ key: k, frames }));
        for (let i = 1; i <= frames; i++) writeFileSync(path.join(dir, 'demos', k, `${i}.webp`), `${k}-${i}`);
    }
    return dir;
}

test('sin cambios en los escenarios no se graba nada: se reutiliza lo anterior', () => {
    const recorded = new Set(FILES.flatMap((f) => f.keys));
    const plan = planCaptures({ files: FILES, recorded, changed: ['apps/web/app/x.tsx', ''], all: false });
    assert.equal(plan.files.length, 0);
    assert.equal(plan.machines, 0);
});

test('se graba sólo el archivo que cambió y el que tiene una demo que falta', () => {
    const recorded = new Set(['form-crear', 'form-publicar', 'vista-kanban', 'vista-tabla']);
    const plan = planCaptures({ files: FILES, recorded, changed: ['scripts/help-captures/scenarios/vistas.mjs'], all: false });
    assert.deepEqual(plan.files, ['cobros.mjs', 'vistas.mjs']);
    assert.equal(plan.demos, 3);
    assert.equal(plan.machines, 1);
});

test('todo de nuevo si se pide o si no hay capturas anteriores; las máquinas crecen con el trabajo', () => {
    const recorded = new Set(FILES.flatMap((f) => f.keys));
    assert.equal(planCaptures({ files: FILES, recorded, changed: [], all: true }).files.length, 3);
    const none = planCaptures({ files: FILES, recorded: null, changed: [], all: false });
    assert.equal(none.files.length, 3);
    const heavy = planCaptures({
        files: FILES,
        recorded: null,
        changed: [],
        all: false,
        timings: { 'form-crear': 400, 'form-publicar': 400, 'cobro-link': 400, 'vista-kanban': 10, 'vista-tabla': 10 },
    });
    assert.equal(heavy.machines, 3, 'nunca más máquinas que archivos');
});

test('juntar: lo grabado ahora reemplaza ENTERA la demo, lo demás sigue y lo que ya no existe se va', () => {
    const base = media(['form-crear', 'form-publicar', 'vieja-demo'], 4);
    const fresh = media(['form-crear'], 2);
    const r = mergeCaptures(base, fresh, new Set(['form-crear', 'form-publicar']));
    assert.deepEqual(r.replaced, ['form-crear']);
    assert.deepEqual(r.removed, ['vieja-demo']);
    assert.equal(r.kept, 1);
    assert.deepEqual(readdirSync(path.join(base, 'demos', 'form-crear')).sort(), ['1.webp', '2.webp', 'demo.json']);
    assert.equal(readFileSync(path.join(base, 'demos', 'form-publicar', '4.webp'), 'utf8'), 'form-publicar-4');
    assert.deepEqual([...recordedKeys(base)].sort(), ['form-crear', 'form-publicar']);
});

test('juntar sin nada grabado deja las anteriores; los escenarios reales tienen claves únicas', async () => {
    const base = media(['form-crear'], 1);
    assert.deepEqual(mergeCaptures(base, null, new Set(['form-crear'])).replaced, []);
    const keys = (await scenarioFiles()).flatMap((f) => f.keys);
    assert.ok(keys.length > 50);
    assert.equal(new Set(keys).size, keys.length);
});
