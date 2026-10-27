import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWhatsNewMedia, WHATS_NEW_CATALOG } from '@imagina-base/shared';

import { hasIllustration } from '@/admin/learn/illustrations/registry';

import { SLIDE_MS, wrapIndex } from './WhatsNewVisual';

/** Las capturas que graba el release (las nombra el contenido de Aprende). */
function demoKeys(): Set<string> {
    const dir = path.resolve(__dirname, '../learn/content/modules');
    const keys = new Set<string>();
    for (const f of readdirSync(dir)) {
        const src = readFileSync(path.join(dir, f), 'utf8');
        for (const m of src.matchAll(/'demo'[^}]*?key: '([a-z0-9-]+)'/g)) keys.add(m[1]!);
    }
    return keys;
}

describe('novedades con animación (v0.1.325)', () => {
    it('cada ilustración y captura del catálogo existe en la app', () => {
        const demos = demoKeys();
        expect(demos.size).toBeGreaterThan(20);
        for (const e of WHATS_NEW_CATALOG) {
            const m = readWhatsNewMedia(e.media ?? {});
            for (const key of [m.illustration, ...m.slides.map((s) => s.illustration)]) {
                if (key) expect(hasIllustration(key), `${e.key}: ilustración «${key}» no existe`).toBe(true);
            }
            for (const key of [m.demo, ...m.slides.map((s) => s.demo)]) {
                if (key) expect(demos.has(key), `${e.key}: captura «${key}» no existe`).toBe(true);
            }
        }
    });

    it('el carrusel da la vuelta en los dos sentidos y no corre muy rápido', () => {
        expect(wrapIndex(3, 3)).toBe(0);
        expect(wrapIndex(-1, 3)).toBe(2);
        expect(wrapIndex(5, 0)).toBe(0);
        expect(SLIDE_MS).toBeGreaterThanOrEqual(5000);
    });
});
