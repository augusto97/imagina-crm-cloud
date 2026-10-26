import { describe, expect, it } from 'vitest';
import {
    CAPABILITIES,
    CAPABILITIES_BY_ROLE,
    CAPABILITY_GROUPS,
    TOGGLEABLE_CAPABILITIES,
    capabilitiesMap,
    effectiveCapabilities,
} from './membership';
import { customRoleKey, parseCustomRoleKey } from './custom-role';
import { guestLevelOf, guestListPermissions } from './guest';

describe('C2 — capacidades efectivas', () => {
    it('sin rol propio, cada rol base conserva EXACTAMENTE sus capacidades', () => {
        for (const role of ['admin', 'manager', 'agent', 'viewer', 'client', 'guest'] as const) {
            expect(effectiveCapabilities(role)).toEqual([...CAPABILITIES_BY_ROLE[role]]);
            expect(effectiveCapabilities(role, null)).toEqual([...CAPABILITIES_BY_ROLE[role]]);
        }
    });

    it('con rol propio: siempre entra a la app, nunca al portal y sólo lo elegible', () => {
        const caps = effectiveCapabilities('agent', ['view_own_records', 'export_records', 'access_portal', 'inventada']);
        expect(caps).toEqual(['access_admin', 'view_own_records', 'export_records']);
    });

    it('admin, client y guest ignoran un rol propio', () => {
        expect(effectiveCapabilities('admin', ['view_records'])).toEqual([...CAPABILITIES_BY_ROLE.admin]);
        expect(effectiveCapabilities('client', ['view_records'])).toEqual([...CAPABILITIES_BY_ROLE.client]);
        expect(effectiveCapabilities('guest', ['manage_lists'])).toEqual([...CAPABILITIES_BY_ROLE.guest]);
    });

    it('el mapa marca cada capacidad del catálogo', () => {
        const map = capabilitiesMap('viewer', ['view_records']);
        expect(Object.keys(map).sort()).toEqual([...CAPABILITIES].sort());
        expect(map.view_records).toBe(true);
        expect(map.view_dashboards).toBe(false);
        expect(map.access_admin).toBe(true);
    });

    it('la pantalla de Roles ofrece todas las capacidades elegibles, una vez', () => {
        const listed = CAPABILITY_GROUPS.flatMap((g) => g.items.map((i) => i.capability));
        expect(new Set(listed).size).toBe(listed.length);
        expect([...listed].sort()).toEqual([...TOGGLEABLE_CAPABILITIES].sort());
    });

    it('las nuevas por módulo las tenía antes quien las usaba', () => {
        // Ver tableros y usar el asistente: todo el equipo (comportamiento previo).
        for (const role of ['admin', 'manager', 'agent', 'viewer'] as const) {
            expect(CAPABILITIES_BY_ROLE[role]).toContain('view_dashboards');
            expect(CAPABILITIES_BY_ROLE[role]).toContain('use_ai_assistant');
        }
        // Formularios y documentos: sólo admin (antes exigían manage_lists, que sólo tiene el admin).
        expect(CAPABILITIES_BY_ROLE.admin).toContain('manage_forms');
        expect(CAPABILITIES_BY_ROLE.admin).toContain('manage_documents');
        for (const role of ['manager', 'agent', 'viewer', 'client', 'guest'] as const) {
            expect(CAPABILITIES_BY_ROLE[role]).not.toContain('manage_forms');
            expect(CAPABILITIES_BY_ROLE[role]).not.toContain('manage_documents');
            expect(CAPABILITIES_BY_ROLE[role]).toContain(role === 'client' ? 'access_portal' : 'access_admin');
        }
        // El cliente del portal y el invitado no ven tableros ni usan el asistente.
        for (const role of ['client', 'guest'] as const) {
            expect(CAPABILITIES_BY_ROLE[role]).not.toContain('view_dashboards');
            expect(CAPABILITIES_BY_ROLE[role]).not.toContain('use_ai_assistant');
        }
    });

    it('clave de un rol propio en el ACL de la lista', () => {
        expect(customRoleKey(12)).toBe('custom:12');
        expect(parseCustomRoleKey('custom:12')).toBe(12);
        expect(parseCustomRoleKey('agent')).toBeNull();
        expect(parseCustomRoleKey('custom:0')).toBeNull();
        expect(parseCustomRoleKey('custom:x')).toBeNull();
    });
});

describe('C3 — niveles de invitado', () => {
    it('«editar» crea y edita pero nunca borra', () => {
        const p = guestListPermissions('edit');
        expect(p).toMatchObject({ view: 'all', create: true, edit: 'all', delete: 'none', comment: true });
    });

    it('un invitado no tiene capacidad de borrar', () => {
        expect(CAPABILITIES_BY_ROLE.guest).not.toContain('delete_records');
        expect(CAPABILITIES_BY_ROLE.guest).not.toContain('delete_own_records');
    });

    it('«ver» y «comentar» sólo leen; comentar suma el hilo', () => {
        expect(guestListPermissions('view')).toMatchObject({ create: false, edit: 'none', delete: 'none', comment: false });
        expect(guestListPermissions('comment')).toMatchObject({ create: false, edit: 'none', delete: 'none', comment: true });
    });

    it('el nivel se lee de vuelta de lo guardado', () => {
        for (const l of ['view', 'comment', 'edit'] as const) expect(guestLevelOf(guestListPermissions(l))).toBe(l);
        expect(guestLevelOf(null)).toBeNull();
        expect(guestLevelOf(undefined)).toBeNull();
    });
});
