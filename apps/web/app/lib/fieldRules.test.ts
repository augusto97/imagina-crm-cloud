import { describe, expect, it } from 'vitest';

import { missingRequired } from '@/admin/forms/formDesignOps';
import { asDisplayField, DERIVED_FIELD_TYPES, displayTypeOf, SYSTEM_FIELD_TYPES } from '@/lib/fieldTypeCatalog';
import { allowedTargetsFor } from '@/lib/fieldTypeMigration';
import type { FieldEntity } from '@/types/field';

import { draftErrors, fieldDefaultsBySlug, isRequiredNow } from './fieldRules';

/** v0.1.300 — valores por defecto, validaciones y columnas de sistema en el navegador. */

function field(id: number, slug: string, type: FieldEntity['type'], config: Record<string, unknown> = {}, extra: Partial<FieldEntity> = {}): FieldEntity {
    return {
        id,
        list_id: 1,
        slug,
        label: slug.charAt(0).toUpperCase() + slug.slice(1),
        type,
        config,
        is_required: false,
        is_unique: false,
        is_primary: false,
        is_indexed: false,
        position: id,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        ...extra,
    };
}

const tipo = field(1, 'tipo', 'select', { options: [{ value: 'persona', label: 'Persona' }, { value: 'empresa', label: 'Empresa' }] });
const nit = field(2, 'nit', 'text', { validation: { format: 'nit', required_if: { field_id: 1, op: 'eq', value: 'empresa' } } });
const estado = field(3, 'estado', 'select', { options: [{ value: 'nuevo', label: 'Nuevo' }], default_value: { kind: 'value', value: 'nuevo' } });
const alta = field(4, 'alta', 'date', { default_value: { kind: 'today' } });
const dueno = field(5, 'dueno', 'user', { default_value: { kind: 'creator' } });
const monto = field(6, 'monto', 'currency', { validation: { min: 1000, max: 5000, range_message: 'Entre mil y cinco mil.' } });
const codigo = field(7, 'codigo', 'autonumber', { prefix: 'TCK', default_value: { kind: 'value', value: 'X' } });
const fields = [tipo, nit, estado, alta, dueno, monto, codigo];

describe('fieldDefaultsBySlug', () => {
    it('resuelve fijos, hoy y quien crea; nunca para lo que llena la app', () => {
        const now = new Date('2026-10-23T15:00:00Z');
        expect(fieldDefaultsBySlug(fields, 9, now)).toEqual({ estado: 'nuevo', alta: '2026-10-23', dueno: 9 });
        // Sin usuario (formulario público), «quien lo crea» no aplica.
        expect(fieldDefaultsBySlug(fields, null, now)).not.toHaveProperty('dueno');
    });
});

describe('isRequiredNow / draftErrors', () => {
    it('«obligatorio si» depende del otro campo', () => {
        expect(isRequiredNow(nit, fields, { tipo: 'persona' })).toBe(false);
        expect(isRequiredNow(nit, fields, { tipo: 'empresa' })).toBe(true);
    });

    it('avisa la regla condicional, el formato y el rango con su mensaje', () => {
        const errors = draftErrors(fields, { tipo: 'empresa', monto: 200 });
        expect(errors.nit).toBe('«Nit» es obligatorio cuando «Tipo» es «Empresa».');
        expect(errors.monto).toBe('Entre mil y cinco mil.');
        const ok = draftErrors(fields, { tipo: 'empresa', nit: '800197268-4', monto: 2000 });
        expect(ok).toEqual({});
        expect(draftErrors(fields, { nit: '800197268-5' }).nit).toMatch(/NIT/);
    });
});

describe('columnas de sistema y ID automático', () => {
    it('se muestran como fecha y hora, persona o texto', () => {
        expect(displayTypeOf('created_at')).toBe('datetime');
        expect(displayTypeOf('updated_by')).toBe('user');
        expect(displayTypeOf('autonumber')).toBe('text');
        expect(asDisplayField({ type: 'created_by', id: 1 })).toEqual({ type: 'user', id: 1 });
        const same = { type: 'text' };
        expect(asDisplayField(same)).toBe(same);
    });

    it('no se escriben a mano ni se exigen en un formulario', () => {
        for (const t of ['autonumber', 'created_at', 'updated_at', 'created_by', 'updated_by']) {
            expect(DERIVED_FIELD_TYPES.has(t)).toBe(true);
        }
        expect(SYSTEM_FIELD_TYPES.has('autonumber')).toBe(false);
        const required = [
            { id: 1, label: 'ID', type: 'autonumber', is_required: true },
            { id: 2, label: 'Estado', type: 'select', is_required: true, config: { default_value: { kind: 'value', value: 'nuevo' } } },
            { id: 3, label: 'Dueño', type: 'user', is_required: true, config: { default_value: { kind: 'creator' } } },
        ];
        // Sólo «Dueño»: un formulario público no tiene a «quien lo crea».
        expect(missingRequired(required, { items: [], settings: {} } as never).map((f) => f.label)).toEqual(['Dueño']);
    });

    it('un ID automático se puede volver texto', () => {
        expect(allowedTargetsFor('autonumber')).toEqual([{ type: 'text', risk: 'safe' }]);
    });
});
