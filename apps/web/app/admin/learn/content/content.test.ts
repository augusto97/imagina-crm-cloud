import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_IDS } from '@imagina-base/shared';

import { LEARN_ICONS } from '../LearnIcon';
import { ILLUSTRATION_KEYS } from '../illustrations/registry';
import { LEARN_MODULES, articleText, loadModuleContent } from './registry';
import { fold, LEARN_GROUPS, type LearnArticle, type LearnBlock } from './types';

/**
 * El manual del centro de aprendizaje es DATOS: este test revisa que esté
 * completo y coherente (cada artículo existe en los dos archivos, las
 * animaciones, capturas, íconos, recorridos y enlaces a los que apunta
 * existen, y el texto respeta las reglas: español neutro, sin el nombre del
 * producto, sin jerga).
 */

const scenariosDir = path.resolve(__dirname, '../../../../../../scripts/help-captures/scenarios');
const DEMO_KEYS = new Set<string>();
for (const f of readdirSync(scenariosDir).filter((x) => x.endsWith('.mjs'))) {
    const src = readFileSync(path.join(scenariosDir, f), 'utf8');
    for (const m of src.matchAll(/key:\s*'([a-z0-9-]+)'/g)) DEMO_KEYS.add(m[1]!);
}

const ILL = new Set(ILLUSTRATION_KEYS);

// LEARN_ONLY=vistas,tableros → revisa sólo esos módulos (para escribir uno
// sin depender de los demás); sin la variable, revisa todo el manual.
const ONLY = (process.env.LEARN_ONLY ?? '').split(',').filter(Boolean);
const MODULES = ONLY.length ? LEARN_MODULES.filter((m) => ONLY.includes(m.id)) : LEARN_MODULES;

async function allContent(): Promise<Map<string, LearnArticle>> {
    const map = new Map<string, LearnArticle>();
    for (const m of MODULES) for (const a of await loadModuleContent(m.id)) map.set(a.id, a);
    return map;
}

/** Voseo y jerga que no van en textos para el usuario (ADR-S42). */
const FORBIDDEN = [
    /\bpod[eé]s\b/i,
    /\bten[eé]s\b/i,
    /\bquer[eé]s\b/i,
    /\bsab[eé]s\b/i,
    /\bsos\b/i,
    /\bvos\b/i,
    /\bac[aá]\b/,
    /\belegí\b/i,
    /\bhacé\b/i,
    /\btocá\b/i,
    /\bescribí\b/i,
    /\bfijate\b/i,
    /\bimagina base\b/i,
    /\bslug\b/i,
    /\bendpoint\b/i,
    /\bJSON\b/,
    /\bJSONB\b/,
];

function blockTexts(b: LearnBlock): string[] {
    switch (b.t) {
        case 'p':
        case 'callout':
            return [b.md, b.t === 'callout' ? (b.title ?? '') : ''];
        case 'h':
            return [b.text];
        case 'steps':
            return b.items;
        case 'settings':
            return [b.title ?? '', ...b.rows.flatMap((r) => [r.name, r.what, r.tip ?? ''])];
        case 'example':
            return [b.title, b.md];
        case 'cards':
            return b.items.flatMap((c) => [c.title, c.md]);
        case 'faq':
            return b.items.flatMap((f) => [f.q, f.a]);
        case 'actions':
            return b.items.map((a) => a.label);
        case 'keys':
            return b.items.map((k) => k.what);
        case 'anim':
        case 'demo':
            return [b.caption ?? ''];
        default:
            return [];
    }
}

describe('centro de aprendizaje — el manual', () => {
    it('cada módulo tiene metadatos y contenido, con los mismos artículos', async () => {
        expect(MODULES.length).toBeGreaterThan(0);
        for (const m of MODULES) {
            const content = await loadModuleContent(m.id);
            expect(content.map((a) => a.id), m.id).toEqual(m.articles.map((a) => a.id));
            expect(LEARN_GROUPS.some((g) => g.id === m.group), `${m.id}: grupo`).toBe(true);
            expect(LEARN_ICONS[m.icon], `${m.id}: ícono ${m.icon}`).toBeDefined();
            expect(ILL.has(m.hero), `${m.id}: ilustración de portada «${m.hero}»`).toBe(true);
            expect(m.highlights.length, `${m.id}: highlights`).toBeGreaterThanOrEqual(3);
            expect(m.articles.length, `${m.id}: artículos`).toBeGreaterThanOrEqual(1);
        }
    });

    it('los ids de artículo son únicos y con formato', () => {
        const seen = new Set<string>();
        for (const m of LEARN_MODULES) {
            for (const a of m.articles) {
                expect(a.id).toMatch(/^[a-z0-9][a-z0-9-]{2,79}$/);
                expect(seen.has(a.id), `id repetido ${a.id}`).toBe(false);
                seen.add(a.id);
                expect(a.title.length, a.id).toBeGreaterThan(5);
                expect(a.summary.length, a.id).toBeGreaterThan(20);
                expect(a.minutes, a.id).toBeGreaterThanOrEqual(1);
            }
        }
    });

    it('cada artículo es sustancioso y tiene al menos una imagen (animación o captura)', async () => {
        const all = await allContent();
        for (const [id, a] of all) {
            expect(a.blocks.length, `${id}: bloques`).toBeGreaterThanOrEqual(4);
            expect(a.blocks.some((b) => b.t === 'anim' || b.t === 'demo'), `${id}: sin imagen`).toBe(true);
            const headings = a.blocks.filter((b) => b.t === 'h').map((b) => (b as { text: string }).text);
            expect(new Set(headings).size, `${id}: títulos repetidos`).toBe(headings.length);
        }
    });

    it('todo lo que se referencia existe: animaciones, capturas, íconos, recorridos y artículos', async () => {
        const all = await allContent();
        const ids = new Set(LEARN_MODULES.flatMap((m) => m.articles.map((a) => a.id)));
        for (const [id, a] of all) {
            for (const r of a.related ?? []) expect(ids.has(r), `${id}: relacionado «${r}» no existe`).toBe(true);
            if (a.route) expect(a.route.startsWith('/'), `${id}: ruta`).toBe(true);
            for (const b of a.blocks) {
                if (b.t === 'anim') expect(ILL.has(b.key), `${id}: animación «${b.key}» no existe`).toBe(true);
                if (b.t === 'demo') {
                    expect(DEMO_KEYS.has(b.key), `${id}: captura «${b.key}» sin escenario`).toBe(true);
                    expect(b.fallback && ILL.has(b.fallback), `${id}: la captura «${b.key}» necesita una animación de respaldo`).toBe(true);
                }
                if (b.t === 'cards') for (const c of b.items) if (c.icon) expect(LEARN_ICONS[c.icon], `${id}: ícono ${c.icon}`).toBeDefined();
                if (b.t === 'actions') {
                    for (const act of b.items) {
                        if (act.article) expect(ids.has(act.article), `${id}: acción a «${act.article}»`).toBe(true);
                        if (act.tour) expect((TOUR_IDS as readonly string[]).includes(act.tour), `${id}: recorrido «${act.tour}»`).toBe(true);
                        if (act.to) expect(act.to.startsWith('/'), `${id}: destino «${act.to}»`).toBe(true);
                        expect(Boolean(act.article || act.tour || act.to), `${id}: acción sin destino`).toBe(true);
                    }
                }
            }
        }
    });

    it('el texto es español neutro, sin el nombre del producto ni jerga técnica', async () => {
        const all = await allContent();
        const texts: Array<[string, string]> = [];
        for (const m of MODULES) {
            texts.push([m.id, `${m.title} ${m.tagline} ${m.highlights.join(' ')}`]);
            for (const a of m.articles) texts.push([a.id, `${a.title} ${a.summary}`]);
        }
        for (const [id, a] of all) for (const b of a.blocks) for (const t of blockTexts(b)) texts.push([id, t]);
        const problems: string[] = [];
        for (const [id, t] of texts) for (const re of FORBIDDEN) if (re.test(t)) problems.push(`${id}: «${t.slice(0, 80)}» (${re})`);
        expect(problems).toEqual([]);
    });

    it('el texto plano de cada artículo alimenta el buscador', async () => {
        const all = await allContent();
        for (const [, a] of all) expect(fold(articleText(a)).length).toBeGreaterThan(200);
    });
});
