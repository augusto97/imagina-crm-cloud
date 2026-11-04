import { describe, expect, it } from 'vitest';

import { buttonInk, defaultEmbedLabel, embedCode, embedPopupAttribute, safeHex, type EmbedTarget } from './embedCode';

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
});
