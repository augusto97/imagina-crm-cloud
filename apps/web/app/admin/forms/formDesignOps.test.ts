import { describe, expect, it } from 'vitest';
import { formConfigSchema, type FormConfig } from '@imagina-base/shared';

import {
    addContentItem,
    addFieldItem,
    availableFields,
    conditionCandidates,
    emailQuestions,
    missingRequired,
    moveItem,
    moveItemTo,
    pageCount,
    pageNumbers,
    removeItem,
    updateItem,
} from './formDesignOps';

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
