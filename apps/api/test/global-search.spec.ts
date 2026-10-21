import type { Field } from '@imagina-base/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/db/schema';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RelationsRepository } from '../src/records/relations.repository';
import { ActivityService } from '../src/activity/activity.service';
import { ActivityRepository } from '../src/activity/activity.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RecordSearchService } from '../src/records/record-search.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();
const admin: Actor = { userId: 1, role: 'admin' };
const agent: Actor = { userId: 2, role: 'agent' };
const viewer: Actor = { userId: 3, role: 'viewer' };

/**
 * Búsqueda global de la paleta (`GET /search`): una consulta para todas las
 * listas, con EXACTAMENTE el ACL del listado de cada una.
 */
describe('búsqueda global de registros por título', () => {
    let pg: TestPg;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let search: RecordSearchService;
    let tenantId: number;
    let otherTenant: number;
    const f: Record<string, Field> = {};

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists_,
            fields_,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists_),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        search = new RecordSearchService(tenantDb);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [t2] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tenantId = t!.id;
        otherTenant = t2!.id;

        await lists_.create(tenantId, { name: 'Clientes' });
        f.cliNombre = await fields_.create(tenantId, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        f.cliNota = await fields_.create(tenantId, 'clientes', { label: 'Nota', type: 'long_text', slug: 'nota' });
        await lists_.create(tenantId, { name: 'Proyectos' });
        f.proyCodigo = await fields_.create(tenantId, 'proyectos', { label: 'Código', type: 'number', slug: 'codigo' });
        f.proyTitulo = await fields_.create(tenantId, 'proyectos', { label: 'Título', type: 'text', slug: 'titulo' });
        await lists_.create(tenantId, { name: 'Nómina' });
        f.nomNombre = await fields_.create(tenantId, 'nomina', { label: 'Empleado', type: 'text', slug: 'empleado' });

        const k = (x: Field): string => `f${x.id}`;
        await recs.create(tenantId, admin, 'clientes', { data: { [k(f.cliNombre!)]: 'Acme Ingeniería', [k(f.cliNota!)]: 'zeta' } });
        await recs.create(tenantId, agent, 'clientes', { data: { [k(f.cliNombre!)]: 'Ingenio del agente' } });
        await recs.create(tenantId, admin, 'proyectos', { data: { [k(f.proyCodigo!)]: 7, [k(f.proyTitulo!)]: 'Portal de ingeniería' } });
        await recs.create(tenantId, admin, 'nomina', { data: { [k(f.nomNombre!)]: 'Ingrid Salario' } });
        // Otra empresa: nunca aparece.
        await lists_.create(otherTenant, { name: 'Clientes' });
        const otherField = await fields_.create(otherTenant, 'clientes', { label: 'Nombre', type: 'text', slug: 'nombre' });
        await recs.create(otherTenant, admin, 'clientes', { data: { [`f${otherField.id}`]: 'Ingeniería ajena' } });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const titles = async (actor: Actor, q: string): Promise<string[]> =>
        (await search.search(tenantId, actor, { q, limit: 20 })).map((h) => h.title).sort();

    it('busca por el campo título de cada lista (no por otros campos), sin mayúsculas', async () => {
        const hits = await search.search(tenantId, admin, { q: 'INGE', limit: 20 });
        expect(hits.map((h) => h.title).sort()).toEqual(['Acme Ingeniería', 'Ingenio del agente', 'Portal de ingeniería']);
        const portal = hits.find((h) => h.title === 'Portal de ingeniería')!;
        // El título de Proyectos es el primer campo de TEXTO (el número va antes).
        expect(portal).toMatchObject({ list_slug: 'proyectos', list_name: 'Proyectos' });
        // Lo que coincide al principio va primero.
        expect(hits[0]!.title.toLowerCase().startsWith('inge')).toBe(true);
        // Un campo que no es el título no se busca.
        expect(await titles(admin, 'zeta')).toEqual([]);
        // Otra empresa jamás.
        expect((await titles(admin, 'ajena'))).toEqual([]);
    });

    it('respeta el scope de lectura del rol (el agente ve sólo lo suyo por defecto)', async () => {
        expect(await titles(agent, 'inge')).toEqual(['Ingenio del agente']);
        expect(await titles(viewer, 'inge')).toEqual(['Acme Ingeniería', 'Ingenio del agente', 'Portal de ingeniería']);
    });

    it('una lista sin acceso o con el título oculto no entra en la búsqueda', async () => {
        await lists_.updatePermissions(tenantId, 'clientes', {
            permissions: { viewer: { view: 'none', create: false, edit: 'none', delete: 'none', fields_hidden: [] } },
        });
        await lists_.updatePermissions(tenantId, 'proyectos', {
            permissions: { viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['titulo'] } },
        });
        expect(await titles(viewer, 'inge')).toEqual([]);
        expect(await titles(viewer, 'ingrid')).toEqual(['Ingrid Salario']);
        // Compartida con la persona puntual: pisa al rol.
        // (directo en la fila: `updatePermissions` exige que sea miembro real).
        const share = { [String(viewer.userId)]: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: [] } };
        await pg.db.execute(
            sql`update lists set settings = jsonb_set(settings, '{permissions,users}', ${JSON.stringify(share)}::jsonb) where tenant_id = ${tenantId} and slug = 'clientes'`,
        );
        expect(await titles(viewer, 'inge')).toEqual(['Acme Ingeniería', 'Ingenio del agente']);
    });

    it('el texto buscado viaja bindeado: comillas y comodines no rompen ni amplían', async () => {
        expect(await titles(admin, "'; drop table records; --")).toEqual([]);
        expect(await titles(admin, '%')).toEqual([]);
        expect(await titles(admin, '_')).toEqual([]);
    });

    it('el rol client no busca nada', async () => {
        expect(await search.search(tenantId, { userId: 9, role: 'client' }, { q: 'inge', limit: 20 })).toEqual([]);
    });
});
