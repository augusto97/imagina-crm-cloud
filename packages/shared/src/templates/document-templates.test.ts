import { describe, expect, it } from 'vitest';
import { docDesignSchema, formatDocNumber, parseDocDesign } from '../schemas/document-design';
import { DOCUMENT_STARTERS, buildDocumentStarter, emptyIssuer } from './document-templates';

describe('plantillas de documentos (v0.1.266)', () => {
    it('todas validan contra el schema, mapeadas o no', () => {
        for (const s of DOCUMENT_STARTERS) {
            expect(docDesignSchema.safeParse(buildDocumentStarter(s.key).design).success).toBe(true);
        }
    });

    it('cuenta de cobro con los campos elegidos y los datos de quien cobra', () => {
        const issuer = { ...emptyIssuer('Ana Gómez'), doc_number: '1.020.304', city: 'Medellín', bank: 'Bancolombia', account_number: '123-456' };
        const r = buildDocumentStarter('cuenta_cobro', {
            accent: '#123456',
            fields: { cliente: 'razon_social', valor: 'monto', concepto: 'servicio', fecha: null },
            issuer,
        });
        const design = parseDocDesign(r.design)!;
        expect(design.theme.accent).toBe('#123456');
        const json = JSON.stringify(design);
        expect(json).toContain('{{razon_social}}');
        expect(json).toContain('{{servicio}}');
        expect(json).toContain('Medellín, {{date.today|larga}}');
        expect(json).toContain('Bancolombia');
        expect(json).toContain('{{totales.total|pesos|mayusculas}}');
        const totals = design.blocks.find((b) => b.type === 'totals');
        expect(totals && totals.type === 'totals' && totals.rows[0]!.source).toEqual({ kind: 'field', slug: 'monto' });
        expect(r.filename).toBe('Cuenta de cobro {{documento.numero}} - {{razon_social}}');
        // Sin un campo "número" propio, numera sola.
        expect(design.numbering).toMatchObject({ enabled: true, padding: 4 });
        const own = parseDocDesign(buildDocumentStarter('cuenta_cobro', { fields: { numero: 'consecutivo' } }).design)!;
        expect(own.numbering.enabled).toBe(false);
        expect(JSON.stringify(own)).toContain('N.º {{consecutivo}}');
    });

    it('lo que no se mapea queda como un marcador visible', () => {
        const json = JSON.stringify(buildDocumentStarter('cuenta_cobro').design);
        expect(json).toContain('[Nombre del cliente]');
        expect(json).not.toMatch(/\{\{cliente\}\}/);
    });

    it('con detalle: tabla de ítems sobre la relación elegida y total sumado de la columna', () => {
        const r = buildDocumentStarter('cuenta_cobro_detalle', {
            fields: { cliente: 'nombre' },
            items: {
                source: { relation_field_id: 9, direction: 'reverse', list_id: 4 },
                fields: { descripcion: 'detalle', total: 'valor' },
            },
        });
        const items = r.design.blocks.find((b) => b.type === 'items');
        expect(items && items.type === 'items' && items.columns.map((c) => c.slug)).toEqual(['detalle', 'valor']);
        const totals = r.design.blocks.find((b) => b.type === 'totals');
        expect(totals && totals.type === 'totals' && totals.rows[0]!.source).toEqual({ kind: 'items_sum', block_id: 'items', slug: 'valor' });
    });

    it('v0.1.267 — número con prefijo y ceros, y el bloque QR valida (también en columnas)', () => {
        expect(formatDocNumber(42, { prefix: 'CC-', padding: 4 })).toBe('CC-0042');
        expect(formatDocNumber(12345, { prefix: '', padding: 3 })).toBe('12345');
        const d = parseDocDesign({
            blocks: [
                { id: 'q', type: 'qr', value: '{{pago.link}}', caption: 'Escaneá para pagar' },
                { id: 'c', type: 'columns', columns: [{ blocks: [{ id: 'q2', type: 'qr', value: 'x' }] }, { blocks: [] }] },
            ],
        })!;
        expect(d.blocks[0]).toMatchObject({ type: 'qr', size: 96, align: 'left' });
        expect(d.numbering).toEqual({ enabled: false, prefix: '', padding: 4, start: 1, save_field: null });
    });
});
