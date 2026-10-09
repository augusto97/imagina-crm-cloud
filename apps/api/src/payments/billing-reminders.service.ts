import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { BILLING_GRACE_DAYS, paidReadOnlyAt } from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { billingSubscriptions, memberships, tenants, users } from '../db/schema';
import { escapeHtml } from '../legal/legal-page';
import { MailService } from '../mail/mail.service';
import { REDIS } from '../redis/redis.module';
import { guardRedis } from '../redis/redis.util';

export type ReminderKind = 'soon' | 'expired' | 'read_only';

const DAY = 24 * 60 * 60 * 1000;
/** Avisar con esta anticipación al vencimiento. */
const SOON_DAYS = 3;

/** Qué aviso le toca a un período pagado HOY (o ninguno). Puro, testeado. */
export function reminderKindFor(paidUntil: Date, now: Date, autoRenew: boolean): ReminderKind | null {
    const due = paidUntil.getTime();
    const cut = paidReadOnlyAt(paidUntil).getTime();
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

/** El correo de cada aviso. Puro: se testea sin red. */
export function billingReminderEmail(
    kind: ReminderKind,
    opts: { tenantName: string; paidUntil: Date; link: string },
): { subject: string; text: string; html: string } {
    const fmt = (d: Date) =>
        d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const due = fmt(opts.paidUntil);
    const cut = fmt(paidReadOnlyAt(opts.paidUntil));
    const name = opts.tenantName;
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
                `Tienes ${BILLING_GRACE_DAYS} días de gracia: si no se renueva antes del ${cut}, el espacio queda en solo-lectura (tus datos se conservan y se pueden exportar).`,
            ],
        },
        read_only: {
            subject: `«${name}» quedó en solo-lectura`,
            lines: [
                `El plan de «${name}» venció el ${due} y no se renovó: el espacio quedó en solo-lectura.`,
                'Tus datos están intactos y se pueden consultar y exportar. Al pagar, se reactiva al instante.',
            ],
        },
    };
    const c = copy[kind];
    const text = `${c.lines.join('\n\n')}\n\nGestiona tu plan: ${opts.link}`;
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#1f2937">
${c.lines.map((l) => `<p style="margin:0 0 14px">${escapeHtml(l)}</p>`).join('\n')}
<p style="margin:22px 0"><a href="${escapeHtml(opts.link)}" style="background:#0e7490;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Gestionar el plan</a></p>
</div>`;
    return { subject: c.subject, text, html };
}

/** Subconjunto de ioredis para el "ya avisé" (fake en memoria en los specs). */
export interface ReminderDedupStore {
    set(key: string, value: string, mode: 'EX', seconds: number, flag: 'NX'): Promise<unknown>;
}

/**
 * Avisos de vencimiento del plan (v0.1.250): a los admins de cada empresa con
 * período pagado, tres días antes, al vencer y al pasar a solo-lectura. Una
 * vez por período (clave en Redis) y por la vía de correo de la PLATAFORMA:
 * es un correo nuestro a nuestro cliente, no de la empresa.
 */
@Injectable()
export class BillingRemindersService {
    private readonly logger = new Logger(BillingRemindersService.name);

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(REDIS) private readonly dedup: ReminderDedupStore,
        @Inject(ENV) private readonly env: Env,
        private readonly mail: MailService,
    ) {}

    async tick(now = new Date()): Promise<number> {
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
            const kind = reminderKindFor(paidUntil, now, renewing.has(t.id));
            if (!kind) continue;
            const key = `billrem:${t.id}:${kind}:${paidUntil.toISOString()}`;
            const first = await this.dedup.set(key, '1', 'EX', 60 * 24 * 60 * 60, 'NX').catch(() => null);
            if (first !== 'OK') continue;
            const admins = await this.db
                .select({ email: users.email })
                .from(memberships)
                .innerJoin(users, eq(users.id, memberships.userId))
                .where(and(eq(memberships.tenantId, t.id), eq(memberships.role, 'admin'), isNull(users.disabledAt)));
            const msg = billingReminderEmail(kind, {
                tenantName: t.name,
                paidUntil,
                link: `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/#/settings?s=suscripcion`,
            });
            for (const a of admins) {
                try {
                    await this.mail.enqueue({ to: a.email, ...msg });
                    sent++;
                } catch (err) {
                    this.logger.warn(`aviso de vencimiento a ${a.email} (empresa ${t.id}) no salió: ${String(err)}`);
                }
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
            this.queue = new Queue(QUEUE, { connection: conn() });
            this.queue.on('error', (err) => this.logger.warn(`Cola de avisos de cobro con error: ${err.message}`));
            this.worker = new Worker(QUEUE, async () => this.reminders.tick(), { connection: conn() });
            this.worker.on('failed', (_job, err) => this.logger.error(`Avisos de vencimiento fallaron: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de avisos de cobro con error: ${err.message}`));
            // Cada 6 horas: un vencimiento se avisa el mismo día aunque el
            // servidor estuviera apagado a la hora "justa"; Redis evita repetir.
            await this.queue.upsertJobScheduler('tick', { every: 6 * 60 * 60 * 1000 }, { name: 'tick', data: {} });
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
