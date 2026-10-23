import { describe, expect, it } from 'vitest';

import { operatorsForType } from '@/admin/records/operators';
import { footerIsAggregatable, footerIsNumeric } from '@/admin/records/views/FooterAggregateCell';
import { mapRecord, wrapFormulaErrorsDeep } from '@/lib/api';
import { asDisplayField, displayTypeOfField, isSqlFormula } from '@/lib/fieldTypeCatalog';
import { formulaDeleteWarning } from '@/lib/formulaDependents';
import { isFormulaError } from '@/lib/formulaError';
import { formulaConversionNote, isTransitionAllowed } from '@/lib/fieldTypeMigration';
import type { FieldEntity, FormulaInfo } from '@/types/field';
import { isGroupableField } from '@/types/record';

const info = (patch: Partial<FormulaInfo> = {}): FormulaInfo => ({
    display: '{Precio} * {Cantidad}',
    result_type: 'currency',
    inferred_type: 'currency',
    display_config: { currency: 'COP', precision: 0 },
    sql: true,
    sql_reason: null,
    error: null,
    dependencies: [1, 2],
    ...patch,
});

const field = (patch: Partial<FieldEntity>): FieldEntity =>
    ({
        id: 10,
        list_id: 1,
        slug: 'total',
        label: 'Total',
        type: 'formula',
        config: { formula: '{#1} * {#2}' },
        is_required: false,
        is_unique: false,
        is_primary: false,
        is_indexed: false,
        position: 0,
        created_at: '',
        updated_at: '',
        formula: info(),
        ...patch,
    }) as FieldEntity;

describe('fórmulas en la interfaz (A1)', () => {
    it('se muestra como el tipo de su resultado, con su config', () => {
        const shown = asDisplayField(field({}));
        expect(shown.type).toBe('currency');
        expect(shown.config).toEqual({ currency: 'COP', precision: 0 });
        expect(displayTypeOfField(field({ formula: info({ result_type: 'date' }) }))).toBe('date');
        // Sin la info del servidor, como texto (nunca rompe).
        expect(asDisplayField(field({ formula: null })).type).toBe('text');
    });

    it('filtrar, agrupar y sumar sólo si compila a SQL', () => {
        expect(operatorsForType('formula', field({})).map((o) => o.op)).toContain('gt');
        expect(operatorsForType('formula', field({ formula: info({ result_type: 'text' }) })).map((o) => o.op)).toContain('contains');
        expect(operatorsForType('formula', field({ formula: info({ result_type: 'checkbox' }) })).map((o) => o.op)).toEqual(['eq']);
        expect(operatorsForType('formula', field({ formula: info({ sql: false, sql_reason: 'usa SUMAR_DIAS_HABILES' }) }))).toEqual([]);
        expect(isSqlFormula(field({}))).toBe(true);
        expect(isGroupableField(field({}))).toBe(true);
        expect(isGroupableField(field({ formula: info({ sql: false }) }))).toBe(false);
        expect(footerIsNumeric(field({}))).toBe(true);
        expect(footerIsNumeric(field({ formula: info({ result_type: 'text' }) }))).toBe(false);
        expect(footerIsAggregatable(field({ formula: info({ sql: false }) }))).toBe(false);
    });

    it('una fila con error trae «#ERROR» con el motivo, por slug', () => {
        const rec = mapRecord(
            { id: 5, data: { f1: 3, f10: null }, formula_errors: { f10: 'División por cero.' }, relations: {} },
            { toSlug: { f1: 'cantidad', f10: 'total' }, toFid: {} },
        ) as { fields: Record<string, unknown>; formula_errors?: Record<string, string> };
        expect(rec.formula_errors).toEqual({ total: 'División por cero.' });
        expect(isFormulaError(rec.fields.total)).toBe(true);
        expect(String(rec.fields.total)).toBe('#ERROR');
        // Nunca viaja de vuelta al servidor como valor.
        expect(JSON.stringify({ total: rec.fields.total })).toBe('{"total":null}');
        expect(rec.fields.cantidad).toBe(3);
    });

    it('en los bundles (agrupada, kanban) el error también llega a la fila anidada', () => {
        const payload = { groups: [{ rows: [{ id: 1, fields: { total: null }, formula_errors: { total: 'X' } }] }] };
        wrapFormulaErrorsDeep(payload, 0);
        expect(isFormulaError(payload.groups[0]!.rows[0]!.fields.total)).toBe(true);
    });

    it('borrar un campo avisa qué fórmulas lo usan', () => {
        const precio = field({ id: 1, slug: 'precio', label: 'Precio', type: 'currency', formula: undefined });
        const all = [precio, field({})];
        expect(formulaDeleteWarning(precio, all)).toMatch(/«Total».*#ERROR/);
        expect(formulaDeleteWarning(field({ id: 3 }), all)).toBeNull();
        // También las que lo usan a través de otra fórmula.
        const doble = field({ id: 11, slug: 'doble', label: 'Doble', formula: info({ dependencies: [10] }) });
        expect(formulaDeleteWarning(precio, [...all, doble])).toMatch(/«Total», «Doble»/);
    });

    it('conversión: calculado → fórmula y fórmula → un campo común', () => {
        expect(isTransitionAllowed('computed', 'formula')).toBe(true);
        expect(isTransitionAllowed('formula', 'number')).toBe(true);
        expect(isTransitionAllowed('text', 'formula')).toBe(false);
        expect(formulaConversionNote('formula', 'text')).toMatch(/deja de calcularse/);
        expect(formulaConversionNote('computed', 'formula')).toMatch(/revísala/);
    });
});
