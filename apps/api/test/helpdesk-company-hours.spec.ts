import type { HelpdeskSettings, HolidayItem, UpdateCompanyHoursInput } from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ActivityRepository } from '../src/activity/activity.repository';
import { ActivityService } from '../src/activity/activity.service';
import { AuditService } from '../src/audit/audit.service';
import { AutomationDispatcher, type TriggerEvent } from '../src/automations/automation-dispatcher.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import type { BookingHolidaysService } from '../src/booking/booking-holidays';
import { CompanyHoursService } from '../src/company-hours/company-hours.service';
import { loadEnv } from '../src/config/env';
import { helpdeskTickets, lists as listsTable, memberships, records, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { FieldsRepository } from '../src/fields/fields.repository';
import { FieldsService } from '../src/fields/fields.service';
import { HelpdeskConfigService } from '../src/helpdesk/helpdesk-config.service';
import { HelpdeskSlaService } from '../src/helpdesk/helpdesk-sla.service';
import { HelpdeskQueue } from '../src/helpdesk/helpdesk.queue';
import { ImapFlowReader } from '../src/helpdesk/imap-reader';
import { ListsRepository } from '../src/lists/lists.repository';
import { ListsService } from '../src/lists/lists.service';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { NotifyHub } from '../src/notifications/notify-hub';
import { RealtimeService } from '../src/realtime/realtime.service';
import { RecordChangeHub } from '../src/records/record-change-hub';
import { RecordsRepository } from '../src/records/records.repository';
import { RecordsService, type Actor } from '../src/records/records.service';
import { RelationsRepository } from '../src/records/relations.repository';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantTimeZones } from '../src/tenancy/tenant-time-zone.service';
import { startPostgres, type TestPg } from './helpers/containers';

class CapturingDispatcher extends AutomationDispatcher {
    readonly events: TriggerEvent[] = [];
    override dispatch(event: TriggerEvent): void {
        this.events.push(event);
    }
}

/** Espera a que una condición se cumpla (los oyentes de los hubs corren sueltos). */
async function eventually<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > until) throw new Error('eventually: no se cumplió a tiempo');
        await new Promise((r) => setTimeout(r, 25));
    }
}

const lunch = [
    { start: '08:00', end: '12:00' },
    { start: '13:00', end: '17:00' },
];
/** Lunes a viernes 8–12 y 13–17 (con el almuerzo), sin sábado. */
const LUNCH_WEEK: UpdateCompanyHoursInput = { week: [[], lunch, lunch, lunch, lunch, lunch, []], holiday_country: 'CO', regional_holidays: false };
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * v0.1.469 (G15) — El SLA de la mesa de ayuda con el HORARIO LABORAL de la
 * empresa: las políticas nuevas lo usan, las guardadas sin el dato siguen con
 * su horario propio, los tramos del almuerzo y los festivos del país cuentan, y
 * cambiar el horario recalcula los tickets ABIERTOS (no los cerrados).
 */
describe('SLA de la mesa de ayuda con el horario laboral de la empresa (Postgres real)', () => {
    let pg: TestPg;
    let tenantDb: TenantDb;
    let lists: ListsService;
    let fieldsSvc: FieldsService;
    let recs: RecordsService;
    let config: HelpdeskConfigService;
    let sla: HelpdeskSlaService;
    let hours: CompanyHoursService;
    let tz: TenantTimeZones;
    const dispatcher = new CapturingDispatcher();
    const delivered: Array<{ kind: string; title: string }> = [];
    const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', FILES_SIGNING_SECRET: 'hd-secret' });
    /** Festivos «oficiales» falsos: México tiene el 16-nov; Perú no se puede saber (null). */
    const fakeHolidays = {
        items: (country: string): Promise<HolidayItem[] | null> =>
            Promise.resolve(
                country === 'MX'
                    ? [{ date: '2026-11-16', name: 'Día de la Revolución', kind: 'national' }]
                    : country === 'CO'
                      ? [
                            { date: '2026-11-02', name: 'Todos los Santos', kind: 'national' },
                            { date: '2026-11-16', name: 'Independencia de Cartagena', kind: 'national' },
                        ]
                      : null,
            ),
    } as unknown as BookingHolidaysService;

    let tenantId: number;
    let mxTenant: number;
    let ana: Actor;
    let mxAdmin: Actor;

    const ticketOf = async (tid: number, recordId: number) =>
        (await withTenant(pg.db, tid, (tx) => tx.select().from(helpdeskTickets).where(and(eq(helpdeskTickets.tenantId, tid), eq(helpdeskTickets.recordId, recordId)))))[0]!;

    /** Lista de soporte con su campo de estado (abierto / cerrado). */
    const mkList = async (tid: number, actor: Actor, slug: string): Promise<{ id: number; statusKey: string; titleKey: string }> => {
        const id = (await lists.create(tid, { name: slug, slug })).id;
        const title = await fieldsSvc.create(tid, slug, { label: 'Asunto', type: 'text', slug: 'asunto' } as never);
        const status = await fieldsSvc.create(tid, slug, {
            label: 'Estado',
            type: 'select',
            slug: 'estado',
            config: { options: [{ value: 'nuevo', label: 'Nuevo' }, { value: 'resuelto', label: 'Resuelto' }] },
        } as never);
        await config.updateSettings(tid, actor.userId, slug, {
            title_field_id: title.id,
            status_field_id: status.id,
            initial_status: 'nuevo',
            closed_statuses: ['resuelto'],
        });
        return { id, statusKey: `f${status.id}`, titleKey: `f${title.id}` };
    };

    /** Un ticket que empezó en `startedAt` (abierto, o cerrado en `resolvedAt`). */
    const mkTicket = async (tid: number, actor: Actor, slug: string, titleKey: string, startedAt: string, resolvedAt: string | null = null): Promise<number> => {
        const rec = await recs.create(tid, actor, slug, { data: { [titleKey]: `Ticket ${startedAt}` } });
        await eventually(async () => (await withTenant(pg.db, tid, (tx) => tx.select().from(helpdeskTickets).where(eq(helpdeskTickets.recordId, rec.id))))[0]);
        await withTenant(pg.db, tid, (tx) =>
            tx
                .update(helpdeskTickets)
                .set({ startedAt: new Date(startedAt), resolvedAt: resolvedAt ? new Date(resolvedAt) : null, firstResponseAt: resolvedAt ? new Date(resolvedAt) : null, alerts: {}, pauses: [] })
                .where(eq(helpdeskTickets.recordId, rec.id)),
        );
        await sla.recompute(tid, rec.id);
        return rec.id;
    };

    beforeAll(async () => {
        pg = await startPostgres();
        // El «ahora» de los tests: viernes 6-nov-2026 16:30 en Bogotá.
        vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-06T21:30:00Z') });
        tenantDb = new TenantDb(pg.db);
        const rt = new RealtimeService();
        lists = new ListsService(tenantDb, new ListsRepository(), rt);
        fieldsSvc = new FieldsService(tenantDb, new FieldsRepository(), lists, rt);
        const changes = new RecordChangeHub();
        const notify = new NotifyHub();
        const plansSvc = new PlansService(pg.db);
        const billing = new BillingService(tenantDb, plansSvc, new EmailQuotaService(pg.db, plansSvc), new TenantSmtpService(pg.db, env));
        tz = new TenantTimeZones(tenantDb);
        const audit = new AuditService(tenantDb);
        const activitySvc = new ActivityService(tenantDb, new ActivityRepository(), lists);
        recs = new RecordsService(tenantDb, new RecordsRepository(), lists, fieldsSvc, rt, activitySvc, dispatcher, new RelationsRepository(), undefined, changes, billing, tz, notify);
        // Sin Redis: la cola es no-op y el recálculo por el horario corre en el acto.
        const queue = new HelpdeskQueue();
        config = new HelpdeskConfigService(tenantDb, env, lists, fieldsSvc, audit, new ImapFlowReader(), queue);
        hours = new CompanyHoursService(tenantDb, tz, audit, fakeHolidays);
        hours.onModuleInit();
        const notifications = {
            deliver: (_t: number, kind: string, _u: number[], p: { title: string }) => {
                delivered.push({ kind, title: p.title });
                return Promise.resolve();
            },
        } as unknown as NotificationsService;
        sla = new HelpdeskSlaService(tenantDb, pg.db, lists, fieldsSvc, recs, activitySvc, rt, dispatcher, notifications, changes, notify, tz, undefined, hours, queue);
        sla.onModuleInit();

        const mk = async (email: string) => (await pg.db.insert(users).values({ email, name: email, passwordHash: 'x' }).returning())[0]!.id;
        tenantId = (await pg.db.insert(tenants).values({ slug: 'acme', name: 'Acme', plan: 'enterprise', settings: { format: { timezone: 'America/Bogota' } } }).returning())[0]!.id;
        mxTenant = (await pg.db.insert(tenants).values({ slug: 'mx', name: 'MX', plan: 'enterprise', settings: { format: { timezone: 'America/Mexico_City' } } }).returning())[0]!.id;
        ana = { userId: await mk('ana@acme.test'), role: 'admin' };
        mxAdmin = { userId: await mk('admin@mx.test'), role: 'admin' };
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId: ana.userId, role: 'admin' }));
        await withTenant(pg.db, mxTenant, (tx) => tx.insert(memberships).values({ tenantId: mxTenant, userId: mxAdmin.userId, role: 'admin' }));
        await hours.update(tenantId, LUNCH_WEEK, ana.userId);
    });

    afterAll(async () => {
        vi.useRealTimers();
        await pg?.stop();
    });

    let company: { id: number; statusKey: string; titleKey: string };
    let own: { id: number; statusKey: string; titleKey: string };

    it('una política NUEVA usa el horario laboral; una guardada sin el dato sigue con su horario propio', async () => {
        company = await mkList(tenantId, ana, 'soporte');
        const created: HelpdeskSettings = await config.updateSettings(tenantId, ana.userId, 'soporte', {
            sla: { enabled: true, targets: [{ priority: null, first_response_hours: 2, resolution_hours: 4 }], notify_user_ids: [ana.userId] },
        });
        expect(created.sla.calendar.source).toBe('company');

        // Una lista que guardó su SLA ANTES de v0.1.469 (sin `source`), escrita tal cual.
        own = await mkList(tenantId, ana, 'viejo');
        const [row] = await withTenant(pg.db, tenantId, (tx) => tx.select({ settings: listsTable.settings }).from(listsTable).where(eq(listsTable.id, own.id)));
        const s = (row!.settings ?? {}) as Record<string, Record<string, unknown>>;
        const helpdesk = {
            ...s.helpdesk,
            sla: { enabled: true, targets: [{ priority: null, first_response_hours: 2, resolution_hours: 4 }], calendar: { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', holidays: 'co' } },
        };
        await withTenant(pg.db, tenantId, (tx) => tx.update(listsTable).set({ settings: { ...s, helpdesk } }).where(eq(listsTable.id, own.id)));
        expect((await config.getSettings(tenantId, 'viejo')).settings.sla.calendar).toMatchObject({ source: 'own', end: '18:00' });
        // Cambiar otra cosa de la política no le cambia el origen.
        const patched = await config.updateSettings(tenantId, ana.userId, 'viejo', { sla: { at_risk_percent: 60 } });
        expect(patched.sla.calendar).toMatchObject({ source: 'own', start: '08:00', end: '18:00' });
        // Con el horario de la empresa, el propio no se exige (aunque quede a medias).
        await expect(config.updateSettings(tenantId, ana.userId, 'soporte', { sla: { calendar: { days: [] } } })).resolves.toBeTruthy();
        await expect(config.updateSettings(tenantId, ana.userId, 'viejo', { sla: { calendar: { days: [] } } })).rejects.toMatchObject({ response: { code: 'invalid_helpdesk_settings' } });
    });

    let openCompany: number;
    let closedCompany: number;
    let openOwn: number;

    it('viernes 16:00 con 4 h y lun–vie 8–12 / 13–17: vence el lunes a las 11:00 (el propio de 8 a 18, a las 10:00)', async () => {
        // Viernes 6-nov 16:00 Bogotá = 21:00Z.
        openCompany = await mkTicket(tenantId, ana, 'soporte', company.titleKey, '2026-11-06T21:00:00Z');
        const t = await ticketOf(tenantId, openCompany);
        // Primera respuesta (2 h): viernes 16–17 (1 h) + lunes 8–9 (1 h) → 9:00 = 14:00Z.
        expect(iso(t.firstResponseDue)).toBe('2026-11-09T14:00:00.000Z');
        // Resolución (4 h): viernes 16–17 (1 h) + lunes 8–11 (3 h) → 11:00 = 16:00Z.
        expect(iso(t.resolutionDue)).toBe('2026-11-09T16:00:00.000Z');

        openOwn = await mkTicket(tenantId, ana, 'viejo', own.titleKey, '2026-11-06T21:00:00Z');
        // El propio (8 a 18): viernes 16–18 (2 h) + lunes 8–10 (2 h) → 10:00 = 15:00Z.
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe('2026-11-09T15:00:00.000Z');

        // Un ticket ya cerrado (miércoles 4-nov 9:00, resuelto 10:00): 9–12 (3 h) + 13–14 (1 h) → 14:00 = 19:00Z.
        closedCompany = await mkTicket(tenantId, ana, 'soporte', company.titleKey, '2026-11-04T14:00:00Z', '2026-11-04T15:00:00Z');
        expect(iso((await ticketOf(tenantId, closedCompany)).resolutionDue)).toBe('2026-11-04T19:00:00.000Z');
    });

    it('cambiar el horario laboral recalcula los tickets ABIERTOS que lo usan; no los cerrados ni los de horario propio', async () => {
        const before = { closed: await ticketOf(tenantId, closedCompany), own: await ticketOf(tenantId, openOwn) };
        // Lunes a viernes de 9:00 a 18:00 sin almuerzo.
        const nine = [{ start: '09:00', end: '18:00' }];
        await hours.update(tenantId, { week: [[], nine, nine, nine, nine, nine, []], holiday_country: 'CO', regional_holidays: false }, ana.userId);
        const after = await ticketOf(tenantId, openCompany);
        // Viernes 16–18 (2 h) + lunes 9–11 (2 h) → 11:00 = 16:00Z; la primera respuesta, viernes 16–18 → 18:00 = 23:00Z.
        expect(iso(after.firstResponseDue)).toBe('2026-11-06T23:00:00.000Z');
        expect(iso(after.resolutionDue)).toBe('2026-11-09T16:00:00.000Z');
        // Los cerrados y los de horario propio quedan igual.
        expect(iso((await ticketOf(tenantId, closedCompany)).resolutionDue)).toBe(iso(before.closed.resolutionDue));
        expect((await ticketOf(tenantId, closedCompany)).updatedAt?.toISOString()).toBe(before.closed.updatedAt?.toISOString());
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe(iso(before.own.resolutionDue));
        // Las columnas de la lista se escriben con el vencimiento nuevo (si existen) y nunca disparan automatizaciones.
        expect(dispatcher.events.filter((e) => e.trigger === 'record_updated' && e.recordId === openCompany)).toEqual([]);
        // Con el horario anterior otra vez.
        await hours.update(tenantId, LUNCH_WEEK, ana.userId);
        expect(iso((await ticketOf(tenantId, openCompany)).resolutionDue)).toBe('2026-11-09T16:00:00.000Z');
        expect(iso((await ticketOf(tenantId, openCompany)).firstResponseDue)).toBe('2026-11-09T14:00:00.000Z');
    });

    it('cambiar el ORIGEN de una política recalcula sus tickets con el horario elegido', async () => {
        await config.updateSettings(tenantId, ana.userId, 'viejo', { sla: { calendar: { source: 'company' } } });
        // En producción lo hace el trabajo de la cola (`sla-list`); aquí, en el acto.
        await sla.reconcileList(tenantId, own.id);
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe('2026-11-09T16:00:00.000Z');
        await config.updateSettings(tenantId, ana.userId, 'viejo', { sla: { calendar: { source: 'own' } } });
        await sla.reconcileList(tenantId, own.id);
        // Vuelve al propio de 8 a 18: lo guardado del horario propio no se perdió.
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe('2026-11-09T15:00:00.000Z');
    });

    it('cambiar la ZONA de la empresa recalcula los tickets de los dos horarios', async () => {
        const [t] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
        const settings = (t!.settings ?? {}) as Record<string, Record<string, unknown>>;
        await pg.db.update(tenants).set({ settings: { ...settings, format: { ...settings.format, timezone: 'Europe/Madrid' } } }).where(eq(tenants.id, tenantId));
        await tz.changed(tenantId);
        // Madrid (UTC+1): empezó el viernes a las 22:00, ya cerrado → todo el lunes 9-nov.
        // Propio (8 a 18): lunes 8–12 → 12:00 Madrid = 11:00Z.
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe('2026-11-09T11:00:00.000Z');
        // Empresa (8–12 / 13–17): la primera respuesta (2 h) a las 10:00 = 09:00Z; la resolución a las 12:00 = 11:00Z.
        expect(iso((await ticketOf(tenantId, openCompany)).firstResponseDue)).toBe('2026-11-09T09:00:00.000Z');
        expect(iso((await ticketOf(tenantId, openCompany)).resolutionDue)).toBe('2026-11-09T11:00:00.000Z');
        // El cerrado no se mueve.
        expect(iso((await ticketOf(tenantId, closedCompany)).resolutionDue)).toBe('2026-11-04T19:00:00.000Z');
        await pg.db.update(tenants).set({ settings }).where(eq(tenants.id, tenantId));
        await tz.changed(tenantId);
        expect(iso((await ticketOf(tenantId, openCompany)).resolutionDue)).toBe('2026-11-09T16:00:00.000Z');
        expect(iso((await ticketOf(tenantId, openOwn)).resolutionDue)).toBe('2026-11-09T15:00:00.000Z');
    });

    it('los festivos del PAÍS elegido (México, 16-nov) y, si no se pueden saber, se calcula sin ellos', async () => {
        const week = [[], lunch, lunch, lunch, lunch, lunch, []];
        await hours.update(mxTenant, { week, holiday_country: 'MX', regional_holidays: false }, mxAdmin.userId);
        const mx = await mkList(mxTenant, mxAdmin, 'soporte');
        await config.updateSettings(mxTenant, mxAdmin.userId, 'soporte', { sla: { enabled: true, targets: [{ priority: null, first_response_hours: 2, resolution_hours: 4 }] } });
        // Viernes 13-nov 16:00 CDMX (22:00Z) + 4 h: viernes 16–17 (1 h) → lunes 16 festivo → martes 8–11 (3 h) → 17:00Z.
        const rec = await mkTicket(mxTenant, mxAdmin, 'soporte', mx.titleKey, '2026-11-13T22:00:00Z');
        expect(iso((await ticketOf(mxTenant, rec)).resolutionDue)).toBe('2026-11-17T17:00:00.000Z');
        // Perú: los festivos no se pueden saber → el lunes cuenta (nunca se traba).
        await hours.update(mxTenant, { week, holiday_country: 'PE', regional_holidays: false }, mxAdmin.userId);
        expect(iso((await ticketOf(mxTenant, rec)).resolutionDue)).toBe('2026-11-16T17:00:00.000Z');
        // La otra empresa no se tocó.
        expect(iso((await ticketOf(tenantId, openCompany)).resolutionDue)).toBe('2026-11-09T16:00:00.000Z');
    });

    it('al recalcular, los avisos siguen siendo UNO por objetivo', async () => {
        // Lunes 9-nov 8:50 Bogotá: la primera respuesta (vence 9:00) está en riesgo.
        vi.setSystemTime(new Date('2026-11-09T13:50:00Z'));
        delivered.length = 0;
        await sla.recompute(tenantId, openCompany);
        expect(delivered.filter((d) => d.kind === 'sla')).toEqual([{ kind: 'sla', title: expect.stringMatching(/en riesgo/) }]);
        // Recalcular por el horario (dos veces) no repite el aviso de ese objetivo.
        await hours.update(tenantId, { ...LUNCH_WEEK }, ana.userId);
        await hours.update(tenantId, { ...LUNCH_WEEK }, ana.userId);
        expect(delivered.filter((d) => d.kind === 'sla')).toHaveLength(1);
        expect(Object.keys((await ticketOf(tenantId, openCompany)).alerts)).toEqual(['first_response:at_risk']);
        vi.setSystemTime(new Date('2026-11-06T21:30:00Z'));
        // Los registros siguen vivos.
        expect((await withTenant(pg.db, tenantId, (tx) => tx.select({ id: records.id }).from(records).where(eq(records.id, openCompany)))).length).toBe(1);
    });
});
