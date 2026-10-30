import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { BILLING_GRACE_DAYS, TRIAL_PLAN, paidCutAt, type BillingPolicy } from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { readLapsedFrom } from '../billing/billing.service';
import { currentBillingPolicy } from '../billing/tenant-access';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { billingSubscriptions, memberships, tenants, users } from '../db/schema';
import { escapeHtml } from '../legal/legal-page';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';

/**
 * Avisos del ciclo de cobro:
 * - de un período PAGADO: `soon` (3 días antes), `expired` (venció: corre la
 *   gracia) y `read_only` (se cortó el acceso — el nombre es histórico: con la
 *   política "pausar" el texto dice pausada);
 * - v0.1.338 — de la PRUEBA: `trial_soon` (3 días antes) y `trial_ended`.
 */
export type ReminderKind = 'soon' | 'expired' | 'read_only' | 'trial_soon' | 'trial_ended';

const DAY = 24 * 60 * 60 * 1000;
/** Avisar con esta anticipación al vencimiento. */
const SOON_DAYS = 3;

/** Qué aviso le toca a un período pagado HOY (o ninguno). Puro, testeado. */
export function reminderKindFor(paidUntil: Date, now: Date, autoRenew: boolean, graceDays = BILLING_GRACE_DAYS): ReminderKind | null {
    const due = paidUntil.getTime();
    const cut = paidCutAt(paidUntil, graceDays).getTime();
    const t = now.getTime();
    if (t >= cut) {
        // Sólo los recién cortados: un período vencido hace meses no se re-anuncia.
        return t < cut + 7 * DAY ? 'read_only' : null;
    }
    // Con la renovación automática activa, Mercado Pago cobra solo (y reintenta
    // la tarjeta en la gracia): avisar "paga" sería ruido.
    if (autoRenew) return null;
    if (t >= due) return 'expired';
    if (due - t <= SOON_DAYS * DAY) return 'soon';
    return null;
}

/** v0.1.338 — Qué aviso le toca a una PRUEBA hoy (o ninguno). Puro, testeado. */
export function trialReminderKind(trialEndsAt: Date, now: Date): ReminderKind | null {
    const end = trialEndsAt.getTime();
    const t = now.getTime();
    if (t >= end) return t < end + 7 * DAY ? 'trial_ended' : null;
    if (end - t <= SOON_DAYS * DAY) return 'trial_soon';
    return null;
}

export interface ReminderEmailOpts {
    tenantName: string;
    /** La fecha que importa: fin del período pagado o fin de la prueba. */
    paidUntil: Date;
    link: string;
    /** v0.1.338 — la política vigente (por defecto, la de fábrica). */
    policy?: Pick<BillingPolicy, 'grace_days' | 'on_end' | 'lapse_to_trial' | 'lapse_trial_days'>;
}

/** El correo de cada aviso. Puro: se testea sin red. */
export function billingReminderEmail(kind: ReminderKind, opts: ReminderEmailOpts): { subject: string; text: string; html: string } {
    const policy = opts.policy ?? { grace_days: BILLING_GRACE_DAYS, on_end: 'read_only', lapse_to_trial: false, lapse_trial_days: 0 };
    const fmt = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const due = fmt(opts.paidUntil);
    const cut = fmt(paidCutAt(opts.paidUntil, policy.grace_days));
    const name = opts.tenantName;
    const paused = policy.on_end === 'lock';
    /** Qué pasa cuando se corta el acceso, en una frase. */
    const whatHappens = paused
        ? 'la cuenta queda pausada: nadie del equipo puede usarla hasta elegir un plan (tus datos se conservan y puedes descargarlos)'
        : 'el espacio queda en solo-lectura (tus datos se conservan y se pueden exportar)';
    // Lo que dice el corte de un plan pagado depende de si pasa a prueba.
    const cutLines = (): string[] => {
        if (policy.lapse_to_trial && policy.lapse_trial_days > 0) {
            return [
                `El plan de «${name}» venció el ${due} y no se renovó: pasó al plan de prueba.`,
                `Tienes ${policy.lapse_trial_days} días para elegir un plan; después, ${whatHappens}.`,
            ];
        }
        return [
            paused
                ? `El plan de «${name}» venció el ${due} y no se renovó: la cuenta quedó pausada.`
                : `El plan de «${name}» venció el ${due} y no se renovó: el espacio quedó en solo-lectura.`,
            paused
                ? 'Tus datos están intactos y puedes descargarlos. Al pagar un plan, la cuenta vuelve a funcionar al instante.'
                : 'Tus datos están intactos y se pueden consultar y exportar. Al pagar, se reactiva al instante.',
        ];
    };
    const copy: Record<ReminderKind, { subject: string; lines: string[] }> = {
        soon: {
            subject: `Tu plan de «${name}» vence el ${due}`,
            lines: [
                `El período pagado de «${name}» vence el ${due}.`,
                'Para seguir sin interrupciones, paga el próximo período o activa la renovación automática con tarjeta.',
            ],
        },
        expired: {
            subject: `Venció el plan de «${name}»`,
            lines: [
                `El período pagado de «${name}» venció el ${due}.`,
                `Tienes ${policy.grace_days} días de gracia: si no se renueva antes del ${cut}, ${whatHappens}.`,
            ],
        },
        read_only: {
            subject: paused ? `«${name}» quedó pausada` : `«${name}» quedó en solo-lectura`,
            lines: cutLines(),
        },
        trial_soon: {
            subject: `Tu prueba de «${name}» termina el ${due}`,
            lines: [
                `La prueba de «${name}» termina el ${due}.`,
                `Para seguir usando la app sin interrupciones, elige un plan. Si no, ${whatHappens}.`,
            ],
        },
        trial_ended: {
            subject: paused ? `Terminó la prueba de «${name}»` : `Terminó la prueba de «${name}»: quedó en solo-lectura`,
            lines: [
                paused
                    ? `La prueba de «${name}» terminó el ${due} y la cuenta quedó pausada.`
                    : `La prueba de «${name}» terminó el ${due} y el espacio quedó en solo-lectura.`,
                'Tus datos están guardados: elige un plan y la cuenta vuelve a funcionar al instante, con todo lo que armaste.',
            ],
        },
    };
    const c = copy[kind];
    const cta = kind === 'soon' || kind === 'expired' ? 'Gestionar el plan' : 'Elegir un plan';
    const text = `${c.lines.join('\n\n')}\n\n${cta}: ${opts.link}`;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">
${c.lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapeHtml(opts.link)}" style="background:#0e7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${cta}</a></p>
</div>`;
    return { subject: c.subject, text, html };
}

/** Subconjunto de ioredis para el "ya avisé" (fake en memoria en los specs). */
export interface ReminderDedupStore {
    set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<unknown>;
}

/**
 * El ciclo de cobro de las empresas (v0.1.250, ampliado en v0.1.338):
 * 1. Paso a prueba (ADR-S87): la empresa con plan pagado que venció hace más
 *    de la gracia (o cuya fecha manual pasó) pasa al plan de prueba, si la
 *    política lo pide. El acceso se corta solo por la fecha; esto cambia el
 *    plan (límites, módulos) y deja escrito de dónde venía.
 * 2. Avisos por correo a los admins: del período pagado y de la prueba. Una
 *    vez por fecha (clave en Redis) y por la vía de correo de la PLATAFORMA:
 *    es un correo nuestro a nuestro cliente, no de la empresa.
 */
@Injectable()
export class BillingRemindersService {
    private readonly logger = new Logger(BillingRemindersService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly dedup: ReminderDedupStore,
        @Inject(ENV) private readonly env: Env,
        private readonly mail: MailService,
        @Optional() private readonly audit?: AuditService,
    ) {}

    private link(): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/#/settings?s=suscripcion`;
    }

    async tick(now = new Date()): Promise<number> {
        await this.lapse(now);
        return (await this.paidReminders(now)) + (await this.trialReminders(now));
    }

    /**
     * Las empresas con plan pagado vencido (más la gracia) o con la fecha
     * manual pasada → plan de prueba. Sólo las habilitadas (una suspendida
     * por el operador sigue suspendida en su plan). Devuelve cuántas pasaron.
     */
    async lapse(now = new Date()): Promise<number> {
        const policy = currentBillingPolicy();
        if (!policy.lapse_to_trial) return 0;
        const graceCut = new Date(now.getTime() - policy.grace_days * DAY);
        const rows = await this.db
            .select({
                id: tenants.id,
                name: tenants.name,
                plan: tenants.plan,
                paidUntil: tenants.paidUntil,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
            })
            .from(tenants)
            .where(
                and(
                    ne(tenants.plan, TRIAL_PLAN),
                    isNull(tenants.archivedAt),
                    inArray(tenants.status, ['trialing', 'active']),
                    or(
                        and(isNotNull(tenants.paidUntil), lte(tenants.paidUntil, graceCut)),
                        and(isNotNull(tenants.subscriptionEndsAt), lte(tenants.subscriptionEndsAt, now)),
                    ),
                ),
            );
        const trialEndsAt = new Date(now.getTime() + policy.lapse_trial_days * DAY);
        let moved = 0;
        for (const t of rows) {
            const reason = t.subscriptionEndsAt && t.subscriptionEndsAt <= now ? 'manual' : 'paid';
            const lapsed = { from_plan: t.plan, at: now.toISOString(), reason };
            // Condicional sobre el plan que se vio: si justo entró un pago, no se pisa.
            const res = await this.db
                .update(tenants)
                .set({
                    plan: TRIAL_PLAN,
                    status: 'trialing',
                    trialEndsAt,
                    subscriptionEndsAt: null,
                    settings: sql`coalesce(${tenants.settings}, '{}'::jsonb) || ${JSON.stringify({ lapsed })}::jsonb`,
                    updatedAt: now,
                })
                .where(and(eq(tenants.id, t.id), eq(tenants.plan, t.plan)))
                .returning({ id: tenants.id });
            if (res.length === 0) continue;
            moved++;
            this.logger.log(`Empresa ${t.id} («${t.name}») no renovó ${t.plan}: pasó al plan de prueba`);
            void this.audit?.log({
                tenantId: t.id,
                userId: null,
                action: 'billing.lapse_to_trial',
                targetType: 'tenant',
                targetId: t.id,
                targetLabel: t.name,
                meta: { from_plan: t.plan, reason, trial_days: policy.lapse_trial_days },
            });
            // La fecha manual no tiene período pagado que dispare el aviso de
            // corte: se manda aquí (el de un período pagado lo manda `paidReminders`).
            if (reason === 'manual' && t.subscriptionEndsAt) {
                await this.notify(t.id, t.name, 'read_only', t.subscriptionEndsAt, `manual:${t.subscriptionEndsAt.toISOString()}`);
            }
        }
        return moved;
    }

    private async paidReminders(now: Date): Promise<number> {
        const policy = currentBillingPolicy();
        const rows = await this.db
            .select({ id: tenants.id, name: tenants.name, paidUntil: tenants.paidUntil })
            .from(tenants)
            .where(and(isNotNull(tenants.paidUntil), isNull(tenants.archivedAt)));
        if (rows.length === 0) return 0;
        const renewing = new Set(
            (
                await this.db
                    .select({ tenantId: billingSubscriptions.tenantId })
                    .from(billingSubscriptions)
                    .where(and(inArray(billingSubscriptions.tenantId, rows.map((r) => r.id)), eq(billingSubscriptions.status, 'authorized')))
            ).map((r) => r.tenantId),
        );
        let sent = 0;
        for (const t of rows) {
            const paidUntil = t.paidUntil!;
            const kind = reminderKindFor(paidUntil, now, renewing.has(t.id), policy.grace_days);
            if (!kind) continue;
            sent += await this.notify(t.id, t.name, kind, paidUntil, paidUntil.toISOString());
        }
        return sent;
    }

    /** v0.1.338 — Avisos de la prueba: 3 días antes y al terminar. */
    private async trialReminders(now: Date): Promise<number> {
        const rows = await this.db
            .select({ id: tenants.id, name: tenants.name, trialEndsAt: tenants.trialEndsAt, settings: tenants.settings })
            .from(tenants)
            .where(
                and(
                    eq(tenants.plan, TRIAL_PLAN),
                    isNotNull(tenants.trialEndsAt),
                    isNull(tenants.archivedAt),
                    inArray(tenants.status, ['trialing', 'active']),
                    // Ventana útil: lo que termina en los próximos días o terminó hace poco.
                    lte(tenants.trialEndsAt, new Date(now.getTime() + (SOON_DAYS + 1) * DAY)),
                    gt(tenants.trialEndsAt, new Date(now.getTime() - 7 * DAY)),
                ),
            );
        let sent = 0;
        for (const t of rows) {
            const ends = t.trialEndsAt!;
            // Una empresa que pasó a prueba SIN días (pausada al toque) ya
            // recibió el aviso del corte de su plan: no se le repite.
            const lapsed = readLapsedFrom(t.settings);
            if (lapsed && ends.getTime() <= new Date(lapsed.at).getTime() + DAY) continue;
            const kind = trialReminderKind(ends, now);
            if (!kind) continue;
            sent += await this.notify(t.id, t.name, kind, ends, `trial:${ends.toISOString()}`);
        }
        return sent;
    }

    /** Manda un aviso a los admins de la empresa, una sola vez por `dedupId`. */
    private async notify(tenantId: number, tenantName: string, kind: ReminderKind, date: Date, dedupId: string): Promise<number> {
        const key = `billrem:${tenantId}:${kind}:${dedupId}`;
        const first = await this.dedup.set(key, '1', 'EX', 60 * 24 * 60 * 60, 'NX').catch(() => null);
        if (first !== 'OK') return 0;
        const admins = await this.db
            .select({ email: users.email })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'admin'), isNull(users.disabledAt)));
        const msg = billingReminderEmail(kind, { tenantName, paidUntil: date, link: this.link(), policy: currentBillingPolicy() });
        let sent = 0;
        for (const a of admins) {
            try {
                await this.mail.enqueue({ to: a.email, ...msg });
                sent++;
            } catch (err) {
                this.logger.warn(`aviso de cobro a ${a.email} (empresa ${tenantId}) no salió: ${String(err)}`);
            }
        }
        return sent;
    }
}

const QUEUE = 'billing-reminders';

@Injectable()
export class BillingRemindersBootstrap implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(BillingRemindersBootstrap.name);
    private queue: Queue | null = null;
    private worker: Worker | null = null;
    private connections: IORedis[] = [];

    constructor(
        @Inject(ENV) private readonly env: Env,
        private readonly reminders: BillingRemindersService,
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue(QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de avisos de cobro con error: ${err.message}`));
            this.worker = new Worker(QUEUE, async () => this.reminders.tick(), { connection: conn() });
            this.worker.on('failed', (_job, err) => this.logger.error(`Ciclo de cobro falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de avisos de cobro con error: ${err.message}`));
            // Cada hora (v0.1.338; antes 6 h): el acceso se corta solo por la
            // fecha, esto cambia el plan de las que no renovaron y avisa el
            // mismo día aunque el servidor estuviera apagado; Redis evita repetir.
            await this.queue.upsertJobScheduler('tick', { every: 60 * 60 * 1000 }, { name: 'tick', data: {} });
        } catch (err) {
            this.logger.warn(`Avisos de vencimiento deshabilitados (sin Redis): ${String(err)}`);
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }
}
