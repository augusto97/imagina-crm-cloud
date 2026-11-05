import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
    PaymentProvider,
    Plan,
    PlatformReconcileChange,
    PlatformReconcileRun,
    PlatformReconcileStatus,
} from '@imagina-base/shared';
import { inArray } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { billingSubscriptions, tenants } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { emptyReconcileBatch, type PaymentNotice, type ReconcileBatch } from './payment.types';
import { PaymentsService } from './payments.service';
import { PlatformPaymentsService } from './platform-payments.service';
import {
    OpenCheckouts,
    RECONCILE_LAST_KEY,
    RECONCILE_LOCK_KEY,
    RECONCILE_OK_KEY,
    readLastRun,
    readReconcileStatus,
    reconcileDue,
    reconcileSince,
} from './reconcile-state';

/** Subconjunto de ioredis que se usa (se testea con un fake en memoria). */
export interface ReconcileRedis {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
    del(key: string): Promise<unknown>;
}

/** Una revisión nunca dura más que esto: si el proceso muere, el candado se suelta solo. */
const LOCK_SECONDS = 15 * 60;
/** Cambios que se guardan para mostrar (los demás sólo se cuentan). */
const MAX_CHANGES = 30;
const LIVE = ['pending', 'authorized', 'paused'];

/**
 * v0.1.382 — Revisión de respaldo de los cobros de la PLATAFORMA (ADR-S30).
 *
 * Los avisos de Mercado Pago y PayPal son la vía rápida, pero pueden no
 * llegar nunca: el servidor estaba apagado o actualizándose, la URL cambió,
 * falta la clave secreta (y entonces se descartan todos), Mercado Pago dejó
 * de reintentar. Esto le pregunta a cada proveedor, cada cierto tiempo, qué
 * pagos cambiaron, en qué está cada renovación automática viva y cómo quedó
 * cada orden abierta, y lo aplica con el MISMO `applyDetailed` de los avisos:
 * el registro de pagos (una fila por cobro) hace que nada se aplique dos
 * veces, aunque el aviso llegue después.
 *
 * Una sola a la vez (candado en Redis, compartido entre servidores). La
 * frecuencia se elige en Plataforma → Cobros; «Revisar ahora» la corre en el
 * momento.
 */
@Injectable()
export class PaymentsReconcileService {
    private readonly logger = new Logger(PaymentsReconcileService.name);

    constructor(
        private readonly payments: PaymentsService,
        private readonly settings: PlatformPaymentsService,
        private readonly openCheckouts: OpenCheckouts,
        @Inject(REDIS) private readonly redis: ReconcileRedis,
        @Inject(DRIZZLE) private readonly db: Db,
    ) {}

    async status(): Promise<PlatformReconcileStatus> {
        return readReconcileStatus(this.redis, await this.settings.reconcileInterval());
    }

    /**
     * «Revisar ahora»: arranca en segundo plano y vuelve enseguida (la consola
     * pregunta hasta que termina). Si ya hay una corriendo, no lanza otra.
     */
    async start(): Promise<PlatformReconcileStatus> {
        if (await this.lock()) {
            void this.runLocked('manual').catch((err: unknown) => this.logger.error(`revisión manual falló: ${String(err)}`));
        }
        const status = await this.status();
        return { ...status, running: true };
    }

    /** El reloj (cada 5 minutos) llama acá; corre sólo si le toca. */
    async tick(now = new Date()): Promise<PlatformReconcileRun | null> {
        const interval = await this.settings.reconcileInterval();
        if (!reconcileDue(interval, await readLastRun(this.redis), now)) return null;
        if (!(await this.hasGateway())) return null;
        if (!(await this.lock())) return null;
        return this.runLocked('auto', now);
    }

    /** Corre una revisión ya (para tests y para el reloj). Devuelve null si había otra. */
    async run(trigger: 'auto' | 'manual', now = new Date()): Promise<PlatformReconcileRun | null> {
        if (!(await this.lock())) return null;
        return this.runLocked(trigger, now);
    }

    private async lock(): Promise<boolean> {
        try {
            const res = await this.redis.set(RECONCILE_LOCK_KEY, new Date().toISOString(), 'EX', LOCK_SECONDS, 'NX');
            return res === 'OK';
        } catch {
            return false;
        }
    }

    private async hasGateway(): Promise<boolean> {
        for (const g of this.payments.gateways()) {
            if (g.reconcile && (await g.isEnabled().catch(() => false))) return true;
        }
        return false;
    }

    private async runLocked(trigger: 'auto' | 'manual', now = new Date()): Promise<PlatformReconcileRun> {
        try {
            const result = await this.execute(trigger, now);
            await this.redis.set(RECONCILE_LAST_KEY, JSON.stringify(result));
            if (result.ok && !result.skipped) await this.redis.set(RECONCILE_OK_KEY, result.started_at);
            if (result.applied > 0) this.logger.log(`revisión ${trigger}: ${result.applied} cambio(s) aplicados`);
            if (result.errors.length > 0) this.logger.warn(`revisión ${trigger} con errores: ${result.errors.join(' | ')}`);
            return result;
        } finally {
            await this.redis.del(RECONCILE_LOCK_KEY).catch(() => undefined);
        }
    }

    private async execute(trigger: 'auto' | 'manual', now: Date): Promise<PlatformReconcileRun> {
        const startedAt = now.toISOString();
        const result: PlatformReconcileRun = {
            trigger,
            started_at: startedAt,
            finished_at: startedAt,
            ok: true,
            checked: { payments: 0, subscriptions: 0, orders: 0 },
            applied: 0,
            changes: [],
            errors: [],
            skipped: null,
        };
        const gateways = [];
        for (const g of this.payments.gateways()) {
            if (g.reconcile && (await g.isEnabled().catch(() => false))) gateways.push(g);
        }
        if (gateways.length === 0) {
            result.skipped = 'No hay cobros configurados: carga las credenciales de Mercado Pago (o PayPal en el servidor).';
            result.finished_at = new Date().toISOString();
            return result;
        }

        const since = reconcileSince(trigger, await this.redis.get(RECONCILE_OK_KEY).catch(() => null), now);
        const live = await this.db
            .select({ provider: billingSubscriptions.provider, externalId: billingSubscriptions.externalId })
            .from(billingSubscriptions)
            .where(inArray(billingSubscriptions.status, LIVE));
        let open: Awaited<ReturnType<OpenCheckouts['list']>> = [];
        try {
            open = await this.openCheckouts.list(now);
        } catch (err) {
            result.errors.push(`No se pudieron leer los pagos abiertos: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
        }

        const pending: Array<{ provider: PaymentProvider; notice: PaymentNotice }> = [];
        for (const g of gateways) {
            const mine = open.filter((o) => o.checkout.provider === g.provider);
            let batch: ReconcileBatch = emptyReconcileBatch();
            try {
                batch = await g.reconcile!({
                    since,
                    now,
                    openCheckouts: mine.map((o) => ({
                        externalId: o.checkout.external_id,
                        reference: o.checkout.reference,
                        tenantId: o.checkout.tenant_id,
                        createdAt: o.checkout.created_at,
                    })),
                    liveSubscriptions: live.filter((s) => s.provider === g.provider).map((s) => s.externalId),
                });
            } catch (err) {
                result.errors.push(`${providerName(g.provider)}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
            }
            result.checked.payments += batch.checked.payments;
            result.checked.subscriptions += batch.checked.subscriptions;
            result.checked.orders += batch.checked.orders;
            result.errors.push(...batch.errors);
            for (const n of batch.notices) pending.push({ provider: g.provider, notice: n });
            const settled = new Set(batch.settled.map((c) => `${c.externalId}|${c.createdAt}`));
            await this.openCheckouts
                .settle(mine.filter((o) => settled.has(`${o.checkout.external_id}|${o.checkout.created_at}`)).map((o) => o.member))
                .catch(() => undefined);
        }

        // Primero las renovaciones (una cuota busca su empresa por la renovación).
        pending.sort((a, b) => (a.notice.kind === b.notice.kind ? 0 : a.notice.kind === 'subscription' ? -1 : 1));
        const changes: Array<Omit<PlatformReconcileChange, 'tenant_name'>> = [];
        for (const { provider, notice } of pending) {
            try {
                const r = await this.payments.applyDetailed(provider, notice, { quiet: true });
                if (!r.changed || r.tenantId === null) continue;
                result.applied++;
                if (changes.length < MAX_CHANGES) {
                    changes.push({
                        tenant_id: r.tenantId,
                        provider,
                        kind: notice.kind,
                        status: notice.status,
                        text: reconcileChangeText(notice, r.plan),
                    });
                }
            } catch (err) {
                result.errors.push(`No se pudo aplicar un cobro de ${providerName(provider)}: ${String(err instanceof Error ? err.message : err).slice(0, 160)}`);
            }
        }
        const ids = [...new Set(changes.map((c) => c.tenant_id))];
        const names = new Map<number, string>();
        if (ids.length > 0) {
            for (const t of await this.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.id, ids))) {
                names.set(t.id, t.name);
            }
        }
        result.changes = changes.map((c) => ({ ...c, tenant_name: names.get(c.tenant_id) ?? `Empresa #${c.tenant_id}` }));
        result.errors = [...new Set(result.errors)].slice(0, 20);
        result.ok = result.errors.length === 0;
        result.finished_at = new Date().toISOString();
        return result;
    }
}

function providerName(p: PaymentProvider): string {
    return p === 'mercadopago' ? 'Mercado Pago' : 'PayPal';
}

function money(amount: number, currency: string): string {
    if (!amount) return '';
    const n = new Intl.NumberFormat('es-CO', { maximumFractionDigits: currency === 'COP' ? 0 : 2 }).format(amount);
    return ` (${n} ${currency || ''})`.replace(/ \)$/, ')');
}

/** Lo que cambió, en una línea, para la consola. Puro: se testea. */
export function reconcileChangeText(n: PaymentNotice, plan: Plan | null): string {
    const planText = plan ? ` · plan «${plan}»` : '';
    if (n.kind === 'subscription') {
        switch (n.status) {
            case 'authorized':
                return `Renovación automática activada${planText}${money(n.amount, n.currency)}`;
            case 'paused':
                return `Renovación automática pausada${planText}`;
            case 'cancelled':
                return `Renovación automática cancelada${planText}`;
            default:
                return `Renovación automática esperando que se autorice la tarjeta${planText}`;
        }
    }
    const what =
        n.mode === 'subscription'
            ? 'Cobro de la renovación automática'
            : `Pago de ${n.months} ${n.months === 1 ? 'mes' : 'meses'}${planText}`;
    switch (n.status) {
        case 'approved':
            return `${what} aprobado${money(n.amount, n.currency)}`;
        case 'rejected':
            return `${what} rechazado${money(n.amount, n.currency)}`;
        case 'refunded':
            return `${what} devuelto: se descontó del período pagado${money(n.amount, n.currency)}`;
        default:
            return `${what} pendiente de confirmar${money(n.amount, n.currency)}`;
    }
}
