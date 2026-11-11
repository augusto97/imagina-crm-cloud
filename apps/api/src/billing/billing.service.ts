import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import {
    type BillingStatus,
    type BillingSummary,
    type Plan,
    type SetBillingInput,
    type Usage,
} from '@imagina-base/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { AiQuotaService } from '../ai/ai-quota.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import type { Tx } from '../db/client';
import { attachments, automations, memberships, records, tenants } from '../db/schema';
import { EmailQuotaService } from '../mail/email-quota.service';
import { TenantSmtpService } from '../mail/tenant-smtp.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { PlansService } from './plans.service';
import { accessOf } from './tenant-access';

/** v0.1.338 — de qué plan venía una empresa que pasó a prueba por no renovar. */
export function readLapsedFrom(settings: unknown): { plan: string; at: string } | null {
    const l = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).lapsed : null;
    if (!l || typeof l !== 'object') return null;
    const { from_plan, at } = l as Record<string, unknown>;
    return typeof from_plan === 'string' && typeof at === 'string' ? { plan: from_plan, at } : null;
}

/**
 * Lo que el tope de registros necesita de Redis (un subconjunto de ioredis,
 * para poder probarlo con un doble). Ver `BillingService.farFromRecordLimit`.
 */
export interface RecordCountStore {
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
    set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

/** Cuánto vale el conteo guardado de una empresa. */
export const RECORD_COUNT_TTL_SECONDS = 60;
/** Cuánto se recuerda un lote que está por entrar (import, sincronización). */
export const RECORD_BULK_TTL_SECONDS = 300;
/** Desde cuántas altas un chequeo cuenta como lote. */
const RECORD_BULK_FROM = 50;

/**
 * Margen bajo el tope dentro del cual SIEMPRE se cuenta de verdad y con las
 * altas en fila. Cubre lo que el conteo guardado puede no haber visto: altas
 * de otros servidores que todavía no confirmaron cuando se contó.
 */
export function recordLimitMargin(limit: number): number {
    return Math.max(250, Math.ceil(limit * 0.02));
}

export const recordCountKey = (tenantId: number): string => `planrec:n:${tenantId}`;
export const recordBulkKey = (tenantId: number): string => `planrec:bulk:${tenantId}`;

/**
 * Suma `n` al conteo guardado SÓLO si existe (sin conteo no hay nada que
 * sumar: toca contar) y devuelve conteo + lotes por entrar; -1 si no existe.
 */
const RESERVE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
local b = tonumber(redis.call('GET', KEYS[2]) or '0')
return v + b`;

const BULK_LUA = `
local v = redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return v`;

@Injectable()
export class BillingService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly plans: PlansService,
        private readonly emailQuota: EmailQuotaService,
        private readonly tenantSmtp: TenantSmtpService,
        // v0.1.181 (ADR-S21) — opcionales para que los specs que arman el
        // service a mano sigueran compilando; en la app siempre están.
        @Optional() private readonly aiQuota?: AiQuotaService,
        @Optional() private readonly aiSettings?: AiSettingsService,
        // Conteo de registros por empresa para no contar la tabla en cada alta.
        // Opcional: sin Redis se cuenta siempre, como antes.
        @Optional() @Inject(REDIS) private readonly redis?: RecordCountStore,
    ) {}

    /**
     * ¿La empresa está LEJOS del tope? Lo responde un conteo guardado en Redis
     * (compartido entre servidores, 60 s) al que cada alta le suma lo suyo de
     * forma atómica. Cerca del tope —dentro del margen— devuelve false y quien
     * llama cuenta de verdad. El conteo guardado sólo puede quedarse CORTO por
     * altas que no confirmaron cuando se contó (decenas, el margen las cubre):
     * las bajas lo dejan de más (más conteos exactos, nunca menos) y los lotes
     * se anotan aparte antes de insertarse (`noteBulk`).
     * Sin Redis, o si falla, false: se cuenta.
     */
    private async farFromRecordLimit(tenantId: number, limit: number, additional: number): Promise<boolean> {
        if (!this.redis) return false;
        const margin = recordLimitMargin(limit);
        if (limit <= margin) return false;
        try {
            const v = Number(await this.redis.eval(RESERVE_LUA, 2, recordCountKey(tenantId), recordBulkKey(tenantId), String(additional)));
            return Number.isFinite(v) && v >= 0 && v <= limit - margin;
        } catch {
            return false;
        }
    }

    /** Guarda el conteo exacto recién hecho (más lo que está por entrar). */
    private async rememberRecordCount(tenantId: number, count: number): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.set(recordCountKey(tenantId), String(count), 'EX', RECORD_COUNT_TTL_SECONDS);
        } catch {
            /* sin Redis se cuenta la próxima vez */
        }
    }

    /**
     * Un lote pasó el chequeo y está por insertarse: hasta que entre (y un
     * conteo lo vea) las altas sueltas lo descuentan del lugar disponible.
     */
    private async noteBulk(tenantId: number, additional: number): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.eval(BULK_LUA, 1, recordBulkKey(tenantId), String(additional), String(RECORD_BULK_TTL_SECONDS));
        } catch {
            /* idem */
        }
    }

    async summary(tenantId: number): Promise<BillingSummary> {
        const row = await this.planStatus(tenantId);
        const { plan, status, subscriptionEndsAt, paidUntil, trialEndsAt } = row;
        const [usage, emails, smtp, aiUsed, ownAiKey] = await Promise.all([
            this.tenantDb.withTenant(tenantId, (tx) => this.usage(tx, tenantId)),
            this.emailQuota.usedThisMonth(tenantId),
            // Con SMTP propio los correos salen por el servidor del cliente:
            // no consumen la cuota de la plataforma (ADR-S18).
            this.tenantSmtp.ownMail(tenantId),
            // Ídem con la clave IA propia (ADR-S21).
            this.aiQuota ? this.aiQuota.usedThisMonth(tenantId) : Promise.resolve(0),
            this.aiSettings ? this.aiSettings.tenantHasOwnKey(tenantId) : Promise.resolve(false),
        ]);
        usage.emails_month = emails;
        usage.ai_requests_month = aiUsed;
        const access = accessOf({ ...row, archivedAt: row.archivedAt });
        return {
            own_ai_key: ownAiKey,
            plan,
            status,
            read_only: access.state !== 'full',
            access,
            limits: await this.plans.limits(plan),
            usage,
            own_smtp: smtp,
            paid_until: paidUntil ? paidUntil.toISOString() : null,
            subscription_ends_at: subscriptionEndsAt ? subscriptionEndsAt.toISOString() : null,
            trial_ends_at: plan === 'trial' && trialEndsAt ? trialEndsAt.toISOString() : null,
            disabled_modules: await this.plans.disabledModules(plan),
            lapsed_from: plan === 'trial' ? readLapsedFrom(row.settings) : null,
        };
    }

    /**
     * Verifica que se pueda crear un record más según el plan. Lo llama
     * RecordsService antes de insertar. `null` = ilimitado.
     */
    async assertCanCreateRecord(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countRecords(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Alcanzaste el límite de ${limit} registros del plan ${plan}`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
    }

    /**
     * Tope de registros del plan (null = ilimitado). Se lee FUERA de la
     * transacción de alta — ver `assertRecordRoomInTx`.
     */
    async recordLimit(tenantId: number): Promise<{ limit: number; plan: Plan } | null> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        return limit === null ? null : { limit, plan };
    }

    /**
     * El chequeo del tope DENTRO de la transacción que va a insertar, con las
     * altas de la empresa en fila (lock de transacción por empresa): sin eso,
     * N altas simultáneas con la empresa a uno del tope pasaban todas el conteo
     * (cada una veía el mismo número) y el plan quedaba superado en N-1. El
     * lock se suelta con el commit, así la siguiente ya cuenta la fila nueva.
     * El tope se pide antes con `recordLimit`: leerlo aquí abriría una segunda
     * conexión con ésta ocupada (y con el pool lleno, se trancarían).
     */
    async assertRecordRoomInTx(tx: Tx, tenantId: number, cap: { limit: number; plan: Plan }, additional = 1): Promise<void> {
        // Lejos del tope no hace falta ni la fila ni contar la tabla entera
        // de la empresa en cada alta (era O(registros) con todas las altas de
        // la empresa esperando). Cerca del tope, todo como siempre.
        if (await this.farFromRecordLimit(tenantId, cap.limit, Math.max(1, additional))) return;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`records-limit:${tenantId}`}, 0))`);
        const count = await this.countRecords(tx, tenantId);
        // C6 — una plantilla crea el registro y sus subtareas en una
        // transacción: el lote entero entra o no entra.
        if (count + Math.max(1, additional) > cap.limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message:
                    additional > 1
                        ? `Se superaría el límite de ${cap.limit} registros del plan ${cap.plan} (tienes ${count}, se agregarían ${additional})`
                        : `Alcanzaste el límite de ${cap.limit} registros del plan ${cap.plan}`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
        await this.rememberRecordCount(tenantId, count + Math.max(1, additional));
    }

    /**
     * Igual que `assertCanCreateRecord` pero para un LOTE (SEC-09): verifica que
     * crear `additional` registros no supere el tope del plan. El import antes
     * solo comprobaba que "cabía uno más" y luego insertaba hasta 10 000 →
     * bypass del límite. Un solo conteo cubre todo el lote.
     */
    /** v0.1.339 — Registros que todavía entran en el plan (`null` = sin límite). */
    async recordsRemaining(tenantId: number): Promise<number | null> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        if (limit === null) return null;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countRecords(tx, tenantId));
        return Math.max(0, limit - count);
    }

    async assertCanCreateRecords(tenantId: number, additional: number): Promise<void> {
        if (additional <= 0) return;
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_records;
        if (limit === null) return;
        const bulk = additional >= RECORD_BULK_FROM;
        if (!bulk && (await this.farFromRecordLimit(tenantId, limit, additional))) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countRecords(tx, tenantId));
        if (count + additional > limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Se superaría el límite de ${limit} registros del plan ${plan} (tienes ${count}, se agregarían ${additional})`,
                data: { status: 403, errors: { plan: 'límite de registros' } },
            });
        }
        if (bulk) await this.noteBulk(tenantId, additional);
        else await this.rememberRecordCount(tenantId, count + additional);
    }

    /**
     * v0.1.240 — Límite de USUARIOS del plan (`max_users`), al sumar a alguien
     * al equipo. Existía en la tabla de planes desde F4 pero nada lo aplicaba.
     * Cuentan las personas del EQUIPO: los clientes del portal (rol `client`)
     * no ocupan lugar — un CRM puede tener cientos sin que eso sea su equipo.
     */
    async assertCanAddMember(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_users;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countStaff(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Alcanzaste el límite de ${limit} usuarios del plan ${plan}. Quita a alguien o pasa a un plan mayor.`,
                data: { status: 403, errors: { plan: 'límite de usuarios' } },
            });
        }
    }

    /**
     * Límite de AUTOMATIZACIONES del plan (`max_automations`): existía en la
     * tabla de planes y nada lo aplicaba (Ajustes mostraba 12/3 y se podían
     * seguir creando). Cuenta las ACTIVAS — una pausada no corre — y lo
     * llaman crear (activa) y activar. Las que ya estaban por encima del
     * límite siguen corriendo: no se apaga nada que funcione.
     */
    async assertCanActivateAutomation(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_automations;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countActiveAutomations(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Tu plan ${plan} permite ${limit} automatizaciones activas y ya tienes ${count}. Pausa otra, guárdala pausada o pasa a un plan mayor.`,
                data: { status: 403, errors: { plan: 'límite de automatizaciones' } },
            });
        }
    }

    private async countActiveAutomations(tx: Tx, tenantId: number): Promise<number> {
        const [a] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(automations)
            .where(and(eq(automations.tenantId, tenantId), eq(automations.isActive, true)));
        return a?.n ?? 0;
    }

    /** Usuarios del plan: el equipo de trabajo (ni clientes del portal ni invitados — C3). */
    private async countStaff(tx: Tx, tenantId: number): Promise<number> {
        const [u] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), ne(memberships.role, 'client'), ne(memberships.role, 'guest')));
        return u?.n ?? 0;
    }

    /** C3 — invitados externos de la empresa. */
    private async countGuests(tx: Tx, tenantId: number): Promise<number> {
        const [u] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(memberships)
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'guest')));
        return u?.n ?? 0;
    }

    /**
     * C3 — Tope de INVITADOS del plan (`max_guests`), al invitar a alguien de
     * afuera. No cuentan como usuarios: tienen su propio tope.
     */
    async assertCanAddGuest(tenantId: number): Promise<void> {
        const { plan } = await this.planStatus(tenantId);
        const limit = (await this.plans.limits(plan)).max_guests;
        if (limit === null) return;
        const count = await this.tenantDb.withTenant(tenantId, (tx) => this.countGuests(tx, tenantId));
        if (count >= limit) {
            throw new ForbiddenException({
                code: 'plan_limit_reached',
                message: `Alcanzaste el límite de ${limit} invitados del plan ${plan}. Quita a alguien o pasa a un plan mayor.`,
                data: { status: 403, errors: { limit: 'max_guests' } },
            });
        }
    }

    /** Stand-in del webhook de Stripe: setea plan/estado del workspace. */
    async setBilling(tenantId: number, input: SetBillingInput): Promise<BillingSummary> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(tenants)
                .set({
                    ...(input.plan ? { plan: input.plan } : {}),
                    ...(input.status ? { status: input.status } : {}),
                    updatedAt: sql`now()`,
                })
                .where(eq(tenants.id, tenantId)),
        );
        return this.summary(tenantId);
    }

    private async planStatus(
        tenantId: number,
    ): Promise<{
        plan: Plan;
        status: BillingStatus;
        archivedAt: Date | null;
        subscriptionEndsAt: Date | null;
        paidUntil: Date | null;
        trialEndsAt: Date | null;
        settings: unknown;
    }> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [t] = await tx
                .select({
                    plan: tenants.plan,
                    status: tenants.status,
                    archivedAt: tenants.archivedAt,
                    subscriptionEndsAt: tenants.subscriptionEndsAt,
                    paidUntil: tenants.paidUntil,
                    trialEndsAt: tenants.trialEndsAt,
                    settings: tenants.settings,
                })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .limit(1);
            return t;
        });
        return {
            plan: (row?.plan ?? 'trial') as Plan,
            status: (row?.status ?? 'trialing') as BillingStatus,
            archivedAt: row?.archivedAt ?? null,
            subscriptionEndsAt: row?.subscriptionEndsAt ?? null,
            paidUntil: row?.paidUntil ?? null,
            trialEndsAt: row?.trialEndsAt ?? null,
            settings: row?.settings ?? {},
        };
    }

    private async usage(tx: Tx, tenantId: number): Promise<Usage> {
        const recordCount = await this.countRecords(tx, tenantId);
        const staff = await this.countStaff(tx, tenantId);
        const guests = await this.countGuests(tx, tenantId);
        // Cuentan las ACTIVAS: es lo que limita el plan (una pausada no corre).
        const a = { n: await this.countActiveAutomations(tx, tenantId) };
        // v0.1.268 (ADR-S36) — sólo lo guardado en el servidor de la
        // plataforma: lo del almacenamiento propio de la empresa no cuenta.
        const [st] = await tx
            .select({ n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` })
            .from(attachments)
            .where(
                and(
                    eq(attachments.tenantId, tenantId),
                    isNull(attachments.storageConnectionId),
                    // Lo subido a un formulario que todavía no se envió no cuenta.
                    isNull(attachments.pendingFormId),
                ),
            );
        return {
            records: recordCount,
            users: staff,
            automations: a?.n ?? 0,
            storage_bytes: Number(st?.n ?? 0),
            // Lo completa `summary` (vive fuera del scope del tenant: el
            // contador lo escribe el worker de correo por la conexión base).
            emails_month: 0,
            ai_requests_month: 0,
            guests,
        };
    }

    /**
     * Cuota de storage del plan (ADR-S16): rechaza el upload si el uso actual
     * más el archivo nuevo supera `max_storage_mb`. NULL = ilimitado.
     */
    async assertCanUpload(tenantId: number, incomingBytes: number): Promise<void> {
        const room = await this.storageRoomBytes(tenantId);
        if (room === null) return;
        if (incomingBytes > room) {
            const { plan } = await this.planStatus(tenantId);
            const limits = await this.plans.limits(plan);
            throw new ForbiddenException({
                code: 'storage_limit_reached',
                message: `Alcanzaste el límite de almacenamiento de tu plan (${limits.max_storage_mb} MB)`,
                data: { status: 403 },
            });
        }
    }

    /** Límite de almacenamiento del plan en MB (null = ilimitado). */
    async storageLimitMb(tenantId: number): Promise<number | null> {
        const { plan } = await this.planStatus(tenantId);
        return (await this.plans.limits(plan)).max_storage_mb;
    }

    /**
     * Bytes que todavía entran en el servidor de la plataforma según el plan
     * (null = ilimitado; puede ser negativo si ya se pasó). Sólo cuenta lo
     * guardado en la plataforma (ADR-S36).
     */
    async storageRoomBytes(tenantId: number): Promise<number | null> {
        const limit = await this.storageLimitMb(tenantId);
        if (limit === null) return null;
        const used = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [st] = await tx
                .select({ n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::bigint` })
                .from(attachments)
                .where(
                and(
                    eq(attachments.tenantId, tenantId),
                    isNull(attachments.storageConnectionId),
                    // Lo subido a un formulario que todavía no se envió no cuenta.
                    isNull(attachments.pendingFormId),
                ),
            );
            return Number(st?.n ?? 0);
        });
        return limit * 1024 * 1024 - used;
    }

    private async countRecords(tx: Tx, tenantId: number): Promise<number> {
        const [r] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(records)
            .where(and(eq(records.tenantId, tenantId), isNull(records.deletedAt)));
        return r?.n ?? 0;
    }
}
