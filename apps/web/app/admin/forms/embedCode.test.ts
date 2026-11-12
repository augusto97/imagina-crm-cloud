import { describe, expect, it } from 'vitest';

import { buttonInk, defaultEmbedLabel, embedCode, embedPopupAttribute, qrTargetUrl, safeHex, shopProductUrl, withEmbedOrigin, type EmbedTarget } from './embedCode';

const target: EmbedTarget = {
    url: 'https://app.acme.co/api/v1/public/f/abc123',
    origin: 'https://app.acme.co',
    title: 'Cotiza "ya" <hoy>',
    kind: 'form',
};

describe('v0.1.352 — código para insertar', () => {
    it('en la página: marco con loading="lazy" y el script de siempre (los códigos viejos siguen valiendo)', () => {
        const code = embedCode(target, 'inline', { label: '', color: '#0e7490', position: 'right' });
        expect(code).toContain('<iframe src="https://app.acme.co/api/v1/public/f/abc123"');
        expect(code).toContain('data-imagina-form');
        expect(code).toContain('loading="lazy"');
        expect(code).toContain('height:640px');
        expect(code).toContain('<script src="https://app.acme.co/api/v1/public/f/embed.js" async></script>');
        expect(code).toContain('title="Cotiza &quot;ya&quot; &lt;hoy&gt;"');
        expect(embedCode({ ...target, kind: 'booking' }, 'inline', { label: '', color: '', position: 'right' })).toContain('height:720px');
    });

    it('ventana: un botón con data-imagina-popup, sin marco (no se carga nada hasta tocarlo)', () => {
        const code = embedCode(target, 'popup', { label: '  Escríbenos <ya>  ', color: '#FACC15', position: 'right' });
        expect(code).not.toContain('<iframe');
        expect(code).toContain('data-imagina-popup="https://app.acme.co/api/v1/public/f/abc123"');
        expect(code).toContain('>Escríbenos &lt;ya&gt;</button>');
        // Amarillo claro → tinta oscura.
        expect(code).toContain('background:#facc15;color:#111827');
    });

    it('botón flotante: todo en el script, con la esquina elegida', () => {
        const code = embedCode({ ...target, kind: 'booking' }, 'float', { label: '', color: 'nada', position: 'left' });
        expect(code).not.toContain('<iframe');
        expect(code).toContain('data-imagina-float="https://app.acme.co/api/v1/public/f/abc123"');
        expect(code).toContain(`data-imagina-label="${defaultEmbedLabel('booking')}"`);
        expect(code).toContain('data-imagina-color="#0e7490"');
        expect(code).toContain('data-imagina-position="left"');
    });

    it('colores y el atributo para un botón propio', () => {
        expect(safeHex(' #ABCDEF ')).toBe('#abcdef');
        expect(safeHex('red')).toBe('#0e7490');
        expect(buttonInk('#ffffff')).toBe('#111827');
        expect(buttonInk('#0e7490')).toBe('#ffffff');
        expect(embedPopupAttribute({ ...target, url: 'https://x.co/api/v1/public/b/t"1' })).toBe('data-imagina-popup="https://x.co/api/v1/public/b/t&quot;1"');
    });

    it('v0.1.359 — panel lateral y pantalla completa, en el botón, el flotante y el atributo', () => {
        const side = embedCode(target, 'popup', { label: 'Hola', color: '#0e7490', position: 'left', open: 'side' });
        expect(side).toContain('data-imagina-open="side" data-imagina-side="left"');
        const full = embedCode(target, 'float', { label: '', color: '#0e7490', position: 'right', open: 'full' });
        expect(full).toContain('data-imagina-open="full"');
        // La ventana al centro no agrega nada: los códigos de antes siguen iguales.
        expect(embedCode(target, 'popup', { label: 'Hola', color: '#0e7490', position: 'right', open: 'window' })).not.toContain('data-imagina-open');
        expect(embedPopupAttribute(target, 'side', 'right')).toBe(
            'data-imagina-popup="https://app.acme.co/api/v1/public/f/abc123" data-imagina-open="side" data-imagina-side="right"',
        );
    });

    it('v0.1.359 — el QR lleva utm_source=qr (y conserva lo que ya traía la dirección)', () => {
        expect(qrTargetUrl('https://app.acme.co/api/v1/public/f/abc123')).toBe('https://app.acme.co/api/v1/public/f/abc123?utm_source=qr');
        expect(qrTargetUrl('https://app.acme.co/api/v1/public/f/abc123?origen=feria')).toBe(
            'https://app.acme.co/api/v1/public/f/abc123?origen=feria&utm_source=qr',
        );
    });

    it('v0.1.409 — con la dirección rápida, el código usa esa dirección (la página y el script)', () => {
        const fast = withEmbedOrigin(target, 'https://w.acme.co');
        expect(fast.url).toBe('https://w.acme.co/api/v1/public/f/abc123');
        expect(fast.origin).toBe('https://w.acme.co');
        const code = embedCode(fast, 'inline', { label: '', color: '#0e7490', position: 'right' });
        expect(code).toContain('<iframe src="https://w.acme.co/api/v1/public/f/abc123"');
        expect(code).toContain('<script src="https://w.acme.co/api/v1/public/f/embed.js" async></script>');
        expect(code).not.toContain('app.acme.co');
        expect(embedPopupAttribute(fast)).toContain('https://w.acme.co/api/v1/public/f/abc123');
        // Conserva la consulta (el formulario en modo chat del widget).
        expect(withEmbedOrigin({ ...target, url: 'https://app.acme.co/api/v1/public/f/abc?imb_chat=1' }, 'https://w.acme.co').url).toBe(
            'https://w.acme.co/api/v1/public/f/abc?imb_chat=1',
        );
        // Sin dirección rápida, nada cambia.
        expect(withEmbedOrigin(target, null)).toBe(target);
    });
});

describe('v0.1.419 — la tienda en tu sitio', () => {
    const shop: EmbedTarget = { url: 'https://app.acme.co/api/v1/public/s/tk123', origin: 'https://app.acme.co', title: 'Café "Aurora" <x>', kind: 'shop' };

    it('en la página: alto fijo de 900 px, con permiso de pago y sin colar etiquetas', () => {
        const code = embedCode(shop, 'inline', { label: '', color: '#0e7490', position: 'right' });
        expect(code).toContain('height:900px');
        expect(code).toContain('allow="payment"');
        expect(code).toContain('title="Café &quot;Aurora&quot; &lt;x&gt;"');
        expect(code).toContain('<script src="https://app.acme.co/api/v1/public/f/embed.js" async></script>');
        // Los formularios no llevan el permiso de pago.
        expect(embedCode(target, 'inline', { label: '', color: '', position: 'right' })).not.toContain('allow="payment"');
    });

    it('el botón dice «Ver la tienda» y abre la tienda (también en panel o pantalla completa)', () => {
        expect(defaultEmbedLabel('shop')).toBe('Ver la tienda');
        const code = embedCode(shop, 'popup', { label: '', color: '#0e7490', position: 'left', open: 'side' });
        expect(code).toContain('data-imagina-popup="https://app.acme.co/api/v1/public/s/tk123"');
        expect(code).toContain('data-imagina-open="side" data-imagina-side="left"');
        expect(code).toContain('>Ver la tienda</button>');
    });

    it('el botón «Comprar» de un producto abre la tienda en ese producto', () => {
        expect(shopProductUrl(shop.url, 42)).toBe('https://app.acme.co/api/v1/public/s/tk123?producto=42');
        expect(shopProductUrl('https://app.acme.co/api/v1/public/s/tk123?utm_source=web', 7)).toBe('https://app.acme.co/api/v1/public/s/tk123?utm_source=web&producto=7');
        const buy = embedCode(withEmbedOrigin({ ...shop, url: shopProductUrl(shop.url, 42) }, 'https://w.acme.co'), 'popup', { label: 'Comprar', color: '#111111', position: 'right', open: 'full' });
        expect(buy).toContain('data-imagina-popup="https://w.acme.co/api/v1/public/s/tk123?producto=42"');
        expect(buy).toContain('data-imagina-open="full"');
        expect(buy).toContain('<script src="https://w.acme.co/api/v1/public/f/embed.js" async></script>');
    });
});
