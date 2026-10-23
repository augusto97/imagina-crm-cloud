import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { tokenizeFieldRefs, type GanttBundle } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { activity, fields, ganttBaselineItems, ganttBaselines, lists, recordDependencies, records, savedViews, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { GanttBaselinesRepository } from '../src/gantt/gantt-baselines.repository';
import { GanttService } from '../src/gantt/gantt.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { remapViewConfig, emptyMaps } from '../src/platform/tenant-transfer.remap';
import { RealtimeService } from '../src/realtime/realtime.service';
import { DependenciesRepository } from '../src/records/dependencies.repository';
import { DependenciesService } from '../src/records/dependencies.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

const rt = new RealtimeService();

/** Dispatcher que anota los eventos (sin cola). */
class SpyDispatcher extends AutomationDispatcher {
    events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

/**
 * A8 — Dependencias entre registros (tabla propia con RLS, sin ciclos,
 * reprogramación en cadena) y B1 — vista Gantt (bundle por rango, línea
 * base, PDF), con Postgres real.
 */
describe('Dependencias entre registros + Gantt (Postgres real + RLS)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists_: ListsService;
    let fields_: FieldsService;
    let recs: RecordsService;
    let deps: DependenciesService;
    let views: ViewsService;
    let gantt: GanttService;
    let dispatcher: SpyDispatcher;
    let tenantA: number;
    let tenantB: number;
    let admin: Actor;
    let ana: Actor;
    let manager: Actor;
    const f: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;
    const ids: Record<string, number> = {};

    const create = async (actor: Actor, values: Record<string, unknown>, parentId?: number): Promise<number> => {
        const data: Record<string, unknown> = {};
        for (const [slug, v] of Object.entries(values)) data[key(slug)] = v;
        return (await recs.create(tenantA, actor, 'proyecto', { data, ...(parentId ? { parent_id: parentId } : {}) })).id;
    };
    const get = async (id: number): Promise<Record<string, unknown>> =>
        (await recs.get(tenantA, admin, 'proyecto', id)).data as Record<string, unknown>;
    const openOf = async (id: number): Promise<number> => (await recs.get(tenantA, admin, 'proyecto', id)).blocked_by_open ?? 0;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        lists_ = new ListsService(tenantDb, new ListsRepository(), rt);
        fields_ = new FieldsService(tenantDb, new FieldsRepository(), lists_, rt);
        dispatcher = new SpyDispatcher();
        const act = new ActivityService(tenantDb, new ActivityRepository(), lists_);
        const recRepo = new RecordsRepository();
        recs = new RecordsService(tenantDb, recRepo, lists_, fields_, rt, act, dispatcher, new RelationsRepository());
        const audit = new AuditService(tenantDb);
        const depRepo = new DependenciesRepository();
        deps = new DependenciesService(tenantDb, lists_, fields_, recs, recRepo, depRepo, act, rt, audit);
        views = new ViewsService(tenantDb, new ViewsRepository(), lists_, rt);
        gantt = new GanttService(tenantDb, lists_, recs, views, depRepo, new GanttBaselinesRepository(), rt, undefined, audit);
        const [a] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [b] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tenantA = a!.id;
        tenantB = b!.id;
        const mkUser = async (email: string, name: string): Promise<number> =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        admin = { userId: await mkUser('admin@t.local', 'Admin'), role: 'admin' };
        ana = { userId: await mkUser('ana@t.local', 'Ana'), role: 'agent' };
        manager = { userId: await mkUser('mara@t.local', 'Mara'), role: 'manager' };
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        dispatcher.events = [];
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.delete(ganttBaselineItems).where(eq(ganttBaselineItems.tenantId, tenantA));
            await tx.delete(ganttBaselines).where(eq(ganttBaselines.tenantId, tenantA));
            await tx.delete(savedViews).where(eq(savedViews.tenantId, tenantA));
            await tx.delete(recordDependencies).where(eq(recordDependencies.tenantId, tenantA));
            await tx.delete(activity).where(eq(activity.tenantId, tenantA));
            await tx.delete(records).where(eq(records.tenantId, tenantA));
            await tx.delete(fields).where(eq(fields.tenantId, tenantA));
            await tx.delete(lists).where(eq(lists.tenantId, tenantA));
        });
        await lists_.create(tenantA, { name: 'Proyecto' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fields_.create(tenantA, 'proyecto', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('nombre', 'text');
        await mk('estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente', color: 'amber' },
                { value: 'en_curso', label: 'En curso', color: 'blue' },
                { value: 'hecho', label: 'Completado', color: 'green' },
            ],
        });
        await mk('inicio', 'date');
        await mk('fin', 'date');
        await mk('responsable', 'user');
        ids.A = await create(admin, { nombre: 'Diseño', estado: 'en_curso', inicio: '2026-03-02', fin: '2026-03-06', responsable: ana.userId });
        ids.B = await create(admin, { nombre: 'Desarrollo', estado: 'pendiente', inicio: '2026-03-09', fin: '2026-03-20' });
        ids.C = await create(admin, { nombre: 'Pruebas', estado: 'pendiente', inicio: '2026-03-23', fin: '2026-03-27' });
        ids.H = await create(admin, { nombre: 'Lanzamiento', inicio: '2026-03-31' });
        ids.L = await create(admin, { nombre: 'Lejos', inicio: '2026-09-01', fin: '2026-09-10' });
        ids.U = await create(admin, { nombre: 'Sin fecha' });
        ids.S = await create(admin, { nombre: 'Subtarea de B', inicio: '2026-03-10', fin: '2026-03-11' }, ids.B);
        // Una de Ana (agente, «sólo lo suyo»).
        ids.N = await create(ana, { nombre: 'De Ana', inicio: '2026-03-04', fin: '2026-03-05' });
    });

    // ─────────────────────────── A8 ───────────────────────────

    it('agregar y quitar: la ficha ve «bloqueado por» y «bloquea» con título y estado; actividad en las dos puntas', async () => {
        const res = await deps.add(tenantA, admin, 'proyecto', ids.B!, { kind: 'blocked_by', record_id: ids.A! });
        expect(res.blocked_by).toHaveLength(1);
        expect(res.blocked_by[0]).toMatchObject({ record_id: ids.A, title: 'Diseño', done: false, status: { value: 'en_curso', label: 'En curso', color: 'blue' } });
        expect(res.blocks).toHaveLength(0);
        const fromA = await deps.forRecord(tenantA, admin, 'proyecto', ids.A!);
        expect(fromA.blocks.map((l) => l.title)).toEqual(['Desarrollo']);
        // «Bloquea» desde la otra punta.
        await deps.add(tenantA, admin, 'proyecto', ids.B!, { kind: 'blocks', record_id: ids.C!, lag_days: 2 });
        const fromB = await deps.forRecord(tenantA, admin, 'proyecto', ids.B!);
        expect(fromB.blocks).toMatchObject([{ record_id: ids.C, lag_days: 2 }]);

        const acts = await withTenant(pg.db, tenantA, (tx) => tx.select().from(activity).where(eq(activity.action, 'dependency_added')));
        expect(acts.map((a) => a.recordId).sort()).toEqual([ids.A, ids.B, ids.B, ids.C].sort());
        expect(acts.find((a) => a.recordId === ids.A)?.diff).toMatchObject({ dependency: { kind: 'blocks', record_id: ids.B, title: 'Desarrollo' } });

        // Repetirla no duplica (cambia el desfase).
        const again = await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!, 1);
        expect(again.created).toBe(false);
        expect(again.lag_days).toBe(1);

        await deps.remove(tenantA, admin, 'proyecto', fromB.blocks[0]!.id, ids.B!);
        expect((await deps.forRecord(tenantA, admin, 'proyecto', ids.C!)).blocked_by).toHaveLength(0);
        expect(await withTenant(pg.db, tenantA, (tx) => tx.select().from(activity).where(eq(activity.action, 'dependency_removed')))).toHaveLength(2);
    });

    it('sin ciclos: A→B→C y C→A se rechaza con el camino; también a sí mismo', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        await deps.addPair(tenantA, admin, 'proyecto', ids.B!, ids.C!);
        const err = await deps.addPair(tenantA, admin, 'proyecto', ids.C!, ids.A!).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(BadRequestException);
        const body = (err as BadRequestException).getResponse() as { code: string; message: string; data: { path: number[] } };
        expect(body.code).toBe('dependency_cycle');
        expect(body.message).toContain('Diseño');
        expect(body.data.path).toEqual([ids.A, ids.B, ids.C]);
        await expect(deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.A!)).rejects.toBeInstanceOf(BadRequestException);
        // Un registro en la papelera sigue contando para los ciclos: si vuelve, no cierra un círculo.
        await recs.remove(tenantA, admin, 'proyecto', ids.B!);
        const viaTrash = await deps.addPair(tenantA, admin, 'proyecto', ids.C!, ids.A!).catch((e: unknown) => e);
        expect(((viaTrash as BadRequestException).getResponse() as { code: string }).code).toBe('dependency_cycle');
        // Y un registro en la papelera no se puede vincular.
        await expect(deps.addPair(tenantA, admin, 'proyecto', ids.B!, ids.H!)).rejects.toBeInstanceOf(NotFoundException);
        // Plan del asistente: el mismo chequeo, sin escribir.
        await recs.restoreDeleted(tenantA, admin, 'proyecto', ids.B!, { children: [ids.S!], relations: {} });
        const plan = await deps.plan(tenantA, admin, 'proyecto', [{ blocker: ids.C!, blocked: ids.A! }], []);
        expect(plan.problems.join(' ')).toContain('círculo');
        const ok = await deps.plan(tenantA, admin, 'proyecto', [{ blocker: ids.C!, blocked: ids.A! }], [{ blocker: ids.B!, blocked: ids.C! }]);
        expect(ok.problems).toEqual([]);
    });

    it('permisos: un agente sólo cambia dependencias de lo que puede editar; ve el bloqueante ajeno sin su título', async () => {
        // Ana no puede editar B (no es suyo).
        await expect(deps.addPair(tenantA, ana, 'proyecto', ids.N!, ids.B!)).rejects.toBeInstanceOf(NotFoundException);
        // Sí lo suyo: N bloqueado por A → A no lo ve («sólo lo suyo»): 404.
        await expect(deps.addPair(tenantA, ana, 'proyecto', ids.A!, ids.N!)).rejects.toBeInstanceOf(NotFoundException);
        // Un admin lo arma; Ana ve que hay un bloqueante pero no qué es.
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.N!);
        const seen = await deps.forRecord(tenantA, ana, 'proyecto', ids.N!);
        expect(seen.blocked_by).toHaveLength(1);
        expect(seen.blocked_by[0]!.title).toBeNull();
        expect(seen.blocked_by[0]!.status).toBeNull();
        // Un manager edita todo.
        await expect(deps.addPair(tenantA, manager, 'proyecto', ids.B!, ids.C!)).resolves.toMatchObject({ created: true });
        // Quitar la dependencia del registro de otro: el agente no puede.
        const dep = (await deps.forRecord(tenantA, admin, 'proyecto', ids.C!)).blocked_by[0]!;
        await expect(deps.remove(tenantA, ana, 'proyecto', dep.id)).rejects.toBeInstanceOf(NotFoundException);
        void ForbiddenException;
    });

    it('bloqueantes abiertos en el listado: «terminado» por la etiqueta del estado; la papelera los deja inertes y vuelven al restaurar', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        await deps.addPair(tenantA, admin, 'proyecto', ids.H!, ids.B!);
        expect(await openOf(ids.B!)).toBe(2);
        const page = await recs.list(tenantA, admin, 'proyecto', { limit: 50, sort_dir: 'asc' } as never);
        expect(page.data.find((r) => r.id === ids.B)?.blocked_by_open).toBe(2);
        expect(page.data.find((r) => r.id === ids.A)?.blocked_by_open).toBe(0);
        // «Completado» es terminado (como en «Mi trabajo»).
        await recs.update(tenantA, admin, 'proyecto', ids.A!, { data: { [key('estado')]: 'hecho' } });
        expect(await openOf(ids.B!)).toBe(1);
        expect((await deps.forRecord(tenantA, admin, 'proyecto', ids.B!)).blocked_by.find((l) => l.record_id === ids.A)?.done).toBe(true);
        // H a la papelera: la dependencia queda inerte (no cuenta ni se lista).
        await recs.remove(tenantA, admin, 'proyecto', ids.H!);
        expect(await openOf(ids.B!)).toBe(0);
        expect((await deps.forRecord(tenantA, admin, 'proyecto', ids.B!)).blocked_by).toHaveLength(1);
        // Vuelve con el registro.
        await recs.restoreDeleted(tenantA, admin, 'proyecto', ids.H!, { children: [], relations: {} });
        expect(await openOf(ids.B!)).toBe(1);
    });

    it('reprogramación en cadena: correr el fin de A corre B y C lo mismo (actividad + automatizaciones); apagada no corre nada', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        await deps.addPair(tenantA, admin, 'proyecto', ids.B!, ids.C!);
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.S!);
        // Apagada: nada se mueve.
        await recs.update(tenantA, admin, 'proyecto', ids.A!, { data: { [key('fin')]: '2026-03-07' } });
        expect((await get(ids.B!))[key('inicio')]).toBe('2026-03-09');

        await expect(deps.updateSettings(tenantA, admin, 'proyecto', { reschedule: true })).rejects.toBeInstanceOf(BadRequestException);
        await expect(deps.updateSettings(tenantA, admin, 'proyecto', { reschedule: true, end_field_id: f.nombre! })).rejects.toBeInstanceOf(BadRequestException);
        const s = await deps.updateSettings(tenantA, admin, 'proyecto', { reschedule: true, start_field_id: f.inicio!, end_field_id: f.fin! });
        expect(s).toEqual({ reschedule: true, start_field_id: f.inicio, end_field_id: f.fin });

        dispatcher.events = [];
        const out = await recs.update(tenantA, admin, 'proyecto', ids.A!, { data: { [key('fin')]: '2026-03-10' } });
        expect(out.rescheduled?.sort()).toEqual([ids.B, ids.C, ids.S].sort());
        expect(await get(ids.B!)).toMatchObject({ [key('inicio')]: '2026-03-12', [key('fin')]: '2026-03-23' });
        expect(await get(ids.C!)).toMatchObject({ [key('inicio')]: '2026-03-26', [key('fin')]: '2026-03-30' });
        expect(await get(ids.S!)).toMatchObject({ [key('inicio')]: '2026-03-13', [key('fin')]: '2026-03-14' });
        // Cada corrido deja su actividad y dispara automatizaciones.
        const acts = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(activity).where(and(eq(activity.action, 'record_updated'), eq(activity.recordId, ids.C!))),
        );
        expect(acts.at(-1)?.diff).toMatchObject({ [key('inicio')]: { from: '2026-03-23', to: '2026-03-26' } });
        expect(dispatcher.events.map((e) => e.recordId).sort()).toEqual([ids.A, ids.B, ids.C, ids.S].sort());

        // Hacia atrás también (se corre lo mismo).
        await recs.update(tenantA, admin, 'proyecto', ids.A!, { data: { [key('fin')]: '2026-03-08' } });
        expect((await get(ids.C!))[key('fin')]).toBe('2026-03-28');
        // Lo que no se puede editar no se mueve: Ana corre su registro sin dependientes.
        await deps.addPair(tenantA, admin, 'proyecto', ids.N!, ids.L!);
        await recs.update(tenantA, ana, 'proyecto', ids.N!, { data: { [key('fin')]: '2026-03-15' } });
        expect((await get(ids.L!))[key('inicio')]).toBe('2026-09-01');
    });

    it('RLS: otra empresa no ve dependencias ni líneas base', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        const v = await views.create(tenantA, 'proyecto', { name: 'Gantt', type: 'gantt', config: { gantt_start_field_id: f.inicio, gantt_end_field_id: f.fin } }, admin);
        await gantt.saveBaseline(tenantA, admin, 'proyecto', v.id, {});
        for (const table of [recordDependencies, ganttBaselines, ganttBaselineItems]) {
            expect(await withTenant(pg.db, tenantB, (tx) => tx.select().from(table))).toHaveLength(0);
            expect((await withTenant(pg.db, tenantA, (tx) => tx.select().from(table))).length).toBeGreaterThan(0);
        }
    });

    // ─────────────────────────── B1 ───────────────────────────

    it('bundle: sólo lo del rango (barras que lo cruzan e hitos), padres de subtareas, «Sin programar» y flechas', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        await deps.addPair(tenantA, admin, 'proyecto', ids.B!, ids.L!);
        const b: GanttBundle = await gantt.bundle(tenantA, admin, 'proyecto', {
            startFieldId: f.inicio!,
            endFieldId: f.fin!,
            from: '2026-03-05',
            to: '2026-03-31',
            subtasks: true,
            unscheduled: true,
        });
        const names = b.records.map((r) => r.fields.nombre);
        expect(names).toEqual(expect.arrayContaining(['Diseño', 'Desarrollo', 'Pruebas', 'Lanzamiento', 'Subtarea de B', 'De Ana']));
        expect(names).not.toContain('Lejos');
        expect(b.unscheduled.map((r) => r.fields.nombre)).toEqual(['Sin fecha']);
        expect(b.meta.unscheduled_total).toBe(1);
        // Flechas sólo entre lo que se muestra (B→L queda afuera).
        expect(b.dependencies).toEqual([expect.objectContaining({ blocker_id: ids.A, blocked_id: ids.B })]);
        expect(b.records.find((r) => r.id === ids.B)?.blocked_by_open).toBe(1);
        expect(b.reschedule.enabled).toBe(false);

        // Una subtarea en el rango trae a su padre aunque el padre no esté.
        const late = await gantt.bundle(tenantA, admin, 'proyecto', { startFieldId: f.inicio!, endFieldId: f.fin!, from: '2026-03-10', to: '2026-03-11', subtasks: true, unscheduled: false });
        expect(late.records.map((r) => r.fields.nombre).sort()).toEqual(['Desarrollo', 'Subtarea de B']);
        // El ACL de la lista: Ana sólo ve lo suyo.
        const hers = await gantt.bundle(tenantA, ana, 'proyecto', { startFieldId: f.inicio!, endFieldId: null, from: '2026-03-01', to: '2026-03-31', subtasks: true, unscheduled: true });
        expect(hers.records.map((r) => r.fields.nombre)).toEqual(['De Ana']);
        // Rango inválido.
        await expect(gantt.bundle(tenantA, admin, 'proyecto', { startFieldId: f.inicio!, endFieldId: null, from: '2026-03-10', to: '2026-03-01', subtasks: true, unscheduled: false })).rejects.toBeInstanceOf(BadRequestException);
        await expect(gantt.bundle(tenantA, admin, 'proyecto', { startFieldId: f.nombre!, endFieldId: null, from: '2026-03-01', to: '2026-03-10', subtasks: true, unscheduled: false })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('línea base: congela las fechas, la barra fantasma sigue en su lugar al mover; protegida y borrar', async () => {
        const v = await views.create(tenantA, 'proyecto', { name: 'Gantt', type: 'gantt', config: { gantt_start_field_id: f.inicio, gantt_end_field_id: f.fin } }, admin);
        const saved = await gantt.saveBaseline(tenantA, admin, 'proyecto', v.id, { name: 'Plan inicial' });
        expect(saved).toMatchObject({ name: 'Plan inicial', start_field_id: f.inicio, end_field_id: f.fin, created_by_name: 'Admin' });
        expect(saved.item_count).toBe(7); // todo lo que tiene alguna fecha
        await recs.update(tenantA, admin, 'proyecto', ids.B!, { data: { [key('fin')]: '2026-03-25' } });
        const b = await gantt.bundle(tenantA, admin, 'proyecto', { startFieldId: f.inicio!, endFieldId: f.fin!, from: '2026-03-01', to: '2026-03-31', viewId: v.id, subtasks: true, unscheduled: false });
        expect(b.baseline?.items[String(ids.B)]).toEqual({ start: '2026-03-09', end: '2026-03-20' });
        expect(b.records.find((r) => r.id === ids.B)?.fields.fin).toBe('2026-03-25');
        // Guardar otra reemplaza.
        await gantt.saveBaseline(tenantA, admin, 'proyecto', v.id, {});
        expect(await withTenant(pg.db, tenantA, (tx) => tx.select().from(ganttBaselines))).toHaveLength(1);
        expect((await gantt.getBaseline(tenantA, admin, 'proyecto', v.id))?.name).toMatch(/^Línea base del /);
        // Protegida: sólo su autor o un admin.
        await views.update(tenantA, 'proyecto', v.id, { is_locked: true }, admin);
        await expect(gantt.saveBaseline(tenantA, manager, 'proyecto', v.id, {})).rejects.toBeInstanceOf(ForbiddenException);
        // Una vista que no es Gantt.
        const t = await views.create(tenantA, 'proyecto', { name: 'Tabla', type: 'table', config: {} }, admin);
        await expect(gantt.saveBaseline(tenantA, admin, 'proyecto', t.id, {})).rejects.toBeInstanceOf(BadRequestException);
        await gantt.deleteBaseline(tenantA, admin, 'proyecto', v.id);
        expect(await gantt.getBaseline(tenantA, admin, 'proyecto', v.id)).toBeNull();
        await expect(gantt.deleteBaseline(tenantA, admin, 'proyecto', v.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('PDF vectorial del rango visible, con grupos y columnas', async () => {
        await deps.addPair(tenantA, admin, 'proyecto', ids.A!, ids.B!);
        const v = await views.create(tenantA, 'proyecto', { name: 'Plan', type: 'gantt', config: { gantt_start_field_id: f.inicio, gantt_end_field_id: f.fin } }, admin);
        await gantt.saveBaseline(tenantA, admin, 'proyecto', v.id, {});
        const doc = await gantt.pdf(tenantA, admin, 'proyecto', {
            view_id: v.id,
            start_field_id: f.inicio!,
            end_field_id: f.fin!,
            group_by_field_id: f.estado!,
            color_field_id: f.estado!,
            column_field_ids: [f.responsable!, f.estado!],
            zoom: 'week',
            from: '2026-03-01',
            to: '2026-04-05',
        });
        expect(doc.buffer.subarray(0, 5).toString()).toBe('%PDF-');
        expect(doc.buffer.length).toBeGreaterThan(2000);
        expect(doc.filename).toBe('plan-gantt.pdf');
    });

    it('la config del Gantt se re-mapea por convención (plantillas y migrar empresa), también los grupos por persona', () => {
        const cfg = {
            gantt_start_field_id: 10,
            gantt_end_field_id: 11,
            gantt_group_by_field_id: 12,
            gantt_color_field_id: 13,
            gantt_columns: [{ field_id: 12, width: 120 }],
            collapsed_groups: ['30', '__null__', '99'],
        };
        expect(tokenizeFieldRefs(cfg, new Map([[10, 'inicio'], [11, 'fin'], [12, 'responsable'], [13, 'estado']]))).toMatchObject({
            gantt_start_field_id: { $field: 'inicio' },
            gantt_columns: [{ field_id: { $field: 'responsable' }, width: 120 }],
        });
        const maps = emptyMaps();
        for (const [a, b] of [[10, 110], [11, 111], [12, 112], [13, 113]] as const) maps.field.set(a, b);
        maps.user.set(30, 330);
        const out = remapViewConfig(cfg, new Map([[12, 'user']]), maps);
        expect(out).toMatchObject({
            gantt_start_field_id: 110,
            gantt_end_field_id: 111,
            gantt_group_by_field_id: 112,
            gantt_color_field_id: 113,
            gantt_columns: [{ field_id: 112, width: 120 }],
            collapsed_groups: ['330', '__null__'],
        });
    });
});
