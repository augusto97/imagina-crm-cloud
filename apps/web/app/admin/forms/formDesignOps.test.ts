import { describe, expect, it } from 'vitest';
import { formConfigSchema, type FormConfig } from '@imagina-base/shared';

import {
    addCalc,
    calcKeyFrom,
    calcRange,
    calcSources,
    removeCalc,
    renameCalcKey,
    setCalcPart,
    addContentItem,
    addFieldItem,
    addMatrixItem,
    defaultMatrixColumns,
    usedFieldIds,
    availableFields,
    attributionColumnIds,
    recordValuesColumnIds,
    conditionCandidates,
    emailQuestions,
    missingRequired,
    moveItem,
    moveItemTo,
    pageCount,
    pageNumbers,
    questionCount,
    readFormConfig,
    removeItem,
    updateItem,
    addEnding,
    addJump,
    jumpCandidates,
    jumpTargets,
    logicCount,
    moveJump,
    pageChoices,
    recallChoices,
    removeEnding,
    updateJump,
} from './formDesignOps';
import { packRules } from './design/ConditionEditor';
import { withToken } from './design/LogicPanel';

const fields = [
    { id: 1, label: 'Nombre', type: 'text', is_required: true },
    { id: 2, label: 'Tipo', type: 'select', is_required: false },
    { id: 3, label: 'NIT', type: 'text', is_required: true },
    { id: 4, label: 'Cliente', type: 'relation', is_required: false },
    { id: 5, label: 'Total', type: 'computed', is_required: true },
    { id: 6, label: 'Acepta', type: 'checkbox', is_required: true },
];

function base(): FormConfig {
    return formConfigSchema.parse({
        items: [
            { id: 'aaaa1', type: 'field', field_id: 1 },
            { id: 'aaaa2', type: 'field', field_id: 2 },
            { id: 'aaaa3', type: 'field', field_id: 3, show_if: { field_id: 2, op: 'eq', value: 'empresa' } },
        ],
    });
}

describe('constructor de formularios', () => {
    it('agrega una pregunta después de la elegida y no la repite', () => {
        const { config, id } = addContentItem(base(), 'heading', 'aaaa1');
        expect(config.items.map((i) => i.id)).toEqual(['aaaa1', id, 'aaaa2', 'aaaa3']);
        const again = addFieldItem(config, 2, null);
        expect(again.id).toBe('aaaa2');
        expect(again.config.items).toHaveLength(4);
    });

    it('quitar una pregunta limpia las condiciones que dependían de ella', () => {
        const out = removeItem(base(), 'aaaa2');
        expect(out.items.map((i) => i.id)).toEqual(['aaaa1', 'aaaa3']);
        expect(out.items[1]!.show_if).toBeNull();
    });

    it('mover arriba/abajo respeta los bordes; moveItemTo cuenta sin el ítem', () => {
        expect(moveItem(base(), 'aaaa1', -1).items[0]!.id).toBe('aaaa1');
        expect(moveItem(base(), 'aaaa1', 1).items.map((i) => i.id)).toEqual(['aaaa2', 'aaaa1', 'aaaa3']);
        expect(moveItemTo(base(), 'aaaa3', 0).items.map((i) => i.id)).toEqual(['aaaa3', 'aaaa1', 'aaaa2']);
    });

    it('editar no cambia el id ni el tipo', () => {
        const out = updateItem(base(), 'aaaa1', { label: 'Tu nombre', id: 'zzzz9', type: 'heading' } as never);
        expect(out.items[0]).toMatchObject({ id: 'aaaa1', type: 'field', label: 'Tu nombre' });
    });

    it('campos disponibles: los que se preguntan y faltan', () => {
        expect(availableFields(fields, base()).map((f) => f.id)).toEqual([6]);
    });

    it('v0.1.374 — las columnas del origen no se ofrecen como pregunta (sólo si está encendido)', () => {
        const c = base();
        const on: FormConfig = { ...c, settings: { ...c.settings, attribution: { ...c.settings.attribution, enabled: true, utm_campaign_field_id: 6 } } };
        expect(attributionColumnIds(on)).toEqual(new Set([6]));
        expect(availableFields(fields, on).map((f) => f.id)).toEqual([]);
        const off: FormConfig = { ...on, settings: { ...on.settings, attribution: { ...on.settings.attribution, enabled: false } } };
        expect(attributionColumnIds(off).size).toBe(0);
        expect(availableFields(fields, off).map((f) => f.id)).toEqual([6]);
    });

    it('v0.1.386 — el nombre del formulario y los valores fijos no se ofrecen como pregunta (salvo varias opciones)', () => {
        const c = base();
        const extra = [...fields, { id: 7, label: 'Formulario', type: 'text', is_required: false }, { id: 8, label: 'Etiquetas', type: 'multi_select', is_required: false }];
        const cfg: FormConfig = {
            ...c,
            settings: {
                ...c.settings,
                record_values: { form_name_field_id: 7, form_name_source: 'name', fixed: [{ field_id: 6, value: true }, { field_id: 8, value: ['web'] }] },
            },
        };
        expect(recordValuesColumnIds(cfg)).toEqual(new Set([7, 6, 8]));
        // El nombre y la casilla fija salen del catálogo; la «varias opciones» se puede preguntar igual (se suman).
        expect(availableFields(extra, cfg).map((f) => f.id)).toEqual([8]);
        expect(recordValuesColumnIds(base()).size).toBe(0);
    });

    it('avisa de lo que la lista exige y el formulario puede no traer', () => {
        // NIT es obligatorio en la lista pero condicional en el formulario; la
        // casilla y el calculado no cuentan.
        expect(missingRequired(fields, base()).map((f) => f.id)).toEqual([3]);
        const sinNombre = removeItem(base(), 'aaaa1');
        expect(missingRequired(fields, sinNombre).map((f) => f.id)).toEqual([1, 3]);
    });

    it('una condición sólo puede depender de preguntas anteriores', () => {
        expect(conditionCandidates(base(), 'aaaa3').map((c) => c.field_id)).toEqual([1, 2]);
        expect(conditionCandidates(base(), 'aaaa1')).toEqual([]);
    });

    it('v0.1.289 — saltos de página: numeración, cantidad y sin páginas vacías', () => {
        const one = addContentItem(base(), 'page_break', 'aaaa1');
        const two = addContentItem(one.config, 'page_break', 'aaaa2');
        expect(pageCount(two.config)).toBe(3);
        const pages = pageNumbers(two.config);
        expect([pages.get('aaaa1'), pages.get('aaaa2'), pages.get('aaaa3')]).toEqual([1, 2, 3]);
        // Un salto pegado a otro, o al final, no abre una página vacía.
        const dup = addContentItem(two.config, 'page_break', one.id);
        expect(pageCount(dup.config)).toBe(3);
        const tail = addContentItem(base(), 'page_break', 'aaaa3');
        expect(pageCount(tail.config)).toBe(1);
    });

    it('v0.1.351 — una configuración guardada antes recibe los valores nuevos (ancho, imágenes, tema)', () => {
        const old = { items: [{ id: 'aaaa1', type: 'field', field_id: 1, label: '', display: 'auto' }], settings: { title: 'X' } };
        const out = readFormConfig(old);
        expect(out.items[0]).toMatchObject({ width: 'full', hide_label: false, columns: null, option_images: {} });
        expect(out.settings.theme).toBeNull();
        // Algo que no valida se conserva tal cual (no se vacía el formulario).
        const weird = { items: [{ id: 'aaaa1', type: 'futuro' }] };
        expect(readFormConfig(weird)).toBe(weird);
    });

    it('v0.1.351 — agrega un ítem de imagen vacío, sin condición', () => {
        const { config, id } = addContentItem(base(), 'image', 'aaaa2');
        expect(config.items.map((i) => i.id)).toEqual(['aaaa1', 'aaaa2', id, 'aaaa3']);
        expect(config.items[2]).toMatchObject({ type: 'image', file_id: null, alt: '', width: 'full', max_height: null, show_if: null });
        expect(questionCount(config)).toBe(3);
    });

    it('v0.1.289 — el correo de quien responde: sólo preguntas de email; quitarla apaga confirmación y copia', () => {
        const withEmail = formConfigSchema.parse({
            items: [...base().items, { id: 'aaaa9', type: 'field', field_id: 9 }],
            settings: { respondent_email_field_id: 9, confirm_email: true, send_copy: true },
        });
        const all = [...fields, { id: 9, label: 'Correo', type: 'email', is_required: false }];
        expect(emailQuestions(all, withEmail).map((f) => f.id)).toEqual([9]);
        const removed = removeItem(withEmail, 'aaaa9');
        expect(removed.settings).toMatchObject({ respondent_email_field_id: null, confirm_email: false, send_copy: false });
    });
});

describe('v0.1.355 — matriz y «Otro» en el constructor', () => {
    const more = [
        ...fields,
        { id: 7, label: 'Atención', type: 'select', is_required: true, config: { options: [{ value: 'malo', label: 'Malo' }, { value: 'bueno', label: 'Bueno' }] } },
        { id: 8, label: 'Precio', type: 'select', is_required: false, config: { options: [{ value: 'malo', label: 'Malo' }, { value: 'bueno', label: 'Bueno' }] } },
        { id: 9, label: 'Rapidez', type: 'rating', is_required: false, config: { max: 4 } },
        { id: 10, label: 'Tipo (otro)', type: 'text', is_required: false },
    ];

    it('un campo usado como fila de matriz o como texto del «Otro» ya no se ofrece', () => {
        let c = formConfigSchema.parse({
            items: [{ id: 'aaaa1', type: 'field', field_id: 2, other_option: 'otro', other_field_id: 10 }],
            settings: {},
        });
        c = addMatrixItem(c, [7, 8], [{ value: 'malo', label: 'Malo' }, { value: 'bueno', label: 'Bueno' }], null).config;
        expect([...usedFieldIds(c)].sort((a, b) => a - b)).toEqual([2, 7, 8, 10]);
        expect(availableFields(more, c).map((f) => f.id)).not.toContain(10);
        expect(availableFields(more, c).map((f) => f.id)).not.toContain(7);
        // Las filas cuentan como preguntas y pueden controlar condiciones de lo que viene después.
        expect(questionCount(c)).toBe(3);
        const after = addContentItem(c, 'heading', null);
        expect(conditionCandidates(after.config, after.id).map((x) => x.field_id)).toEqual([2, 7, 8]);
    });

    it('una fila obligatoria la cubre una matriz obligatoria sin condición', () => {
        const c = addMatrixItem(formConfigSchema.parse({ items: [], settings: {} }), [7], [{ value: 'malo', label: 'Malo' }], null);
        expect(missingRequired(more, c.config).map((f) => f.id)).toContain(7);
        const req = updateItem(c.config, c.id, { required: true });
        expect(missingRequired(more, req).map((f) => f.id)).not.toContain(7);
    });

    it('quitar una matriz limpia las condiciones que dependían de sus filas', () => {
        const m = addMatrixItem(formConfigSchema.parse({ items: [], settings: {} }), [7], [{ value: 'malo', label: 'Malo' }], null);
        const q = addFieldItem(m.config, 1, m.id);
        const withCond = updateItem(q.config, q.id, { show_if: { field_id: 7, op: 'eq', value: 'malo' } });
        const removed = removeItem(withCond, m.id);
        expect(removed.items).toHaveLength(1);
        expect(removed.items[0]!.show_if).toBeNull();
    });

    it('columnas de arranque: las opciones de una selección o del 1 al máximo de una calificación', () => {
        expect(defaultMatrixColumns(more[6]).map((c) => c.label)).toEqual(['Malo', 'Bueno']);
        expect(defaultMatrixColumns(more[8]).map((c) => c.value)).toEqual(['1', '2', '3', '4']);
    });
});

describe('v0.1.356 — lógica en el constructor', () => {
    /** Página 1: nombre, tipo · Página 2 (pbrk2): NIT · Página 3 (pbrk3): acepta. */
    function paged(): FormConfig {
        return formConfigSchema.parse({
            items: [
                { id: 'aaaa1', type: 'field', field_id: 1 },
                { id: 'aaaa2', type: 'field', field_id: 2 },
                { id: 'pbrk2', type: 'page_break', title: 'Tu empresa' },
                { id: 'bbbb1', type: 'field', field_id: 3 },
                { id: 'pbrk3', type: 'page_break', title: '' },
                { id: 'cccc1', type: 'field', field_id: 6 },
            ],
        });
    }

    it('páginas con su nombre y destinos sólo hacia adelante, terminar o una pantalla final', () => {
        const c = addEnding(paged());
        expect(pageChoices(c).map((p) => p.label)).toEqual(['Página 1', 'Página 2 · Tu empresa', 'Página 3']);
        const fromStart = jumpTargets(c, 'start').map((t) => t.value);
        expect(fromStart).toEqual(['pbrk2', 'pbrk3', 'end', `ending:${c.settings.endings[0]!.id}`]);
        // Desde la página 2 ya no se puede volver a la 2 ni a la 1.
        expect(jumpTargets(c, 'pbrk2').map((t) => t.value)).toEqual(['pbrk3', 'end', `ending:${c.settings.endings[0]!.id}`]);
    });

    it('un salto decide con las preguntas de su página y las anteriores', () => {
        expect(jumpCandidates(paged(), 'start').map((x) => x.field_id)).toEqual([1, 2]);
        expect(jumpCandidates(paged(), 'pbrk2').map((x) => x.field_id)).toEqual([1, 2, 3]);
    });

    it('agregar, editar, mover y contar saltos', () => {
        let c = addJump(paged(), 'start', 2);
        c = addJump(c, 'start', 1);
        expect(c.settings.jumps).toHaveLength(2);
        expect(c.settings.jumps[0]!.to).toBe('pbrk2');
        const [a, b] = c.settings.jumps;
        c = updateJump(c, a!.id, { to: 'pbrk3', when: { field_id: 2, op: 'eq', value: 'persona' } });
        expect(c.settings.jumps[0]!.to).toBe('pbrk3');
        c = moveJump(c, b!.id, -1);
        expect(c.settings.jumps.map((j) => j.id)).toEqual([b!.id, a!.id]);
        expect(moveJump(c, b!.id, -1)).toBe(c);
        c = addEnding(c);
        expect(logicCount(c)).toBe(3);
    });

    it('quitar una pantalla final quita los saltos que llevaban a ella', () => {
        let c = addEnding(paged());
        const id = c.settings.endings[0]!.id;
        c = addJump(c, 'start', 2);
        c = updateJump(c, c.settings.jumps[0]!.id, { to: `ending:${id}` });
        c = removeEnding(c, id);
        expect(c.settings.endings).toHaveLength(0);
        expect(c.settings.jumps).toHaveLength(0);
    });

    it('quitar una página quita los saltos desde y hacia ella; quitar una pregunta limpia sus reglas', () => {
        let c = addJump(paged(), 'start', 2);
        c = updateJump(c, c.settings.jumps[0]!.id, { to: 'pbrk3' });
        c = addJump(c, 'pbrk2', 3);
        c = updateJump(c, c.settings.jumps[1]!.id, { to: 'end', when: { match: 'all', rules: [{ field_id: 3, op: 'is_not_empty' }, { field_id: 2, op: 'eq', value: 'empresa' }] } });
        // Sin la página 3: el primer salto (hacia ella) se va.
        const sin3 = removeItem(c, 'pbrk3');
        expect(sin3.settings.jumps.map((j) => j.from)).toEqual(['pbrk2']);
        // Sin el NIT: el grupo se queda con una sola regla y vuelve a ser una suelta.
        const sinNit = removeItem(c, 'bbbb1');
        expect(sinNit.settings.jumps[1]!.when).toEqual({ field_id: 2, op: 'eq', value: 'empresa' });
        // Sin el tipo: el primer salto se quedaría sin condición → desaparece (no se vuelve «siempre»).
        const sinTipo = removeItem(c, 'aaaa2');
        expect(sinTipo.settings.jumps).toHaveLength(1);
        expect(sinTipo.settings.jumps[0]!.when).toEqual({ field_id: 3, op: 'is_not_empty' });
    });

    it('una regla se guarda suelta; varias, como grupo', () => {
        const r1 = { field_id: 1, op: 'is_not_empty' as const };
        const r2 = { field_id: 2, op: 'eq' as const, value: 'x' };
        expect(packRules([], 'all')).toBeNull();
        expect(packRules([r1], 'any')).toEqual(r1);
        expect(packRules([r1, r2], 'any')).toEqual({ match: 'any', rules: [r1, r2] });
    });

    it('recordar: sólo las respuestas que el formulario pregunta, con su nombre entre llaves', () => {
        const slugged = [
            { id: 1, slug: 'nombre', label: 'Nombre' },
            { id: 2, slug: 'tipo', label: 'Tipo' },
            { id: 3, slug: 'nit', label: 'NIT' },
            { id: 9, slug: 'interno', label: 'Interno' },
        ];
        expect(recallChoices(paged(), slugged).map((c) => c.slug)).toEqual(['nombre', 'tipo', 'nit']);
        expect(withToken('Hola', '{{nombre}}')).toBe('Hola {{nombre}}');
        expect(withToken('Hola ', '{{nombre}}')).toBe('Hola {{nombre}}');
        expect(withToken('', '{{nombre}}')).toBe('{{nombre}}');
    });
});

describe('v0.1.357 — cálculos en el constructor', () => {
    const byId = new Map([
        [2, { label: 'Tipo', type: 'select', config: { options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] } }],
        [4, { label: 'Edad', type: 'number', config: {} }],
        [7, { label: 'Acepta', type: 'checkbox', config: {} }],
        [9, { label: 'Notas', type: 'long_text', config: {} }],
    ]);
    function withCalc(): FormConfig {
        return formConfigSchema.parse({
            items: [
                { id: 'aaaa1', type: 'field', field_id: 2 },
                { id: 'aaaa2', type: 'field', field_id: 7, display: 'yes_no', yes_label: 'Claro' },
                { id: 'aaaa3', type: 'field', field_id: 9, label: 'Tienes {{puntaje}}' },
                { id: 'aaaa4', type: 'field', field_id: 4 },
            ],
            settings: {
                success_title: 'Sacaste {{puntaje|0}}',
                calcs: [{ id: 'calc1', key: 'puntaje', name: 'Puntaje', parts: [{ field_id: 2, points: { empresa: 5 } }] }],
                endings: [{ id: 'fin01', title: 'Alto', when: { calc: 'puntaje', op: 'gt', value: 3 } }],
                jumps: [{ id: 'jjjj1', from: 'start', when: { calc: 'puntaje', op: 'lt', value: 1 }, to: 'end' }],
            },
        });
    }

    it('el nombre entre llaves sale del nombre, sin acentos y sin chocar con un campo', () => {
        expect(calcKeyFrom('Puntaje final', new Set())).toBe('puntaje_final');
        expect(calcKeyFrom('Puntuación', new Set(['puntuacion']))).toBe('puntuacion_2');
        expect(calcKeyFrom('1 nivel', new Set())).toBe('calc_1_nivel');
        const r = addCalc(withCalc(), ['nombre', 'total']);
        expect(r.config.settings.calcs.map((c) => c.key)).toEqual(['puntaje', 'puntaje_2']);
    });

    it('cambiar el nombre lo cambia también en los textos y en las reglas', () => {
        const next = renameCalcKey(withCalc(), 'calc1', 'nota');
        expect(next.settings.calcs[0]!.key).toBe('nota');
        expect(next.settings.success_title).toBe('Sacaste {{nota|0}}');
        expect((next.items[2] as { label: string }).label).toBe('Tienes {{nota}}');
        expect(next.settings.endings[0]!.when).toEqual({ calc: 'nota', op: 'gt', value: 3 });
        expect(next.settings.jumps[0]!.when).toEqual({ calc: 'nota', op: 'lt', value: 1 });
    });

    it('quitarlo saca las reglas que lo miraban (y el salto que se queda sin condición)', () => {
        const next = removeCalc(withCalc(), 'calc1');
        expect(next.settings.calcs).toEqual([]);
        expect(next.settings.endings[0]!.when).toBeNull();
        expect(next.settings.jumps).toEqual([]);
    });

    it('las preguntas que suman, en orden; puntos vacíos dejan de sumar; el rango se calcula', () => {
        const cfg = withCalc();
        const src = calcSources(cfg, byId);
        expect(src.map((s) => [s.fieldId, s.kind])).toEqual([
            [2, 'choices'],
            [7, 'choices'],
            [4, 'number'],
        ]);
        expect(src[1]!.choices).toEqual([
            { value: 'true', label: 'Claro' },
            { value: 'false', label: 'No' },
        ]);
        let next = setCalcPart(cfg, 'calc1', 7, { points: { true: 2, false: -1 }, multiplier: null });
        expect(next.settings.calcs[0]!.parts.map((p) => p.field_id)).toEqual([2, 7]);
        expect(calcRange(next.settings.calcs[0]!, src)).toEqual({ min: -1, max: 7 });
        next = setCalcPart(next, 'calc1', 7, { points: {}, multiplier: null });
        expect(next.settings.calcs[0]!.parts.map((p) => p.field_id)).toEqual([2]);
        // Con un factor, el rango no se puede saber.
        next = setCalcPart(next, 'calc1', 4, { points: {}, multiplier: 1 });
        expect(calcRange(next.settings.calcs[0]!, src)).toBeNull();
        // Borrar una pregunta que sumaba la saca del cálculo.
        expect(removeItem(next, 'aaaa4').settings.calcs[0]!.parts.map((p) => p.field_id)).toEqual([2]);
    });
});
