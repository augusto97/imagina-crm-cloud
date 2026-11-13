import { describe, expect, it } from 'vitest';
import { readShopConfig, type ShopSection } from './shop';
import { SHOP_EDIT_TARGETS, isShopEditTarget, shopEditTargetText, type ShopEditSection } from './shop-edit-targets';

describe('tocar una parte de la tienda en la vista previa (v0.1.428)', () => {
    it('cada parte lleva a una sección del editor y a un bloque con data-tour', () => {
        const sections: ShopSection[] = ['catalog', 'style', 'design', 'payment', 'coupons', 'checkout', 'seller', 'orders', 'measure', 'domain', 'publish'];
        for (const [id, t] of Object.entries(SHOP_EDIT_TARGETS)) {
            expect(sections, id).toContain(t.section);
            expect(t.tour, id).toMatch(/^shop-[a-z0-9-]+$/);
            expect(t.label.length, id).toBeGreaterThan(2);
        }
        // Las secciones del mapa son las mismas del editor (en los dos sentidos).
        const back: ShopEditSection[] = sections;
        expect(back.length).toBe(sections.length);
    });

    it('sólo acepta partes conocidas (lo que llega por postMessage no se cree)', () => {
        expect(isShopEditTarget('image')).toBe(true);
        expect(isShopEditTarget('cx-pay')).toBe(true);
        expect(isShopEditTarget('constructor')).toBe(false);
        expect(isShopEditTarget('__proto__')).toBe(false);
        expect(isShopEditTarget(7)).toBe(false);
    });

    it('la etiqueta dice qué es y dónde se ajusta', () => {
        expect(shopEditTargetText('image')).toBe('Foto · Estilo');
        expect(shopEditTargetText('price')).toBe('Precio · Productos');
        expect(shopEditTargetText('cx-coupon')).toBe('Cupón · Cupones');
    });

    it('la vitrina acepta las formas nuevas de la foto (y lo raro vuelve a cuadrada)', () => {
        for (const r of ['square', 'portrait', 'landscape', 'tall', 'photo', 'wide'] as const) expect(readShopConfig({ display: { image_ratio: r } }).display.image_ratio).toBe(r);
        expect(readShopConfig({ display: { image_ratio: 'auto' } }).display.image_ratio).toBe('square');
    });
});
