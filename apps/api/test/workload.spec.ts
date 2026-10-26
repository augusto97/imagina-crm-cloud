import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WORKLOAD_UNASSIGNED, type WorkloadBundle } from '@imagina-base/shared';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { auditLog, fields, lists, memberships, records, tenants, timeEntries, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { parseBundleQuery } from '../src/workload/workload.controller';
import { WorkloadService, type WorkloadBundleQuery } from '../src/workload/workload.service';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * B2 — Carga de trabajo: el bundle por persona y columna (cantidad, esfuerzo
 * repartido en días hábiles y tiempo registrado), en el reloj de la empresa,
 * con el filtro, la búsqueda, el ACL, los campos ocultos y la papelera del
 * listado; las filas de personas (equipo que ve la lista + «Sin asignar»), la
 * capacidad por persona y su permiso.
 */
describe('Carga de trabajo — bundle (B2)', () => {
    let pg: TestPg;
    let recs: RecordsService;
    let lists_: ListsService;
    let fields_: FieldsService;
    let wl: WorkloadService;
    let tenantId: number;
    let otherTenant: number;
    let admin: Actor;
    let ana: Actor;
    let beto: Actor;
    let carla: Actor;
    let exUserId: number;
    let clientId: number;
    let disabledId: number;
    const f: Record<string, number> = {};
    const ids: Record<string, number> = {};
    const key = (slug: string): string => `f${f[slug]}`;

    const RANGE = { from: '2026-10-26', to: '2026-11-08' };
    const query = (q: Partial<WorkloadBundleQuery> = {}): WorkloadBundleQuery => ({
        ...RANGE,
        zoom: 'day',
        metric: 'estimate',
        personFieldId: f.responsable!,
        startFieldId: f.inicio!,
        endFieldId: f.fin!,
        estimateFieldId: f.horas!,
        estimateUnit: 'hours',
        hideDone: true,
        userIds: null,
        showUnassigned: true,
        ...q,
    });
    const bundle = (actor: Actor, q: Partial<WorkloadBundleQuery> = {}): Promise<WorkloadBundle> => wl.bundle(tenantId, actor, 'tareas', query(q));
    const cell = (b: WorkloadBundle, who: number | string, col: string): number | undefined => b.grid[String(who)]?.[col];

    beforeAll(async () => {
        pg = await startPostgres();
        const tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        const tzs = new TenantTimeZones(tenantDb);
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
            undefined,
            undefined,
            undefined,
            tzs,
        );
        wl = new WorkloadService(tenantDb, recs, rt, tzs, new AuditService(tenantDb));
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'ACME', settings: { format: { timezone: 'America/Bogota' } } })
            .returning();
        tenantId = t!.id;
        otherTenant = (await pg.db.insert(tenants).values({ slug: 'otra', name: 'Otra' }).returning())[0]!.id;
        const mkUser = async (email: string, name: string, disabled = false): Promise<number> =>
            (await pg.db.insert(users).values({ email, name, passwordHash: 'x', ...(disabled ? { disabledAt: new Date() } : {}) }).returning())[0]!.id;
        admin = { userId: await mkUser('admin@t.local', 'Admin'), role: 'admin' };
        ana = { userId: await mkUser('ana@t.local', 'Ana'), role: 'agent' };
        beto = { userId: await mkUser('beto@t.local', 'Beto'), role: 'manager' };
        carla = { userId: await mkUser('carla@t.local', 'Carla'), role: 'viewer' };
        exUserId = await mkUser('ex@t.local', 'Ex miembro');
        clientId = await mkUser('cliente@t.local', 'Cliente');
        disabledId = await mkUser('baja@t.local', 'De baja', true);
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(memberships).values([
                { tenantId, userId: admin.userId, role: 'admin' },
                { tenantId, userId: ana.userId, role: 'agent' },
                { tenantId, userId: beto.userId, role: 'manager', settings: { favorites: { lists: [7], dashboards: [], views: [] } } },
                { tenantId, userId: carla.userId, role: 'viewer' },
                { tenantId, userId: clientId, role: 'client' },
                { tenantId, userId: disabledId, role: 'agent' },
            ]),
        );
    });

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(timeEntries).where(eq(timeEntries.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
            await tx
                .update(memberships)
                .set({ settings: { favorites: { lists: [7], dashboards: [], views: [] } } })
                .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, beto.userId)));
        });
        await lists_.create(tenantId, { name: 'Tareas' });
        const mk = async (slug: string, type: string, config?: Record<string, unknown>) => {
            f[slug] = (await fields_.create(tenantId, 'tareas', { label: slug, slug, type, ...(config ? { config } : {}) } as never)).id;
        };
        await mk('titulo', 'text');
        await mk('responsable', 'user');
        await mk('inicio', 'date');
        await mk('fin', 'date');
        await mk('horas', 'number');
        await mk('minutos', 'duration');
        await mk('cuando', 'datetime');
        await mk('estado', 'select', {
            options: [
                { value: 'pendiente', label: 'Pendiente' },
                { value: 'terminado', label: 'Terminado' },
            ],
        });
        const rows: Array<[Actor, Record<string, unknown>]> = [
            // 40 h del lunes 26 al viernes 6: 10 días hábiles → 4 h por día.
            [admin, { titulo: 'Diseño', responsable: ana.userId, inicio: '2026-10-26', fin: '2026-11-06', horas: 40, estado: 'pendiente' }],
            // Una sola fecha (sin fin): 10 h el miércoles 28. Lo crea Ana.
            [ana, { titulo: 'Llamadas', responsable: ana.userId, inicio: '2026-10-28', horas: 10, minutos: 90 }],
            // 20 h jueves y viernes: 10 h por día (más que 8 → pasado).
            [admin, { titulo: 'Informe', responsable: beto.userId, inicio: '2026-10-29', fin: '2026-10-30', horas: 20 }],
            [admin, { titulo: 'Sin dueño', inicio: '2026-10-27', horas: 3 }],
            [admin, { titulo: 'Cerrado', responsable: ana.userId, inicio: '2026-10-27', horas: 5, estado: 'terminado' }],
            [admin, { titulo: 'Sin fecha', responsable: ana.userId, horas: 2 }],
            [admin, { titulo: 'Viejo', responsable: exUserId, inicio: '2026-10-30', horas: 1 }],
            [admin, { titulo: 'Borrado', responsable: ana.userId, inicio: '2026-10-26', horas: 100 }],
            // Un sábado suelto: sin días hábiles se cuenta en su día.
            [admin, { titulo: 'Fin de semana', responsable: beto.userId, inicio: '2026-10-31', horas: 4 }],
            // Empieza ANTES del rango: 20 h en 10 días hábiles → 2 h por día; entran 5.
            [admin, { titulo: 'Antes', responsable: ana.userId, inicio: '2026-10-19', fin: '2026-10-30', horas: 20 }],
            // 03:30 UTC del 27 = 22:30 del 26 en Bogotá.
            [admin, { titulo: 'Noche', responsable: carla.userId, cuando: '2026-10-27T03:30:00.000Z' }],
        ];
        for (const [actor, row] of rows) {
            const data: Record<string, unknown> = {};
            for (const [slug, v] of Object.entries(row)) data[key(slug)] = v;
            ids[String(row.titulo)] = (await recs.create(tenantId, actor, 'tareas', { data })).id;
        }
        await recs.remove(tenantId, admin, 'tareas', ids.Borrado!);
    });

    it('esfuerzo repartido en los días hábiles, por día y en el reloj de la empresa', async () => {
        const b = await bundle(admin);
        expect(b.meta).toMatchObject({ metric: 'estimate', time_zone: 'America/Bogota', hide_done: true, truncated: false, estimate_unit_minutes: 60 });
        // Filas: el equipo que ve la lista (sin el cliente ni la cuenta de baja), el ex miembro con trabajo y «Sin asignar».
        expect(b.people.map((p) => p.name)).toEqual(['Admin', 'Ana', 'Beto', 'Carla', 'Ex miembro', 'Sin asignar']);
        expect(b.people.find((p) => p.user_id === exUserId)!.member).toBe(false);
        // Ana: 4 h (Diseño) + 2 h (Antes) por día, y el 28 además 10 h de Llamadas.
        expect(cell(b, ana.userId, '2026-10-26')).toBeCloseTo(360);
        expect(cell(b, ana.userId, '2026-10-28')).toBeCloseTo(960);
        expect(cell(b, ana.userId, '2026-10-31')).toBeUndefined();
        expect(cell(b, ana.userId, '2026-11-02')).toBeCloseTo(240);
        expect(b.totals[String(ana.userId)]).toMatchObject({ records: 3, capacity: 4800 });
        expect(b.totals[String(ana.userId)]!.value).toBeCloseTo(3600);
        // Beto: 10 h el jueves y el viernes, y el sábado 4 h (sin capacidad: pasado).
        expect(cell(b, beto.userId, '2026-10-29')).toBeCloseTo(600);
        expect(cell(b, beto.userId, '2026-10-31')).toBeCloseTo(240);
        expect(cell(b, WORKLOAD_UNASSIGNED, '2026-10-27')).toBeCloseTo(180);
        expect(cell(b, exUserId, '2026-10-30')).toBeCloseTo(60);
        // El equipo no suma «Sin asignar»; lo informa aparte.
        expect(b.team.value).toBeCloseTo(3600 + 1440 + 60);
        expect(b.team.unassigned).toBeCloseTo(180);
        // Sin fecha: Ana tiene uno (la grilla no lo ve).
        expect(b.unscheduled[String(ana.userId)]).toBe(1);
        // La papelera no cuenta.
        expect(b.items.map((i) => i.title)).not.toContain('Borrado');
        // Lo terminado se oculta por defecto en el esfuerzo.
        expect(b.items.map((i) => i.title)).not.toContain('Cerrado');
        const disenio = b.items.find((i) => i.id === ids.Diseño)!;
        expect(disenio).toMatchObject({ person: String(ana.userId), person_value: ana.userId, start: '2026-10-26', end: '2026-11-06', estimate_minutes: 2400, editable: true });
    });

    it('cantidad por semana, terminados a pedido y personas visibles', async () => {
        const b = await bundle(admin, { metric: 'count', zoom: 'week', estimateFieldId: null });
        expect(cell(b, ana.userId, '2026-10-26')).toBe(3);
        expect(cell(b, ana.userId, '2026-11-02')).toBe(1);
        expect(b.totals[String(ana.userId)]).toEqual({ value: 3, capacity: 20, records: 3 });
        expect(cell(b, beto.userId, '2026-10-26')).toBe(2);
        expect(b.team.unassigned).toBe(1);
        const all = await bundle(admin, { metric: 'count', zoom: 'week', hideDone: false });
        expect(cell(all, ana.userId, '2026-10-26')).toBe(4);
        const only = await bundle(admin, { metric: 'count', zoom: 'week', userIds: [beto.userId], showUnassigned: false });
        expect(only.people.map((p) => p.user_id)).toEqual([beto.userId]);
        expect(only.items.every((i) => i.person === String(beto.userId))).toBe(true);
        expect(only.team.value).toBe(2);
    });

    it('fecha y hora en la zona de la empresa (22:30 del 26 en Bogotá es el 26)', async () => {
        const b = await bundle(admin, { metric: 'count', startFieldId: f.cuando!, endFieldId: null, estimateFieldId: null });
        expect(cell(b, carla.userId, '2026-10-26')).toBe(1);
        expect(cell(b, carla.userId, '2026-10-27')).toBeUndefined();
    });

    it('la capacidad propia cambia el reparto y el límite; se guarda sin pisar otros ajustes', async () => {
        await expect(wl.setCapacity(tenantId, ana, beto.userId, { hours_per_day: 4, work_days: [1], records_per_week: 2 })).rejects.toBeInstanceOf(ForbiddenException);
        await expect(wl.setCapacity(tenantId, admin, clientId, { hours_per_day: 4, work_days: [1], records_per_week: 2 })).rejects.toBeInstanceOf(NotFoundException);
        const saved = await wl.setCapacity(tenantId, beto, beto.userId, { hours_per_day: 10, work_days: [4, 1, 2, 3], records_per_week: 6 });
        expect(saved).toMatchObject({ capacity: { hours_per_day: 10, work_days: [1, 2, 3, 4], records_per_week: 6 }, capacity_custom: true });
        const [m] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ settings: memberships.settings }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, beto.userId))),
        );
        expect(m!.settings).toEqual({ favorites: { lists: [7], dashboards: [], views: [] }, capacity: { hours_per_day: 10, work_days: [1, 2, 3, 4], records_per_week: 6 } });
        // Beto trabaja de lunes a jueves: las 20 h de Informe (jueves y viernes) caen el jueves.
        const b = await bundle(admin);
        expect(cell(b, beto.userId, '2026-10-29')).toBeCloseTo(1200);
        expect(cell(b, beto.userId, '2026-10-30')).toBeUndefined();
        expect(b.totals[String(beto.userId)]!.capacity).toBe(8 * 600);
        expect(b.people.find((p) => p.user_id === beto.userId)!.capacity_custom).toBe(true);
        // La lista de personas del diálogo la trae también.
        const people = await wl.people(tenantId, admin, 'tareas');
        expect(people.map((p) => p.name)).toEqual(['Admin', 'Ana', 'Beto', 'Carla']);
        // Volver al valor por defecto.
        const reset = await wl.setCapacity(tenantId, admin, beto.userId, null);
        expect(reset.capacity_custom).toBe(false);
        const [m2] = await withTenant(pg.db, tenantId, (tx) =>
            tx.select({ settings: memberships.settings }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, beto.userId))),
        );
        expect(m2!.settings).toEqual({ favorites: { lists: [7], dashboards: [], views: [] } });
        const audit = await withTenant(pg.db, tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.action, 'workload.capacity')));
        expect(audit.length).toBeGreaterThanOrEqual(2);
        // Otra empresa no ve a nadie de ésta.
        await expect(wl.setCapacity(otherTenant, { userId: beto.userId, role: 'admin' }, beto.userId, null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tiempo registrado: de quien lo cargó, por día de trabajo, con los terminados por defecto', async () => {
        const entry = (userId: number, recordId: number, workDate: string, seconds: number) => ({
            tenantId,
            listId: 0,
            recordId,
            userId,
            source: 'manual',
            workDate,
            seconds,
        });
        const [list] = await withTenant(pg.db, tenantId, (tx) => tx.select({ id: lists.id }).from(lists).where(eq(lists.tenantId, tenantId)));
        const listId = list!.id;
        await withTenant(pg.db, tenantId, (tx) =>
            tx.insert(timeEntries).values(
                [
                    entry(ana.userId, ids.Diseño!, '2026-10-26', 3600),
                    entry(ana.userId, ids.Diseño!, '2026-10-27', 7200),
                    entry(ana.userId, ids.Cerrado!, '2026-10-28', 1800),
                    // Beto registra tiempo en un registro asignado a Ana: la fila es la suya.
                    entry(beto.userId, ids.Diseño!, '2026-11-03', 5400),
                    // Fuera del rango, un cronómetro en curso (0 s) y uno en la papelera.
                    entry(ana.userId, ids.Diseño!, '2026-10-20', 9999),
                    entry(ana.userId, ids.Diseño!, '2026-10-29', 0),
                    entry(ana.userId, ids.Borrado!, '2026-10-29', 3600),
                ].map((e) => ({ ...e, listId })),
            ),
        );
        const b = await bundle(admin, { metric: 'time', zoom: 'week', hideDone: false });
        expect(cell(b, ana.userId, '2026-10-26')).toBeCloseTo(210);
        expect(cell(b, beto.userId, '2026-11-02')).toBeCloseTo(90);
        expect(b.totals[String(ana.userId)]!.value).toBeCloseTo(210);
        expect(b.items.filter((i) => i.person === String(ana.userId)).map((i) => i.title).sort()).toEqual(['Cerrado', 'Diseño']);
        expect(b.unscheduled).toEqual({});
        // Ocultar terminados: el tiempo del registro cerrado sale.
        const open = await bundle(admin, { metric: 'time', zoom: 'week', hideDone: true });
        expect(cell(open, ana.userId, '2026-10-26')).toBeCloseTo(180);
    });

    it('el ACL de la lista: alcance de lectura, edición y campos ocultos', async () => {
        // Ana (agente) ve sólo lo que creó.
        const own = await bundle(ana);
        expect(own.items.map((i) => i.title)).toEqual(['Llamadas']);
        expect(own.items[0]!.editable).toBe(true);
        expect(cell(own, ana.userId, '2026-10-28')).toBeCloseTo(600);
        // Carla (lectora) ve todo y no edita nada.
        const viewer = await bundle(carla);
        expect(viewer.items.length).toBeGreaterThan(3);
        expect(viewer.items.every((i) => !i.editable)).toBe(true);
        // El campo Persona oculto para el rol: no hay carga posible.
        await lists_.updatePermissions(tenantId, 'tareas', {
            permissions: {
                agent: { view: 'own', create: true, edit: 'own', delete: 'none', fields_hidden: ['responsable'] },
                viewer: { view: 'all', create: false, edit: 'none', delete: 'none', fields_hidden: ['estado', 'horas'] },
            },
        });
        await expect(bundle(ana)).rejects.toBeInstanceOf(BadRequestException);
        // La estimación oculta tampoco se suma; con el estado oculto no se ocultan terminados.
        await expect(bundle(carla)).rejects.toBeInstanceOf(BadRequestException);
        const noStatus = await bundle(carla, { metric: 'count', estimateFieldId: null });
        expect(noStatus.meta).toMatchObject({ hide_done: false, done_reason: 'hidden' });
        expect(noStatus.items.map((i) => i.title)).toContain('Cerrado');
    });

    it('validación: campos de otro tipo, sin fechas y rango demasiado largo', async () => {
        await expect(bundle(admin, { personFieldId: f.titulo! })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { estimateFieldId: f.titulo! })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { metric: 'count', startFieldId: null, endFieldId: null })).rejects.toBeInstanceOf(BadRequestException);
        await expect(bundle(admin, { from: '2026-01-01', to: '2027-06-01' })).rejects.toBeInstanceOf(BadRequestException);
        // La Duración ya está en minutos.
        const dur = await bundle(admin, { estimateFieldId: f.minutos!, estimateUnit: 'hours' });
        expect(dur.meta.estimate_unit_minutes).toBe(1);
        expect(cell(dur, ana.userId, '2026-10-28')).toBeCloseTo(90);
        // El tiempo no necesita fechas.
        const time = await bundle(admin, { metric: 'time', startFieldId: null, endFieldId: null });
        expect(time.meta.metric).toBe('time');
    });

    it('parámetros del bundle', () => {
        const q = parseBundleQuery({ from: '2026-10-26', to: '2026-11-08', person_field_id: '5', metric: 'time', users: '3, 4,3', unassigned: '0' });
        expect(q).toMatchObject({ metric: 'time', zoom: 'week', hideDone: false, userIds: [3, 4], showUnassigned: false, startFieldId: null });
        expect(parseBundleQuery({ from: '2026-10-26', to: '2026-11-08', person_field_id: '5' }).hideDone).toBe(true);
        expect(() => parseBundleQuery({ from: '2026-10-26', to: '2026-11-08', person_field_id: '5', zoom: 'quarter' })).toThrow(BadRequestException);
        expect(() => parseBundleQuery({ from: '2026-10-26', to: '2026-11-08', person_field_id: 'x' })).toThrow(BadRequestException);
        expect(() => parseBundleQuery({ from: '2026-10-26', to: '2026-11-08', person_field_id: '5', users: 'a,b' })).toThrow(BadRequestException);
    });
});
