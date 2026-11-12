import { defaultShopConfig, shopProblems } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';

import { cleanPhone, sameShopConfig, sectionsWithProblems, shopEditorSection, shopEmbedCode, shopSectionSummary } from './shopEditor';

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

    it('el código para el sitio no deja colar etiquetas y el teléfono queda en E.164', () => {
        const code = shopEmbedCode('https://app.test/api/v1/public/s/abc', 'Café "Aurora" <x>');
        expect(code).toContain('src="https://app.test/api/v1/public/s/abc"');
        expect(code).toContain('title="Café Aurora x"');
        expect(code).not.toContain('<x>');
        expect(cleanPhone('+57 300 111 2233')).toBe('+573001112233');
        expect(cleanPhone('(300) 111-2233')).toBe('+3001112233');
        expect(cleanPhone('  ')).toBe('');
    });
});
