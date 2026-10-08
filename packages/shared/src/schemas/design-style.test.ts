import { describe, expect, it } from 'vitest';

import {
    applyTextTransform,
    blockStyleSchema,
    fontStack,
    googleFontsHref,
    hasBoxStyle,
    localizeGoogleFonts,
    selfHostedFontFaces,
} from './design-style';
import { docDesignSchema } from './document-design';
import { emailDesignSchema, renderEmailHtml, renderEmailText } from './email-design';

const resolve = (t: string): string => t;
const render = (blocks: unknown[], theme: Record<string, unknown> = {}): string =>
    renderEmailHtml(emailDesignSchema.parse({ theme, blocks }), { resolve });

describe('estilo por bloque — piezas', () => {
    it('acepta un estilo completo y rechaza valores fuera de rango', () => {
        expect(
            blockStyleSchema.safeParse({
                font: 'montserrat',
                font_size: 22,
                font_weight: 600,
                italic: true,
                line_height: 1.4,
                letter_spacing: 1.5,
                text_transform: 'uppercase',
                margin_top: 10,
                padding_left: 24,
                border_width: 2,
                border_style: 'dashed',
                border_color: '#ff0000',
                border_sides: ['left'],
                radius: 12,
                shadow: 'md',
                bg_mode: 'box',
            }).success,
        ).toBe(true);
        expect(blockStyleSchema.safeParse({ font_size: 200 }).success).toBe(false);
        expect(blockStyleSchema.safeParse({ font_weight: 500 }).success).toBe(false);
        expect(blockStyleSchema.safeParse({ font: 'comic_sans' }).success).toBe(false);
    });

    it('distingue tipografía sola de una caja', () => {
        expect(hasBoxStyle({ font_size: 20 })).toBe(false);
        expect(hasBoxStyle({ padding_top: 0 })).toBe(true);
        expect(hasBoxStyle({ border_width: 1 })).toBe(true);
        expect(hasBoxStyle({ shadow: 'none' })).toBe(false);
    });

    it('fuente web con respaldo del sistema y Google Fonts sólo para las web', () => {
        expect(fontStack('playfair')).toMatch(/^'Playfair Display', Georgia/);
        expect(fontStack('sans')).toBe('Arial, Helvetica, sans-serif');
        expect(googleFontsHref(['sans', 'serif'])).toBeNull();
        const href = googleFontsHref(['lato', 'montserrat', 'lato']) ?? '';
        expect(href).toContain('family=Lato:ital,wght@0,400;0,700;1,400;1,700');
        expect(href).toContain('family=Montserrat');
        expect(href.match(/family=/g)).toHaveLength(2);
    });

    it('la vista previa reemplaza Google Fonts por las fuentes de la app', () => {
        const html = render([{ id: 'h', type: 'heading', text: 'Hola', style: { font: 'lora' } }]);
        expect(html).toContain('https://fonts.googleapis.com/css2?family=Lora');
        const local = localizeGoogleFonts(html, 'https://app.test');
        expect(local).not.toContain('fonts.googleapis.com');
        expect(local).toContain("url(https://app.test/email-fonts/lora-700-normal.woff2)");
        expect(selfHostedFontFaces(['sans'], 'x')).toBe('');
    });

    it('mayúsculas respetando el español', () => {
        expect(applyTextTransform('peña ñandú', 'uppercase')).toBe('PEÑA ÑANDÚ');
        expect(applyTextTransform('hola ¿qué tal? (bien)', 'capitalize')).toBe('Hola ¿Qué Tal? (Bien)');
        expect(applyTextTransform('Igual', undefined)).toBe('Igual');
    });
});

describe('estilo por bloque — correo', () => {
    it('un bloque sin estilo sale como antes (sin caja ni fuentes web)', () => {
        const html = render([{ id: 'h', type: 'heading', text: 'Hola' }]);
        expect(html).not.toContain('fonts.googleapis.com');
        expect(html).not.toContain('border-collapse:separate;"><tr><td style="padding:');
    });

    it('tipografía con tamaño, peso, interlineado en px, letras y mayúsculas', () => {
        const html = render([
            {
                id: 'h',
                type: 'heading',
                text: 'Hola',
                style: { font_size: 34, font_weight: 800, line_height: 1.5, letter_spacing: 2, text_transform: 'uppercase', italic: true },
            },
        ]);
        expect(html).toContain('font-size:34px;mso-line-height-rule:exactly;line-height:51px;');
        expect(html).toContain('font-weight:800;');
        expect(html).toContain('letter-spacing:2px;');
        expect(html).toContain('text-transform:uppercase;');
        expect(html).toContain('font-style:italic;');
        // Un título grande se achica en el celular con una clase propia.
        expect(html).toContain('ib-m34');
        expect(html).toMatch(/\.ib-m34\{font-size:28px/);
    });

    it('fuente web: link de Google sólo fuera de Outlook y respaldo forzado para Outlook', () => {
        const html = render([{ id: 't', type: 'heading', text: 'x', style: { font: 'poppins' } }]);
        expect(html).toMatch(/<!--\[if !mso\]><!-->\s*<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Poppins/);
        expect(html).toContain('ib-wf-sans');
        expect(html).toMatch(/<!--\[if mso\]>[\s\S]*\.ib-wf-sans[\s\S]*Arial/);
    });

    it('recuadro: borde por lado, esquinas, sombra y relleno en la celda', () => {
        const html = render([
            {
                id: 't',
                type: 'heading',
                text: 'Caja',
                background: '#fef3c7',
                style: { bg_mode: 'box', border_width: 2, border_style: 'dashed', border_color: '#d97706', border_sides: ['left'], radius: 10, shadow: 'md', padding_top: 20, padding_right: 18, padding_bottom: 20, padding_left: 18, margin_top: 30 },
            },
        ]);
        expect(html).toContain('border-left:2px dashed #d97706;');
        expect(html).not.toContain('border-top:2px dashed');
        expect(html).toContain('border-radius:10px;');
        expect(html).toContain('box-shadow:0 4px 12px');
        expect(html).toContain('padding:20px 18px 20px 18px;background-color:#fef3c7;');
        expect(html).toContain('bgcolor="#fef3c7"');
        expect(html).toMatch(/padding:30px \d+px/);
    });

    it('botón: forma propia (relleno, ancho fijo, borde, sombra) con el relleno en la celda para Outlook', () => {
        const html = render([
            { id: 'b', type: 'button', label: 'Pagar', url: 'https://x.test', btn: { radius: 24, pad_y: 16, pad_x: 40, width: 260, border_width: 2, border_color: '#000000', shadow: 'sm' } },
        ]);
        expect(html).toContain('border-radius:24px;padding:16px 40px;mso-padding-alt:16px 40px;');
        expect(html).toContain('width="260"');
        expect(html).toContain('border-top:2px solid #000000;');
        expect(html).toContain('box-shadow:0 1px 3px');
    });

    it('columnas con proporción, separación, alineación y sin apilar', () => {
        const cols = (extra: Record<string, unknown>): string =>
            render([
                {
                    id: 'c',
                    type: 'columns',
                    ...extra,
                    columns: [
                        { blocks: [{ id: 'a', type: 'heading', text: 'A' }] },
                        { blocks: [{ id: 'b', type: 'heading', text: 'B' }], background: '#eeeeee', style: { border_width: 1 } },
                    ],
                },
            ]);
        const html = cols({ ratio: '1-2', gap: 24, valign: 'middle' });
        const widths = [...html.matchAll(/max-width:(\d+)px;vertical-align:middle/g)].map((m) => Number(m[1]));
        expect(widths).toHaveLength(2);
        expect(widths[1]! / widths[0]!).toBeCloseTo(2, 0);
        expect(html).toContain('margin:0 -12px;');
        expect(html).toContain('background-color:#eeeeee;');
        const fixed = cols({ stack: false });
        expect(fixed).not.toContain('class="ib-col"');
        expect(fixed).toContain('width="50%"');
    });

    it('tema: tamaño base, títulos, enlaces, márgenes y hoja con borde y sombra', () => {
        const html = render(
            [
                { id: 'h', type: 'heading', text: 'T' },
                { id: 't', type: 'text', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hola' }] }] } },
            ],
            { font_size: 17, heading_font: 'merriweather', heading_color: '#123456', content_pad: 40, outer_pad: 10, sheet_border_width: 1, sheet_border_color: '#cccccc', sheet_shadow: 'lg' },
        );
        expect(html).toContain('font-size:17px;');
        expect(html).toContain("'Merriweather'");
        expect(html).toContain('color:#123456;');
        expect(html).toContain('padding:6px 40px');
        expect(html).toContain('box-shadow:0 12px 32px');
        expect(html).toContain('#cccccc');
    });

    it('el texto plano sigue funcionando con estilos', () => {
        const d = emailDesignSchema.parse({ blocks: [{ id: 'h', type: 'heading', text: 'Hola', style: { text_transform: 'uppercase', font: 'lato' } }] });
        expect(renderEmailText(d, { resolve })).toContain('Hola');
    });
});

describe('estilo por bloque — documento', () => {
    it('el documento acepta tema y estilos nuevos', () => {
        const d = docDesignSchema.parse({
            theme: { font: 'playfair', heading_font: 'lora', line_height: 1.4 },
            blocks: [
                { id: 'h', type: 'heading', text: 'x', style: { font_size: 18, border_width: 1, border_sides: ['bottom'] } },
                { id: 'c', type: 'columns', ratio: '2-1', gap: 20, columns: [{ blocks: [], style: { padding_top: 8 } }, { blocks: [] }] },
                { id: 'd', type: 'divider', line_style: 'dotted', length: 40, align: 'right' },
            ],
        });
        expect(d.theme.font).toBe('playfair');
        expect(d.blocks).toHaveLength(3);
    });
});
