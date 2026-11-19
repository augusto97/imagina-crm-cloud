import { describe, expect, it } from 'vitest';

import { readonlyLockedReasons, withoutReadonlyValues } from '@/admin/records/fieldAccess';
import { draftErrors } from '@/lib/fieldRules';
import { conditionHiddenFields, conditionHiddenReasonOf, makeConditionReasons, showIfDeleteWarning } from '@/lib/fieldVisibility';
import type { FieldEntity } from '@/types/field';

function field(id: number, slug: string, label: string, type: string, config: Record<string, unknown> = {}, extra: Partial<FieldEntity> = {}): FieldEntity {
    return {
        id,
        list_id: 1,
        slug,
        label,
        type,
        config,
        is_required: false,
        is_unique: false,
        is_primary: false,
        position: id,
        ...extra,
    } as unknown as FieldEntity;
}

const tipo = field(1, 'tipo', 'Tipo de cliente', 'select', {
    options: [
        { value: 'empresa', label: 'Empresa' },
        { value: 'persona', label: 'Persona' },
    ],
});
const nit = field(2, 'nit', 'NIT', 'text', { show_if: { logic: 'and', conditions: [{ field_id: 1, op: 'eq', value: 'empresa' }] } }, { is_required: true });
const monto = field(3, 'monto', 'Monto', 'currency');
const aprobador = field(4, 'aprobador', 'Aprobador', 'text', { show_if: { logic: 'and', conditions: [{ field_id: 3, op: 'gt', value: 1000000 }] } });
const all = [tipo, nit, monto, aprobador];

describe('A7 — Mostrar sólo si… en el navegador', () => {
    it('el NIT aparece al elegir Empresa (valores por slug)', () => {
        expect(conditionHiddenFields(all, { tipo: 'persona' }).has(2)).toBe(true);
        expect(conditionHiddenFields(all, { tipo: 'empresa' }).has(2)).toBe(false);
        expect(conditionHiddenFields(all, {}).has(2)).toBe(true);
    });

    it('normaliza lo tecleado antes de comparar (un monto escrito como texto)', () => {
        expect(conditionHiddenFields(all, { monto: '2500000' }).has(4)).toBe(false);
        expect(conditionHiddenFields(all, { monto: '500' }).has(4)).toBe(true);
    });

    it('sin campos con condición no calcula nada', () => {
        expect(conditionHiddenFields([tipo, monto], { tipo: 'persona' }).size).toBe(0);
        expect(makeConditionReasons([tipo, monto])).toBeNull();
    });

    it('el motivo para la celda atenuada, una vez por fila', () => {
        const reasons = makeConditionReasons(all)!;
        const row = { tipo: 'persona', nit: '900123' };
        expect(reasons(row, 2)).toBe('Este campo no aplica aquí: se muestra sólo si «Tipo de cliente» es «Empresa».');
        expect(reasons(row, 1)).toBeNull();
        expect(reasons({ tipo: 'empresa' }, 2)).toBeNull();
        const hidden = conditionHiddenFields(all, row);
        expect(conditionHiddenReasonOf(hidden, 2, all)).toContain('Empresa');
    });

    it('un obligatorio oculto por su condición no se exige en el alta', () => {
        expect(draftErrors(all, { tipo: 'persona', nit: '' })).toEqual({});
        expect(draftErrors(all, { tipo: 'empresa', nit: '' })).toEqual({ nit: 'Este campo es obligatorio.' });
    });

    it('avisa al borrar un campo que es condición de otros', () => {
        expect(showIfDeleteWarning(tipo, all)).toContain('«NIT»');
        expect(showIfDeleteWarning(nit, all)).toBeNull();
    });
});

describe('C4 — sólo lectura en el navegador', () => {
    it('candados por slug y el alta no manda lo que sólo se ve', () => {
        const ids = new Set([3]);
        expect(readonlyLockedReasons(ids, all)).toEqual({ monto: 'Puedes ver este campo, pero tu acceso a esta lista no te deja cambiarlo.' });
        expect(readonlyLockedReasons(null, all)).toEqual({});
        expect(withoutReadonlyValues(ids, all, { tipo: 'empresa', monto: 10 })).toEqual({ tipo: 'empresa' });
        expect(withoutReadonlyValues(null, all, { monto: 10 })).toEqual({ monto: 10 });
    });
});
