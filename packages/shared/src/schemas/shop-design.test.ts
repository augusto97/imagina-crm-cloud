import { describe, expect, it } from 'vitest';
import { contrastRatio } from './public-theme-css';
import {
    SHOP_DESIGN_PRESETS,
    SHOP_PRODUCT_LAYOUTS,
    SHOP_PRODUCT_LAYOUT_HINTS,
    SHOP_PRODUCT_LAYOUT_LABELS,
    applyShopDesignPreset,
    buildShopDesignCss,
    defaultShopDesign,
    readShopDesign,
    shopDesignClasses,
    shopDesignFileIds,
    shopDesignWebFonts,
} from './shop-design';
import { readShopConfig } from './shop';

const varOf = (css: string, name: string): string | null => {
    const m = new RegExp(`${name}:([^;}]+)`).exec(css);
    return m ? m[1]!.trim() : null;
};

describe('v0.1.422 — el estilo de la tienda', () => {
    it('sin estilo guardado (tiendas de antes) se ve como siempre', () => {
        const c = readShopConfig({});
        expect(c.design).toEqual(defaultShopDesign());
        expect(shopDesignClasses(c.design)).toBe('s-cards-border s-head-light s-hero-simple');
        const css = buildShopDesignCss(c.design, '#0e7490');
        expect(varOf(css, '--s-bg')).toBe('#f6f7f9');
        expect(varOf(css, '--s-card')).toBe('#ffffff');
        expect(varOf(css, '--s-text')).toBe('#111827');
        expect(varOf(css, '--s-radius')).toBe('14px');
        expect(css).not.toContain('@font-face');
        expect(css).not.toContain('prefers-color-scheme');
    });

    it('se lee con tolerancia campo por campo', () => {
        const d = readShopDesign({ mode: 'sepia', corners: 'round', colors: { background: 'rojo', text: '#222222' }, header: { logo_size: 900 }, hero: { overlay: -3, style: 'banner' }, font: 'comic' });
        expect(d.mode).toBe('light');
        expect(d.corners).toBe('round');
        expect(d.colors.background).toBeNull();
        expect(d.colors.text).toBe('#222222');
        expect(d.header.logo_size).toBe(38);
        expect(d.hero.overlay).toBe(35);
        expect(d.hero.style).toBe('banner');
        expect(d.font).toBeNull();
    });

    it('cada plantilla es válida y aplicarla conserva la foto, el ancho y el CSS propio', () => {
        const base = { ...defaultShopDesign(), width: 'wide' as const, custom_css: '.s-title{color:red}', hero: { ...defaultShopDesign().hero, image_file_id: 7 } };
        for (const p of SHOP_DESIGN_PRESETS) {
            const d = applyShopDesignPreset(base, p.id);
            expect(d.preset).toBe(p.id);
            expect(d.width).toBe('wide');
            expect(d.custom_css).toBe('.s-title{color:red}');
            expect(d.hero.image_file_id).toBe(7);
            // El texto siempre se lee sobre las tarjetas.
            const css = buildShopDesignCss(d, '#0e7490');
            expect(contrastRatio(varOf(css, '--s-text')!, varOf(css, '--s-card')!)).toBeGreaterThanOrEqual(4.5);
        }
        expect(applyShopDesignPreset(base, 'no-existe')).toBe(base);
    });

    it('un texto que no se lee sobre las tarjetas se corrige solo', () => {
        const d = readShopDesign({ colors: { surface: '#111111', text: '#222222' } });
        const css = buildShopDesignCss(d, '#0e7490');
        expect(contrastRatio(varOf(css, '--s-text')!, '#111111')).toBeGreaterThanOrEqual(4.5);
    });

    it('modo automático: la versión oscura va por el dispositivo y la vista previa la puede forzar', () => {
        const d = readShopDesign({ mode: 'auto', colors: { background: '#fff7ed' } });
        const css = buildShopDesignCss(d, '#0e7490');
        expect(varOf(css, '--s-bg')).toBe('#fff7ed');
        expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-scheme=light]){--s-bg:#0f1115');
        expect(css).toContain(':root[data-scheme=dark]{--s-bg:#0f1115');
        // El color de la tienda como texto se aclara si no se lee sobre lo oscuro.
        const dark = css.slice(css.indexOf(':root[data-scheme=dark]'));
        expect(contrastRatio(varOf(dark, '--s-accent-text')!, '#171a21')).toBeGreaterThanOrEqual(4.5);
    });

    it('encabezado de tu color: el botón del carrito se invierte para no perderse', () => {
        const d = readShopDesign({ header: { style: 'brand' } });
        const css = buildShopDesignCss(d, '#0e7490');
        expect(varOf(css, '--s-head-bg')).toBe('#0e7490');
        expect(varOf(css, '--s-head-ink')).toBe('#ffffff');
        expect(varOf(css, '--s-cbtn-bg')).toBe('#ffffff');
        expect(varOf(css, '--s-cbtn-ink')).toBe('#0e7490');
    });

    it('fuentes web sólo las elegidas, por la ruta de la app; CSS propio limpio', () => {
        const d = readShopDesign({ font: 'lato', heading_font: 'playfair', custom_css: '.s-hero{background:url(https://evil.example/x.png)}\n.s-title{letter-spacing:1px}' });
        expect(shopDesignWebFonts(d)).toEqual(['lato', 'playfair']);
        const css = buildShopDesignCss(d, '#0e7490');
        expect(css).toContain("font-family:'Lato'");
        expect(css).toContain('url(/email-fonts/playfair-700-normal.woff2)');
        expect(css).not.toContain('evil.example');
        expect(css).toContain('letter-spacing:1px');
        expect(buildShopDesignCss(d, '#0e7490', { includeCustom: false })).not.toContain('letter-spacing');
    });

    it('la foto de la portada sólo cuenta con la portada a lo ancho', () => {
        const d = readShopDesign({ hero: { style: 'simple', image_file_id: 9 } });
        expect(shopDesignFileIds(d)).toEqual([]);
        expect(shopDesignFileIds({ ...d, hero: { ...d.hero, style: 'banner' } })).toEqual([9]);
        expect(shopDesignClasses({ ...d, hero: { ...d.hero, style: 'banner' } })).toContain('s-hero-img');
    });
});

describe('v0.1.424 — la ficha del producto', () => {
    it('sin elegir nada (tiendas de antes) es la clásica, con la foto como es', () => {
        const c = readShopConfig({});
        expect(c.design.product).toEqual({ layout: 'classic', image_ratio: 'auto', image_fit: 'contain', show_delivery: true, sticky_bar: true });
    });

    it('se lee con tolerancia: lo que no existe vuelve a lo de siempre, lo demás se conserva', () => {
        const d = readShopDesign({ product: { layout: 'gigante', image_ratio: 'square', image_fit: 'estirar', show_delivery: 'no', sticky_bar: false } });
        expect(d.product.layout).toBe('classic');
        expect(d.product.image_ratio).toBe('square');
        expect(d.product.image_fit).toBe('contain');
        expect(d.product.show_delivery).toBe(true);
        expect(d.product.sticky_bar).toBe(false);
        for (const layout of SHOP_PRODUCT_LAYOUTS) expect(readShopDesign({ product: { layout } }).product.layout).toBe(layout);
    });

    it('aplicar una plantilla de estilo no cambia el diseño de la ficha', () => {
        const current = readShopDesign({ product: { layout: 'wide', image_ratio: 'portrait', image_fit: 'cover' } });
        for (const p of SHOP_DESIGN_PRESETS) {
            const next = applyShopDesignPreset(current, p.id);
            expect(next.product).toEqual(current.product);
        }
    });

    it('cada diseño tiene su nombre y su explicación', () => {
        for (const l of SHOP_PRODUCT_LAYOUTS) {
            expect(SHOP_PRODUCT_LAYOUT_LABELS[l].length).toBeGreaterThan(3);
            expect(SHOP_PRODUCT_LAYOUT_HINTS[l].length).toBeGreaterThan(10);
        }
    });
});
