import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './membership';
import {
    customGuideSchema,
    guideProgressSchema,
    HELP_CATEGORIES,
    HELP_ID_RE,
    HELP_SCREEN_RE,
    helpScreensFor,
    helpVideoEmbed,
    mergeGuideProgress,
    parseGuideProgress,
    parsePlatformHelp,
    TOUR_IDS,
    updateGuideProgressSchema,
    updatePlatformHelpSchema,
    whatsappDigits,
} from './help';
import { markdownToRichDoc } from './markdown-lite';
import { SYSTEM_GUIDE_IDS, SYSTEM_GUIDES } from '../help/system-guides';

describe('progreso de los recorridos', () => {
    it('mezcla: suma lo nuevo, no repite y terminar saca de «saltados»', () => {
        const cur = guideProgressSchema.parse({ completed: ['welcome'], dismissed: ['views', 'import'] });
        const next = mergeGuideProgress(cur, { completed: ['views', 'welcome'], dismissed: ['record'] });
        expect(next.completed).toEqual(['welcome', 'views']);
        expect(next.dismissed).toEqual(['import', 'record']);
        expect(next.welcome_offered).toBe(false);
        expect(mergeGuideProgress(next, { welcome_offered: true }).welcome_offered).toBe(true);
    });

    it('un valor raro guardado vuelve al estado vacío en vez de romper', () => {
        expect(parseGuideProgress({ completed: 'x' })).toEqual({ completed: [], dismissed: [], welcome_offered: false });
        expect(parseGuideProgress(null)).toEqual({ completed: [], dismissed: [], welcome_offered: false });
    });

    it('el PATCH rechaza ids inválidos y claves desconocidas', () => {
        expect(updateGuideProgressSchema.safeParse({ completed: ['Bien'] }).success).toBe(false);
        expect(updateGuideProgressSchema.safeParse({ completed: ['ok'], otra: 1 }).success).toBe(false);
        expect(updateGuideProgressSchema.safeParse({ dismissed: ['welcome'] }).success).toBe(true);
    });

    it('se conservan los más recientes si se pasa del tope', () => {
        const many = Array.from({ length: 100 }, (_, i) => `t${i}`);
        const next = mergeGuideProgress(guideProgressSchema.parse({ completed: many }), { completed: ['nuevo'] });
        expect(next.completed).toHaveLength(100);
        expect(next.completed.at(-1)).toBe('nuevo');
        expect(next.completed[0]).toBe('t1');
    });
});

describe('pantallas de la app', () => {
    it('reconoce la pantalla y su sección', () => {
        expect(helpScreensFor('/lists')).toEqual(['lists-index']);
        expect(helpScreensFor('/lists/clientes/records', '?view=3')).toEqual(['records']);
        expect(helpScreensFor('/lists/clientes/records', '?record=12')).toEqual(['records', 'record']);
        expect(helpScreensFor('/lists/clientes/records/12')).toEqual(['record']);
        expect(helpScreensFor('/lists/clientes/edit', '?s=permisos')).toEqual(['list-settings', 'list-settings:permisos']);
        expect(helpScreensFor('/lists/clientes/edit')).toEqual(['list-settings', 'list-settings:campos']);
        expect(helpScreensFor('/lists/clientes/automations/new')).toEqual(['automations']);
        expect(helpScreensFor('/settings', '?s=miembros')).toEqual(['settings', 'settings:miembros']);
        expect(helpScreensFor('/settings/whatsapp/3')).toEqual(['settings', 'settings:conectores']);
        expect(helpScreensFor('/dashboards/4')).toEqual(['dashboards']);
    });
});

describe('configuración de ayuda de la plataforma', () => {
    it('sólo videos de YouTube, Vimeo o Loom', () => {
        expect(helpVideoEmbed('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
        expect(helpVideoEmbed('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
        expect(helpVideoEmbed('https://www.loom.com/share/0123456789abcdef0123')).toContain('loom.com/embed/');
        expect(helpVideoEmbed('https://www.figma.com/file/abc/x')).toBeNull();
        expect(helpVideoEmbed('javascript:alert(1)')).toBeNull();
        const bad = updatePlatformHelpSchema.safeParse({ videos: { 'create-list': 'https://evil.example/v' } });
        expect(bad.success).toBe(false);
    });

    it('contacto: correo, WhatsApp con indicativo y enlace https', () => {
        const ok = updatePlatformHelpSchema.safeParse({
            support: { email: 'soporte@acme.co', whatsapp: '+57 300 123-4567', url: 'https://ayuda.acme.co', note: 'Lunes a viernes' },
        });
        expect(ok.success).toBe(true);
        expect(whatsappDigits('+57 300 123-4567')).toBe('573001234567');
        expect(updatePlatformHelpSchema.safeParse({ support: { url: 'http://ayuda.acme.co' } }).success).toBe(false);
        expect(updatePlatformHelpSchema.safeParse({ support: { whatsapp: 'llámame' } }).success).toBe(false);
    });

    it('guías propias: formato, roles y sin ids repetidos', () => {
        const g = customGuideSchema.parse({ id: 'op-abc123', title: '¿Cómo pido soporte?', category: 'account', body: '1. Escríbenos' });
        expect(g.roles).toEqual([]);
        expect(g.minutes).toBe(2);
        expect(customGuideSchema.safeParse({ ...g, id: 'create-list' }).success).toBe(false);
        expect(customGuideSchema.safeParse({ ...g, roles: ['client'] }).success).toBe(false);
        const dup = updatePlatformHelpSchema.safeParse({ custom: [g, g] });
        expect(dup.success).toBe(false);
    });

    it('lectura tolerante del valor guardado', () => {
        expect(parsePlatformHelp('basura').custom).toEqual([]);
        expect(parsePlatformHelp({}).support.email).toBeNull();
    });
});

describe('catálogo de guías del sistema', () => {
    const categories = new Set<string>(HELP_CATEGORIES.map((c) => c.id));
    const caps = new Set<string>(CAPABILITIES);

    it('entre 35 y 50 guías, ids únicos y válidos', () => {
        expect(SYSTEM_GUIDES.length).toBeGreaterThanOrEqual(35);
        expect(SYSTEM_GUIDES.length).toBeLessThanOrEqual(50);
        expect(new Set(SYSTEM_GUIDE_IDS).size).toBe(SYSTEM_GUIDE_IDS.length);
        for (const id of SYSTEM_GUIDE_IDS) expect(id).toMatch(HELP_ID_RE);
    });

    it('cada guía está completa y apunta a cosas que existen', () => {
        for (const g of SYSTEM_GUIDES) {
            expect(g.title.startsWith('¿'), g.id).toBe(true);
            expect(g.title.endsWith('?'), g.id).toBe(true);
            expect(categories.has(g.category), g.id).toBe(true);
            expect(g.minutes, g.id).toBeGreaterThan(0);
            expect(g.body.length, g.id).toBeGreaterThan(40);
            for (const r of g.related) expect(SYSTEM_GUIDE_IDS, `${g.id} → ${r}`).toContain(r);
            for (const s of g.screens) expect(s, g.id).toMatch(HELP_SCREEN_RE);
            if (g.tour) expect(TOUR_IDS as readonly string[], g.id).toContain(g.tour);
            if (g.route) expect(g.route.startsWith('/'), g.id).toBe(true);
            for (const c of g.requires ?? []) expect(caps.has(c), `${g.id}: ${c}`).toBe(true);
            // El formato sencillo se entiende (no queda texto suelto con ** sin cerrar).
            const doc = JSON.stringify(markdownToRichDoc(g.body));
            expect(doc.includes('**'), g.id).toBe(false);
        }
    });

    it('español neutro y white-label: sin voseo ni el nombre de la plataforma', () => {
        const voseo = /\b(tenés|podés|querés|elegí|hacé|tocá|abrí|escribí|andá|vení|fijate|acá|vos)\b/i;
        for (const g of SYSTEM_GUIDES) {
            const text = `${g.title} ${g.body} ${g.tip ?? ''}`;
            expect(voseo.test(text), g.id).toBe(false);
            expect(/imagina/i.test(text), g.id).toBe(false);
        }
    });

    it('todas las categorías tienen al menos una guía', () => {
        for (const c of HELP_CATEGORIES) {
            expect(SYSTEM_GUIDES.some((g) => g.category === c.id), c.id).toBe(true);
        }
    });
});
