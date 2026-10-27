import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_IDS, type Capability } from '@imagina-base/shared';

import { resolveSteps } from '../tour/resolve';
import type { TourContext } from '../tour/tourTypes';
import { TOURS, tourById } from './tours';

/**
 * Contra la rotura: cada elemento que señala un recorrido tiene que existir
 * en el código como `data-tour="…"` (o como `tour="…"` de un componente que
 * lo pasa a `data-tour`). Si alguien renombra o borra un ancla, este test lo
 * dice antes de que un recorrido se salte pasos en silencio.
 */
const APP_DIR = resolve(__dirname, '../../..');

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === 'node_modules') continue;
            sourceFiles(full, out);
        } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

function anchorsInSource(): Set<string> {
    const found = new Set<string>();
    for (const file of sourceFiles(APP_DIR)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('tour')) continue;
        // data-tour="x" y la prop `tour="x"` de RailItem/FlowCard/RowButton.
        for (const m of src.matchAll(/\b(?:data-tour|tour)="([a-z0-9-]+)"/g)) found.add(m[1]!);
        // data-tour={cond ? 'x' : 'y'}
        for (const m of src.matchAll(/\bdata-tour=\{([^}]*)\}/g)) {
            for (const s of m[1]!.matchAll(/'([a-z0-9-]+)'/g)) found.add(s[1]!);
        }
    }
    return found;
}

const ADMIN_CAPS = new Set<Capability>([
    'access_admin',
    'manage_lists',
    'create_records',
    'import_records',
    'export_records',
    'manage_automations',
    'manage_dashboards',
    'view_dashboards',
    'manage_forms',
    'use_ai_assistant',
]);

function ctx(over: Partial<TourContext> = {}): TourContext {
    const caps = ADMIN_CAPS;
    return {
        can: (c) => caps.has(c),
        role: 'admin',
        isAdmin: true,
        isSuperadmin: false,
        isMobile: false,
        firstList: { slug: 'clientes', name: 'Clientes' },
        listCount: 3,
        appName: 'la app',
        canInstall: true,
        ...over,
    };
}

describe('recorridos', () => {
    const anchors = anchorsInSource();

    it('cada elemento señalado existe como data-tour en el código', () => {
        expect(anchors.size).toBeGreaterThan(20);
        for (const tour of TOURS) {
            for (const step of tour.steps) {
                if (step.target) expect(anchors.has(step.target), `${tour.id}/${step.id} → ${step.target}`).toBe(true);
                if (step.mobile && step.mobile !== 'skip' && step.mobile.target) {
                    expect(anchors.has(step.mobile.target), `${tour.id}/${step.id} (celular) → ${step.mobile.target}`).toBe(true);
                }
            }
        }
    });

    it('las anclas siguen la convención <área>-<cosa>', () => {
        for (const a of anchors) expect(a, a).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
    });

    it('implementa los ids canónicos del contrato, sin repetidos', () => {
        const ids = TOURS.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(TOUR_IDS as readonly string[]).toContain(id);
        for (const id of TOUR_IDS) expect(tourById(id), id).toBeDefined();
    });

    it('pasos con id único y textos cortos, en español neutro y sin la marca', () => {
        const voseo = /\b(tenés|podés|querés|elegí|hacé|tocá|abrí|escribí|andá|vení|fijate|acá|vos|mirá|probá)\b/i;
        for (const tour of TOURS) {
            const stepIds = tour.steps.map((s) => s.id);
            expect(new Set(stepIds).size, tour.id).toBe(stepIds.length);
            expect(tour.steps.length, tour.id).toBeGreaterThan(0);
            for (const s of tour.steps) {
                const texts = [s.title, s.body];
                if (s.mobile && s.mobile !== 'skip') texts.push(s.mobile.title ?? '', s.mobile.body ?? '');
                for (const t of texts) {
                    expect(voseo.test(t), `${tour.id}/${s.id}: ${t}`).toBe(false);
                    expect(/imagina/i.test(t), `${tour.id}/${s.id}`).toBe(false);
                }
                expect(s.body.length, `${tour.id}/${s.id}`).toBeLessThanOrEqual(240);
                // Un paso de «haz clic» necesita algo para hacer clic.
                if (s.advanceOn === 'click') expect(s.target, `${tour.id}/${s.id}`).toBeTruthy();
            }
        }
    });

    it('el de bienvenida tiene entre 8 y 15 pasos y se adapta al rol', () => {
        const welcome = tourById('welcome')!;
        const admin = resolveSteps(welcome, ctx()).map((s) => s.id);
        const agentCaps = new Set<Capability>(['access_admin', 'create_records', 'view_dashboards']);
        const agent = resolveSteps(welcome, ctx({ role: 'agent', isAdmin: false, can: (c) => agentCaps.has(c) })).map((s) => s.id);
        expect(admin.length).toBeGreaterThanOrEqual(8);
        expect(admin.length).toBeLessThanOrEqual(15);
        expect(admin).toContain('automations');
        expect(admin).toContain('settings-admin');
        expect(agent).not.toContain('automations');
        expect(agent).not.toContain('settings-admin');
        expect(agent).toContain('settings-account');
        // En el celular no se señala el riel (vive en el cajón cerrado).
        const mobile = resolveSteps(welcome, ctx({ isMobile: true }));
        expect(mobile.map((s) => s.target)).not.toContain('rail-lists');
        expect(mobile.find((s) => s.id === 'rail')?.target).toBe('topbar-menu');
    });

    it('sin listas, los recorridos que las necesitan no se ofrecen', () => {
        const none = ctx({ firstList: null, listCount: 0 });
        for (const id of ['lists-and-records', 'import', 'views', 'record', 'automation-basics', 'forms', 'portal']) {
            const def = tourById(id)!;
            expect(def.available(none) && resolveSteps(def, none).length > 0, id).toBe(false);
        }
        // El de bienvenida igual existe (centrado donde no hay qué señalar).
        expect(tourById('welcome')!.available(none)).toBe(true);
    });
});
