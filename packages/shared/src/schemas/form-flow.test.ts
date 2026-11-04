import { describe, expect, it } from 'vitest';

import { buildPublicFormItems, formCalcIsLive, formCalcsForLogic, formConfigSchema, formEstimateMinutes, formRecallMap, type FormFieldLike } from './form';
import { formAnswerText, formCalcPartValue, formCalcValues, formConditionMet, formEndingFor, formFlow, formItemVisible, formRecallSlugs, formRecallText, withFormCalcValues } from './form-logic';

/** v0.1.356 — Lógica: reglas Y/O, saltos entre páginas, pantallas finales y recordar respuestas. */

const FIELDS: FormFieldLike[] = [
    { id: 1, slug: 'nombre', label: 'Nombre', type: 'text', config: {}, is_required: false },
    {
        id: 2,
        slug: 'tipo',
        label: 'Tipo',
        type: 'select',
        config: {
            options: [
                { value: 'persona', label: 'Persona' },
                { value: 'empresa', label: 'Empresa' },
            ],
        },
        is_required: false,
    },
    { id: 3, slug: 'nit', label: 'NIT', type: 'text', config: {}, is_required: false },
    { id: 4, slug: 'edad', label: 'Edad', type: 'number', config: {}, is_required: false },
    { id: 5, slug: 'empleados', label: 'Empleados', type: 'number', config: {}, is_required: false },
    { id: 6, slug: 'comentario', label: 'Comentario', type: 'long_text', config: {}, is_required: false },
    { id: 7, slug: 'acepta', label: 'Acepta', type: 'checkbox', config: {}, is_required: false },
];

const q = (id: string, field_id: number, extra: Record<string, unknown> = {}) => ({ id, type: 'field', field_id, ...extra });

/** Página 1: nombre, tipo, edad · Página 2 (p2): NIT, empleados · Página 3 (p3): comentario. */
function config(settings: Record<string, unknown> = {}, extraItems: unknown[] = []) {
    return formConfigSchema.parse({
        items: [
            q('aaaa1', 1),
            q('aaaa2', 2),
            q('aaaa3', 4),
            { id: 'pbrk2', type: 'page_break', title: 'Tu empresa' },
            q('bbbb1', 3),
            q('bbbb2', 5),
            { id: 'pbrk3', type: 'page_break', title: 'Algo más' },
            q('cccc1', 6),
            ...extraItems,
        ],
        settings,
    });
}

const pub = (c: ReturnType<typeof config>) => buildPublicFormItems(c, FIELDS);

describe('varias condiciones (Y / O)', () => {
    const items = pub(
        formConfigSchema.parse({
            items: [
                q('aaaa1', 2),
                q('aaaa2', 4),
                q('aaaa3', 3, {
                    show_if: {
                        match: 'all',
                        rules: [
                            { field_id: 2, op: 'eq', value: 'empresa' },
                            { field_id: 4, op: 'gt', value: 17 },
                        ],
                    },
                }),
                q('aaaa4', 6, {
                    show_if: {
                        match: 'any',
                        rules: [
                            { field_id: 2, op: 'eq', value: 'empresa' },
                            { field_id: 4, op: 'lt', value: 18 },
                        ],
                    },
                }),
            ],
            settings: {},
        }),
    );
    const norm = items.map((i) => ({ ...i, field_id: i.type === 'field' ? Number(i.key) : undefined }));
    const nit = items[2]!;
    const com = items[3]!;

    it('«todas» exige cada regla; «alguna», al menos una', () => {
        expect(formItemVisible(nit, norm, { '2': 'empresa', '4': 30 })).toBe(true);
        expect(formItemVisible(nit, norm, { '2': 'empresa', '4': 10 })).toBe(false);
        expect(formItemVisible(com, norm, { '2': 'persona', '4': 10 })).toBe(true);
        expect(formItemVisible(com, norm, { '2': 'persona', '4': 30 })).toBe(false);
    });

    it('una condición suelta sigue valiendo como siempre', () => {
        const c = formConfigSchema.parse({ items: [q('aaaa1', 2), q('aaaa2', 3, { show_if: { field_id: 2, op: 'eq', value: 'empresa' } })], settings: {} });
        const it2 = pub(c).map((i) => ({ ...i, field_id: i.type === 'field' ? Number(i.key) : undefined }));
        expect(formConditionMet(it2[1]!.show_if!, it2, { '2': 'empresa' })).toBe(true);
        expect(formConditionMet(it2[1]!.show_if!, it2, { '2': 'persona' })).toBe(false);
    });
});

describe('saltos entre páginas', () => {
    it('sin saltos recorre todas las páginas', () => {
        const c = config();
        const f = formFlow(pub(c), {}, c.settings.jumps);
        expect(f.path).toEqual([0, 1, 2]);
        expect(f.shown('bbbb1')).toBe(true);
    });

    it('«Persona» salta la página de la empresa y su respuesta vieja no cuenta', () => {
        const c = config({
            jumps: [{ id: 'jjjj1', from: 'start', when: { field_id: 2, op: 'eq', value: 'persona' }, to: 'pbrk3' }],
        });
        const items = pub(c);
        // Llenó el NIT, volvió atrás y cambió a «Persona».
        const f = formFlow(items, { '2': 'persona', '3': '900123' }, c.settings.jumps);
        expect(f.path).toEqual([0, 2]);
        expect(f.shown('bbbb1')).toBe(false);
        expect(f.shown('cccc1')).toBe(true);
        // Con «Empresa» pasa por todas.
        expect(formFlow(items, { '2': 'empresa' }, c.settings.jumps).path).toEqual([0, 1, 2]);
    });

    it('una condición sobre una pregunta de una página saltada no se cumple', () => {
        const c = config({ jumps: [{ id: 'jjjj1', from: 'start', when: { field_id: 2, op: 'eq', value: 'persona' }, to: 'pbrk3' }] }, []);
        const c2 = formConfigSchema.parse({
            ...c,
            items: [...c.items.slice(0, -1), q('cccc1', 6, { show_if: { field_id: 3, op: 'is_not_empty' } })],
        });
        const f = formFlow(pub(c2), { '2': 'persona', '3': '900123' }, c2.settings.jumps);
        // La página 3 sólo tenía esa pregunta, que depende del NIT: queda sin nada a la vista.
        expect(f.path).toEqual([0]);
    });

    it('terminar antes: «Menor de edad» termina en su pantalla final', () => {
        const c = config({
            jumps: [{ id: 'jjjj1', from: 'start', when: { field_id: 4, op: 'lt', value: 18 }, to: 'ending:fin01' }],
            endings: [{ id: 'fin01', name: 'Menores', title: 'Lo sentimos', message: 'Es sólo para mayores de edad.', when: null }],
        });
        const items = pub(c);
        const values = { '4': 15 };
        const f = formFlow(items, values, c.settings.jumps);
        expect(f.path).toEqual([0]);
        expect(f.endedEarly).toBe(true);
        expect(formEndingFor(c.settings.endings, items, values, f)?.title).toBe('Lo sentimos');
        // Un adulto sigue y ve el «¡Gracias!» de siempre (la pantalla sin condición no se elige sola).
        const f2 = formFlow(items, { '4': 30 }, c.settings.jumps);
        expect(f2.path).toEqual([0, 1, 2]);
        expect(formEndingFor(c.settings.endings, items, { '4': 30 }, f2)).toBeNull();
    });

    it('nunca salta hacia atrás (un salto así se ignora)', () => {
        const c = config({ jumps: [{ id: 'jjjj1', from: 'pbrk3', when: null, to: 'pbrk2' }] });
        expect(formFlow(pub(c), {}, c.settings.jumps).path).toEqual([0, 1, 2]);
    });
});

describe('pantallas finales por condición', () => {
    it('la primera que se cumple gana', () => {
        const c = config({
            endings: [
                { id: 'fin01', title: 'Te contactamos pronto', message: '', when: { field_id: 5, op: 'gt', value: 50 } },
                { id: 'fin02', title: 'Gracias, empresa', message: '', when: { field_id: 2, op: 'eq', value: 'empresa' } },
            ],
        });
        const items = pub(c);
        const pick = (v: Record<string, unknown>) => formEndingFor(c.settings.endings, items, v, formFlow(items, v, c.settings.jumps))?.id ?? null;
        expect(pick({ '2': 'empresa', '5': 200 })).toBe('fin01');
        expect(pick({ '2': 'empresa', '5': 10 })).toBe('fin02');
        expect(pick({ '2': 'persona' })).toBeNull();
    });

    it('un elemento roto de la lista se descarta sin tirar los demás', () => {
        const c = config({
            endings: [{ id: 'X', title: 'mal' }, { id: 'fin02', title: 'Bien' }],
            jumps: [{ id: 'jjjj1', from: 'start', to: '../hack' }, { id: 'jjjj2', from: 'start', to: 'end' }],
        });
        expect(c.settings.endings.map((e) => e.id)).toEqual(['fin02']);
        expect(c.settings.jumps.map((j) => j.id)).toEqual(['jjjj2']);
    });
});

describe('recordar respuestas', () => {
    it('reemplaza {{nombre}} con la respuesta y usa lo de después de la barra si no respondió', () => {
        expect(formRecallSlugs('Hola {{nombre}}, ¿y {{ tipo | tu tipo }}?')).toEqual(['nombre', 'tipo']);
        const r = (slug: string) => (slug === 'nombre' ? 'Ana' : '');
        expect(formRecallText('Hola {{nombre}}', r)).toBe('Hola Ana');
        expect(formRecallText('Hola {{tipo|amigo}}', r)).toBe('Hola amigo');
        expect(formRecallText('Hola {{otro}}.', r)).toBe('Hola .');
    });

    it('la respuesta se escribe como la lee una persona', () => {
        const c = formConfigSchema.parse({
            items: [q('aaaa1', 2), q('aaaa2', 7, { display: 'yes_no', yes_label: 'Claro' }), q('aaaa3', 4)],
            settings: {},
        });
        const items = pub(c);
        expect(formAnswerText(items, '2', { '2': 'empresa' })).toBe('Empresa');
        expect(formAnswerText(items, '7', { '7': true })).toBe('Claro');
        expect(formAnswerText(items, '4', { '4': 1500 }, (n) => n.toLocaleString('es-CO'))).toBe('1.500');
        expect(formAnswerText(items, '4', {})).toBe('');
    });

    it('sólo viajan los nombres usados en los textos y que el formulario pregunta', () => {
        const c = formConfigSchema.parse({
            items: [q('aaaa1', 1, { hidden: true }), q('aaaa2', 2, { label: '¿{{nombre}}, eres persona o empresa?' }), { id: 'hhhh1', type: 'heading', text: 'Hola {{nit}} {{nombre}}' }],
            settings: { endings: [{ id: 'fin01', title: 'Gracias, {{nombre|amigo}}', when: null }] },
        });
        // `nit` no se pregunta: no viaja.
        expect(formRecallMap(c, FIELDS)).toEqual({ nombre: '1' });
    });
});

describe('v0.1.357 — cálculos y puntaje', () => {
    const calcConfig = (settings: Record<string, unknown> = {}) =>
        formConfigSchema.parse({
            items: [
                q('aaaa1', 2),
                q('aaaa2', 7, { display: 'yes_no' }),
                q('aaaa3', 4),
                { id: 'pbrk2', type: 'page_break', title: 'Empresa' },
                q('bbbb1', 5),
                { id: 'pbrk3', type: 'page_break', title: 'Final' },
                q('cccc1', 6),
            ],
            settings: {
                calcs: [
                    {
                        id: 'calc1',
                        key: 'puntaje',
                        name: 'Puntaje',
                        start: 1,
                        parts: [
                            { field_id: 2, points: { empresa: 5, persona: 1 } },
                            { field_id: 7, points: { true: 3, false: -1 } },
                            { field_id: 5, multiplier: 0.5 },
                        ],
                    },
                ],
                ...settings,
            },
        });

    it('suma por opción, Sí/No y factor; lo de una página saltada no cuenta', () => {
        const c = calcConfig();
        const items = pub(c);
        const calcs = formCalcsForLogic(c);
        const all = formFlow(items, { '2': 'empresa', '7': true, '5': 10 }, c.settings.jumps, calcs);
        expect(all.calcs.puntaje).toBe(1 + 5 + 3 + 5);
        // El «No» también es una respuesta (resta).
        expect(formFlow(items, { '2': 'persona', '7': false }, [], calcs).calcs.puntaje).toBe(1 + 1 - 1);
        // Con un salto que deja afuera la página de empleados, esos puntos no cuentan.
        const jumps = [{ id: 'jjjj1', from: 'start', when: { field_id: 2, op: 'eq', value: 'persona' }, to: 'pbrk3' } as const];
        expect(formFlow(items, { '2': 'persona', '7': true, '5': 10 }, jumps as never, calcs).calcs.puntaje).toBe(1 + 1 + 3);
    });

    it('un salto y una pantalla final pueden mirar el puntaje', () => {
        const c = calcConfig({
            jumps: [{ id: 'jjjj1', from: 'start', when: { calc: 'puntaje', op: 'gt', value: 7 }, to: 'pbrk3' }],
            endings: [
                { id: 'fin01', title: 'Excelente', when: { calc: 'puntaje', op: 'gt', value: 7 } },
                { id: 'fin02', title: 'Bien', when: { match: 'all', rules: [{ calc: 'puntaje', op: 'gt', value: 2 }, { field_id: 2, op: 'eq', value: 'persona' }] } },
            ],
        });
        const items = pub(c);
        const calcs = formCalcsForLogic(c);
        const high = { '2': 'empresa', '7': true };
        const f1 = formFlow(items, high, c.settings.jumps, calcs);
        expect(f1.path).toEqual([0, 2]);
        expect(formEndingFor(c.settings.endings, items, high, f1)?.id).toBe('fin01');
        const mid = { '2': 'persona', '7': true };
        const f2 = formFlow(items, mid, c.settings.jumps, calcs);
        expect(f2.path).toEqual([0, 1, 2]);
        expect(formEndingFor(c.settings.endings, items, mid, f2)?.id).toBe('fin02');
    });

    it('parte por parte: varias opciones se suman y sin respuesta no suma', () => {
        expect(formCalcPartValue({ key: '1', points: { a: 2, b: 3 }, multiplier: null }, ['a', 'b', 'x'])).toBe(5);
        expect(formCalcPartValue({ key: '1', points: { a: 2 }, multiplier: null }, null)).toBe(0);
        expect(formCalcPartValue({ key: '1', points: { '9': 4 }, multiplier: null }, 9)).toBe(4);
        expect(formCalcPartValue({ key: '1', points: {}, multiplier: 2 }, '1.5')).toBe(3);
        // 0,1 + 0,2 da 0,3 (redondeado).
        const v = formCalcValues([{ key: 'k', start: 0.1, parts: [{ key: '1', points: { a: 0.2 }, multiplier: null }] }], { '1': 'a' }, () => true);
        expect(v.k).toBe(0.3);
    });

    it('`{{puntaje}}` viaja en el mapa de recuerdos; sólo se manda a la página si se usa mientras se responde', () => {
        const c = calcConfig({ endings: [{ id: 'fin01', title: 'Sacaste {{puntaje}}', when: null }] });
        expect(formRecallMap(c, FIELDS)).toEqual({ puntaje: 'calc:puntaje' });
        expect(formCalcIsLive(c, 'puntaje')).toBe(false);
        const live = calcConfig({ description: 'Vas {{puntaje}} puntos' });
        expect(formCalcIsLive(live, 'puntaje')).toBe(true);
        const byJump = calcConfig({ jumps: [{ id: 'jjjj1', from: 'start', when: { calc: 'puntaje', op: 'lt', value: 2 }, to: 'end' }] });
        expect(formCalcIsLive(byJump, 'puntaje')).toBe(true);
    });

    it('una regla sobre un cálculo que no existe no se cumple; los números se comparan como números', () => {
        const values = withFormCalcValues({}, { puntaje: 7 });
        expect(formConditionMet({ calc: 'puntaje', op: 'eq', value: '7' }, [], values)).toBe(true);
        expect(formConditionMet({ calc: 'puntaje', op: 'neq', value: 7 }, [], values)).toBe(false);
        expect(formConditionMet({ calc: 'otro', op: 'lt', value: 100 }, [], values)).toBe(false);
    });

    it('bienvenida, modo y cálculos se leen con tolerancia', () => {
        const c = formConfigSchema.parse({ items: [q('aaaa1', 1)], settings: { welcome: 'x', layout: 'raro', calcs: [{ id: 'X', key: '1mal' }, { id: 'calc2', key: 'ok' }] } });
        expect(c.settings.welcome.enabled).toBe(false);
        expect(c.settings.layout).toBe('classic');
        expect(c.settings.calcs.map((k) => k.key)).toEqual(['ok']);
        expect(formEstimateMinutes(c)).toBe(1);
    });
});
