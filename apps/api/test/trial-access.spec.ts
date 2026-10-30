import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    DEFAULT_BILLING_POLICY,
    daysLeft,
    moduleForIntegration,
    readBillingPolicy,
    readDisabledModules,
    tenantAccess,
} from '@imagina-base/shared';
import { eq } from 'drizzle-orm';
import IORedis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/audit/audit.service';
import { BillingPolicyService } from '../src/billing/billing-policy.service';
import { BillingService } from '../src/billing/billing.service';
import { PlansService } from '../src/billing/plans.service';
import { setCurrentBillingPolicy } from '../src/billing/tenant-access';
import { loadEnv } from '../src/config/env';
import { auditLog, memberships, plans, tenants, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant-tx';
import { EmailQuotaService } from '../src/mail/email-quota.service';
import type { MailMessage } from '../src/mail/mail.types';
import { TenantSmtpService } from '../src/mail/tenant-smtp.service';
import { BillingRemindersService, billingReminderEmail, reminderKindFor, trialReminderKind } from '../src/payments/billing-reminders.service';
import { ALLOW_LOCKED } from '../src/tenancy/allow-locked.decorator';
import { PLAN_MODULE } from '../src/tenancy/plan-module.decorator';
import { tenantIsLocked, tenantIsReadOnly } from '../src/tenancy/read-only';
import { TenantDb } from '../src/tenancy/tenant-db.service';
import { TenantGuard, type TenantContext } from '../src/tenancy/tenant.guard';
import { startPostgres, startRedis, type TestPg, type TestRedis } from './helpers/containers';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-10T12:00:00Z');
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe('v0.1.338 — acceso de la empresa (puro)', () => {
    const policy = { on_end: 'lock' as const, grace_days: 5 };

    it('prueba vigente, terminada (pausada o solo lectura) y sin fecha', () => {
        expect(tenantAccess({ plan: 'trial', status: 'trialing', trial_ends_at: at(3), now }, policy)).toMatchObject({ state: 'full', trial: true, reason: null });
        expect(tenantAccess({ plan: 'trial', status: 'trialing', trial_ends_at: at(-1), now }, policy)).toMatchObject({ state: 'locked', reason: 'trial_ended' });
        expect(tenantAccess({ plan: 'trial', status: 'trialing', trial_ends_at: at(-1), now }, { ...policy, on_end: 'read_only' })).toMatchObject({
            state: 'read_only',
            reason: 'trial_ended',
        });
        // Sin fecha de fin (las de antes de esta versión): no vence.
        expect(tenantAccess({ plan: 'trial', status: 'trialing', trial_ends_at: null, now }, policy)).toMatchObject({ state: 'full', ends_at: null });
    });

    it('plan pagado: vencimiento + gracia; la fecha manual corta exacto; el período pagado no aplica a la prueba', () => {
        expect(tenantAccess({ plan: 'pro', status: 'active', paid_until: at(-4), now }, policy).state).toBe('full');
        expect(tenantAccess({ plan: 'pro', status: 'active', paid_until: at(-5), now }, policy)).toMatchObject({ state: 'locked', reason: 'plan_expired' });
        expect(tenantAccess({ plan: 'pro', status: 'active', subscription_ends_at: at(-0.01), now }, policy).state).toBe('locked');
        // Una prueba con un período pagado viejo (pasó a prueba al no renovar):
        // manda la fecha de la prueba, no la del período.
        expect(tenantAccess({ plan: 'trial', status: 'trialing', paid_until: at(-30), trial_ends_at: at(10), now }, policy).state).toBe('full');
    });

    it('suspendida y archivada siguen en solo lectura (lo decide el operador)', () => {
        expect(tenantAccess({ plan: 'pro', status: 'past_due', now }, policy)).toMatchObject({ state: 'read_only', reason: 'suspended' });
        expect(tenantAccess({ plan: 'pro', status: 'active', archived_at: at(-1), now }, policy)).toMatchObject({ state: 'read_only', reason: 'archived' });
    });

    it('lectura tolerante de la política y de los módulos', () => {
        expect(readBillingPolicy(null)).toEqual(DEFAULT_BILLING_POLICY);
        expect(readBillingPolicy({ trial_days: 7, on_end: 'raro', grace_days: -3, lapse_to_trial: false })).toEqual({
            ...DEFAULT_BILLING_POLICY,
            trial_days: 7,
            lapse_to_trial: false,
        });
        expect(readBillingPolicy({ trial_days: null }).trial_days).toBeNull();
        expect(readDisabledModules(['ai', 'ai', 'inventado', 3, 'portal'])).toEqual(['ai', 'portal']);
        expect(readDisabledModules('ai')).toEqual([]);
        expect(moduleForIntegration('woocommerce')).toBe('woocommerce');
        expect(moduleForIntegration('sqlserver')).toBe('sql');
        expect(moduleForIntegration(null)).toBe('integrations');
        expect(daysLeft(at(2.3).toISOString(), now)).toBe(3);
        expect(daysLeft(at(-1).toISOString(), now)).toBe(0);
    });

    it('avisos: la gracia de la política y los de la prueba', () => {
        const paid = at(-10);
        expect(reminderKindFor(paid, now, false, 15)).toBe('expired');
        expect(reminderKindFor(paid, now, false, 5)).toBe('read_only');
        expect(trialReminderKind(at(2), now)).toBe('trial_soon');
        expect(trialReminderKind(at(5), now)).toBeNull();
        expect(trialReminderKind(at(-1), now)).toBe('trial_ended');
        expect(trialReminderKind(at(-9), now)).toBeNull();
        const m = billingReminderEmail('trial_ended', {
            tenantName: 'Acme',
            paidUntil: at(-1),
            link: 'https://app.test/#/settings?s=suscripcion',
            policy: { ...DEFAULT_BILLING_POLICY, on_end: 'lock' },
        });
        expect(m.subject).toBe('Terminó la prueba de «Acme»');
        expect(m.text).toContain('quedó pausada');
        expect(m.text).toContain('Elegir un plan');
        const lapse = billingReminderEmail('read_only', {
            tenantName: 'Acme',
            paidUntil: at(-6),
            link: 'x',
            policy: { ...DEFAULT_BILLING_POLICY, lapse_to_trial: true, lapse_trial_days: 7 },
        });
        expect(lapse.text).toContain('pasó al plan de prueba');
        expect(lapse.text).toContain('Tienes 7 días');
    });
});

describe('v0.1.338 — prueba, pausa y paso a prueba (Postgres + Redis reales)', () => {
    let pg: TestPg;
    let rd: TestRedis;
    let redis: IORedis;
    let tenantDb: TenantDb;
    let guard: TenantGuard;
    let billing: BillingService;
    let policies: BillingPolicyService;
    let lifecycle: BillingRemindersService;
    const sent: MailMessage[] = [];
    let counter = 0;

    beforeAll(async () => {
        [pg, rd] = await Promise.all([startPostgres(), startRedis()]);
        redis = new IORedis(rd.url);
        tenantDb = new TenantDb(pg.db);
        guard = new TenantGuard(tenantDb, new Reflector());
        const env = loadEnv({ SECRETS_KEY: 'clave-de-test-32-bytes-o-lo-que-sea', APP_BASE_URL: 'https://app.test' });
        const plansSvc = new PlansService(pg.db);
        billing = new BillingService(tenantDb, plansSvc, new EmailQuotaService(pg.db, plansSvc), new TenantSmtpService(pg.db, env));
        policies = new BillingPolicyService(redis);
        const mail = { enqueue: (m: MailMessage) => (sent.push(m), Promise.resolve()) } as never;
        lifecycle = new BillingRemindersService(pg.db, redis, env, mail, new AuditService(tenantDb));
    });

    afterAll(async () => {
        setCurrentBillingPolicy(DEFAULT_BILLING_POLICY);
        redis?.disconnect();
        await Promise.all([pg?.stop(), rd?.stop()]);
    });

    beforeEach(async () => {
        sent.length = 0;
        await policies.update(DEFAULT_BILLING_POLICY);
    });

    async function mkTenant(values: Partial<typeof tenants.$inferInsert>): Promise<{ tenantId: number; userId: number }> {
        counter += 1;
        const [t] = await pg.db
            .insert(tenants)
            .values({ slug: `t-${counter}`, name: `Empresa ${counter}`, plan: 'trial', status: 'trialing', ...values })
            .returning();
        const [u] = await pg.db.insert(users).values({ email: `admin${counter}@acme.test`, passwordHash: 'x', name: 'Admin' }).returning();
        await withTenant(pg.db, t!.id, (tx) => tx.insert(memberships).values({ userId: u!.id, tenantId: t!.id, role: 'admin' }));
        return { tenantId: t!.id, userId: u!.id };
    }

    /** El TenantGuard como en un pedido real. */
    async function run(
        userId: number,
        tenantId: number,
        opts: { method?: string; allowLocked?: boolean; module?: string } = {},
    ): Promise<TenantContext> {
        const handler = function handler(): void {};
        if (opts.allowLocked) Reflect.defineMetadata(ALLOW_LOCKED, true, handler);
        if (opts.module) Reflect.defineMetadata(PLAN_MODULE, opts.module, handler);
        const req = { authUserId: userId, headers: { 'x-tenant-id': String(tenantId) }, method: opts.method ?? 'GET' } as Record<string, unknown>;
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
            getHandler: () => handler,
            getClass: () => class Ctrl {},
        } as unknown as ExecutionContext;
        await guard.canActivate(ctx);
        return req.tenant as TenantContext;
    }
    const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
        try {
            await p;
            return undefined;
        } catch (err) {
            expect(err).toBeInstanceOf(ForbiddenException);
            return ((err as ForbiddenException).getResponse() as { code?: string }).code;
        }
    };

    it('prueba terminada → PAUSADA: sólo lo marcado @AllowLocked; los procesos tampoco corren', async () => {
        const { tenantId, userId } = await mkTenant({ trialEndsAt: new Date(Date.now() - DAY) });
        expect(await codeOf(run(userId, tenantId))).toBe('workspace_locked');
        const ok = await run(userId, tenantId, { allowLocked: true });
        expect(ok.access).toMatchObject({ state: 'locked', reason: 'trial_ended', trial: true });
        // Pagar y descargar los datos siguen (POST permitido con @AllowLocked).
        await run(userId, tenantId, { allowLocked: true, method: 'POST' });
        await withTenant(pg.db, tenantId, async (tx) => {
            expect(await tenantIsLocked(tx, tenantId)).toBe(true);
            expect(await tenantIsReadOnly(tx, tenantId)).toBe(true);
        });
        const s = await billing.summary(tenantId);
        expect(s.access).toMatchObject({ state: 'locked' });
        expect(s.read_only).toBe(true);
        expect(s.trial_ends_at).not.toBeNull();

        // Con la política "solo lectura": se lee, no se escribe.
        await policies.update({ on_end: 'read_only' });
        expect((await run(userId, tenantId)).access?.state).toBe('read_only');
        expect(await codeOf(run(userId, tenantId, { method: 'PATCH' }))).toBe('workspace_read_only');

        // Extender la prueba la devuelve al instante.
        await pg.db.update(tenants).set({ trialEndsAt: new Date(Date.now() + 7 * DAY) }).where(eq(tenants.id, tenantId));
        const back = await run(userId, tenantId, { method: 'PATCH' });
        expect(back.access).toMatchObject({ state: 'full', trial: true });
    });

    it('módulos del plan: 403 plan_module_disabled y el rol propio se ignora', async () => {
        await pg.db.insert(plans).values({ slug: 'basico', name: 'Básico', disabledModules: ['automations', 'custom_roles'] }).onConflictDoNothing();
        const { tenantId, userId } = await mkTenant({ plan: 'basico', status: 'active' });
        expect(await codeOf(run(userId, tenantId, { module: 'automations' }))).toBe('plan_module_disabled');
        const t = await run(userId, tenantId, { module: 'forms' });
        expect(t.disabledModules).toEqual(['automations', 'custom_roles']);
        // Volver a incluirlo destraba en el mismo pedido siguiente.
        await pg.db.update(plans).set({ disabledModules: [] }).where(eq(plans.slug, 'basico'));
        await run(userId, tenantId, { module: 'automations' });
    });

    it('no renovó: pasada la gracia pasa al plan de prueba (pausada), con aviso y bitácora; suspendida no se toca', async () => {
        const lapsed = await mkTenant({ plan: 'pro', status: 'active', paidUntil: new Date(Date.now() - 7 * DAY) });
        const inGrace = await mkTenant({ plan: 'pro', status: 'active', paidUntil: new Date(Date.now() - 2 * DAY) });
        const suspended = await mkTenant({ plan: 'pro', status: 'past_due', paidUntil: new Date(Date.now() - 30 * DAY) });
        const manual = await mkTenant({ plan: 'starter', status: 'active', subscriptionEndsAt: new Date(Date.now() - 60_000) });

        await lifecycle.tick();
        const rows = await pg.db.select().from(tenants);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const l = byId.get(lapsed.tenantId)!;
        expect(l.plan).toBe('trial');
        expect((l.settings as { lapsed?: { from_plan: string } }).lapsed?.from_plan).toBe('pro');
        expect(byId.get(inGrace.tenantId)!.plan).toBe('pro');
        expect(byId.get(suspended.tenantId)!.plan).toBe('pro');
        const m = byId.get(manual.tenantId)!;
        expect(m.plan).toBe('trial');
        expect(m.subscriptionEndsAt).toBeNull();

        // Pausada al toque (0 días de prueba al pasar) y lo dice la membresía.
        expect(await codeOf(run(lapsed.userId, lapsed.tenantId))).toBe('workspace_locked');
        const s = await billing.summary(lapsed.tenantId);
        expect(s.lapsed_from?.plan).toBe('pro');
        // Un aviso del corte por cada una (el período pagado y la fecha manual), sin repetirse.
        const subjects = sent.map((x) => x.subject);
        expect(subjects.filter((x) => x.includes('quedó pausada')).length).toBeGreaterThanOrEqual(2);
        const before = sent.length;
        await lifecycle.tick();
        expect(sent.length).toBe(before);
        const audits = await withTenant(pg.db, lapsed.tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.tenantId, lapsed.tenantId)));
        expect(audits.map((a) => a.action)).toContain('billing.lapse_to_trial');
    });

    it('con días de prueba al pasar, sigue funcionando hasta que terminan', async () => {
        await policies.update({ lapse_trial_days: 10 });
        const t = await mkTenant({ plan: 'pro', status: 'active', paidUntil: new Date(Date.now() - 6 * DAY) });
        await lifecycle.lapse();
        const ctx = await run(t.userId, t.tenantId, { method: 'POST' });
        expect(ctx.plan).toBe('trial');
        expect(ctx.access).toMatchObject({ state: 'full', trial: true });
        expect(daysLeft(ctx.access!.ends_at)).toBe(10);
    });

    it('sin "pasa a prueba": se queda en su plan, pausada por la fecha', async () => {
        await policies.update({ lapse_to_trial: false });
        const t = await mkTenant({ plan: 'pro', status: 'active', paidUntil: new Date(Date.now() - 9 * DAY) });
        expect(await lifecycle.lapse()).toBe(0);
        const [row] = await pg.db.select().from(tenants).where(eq(tenants.id, t.tenantId));
        expect(row!.plan).toBe('pro');
        expect(await codeOf(run(t.userId, t.tenantId))).toBe('workspace_locked');
    });

    it('avisos de la prueba: 3 días antes y al terminar, una sola vez', async () => {
        const soon = await mkTenant({ trialEndsAt: new Date(Date.now() + 2 * DAY) });
        const ended = await mkTenant({ trialEndsAt: new Date(Date.now() - DAY) });
        await lifecycle.tick();
        const forSoon = sent.filter((m) => m.to === `admin${counter - 1}@acme.test`);
        const forEnded = sent.filter((m) => m.to === `admin${counter}@acme.test`);
        expect(forSoon.map((m) => m.subject)).toEqual([expect.stringContaining('Tu prueba de «Empresa')]);
        expect(forEnded.map((m) => m.subject)).toEqual([expect.stringContaining('Terminó la prueba')]);
        void soon;
        void ended;
        const n = sent.length;
        await lifecycle.tick();
        expect(sent.length).toBe(n);
    });

    it('la política vive en Redis y vuelve tolerante', async () => {
        await redis.set('platform:billing-policy', JSON.stringify({ trial_days: 30, on_end: 'basura' }));
        const p = await policies.refresh();
        expect(p).toMatchObject({ trial_days: 30, on_end: 'lock', grace_days: 5 });
    });
});
