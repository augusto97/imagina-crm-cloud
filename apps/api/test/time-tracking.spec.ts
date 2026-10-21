import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { formatTrackedSeconds, timeDurationInputSchema } from '@imagina-base/shared';
import { activity, memberships, records as recordsTable, tenants, timeEntries, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AggregateService } from '../src/aggregate/aggregate.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { ExportService } from '../src/export/export.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TimeTrackingService } from '../src/time-tracking/time-tracking.service';
import { ViewsRepository } from '../src/views/views.repository';
import { ViewsService } from '../src/views/views.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * v0.1.288 — Registro de tiempo: cronómetro único por persona, cargas a mano,
 * permisos sobre las entradas, el campo derivado «Tiempo registrado» (filtra,
 * ordena, suma) y el CSV, con Postgres real y RLS.
 */
describe('Registro de tiempo (Postgres real + RLS)', () => {
    let pg: TestPg;
    let lists: ListsService;
    let fields: FieldsService;
    let records: RecordsService;
    let time: TimeTrackingService;
    let aggregate: AggregateService;
    let exporter: ExportService;
    const timerEvents: Array<[number, number]> = [];
    let tenantA: number;
    let tenantB: number;
    let ana: Actor;
    let beto: Actor;
    let caro: Actor;
    let nombre: number;
    let tracked: number;

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const realTimer = rt.timer.bind(rt);
        rt.timer = (t: number, u: number) => {
            timerEvents.push([t, u]);
            realTimer(t, u);
        };
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fields = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        records = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            lists,
            fields,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), lists),
            new AutomationDispatcher(),
            new RelationsRepository(),
        );
        time = new TimeTrackingService(tenantDb, lists, fields, records, rt);
        aggregate = new AggregateService(tenantDb, lists, fields);
        exporter = new ExportService(tenantDb, lists, fields, new ViewsService(tenantDb, new ViewsRepository(), lists, rt), records);

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        const mk = async (email: string, name: string) =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x' }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test', 'Ana'), role: 'admin' };
        beto = { userId: await mk('beto@acme.test', 'Beto'), role: 'agent' };
        caro = { userId: await mk('caro@acme.test', 'Caro'), role: 'manager' };
        await withTenant(pg.db, tenantA, (tx) =>
            tx.insert(memberships).values([
                { tenantId: tenantA, userId: ana.userId, role: 'admin' },
                { tenantId: tenantA, userId: beto.userId, role: 'agent' },
                { tenantId: tenantA, userId: caro.userId, role: 'manager' },
            ]),
        );
        await lists.create(tenantA, { name: 'Proyectos' });
        nombre = (await fields.create(tenantA, 'proyectos', { label: 'Nombre', type: 'text', slug: 'nombre' })).id;
        tracked = (await fields.create(tenantA, 'proyectos', { label: 'Tiempo', type: 'time_tracked', slug: 'tiempo' })).id;
        // Colaborar en la lista: el agente ve y edita todo (para probar la
        // propiedad de las ENTRADAS, no el alcance de la fila).
        const l = await lists.get(tenantA, 'proyectos');
        await lists.update(tenantA, 'proyectos', {
            settings: { ...l.settings, permissions: { permissions: { agent: { view: 'all', create: true, edit: 'all', delete: 'none', fields_hidden: [] } } } },
        });
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        timerEvents.length = 0;
        await withTenant(pg.db, tenantA, async (tx) => {
            await tx.delete(timeEntries).where(eq(timeEntries.tenantId, tenantA));
            await tx.delete(activity).where(eq(activity.tenantId, tenantA));
            await tx.delete(recordsTable).where(eq(recordsTable.tenantId, tenantA));
        });
    });

    const rec = async (name: string) => (await records.create(tenantA, ana, 'proyectos', { data: { [`f${nombre}`]: name } })).id;
    /** Lleva el cronómetro en curso N segundos al pasado (sin dormir el test). */
    const backdate = (userId: number, seconds: number) =>
        withTenant(pg.db, tenantA, (tx) =>
            tx
                .update(timeEntries)
                .set({ startedAt: sql`now() - make_interval(secs => ${seconds})` })
                .where(and(eq(timeEntries.userId, userId), eq(timeEntries.source, 'timer'), sql`${timeEntries.endedAt} IS NULL`)),
        );

    it('duración: el mismo parser del campo Duración, con mínimo y máximo', () => {
        expect(timeDurationInputSchema.parse('1h 30m')).toBe(90);
        expect(timeDurationInputSchema.parse('1:30')).toBe(90);
        expect(timeDurationInputSchema.parse(45)).toBe(45);
        expect(timeDurationInputSchema.safeParse('mucho').success).toBe(false);
        expect(timeDurationInputSchema.safeParse('0m').success).toBe(false);
        expect(timeDurationInputSchema.safeParse('1001h').success).toBe(false);
        expect(formatTrackedSeconds(5400)).toBe('1h 30m');
        expect(formatTrackedSeconds(59)).toBe('0m');
    });

    it('un cronómetro en curso por persona: iniciar otro detiene y guarda el anterior', async () => {
        const a = await rec('Sitio web');
        const b = await rec('App');
        const first = await time.start(tenantA, ana, 'proyectos', a, 'maquetando');
        expect(first.stopped).toBeNull();
        expect(first.entry).toMatchObject({ source: 'timer', running: true, seconds: 0, note: 'maquetando', user_name: 'Ana' });
        const active = await time.active(tenantA, ana.userId);
        expect(active).toMatchObject({ list_slug: 'proyectos', record_title: 'Sitio web' });
        expect(timerEvents).toContainEqual([tenantA, ana.userId]);

        await backdate(ana.userId, 600);
        const second = await time.start(tenantA, ana, 'proyectos', b);
        // El de «Sitio web» quedó guardado con sus ~10 minutos.
        expect(second.stopped).toMatchObject({ record_id: a, running: false });
        expect(second.stopped!.seconds).toBeGreaterThanOrEqual(600);
        expect((await time.active(tenantA, ana.userId))!.entry.record_id).toBe(b);
        // A nivel base: UN solo cronómetro abierto (índice único parcial).
        const open = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(timeEntries).where(and(eq(timeEntries.userId, ana.userId), sql`${timeEntries.endedAt} IS NULL`)),
        );
        expect(open).toHaveLength(1);

        // Otra persona puede tener el suyo a la vez.
        await time.start(tenantA, beto, 'proyectos', a);
        const ra = await time.recordTime(tenantA, beto, 'proyectos', a);
        expect(ra.my_running).toMatchObject({ user_id: beto.userId });
        expect(ra.total_seconds).toBeGreaterThanOrEqual(600);

        await backdate(ana.userId, 120);
        const stopped = await time.stop(tenantA, ana);
        expect(stopped).toMatchObject({ record_id: b, running: false });
        expect(stopped!.seconds).toBeGreaterThanOrEqual(120);
        expect(await time.active(tenantA, ana.userId)).toBeNull();
        // Detener sin nada en curso no falla.
        expect(await time.stop(tenantA, ana)).toBeNull();
    });

    it('cargas a mano, total por persona, editar/borrar lo propio (y admin/manager lo de todos)', async () => {
        const r = await rec('Diseño');
        const mine = await time.create(tenantA, beto, 'proyectos', r, { work_date: '2026-10-20', duration: 90, note: 'reunión' });
        await time.create(tenantA, ana, 'proyectos', r, { work_date: '2026-10-21', duration: 30 });
        let t = await time.recordTime(tenantA, ana, 'proyectos', r);
        expect(t.total_seconds).toBe(120 * 60);
        expect(t.by_user.map((u) => [u.user_name, u.seconds]).sort()).toEqual([['Ana', 1800], ['Beto', 5400]]);
        expect(t.entries_count).toBe(2);
        expect(t.can_manage_all).toBe(true);
        expect((await time.recordTime(tenantA, beto, 'proyectos', r)).can_manage_all).toBe(false);

        // El agente edita lo suyo; lo de otro → 403.
        const edited = await time.update(tenantA, beto, 'proyectos', r, mine.id, { duration: 60, note: 'reunión corta' });
        expect(edited).toMatchObject({ seconds: 3600, note: 'reunión corta' });
        const anaEntry = t.entries.find((e) => e.user_id === ana.userId)!;
        await expect(time.update(tenantA, beto, 'proyectos', r, anaEntry.id, { note: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(time.remove(tenantA, beto, 'proyectos', r, anaEntry.id)).rejects.toBeInstanceOf(ForbiddenException);
        // El manager sí puede con lo de otros.
        await time.update(tenantA, caro, 'proyectos', r, mine.id, { work_date: '2026-10-19' });
        await time.remove(tenantA, caro, 'proyectos', r, anaEntry.id);
        t = await time.recordTime(tenantA, ana, 'proyectos', r);
        expect(t.total_seconds).toBe(3600);
        expect(t.entries[0]).toMatchObject({ work_date: '2026-10-19', user_id: beto.userId });

        // La duración de un cronómetro en curso no se cambia a mano.
        const run = await time.start(tenantA, beto, 'proyectos', r);
        await expect(time.update(tenantA, beto, 'proyectos', r, run.entry.id, { duration: 10 })).rejects.toBeInstanceOf(BadRequestException);
        // Una entrada de OTRO registro no se toca por éste.
        const otro = await rec('Otro');
        await expect(time.update(tenantA, ana, 'proyectos', otro, mine.id, { note: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sólo quien VE el registro registra tiempo', async () => {
        const l = await lists.get(tenantA, 'proyectos');
        const saved = l.settings;
        await lists.update(tenantA, 'proyectos', {
            settings: { ...saved, permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: [] } } } },
        });
        try {
            const r = await rec('De Ana');
            await expect(time.start(tenantA, beto, 'proyectos', r)).rejects.toBeInstanceOf(NotFoundException);
            await expect(
                time.create(tenantA, beto, 'proyectos', r, { work_date: '2026-10-20', duration: 30 }),
            ).rejects.toBeInstanceOf(NotFoundException);
            await expect(time.recordTime(tenantA, beto, 'proyectos', r)).rejects.toBeInstanceOf(NotFoundException);
        } finally {
            await lists.update(tenantA, 'proyectos', { settings: saved });
        }
    });

    it('«Tiempo registrado»: valor, filtro, orden y suma en el pie/tableros; no se escribe a mano', async () => {
        const a = await rec('A');
        const b = await rec('B');
        const c = await rec('C');
        await time.create(tenantA, ana, 'proyectos', a, { work_date: '2026-10-20', duration: timeDurationInputSchema.parse('1h 30m') });
        await time.create(tenantA, beto, 'proyectos', b, { work_date: '2026-10-20', duration: 20 });
        // Un cronómetro en curso todavía no suma (lo que suma es lo cerrado).
        await time.start(tenantA, ana, 'proyectos', c);
        const key = `f${tracked}`;
        const got = await records.get(tenantA, ana, 'proyectos', a);
        expect(got.data[key]).toBe(90);
        const filtered = await records.list(tenantA, ana, 'proyectos', {
            limit: 50,
            sort_dir: 'asc',
            filter_tree: { type: 'group', logic: 'and', children: [{ type: 'condition', field_id: tracked, op: 'gt', value: 30 }] },
        });
        expect(filtered.data.map((r) => r.id)).toEqual([a]);
        const sorted = await records.list(tenantA, ana, 'proyectos', { limit: 50, sort_dir: 'asc', sort: `field_${tracked}:desc` });
        expect(sorted.data.map((r) => [r.id, r.data[key]])).toEqual([[a, 90], [b, 20], [c, 0]]);
        expect((await aggregate.run(tenantA, 'proyectos', { metric: 'sum', field_id: tracked })).value).toBe(110);
        expect((await aggregate.run(tenantA, 'proyectos', { metric: 'max', field_id: tracked })).value).toBe(90);
        // Escribirle a mano no cambia nada (lo calcula el servidor).
        await records.update(tenantA, ana, 'proyectos', b, { data: { [key]: 999 } }).catch(() => undefined);
        expect((await records.get(tenantA, ana, 'proyectos', b)).data[key]).toBe(20);
        // El CSV de los registros lo exporta legible.
        let csv = '';
        await exporter.streamCsvExport(tenantA, ana, 'proyectos', { fieldIds: [nombre, tracked], delimiter: ',', withBom: false }, () => undefined, (s) => {
            csv += s;
        });
        expect(csv.trimEnd().split('\r\n')).toEqual(['Nombre,Tiempo', 'A,1h 30m', 'B,20m', 'C,0m']);
    });

    it('CSV de entradas con el ACL de quien exporta, y RLS por empresa', async () => {
        const a = await rec('Visible');
        const b = await rec('Ajeno');
        await time.create(tenantA, ana, 'proyectos', a, { work_date: '2026-10-20', duration: 45, note: '=HYPERLINK("x")' });
        await time.create(tenantA, ana, 'proyectos', b, { work_date: '2026-10-21', duration: 15 });
        const full = await time.exportCsv(tenantA, ana, 'proyectos');
        expect(full.filename).toMatch(/\.csv$/);
        const lines = full.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
        expect(lines[0]).toBe('Fecha,Persona,Registro,ID del registro,Duración,Horas,Nota,Tipo');
        expect(lines).toHaveLength(3);
        // Una nota no puede inyectar una fórmula en la planilla.
        expect(full.csv).not.toContain(',=HYPERLINK');
        // El agente que sólo ve lo suyo no exporta lo ajeno.
        const l = await lists.get(tenantA, 'proyectos');
        const saved = l.settings;
        await lists.update(tenantA, 'proyectos', {
            settings: { ...saved, permissions: { permissions: { agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: [] } } } },
        });
        try {
            const agentCsv = await time.exportCsv(tenantA, beto, 'proyectos');
            expect(agentCsv.csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n')).toHaveLength(1);
        } finally {
            await lists.update(tenantA, 'proyectos', { settings: saved });
        }
        // RLS: otra empresa no ve ninguna entrada.
        expect(await withTenant(pg.db, tenantB, (tx) => tx.select().from(timeEntries))).toHaveLength(0);
        expect(await withTenant(pg.db, tenantA, (tx) => tx.select().from(timeEntries))).toHaveLength(2);
    });

    it('borrar el registro se lleva su tiempo; el cronómetro de un registro borrado se detiene solo', async () => {
        const r = await rec('Se borra');
        await time.start(tenantA, ana, 'proyectos', r);
        await records.remove(tenantA, ana, 'proyectos', r);
        expect(await time.active(tenantA, ana.userId)).toBeNull();
        const open = await withTenant(pg.db, tenantA, (tx) =>
            tx.select().from(timeEntries).where(and(eq(timeEntries.recordId, r), sql`${timeEntries.endedAt} IS NULL`)),
        );
        expect(open).toHaveLength(0);
    });
});
