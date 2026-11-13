import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOP_EDIT_TARGETS, defaultShopConfig, shopProblems } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';

import { SHOP_EDITOR_SECTIONS, cleanPhone, sameShopConfig, sectionsWithProblems, shopEditorLocation, shopEditorSection, shopSectionSummary } from './shopEditor';

describe('editor de la tienda (v0.1.412)', () => {
    it('cada sección dice cómo está en una línea', () => {
        const c = defaultShopConfig();
        const ctx = { enabled: false, productsCount: 1, ordersListName: 'Pedidos · Tienda' };
        expect(shopSectionSummary('catalog', c, ctx)).toBe('1 producto');
        expect(shopSectionSummary('catalog', c, { ...ctx, productsCount: 12 })).toBe('12 productos');
        // v0.1.417 — Con algún producto atado a un plan, dice que vende suscripciones.
        const withSubs = { ...c, kinds: { ...c.kinds, subscription_links: { '5': 9 } } };
        expect(shopSectionSummary('catalog', withSubs, ctx)).toBe('1 producto · con suscripciones');
        expect(shopSectionSummary('payment', c, ctx)).toBe('Sin forma de pago · 2 entregas');
        c.payments.transfer.enabled = true;
        c.payments.cod.enabled = true;
        expect(shopSectionSummary('payment', c, ctx)).toMatch(/^Transferencia.*Contra entrega · 2 entregas$/);
        // v0.1.413 — el pago en línea va primero en el resumen.
        c.payments.online = { enabled: true, connection_id: 7, hold_minutes: 30 };
        expect(shopSectionSummary('payment', c, ctx)).toMatch(/^En línea, Transferencia/);
        expect(shopSectionSummary('seller', c, ctx)).toBe('Falta quién vende');
        expect(shopSectionSummary('orders', c, ctx)).toBe('Pedidos · Tienda');
        expect(shopSectionSummary('publish', c, { ...ctx, enabled: true })).toBe('Publicada');
        // v0.1.418 — Medir conversiones: sin nada, sólo Tag Manager; con etiquetas, cuáles.
        expect(shopSectionSummary('measure', c, ctx)).toBe('Tag Manager');
        const measured = { ...c, conversion: { ...c.conversion, google_ads: 'AW-123456789/AbCdEf', meta_event: true } };
        expect(shopSectionSummary('measure', measured, ctx)).toBe('Google Ads, Meta');
    });

    it('v0.1.423 — «Dominio y Google» dice en qué está el dominio', () => {
        const c = defaultShopConfig();
        const ctx = { enabled: true, productsCount: 1, ordersListName: null };
        expect(shopSectionSummary('domain', c, ctx)).toBe('Sin dominio propio');
        expect(shopSectionSummary('domain', c, { ...ctx, customDomain: 'tienda.acme.co' })).toBe('tienda.acme.co · falta que abra');
        expect(shopSectionSummary('domain', c, { ...ctx, customDomain: 'tienda.acme.co', siteUrl: 'https://tienda.acme.co' })).toBe('tienda.acme.co · en Google');
        const hidden = { ...c, seo: { ...c.seo, index: false } };
        expect(shopSectionSummary('domain', hidden, { ...ctx, customDomain: 'tienda.acme.co', siteUrl: 'https://tienda.acme.co' })).toBe('tienda.acme.co · fuera de Google');
        expect(shopEditorSection('domain')).toBe('domain');
    });

    it('lo que falta para publicar se marca en su sección', () => {
        const c = defaultShopConfig();
        const problems = shopProblems(c, { hasOrdersLists: true, priceFieldOk: false });
        const s = sectionsWithProblems(problems);
        expect(s.has('catalog')).toBe(true);
        expect(s.has('payment')).toBe(true);
        expect(s.has('seller')).toBe(true);
        expect(s.has('design')).toBe(false);
    });

    it('la sección de la dirección: lo desconocido cae en Productos', () => {
        expect(shopEditorSection('payment')).toBe('payment');
        expect(shopEditorSection('nada')).toBe('catalog');
        expect(shopEditorSection(null)).toBe('catalog');
    });

    it('«sin cambios» no depende del orden de las claves', () => {
        const a = defaultShopConfig();
        const b = JSON.parse(JSON.stringify(a)) as typeof a;
        const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof a;
        expect(sameShopConfig(a, reordered)).toBe(true);
        reordered.texts = { ...reordered.texts, title: 'Otra' };
        expect(sameShopConfig(a, reordered)).toBe(false);
    });

    it('el teléfono queda en E.164', () => {
        expect(cleanPhone('+57 300 111 2233')).toBe('+573001112233');
        expect(cleanPhone('(300) 111-2233')).toBe('+3001112233');
        expect(cleanPhone('  ')).toBe('');
    });

    it('v0.1.418 — ?t=stats abre las estadísticas; lo demás, una sección', () => {
        expect(shopEditorLocation('stats')).toEqual({ mode: 'stats', section: 'catalog' });
        expect(shopEditorLocation('measure')).toEqual({ mode: 'edit', section: 'measure' });
        expect(shopEditorLocation('cualquiera')).toEqual({ mode: 'edit', section: 'catalog' });
        expect(shopEditorLocation(null)).toEqual({ mode: 'edit', section: 'catalog' });
    });
});

describe('tocar una parte de la vista previa lleva a su ajuste (v0.1.428)', () => {
    // Los paneles del editor: cada destino tiene que existir como `tour="…"`
    // (o `data-tour`), así un cambio en un panel no deja un clic sin destino.
    const src = readdirSync(__dirname)
        .filter((f) => /\.tsx$/.test(f))
        .map((f) => readFileSync(join(__dirname, f), 'utf8'))
        .join('\n');
    const anchors = new Set([...src.matchAll(/\b(?:data-tour|tour)="([a-z0-9-]+)"/g)].map((m) => m[1]!));
    const roles = new Set([...(src.match(/const ROLE_ORDER[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!));

    it('cada parte apunta a una sección del menú y a un bloque que existe', () => {
        for (const [id, t] of Object.entries(SHOP_EDIT_TARGETS)) {
            expect(SHOP_EDITOR_SECTIONS, id).toContain(t.section);
            if (t.tour.startsWith('shop-role-')) {
                expect(src).toContain('tour={`shop-role-${role}`}');
                expect(roles, id).toContain(t.tour.slice('shop-role-'.length));
            } else expect(anchors, `${id} → ${t.tour}`).toContain(t.tour);
        }
    });
});
