import { describe, expect, it } from 'vitest';

import { buildShareOptions, guestLevelFor, initialsOf, looksLikeEmail, selectableOption } from './shareAccess';

const none = { userIds: new Set<number>(), teamIds: new Set<number>(), guestIds: new Set<number>(), guestEmails: new Set<string>() };

const users = [
    { id: 1, login: 'ana@acme.co', display_name: 'Ana Gómez' },
    { id: 2, login: 'luis@acme.co', display_name: 'Luis Pérez' },
    { id: 9, login: 'contador@afuera.com', display_name: 'Carlos Contador', is_guest: true },
];
const teams = [
    { id: 5, name: 'Ventas', member_count: 4, icon: null, color: null },
    { id: 6, name: 'Diseño', member_count: 2, icon: 'palette', color: '#7c3aed' },
];

describe('buscador de Compartir', () => {
    it('sin texto no ofrece nada', () => {
        expect(buildShareOptions('  ', users, teams, none)).toEqual([]);
    });

    it('personas de la empresa primero, después equipos (sin acentos) y después las de afuera', () => {
        const opts = buildShareOptions('dise', users, teams, none);
        expect(opts.map((o) => o.kind)).toEqual(['member', 'member', 'team', 'guest']);
        const team = opts.find((o) => o.kind === 'team');
        expect(team && team.kind === 'team' ? team.name : '').toBe('Diseño');
        expect(buildShareOptions('DISEÑO', [], teams, none).map((o) => o.kind)).toEqual(['team']);
    });

    it('marca lo que ya tiene acceso y no deja elegirlo', () => {
        const opts = buildShareOptions('a', users, teams, { ...none, userIds: new Set([1]), teamIds: new Set([5]), guestIds: new Set([9]) });
        const ana = opts.find((o) => o.kind === 'member' && o.id === 1)!;
        expect(selectableOption(ana)).toBe(false);
        const luis = opts.find((o) => o.kind === 'member' && o.id === 2)!;
        expect(selectableOption(luis)).toBe(true);
        expect(selectableOption(opts.find((o) => o.kind === 'team')!)).toBe(false);
        expect(selectableOption(opts.find((o) => o.kind === 'guest')!)).toBe(false);
    });

    it('un correo que no es de nadie se ofrece para invitar; uno conocido no', () => {
        const nuevo = buildShareOptions('Proveedor@Externo.com', [], teams, none);
        expect(nuevo).toEqual([{ kind: 'email', email: 'proveedor@externo.com' }]);
        expect(buildShareOptions('ana@acme.co', [users[0]!], teams, none).some((o) => o.kind === 'email')).toBe(false);
        expect(buildShareOptions('x@y.com', [], [], { ...none, guestEmails: new Set(['x@y.com']) })).toEqual([]);
        expect(looksLikeEmail('ana@acme')).toBe(false);
        expect(looksLikeEmail('ana@acme.co')).toBe(true);
    });

    it('el nivel de afuera nunca da más de lo elegido', () => {
        expect(guestLevelFor('read')).toBe('view');
        expect(guestLevelFor('own')).toBe('view');
        expect(guestLevelFor('collab')).toBe('edit');
        expect(guestLevelFor('full')).toBe('edit');
    });

    it('iniciales', () => {
        expect(initialsOf('Ana María Gómez')).toBe('AG');
        expect(initialsOf('luis')).toBe('LU');
        expect(initialsOf('  ')).toBe('?');
    });
});
