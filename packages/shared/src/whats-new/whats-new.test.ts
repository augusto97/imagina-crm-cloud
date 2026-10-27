import { describe, expect, it } from 'vitest';

import { markdownToRichDoc } from '../schemas/markdown-lite';
import {
    compareVersions,
    createWhatsNewSchema,
    isSafeAppRoute,
    isWhatsNewImageUrl,
    whatsNewActionSchema,
    whatsNewCatalogEntrySchema,
    whatsNewVideo,
    whatsNewVisibleTo,
    WHATS_NEW_TOUR_SUGGESTIONS,
} from '../schemas/whats-new';
import { WHATS_NEW_CATALOG } from './catalog';

/** Formas de voseo que no pueden aparecer (ADR-S42: español neutro con tuteo). */
const VOSEO = /(?<![\p{L}])(podés|podes|tenés|tenes|querés|sabés|sos|vos|acá|elegí|hacé|probá|mirá|andá|tocá|armá|cargá|configurá|activá|creá|agregá|buscá|abrí|escribí|usá|poné|vení|fijate|avisanos|contanos|decinos)(?![\p{L}])/iu;

function allText(e: (typeof WHATS_NEW_CATALOG)[number]): string {
    return [e.title, e.summary, e.body ?? '', e.action?.label ?? ''].join('\n');
}

describe('catálogo de novedades', () => {
    it('cada entrada es válida y la clave es única', () => {
        const keys = new Set<string>();
        for (const e of WHATS_NEW_CATALOG) {
            const r = whatsNewCatalogEntrySchema.safeParse(e);
            expect(r.success, `${e.key}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
            expect(keys.has(e.key), `clave repetida: ${e.key}`).toBe(false);
            keys.add(e.key);
            // La clave nombra su versión: ordenarlas y leerlas es trivial.
            expect(e.key.startsWith(`v${e.version}-`), e.key).toBe(true);
        }
        expect(WHATS_NEW_CATALOG.length).toBeGreaterThanOrEqual(10);
    });

    it('white-label y español neutro: nunca el nombre del producto, nunca voseo', () => {
        for (const e of WHATS_NEW_CATALOG) {
            const text = allText(e);
            expect(/imagina/i.test(text), `${e.key} nombra el producto`).toBe(false);
            expect(VOSEO.test(text), `${e.key} tiene voseo: ${VOSEO.exec(text)?.[0]}`).toBe(false);
            expect(/\b(slug|json|endpoint)\b/i.test(text), `${e.key} usa jerga técnica`).toBe(false);
        }
    });

    it('los botones llevan a una ruta de la app y nombran recorridos conocidos', () => {
        for (const e of WHATS_NEW_CATALOG) {
            if (!e.action) continue;
            if (e.action.href) expect(isSafeAppRoute(e.action.href), `${e.key}: ${e.action.href}`).toBe(true);
            if (e.action.tour) {
                expect((WHATS_NEW_TOUR_SUGGESTIONS as readonly string[]).includes(e.action.tour), `${e.key}: ${e.action.tour}`).toBe(true);
                // Con un recorrido, siempre hay una ruta de respaldo (la otra pieza puede no estar).
                expect(e.action.href, `${e.key}: recorrido sin ruta de respaldo`).toBeTruthy();
            }
        }
    });

    it('el cuerpo se entiende con el formato sencillo (sin HTML ni comillas invertidas)', () => {
        for (const e of WHATS_NEW_CATALOG) {
            const body = e.body ?? '';
            expect(/<[a-z!/]/i.test(body), `${e.key} trae HTML`).toBe(false);
            expect(body.includes('`'), `${e.key} usa comillas invertidas`).toBe(false);
            expect(markdownToRichDoc(body).type).toBe('doc');
        }
    });

    it('destacadas con mesura', () => {
        expect(WHATS_NEW_CATALOG.filter((e) => e.featured).length).toBeLessThanOrEqual(3);
    });
});

describe('reglas de una novedad', () => {
    it('rutas internas seguras', () => {
        expect(isSafeAppRoute('/lists')).toBe(true);
        expect(isSafeAppRoute('/settings?s=papelera')).toBe(true);
        expect(isSafeAppRoute('//evil.test/x')).toBe(false);
        expect(isSafeAppRoute('/\\evil.test')).toBe(false);
        expect(isSafeAppRoute('javascript:alert(1)')).toBe(false);
        expect(isSafeAppRoute('/a b')).toBe(false);
    });

    it('botón: ruta, https o recorrido; nunca javascript: ni http', () => {
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', href: '/lists' }).success).toBe(true);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', href: 'https://ejemplo.com/guia' }).success).toBe(true);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', tour: 'views' }).success).toBe(true);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', href: 'javascript:alert(1)' }).success).toBe(false);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', href: 'http://ejemplo.com' }).success).toBe(false);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver', tour: 'Hola Mundo' }).success).toBe(false);
        expect(whatsNewActionSchema.safeParse({ label: 'Ver' }).success).toBe(false);
    });

    it('imagen: subida a la plataforma o https; video: sólo YouTube, Vimeo o Loom', () => {
        expect(isWhatsNewImageUrl(`/api/v1/public/whats-new/images/${'a'.repeat(32)}.png`)).toBe(true);
        expect(isWhatsNewImageUrl(`/api/v1/public/whats-new/images/${'a'.repeat(32)}.svg`)).toBe(false);
        expect(isWhatsNewImageUrl('/api/v1/public/whats-new/images/../../.env')).toBe(false);
        expect(isWhatsNewImageUrl('https://cdn.ejemplo.com/a.png')).toBe(true);
        expect(isWhatsNewImageUrl('data:image/png;base64,AAAA')).toBe(false);
        expect(whatsNewVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.provider).toBe('youtube');
        expect(whatsNewVideo('https://vimeo.com/123456789')?.provider).toBe('vimeo');
        expect(whatsNewVideo('https://www.loom.com/share/0123456789abcdef0123')?.provider).toBe('loom');
        expect(whatsNewVideo('https://www.figma.com/file/abc/x')).toBeNull();
        expect(whatsNewVideo('https://evil.test/video')).toBeNull();
    });

    it('alta del operador: defaults y video inválido', () => {
        const ok = createWhatsNewSchema.parse({ kind: 'notice', title: 'Mantenimiento', summary: 'El sábado de 10 a 11 p. m.' });
        expect(ok.status).toBe('published');
        expect(ok.audience).toEqual({ roles: [], plans: [] });
        expect(ok.publish_at).toBeNull();
        expect(createWhatsNewSchema.safeParse({ kind: 'feature', title: 'x', summary: 'y', video_url: 'https://evil.test' }).success).toBe(false);
    });

    it('compara versiones', () => {
        expect(compareVersions('0.1.310', '0.1.309')).toBe(1);
        expect(compareVersions('0.1.9', '0.1.10')).toBe(-1);
        expect(compareVersions('1.0.0', '0.9.99')).toBe(1);
        expect(compareVersions('0.1.300', '0.1.300')).toBe(0);
        expect(compareVersions(null, '0.1.1')).toBe(-1);
    });

    it('público: un invitado sólo ve avisos; filtros por rol y plan', () => {
        const feature = { kind: 'feature' as const, audience: { roles: [], plans: [] } };
        const notice = { kind: 'notice' as const, audience: { roles: [], plans: [] } };
        expect(whatsNewVisibleTo(feature, { role: 'guest', plan: 'pro' })).toBe(false);
        expect(whatsNewVisibleTo(notice, { role: 'guest', plan: 'pro' })).toBe(true);
        expect(whatsNewVisibleTo(notice, { role: 'client', plan: 'pro' })).toBe(false);
        const admins = { kind: 'feature' as const, audience: { roles: ['admin'], plans: ['pro'] } };
        expect(whatsNewVisibleTo(admins, { role: 'admin', plan: 'pro' })).toBe(true);
        expect(whatsNewVisibleTo(admins, { role: 'agent', plan: 'pro' })).toBe(false);
        expect(whatsNewVisibleTo(admins, { role: 'admin', plan: 'trial' })).toBe(false);
    });
});
