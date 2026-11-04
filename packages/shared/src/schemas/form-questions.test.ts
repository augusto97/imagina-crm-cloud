import { describe, expect, it } from 'vitest';

import {
    buildPublicFormItems,
    effectiveFormDisplay,
    formConfigSchema,
    formDisplaysFor,
    formatRankingText,
    matrixCellValue,
    rankingTextOptions,
    resolveFormRange,
    type FormFieldLike,
    type PublicFormFieldItem,
    type PublicFormMatrixItem,
} from './form';
import { formAnswered, formItemVisible, formPageVisible, formRangeAccepts, formScaleValues, splitFormPages } from './form-logic';

/** v0.1.355 — Tipos de pregunta nuevos: escala, deslizador, sí/no, firma, ordenar, buscador, «Otro» y matriz. */

const FIELDS: FormFieldLike[] = [
    { id: 1, slug: 'nps', label: 'Recomendación', type: 'number', config: {}, is_required: false },
    { id: 2, slug: 'acepta', label: '¿Acepta?', type: 'checkbox', config: {}, is_required: false },
    {
        id: 3,
        slug: 'canal',
        label: 'Canal',
        type: 'select',
        config: {
            options: [
                { value: 'web', label: 'Web' },
                { value: 'otro', label: 'Otro' },
            ],
        },
        is_required: false,
    },
    { id: 4, slug: 'canal_otro', label: 'Canal (otro)', type: 'text', config: {}, is_required: false },
    { id: 5, slug: 'prioridades', label: 'Prioridades', type: 'long_text', config: {}, is_required: false },
    {
        id: 6,
        slug: 'atencion',
        label: 'Atención',
        type: 'select',
        config: {
            options: [
                { value: 'malo', label: 'Malo' },
                { value: 'bueno', label: 'Bueno' },
            ],
        },
        is_required: false,
    },
    { id: 7, slug: 'rapidez', label: 'Rapidez', type: 'rating', config: { max: 5 }, is_required: false },
    { id: 8, slug: 'firma', label: 'Firma', type: 'file', config: {}, is_required: false },
    { id: 9, slug: 'presupuesto', label: 'Presupuesto', type: 'currency', config: { currency: 'COP', max: 5_000_000 }, is_required: false },
];

function config(items: unknown[]) {
    return formConfigSchema.parse({ items, settings: {} });
}

describe('formas de preguntar', () => {
    it('cada tipo admite sólo sus formas; una que no corresponde se lee como auto', () => {
        expect(formDisplaysFor('number')).toContain('scale');
        expect(formDisplaysFor('checkbox')).toEqual(['auto', 'yes_no']);
        expect(formDisplaysFor('multi_select')).toContain('ranking');
        expect(formDisplaysFor('multi_select')).not.toContain('dropdown');
        expect(effectiveFormDisplay('signature', 'text')).toBe('auto');
        expect(effectiveFormDisplay('scale', 'number', false, true)).toBe('auto');
        // Un valor desconocido de una versión futura no rompe el formulario.
        const c = config([{ id: 'aaaa1', type: 'field', field_id: 1, display: 'holograma' }]);
        expect(c.items[0]!.type === 'field' && c.items[0]!.display).toBe('auto');
    });

    it('la escala del NPS va de 0 a 10 y no pasa de 11 botones', () => {
        const r = resolveFormRange('scale', 'number', {}, { min: 0, max: 10, step: 1 });
        expect(formScaleValues(r)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const big = resolveFormRange('scale', 'number', {}, { min: 1, max: 100, step: 1 });
        expect(formScaleValues(big)).toHaveLength(11);
        expect(formRangeAccepts('scale', r, 7)).toBe(true);
        expect(formRangeAccepts('scale', r, 7.5)).toBe(false);
        expect(formRangeAccepts('scale', r, 11)).toBe(false);
    });

    it('el rango nunca sale de lo que el campo acepta', () => {
        const rating = resolveFormRange('slider', 'rating', { max: 5 }, { min: 0, max: 9 });
        expect(rating.max).toBe(5);
        const pct = resolveFormRange('slider', 'percent', {}, null);
        expect([pct.min, pct.max]).toEqual([0, 100]);
        const money = resolveFormRange('slider', 'currency', { max: 5_000_000 }, null);
        expect(money.max).toBe(5_000_000);
        expect(formRangeAccepts('slider', money, 6_000_000)).toBe(false);
    });

    it('«Sí / No»: el «No» también es una respuesta', () => {
        expect(formAnswered('yes_no', false)).toBe(true);
        expect(formAnswered('yes_no', null)).toBe(false);
        expect(formAnswered('radio', false)).toBe(false);
    });
});

describe('preguntas públicas', () => {
    it('arma la escala, el sí/no, la firma, el ordenar y el «Otro» que ve el visitante', () => {
        const c = config([
            { id: 'aaaa1', type: 'field', field_id: 1, display: 'scale', range: { min: 0, max: 10, low_label: 'Nada probable' } },
            { id: 'aaaa2', type: 'field', field_id: 2, display: 'yes_no', yes_label: 'Claro' },
            { id: 'aaaa3', type: 'field', field_id: 3, other_option: 'otro', other_field_id: 4, other_placeholder: '¿Cuál canal?' },
            { id: 'aaaa4', type: 'field', field_id: 5, display: 'ranking', ranking_options: ['Precio', ' Calidad ', 'Precio', ''] },
            { id: 'aaaa5', type: 'field', field_id: 8, display: 'signature', accept: 'any' },
        ]);
        const items = buildPublicFormItems(c, FIELDS) as PublicFormFieldItem[];
        const [nps, yes, canal, rank, sign] = items;
        expect(nps!.display).toBe('scale');
        expect(nps!.range).toMatchObject({ min: 0, max: 10, low_label: 'Nada probable' });
        expect(yes!.display).toBe('yes_no');
        expect([yes!.yes_label, yes!.no_label]).toEqual(['Claro', 'No']);
        expect(canal!.other).toEqual({ value: 'otro', key: '4', placeholder: '¿Cuál canal?' });
        expect(rank!.display).toBe('ranking');
        expect(rank!.ranking!.map((o) => o.value)).toEqual(['Precio', 'Calidad']);
        expect(sign!.display).toBe('signature');
        expect(sign!.config.max_files).toBe(1);
        expect(sign!.config.accept).toContain('.png');
    });

    it('ordenar con menos de dos opciones vuelve a la casilla de siempre', () => {
        const c = config([{ id: 'aaaa1', type: 'field', field_id: 5, display: 'ranking', ranking_options: ['Sólo una'] }]);
        const [item] = buildPublicFormItems(c, FIELDS) as PublicFormFieldItem[];
        expect(item!.display).toBe('radio');
        expect(item!.ranking).toBeUndefined();
    });

    it('«Otro» sin opción en el campo, o hacia un campo que no es texto, no aparece', () => {
        const c = config([
            { id: 'aaaa1', type: 'field', field_id: 3, other_option: 'no_existe', other_field_id: 4 },
            { id: 'aaaa2', type: 'field', field_id: 6, other_option: 'malo', other_field_id: 7 },
        ]);
        const items = buildPublicFormItems(c, FIELDS) as PublicFormFieldItem[];
        expect(items.every((i) => i.other === undefined)).toBe(true);
    });

    it('la agenda sólo dibuja las formas de las opciones', () => {
        const c = config([
            { id: 'aaaa1', type: 'field', field_id: 1, display: 'scale' },
            { id: 'aaaa2', type: 'matrix', rows: [{ field_id: 6 }], columns: [{ value: 'Malo' }, { value: 'Bueno' }] },
        ]);
        const items = buildPublicFormItems(c, FIELDS, [], { basicDisplays: true });
        expect(items).toHaveLength(1);
        expect((items[0] as PublicFormFieldItem).display).toBe('radio');
    });
});

describe('matriz', () => {
    it('cada columna guarda la opción por valor o por nombre, o el número', () => {
        expect(matrixCellValue(FIELDS[5]!, { value: 'Bueno' })).toBe('bueno');
        expect(matrixCellValue(FIELDS[5]!, { value: 'malo' })).toBe('malo');
        expect(matrixCellValue(FIELDS[5]!, { value: 'Excelente' })).toBeNull();
        expect(matrixCellValue(FIELDS[6]!, { value: '4' })).toBe(4);
        expect(matrixCellValue(FIELDS[6]!, { value: '9' })).toBeNull();
    });

    it('arma filas con lo que guarda cada columna; las filas de otro tipo de respuesta quedan afuera', () => {
        const c = config([
            {
                id: 'mmmm1',
                type: 'matrix',
                label: '¿Cómo nos fue?',
                required: true,
                rows: [{ field_id: 6 }, { field_id: 7, label: 'Qué tan rápido' }, { field_id: 4 }],
                columns: [
                    { value: 'Malo', label: 'Malo' },
                    { value: 'Bueno', label: 'Bueno' },
                ],
            },
        ]);
        const [m] = buildPublicFormItems(c, FIELDS) as PublicFormMatrixItem[];
        expect(m!.type).toBe('matrix');
        expect(m!.multiple).toBe(false);
        expect(m!.rows.map((r) => r.label)).toEqual(['Atención', 'Qué tan rápido']);
        expect(m!.rows[0]!.values).toEqual(['malo', 'bueno']);
        // «Malo»/«Bueno» no son números: esa fila no puede guardar ninguna columna.
        expect(m!.rows[1]!.values).toEqual([null, null]);
    });

    it('una pregunta puede depender de una fila de la matriz', () => {
        const c = config([
            { id: 'mmmm1', type: 'matrix', rows: [{ field_id: 6 }], columns: [{ value: 'Malo' }, { value: 'Bueno' }] },
            { id: 'aaaa1', type: 'field', field_id: 5, show_if: { field_id: 6, op: 'eq', value: 'malo' } },
        ]);
        const pub = buildPublicFormItems(c, FIELDS);
        const norm = pub.map((i) => ({
            type: i.type,
            field_id: i.type === 'field' ? Number(i.key) : undefined,
            rows: i.type === 'matrix' ? i.rows : undefined,
            show_if: i.show_if,
        }));
        const q = pub[1]!;
        expect(formItemVisible(q, norm, { '6': 'bueno' })).toBe(false);
        expect(formItemVisible(q, norm, { '6': 'malo' })).toBe(true);
        // Una página sólo con una matriz se muestra (es una pregunta).
        const pages = splitFormPages(pub);
        expect(formPageVisible(pages[0]!, pub, {})).toBe(true);
    });
});

describe('ordenar en un campo de texto', () => {
    it('limpia las opciones y escribe el orden de forma legible', () => {
        expect(rankingTextOptions(['  A ', 'B', 'A', '', 'C'])).toEqual(['A', 'B', 'C']);
        expect(formatRankingText(['Precio', 'Calidad'], false)).toBe('1. Precio · 2. Calidad');
        expect(formatRankingText(['Precio', 'Calidad'], true)).toBe('1. Precio\n2. Calidad');
    });
});
