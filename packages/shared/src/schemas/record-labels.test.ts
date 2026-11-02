import { describe, expect, it } from 'vitest';
import {
    LABEL_PRESETS,
    LABEL_PRESET_KEYS,
    fitLabelText,
    labelInnerLayout,
    labelSlots,
    parseRecordLink,
    recordLabelsSchema,
    recordLinkPath,
} from './record-labels';

describe('v0.1.344 — etiquetas con QR', () => {
    it('cada hoja entra en su página y las etiquetas no se pisan', () => {
        for (const key of LABEL_PRESET_KEYS) {
            const p = LABEL_PRESETS[key];
            const slots = labelSlots(key);
            expect(slots).toHaveLength(p.cols * p.rows);
            for (const s of slots) {
                expect(s.x).toBeGreaterThanOrEqual(0);
                expect(s.y).toBeGreaterThanOrEqual(0);
                expect(s.x + s.w).toBeLessThanOrEqual(p.pageW + 0.5);
                expect(s.y + s.h).toBeLessThanOrEqual(p.pageH + 0.5);
            }
            for (let i = 0; i < slots.length; i++) {
                for (let j = i + 1; j < slots.length; j++) {
                    const a = slots[i]!;
                    const b = slots[j]!;
                    const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
                    expect(overlap).toBe(false);
                }
            }
        }
    });

    it('la hoja Carta de 30 tiene las medidas de una Avery 5160', () => {
        const slots = labelSlots('letter_30');
        expect(slots[0]).toEqual({ x: 13.5, y: 36, w: 189, h: 72 });
        expect(slots[1]!.x).toBe(13.5 + 189 + 9);
        expect(slots[3]!.y).toBe(36 + 72);
    });

    it('etiqueta apaisada: el QR a la izquierda y el texto a la derecha; alta: el QR arriba', () => {
        const wide = labelInnerLayout(189, 72);
        expect(wide.direction).toBe('row');
        expect(wide.qr).toBeLessThanOrEqual(72);
        expect(wide.text.x).toBeGreaterThan(wide.qr);
        expect(wide.text.x + wide.text.w).toBeLessThanOrEqual(189);
        const tall = labelInnerLayout(306, 396);
        expect(tall.direction).toBe('column');
        expect(tall.text.y).toBeGreaterThan(tall.qr);
        expect(tall.titleSize).toBeGreaterThan(wide.titleSize);
    });

    it('el texto largo se corta con «…» para no salirse de la etiqueta', () => {
        expect(fitLabelText('Taza', 100, 9)).toBe('Taza');
        const long = fitLabelText('Camiseta de algodón orgánico con estampado de la colección de verano', 80, 9);
        expect(long.endsWith('…')).toBe(true);
        expect(long.length).toBeLessThan(25);
        expect(fitLabelText('  varios   espacios  ', 200, 9)).toBe('varios espacios');
    });

    it('reconoce el enlace a un registro venga del dominio que venga', () => {
        expect(parseRecordLink('https://base.imagina.cloud/lists/productos/records/42')).toEqual({ listSlug: 'productos', recordId: 42 });
        expect(parseRecordLink('https://crm.acme.co/lists/clientes/records?view=3&record=7')).toEqual({ listSlug: 'clientes', recordId: 7 });
        expect(parseRecordLink('https://x.test/#/lists/a/records/5')).toEqual({ listSlug: 'a', recordId: 5 });
        expect(parseRecordLink(`https://x.test${recordLinkPath('inventario', 9)}`)).toEqual({ listSlug: 'inventario', recordId: 9 });
        expect(parseRecordLink('SKU-001')).toBeNull();
        expect(parseRecordLink('https://x.test/lists/a')).toBeNull();
        expect(parseRecordLink('javascript:alert(1)//lists/a/records/1')).toBeNull();
        expect(parseRecordLink('https://x.test/lists/a/records/0')).toBeNull();
    });

    it('el pedido de etiquetas valida el formato y el tope de datos', () => {
        const ok = recordLabelsSchema.parse({ target: { ids: [1, 2] } });
        expect(ok).toMatchObject({ preset: 'letter_30', content: 'link', show_title: true, show_code: true, skip: 0, field_ids: [] });
        expect(recordLabelsSchema.safeParse({ target: { ids: [1] }, field_ids: [1, 2, 3] }).success).toBe(false);
        expect(recordLabelsSchema.safeParse({ target: { ids: [1] }, preset: 'otra' }).success).toBe(false);
        expect(recordLabelsSchema.safeParse({ target: { ids: [1] }, extra: true }).success).toBe(false);
    });
});
