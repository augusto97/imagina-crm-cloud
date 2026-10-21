// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import type { AuthSession } from '@imagina-base/shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSession } from '@/cloud/session';
import { switchWorkspace } from '@/cloud/workspaceSwitch';
import { getBootData } from '@/lib/boot';

const session: AuthSession = {
    user: { id: 1, email: 'ana@acme.co', name: 'Ana', locale: 'es', email_verified: true, two_factor_enabled: false },
    memberships: [
        { tenant_id: 10, tenant_slug: 'acme', tenant_name: 'Acme', role: 'admin' },
        { tenant_id: 20, tenant_slug: 'beta', tenant_name: 'Beta', role: 'viewer' },
    ],
};

describe('cambio de empresa (v0.1.286)', () => {
    beforeEach(() => {
        useSession.setState({ domainTenant: null, activeTenantId: null });
        useSession.getState().setSession(session);
        window.location.hash = '#/lists/clientes/records';
    });

    it('cambia el tenant, re-hidrata el rol, tira el cache (salvo la sesión) y va a /lists', () => {
        const qc = new QueryClient();
        qc.setQueryData(['me'], session);
        qc.setQueryData(['lists', 'list'], [{ id: 1 }]);
        qc.setQueryData(['records', '1', 'list', {}], []);
        expect(useSession.getState().activeTenantId).toBe(10);

        expect(switchWorkspace(20, qc)).toBe(true);
        expect(useSession.getState().activeTenantId).toBe(20);
        expect(getBootData().tenantId).toBe(20);
        // Rol `viewer` en Beta: sin capacidades de admin.
        expect(getBootData().user.capabilities.imcrm_manage_lists ?? false).toBe(false);
        expect(qc.getQueryData(['me'])).toBe(session);
        expect(qc.getQueryData(['lists', 'list'])).toBeUndefined();
        expect(qc.getQueryData(['records', '1', 'list', {}])).toBeUndefined();
        expect(window.location.hash).toBe('#/lists');
    });

    it('la empresa actual o una ajena no hacen nada', () => {
        const qc = new QueryClient();
        qc.setQueryData(['lists', 'list'], [{ id: 1 }]);
        expect(switchWorkspace(10, qc)).toBe(false);
        expect(switchWorkspace(99, qc)).toBe(false);
        expect(qc.getQueryData(['lists', 'list'])).toBeDefined();
    });

    it('con dominio propio la empresa queda fijada', () => {
        useSession.getState().setDomainTenant({ id: 10, slug: 'acme', name: 'Acme' } as never);
        const qc = new QueryClient();
        expect(switchWorkspace(20, qc)).toBe(false);
        expect(useSession.getState().activeTenantId).toBe(10);
    });
});
