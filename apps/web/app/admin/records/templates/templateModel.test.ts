import { describe, expect, it } from 'vitest';
import type { RecordTemplate } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

import { cleanValues, describeDate, describePerson, initialValueFor, templateSummary, templateValueFields } from './templateModel';

const field = (id: number, type: string, label = `F${id}`): FieldEntity =>
    ({ id, list_id: 1, slug: `f${id}`, label, type, config: {}, is_required: false, is_unique: false, is_primary: false, is_indexed: false, position: id, created_at: '', updated_at: '' }) as FieldEntity;

const FIELDS = [field(1, 'text', 'Nombre'), field(2, 'date', 'Inicio'), field(3, 'user', 'Responsable'), field(4, 'formula'), field(5, 'file'), field(6, 'select')];

const tpl = (over: Partial<RecordTemplate['content']>, kind: RecordTemplate['kind'] = 'record'): Pick<RecordTemplate, 'kind' | 'content'> => ({
    kind,
    content: { values: {}, subtasks: [], checklists: [], record_description: null, ...over },
});

describe('C6 · editor de plantillas de registro', () => {
    it('sólo los campos que se escriben a mano admiten valor (ni calculados ni archivos)', () => {
        expect(templateValueFields(FIELDS).map((f) => f.id)).toEqual([1, 2, 3, 6]);
    });

    it('una fecha arranca relativa (hoy), una persona en «quien crea» y el resto vacío', () => {
        expect(initialValueFor(field(9, 'date'))).toEqual({ mode: 'relative_date', date: { days: 0, from_field_id: null, business_days: false, time: null } });
        expect(initialValueFor(field(9, 'user'))).toEqual({ mode: 'person', person: { kind: 'creator' } });
        expect(initialValueFor(field(9, 'select'))).toEqual({ mode: 'fixed', value: null });
    });

    it('los valores fijos vacíos no se guardan', () => {
        expect(
            cleanValues({
                f1: { mode: 'fixed', value: '' },
                f6: { mode: 'fixed', value: 'nuevo' },
                f7: { mode: 'fixed', value: [] },
                f2: { mode: 'relative_date', date: { days: 3, from_field_id: null, business_days: true, time: null } },
            }),
        ).toEqual({
            f6: { mode: 'fixed', value: 'nuevo' },
            f2: { mode: 'relative_date', date: { days: 3, from_field_id: null, business_days: true, time: null } },
        });
    });

    it('resumen en lenguaje claro', () => {
        expect(templateSummary(tpl({}))).toBe('Vacía: sólo crea el registro');
        expect(
            templateSummary(
                tpl({
                    values: { f6: { mode: 'fixed', value: 'x' } },
                    subtasks: [{ title: 'A', values: {} }, { title: 'B', values: {} }],
                    checklists: [{ name: 'C', items: [{ text: 'i', assignee: null, due: null }] }],
                }),
            ),
        ).toBe('1 valor · 2 subtareas · 1 checklist (1 ítem)');
        expect(templateSummary(tpl({ checklists: [{ name: 'C', items: [{ text: 'a', assignee: null, due: null }, { text: 'b', assignee: null, due: null }] }] }, 'checklist'))).toBe('2 ítems');
    });

    it('describe personas y fechas con las etiquetas de los campos', () => {
        expect(describePerson({ kind: 'creator' }, FIELDS)).toBe('quien crea el registro');
        expect(describePerson({ kind: 'field', field_id: 3 }, FIELDS)).toBe('el valor de «Responsable»');
        expect(describeDate({ days: 5, from_field_id: 2, business_days: true, time: null }, FIELDS)).toContain('Inicio');
    });
});
