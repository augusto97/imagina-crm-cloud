import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { LIST_FEATURES_BASE, readListFeatures } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { activity, fields, lists, memberships, recordChecklists, recordDependencies, records, tenants, timeEntries, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { DuplicatesService } from '../src/duplicates/duplicates.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { DependenciesRepository } from '../src/records/dependencies.repository';
import { DependenciesService } from '../src/records/dependencies.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/**
 * v0.1.475 (ADR-S115) — «Funciones de la lista»: cada lista enciende o apaga
 * descripción, resumen con IA, subtareas, checklists, dependencias, tiempo y
 * aviso de duplicados. Apagar esconde; nunca borra.
 */
describe('Funciones de la lista (Postgres real + RLS)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let dups: DuplicatesService;
    let deps: DependenciesService;
    let tenantId: number;
    let admin: Actor;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists_);
        const recRepo = new RecordsRepository();
        recs = new RecordsService(tenantDb, recRepo, lists_, fields_, rt, act, new AutomationDispatcher(), new RelationsRepository());
        const audit = new AuditService(tenantDb);
        dups = new DuplicatesService(tenantDb, recs, audit, rt);
        deps = new DependenciesService(tenantDb, lists_, fields_, recs, recRepo, new DependenciesRepository(), act, rt, audit);
        const [t] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise' }).returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Admin' }).returning();
        admin = { userId: u!.id, role: 'admin' };
        await pg.db.insert(memberships).values({ tenantId, userId: admin.userId, role: 'admin' });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(recordDependencies).where(eq(recordDependencies.tenantId, tenantId));
            await tx.delete(recordChecklists).where(eq(recordChecklists.tenantId, tenantId));
            await tx.delete(timeEntries).where(eq(timeEntries.tenantId, tenantId));
            await tx.delete(activity).where(eq(activity.tenantId, tenantId));
            await tx.execute(sql`UPDATE records SET parent_id = NULL WHERE tenant_id = ${tenantId}`);
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
    });

    const featuresOf = async (key: string) => readListFeatures((await lists_.get(tenantId, key)).settings);

    it('una lista nueva nace con la base; el alta acepta las que se piden', async () => {
        const blank = await lists_.create(tenantId, { name: 'Clientes' });
        expect(readListFeatures(blank.settings)).toEqual(LIST_FEATURES_BASE);
        expect(blank.settings.features).toEqual(LIST_FEATURES_BASE);
        const tareas = await lists_.create(tenantId, { name: 'Tareas', features: { subtasks: true, checklists: true } });
        expect(readListFeatures(tareas.settings)).toEqual({ ...LIST_FEATURES_BASE, subtasks: true, checklists: true });
    });

    it('cambiar una función no toca las demás ni el resto de los ajustes; un valor inválido es 400', async () => {
        const l = await lists_.create(tenantId, { name: 'Anualidades' });
        await lists_.update(tenantId, l.slug, { settings: { title_field_id: null, other: 'ok' } }, { mergeSettings: true });
        await lists_.update(tenantId, l.slug, { settings: { features: { time_tracking: true } } }, { mergeSettings: true });
        await lists_.update(tenantId, l.slug, { settings: { features: { ai_summary: false } } }, { mergeSettings: true });
        const after = await lists_.get(tenantId, l.slug);
        expect(readListFeatures(after.settings)).toEqual({ ...LIST_FEATURES_BASE, time_tracking: true, ai_summary: false });
        expect(after.settings.other).toBe('ok');
        // Guardar otro ajuste (sin `features`) conserva lo elegido.
        await lists_.update(tenantId, l.slug, { settings: { other: 'otra vez' } }, { mergeSettings: true });
        expect(await featuresOf(l.slug)).toEqual({ ...LIST_FEATURES_BASE, time_tracking: true, ai_summary: false });
        // Una clave desconocida o un valor que no es sí/no se rechaza.
        await expect(lists_.update(tenantId, l.slug, { settings: { features: { cohetes: true } } }, { mergeSettings: true })).rejects.toBeInstanceOf(BadRequestException);
        await expect(lists_.update(tenantId, l.slug, { settings: { features: { subtasks: 'si' } } }, { mergeSettings: true })).rejects.toMatchObject({
            response: { code: 'invalid_list_features' },
        });
        expect(await featuresOf(l.slug)).toEqual({ ...LIST_FEATURES_BASE, time_tracking: true, ai_summary: false });
    });

    it('el aviso de duplicados es la función «Duplicados»: apagado no avisa, encenderlo desde el panel la prende', async () => {
        const l = await lists_.create(tenantId, { name: 'Pagos' });
        const nombre = await fields_.create(tenantId, l.slug, { label: 'Nombre', slug: 'nombre', type: 'text' } as never);
        const correo = await fields_.create(tenantId, l.slug, { label: 'Correo', slug: 'correo', type: 'email' } as never);
        const a = await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Ana', [`f${correo.id}`]: 'ana@x.co' } });
        await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Ana', [`f${correo.id}`]: 'ana@x.co' } });
        // Una lista nueva nace sin el aviso: repetir es normal en un pago.
        expect(await dups.forRecord(tenantId, admin, l.slug, a.id)).toEqual([]);
        expect(await dups.check(tenantId, admin, l.slug, { correo: 'ana@x.co' }, { purpose: 'create' })).toEqual([]);
        // Encenderlo desde «Buscar duplicados» escribe la misma función.
        const s = await dups.updateSettings(tenantId, admin, l.slug, { enabled: true });
        expect(s.enabled).toBe(true);
        expect((await featuresOf(l.slug)).duplicates).toBe(true);
        expect((await dups.forRecord(tenantId, admin, l.slug, a.id)).length).toBeGreaterThan(0);
        // Apagarlo desde «Funciones de la lista» lo apaga para el aviso también.
        await lists_.update(tenantId, l.slug, { settings: { features: { duplicates: false } } }, { mergeSettings: true });
        expect((await dups.settings(tenantId, admin, l.slug)).enabled).toBe(false);
        expect(await dups.forRecord(tenantId, admin, l.slug, a.id)).toEqual([]);
    });

    it('con las dependencias apagadas no se crean nuevas (409) y la tabla no muestra el candado; las de antes vuelven al encender', async () => {
        const l = await lists_.create(tenantId, { name: 'Obras', features: { dependencies: true } });
        const nombre = await fields_.create(tenantId, l.slug, { label: 'Nombre', slug: 'nombre', type: 'text' } as never);
        const a = await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Cimientos' } });
        const b = await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Muros' } });
        const c = await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Techo' } });
        await deps.addPair(tenantId, admin, l.slug, a.id, b.id);
        expect((await recs.get(tenantId, admin, l.slug, b.id)).blocked_by_open).toBe(1);

        await lists_.update(tenantId, l.slug, { settings: { features: { dependencies: false } } }, { mergeSettings: true });
        await expect(deps.addPair(tenantId, admin, l.slug, b.id, c.id)).rejects.toBeInstanceOf(ConflictException);
        await expect(deps.addPair(tenantId, admin, l.slug, b.id, c.id)).rejects.toMatchObject({ response: { code: 'list_feature_off' } });
        // El indicador se esconde en la ficha y en el listado…
        expect((await recs.get(tenantId, admin, l.slug, b.id)).blocked_by_open ?? 0).toBe(0);
        const page = await recs.list(tenantId, admin, l.slug, { limit: 50 } as never);
        expect(page.data.find((r) => r.id === b.id)?.blocked_by_open ?? 0).toBe(0);
        // …pero la dependencia sigue guardada y vuelve al encender.
        const kept = await withTenant(pg.db, tenantId, (tx) => tx.select().from(recordDependencies).where(eq(recordDependencies.tenantId, tenantId)));
        expect(kept).toHaveLength(1);
        await lists_.update(tenantId, l.slug, { settings: { features: { dependencies: true } } }, { mergeSettings: true });
        expect((await recs.get(tenantId, admin, l.slug, b.id)).blocked_by_open).toBe(1);
    });

    it('con la descripción apagada el listado no marca el ícono; el documento se conserva', async () => {
        const l = await lists_.create(tenantId, { name: 'Notas' });
        const nombre = await fields_.create(tenantId, l.slug, { label: 'Nombre', slug: 'nombre', type: 'text' } as never);
        const r = await recs.create(tenantId, admin, l.slug, { data: { [`f${nombre.id}`]: 'Con descripción' } });
        await recs.updateDescription(tenantId, admin, l.slug, r.id, {
            description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hola' }] }] },
        } as never);
        const listed = async () => (await recs.list(tenantId, admin, l.slug, { limit: 50 } as never)).data.find((x) => x.id === r.id);
        expect((await listed())?.has_description).toBe(true);
        await lists_.update(tenantId, l.slug, { settings: { features: { description: false } } }, { mergeSettings: true });
        expect((await listed())?.has_description).toBe(false);
        expect((await recs.get(tenantId, admin, l.slug, r.id)).has_description).toBe(false);
        const [row] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ d: records.description }).from(records).where(and(eq(records.tenantId, tenantId), eq(records.id, r.id))),
        );
        expect(row?.d).not.toBeNull();
        await lists_.update(tenantId, l.slug, { settings: { features: { description: true } } }, { mergeSettings: true });
        expect((await listed())?.has_description).toBe(true);
    });

    it('migración 0143: las listas que ya existían quedan «según el uso»', async () => {
        const mk = async (name: string) => {
            const l = await lists_.create(tenantId, { name });
            // Como una lista de antes de esta versión: sin `features`.
            await withTenant(pg.db, tenantId, (tx) => tx.execute(sql`UPDATE lists SET settings = settings - 'features' WHERE id = ${l.id}`));
            const f = await fields_.create(tenantId, l.slug, { label: 'Nombre', slug: 'nombre', type: 'text' } as never);
            return { list: l, field: f.id };
        };
        const simple = await mk('Anualidades viejas');
        const proyecto = await mk('Proyectos viejos');
        const ventas = await mk('Ventas viejas');
        const conReglas = await mk('Clientes viejos');
        const apagado = await mk('Proveedores viejos');

        await recs.create(tenantId, admin, simple.list.slug, { data: { [`f${simple.field}`]: 'Una' } });
        const p1 = await recs.create(tenantId, admin, proyecto.list.slug, { data: { [`f${proyecto.field}`]: 'Padre' } });
        const p2 = await recs.create(tenantId, admin, proyecto.list.slug, { data: { [`f${proyecto.field}`]: 'Otro' } });
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.execute(sql`UPDATE records SET parent_id = ${p1.id} WHERE id = ${p2.id}`);
            await tx.insert(recordChecklists).values({ tenantId, listId: proyecto.list.id, recordId: p1.id, name: 'Pasos' });
            await tx.insert(recordDependencies).values({
                tenantId,
                blockerListId: proyecto.list.id,
                blockerRecordId: p1.id,
                blockedListId: proyecto.list.id,
                blockedRecordId: p2.id,
            });
        });
        const v = await recs.create(tenantId, admin, ventas.list.slug, { data: { [`f${ventas.field}`]: 'Venta' } });
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(timeEntries).values({ tenantId, listId: ventas.list.id, recordId: v.id, userId: admin.userId, workDate: '2026-11-20', seconds: 600 }),
        );
        await lists_.update(tenantId, conReglas.list.slug, { settings: { duplicates: { rules: [{ fields: [conReglas.field] }] } } }, { mergeSettings: true });
        await lists_.update(tenantId, apagado.list.slug, { settings: { duplicates: { rules: [{ fields: [apagado.field] }], enabled: false } } }, { mergeSettings: true });
        // Una lista que ya eligió no se toca al re-correr.
        const elegida = await lists_.create(tenantId, { name: 'Elegida', features: { checklists: true } });

        const file = readFileSync(path.join(__dirname, '..', 'src', 'db', 'migrations', '0143_list_features.sql'), 'utf8');
        await withTenant(pg.db, tenantId, (tx) => tx.execute(sql.raw(file)));

        expect(await featuresOf(simple.list.slug)).toEqual(LIST_FEATURES_BASE);
        expect(await featuresOf(proyecto.list.slug)).toEqual({ ...LIST_FEATURES_BASE, subtasks: true, checklists: true, dependencies: true });
        expect(await featuresOf(ventas.list.slug)).toEqual({ ...LIST_FEATURES_BASE, time_tracking: true });
        expect(await featuresOf(conReglas.list.slug)).toEqual({ ...LIST_FEATURES_BASE, duplicates: true });
        expect(await featuresOf(apagado.list.slug)).toEqual(LIST_FEATURES_BASE);
        expect(await featuresOf(elegida.slug)).toEqual({ ...LIST_FEATURES_BASE, checklists: true });
    });
});
