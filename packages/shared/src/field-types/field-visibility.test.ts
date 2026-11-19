import { describe, expect, it } from 'vitest';

import { checkRequiredIf } from './field-rules';
import {
    describeShowIf,
    fieldShowIfOf,
    fieldsHiddenByCondition,
    showIfCycle,
    showIfDeadConditions,
    showIfDependents,
    showIfSourceOps,
} from './field-visibility';
import { fieldAccessLevel, mostPermissive, withFieldAccessLevel, type RolePermissions } from '../schemas/list-permissions';
import { fieldRulesSchema } from '../schemas/field-rules';

const tipo = {
    id: 1,
    slug: 'tipo',
    label: 'Tipo de cliente',
    type: 'select' as const,
    config: { options: [{ value: 'empresa', label: 'Empresa' }, { value: 'persona', label: 'Persona' }] },
};
const nit = {
    id: 2,
    slug: 'nit',
    label: 'NIT',
    type: 'text' as const,
    config: { show_if: { logic: 'and', conditions: [{ field_id: 1, op: 'eq', value: 'empresa' }] } },
};
const regimen = {
    id: 3,
    slug: 'regimen',
    label: 'Régimen',
    type: 'text' as const,
    config: { show_if: { logic: 'and', conditions: [{ field_id: 2, op: 'is_not_null' }] } },
};

describe('A7 — Mostrar sólo si…', () => {
    it('oculta el NIT si el tipo no es Empresa y lo muestra si lo es', () => {
        expect(fieldsHiddenByCondition([tipo, nit], { f1: 'persona' }).has(2)).toBe(true);
        expect(fieldsHiddenByCondition([tipo, nit], { f1: 'empresa' }).has(2)).toBe(false);
        expect(fieldsHiddenByCondition([tipo, nit], {}).has(2)).toBe(true);
    });

    it('en cascada: lo que depende de un campo oculto cuenta su valor como vacío', () => {
        // El NIT guardado se conserva, pero si el tipo es Persona no aplica, y el régimen tampoco.
        const hidden = fieldsHiddenByCondition([tipo, nit, regimen], { f1: 'persona', f2: '900123456' });
        expect([...hidden.keys()].sort()).toEqual([2, 3]);
        expect(fieldsHiddenByCondition([tipo, nit, regimen], { f1: 'empresa', f2: '900123456' }).size).toBe(0);
    });

    it('«alguna» basta con una regla; una regla de un campo que ya no existe no aplica', () => {
        const or = { ...nit, config: { show_if: { logic: 'or', conditions: [{ field_id: 1, op: 'eq', value: 'empresa' }, { field_id: 99, op: 'eq', value: 'x' }] } } };
        expect(fieldsHiddenByCondition([tipo, or], { f1: 'empresa' }).has(2)).toBe(false);
        // Sólo la regla muerta → se muestra siempre.
        const dead = { ...nit, config: { show_if: { conditions: [{ field_id: 99, op: 'eq', value: 'x' }] } } };
        expect(fieldsHiddenByCondition([tipo, dead], { f1: 'persona' }).size).toBe(0);
        expect(showIfDeadConditions(dead.config, [tipo, dead])).toBe(1);
    });

    it('casilla, números, varias opciones y vacío', () => {
        const check = { id: 5, slug: 'factura', label: 'Factura', type: 'checkbox' as const, config: {} };
        const monto = { id: 6, slug: 'monto', label: 'Monto', type: 'currency' as const, config: {} };
        const tags = { id: 7, slug: 'tags', label: 'Etiquetas', type: 'multi_select' as const, config: { options: [{ value: 'vip', label: 'VIP' }] } };
        const target = (cond: unknown) => ({ id: 9, slug: 't', label: 'T', type: 'text' as const, config: { show_if: { conditions: [cond] } } });
        const all = (cond: unknown) => [check, monto, tags, target(cond)];
        expect(fieldsHiddenByCondition(all({ field_id: 5, op: 'eq', value: true }), { f5: true }).has(9)).toBe(false);
        expect(fieldsHiddenByCondition(all({ field_id: 5, op: 'eq', value: true }), {}).has(9)).toBe(true);
        expect(fieldsHiddenByCondition(all({ field_id: 6, op: 'gt', value: 1000 }), { f6: 2500 }).has(9)).toBe(false);
        expect(fieldsHiddenByCondition(all({ field_id: 6, op: 'gt', value: 1000 }), { f6: 10 }).has(9)).toBe(true);
        expect(fieldsHiddenByCondition(all({ field_id: 7, op: 'contains', value: 'vip' }), { f7: ['vip', 'x'] }).has(9)).toBe(false);
        expect(fieldsHiddenByCondition(all({ field_id: 6, op: 'is_null' }), { f6: null }).has(9)).toBe(false);
    });

    it('un campo oculto por su condición no es «obligatorio si»', () => {
        const nitReq = {
            ...nit,
            config: { ...nit.config, validation: { required_if: { field_id: 1, op: 'neq', value: 'persona' } } },
        };
        // Tipo = otro valor que no existe: no es Persona (obligatorio si) pero tampoco Empresa (no se muestra).
        expect(checkRequiredIf([tipo, nitReq], { f1: 'otro' })).toEqual([]);
        expect(checkRequiredIf([tipo, { ...nitReq, config: { validation: nitReq.config.validation } }], { f1: 'otro' })).toHaveLength(1);
    });

    it('detecta ciclos directos y transitivos', () => {
        const a = { id: 10, label: 'A', type: 'text', config: {} };
        const b = { id: 11, label: 'B', type: 'text', config: { show_if: { conditions: [{ field_id: 12, op: 'is_not_null' }] } } };
        const c = { id: 12, label: 'C', type: 'text', config: { show_if: { conditions: [{ field_id: 10, op: 'is_not_null' }] } } };
        // Guardar A dependiente de B cierra A → B → C → A.
        expect(showIfCycle([a, b, c], 10, { logic: 'and', conditions: [{ field_id: 11, op: 'is_not_null' }] })).toEqual([10, 11, 12, 10]);
        expect(showIfCycle([a, b, c], 10, null)).toBeNull();
        expect(showIfCycle([a, b, c], 10, { logic: 'and', conditions: [{ field_id: 10, op: 'is_not_null' }] })).toEqual([10, 10]);
        expect(showIfDependents([a, b, c], 10).map((f) => f.id)).toEqual([12]);
    });

    it('lectura tolerante, operadores por tipo y textos', () => {
        expect(fieldShowIfOf({ show_if: { conditions: [{ field_id: 1, op: 'eq' }, { op: 'eq', value: 'x' }, { field_id: 1, op: 'raro', value: 1 }] } })).toBeNull();
        expect(fieldShowIfOf({ show_if: 'nada' })).toBeNull();
        expect(showIfSourceOps('relation')).toEqual([]);
        expect(showIfSourceOps('formula')).toEqual([]);
        expect(showIfSourceOps('user')).toEqual(['is_null', 'is_not_null']);
        expect(describeShowIf(fieldShowIfOf(nit.config)!, [tipo, nit])).toBe('«Tipo de cliente» es «Empresa»');
        // El schema acepta la condición en los campos que se escriben a mano.
        expect(fieldRulesSchema.parse({ show_if: nit.config.show_if }).show_if?.conditions).toHaveLength(1);
    });
});

describe('C4 — sólo lectura por rol', () => {
    const f = { id: 4, slug: 'monto' };
    it('nivel por campo y combinación entre equipos', () => {
        const base: RolePermissions = { view: 'all', create: true, edit: 'all', delete: 'all', fields_hidden: [] };
        const ro = withFieldAccessLevel(base, f, 'read');
        expect(fieldAccessLevel(ro, f)).toBe('read');
        expect(fieldAccessLevel(withFieldAccessLevel(ro, f, 'none'), f)).toBe('none');
        expect(withFieldAccessLevel(ro, f, 'edit').readonly_field_ids).toBeUndefined();
        // Sólo lectura si TODOS los equipos lo marcan.
        expect(mostPermissive([ro, base])?.readonly_field_ids).toBeUndefined();
        expect(mostPermissive([ro, { ...base, readonly_field_ids: [4, 8] }])?.readonly_field_ids).toEqual([4]);
    });
});
