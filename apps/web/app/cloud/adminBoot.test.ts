import { describe, expect, it } from 'vitest';
import type { MembershipSummary } from '@imagina-base/shared';

import { capsForMembership } from '@/cloud/adminBoot';
import { resolveSettingsSection, settingsSectionGroups } from '@/cloud/settingsSections';
import { CAP } from '@/lib/permissions';

const m = (over: Partial<MembershipSummary>): MembershipSummary =>
    ({ tenant_id: 1, tenant_name: 'Acme', tenant_slug: 'acme', role: 'agent', ...over }) as MembershipSummary;

describe('C2 — capacidades de la interfaz', () => {
    it('sin rol propio, el mapa de siempre del rol base', () => {
        const agent = capsForMembership(m({ role: 'agent' }));
        expect(agent[CAP.CREATE_RECORDS]).toBe(true);
        expect(agent[CAP.VIEW_DASHBOARDS]).toBe(true);
        expect(agent[CAP.MANAGE_LISTS]).toBeUndefined();
        const viewer = capsForMembership(m({ role: 'viewer' }));
        expect(viewer[CAP.CREATE_RECORDS]).toBeUndefined();
        expect(capsForMembership(m({ role: 'manager' })).workspace_admin).toBe(true);
        expect(capsForMembership(m({ role: 'admin' }))[CAP.MANAGE_FORMS]).toBe(true);
    });

    it('con rol propio, EXACTAMENTE las capacidades que resolvió el servidor', () => {
        const caps = capsForMembership(
            m({ role: 'agent', custom_role_id: 7, capabilities: ['access_admin', 'view_own_records', 'export_records'] }),
        );
        expect(caps[CAP.EXPORT_RECORDS]).toBe(true);
        expect(caps[CAP.VIEW_DASHBOARDS]).toBeUndefined();
        expect(caps[CAP.USE_AI_ASSISTANT]).toBeUndefined();
        expect(caps.workspace_admin).toBeUndefined();
    });

    it('un rol propio basado en Manager mira «como admin» las vistas del equipo', () => {
        const caps = capsForMembership(m({ role: 'manager', custom_role_id: 3, capabilities: ['access_admin', 'view_records'] }));
        expect(caps.workspace_admin).toBe(true);
    });

    it('el invitado: lo justo y nunca borrar', () => {
        const caps = capsForMembership(m({ role: 'guest' }));
        expect(caps.guest).toBe(true);
        expect(caps[CAP.DELETE_OWN_RECORDS]).toBeUndefined();
        expect(caps[CAP.DELETE_RECORDS]).toBeUndefined();
        expect(caps[CAP.VIEW_DASHBOARDS]).toBeUndefined();
        expect(caps[CAP.MANAGE_LISTS]).toBeUndefined();
    });
});

describe('C3 — Ajustes de un invitado', () => {
    it('sólo su cuenta (sin firma de correo ni nada de la empresa)', () => {
        const groups = settingsSectionGroups({ isAdmin: false, isGuest: true });
        const ids = groups.flatMap((g) => g.items).map((i) => i.id);
        expect(ids).toContain('seguridad');
        expect(ids).not.toContain('plan');
        expect(ids).not.toContain('miembros');
        expect(ids).not.toContain('papelera');
        expect(ids).not.toContain('equipos');
        expect(resolveSettingsSection(groups, 'miembros')).toBe('seguridad');
    });
});
