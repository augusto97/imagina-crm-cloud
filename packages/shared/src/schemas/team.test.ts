import { describe, expect, it } from 'vitest';

import { buildTeamLookup, coerceTextToFieldValue } from '../field-types/text-coercion';
import { validateFieldValue } from '../field-types/validate';
import { parseTeamGroupKey, teamGroupKey } from './kanban';
import { mostPermissive, type RolePermissions } from './list-permissions';
import { parseTeamHandles, teamHandle, teamIdsOf } from './team';

/** C1 — piezas puras de los equipos (manijas, valor del campo, ACL combinado). */
describe('equipos', () => {
    it('la manija de un equipo es su nombre sin acentos ni espacios', () => {
        expect(teamHandle('Atención al Cliente')).toBe('atencion-al-cliente');
        expect(teamHandle('  Ventas!! ')).toBe('ventas');
    });

    it('las manijas de un comentario no confunden un @email con un equipo', () => {
        expect(parseTeamHandles('Hola @ventas y @soporte-tecnico, ver @beto@test.local')).toEqual(['ventas', 'soporte-tecnico']);
        expect(parseTeamHandles('correo@ventas.com')).toEqual([]);
    });

    it('el valor del campo siempre es una lista de ids únicos', () => {
        expect(teamIdsOf([3, '7', 3, 'x', -1])).toEqual([3, 7]);
        expect(teamIdsOf(5)).toEqual([5]);
        expect(teamIdsOf(null)).toEqual([]);
    });

    it('validar: un solo equipo salvo que el campo permita varios', () => {
        const one = { type: 'team' as const, config: {}, is_required: false };
        const many = { type: 'team' as const, config: { multiple: true }, is_required: false };
        expect(validateFieldValue(one, [3])).toEqual({ ok: true, value: [3] });
        expect(validateFieldValue(one, [3, 7]).ok).toBe(false);
        expect(validateFieldValue(many, ['3', 7])).toEqual({ ok: true, value: [3, 7] });
        expect(validateFieldValue(many, ['Ventas']).ok).toBe(false);
        expect(validateFieldValue({ ...one, is_required: true }, []).ok).toBe(false);
    });

    it('pegar o importar por nombre (sin acentos ni mayúsculas); un nombre repetido no resuelve', () => {
        const teams = buildTeamLookup([
            { id: 3, name: 'Ventas' },
            { id: 7, name: 'Atención' },
            { id: 8, name: 'Doble' },
            { id: 9, name: 'doble' },
        ]);
        const field = { type: 'team' as const, config: { multiple: true } };
        expect(coerceTextToFieldValue('ventas, ATENCION', field, { teams })).toEqual([3, 7]);
        expect(coerceTextToFieldValue('12', field, { teams })).toEqual([12]);
        expect(coerceTextToFieldValue('Doble', field, { teams })).toEqual(['Doble']);
    });

    it('la clave de grupo es el conjunto ordenado (`[3, 7]`) y se lee de vuelta', () => {
        expect(teamGroupKey([7, 3, 7])).toBe('[3, 7]');
        expect(parseTeamGroupKey('[3, 7]')).toEqual([3, 7]);
        expect(parseTeamGroupKey('nada')).toEqual([]);
        expect(parseTeamGroupKey(null)).toEqual([]);
    });

    it('varios equipos con acceso: lo más permisivo por eje; un campo se oculta sólo si TODOS lo ocultan', () => {
        const a: RolePermissions = { view: 'own', create: false, edit: 'none', delete: 'none', fields_hidden: ['costo', 'margen'] };
        const b: RolePermissions = { view: 'all', create: true, edit: 'assigned', delete: 'none', fields_hidden: ['costo'] };
        expect(mostPermissive([a, b])).toEqual({ view: 'all', create: true, edit: 'assigned', delete: 'none', fields_hidden: ['costo'] });
        expect(mostPermissive([])).toBeNull();
    });
});
