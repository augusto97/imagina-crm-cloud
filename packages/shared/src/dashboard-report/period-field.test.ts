import { describe, expect, it } from 'vitest';

import {
    isPeriodFieldType,
    readDashboardPeriodFields,
    suggestPeriodField,
    widgetPeriodField,
    writeDashboardPeriodFields,
} from './period-field';

const types: Record<number, string> = {
    1: 'date',
    2: 'datetime',
    3: 'select',
    4: 'created_at',
    5: 'currency',
};
const typeOf = (id: number): string | undefined => types[id];

describe('widgetPeriodField', () => {
    it('el campo del período del widget gana a todo', () => {
        expect(widgetPeriodField({ period: { field_id: 2 }, date_field_id: 1, group_by_field_id: 1 }, typeOf, 4)).toEqual({ fieldId: 2, source: 'widget' });
    });

    it('después el campo de fecha (tendencia, delta, pronóstico)', () => {
        expect(widgetPeriodField({ date_field_id: 1, group_by_field_id: 2 }, typeOf)).toEqual({ fieldId: 1, source: 'date' });
    });

    it('un gráfico agrupado por mes se filtra por esa fecha', () => {
        expect(widgetPeriodField({ group_by_field_id: 1, metric: 'sum' }, typeOf)).toEqual({ fieldId: 1, source: 'group' });
    });

    it('agrupar por algo que no es fecha no cuenta; el desglose por fecha sí', () => {
        expect(widgetPeriodField({ group_by_field_id: 3 }, typeOf)).toBeNull();
        expect(widgetPeriodField({ group_by_field_id: 3, sub_group_by_field_id: 4 }, typeOf)).toEqual({ fieldId: 4, source: 'breakdown' });
    });

    it('sin fecha propia, la elegida para la lista en el tablero', () => {
        expect(widgetPeriodField({ metric: 'count' }, typeOf, 2)).toEqual({ fieldId: 2, source: 'dashboard' });
        expect(widgetPeriodField({ group_by_field_id: 3 }, typeOf, 1)).toEqual({ fieldId: 1, source: 'dashboard' });
    });

    it('la elección del tablero tiene que ser una fecha que la persona ve', () => {
        // 5 es moneda; 99 no existe (o está oculto para quien mira).
        expect(widgetPeriodField({ metric: 'count' }, typeOf, 5)).toBeNull();
        expect(widgetPeriodField({ metric: 'count' }, typeOf, 99)).toBeNull();
        expect(widgetPeriodField({ group_by_field_id: 99 }, typeOf)).toBeNull();
    });

    it('ignora ids raros', () => {
        expect(widgetPeriodField({ period: { field_id: -1 }, date_field_id: 'x', group_by_field_id: 1.5 }, typeOf, 0)).toBeNull();
        expect(widgetPeriodField({ period: null }, typeOf, null)).toBeNull();
    });
});

describe('period_fields del tablero', () => {
    it('lee con tolerancia', () => {
        const m = readDashboardPeriodFields({ period_fields: { '12': 7, '13': 'x', abc: 3, '-1': 2, '14': 0, '15': 4.5, '16': 9 } });
        expect([...m]).toEqual([[12, 7], [16, 9]]);
        expect(readDashboardPeriodFields(null).size).toBe(0);
        expect(readDashboardPeriodFields({ period_fields: [1, 2] }).size).toBe(0);
        expect(readDashboardPeriodFields({ other: true }).size).toBe(0);
    });

    it('escribe sin las listas que se dejan sin fecha', () => {
        expect(writeDashboardPeriodFields(new Map<number, number | null>([[12, 7], [13, null], [14, 0]]))).toEqual({ '12': 7 });
    });
});

describe('suggestPeriodField', () => {
    it('prefiere la fecha que suena a «cuándo pasó»', () => {
        expect(suggestPeriodField([
            { id: 1, name: 'Fecha de nacimiento', type: 'date' },
            { id: 2, name: 'Vencimiento', type: 'date' },
            { id: 3, name: 'Fecha de pago', type: 'date' },
            { id: 4, name: 'Creado', type: 'created_at' },
        ])).toBe(3);
    });

    it('sin nombres conocidos, la fecha de creación del registro gana a una fecha cualquiera', () => {
        expect(suggestPeriodField([
            { id: 1, name: 'Otra', type: 'date' },
            { id: 4, name: 'Creación', type: 'created_at' },
        ])).toBe(4);
    });

    it('nunca una de nacimiento si hay otra; a igual puntaje, la primera', () => {
        expect(suggestPeriodField([
            { id: 1, name: 'Cumpleaños', type: 'date' },
            { id: 2, name: 'Algo', type: 'date' },
        ])).toBe(2);
        expect(suggestPeriodField([
            { id: 5, name: 'Uno', type: 'date' },
            { id: 6, name: 'Dos', type: 'date' },
        ])).toBe(5);
    });

    it('sin fechas, null; la última modificación casi nunca', () => {
        expect(suggestPeriodField([{ id: 1, name: 'Monto', type: 'currency' }])).toBeNull();
        expect(suggestPeriodField([
            { id: 1, name: 'Modificado', type: 'updated_at' },
            { id: 2, name: 'Fecha de venta', type: 'date' },
        ])).toBe(2);
    });

    it('reconoce los tipos de fecha', () => {
        expect(isPeriodFieldType('date')).toBe(true);
        expect(isPeriodFieldType('updated_at')).toBe(true);
        expect(isPeriodFieldType('text')).toBe(false);
        expect(isPeriodFieldType(undefined)).toBe(false);
    });
});
