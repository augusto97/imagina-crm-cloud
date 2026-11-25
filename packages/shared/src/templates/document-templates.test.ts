import { describe, expect, it } from 'vitest';
import { docDesignSchema, formatDocNumber, parseDocDesign } from '../schemas/document-design';
import { DOCUMENT_STARTERS, buildDocumentStarter, emptyIssuer, isClosedStatusOption, pendingItemsFilter } from './document-templates';

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
                { id: 'q', type: 'qr', value: '{{pago.link}}', caption: 'Escanea para pagar' },
                { id: 'c', type: 'columns', columns: [{ blocks: [{ id: 'q2', type: 'qr', value: 'x' }] }, { blocks: [] }] },
            ],
        })!;
        expect(d.blocks[0]).toMatchObject({ type: 'qr', size: 96, align: 'left' });
        expect(d.numbering).toEqual({ enabled: false, prefix: '', padding: 4, start: 1, save_field: null });
    });
});

describe('estado de cuenta (v0.1.468)', () => {
    const estado = {
        id: 31,
        type: 'select',
        label: 'Estado',
        config: {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'pagada', label: 'Pagada' },
                { value: 'parcial', label: 'Pagada parcialmente' },
                { value: 'anulada', label: 'ANULADA' },
                { value: 'no_pagada', label: 'No pagada' },
            ],
        },
    };
    const source = { relation_field_id: 9, direction: 'reverse' as const, list_id: 4 };

    it('reconoce las opciones cerradas sin tildes ni mayúsculas, salvo las que todavía deben', () => {
        const closed = estado.config.options.filter(isClosedStatusOption).map((o) => o.value);
        expect(closed).toEqual(['pagada', 'anulada']);
        expect(isClosedStatusOption({ value: 'x', label: 'Cancelada' })).toBe(true);
        expect(isClosedStatusOption({ value: 'al_dia', label: 'Al día' })).toBe(true);
        expect(isClosedStatusOption({ value: 'abono', label: 'Abonada' })).toBe(false);
    });

    it('filtra lo pendiente: sin las cerradas; sin cerradas, las pendientes; sin estado, saldo > 0', () => {
        expect(pendingItemsFilter(estado, null)).toEqual({
            type: 'group',
            logic: 'and',
            children: [{ type: 'condition', field_id: 31, op: 'nin', value: ['pagada', 'anulada'] }],
        });
        const onlyOpen = {
            ...estado,
            config: { options: [{ value: 'por_cobrar', label: 'Por cobrar' }, { value: 'en_mora', label: 'En mora' }, { value: 'otro', label: 'Otro' }] },
        };
        expect(pendingItemsFilter(onlyOpen, null)?.children).toEqual([{ type: 'condition', field_id: 31, op: 'in', value: ['por_cobrar', 'en_mora'] }]);
        expect(pendingItemsFilter(null, { id: 40, type: 'rollup' })?.children).toEqual([{ type: 'condition', field_id: 40, op: 'gt', value: 0 }]);
        expect(pendingItemsFilter(null, null)).toBeNull();
    });

    it('arma la tabla de facturas pendientes, el total pendiente y los datos de quien emite y del cliente', () => {
        const issuer = { ...emptyIssuer('Estudio Norte SAS'), doc_label: 'NIT', doc_number: '900.123.456-7', city: 'Cali' };
        const r = buildDocumentStarter('estado_cuenta', {
            fields: { cliente: 'razon_social', cliente_doc: 'nit', correo: 'correo' },
            items: {
                source,
                fields: { numero: 'num', fecha: 'emitida', vencimiento: 'vence', estado: 'estado', valor: 'valor', saldo: 'saldo' },
                info: { estado, saldo: { id: 33, type: 'currency' } },
            },
            issuer,
        });
        const design = parseDocDesign(r.design)!;
        expect(docDesignSchema.safeParse(design).success).toBe(true);
        const header = design.blocks.find((b) => b.type === 'header');
        expect(header && header.type === 'header' && header.title).toBe('ESTADO DE CUENTA');
        expect(header && header.type === 'header' && header.date).toBe('Cali, {{date.today|larga}}');
        const json = JSON.stringify(design);
        expect(json).toContain('Estudio Norte SAS');
        expect(json).toContain('{{razon_social}}');
        expect(json).toContain('{{nit}}');
        expect(json).toContain('Estado de cuenta al ');
        const items = design.blocks.find((b) => b.type === 'items');
        if (!items || items.type !== 'items') throw new Error('sin tabla');
        expect(items.source).toEqual(source);
        expect(items.columns.map((c) => c.slug)).toEqual(['num', 'emitida', 'vence', 'estado', 'valor', 'saldo']);
        expect(items.sort).toEqual({ slug: 'vence', dir: 'asc' });
        expect(items.filter_tree?.children).toEqual([{ type: 'condition', field_id: 31, op: 'nin', value: ['pagada', 'anulada'] }]);
        const totals = design.blocks.find((b) => b.type === 'totals');
        if (!totals || totals.type !== 'totals') throw new Error('sin totales');
        const total = totals.rows.find((row) => row.id === 'total')!;
        expect(total.label).toBe('TOTAL PENDIENTE');
        expect(total.source).toEqual({ kind: 'items_sum', block_id: 'items', slug: 'saldo' });
        expect(design.numbering.enabled).toBe(false);
        expect(r.filename).toBe('Estado de cuenta - {{razon_social}} - {{date.today|value}}');
    });

    it('con lo pagado y sin saldo, el pendiente es facturado − pagado; sin estado, sin filtro', () => {
        const r = buildDocumentStarter('estado_cuenta', {
            fields: { cliente: 'nombre' },
            items: { source, fields: { valor: 'valor', pagado: 'abonos' } },
        });
        const totals = r.design.blocks.find((b) => b.type === 'totals');
        if (!totals || totals.type !== 'totals') throw new Error('sin totales');
        expect(totals.rows.map((row) => row.id)).toEqual(['facturado', 'pagado', 'total']);
        expect(totals.rows[2]!.source).toEqual({ kind: 'sum', rows: ['facturado'], minus: ['pagado'] });
        const items = r.design.blocks.find((b) => b.type === 'items');
        expect(items && items.type === 'items' && items.filter_tree).toBeUndefined();
    });

    it('lo que no se mapea queda como «[Rol]» visible', () => {
        const json = JSON.stringify(buildDocumentStarter('estado_cuenta').design);
        expect(json).toContain('[Nombre del cliente]');
        expect(json).toContain('[Número de la factura]');
        expect(json).toContain('[Fecha de vencimiento]');
        expect(json).toContain('[Elige la columna del valor]');
    });
});
