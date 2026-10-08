import { describe, expect, it } from 'vitest';
import { docDesignSchema, type DocBlock } from '@imagina-base/shared';

import { docColumnWidths, pdfFontFamily, renderDocument, type DocRenderInput } from '../src/documents/document-render';

/**
 * v0.1.272 — Estilo por bloque en el PDF (ADR-S37): las fuentes van
 * EMBEBIDAS (el PDF se ve igual en cualquier lado) y el estilo del bloque se
 * aplica. Puro: sin base de datos.
 */
function input(design: unknown): DocRenderInput {
    return {
        design: docDesignSchema.parse(design),
        resolve: (s) => s,
        tagsMode: false,
        fieldLabel: (s) => s,
        fieldValue: () => '',
        items: new Map(),
        totals: new Map(),
        images: new Map(),
        title: 'Prueba',
        author: 'Test',
    };
}

/** Nombres de las fuentes embebidas (`/BaseFont /ABCDEF+Lato-Bold`). */
function embeddedFonts(buf: Buffer): string[] {
    const s = buf.toString('latin1');
    return [...new Set([...s.matchAll(/\/BaseFont \/[A-Z]{6}\+([A-Za-z0-9-]+)/g)].map((m) => m[1]!))].sort();
}

describe('PDF — estilo por bloque', () => {
    it('cada tipografía del catálogo tiene su familia en el PDF (o cae a Roboto)', () => {
        expect(pdfFontFamily('sans')).toBe('Arimo');
        expect(pdfFontFamily('times')).toBe('Tinos');
        expect(pdfFontFamily('playfair')).toBe('Playfair');
        expect(pdfFontFamily(null)).toBe('Roboto');
    });

    it('embebe las fuentes elegidas (documento, títulos y por bloque)', async () => {
        const out = await renderDocument(
            input({
                theme: { font: 'lato', heading_font: 'playfair' },
                blocks: [
                    { id: 'h', type: 'heading', text: 'Cuenta de cobro', level: 1, style: { text_transform: 'uppercase' } },
                    { id: 't', type: 'text', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }] } },
                    { id: 'm', type: 'heading', text: 'Mono', level: 3, style: { font: 'mono', font_weight: 400 } },
                ],
            }),
        );
        expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
        const fonts = embeddedFonts(out.buffer);
        expect(fonts.some((f) => f.startsWith('Lato'))).toBe(true);
        expect(fonts.some((f) => f.startsWith('PlayfairDisplay'))).toBe(true);
        expect(fonts.some((f) => f.startsWith('Cousine'))).toBe(true);
    });

    it('aplica caja, bordes, márgenes y columnas con proporción sin romper el armado', async () => {
        const out = await renderDocument(
            input({
                blocks: [
                    {
                        id: 'h',
                        type: 'heading',
                        text: 'Con borde',
                        background: '#fef3c7',
                        style: { border_width: 2, border_style: 'dashed', border_sides: ['left'], padding_top: 10, padding_left: 14, margin_top: 20, letter_spacing: 1 },
                    },
                    { id: 'd', type: 'divider', line_style: 'dotted', length: 40, align: 'right' },
                    {
                        id: 'c',
                        type: 'columns',
                        ratio: '1-2',
                        gap: 20,
                        columns: [
                            { blocks: [{ id: 'a', type: 'heading', text: 'A' }] },
                            { blocks: [{ id: 'b', type: 'heading', text: 'B' }], background: '#eeeeee', style: { border_width: 1 } },
                        ],
                    },
                ],
            }),
        );
        expect(out.pages).toBe(1);
        expect(out.regions.map((r) => r.id)).toEqual(expect.arrayContaining(['h', 'd', 'c']));
        const h = out.regions.find((r) => r.id === 'h')!;
        // El margen de arriba corre el bloque hacia abajo.
        expect(h.y).toBeGreaterThan(20);
    });

    it('docColumnWidths reparte el ancho según la proporción y descuenta la separación', () => {
        const design = docDesignSchema.parse({
            blocks: [{ id: 'c', type: 'columns', ratio: '1-3', gap: 20, columns: [{ blocks: [] }, { blocks: [] }] }],
        });
        const b = design.blocks[0] as Extract<DocBlock, { type: 'columns' }>;
        const [a, c] = docColumnWidths(b, 420);
        expect(a! + c! + 20).toBeCloseTo(420, 0);
        expect(c! / a!).toBeCloseTo(3, 1);
        // Una proporción que no corresponde a la cantidad de columnas: partes iguales.
        const odd = docColumnWidths({ ...b, ratio: '1-1-2' }, 420);
        expect(odd[0]).toBeCloseTo(odd[1]!, 5);
    });
});
