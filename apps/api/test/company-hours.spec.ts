import type { CreateFieldInput, Field } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, automationRuns, automations, fields, lists, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { AutomationEngine } from '../src/automations/automation-engine.service';
import { AutomationsRepository } from '../src/automations/automations.repository';
import { AutomationsService, type HookCaptureStore } from '../src/automations/automations.service';
import { AutomationScheduler } from '../src/automations/automation-scheduler.service';
import { AutomationWaitsService } from '../src/automations/automation-waits.service';
import { CompanyHoursController } from '../src/company-hours/company-hours.controller';
import { CompanyHoursService } from '../src/company-hours/company-hours.service';
import { loadEnv } from '../src/config/env';
import { ConnectorsService } from '../src/connectors/connectors.service';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage, MailTransport } from '../src/mail/mail.types';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';
import { memoryIntegrationApps, memoryOAuthStore } from './helpers/oauth-store';

class NoMail implements MailTransport {
    readonly name = 'none';
    send(_m: MailMessage): Promise<void> {
        return Promise.resolve();
    }
}

class NoHooks implements HookCaptureStore {
    lpush(): Promise<number> {
        return Promise.resolve(0);
    }
    ltrim(): Promise<unknown> {
        return Promise.resolve('OK');
    }
    expire(): Promise<unknown> {
        return Promise.resolve(1);
    }
    lrange(): Promise<string[]> {
        return Promise.resolve([]);
    }
}

const rt = new RealtimeService();

/** Los días y horas de la empresa (Bogotá, UTC-5): 8:00 Bogotá = 13:00Z. */
const AT = {
    /** Sábado 28-nov-2026 10:00 Bogotá. */
    saturday: new Date('2026-11-28T15:00:00Z'),
    /** Lunes 30-nov-2026 8:00 Bogotá (abre). */
    mondayOpen: new Date('2026-11-30T13:00:00Z'),
    /** Martes 24-nov-2026 10:00 Bogotá (abierto). */
    tuesday: new Date('2026-11-24T15:00:00Z'),
    /** Lunes 7-dic-2026 18:00 Bogotá (cerró; el martes 8 es festivo). */
    beforeHoliday: new Date('2026-12-07T23:00:00Z'),
};

/**
 * v0.1.467 (E8) — Horario laboral de la empresa y las esperas «hasta un día
 * laborable» / «hasta el horario laboral»: pausan y siguen con el reloj, siguen
 * en el acto si ya es momento, saltan festivos y se recalculan si la empresa
 * cambia su horario.
 */
describe('Horario laboral de la empresa y esperas business_*', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let listsService: ListsService;
    let fieldsService: FieldsService;
    let recs: RecordsService;
    let autos: AutomationsService;
    let engine: AutomationEngine;
    let waits: AutomationWaitsService;
    let hours: CompanyHoursService;
    let tenantId: number;
    let anaId: number;
    let admin: Actor;
    let cf: Record<string, Field>;

    beforeAll(async () => {
        pg = await startPostgres();
        tenantDb = new TenantDb(pg.db);
        listsService = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsService = new FieldsService(tenantDb, new FieldsRepository(), listsService, rt);
        const dispatcher = new AutomationDispatcher();
        dispatcher.setQueue({ add: () => Promise.resolve() } as never);
        recs = new RecordsService(
            tenantDb,
            new RecordsRepository(),
            listsService,
            fieldsService,
            rt,
            new ActivityService(tenantDb, new ActivityRepository(), listsService),
            dispatcher,
            new RelationsRepository(),
        );
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea' });
        const connectors = new ConnectorsService(tenantDb, pg.db, env, memoryOAuthStore(), new AuditService(tenantDb), memoryIntegrationApps());
        const tz = new TenantTimeZones(tenantDb);
        // Sin el servicio de festivos: Colombia con las reglas de la app.
        hours = new CompanyHoursService(tenantDb, tz, new AuditService(tenantDb));
        hours.onModuleInit();
        engine = new AutomationEngine(
            tenantDb,
            new AutomationsRepository(),
            new FieldsRepository(),
            new RecordsRepository(),
            new RelationsRepository(),
            new MailService(loadEnv(), new NoMail()),
            connectors,
            undefined,
            dispatcher,
            undefined,
            undefined,
            tz,
            undefined,
            undefined,
            { get: () => recs } as never,
            undefined,
            undefined,
            hours,
        );
        autos = new AutomationsService(
            pg.db,
            tenantDb,
            new AutomationsRepository(),
            listsService,
            new AutomationScheduler(),
            new NoHooks(),
            connectors,
            tz,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            engine,
        );
        // Sin cola: las reanudaciones corren en el acto.
        waits = new AutomationWaitsService(pg.db, tenantDb, engine, new AutomationDispatcher(), undefined, tz, undefined, undefined, hours);
        waits.onModuleInit();

        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: 'acme', name: 'ACME', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota', number_format: 'dot_comma', date_format: 'dmy', time_format: 'h24' } } })
            .returning();
        tenantId = t!.id;
        const [u] = await pg.db.insert(users).values({ email: 'ana@acme.test', passwordHash: 'x', name: 'Ana Pérez' }).returning();
        anaId = u!.id;
        admin = { userId: anaId, role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: anaId, role: 'admin' }));
    });

    afterAll(async () => {
        await pg?.stop();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    beforeEach(async () => {
        vi.useRealTimers();
        await withTenant(pg.db, tenantId, async (tx) => {
            await tx.delete(automationRuns).where(eq(automationRuns.tenantId, tenantId));
            await tx.delete(automations).where(eq(automations.tenantId, tenantId));
            await tx.delete(records).where(eq(records.tenantId, tenantId));
            await tx.delete(fields).where(eq(fields.tenantId, tenantId));
            await tx.delete(lists).where(eq(lists.tenantId, tenantId));
        });
        // Vuelve al horario de fábrica (sin guardar nada en la empresa).
        // jsonb: quita la clave sin tocar el formato regional.
        await pg.db.execute(sql`update tenants set settings = settings - 'business_hours' where id = ${tenantId}`);
        hours.invalidate(tenantId);
        await listsService.create(tenantId, { name: 'Tickets', slug: 'tickets' });
        cf = {};
        for (const d of [
            { label: 'Asunto', type: 'text', slug: 'asunto' },
            { label: 'Nota', type: 'text', slug: 'nota' },
            {
                label: 'Estado',
                type: 'select',
                slug: 'estado',
                config: { options: [{ value: 'abierto', label: 'Abierto' }, { value: 'cerrado', label: 'Cerrado' }] },
            },
        ] as CreateFieldInput[]) {
            cf[d.slug!] = await fieldsService.create(tenantId, 'tickets', d);
        }
    });

    const ck = (slug: string) => `f${cf[slug]!.id}`;
    const runsOf = (automationId: number) =>
        withTenant(pg.db, tenantId, (tx) => tx.select().from(automationRuns).where(eq(automationRuns.automationId, automationId)));
    const event = async (recordId: number, after: Record<string, unknown>): Promise<TriggerEvent> => ({
        tenantId,
        listId: (await listsService.get(tenantId, 'tickets')).id,
        recordId,
        trigger: 'record_created',
        after,
    });
    /** Sólo el reloj de JavaScript (Postgres y los timers siguen reales). */
    const clockAt = (d: Date) => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(d);
    };
    const waitAuto = (wait: Record<string, unknown>) =>
        autos.create(tenantId, 'tickets', {
            name: 'Responder en horario',
            trigger_type: 'record_created',
            actions: [
                { type: 'update_field', config: { values: { nota: 'recibido' } } },
                { type: 'wait', config: wait },
                { type: 'update_field', config: { values: { nota: 'respondido en horario' } } },
            ],
        });
    const nota = async (id: number) => (await recs.get(tenantId, admin, 'tickets', id)).data[ck('nota')];

    it('el horario de fábrica (lun a vie 8-17, festivos del país de la zona) y guardarlo: valida, deja bitácora y sólo el admin', async () => {
        const first = await hours.get(tenantId);
        expect(first.configured).toBe(false);
        expect(first.timezone).toBe('America/Bogota');
        expect(first.hours.holiday_country).toBe('CO');
        expect(first.hours.week[1]).toEqual([{ start: '08:00', end: '17:00' }]);
        expect(first.hours.week[0]).toEqual([]);
        expect(first.hours.week[6]).toEqual([]);

        const week = [[], [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }], [{ start: '08:00', end: '18:00' }], [{ start: '08:00', end: '18:00' }], [{ start: '08:00', end: '18:00' }], [{ start: '08:00', end: '18:00' }], [{ start: '08:00', end: '12:00' }]];
        const saved = await hours.update(tenantId, { week, holiday_country: 'CO', regional_holidays: false }, anaId);
        expect(saved.configured).toBe(true);
        expect(saved.hours.week[6]).toEqual([{ start: '08:00', end: '12:00' }]);
        const audit = await withTenant(pg.db, tenantId, (tx) =>
            tx.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, 'workspace.business_hours_change'))),
        );
        expect(audit).toHaveLength(1);
        expect(audit[0]!.targetLabel).toContain('8:00–12:00 y 14:00–18:00');

        // El controller: un gerente lee pero no cambia.
        const ctrl = new CompanyHoursController(hours);
        const manager = { tenant: { tenantId, role: 'manager' }, authUserId: anaId } as never;
        expect((await ctrl.get(manager)).configured).toBe(true);
        expect(() => ctrl.update(manager, { week, holiday_country: 'CO', regional_holidays: false })).toThrow(/admin/);

        // Festivos del año con si cierran; un país que no existe, 400.
        const hol = await hours.holidaysOf('CO', 2026, false);
        expect(hol.holidays.some((h) => h.date === '2026-12-08' && h.closed)).toBe(true);
        await expect(hours.holidaysOf('XX', 2026, false)).rejects.toThrow(/festivos de ese país/);
    });

    it('«hasta el horario laboral» un sábado: espera al lunes a la apertura y el reloj la reanuda; antes de abrir no la toma', async () => {
        clockAt(AT.saturday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Ayuda' } });
        const auto = await waitAuto({ mode: 'business_hours' });
        await engine.process(await event(t.id, t.data));
        let [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect(run!.resumeAt!.toISOString()).toBe(AT.mondayOpen.toISOString());
        expect(run!.actionsLog.at(-1)!.message).toMatch(/En espera hasta .*cuando vuelve el horario laboral/);
        expect(await nota(t.id)).toBe('recibido');

        // Domingo: todavía no.
        clockAt(new Date('2026-11-29T15:00:00Z'));
        expect(await waits.tick()).toBe(0);

        // Lunes 8:00:30 Bogotá: abre y sigue.
        clockAt(new Date(AT.mondayOpen.getTime() + 30_000));
        expect(await waits.tick()).toBe(1);
        [run] = await runsOf(auto.id);
        expect(run!.status).toBe('success');
        expect(await nota(t.id)).toBe('respondido en horario');
    });

    it('«hasta un día laborable» con hora: el sábado espera al lunes a las 9:30; un martes en horario sigue en el acto', async () => {
        clockAt(AT.saturday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Fin de semana' } });
        const auto = await waitAuto({ mode: 'business_day', at_time: '09:30' });
        await engine.process(await event(t.id, t.data));
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect(run!.resumeAt!.toISOString()).toBe('2026-11-30T14:30:00.000Z');
        expect(run!.actionsLog.at(-1)!.message).toMatch(/el próximo día laborable/);

        // Un martes a las 10:00 (día laborable y en horario): ni pausa.
        clockAt(AT.tuesday);
        const t2 = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Martes' } });
        const auto2 = await waitAuto({ mode: 'business_hours' });
        await engine.process(await event(t2.id, t2.data));
        const [run2] = await runsOf(auto2.id);
        expect(run2!.status).toBe('success');
        expect(run2!.resumeAt).toBeNull();
        expect(run2!.actionsLog.find((l) => l.action === 'wait')!.message).toMatch(/Es horario laboral: siguió sin esperar/);
        expect(await nota(t2.id)).toBe('respondido en horario');
    });

    it('sigue en el acto pero «Continuar sólo si…» igual decide (antes se salteaba)', async () => {
        clockAt(AT.tuesday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Ya cerrado', [ck('estado')]: 'cerrado' } });
        const auto = await waitAuto({ mode: 'business_day', resume_condition: [{ field: 'estado', op: 'eq', value: 'abierto' }] });
        await engine.process(await event(t.id, t.data));
        const [run] = await runsOf(auto.id);
        expect(run!.actionsLog.find((l) => l.action === 'wait')!.message).toMatch(/no cumple «Continuar sólo si…»/);
        expect(await nota(t.id)).toBe('recibido');
    });

    it('salta el festivo: el lunes 7-dic a las 18:00 espera al miércoles 9 (el martes 8 es festivo en Colombia)', async () => {
        clockAt(AT.beforeHoliday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Antes del puente' } });
        const auto = await waitAuto({ mode: 'business_hours' });
        await engine.process(await event(t.id, t.data));
        const [run] = await runsOf(auto.id);
        expect(run!.resumeAt!.toISOString()).toBe('2026-12-09T13:00:00.000Z');
    });

    it('cambiar el horario recalcula las esperas en curso, y «Probar» dice hasta cuándo esperaría', async () => {
        clockAt(AT.saturday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Sábado' } });
        const auto = await waitAuto({ mode: 'business_hours' });
        await engine.process(await event(t.id, t.data));
        expect((await runsOf(auto.id))[0]!.resumeAt!.toISOString()).toBe(AT.mondayOpen.toISOString());

        const sim = await autos.testRun(tenantId, 'tickets', {
            trigger_type: 'record_created',
            trigger_config: {},
            actions: [{ type: 'wait', config: { mode: 'business_hours' } }] as never,
            record_id: t.id,
            real_steps: [],
        });
        expect(sim.steps.find((s) => s.path === '0')!.message).toMatch(/Esperaría hasta .*cuando vuelve el horario laboral/);

        // La empresa empieza a atender los sábados de 8 a 12: ya es horario.
        const week = [[], ...Array.from({ length: 5 }, () => [{ start: '08:00', end: '17:00' }]), [{ start: '08:00', end: '12:00' }]];
        await hours.update(tenantId, { week, holiday_country: 'CO', regional_holidays: false }, anaId);
        const [moved] = await runsOf(auto.id);
        expect(moved!.resumeAt!.getTime()).toBeLessThanOrEqual(Date.now());
        expect(await waits.tick()).toBe(1);
        expect((await runsOf(auto.id))[0]!.status).toBe('success');
        expect(await nota(t.id)).toBe('respondido en horario');
    });

    it('el reloj la toma antes de tiempo (o el horario cambió sin aviso): vuelve a esperar hasta la apertura', async () => {
        clockAt(AT.saturday);
        const t = await recs.create(tenantId, admin, 'tickets', { data: { [ck('asunto')]: 'Temprano' } });
        const auto = await waitAuto({ mode: 'business_hours' });
        await engine.process(await event(t.id, t.data));
        // Alguien adelantó la espera a mano: el tick la toma, pero todavía está cerrado.
        await pg.db.update(automationRuns).set({ resumeAt: new Date(AT.saturday.getTime() - 1000) }).where(eq(automationRuns.automationId, auto.id));
        expect(await waits.tick()).toBe(1);
        const [run] = await runsOf(auto.id);
        expect(run!.status).toBe('waiting');
        expect(run!.resumeAt!.toISOString()).toBe(AT.mondayOpen.toISOString());
        expect(await nota(t.id)).toBe('recibido');
    });
});
