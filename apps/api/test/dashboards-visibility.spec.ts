import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BrandingService } from '../src/workspaces/branding.service';
import { DashboardsService, type DashboardViewer } from '../src/dashboards/dashboards.service';
import { attachments, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

describe('Dashboards: visibilidad + Branding (Postgres real)', () => {
    let pg: TestPg;
    let dashboards: DashboardsService;
    let branding: BrandingService;
    let tenantId: number;
    let creatorId: number;

    const asViewer = (userId: number, role: string): DashboardViewer => ({ userId, role });

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        // El CRUD no toca el motor de agregados — dummy suficiente.
        dashboards = new DashboardsService(tenantDb, null as never);
        branding = new BrandingService(tenantDb);
    });

    afterAll(async () => {
        await pg?.stop();
    });

    let counter = 0;
    beforeEach(async () => {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `dash-${counter}`, name: 'ACME', plan: 'trial', status: 'trialing' })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db
            .insert(users)
            .values({ email: `creator-${counter}@acme.test`, passwordHash: 'x', name: 'Creator' })
            .returning();
        creatorId = u!.id;
    });

    it('visibility: workspace para todos; private sólo creador+admin; roles según lista', async () => {
        const manager = asViewer(creatorId, 'manager');
        await dashboards.create(tenantId, creatorId, { name: 'Público', widgets: [] });
        await dashboards.create(tenantId, creatorId, { name: 'Mío', widgets: [], visibility: 'private' });
        await dashboards.create(tenantId, creatorId, {
            name: 'Sólo viewers',
            widgets: [],
            visibility: 'roles',
            allowed_roles: ['viewer'],
        });

        // El creador (manager) ve los 3.
        expect((await dashboards.list(tenantId, manager)).map((d) => d.name)).toEqual([
            'Público',
            'Mío',
            'Sólo viewers',
        ]);
        // El admin (otro usuario) también ve los 3.
        expect(await dashboards.list(tenantId, asViewer(999_999, 'admin'))).toHaveLength(3);
        // Un agent ajeno: sólo el workspace.
        expect((await dashboards.list(tenantId, asViewer(999_999, 'agent'))).map((d) => d.name)).toEqual([
            'Público',
        ]);
        // Un viewer ajeno: workspace + el de roles.
        expect((await dashboards.list(tenantId, asViewer(999_999, 'viewer'))).map((d) => d.name)).toEqual([
            'Público',
            'Sólo viewers',
        ]);
    });

    it('get de un private ajeno → 404 opaco (también para widgets)', async () => {
        const d = await dashboards.create(tenantId, creatorId, {
            name: 'Secreto',
            widgets: [],
            visibility: 'private',
        });
        await expect(dashboards.get(tenantId, d.id, asViewer(999_999, 'manager'))).rejects.toBeInstanceOf(
            NotFoundException,
        );
        await expect(
            dashboards.widgetsData(tenantId, d.id, asViewer(999_999, 'viewer')),
        ).rejects.toBeInstanceOf(NotFoundException);
        // El creador sí.
        expect((await dashboards.get(tenantId, d.id, asViewer(creatorId, 'manager'))).name).toBe('Secreto');
    });

    it('update/remove: sólo creador o admin (manager ajeno → 403)', async () => {
        const d = await dashboards.create(tenantId, creatorId, { name: 'De equipo', widgets: [] });
        await expect(
            dashboards.update(tenantId, d.id, asViewer(999_999, 'manager'), { name: 'Hackeado' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(dashboards.remove(tenantId, d.id, asViewer(999_999, 'manager'))).rejects.toBeInstanceOf(
            ForbiddenException,
        );
        // Admin ajeno sí puede; y el patch de visibilidad persiste.
        const updated = await dashboards.update(tenantId, d.id, asViewer(999_999, 'admin'), {
            visibility: 'roles',
            allowed_roles: ['manager'],
        });
        expect(updated.visibility).toBe('roles');
        expect(updated.allowed_roles).toEqual(['manager']);
    });

    it('branding: default vacío, PATCH persiste y el logo debe ser del tenant', async () => {
        const empty = await branding.get(tenantId);
        expect(empty).toMatchObject({ primary_color: null, logo_file_id: null, app_name: null, logo_url: null });

        const set = await branding.update(tenantId, { primary_color: '#0f766e', app_name: 'Acme CRM' });
        expect(set).toMatchObject({ primary_color: '#0f766e', app_name: 'Acme CRM' });
        expect((await branding.get(tenantId)).primary_color).toBe('#0f766e');

        // Logo inexistente → 400.
        await expect(branding.update(tenantId, { logo_file_id: 424242 })).rejects.toThrow();

        // Logo real del tenant → ok + URL de descarga.
        const [file] = await withTenant(pg.db, tenantId, (tx) =>
            tx
                .insert(attachments)
                .values({
                    tenantId,
                    filename: 'logo.png',
                    mime: 'image/png',
                    sizeBytes: 10,
                    storageKey: `t${tenantId}/logo.png`,
                    createdBy: creatorId,
                })
                .returning(),
        );
        const withLogo = await branding.update(tenantId, { logo_file_id: file!.id });
        expect(withLogo.logo_url).toBe(`/api/v1/files/${file!.id}/download`);

        // Volver al default con null.
        const cleared = await branding.update(tenantId, { logo_file_id: null, primary_color: null });
        expect(cleared.logo_file_id).toBeNull();
        expect(cleared.primary_color).toBeNull();
    });
});
