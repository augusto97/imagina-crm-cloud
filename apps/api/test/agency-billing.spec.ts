import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { addDaysYmd, DEFAULT_AGENCY_BILLING, readAgencyBilling, zonedToday, type AgencyBillingSettings } from '@imagina-base/shared';
import { agencyReminderEmail, agencyReminderKindFor, AgencyBillingRemindersService } from '../src/agency/agency-billing-reminders.service';
import { AgencyBillingService } from '../src/agency/agency-billing.service';
import { AgencyService } from '../src/agency/agency.service';
import { AuditService } from '../src/audit/audit.service';
import { AuthService } from '../src/auth/auth.service';
import { SessionService } from '../src/auth/session.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { loadEnv } from '../src/config/env';
import { agencyPayments, auditLog, memberships, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import { MailService } from '../src/mail/mail.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { MembersRepository } from '../src/members/members.repository';
import { MembersService } from '../src/members/members.service';
import { PlatformService } from '../src/platform/platform.service';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const DAY = 24 * 60 * 60 * 1000;
const TZ = 'America/Bogota';

/**
 * v0.1.451 (I3, ADR-S108) — La agencia le cobra a sus clientes: sus planes,
 * el «pagado hasta» de cada cliente, los pagos registrados a mano (con
 * deshacer), la solo lectura cuando pasa la gracia y los avisos por correo.
 */
describe('Cobro de la agencia a sus clientes (Postgres real)', () => {
    let pg: TestPg;
    let redisBox: TestRedis;
    let redis: Redis;
    let auth: AuthService;
    let agencySvc: AgencyService;
    let billingSvc: AgencyBillingService;
    let platform: PlatformService;
    let guard: TenantGuard;
    let reminders: AgencyBillingRemindersService;
    const sent: MailMessage[] = [];
    let counter = 0;

    beforeAll(async () => {
        [pg, redisBox] = await Promise.all([startPostgres(), startRedis()]);
        redis = new Redis(redisBox.url);
        const env = loadEnv({ REDIS_URL: redisBox.url, DATABASE_URL: pg.container.getConnectionUri(), PLATFORM_SUPERADMINS: 'root@plataforma.test' });
        const tenantDb = new TenantDb(pg.db);
        const mail = new MailService(env, {
            name: 'test',
            send: async (m) => {
                sent.push(m);
            },
        });
        auth = new AuthService(pg.db, redis, env, mail, new SessionService(redis, env));
        const plans = new PlansService(pg.db);
        const emailQuota = new EmailQuotaService(pg.db, plans);
        const tenantSmtp = new TenantSmtpService(pg.db, env);
        const billing = new BillingService(tenantDb, plans, emailQuota, tenantSmtp);
        const audit = new AuditService(tenantDb);
        const members = new MembersService(tenantDb, new MembersRepository(), auth, billing, undefined, undefined, undefined, pg.db);
        billingSvc = new AgencyBillingService(pg.db, plans, audit);
        agencySvc = new AgencyService(pg.db, auth, plans, billingSvc, audit);
        platform = new PlatformService(pg.db, env, billing, auth, plans, emailQuota, tenantSmtp, undefined, undefined, undefined, members, audit);
        guard = new TenantGuard(tenantDb, new Reflector(), audit, redis);
        reminders = new AgencyBillingRemindersService(pg.db, redis, env, mail);
    });

    afterAll(async () => {
        await redis?.quit();
        await Promise.all([pg?.stop(), redisBox?.stop()]);
    });

    beforeEach(() => {
        counter += 1;
        sent.length = 0;
    });

    async function makeUser(name: string): Promise<{ id: number; email: string }> {
        const email = `${name}-${counter}-${Math.random().toString(36).slice(2, 7)}@cobro.test`;
        const [u] = await pg.db.insert(users).values({ email, passwordHash: 'x', name, emailVerifiedAt: new Date() }).returning();
        return { id: u!.id, email };
    }

    async function makeTenant(input: Partial<typeof tenants.$inferInsert> & { name: string }): Promise<number> {
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `${input.name.toLowerCase().replace(/\W+/g, '-')}-${counter}-${Math.random().toString(36).slice(2, 6)}`, plan: 'pro', status: 'active', ...input })
            .returning();
        return t!.id;
    }

    async function addMember(tenantId: number, userId: number, role: 'admin' | 'manager', viaAgency = false): Promise<void> {
        await withTenant(pg.db, tenantId, (tx) => tx.insert(memberships).values({ tenantId, userId, role, viaAgency }));
    }

    async function asUser(userId: number, tenantId: number, method = 'GET'): Promise<FastifyRequest> {
        const req = { url: '/api/v1/lists', method, headers: { 'x-tenant-id': String(tenantId) }, cookies: {}, authUserId: userId } as unknown as FastifyRequest;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => () => undefined,
            getClass: () => class {},
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req;
    }

    const PLANS: AgencyBillingSettings = {
        ...DEFAULT_AGENCY_BILLING,
        plans: [
            { id: 'basico', name: 'Básico', description: null, price: 150000, currency: 'COP', period_months: 1, limits_plan: 'starter', active: true },
            { id: 'anual', name: 'Anual', description: 'Con descuento', price: 1500000, currency: 'COP', period_months: 12, limits_plan: null, active: true },
            { id: 'viejo', name: 'Viejo', description: null, price: 90000, currency: 'COP', period_months: 1, limits_plan: null, active: false },
        ],
        grace_days: 5,
        remind_days: 3,
    };

    /** Agencia con su admin, sus planes y un cliente con su admin propio. */
    async function setup(): Promise<{ agency: number; admin: { id: number; email: string }; client: number; clientAdmin: { id: number; email: string } }> {
        const agency = await makeTenant({ name: 'Agencia Cobro', isAgency: true, settings: { agency: { client_plan: 'pro', client_plans: ['starter'] } } });
        const admin = await makeUser('ana');
        await addMember(agency, admin.id, 'admin');
        await billingSvc.updateSettings(agency, admin.id, PLANS);
        const client = await makeTenant({ name: 'Floristería Rosa', agencyId: agency });
        const clientAdmin = await makeUser('rosa');
        await addMember(client, clientAdmin.id, 'admin');
        return { agency, admin, client, clientAdmin };
    }

    it('planes de la agencia: límites permitidos, asignar un plan (pagado un período) y los totales', async () => {
        const { agency, admin, client } = await setup();
        // Un plan con límites que la plataforma no le da → rechazado.
        await expect(
            billingSvc.updateSettings(agency, admin.id, { ...PLANS, plans: [{ ...PLANS.plans[0]!, limits_plan: 'enterprise' }] }),
        ).rejects.toMatchObject({ response: { code: 'agency_limits_plan' } });
        const [ag] = await pg.db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, agency));
        expect(readAgencyBilling((ag!.settings as Record<string, unknown>).agency_billing).plans).toHaveLength(3);

        // Sin plan: «Sin plan» y la empresa sigue activa.
        let [c] = await agencySvc.listClients(agency, admin.id, client);
        expect(c!.billing).toMatchObject({ plan: null, state: 'none' });

        // Un plan apagado no se asigna; uno que no existe tampoco.
        await expect(billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'viejo' })).rejects.toMatchObject({ response: { code: 'agency_plan_inactive' } });
        await expect(billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'nada' })).rejects.toMatchObject({ response: { code: 'agency_plan_not_found' } });

        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico', price: 120000 });
        c = (await agencySvc.listClients(agency, admin.id, client))[0];
        expect(c!.billing.plan).toMatchObject({ plan_id: 'basico', name: 'Básico', price: 120000, currency: 'COP', period_months: 1 });
        expect(c!.billing.state).toBe('ok');
        // Pagado hasta el fin del día, un mes adelante.
        const paid = new Date(c!.billing.paid_until!);
        expect(paid.getTime() - Date.now()).toBeGreaterThan(27 * DAY);
        expect(paid.getTime() - Date.now()).toBeLessThan(32 * DAY);
        // Los límites del plan de la agencia: la empresa pasa a «starter».
        const [row] = await pg.db.select({ plan: tenants.plan }).from(tenants).where(eq(tenants.id, client));
        expect(row!.plan).toBe('starter');
        expect(await pg.db.select().from(auditLog).where(and(eq(auditLog.tenantId, client), eq(auditLog.action, 'agency.client_billing')))).toHaveLength(1);

        const overview = await agencySvc.overview(agency);
        expect(overview.totals).toMatchObject({ ok: 1, none: 0, monthly: [{ currency: 'COP', amount: 120000 }] });
        expect(overview.limit_plans.map((p) => p.slug)).toEqual(['pro', 'starter']);
    });

    it('vencido: en gracia sigue activo; pasada la gracia queda en solo lectura («agency_unpaid») y un pago lo reactiva', async () => {
        const { agency, admin, client, clientAdmin } = await setup();
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico' });
        const today = zonedToday(TZ);

        // Venció hace 2 días: en gracia, todavía edita.
        await billingSvc.setClientBilling(agency, admin.id, client, { paid_until: addDaysYmd(today, -2) });
        let req = await asUser(clientAdmin.id, client, 'POST');
        expect(req.tenant!.access).toMatchObject({ state: 'full' });
        expect((await agencySvc.listClients(agency, admin.id, client))[0]!.billing.state).toBe('grace');

        // Venció hace 10 días (gracia de 5): solo lectura, no escribe.
        await billingSvc.setClientBilling(agency, admin.id, client, { paid_until: addDaysYmd(today, -10) });
        await expect(asUser(clientAdmin.id, client, 'POST')).rejects.toMatchObject({ response: { code: 'workspace_read_only' } });
        req = await asUser(clientAdmin.id, client, 'GET');
        expect(req.tenant!.access).toMatchObject({ state: 'read_only', reason: 'agency_unpaid' });
        expect((await agencySvc.overview(agency)).totals).toMatchObject({ unpaid: 1, monthly: [] });

        // Pago de 3 meses: cuenta desde hoy (venció), vuelve a editar.
        const pay = await billingSvc.registerPayment(agency, admin.id, client, { months: 3, method: 'transfer', note: 'Comprobante 123' });
        expect(pay).toMatchObject({ amount: 450000, currency: 'COP', months: 3, method: 'transfer', note: 'Comprobante 123', can_undo: true, undone_at: null });
        expect(new Date(pay.period_to).getTime() - Date.now()).toBeGreaterThan(85 * DAY);
        req = await asUser(clientAdmin.id, client, 'POST');
        expect(req.tenant!.access).toMatchObject({ state: 'full' });

        // Otro pago encadena desde el «pagado hasta» (no desde hoy).
        const pay2 = await billingSvc.registerPayment(agency, admin.id, client, { months: 1, amount: 150000, method: 'cash' });
        expect(new Date(pay2.period_from).getTime()).toBe(new Date(pay.period_to).getTime());

        // Deshacer: sólo el último; vuelve el de antes.
        await expect(billingSvc.undoPayment(agency, admin.id, client, pay.id)).rejects.toMatchObject({ response: { code: 'agency_payment_not_last' } });
        await billingSvc.undoPayment(agency, admin.id, client, pay2.id);
        const after = (await agencySvc.listClients(agency, admin.id, client))[0]!;
        expect(after.billing.paid_until).toBe(pay.period_to);
        const list = await billingSvc.listPayments(agency, client);
        expect(list.map((p) => [p.id, p.undone_at !== null, p.can_undo])).toEqual([
            [pay2.id, true, false],
            [pay.id, false, true],
        ]);
        expect(list[1]!.created_by_name).toBe('ana');

        // Una fecha de pago futura no.
        await expect(
            billingSvc.registerPayment(agency, admin.id, client, { months: 1, method: 'transfer', paid_on: addDaysYmd(today, 2) }),
        ).rejects.toMatchObject({ response: { code: 'agency_payment_future' } });
        expect(await pg.db.select().from(auditLog).where(and(eq(auditLog.tenantId, client), eq(auditLog.action, 'agency.payment')))).toHaveLength(2);

        // Lo que ve el cliente: su plan, su pago y nada de quién lo registró.
        const mine = await billingSvc.mine(client);
        expect(mine).toMatchObject({ agency: { name: 'Agencia Cobro' }, billing: { plan: { name: 'Básico' }, state: 'ok' } });
        expect(mine!.payments.find((p) => p.id === pay.id)?.created_by_name).toBeNull();
    });

    it('sólo los clientes de la agencia: otra agencia no ve ni cobra; cambiar de agencia borra el plan y el «pagado hasta»', async () => {
        const { agency, admin, client } = await setup();
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico' });
        await billingSvc.registerPayment(agency, admin.id, client, { months: 1, method: 'transfer' });

        const other = await makeTenant({ name: 'Agencia Otra', isAgency: true });
        const intruder = await makeUser('intruso');
        await addMember(other, intruder.id, 'admin');
        await expect(billingSvc.registerPayment(other, intruder.id, client, { months: 1, method: 'transfer' })).rejects.toMatchObject({
            response: { code: 'agency_client_not_found' },
        });
        await expect(billingSvc.listPayments(other, client)).rejects.toMatchObject({ response: { code: 'agency_client_not_found' } });

        await platform.updateTenant(client, { agency_id: other });
        const [row] = await pg.db.select({ paid: tenants.agencyPaidUntil, settings: tenants.settings }).from(tenants).where(eq(tenants.id, client));
        expect(row!.paid).toBeNull();
        expect((row!.settings as Record<string, unknown>).agency_plan).toBeUndefined();
        // Los pagos registrados quedan (son historia de la otra agencia), pero no los ve la nueva.
        expect(await pg.db.select().from(agencyPayments).where(eq(agencyPayments.clientId, client))).toHaveLength(1);
        expect(await billingSvc.listPayments(other, client)).toEqual([]);

        // Borrar la empresa se lleva sus pagos.
        await platform.updateTenant(client, { agency_id: null });
        await platform.deleteTenant(client);
        expect(await pg.db.select().from(agencyPayments).where(eq(agencyPayments.clientId, client))).toHaveLength(0);
    });

    it('avisos: por vencer al cliente, vencido y en solo lectura a los dos, una vez por fecha', async () => {
        const settings = { ...PLANS, notify_client: true };
        const now = new Date('2026-08-10T15:00:00Z');
        const at = (d: number) => new Date(now.getTime() + d * DAY);
        expect(agencyReminderKindFor(settings, at(10), now)).toBeNull();
        expect(agencyReminderKindFor(settings, at(2), now)?.kind).toBe('soon');
        expect(agencyReminderKindFor(settings, at(-1), now)?.kind).toBe('due');
        expect(agencyReminderKindFor(settings, at(-8), now)?.kind).toBe('cut');
        expect(agencyReminderKindFor(settings, at(-40), now)).toBeNull();

        const mail = agencyReminderEmail('cut', {
            audience: 'client',
            clientName: 'Floristería <Rosa>',
            agencyName: 'Agencia',
            planText: 'Básico, cada mes',
            dueAt: at(-8),
            cutAt: at(-3),
            timeZone: TZ,
            link: 'https://app.test/#/settings?s=suscripcion',
        });
        expect(mail.subject).toContain('solo lectura');
        expect(mail.html).toContain('Floristería &lt;Rosa&gt;');
        expect(mail.html).not.toContain('<Rosa>');

        const { agency, admin, client, clientAdmin } = await setup();
        await billingSvc.setClientBilling(agency, admin.id, client, { plan_id: 'basico' });
        // Por vencer en 2 días → sólo al cliente.
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() + 2 * DAY) }).where(eq(tenants.id, client));
        await reminders.tick();
        expect(sent.map((m) => m.to)).toEqual([clientAdmin.email]);
        await reminders.tick();
        expect(sent).toHaveLength(1);

        // Venció ayer → a la agencia y al cliente.
        sent.length = 0;
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() - DAY) }).where(eq(tenants.id, client));
        await reminders.tick();
        expect(sent.map((m) => m.to).sort()).toEqual([admin.email, clientAdmin.email].sort());
        expect(sent.find((m) => m.to === admin.email)!.subject).toContain('Venció el pago de «Floristería Rosa»');

        // Sin avisos al cliente: sólo a la agencia.
        sent.length = 0;
        await billingSvc.updateSettings(agency, admin.id, { ...PLANS, notify_client: false });
        await pg.db.update(tenants).set({ agencyPaidUntil: new Date(Date.now() - 7 * DAY) }).where(eq(tenants.id, client));
        await reminders.tick();
        expect(sent.map((m) => m.to)).toEqual([admin.email]);
    });
});
