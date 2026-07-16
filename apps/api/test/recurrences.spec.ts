import { BadRequestException } from '@nestjs/common';
import type { Field } from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AutomationDispatcher } from '../src/automations/automation-dispatcher.service';
import { fields, lists, records, recurrences, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { nextOccurrence } from '../src/recurrences/date-roller';
import { RecurrencesRepository, type RecurrenceRow } from '../src/recurrences/recurrences.repository';
import { RecurrencesService } from '../src/recurrences/recurrences.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { startPostgres, type TestPg } from './helpers/containers';

/** Realtime no-op para tests unitarios (sin servidor socket → no emite). */
const rt = new RealtimeService();

const admin: Actor = { userId: 1, role: 'admin' };

const roll = (frequency: string, intervalN: number, monthlyPattern: string | null = null) => ({
    frequency,
    intervalN,
    monthlyPattern,
});

describe('DateRoller (port puro de DateRoller.php)', () => {
    it('daily / weekly / days_after suman N días o semanas', () => {
        expect(nextOccurrence('2026-07-11', roll('daily', 1))).toBe('2026-07-12');
        expect(nextOccurrence('2026-07-11', roll('daily', 10))).toBe('2026-07-21');
        expect(nextOccurrence('2026-07-11', roll('weekly', 2))).toBe('2026-07-25');
        expect(nextOccurrence('2026-07-11', roll('days_after', 3))).toBe('2026-07-14');
        // Overflow de mes/año normalizado.
        expect(nextOccurrence('2026-12-30', roll('daily', 5))).toBe('2027-01-04');
    });

    it('monthly same_day: 31 → último día del mes target si es más corto', () => {
        expect(nextOccurrence('2026-01-31', roll('monthly', 1))).toBe('2026-02-28');
        expect(nextOccurrence('2026-01-31', roll('monthly', 1, 'same_day'))).toBe('2026-02-28');
        expect(nextOccurrence('2026-03-31', roll('monthly', 1, 'same_day'))).toBe('2026-04-30');
        // Día que sí existe en el target: se mantiene.
        expect(nextOccurrence('2026-01-14', roll('monthly', 1, 'same_day'))).toBe('2026-02-14');
        // Wrap de año.
        expect(nextOccurrence('2026-11-30', roll('monthly', 3, 'same_day'))).toBe('2027-02-28');
    });

    it('monthly first_day / last_day respetan los días reales del mes', () => {
        expect(nextOccurrence('2026-01-20', roll('monthly', 1, 'first_day'))).toBe('2026-02-01');
        expect(nextOccurrence('2026-01-15', roll('monthly', 1, 'last_day'))).toBe('2026-02-28');
        expect(nextOccurrence('2024-01-15', roll('monthly', 1, 'last_day'))).toBe('2024-02-29'); // bisiesto
        expect(nextOccurrence('2026-03-31', roll('monthly', 1, 'last_day'))).toBe('2026-04-30');
    });

    it("monthly weekday: N-ésimo día de la semana ('2do jueves')", () => {
        // 2026-05-14 es el 2do jueves de mayo → 2do jueves de junio = 11.
        expect(nextOccurrence('2026-05-14', roll('monthly', 1, 'weekday'))).toBe('2026-06-11');
        // 2026-05-29 es el 5to viernes de mayo; junio no tiene 5to → 4to (26).
        expect(nextOccurrence('2026-05-29', roll('monthly', 1, 'weekday'))).toBe('2026-06-26');
    });

    it('yearly: 29-feb → 28-feb cuando el target no es bisiesto', () => {
        expect(nextOccurrence('2024-02-29', roll('yearly', 1))).toBe('2025-02-28');
        expect(nextOccurrence('2024-02-29', roll('yearly', 4))).toBe('2028-02-29'); // bisiesto → intacto
        expect(nextOccurrence('2026-07-11', roll('yearly', 2))).toBe('2028-07-11');
    });

    it('preserva la hora y el formato original (espacio o T/zona); sin hora → YYYY-MM-DD', () => {
        expect(nextOccurrence('2026-01-31 09:30:00', roll('monthly', 1))).toBe('2026-02-28 09:30:00');
        expect(nextOccurrence('2026-07-11 23:15:42', roll('daily', 1))).toBe('2026-07-12 23:15:42');
        // ISO con T y Z (formato de los campos datetime de la nube).
        expect(nextOccurrence('2026-01-31T09:30:00Z', roll('monthly', 1))).toBe('2026-02-28T09:30:00Z');
        expect(nextOccurrence('2026-07-11', roll('monthly', 1))).toBe('2026-08-11');
    });
});

describe('RecurrencesService (Postgres real + RLS)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recordsService: RecordsService;
    let service: RecurrencesService;
    let repo: RecurrencesRepository;
    let tenantA: number;
    let tenantB: number;
    let f: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const activity = new ActivityService(tenantDb, new ActivityRepository(), listsService);
        repo = new RecurrencesRepository();
        service = new RecurrencesService(
            tenantDb,
            repo,
            listsService,
            fieldsService,
            new RecordsRepository(),
            activity,
            rt,
            new AutomationDispatcher(),
            pg.db,
        );
        recordsService = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            activity,
            new AutomationDispatcher(),
            new RelationsRepository(),
            service,
        );

        const [ta] = await pg.db.insert(tenants).values({ slug: 'acme', name: 'ACME' }).returning();
        const [tb] = await pg.db.insert(tenants).values({ slug: 'globex', name: 'Globex' }).returning();
        tenantA = ta!.id;
        tenantB = tb!.id;
        await pg.db.insert(users).values({ email: 'a@acme.test', passwordHash: 'x', name: 'Ana' });
    }, 120_000);

    afterAll(async () => {
        await pg?.stop();
    });

    beforeEach(async () => {
        for (const t of [tenantA, tenantB]) {
            await withTenant(pg.db, t, async (tx) => {
                await tx.delete(recurrences).where(eq(recurrences.tenantId, t));
                await tx.delete(records).where(eq(records.tenantId, t));
                await tx.delete(fields).where(eq(fields.tenantId, t));
                await tx.delete(lists).where(eq(lists.tenantId, t));
            });
        }
        await listsService.create(tenantA, { name: 'Tareas' });
        f = {};
        for (const def of [
            { label: 'Nombre', type: 'text', slug: 'nombre' } as const,
            { label: 'Vence', type: 'date', slug: 'vence' } as const,
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: {
                    options: [
                        { value: 'pendiente', label: 'Pendiente' },
                        { value: 'hecho', label: 'Hecho' },
                    ],
                },
            } as const,
        ]) {
            f[def.slug] = await fieldsService.create(tenantA, 'tareas', def);
        }
    });

    const key = (slug: string) => `f${f[slug]!.id}`;

    async function newRecord(data: Record<string, unknown>): Promise<number> {
        const rec = await recordsService.create(tenantA, admin, 'tareas', { data });
        return rec.id;
    }

    async function recRow(id: number): Promise<RecurrenceRow> {
        const row = await tenantDb.withTenant(tenantA, (tx) => repo.findById(tx, tenantA, id));
        expect(row).not.toBeNull();
        return row!;
    }

    async function dateValue(recordId: number): Promise<unknown> {
        const rec = await recordsService.get(tenantA, admin, 'tareas', recordId);
        return rec.data[key('vence')];
    }

    it('upsert valida el campo de fecha (tipo y lista) y el trigger de estado', async () => {
        const recordId = await newRecord({ [key('nombre')]: 'X', [key('vence')]: '2030-01-15' });
        // Campo que no es date/datetime → 400.
        await expect(
            service.upsert(tenantA, 'tareas', recordId, {
                date_field_id: f.nombre!.id,
                frequency: 'daily',
                interval_n: 1,
                trigger_type: 'schedule',
                action_type: 'update',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // status_change con campo de estado que no es select/checkbox → 400.
        await expect(
            service.upsert(tenantA, 'tareas', recordId, {
                date_field_id: f.vence!.id,
                frequency: 'daily',
                interval_n: 1,
                trigger_type: 'status_change',
                trigger_status_field_id: f.nombre!.id,
                trigger_status_value: 'hecho',
                action_type: 'update',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
        // status_change sin valor target → 400.
        await expect(
            service.upsert(tenantA, 'tareas', recordId, {
                date_field_id: f.vence!.id,
                frequency: 'daily',
                interval_n: 1,
                trigger_type: 'status_change',
                trigger_status_field_id: f.estado!.id,
                action_type: 'update',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('upsert reemplaza por (record, date_field) conservando el id', async () => {
        const recordId = await newRecord({ [key('nombre')]: 'X', [key('vence')]: '2030-01-15' });
        const created = await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'daily',
            interval_n: 1,
            trigger_type: 'schedule',
            action_type: 'update',
        });
        expect(created.frequency).toBe('daily');
        expect(created.monthly_pattern).toBeNull();

        const replaced = await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'monthly',
            interval_n: 2,
            trigger_type: 'schedule',
            action_type: 'clone',
        });
        expect(replaced.id).toBe(created.id); // misma fila, actualizada
        expect(replaced.frequency).toBe('monthly');
        expect(replaced.interval_n).toBe(2);
        expect(replaced.monthly_pattern).toBe('same_day'); // default con monthly
        expect(replaced.action_type).toBe('clone');

        const all = await service.listForRecord(tenantA, 'tareas', recordId);
        expect(all).toHaveLength(1);

        // El batch agrupa por record_id (prefill [] para ids sin recurrencias).
        const otherId = await newRecord({ [key('nombre')]: 'Y' });
        const batch = await service.batchByRecords(tenantA, 'tareas', [recordId, otherId]);
        expect(batch[String(recordId)]).toHaveLength(1);
        expect(batch[String(otherId)]).toEqual([]);
    });

    it('fire con action=update avanza la fecha y setea el update_status', async () => {
        const recordId = await newRecord({
            [key('nombre')]: 'Pago',
            [key('vence')]: '2030-01-31',
            [key('estado')]: 'hecho',
        });
        const dto = await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'monthly',
            interval_n: 1,
            monthly_pattern: 'same_day',
            trigger_type: 'schedule',
            action_type: 'update',
            update_status_field_id: f.estado!.id,
            update_status_value: 'pendiente',
        });

        await service.fire(await recRow(dto.id));

        const rec = await recordsService.get(tenantA, admin, 'tareas', recordId);
        expect(rec.data[key('vence')]).toBe('2030-02-28'); // 31 → último día de feb
        expect(rec.data[key('estado')]).toBe('pendiente'); // reset de estado
        const after = await recRow(dto.id);
        expect(after.lastFiredAt).not.toBeNull(); // markFired
    });

    it('fire con action=clone crea un record nuevo con la fecha rodada (original intacto)', async () => {
        const recordId = await newRecord({
            [key('nombre')]: 'Factura',
            [key('vence')]: '2030-01-15',
            [key('estado')]: 'hecho',
        });
        const dto = await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'weekly',
            interval_n: 1,
            trigger_type: 'schedule',
            action_type: 'clone',
            update_status_field_id: f.estado!.id,
            update_status_value: 'pendiente',
        });

        await service.fire(await recRow(dto.id));

        const page = await recordsService.list(tenantA, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
        });
        expect(page.data).toHaveLength(2);
        const original = page.data.find((r) => r.id === recordId)!;
        const clone = page.data.find((r) => r.id !== recordId)!;
        expect(original.data[key('vence')]).toBe('2030-01-15'); // intacto
        expect(original.data[key('estado')]).toBe('hecho');
        expect(clone.data[key('vence')]).toBe('2030-01-22'); // +1 semana
        expect(clone.data[key('nombre')]).toBe('Factura'); // data completo copiado
        expect(clone.data[key('estado')]).toBe('pendiente'); // reset en el clon

        // La recurrencia se RE-ANCLA al clon (el que tiene la fecha rodada):
        // el original queda como histórico sin recurrencia, y la serie sigue.
        const after = await recRow(dto.id);
        expect(after.recordId).toBe(clone.id);

        // Segundo disparo → la cadena sigue viva: un tercer record con la
        // fecha rodada otra semana, y la recurrencia anclada al más nuevo.
        await service.fire(after);
        const page2 = await recordsService.list(tenantA, admin, 'tareas', {
            limit: 50,
            sort_dir: 'asc',
        });
        expect(page2.data).toHaveLength(3);
        const third = page2.data.find((r) => r.id !== recordId && r.id !== clone.id)!;
        expect(third.data[key('vence')]).toBe('2030-01-29');
        expect((await recRow(dto.id)).recordId).toBe(third.id);
    });

    it('status_change vía onRecordUpdated dispara sólo en la transición al valor target', async () => {
        const recordId = await newRecord({
            [key('nombre')]: 'Tarea',
            [key('vence')]: '2030-01-15',
            [key('estado')]: 'pendiente',
        });
        await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'days_after',
            interval_n: 3,
            trigger_type: 'status_change',
            trigger_status_field_id: f.estado!.id,
            trigger_status_value: 'hecho',
            action_type: 'update',
        });
        const listId = (await listsService.get(tenantA, 'tareas')).id;
        const before = { [key('estado')]: 'pendiente', [key('vence')]: '2030-01-15' };
        const afterOther = { [key('estado')]: 'pendiente', [key('vence')]: '2030-01-15' };

        // Sin cambio del campo de estado → no dispara.
        await service.onRecordUpdated(tenantA, listId, recordId, before, afterOther);
        expect(await dateValue(recordId)).toBe('2030-01-15');

        // Transición al target → dispara: days_after usa NOW como seed (no la fecha del campo).
        await service.onRecordUpdated(tenantA, listId, recordId, before, {
            ...before,
            [key('estado')]: 'hecho',
        });
        const rolled = await dateValue(recordId);
        const expected = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
        expect(rolled).toBe(expected);

        // Transición a OTRO valor (salida del target) → no dispara.
        await service.onRecordUpdated(
            tenantA,
            listId,
            recordId,
            { ...before, [key('estado')]: 'hecho' },
            { ...before, [key('estado')]: 'pendiente' },
        );
        expect(await dateValue(recordId)).toBe(expected);
    });

    it('el update real de RecordsService dispara el hook (integración fire-and-forget)', async () => {
        const recordId = await newRecord({
            [key('nombre')]: 'Hook',
            [key('vence')]: '2030-03-10',
            [key('estado')]: 'pendiente',
        });
        await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'daily',
            interval_n: 1,
            trigger_type: 'status_change',
            trigger_status_field_id: f.estado!.id,
            trigger_status_value: 'hecho',
            action_type: 'update',
        });
        await recordsService.update(tenantA, admin, 'tareas', recordId, {
            data: { [key('estado')]: 'hecho' },
        });
        // El hook es fire-and-forget: esperar a que asiente.
        await new Promise((r) => setTimeout(r, 300));
        expect(await dateValue(recordId)).toBe('2030-03-11');
    });

    it('repeat_until corta: si la próxima fecha lo supera, no dispara', async () => {
        const recordId = await newRecord({
            [key('nombre')]: 'Fin',
            [key('vence')]: '2030-01-31',
        });
        const dto = await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'monthly',
            interval_n: 1,
            trigger_type: 'schedule',
            action_type: 'update',
            repeat_until: '2030-02-15', // próxima sería 2030-02-28 > tope
        });

        await service.fire(await recRow(dto.id));

        expect(await dateValue(recordId)).toBe('2030-01-31'); // sin cambios
        expect((await recRow(dto.id)).lastFiredAt).toBeNull(); // no marcó fired
    });

    it('RLS: la recurrencia de otro tenant no aparece', async () => {
        const recordId = await newRecord({ [key('nombre')]: 'X', [key('vence')]: '2030-01-15' });
        await service.upsert(tenantA, 'tareas', recordId, {
            date_field_id: f.vence!.id,
            frequency: 'daily',
            interval_n: 1,
            trigger_type: 'schedule',
            action_type: 'update',
        });

        // Desde el scope del tenant B la tabla se ve vacía (policy RLS).
        const fromB = await withTenant(pg.db, tenantB, (tx) => tx.select().from(recurrences));
        expect(fromB).toHaveLength(0);
        const fromA = await withTenant(pg.db, tenantA, (tx) => tx.select().from(recurrences));
        expect(fromA).toHaveLength(1);
    });
});
