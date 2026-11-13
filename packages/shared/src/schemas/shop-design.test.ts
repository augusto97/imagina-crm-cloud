import { describe, expect, it } from 'vitest';
import { contrastRatio } from './public-theme-css';
import {
    SHOP_CHECKOUT_LAYOUTS,
    SHOP_CHECKOUT_LAYOUT_HINTS,
    SHOP_CHECKOUT_LAYOUT_LABELS,
    SHOP_DESIGN_PRESETS,
    SHOP_IMAGE_RATIOS,
    SHOP_IMAGE_RATIO_SIZES,
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

describe('v0.1.425 — el pago', () => {
    it('sin elegir nada (tiendas de antes) es el clásico', () => {
        const c = readShopConfig({});
        expect(c.design.checkout).toEqual({ layout: 'classic', header: 'minimal', labels: 'above', thumbnails: true, summary_open: false, trust: true, summary_color: null });
    });

    it('se lee con tolerancia campo por campo', () => {
        const d = readShopDesign({ checkout: { layout: 'carrusel', header: 'store', labels: 'flotando', thumbnails: false, summary_open: 'sí', summary_color: 'rojo' } });
        expect(d.checkout.layout).toBe('classic');
        expect(d.checkout.header).toBe('store');
        expect(d.checkout.labels).toBe('above');
        expect(d.checkout.thumbnails).toBe(false);
        expect(d.checkout.summary_open).toBe(false);
        expect(d.checkout.summary_color).toBeNull();
        for (const layout of SHOP_CHECKOUT_LAYOUTS) expect(readShopDesign({ checkout: { layout } }).checkout.layout).toBe(layout);
    });

    it('aplicar una plantilla de estilo no cambia el pago', () => {
        const current = readShopDesign({ checkout: { layout: 'steps', labels: 'inside', summary_color: '#fdf2e9' } });
        for (const p of SHOP_DESIGN_PRESETS) expect(applyShopDesignPreset(current, p.id).checkout).toEqual(current.checkout);
    });

    it('el fondo del resumen: un gris suave, o el elegido con texto que se lee', () => {
        const base = buildShopDesignCss(defaultShopDesign(), '#0e7490');
        const side = varOf(base, '--s-cx-side')!;
        expect(side).toMatch(/^#[0-9a-f]{6}$/i);
        expect(side.toLowerCase()).not.toBe('#ffffff');
        const dark = buildShopDesignCss(readShopDesign({ checkout: { summary_color: '#1e293b' } }), '#0e7490');
        expect(varOf(dark, '--s-cx-side')).toBe('#1e293b');
        expect(contrastRatio(varOf(dark, '--s-cx-ink')!, '#1e293b')).toBeGreaterThanOrEqual(4.5);
        // En «automático», el color elegido es el de la versión clara: la oscura usa la suya.
        const auto = buildShopDesignCss(readShopDesign({ mode: 'auto', checkout: { summary_color: '#fdf2e9' } }), '#0e7490');
        const darkPart = auto.slice(auto.indexOf('prefers-color-scheme'));
        expect(varOf(auto, '--s-cx-side')).toBe('#fdf2e9');
        expect(varOf(darkPart, '--s-cx-side')).not.toBe('#fdf2e9');
    });

    it('cada diseño tiene su nombre y su explicación', () => {
        for (const l of SHOP_CHECKOUT_LAYOUTS) {
            expect(SHOP_CHECKOUT_LAYOUT_LABELS[l].length).toBeGreaterThan(3);
            expect(SHOP_CHECKOUT_LAYOUT_HINTS[l].length).toBeGreaterThan(10);
        }
    });
});

describe('fotos de los productos (v0.1.428)', () => {
    it('por defecto se ven como siempre: sin clases ni variables nuevas', () => {
        const d = defaultShopDesign();
        expect(d.images).toEqual({ corners: 'inherit', border: 0, border_color: null, inset: false, shadow: false, background: null });
        expect(shopDesignClasses(d)).not.toMatch(/s-img-/);
        expect(buildShopDesignCss(d, '#0e7490')).not.toMatch(/--s-img-/);
    });

    it('esquinas, borde, margen, sombra y fondo llegan como clases y variables', () => {
        const d = readShopDesign({ images: { corners: 'round', border: 2, border_color: '#111827', inset: true, shadow: true, background: '#fafafa' } });
        const cls = shopDesignClasses(d);
        for (const c of ['s-img-c', 's-img-c-round', 's-img-border', 's-img-inset', 's-img-shadow']) expect(cls.split(' ')).toContain(c);
        const css = buildShopDesignCss(d, '#0e7490');
        expect(varOf(css, '--s-img-r')).toBe('22px');
        expect(varOf(css, '--s-img-bw')).toBe('2px');
        expect(varOf(css, '--s-img-bc')).toBe('#111827');
        expect(varOf(css, '--s-img-bg')).toBe('#fafafa');
        // Sin color, el borde es la línea de la tienda.
        expect(varOf(buildShopDesignCss(readShopDesign({ images: { border: 1 } }), '#0e7490'), '--s-img-bc')).toBe('var(--s-line)');
    });

    it('el círculo va siempre con margen dentro de la tarjeta', () => {
        expect(shopDesignClasses(readShopDesign({ images: { corners: 'circle' } })).split(' ')).toContain('s-img-inset');
        expect(varOf(buildShopDesignCss(readShopDesign({ images: { corners: 'circle' } }), '#0e7490'), '--s-img-r')).toBe('50%');
    });

    it('lo que no se entiende toma su valor por defecto, campo por campo', () => {
        const d = readShopDesign({ images: { corners: 'estrella', border: 40, border_color: 'rojo', inset: 'sí', shadow: true } });
        expect(d.images).toEqual({ corners: 'inherit', border: 0, border_color: null, inset: false, shadow: true, background: null });
    });

    it('las formas nuevas de la foto valen en la ficha (y lo guardado antes sigue valiendo)', () => {
        for (const r of ['auto', 'square', 'portrait', 'landscape', 'tall', 'photo', 'wide'] as const) expect(readShopDesign({ product: { image_ratio: r } }).product.image_ratio).toBe(r);
        expect(readShopDesign({ product: { image_ratio: 'panorama' } }).product.image_ratio).toBe('auto');
        for (const r of SHOP_IMAGE_RATIOS) expect(SHOP_IMAGE_RATIO_SIZES[r].text).toMatch(/^\d+:\d+$/);
    });

    it('aplicar una plantilla de estilo no cambia las fotos', () => {
        const current = readShopDesign({ images: { corners: 'square', border: 3, inset: true } });
        for (const p of SHOP_DESIGN_PRESETS) expect(applyShopDesignPreset(current, p.id).images).toEqual(current.images);
    });
});
