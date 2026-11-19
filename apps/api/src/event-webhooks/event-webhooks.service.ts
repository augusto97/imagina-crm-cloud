import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional, type OnModuleInit } from '@nestjs/common';
import {
    MAX_WEBHOOK_SUBSCRIPTIONS,
    WEBHOOK_DISABLE_AFTER_FAILURES,
    WEBHOOK_EVENTS,
    effectiveCapabilities,
    readDisabledModules,
    webhookRetryDelay,
    webhookShouldRetry,
    type CreateWebhookSubscriptionInput,
    type CreatedWebhookSubscriptionDto,
    type RecordDto,
    type Role,
    type UpdateWebhookSubscriptionInput,
    type WebhookDeliveryDto,
    type WebhookDeliveryStatus,
    type WebhookEvent,
    type WebhookSubscriptionDto,
    type WebhookTestResultDto,
} from '@imagina-base/shared';
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { accessOf, agencyAccessSql } from '../billing/tenant-access';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { bareHost, devPrivateEgressAllowed, resolvePublicHost, safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { customRoles, lists, memberships, plans, tenants, users, webhookDeliveries, webhookSubscriptions } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { aclExtras, effectivePermissions, hiddenFieldsFor, listRowInScope, type AclExtras, type AclSubject } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { REDIS } from '../redis/redis.module';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { EventWebhookHub, type OutgoingEvent } from './event-hub';

/**
 * v0.1.442 (G1, addendum de ADR-S105) — Webhooks de eventos: la app le AVISA
 * a otro programa cuando pasa algo, con un POST firmado.
 *
 * Cómo viaja un aviso:
 *  1. El hub avisa (alta, cambio, borrado, formulario, pago). Las
 *     suscripciones activas de la empresa salen de un caché en Redis (casi
 *     siempre no hay ninguna: el camino de una escritura no paga nada más).
 *  2. Se guarda UNA entrega por suscripción en `webhook_deliveries` (Postgres:
 *     sobrevive a un reinicio) y se despierta la cola.
 *  3. El tic toma lo vencido con `FOR UPDATE SKIP LOCKED` y un PLAZO de dos
 *     minutos (si el proceso se cae a mitad, otro lo vuelve a tomar: la
 *     entrega es «al menos una vez» — el `id` del evento sirve para no
 *     procesarlo dos veces del otro lado).
 *  4. En el primer intento se arma el contenido con el acceso VIGENTE de quien
 *     creó la suscripción: sólo lo que esa persona ve (lista, alcance del
 *     registro, campos ocultos). Los reintentos mandan lo mismo.
 *  5. Firma `t=<segundos>,v1=<HMAC-SHA256(secreto, "t.cuerpo")>` y POST por el
 *     guard anti-SSRF. 2xx = entregado. Red caída, 408, 429 y 5xx se
 *     reintentan (1 min, 5 min, 30 min, 2 h, 6 h, 12 h). Un 410 apaga la
 *     suscripción (así se desuscriben n8n y Zapier). 20 intentos fallidos
 *     seguidos la pausan y abren un Problema; una entrega buena lo cierra.
 */

const DUE_BATCH = 50;
const SEND_CONCURRENCY = 8;
const LEASE_MS = 2 * 60_000;
const SEND_TIMEOUT_MS = 10_000;
const KEEP_BODY_CHARS = 2000;
const CACHE_TTL_S = 600;
const cacheKey = (tenantId: number) => `whsubs:v1:${tenantId}`;

interface ActiveSub {
    id: number;
    events: string[];
    listIds: number[] | null;
}

interface CreatorActor extends AclSubject {
    name: string;
}

type SubRow = typeof webhookSubscriptions.$inferSelect;
type DeliveryRow = typeof webhookDeliveries.$inferSelect;

/** Quién pide en la API de la app (Ajustes → API o un programa con un token). */
/** Quien pide, con su rol y lo que resolvió el TenantGuard (`...aclOf(req)`). */
export interface WebhookRequester extends AclExtras {
    tenantId: number;
    userId: number;
    role: Role;
    /** `api` si el pedido llegó con un token de la API (n8n registra su webhook). */
    via: 'app' | 'api';
}

function newSecret(): string {
    return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** La firma que manda cada entrega (y que verifica el otro sistema). */
export function signWebhookBody(secret: string, timestamp: number, body: string): string {
    const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    return `t=${timestamp},v1=${v1}`;
}

function iso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

function isAdmin(r: { role: Role }): boolean {
    return r.role === 'admin';
}

@Injectable()
export class EventWebhooksService implements OnModuleInit {
    private readonly logger = new Logger(EventWebhooksService.name);
    private kicker: (() => void) | null = null;

    constructor(
        @Inject(ENV) private readonly env: Env,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly hub: EventWebhookHub,
        private readonly listsService: ListsService,
        private readonly fields: FieldsService,
        private readonly records: RecordsService,
        private readonly audit: AuditService,
        private readonly incidents: IncidentHub,
        @Optional() @Inject(REDIS) private readonly redis?: Redis,
    ) {}

    onModuleInit(): void {
        this.hub.subscribe((e) => this.onEvent(e));
    }

    /** La cola registra cómo despertarse (sin cola, las entregas salen en el tic del proceso que la tenga). */
    setKicker(fn: (() => void) | null): void {
        this.kicker = fn;
    }

    // ─────────────────────────── 1. Del evento a las entregas ───────────────────────────

    async onEvent(e: OutgoingEvent): Promise<void> {
        const subs = await this.activeSubs(e.tenantId);
        if (subs.length === 0) return;
        const targets = subs.filter((s) => s.events.includes(e.event) && (s.listIds === null || s.listIds.includes(e.listId)));
        if (targets.length === 0) return;
        const context: Record<string, unknown> = {};
        if (e.before) context.before = e.before;
        if (e.after) context.after = e.after;
        if (e.form) context.form = e.form;
        if (e.payment) context.payment = e.payment;
        if (e.signature) context.signature = e.signature;
        if (e.row) context.row = e.row;
        const eventId = `evt_${randomUUID().replace(/-/g, '')}`;
        const now = new Date();
        await this.tenantDb.withTenant(e.tenantId, (tx) =>
            tx.insert(webhookDeliveries).values(
                targets.map((s) => ({
                    tenantId: e.tenantId,
                    subscriptionId: s.id,
                    eventId,
                    event: e.event,
                    listId: e.listId,
                    recordId: e.recordId,
                    context,
                    status: 'pending',
                    nextAttemptAt: now,
                })),
            ),
        );
        this.kicker?.();
    }

    /** Las suscripciones activas de la empresa (caché en Redis, se borra al cambiar una). */
    async activeSubs(tenantId: number): Promise<ActiveSub[]> {
        if (this.redis) {
            try {
                const hit = await this.redis.get(cacheKey(tenantId));
                if (hit !== null) return JSON.parse(hit) as ActiveSub[];
            } catch {
                // sin Redis se lee de la base
            }
        }
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: webhookSubscriptions.id, events: webhookSubscriptions.events, listIds: webhookSubscriptions.listIds })
                .from(webhookSubscriptions)
                .where(and(eq(webhookSubscriptions.tenantId, tenantId), eq(webhookSubscriptions.active, true))),
        );
        const subs: ActiveSub[] = rows.map((r) => ({ id: r.id, events: r.events, listIds: r.listIds && r.listIds.length > 0 ? r.listIds.map(Number) : null }));
        if (this.redis) {
            try {
                await this.redis.set(cacheKey(tenantId), JSON.stringify(subs), 'EX', CACHE_TTL_S);
            } catch {
                // best-effort
            }
        }
        return subs;
    }

    private async invalidate(tenantId: number): Promise<void> {
        if (!this.redis) return;
        try {
            await this.redis.del(cacheKey(tenantId));
        } catch {
            // vence solo en 10 minutos
        }
    }

    // ─────────────────────────── 2. Entregar ───────────────────────────

    /** El tic: toma lo vencido y lo manda. Devuelve cuántas entregas procesó. */
    async drain(maxRounds = 10): Promise<number> {
        let total = 0;
        for (let round = 0; round < maxRounds; round++) {
            const due = await this.claimDue();
            if (due.length === 0) break;
            total += due.length;
            for (let i = 0; i < due.length; i += SEND_CONCURRENCY) {
                await Promise.all(due.slice(i, i + SEND_CONCURRENCY).map((d) => this.deliver(d).catch((err) => this.logger.error(`Webhook (entrega #${d.id}): ${String(err)}`))));
            }
            if (due.length < DUE_BATCH) break;
        }
        return total;
    }

    /** Toma las entregas vencidas con un plazo (otro proceso no las toma mientras tanto). */
    private async claimDue(): Promise<DeliveryRow[]> {
        const rows = await this.db.execute(sql`
            UPDATE webhook_deliveries SET next_attempt_at = now() + ${`${LEASE_MS / 1000} seconds`}::interval, attempts = attempts + 1
            WHERE id IN (
                SELECT id FROM webhook_deliveries
                WHERE status = 'pending' AND next_attempt_at <= now()
                ORDER BY next_attempt_at
                LIMIT ${DUE_BATCH}
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id`);
        const ids = (rows.rows as Array<{ id: string | number }>).map((r) => Number(r.id));
        if (ids.length === 0) return [];
        return this.db.select().from(webhookDeliveries).where(inArray(webhookDeliveries.id, ids));
    }

    private async deliver(d: DeliveryRow): Promise<void> {
        const [sub] = await this.db.select().from(webhookSubscriptions).where(eq(webhookSubscriptions.id, d.subscriptionId)).limit(1);
        if (!sub) return; // se borró: la entrega se fue en cascada
        if (!sub.active) {
            await this.finish(d.id, 'skipped', { error: 'La suscripción está pausada.' });
            return;
        }
        let payload = d.payload;
        if (!payload) {
            const built = await this.buildPayload(sub, d);
            if (built.kind === 'skip') {
                await this.finish(d.id, 'skipped', { error: built.reason });
                return;
            }
            if (built.kind === 'disable') {
                await this.finish(d.id, 'skipped', { error: built.reason });
                await this.disable(sub, built.reason);
                return;
            }
            payload = built.payload;
            // Lo armado queda para los reintentos; el contexto ya no hace falta.
            await this.db.update(webhookDeliveries).set({ payload, context: {} }).where(eq(webhookDeliveries.id, d.id));
        }
        const result = await this.send(sub, d.eventId, d.event, payload, d.attempts);
        await this.settle(sub, d, result);
    }

    /** El POST firmado. Nunca lanza: una falla de red vuelve como `status: null`. */
    private async send(sub: SubRow, eventId: string, event: string, payload: Record<string, unknown>, attempt: number): Promise<WebhookTestResultDto> {
        const started = Date.now();
        let secret: string;
        try {
            secret = decryptSecret(sub.secretEnc, this.env.SECRETS_KEY);
        } catch {
            return { ok: false, status: null, body: null, error: 'El secreto de firma no se puede leer (cambió la clave del servidor). Genera uno nuevo.', duration_ms: 0 };
        }
        const body = JSON.stringify(payload);
        const t = Math.floor(Date.now() / 1000);
        try {
            const res = await safeWebhookFetch(sub.url, {
                method: 'POST',
                body,
                timeoutMs: SEND_TIMEOUT_MS,
                captureBody: true,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'webhook-delivery/1.0',
                    'X-Webhook-Id': eventId,
                    'X-Webhook-Event': event,
                    'X-Webhook-Attempt': String(Math.max(1, attempt)),
                    'X-Webhook-Signature': signWebhookBody(secret, t, body),
                },
            });
            const ok = res.status >= 200 && res.status < 300;
            return { ok, status: res.status, body: (res.body ?? '').slice(0, KEEP_BODY_CHARS) || null, error: ok ? null : `Respondió ${res.status}.`, duration_ms: Date.now() - started };
        } catch (err) {
            return { ok: false, status: null, body: null, error: networkError(err), duration_ms: Date.now() - started };
        }
    }

    private async settle(sub: SubRow, d: DeliveryRow, r: WebhookTestResultDto): Promise<void> {
        const now = new Date();
        const keep = { responseStatus: r.status, responseBody: r.body, error: r.error };
        if (r.ok) {
            await this.finish(d.id, 'success', keep);
            await this.db
                .update(webhookSubscriptions)
                .set({ consecutiveFailures: 0, lastDeliveryAt: now, lastStatus: 'success' })
                .where(eq(webhookSubscriptions.id, sub.id));
            if (sub.consecutiveFailures > 0) this.incidents.resolve(sub.tenantId, `webhook:${sub.id}`);
            return;
        }
        // Sumado en SQL: dos entregas de la misma suscripción a la vez no se pisan la cuenta.
        const [counted] = await this.db
            .update(webhookSubscriptions)
            .set({ consecutiveFailures: sql`${webhookSubscriptions.consecutiveFailures} + 1`, lastDeliveryAt: now, lastStatus: 'failed' })
            .where(eq(webhookSubscriptions.id, sub.id))
            .returning({ failures: webhookSubscriptions.consecutiveFailures });
        const failures = counted?.failures ?? sub.consecutiveFailures + 1;
        if (r.status === 410) {
            await this.finish(d.id, 'failed', keep);
            await this.disable(sub, 'La dirección respondió 410: el otro sistema pidió dejar de recibir avisos.');
            return;
        }
        const delay = webhookShouldRetry(r.status) ? webhookRetryDelay(d.attempts) : null;
        if (delay !== null && failures < WEBHOOK_DISABLE_AFTER_FAILURES) {
            await this.db
                .update(webhookDeliveries)
                .set({ ...keep, status: 'pending', nextAttemptAt: new Date(now.getTime() + delay * 1000) })
                .where(eq(webhookDeliveries.id, d.id));
            return;
        }
        await this.finish(d.id, 'failed', keep);
        if (failures >= WEBHOOK_DISABLE_AFTER_FAILURES) {
            await this.disable(sub, `Se pausó después de ${failures} intentos fallidos seguidos. Revisa la dirección y vuelve a encenderla.`);
            return;
        }
        this.incidents.report({
            tenantId: sub.tenantId,
            key: `webhook:${sub.id}`,
            source: 'webhook',
            sourceId: sub.id,
            ownerId: sub.createdBy,
            title: `El webhook «${sub.name}» no pudo entregar un aviso`,
            message: `${r.error ?? 'Falló.'} Se intentó ${d.attempts} ${d.attempts === 1 ? 'vez' : 'veces'}.`,
        });
    }

    private async finish(id: number, status: WebhookDeliveryStatus, extra: { responseStatus?: number | null; responseBody?: string | null; error?: string | null }): Promise<void> {
        await this.db
            .update(webhookDeliveries)
            .set({ ...extra, status, nextAttemptAt: null, deliveredAt: status === 'success' ? new Date() : null })
            .where(eq(webhookDeliveries.id, id));
    }

    private async disable(sub: SubRow, reason: string): Promise<void> {
        await this.db
            .update(webhookSubscriptions)
            .set({ active: false, disabledReason: reason, updatedAt: new Date() })
            .where(eq(webhookSubscriptions.id, sub.id));
        await this.invalidate(sub.tenantId);
        // Lo que quedaba en espera para esta suscripción no sale.
        await this.db
            .update(webhookDeliveries)
            .set({ status: 'skipped', nextAttemptAt: null, error: 'La suscripción se pausó.' })
            .where(and(eq(webhookDeliveries.subscriptionId, sub.id), eq(webhookDeliveries.status, 'pending')));
        this.incidents.report({
            tenantId: sub.tenantId,
            key: `webhook:${sub.id}`,
            source: 'webhook',
            sourceId: sub.id,
            ownerId: sub.createdBy,
            title: `El webhook «${sub.name}» se pausó`,
            message: reason,
        });
    }

    // ─────────────────────────── 3. El contenido ───────────────────────────

    /** Quien creó la suscripción, leído en vivo (rol, rol propio, equipos, plan). */
    private async creator(tenantId: number, userId: number): Promise<{ actor: CreatorActor | null; reason: string | null; locked: boolean }> {
        const [row] = await this.db
            .select({
                role: memberships.role,
                name: users.name,
                disabledAt: users.disabledAt,
                customRoleId: memberships.customRoleId,
                customCaps: customRoles.capabilities,
                teamIds: sql<string[] | null>`(SELECT array_agg(tm.team_id) FROM team_members tm WHERE tm.user_id = ${memberships.userId} AND tm.tenant_id = ${memberships.tenantId})`,
                disabledModules: plans.disabledModules,
                plan: tenants.plan,
                status: tenants.status,
                archivedAt: tenants.archivedAt,
                trialEndsAt: tenants.trialEndsAt,
                subscriptionEndsAt: tenants.subscriptionEndsAt,
                paidUntil: tenants.paidUntil,
                agencyPausedAt: tenants.agencyPausedAt,
                agency: agencyAccessSql,
            })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
            .leftJoin(plans, eq(plans.slug, tenants.plan))
            .leftJoin(customRoles, and(eq(customRoles.id, memberships.customRoleId), eq(customRoles.tenantId, memberships.tenantId)))
            .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
            .limit(1);
        const gone = 'Quien creó la suscripción ya no es del equipo de la empresa (o su cuenta está desactivada).';
        if (!row || row.disabledAt || row.role === 'client' || row.role === 'guest') return { actor: null, reason: gone, locked: false };
        const access = accessOf({ plan: row.plan, status: row.status, archivedAt: row.archivedAt, trialEndsAt: row.trialEndsAt, subscriptionEndsAt: row.subscriptionEndsAt, paidUntil: row.paidUntil, agencyPausedAt: row.agencyPausedAt, agency: row.agency });
        if (access.state === 'locked') return { actor: null, reason: 'La cuenta de la empresa está pausada.', locked: true };
        const disabled = readDisabledModules(row.disabledModules ?? []);
        if (disabled.includes('api')) return { actor: null, reason: 'El plan de la empresa ya no incluye la API.', locked: true };
        const custom = Array.isArray(row.customCaps) && !disabled.includes('custom_roles') ? (row.customCaps as string[]) : null;
        const capabilities = effectiveCapabilities(row.role as Role, custom);
        if (!capabilities.includes('use_api')) return { actor: null, reason: 'Quien creó la suscripción ya no tiene permiso para usar la API.', locked: false };
        return {
            actor: {
                userId,
                role: row.role as Role,
                name: row.name,
                teamIds: (row.teamIds ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
                customRoleId: custom ? row.customRoleId : null,
                capabilities,
            },
            reason: null,
            locked: false,
        };
    }

    private async buildPayload(
        sub: SubRow,
        d: DeliveryRow,
    ): Promise<{ kind: 'ok'; payload: Record<string, unknown> } | { kind: 'skip'; reason: string } | { kind: 'disable'; reason: string }> {
        const who = await this.creator(sub.tenantId, sub.createdBy);
        if (!who.actor) return who.locked ? { kind: 'skip', reason: who.reason ?? 'No se pudo armar.' } : { kind: 'disable', reason: who.reason ?? 'Sin acceso.' };
        const actor = who.actor;
        const [tenant] = await this.db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(eq(tenants.id, sub.tenantId)).limit(1);
        let list;
        try {
            list = await this.listsService.get(sub.tenantId, String(d.listId));
        } catch {
            return { kind: 'skip', reason: 'La lista ya no existe (o está en la papelera).' };
        }
        if (effectivePermissions(list.settings, actor).view === 'none') {
            return { kind: 'skip', reason: 'Quien creó la suscripción no puede ver esa lista.' };
        }
        const base: Record<string, unknown> = {
            id: d.eventId,
            event: d.event,
            created_at: d.createdAt.toISOString(),
            tenant: { id: tenant?.id ?? sub.tenantId, slug: tenant?.slug ?? null },
            list: { id: list.id, slug: list.slug, name: list.name },
        };
        const ctx = (d.context ?? {}) as {
            before?: Record<string, unknown>;
            after?: Record<string, unknown>;
            form?: Record<string, unknown>;
            payment?: Record<string, unknown>;
            signature?: Record<string, unknown>;
            row?: { createdBy: number; data: Record<string, unknown> };
        };
        if (d.event === 'record.deleted') {
            if (ctx.row && !listRowInScope(list.settings, actor, 'view', { id: d.recordId ?? undefined, createdBy: ctx.row.createdBy, data: ctx.row.data })) {
                return { kind: 'skip', reason: 'Quien creó la suscripción no alcanzaba ese registro.' };
            }
            return { kind: 'ok', payload: { ...base, record: { id: d.recordId, list_id: list.id, deleted: true } } };
        }
        let record: RecordDto;
        try {
            record = await this.records.get(sub.tenantId, actor, String(list.id), Number(d.recordId));
        } catch {
            return { kind: 'skip', reason: 'El registro ya no existe o quien creó la suscripción no lo alcanza.' };
        }
        const fieldRows = await this.fields.listByListId(sub.tenantId, list.id);
        const hidden = hiddenFieldsFor(list.settings, actor);
        const visible = fieldRows.filter((f) => !hidden.has(f.slug));
        const meta: Record<string, { id: number; slug: string; label: string; type: string }> = {};
        const values: Record<string, unknown> = {};
        const data = (record.data ?? {}) as Record<string, unknown>;
        for (const f of visible) {
            const key = `f${f.id}`;
            meta[key] = { id: f.id, slug: f.slug, label: f.label, type: f.type };
            if (key in data) values[f.slug] = data[key];
        }
        const payload: Record<string, unknown> = { ...base, record, values, fields: meta };
        if (d.event === 'record.updated' && ctx.before && ctx.after) {
            const changes: Array<{ field: string; slug: string; label: string; before: unknown; after: unknown }> = [];
            for (const f of visible) {
                const key = `f${f.id}`;
                const a = ctx.before[key];
                const b = ctx.after[key];
                if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
                changes.push({ field: key, slug: f.slug, label: f.label, before: a ?? null, after: b ?? null });
            }
            payload.changes = changes;
        }
        if (d.event === 'form.submitted' && ctx.form) {
            const f = ctx.form as { id?: number; name?: string; title?: string; origin?: Record<string, string> };
            payload.form = { id: f.id ?? null, name: f.name ?? null, title: f.title ?? null, origin: f.origin ?? {} };
        }
        if (d.event === 'payment.received' && ctx.payment) {
            const p = ctx.payment as Record<string, unknown>;
            payload.payment = {
                amount: p.monto ?? null,
                currency: p.moneda ?? null,
                paid_amount: p.monto_pagado ?? null,
                status: p.estado ?? null,
                method: p.metodo ?? null,
                paid_at: p.fecha ?? null,
                concept: p.concepto ?? null,
                provider: p.proveedor ?? null,
                payment_id: p.id ?? null,
                link: p.link ?? null,
            };
        }
        if (d.event.startsWith('signature.') && ctx.signature) payload.signature = ctx.signature;
        return { kind: 'ok', payload };
    }

    // ─────────────────────────── 4. Administrar ───────────────────────────

    private assertCanManage(r: WebhookRequester): void {
        if (!isAdmin(r) && !(r.capabilities ?? []).includes('use_api')) {
            throw new ForbiddenException({ code: 'webhooks_forbidden', message: 'Para crear webhooks necesitas el permiso «Usar la API».', data: { status: 403 } });
        }
    }

    /** Admin ve todas; el resto, las suyas. */
    private ownerScope(r: WebhookRequester) {
        return isAdmin(r) ? undefined : eq(webhookSubscriptions.createdBy, r.userId);
    }

    private async validateUrl(raw: string): Promise<string> {
        let url: URL;
        try {
            url = new URL(raw.trim());
        } catch {
            throw this.bad('webhook_url', 'Escribe una dirección completa, que empiece con https://');
        }
        if (url.protocol !== 'https:' && !(devPrivateEgressAllowed() && url.protocol === 'http:')) throw this.bad('webhook_url', 'La dirección tiene que empezar con https://');
        if (url.username || url.password) throw this.bad('webhook_url', 'Quita el usuario y la contraseña de la dirección: la firma ya protege el aviso.');
        const host = await resolvePublicHost(bareHost(url.hostname));
        if (!host.ok) {
            throw this.bad('webhook_url', host.reason === 'dns' ? `No se encontró «${url.hostname}». Revisa la dirección.` : 'Esa dirección es de una red interna: los avisos sólo van a direcciones públicas.');
        }
        return url.toString();
    }

    private bad(code: string, message: string): BadRequestException {
        return new BadRequestException({ code, message, data: { status: 400 } });
    }

    private async validateLists(r: WebhookRequester, ids: number[] | null | undefined): Promise<number[] | null> {
        if (!ids || ids.length === 0) return null;
        const unique = [...new Set(ids)];
        const rows = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx.select({ id: lists.id, settings: lists.settings }).from(lists).where(and(eq(lists.tenantId, r.tenantId), inArray(lists.id, unique), isNull(lists.deletedAt))),
        );
        if (rows.length !== unique.length) throw this.bad('webhook_lists', 'Alguna de las listas elegidas no existe.');
        const subject: AclSubject = { userId: r.userId, role: r.role, ...aclExtras(r) };
        for (const l of rows) {
            if (effectivePermissions((l.settings ?? {}) as Record<string, unknown>, subject).view === 'none') {
                throw this.bad('webhook_lists', 'No puedes ver alguna de las listas elegidas.');
            }
        }
        return unique;
    }

    async list(r: WebhookRequester): Promise<WebhookSubscriptionDto[]> {
        this.assertCanManage(r);
        const rows = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx
                .select({ s: webhookSubscriptions, creatorName: users.name })
                .from(webhookSubscriptions)
                .leftJoin(users, eq(users.id, webhookSubscriptions.createdBy))
                .where(and(eq(webhookSubscriptions.tenantId, r.tenantId), this.ownerScope(r)))
                .orderBy(desc(webhookSubscriptions.id)),
        );
        return rows.map((x) => toDto(x.s, x.creatorName));
    }

    async create(r: WebhookRequester, input: CreateWebhookSubscriptionInput): Promise<CreatedWebhookSubscriptionDto> {
        this.assertCanManage(r);
        const url = await this.validateUrl(input.url);
        const listIds = await this.validateLists(r, input.list_ids);
        const events = [...new Set(input.events)].filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
        const secret = newSecret();
        const name = (input.name ?? '').trim() || defaultName(url);
        const row = await this.tenantDb.withTenant(r.tenantId, async (tx) => {
            const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(webhookSubscriptions).where(eq(webhookSubscriptions.tenantId, r.tenantId))) as [{ n: number }];
            if (n >= MAX_WEBHOOK_SUBSCRIPTIONS) {
                throw this.bad('webhook_limit', `La empresa ya tiene ${MAX_WEBHOOK_SUBSCRIPTIONS} webhooks. Borra alguno que ya no uses.`);
            }
            const [created] = await tx
                .insert(webhookSubscriptions)
                .values({
                    tenantId: r.tenantId,
                    name,
                    url,
                    events,
                    listIds,
                    secretEnc: encryptSecret(secret, this.env.SECRETS_KEY),
                    secretHint: secret.slice(-4),
                    createdBy: r.userId,
                    source: r.via,
                })
                .returning();
            return created!;
        });
        await this.invalidate(r.tenantId);
        await this.audit.log({ tenantId: r.tenantId, userId: r.userId, action: 'webhook.create', targetType: 'webhook', targetId: row.id, targetLabel: name, meta: { events, url_host: new URL(url).host, via: r.via } });
        const [creatorName] = await this.creatorName(r.tenantId, r.userId);
        return { ...toDto(row, creatorName ?? null), secret };
    }

    private async creatorName(tenantId: number, userId: number): Promise<Array<string | null>> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1));
        return rows.map((x) => x.name);
    }

    private async own(r: WebhookRequester, id: number): Promise<SubRow> {
        const [row] = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx
                .select()
                .from(webhookSubscriptions)
                .where(and(eq(webhookSubscriptions.tenantId, r.tenantId), eq(webhookSubscriptions.id, id), this.ownerScope(r)))
                .limit(1),
        );
        if (!row) throw new NotFoundException({ code: 'webhook_not_found', message: 'Ese webhook no existe.', data: { status: 404 } });
        return row;
    }

    async get(r: WebhookRequester, id: number): Promise<WebhookSubscriptionDto> {
        this.assertCanManage(r);
        const row = await this.own(r, id);
        const [name] = await this.creatorName(r.tenantId, row.createdBy);
        return toDto(row, name ?? null);
    }

    async update(r: WebhookRequester, id: number, input: UpdateWebhookSubscriptionInput): Promise<WebhookSubscriptionDto> {
        this.assertCanManage(r);
        const current = await this.own(r, id);
        const patch: Partial<typeof webhookSubscriptions.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.url !== undefined) patch.url = await this.validateUrl(input.url);
        if (input.events !== undefined) patch.events = [...new Set(input.events)];
        if (input.list_ids !== undefined) patch.listIds = await this.validateLists(r, input.list_ids);
        if (input.active !== undefined) {
            patch.active = input.active;
            if (input.active) {
                patch.disabledReason = null;
                patch.consecutiveFailures = 0;
            } else {
                patch.disabledReason = null;
            }
        }
        const [row] = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx.update(webhookSubscriptions).set(patch).where(and(eq(webhookSubscriptions.tenantId, r.tenantId), eq(webhookSubscriptions.id, current.id))).returning(),
        );
        if (input.active === false) {
            await this.db
                .update(webhookDeliveries)
                .set({ status: 'skipped', nextAttemptAt: null, error: 'La suscripción se pausó.' })
                .where(and(eq(webhookDeliveries.subscriptionId, current.id), eq(webhookDeliveries.status, 'pending')));
        }
        if (input.active === true) this.incidents.resolve(r.tenantId, `webhook:${current.id}`);
        await this.invalidate(r.tenantId);
        await this.audit.log({ tenantId: r.tenantId, userId: r.userId, action: 'webhook.update', targetType: 'webhook', targetId: current.id, targetLabel: row!.name, meta: { fields: Object.keys(input) } });
        const [name] = await this.creatorName(r.tenantId, row!.createdBy);
        return toDto(row!, name ?? null);
    }

    async remove(r: WebhookRequester, id: number): Promise<void> {
        this.assertCanManage(r);
        const current = await this.own(r, id);
        await this.tenantDb.withTenant(r.tenantId, (tx) => tx.delete(webhookSubscriptions).where(and(eq(webhookSubscriptions.tenantId, r.tenantId), eq(webhookSubscriptions.id, current.id))));
        await this.invalidate(r.tenantId);
        this.incidents.resolve(r.tenantId, `webhook:${current.id}`);
        await this.audit.log({ tenantId: r.tenantId, userId: r.userId, action: 'webhook.delete', targetType: 'webhook', targetId: current.id, targetLabel: current.name, meta: { via: r.via } });
    }

    async rotateSecret(r: WebhookRequester, id: number): Promise<CreatedWebhookSubscriptionDto> {
        this.assertCanManage(r);
        const current = await this.own(r, id);
        const secret = newSecret();
        const [row] = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx
                .update(webhookSubscriptions)
                .set({ secretEnc: encryptSecret(secret, this.env.SECRETS_KEY), secretHint: secret.slice(-4), updatedAt: new Date() })
                .where(and(eq(webhookSubscriptions.tenantId, r.tenantId), eq(webhookSubscriptions.id, current.id)))
                .returning(),
        );
        await this.audit.log({ tenantId: r.tenantId, userId: r.userId, action: 'webhook.rotate_secret', targetType: 'webhook', targetId: current.id, targetLabel: current.name });
        const [name] = await this.creatorName(r.tenantId, row!.createdBy);
        return { ...toDto(row!, name ?? null), secret };
    }

    /** «Enviar una prueba»: un aviso `ping` firmado, en el acto. Queda en el historial. */
    async test(r: WebhookRequester, id: number): Promise<WebhookTestResultDto> {
        this.assertCanManage(r);
        const sub = await this.own(r, id);
        const eventId = `evt_${randomUUID().replace(/-/g, '')}`;
        const payload = {
            id: eventId,
            event: 'ping',
            created_at: new Date().toISOString(),
            webhook: { id: sub.id, name: sub.name, events: sub.events },
            message: 'Aviso de prueba: si lo recibes, la dirección y la firma funcionan.',
        };
        const result = await this.send(sub, eventId, 'ping', payload, 1);
        await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx.insert(webhookDeliveries).values({
                tenantId: r.tenantId,
                subscriptionId: sub.id,
                eventId,
                event: 'ping',
                payload,
                status: result.ok ? 'success' : 'failed',
                attempts: 1,
                responseStatus: result.status,
                responseBody: result.body,
                error: result.error,
                deliveredAt: result.ok ? new Date() : null,
            }),
        );
        return result;
    }

    async deliveries(r: WebhookRequester, id: number, opts: { limit?: number; before?: number } = {}): Promise<WebhookDeliveryDto[]> {
        this.assertCanManage(r);
        const sub = await this.own(r, id);
        const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
        const rows = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx
                .select()
                .from(webhookDeliveries)
                .where(and(eq(webhookDeliveries.subscriptionId, sub.id), opts.before ? lt(webhookDeliveries.id, opts.before) : undefined))
                .orderBy(desc(webhookDeliveries.id))
                .limit(limit),
        );
        return rows.map(toDeliveryDto);
    }

    /** «Volver a enviar»: la misma entrega (mismo id del evento y mismo contenido). */
    async redeliver(r: WebhookRequester, id: number, deliveryId: number): Promise<WebhookDeliveryDto> {
        this.assertCanManage(r);
        const sub = await this.own(r, id);
        if (!sub.active) throw this.bad('webhook_paused', 'Enciende el webhook antes de volver a enviar.');
        const [row] = await this.tenantDb.withTenant(r.tenantId, (tx) =>
            tx
                .update(webhookDeliveries)
                .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date(), error: null })
                .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.subscriptionId, sub.id), sql`${webhookDeliveries.event} <> 'ping'`))
                .returning(),
        );
        if (!row) throw new NotFoundException({ code: 'webhook_delivery_not_found', message: 'Esa entrega no existe.', data: { status: 404 } });
        this.kicker?.();
        return toDeliveryDto(row);
    }
}

function defaultName(url: string): string {
    try {
        const host = new URL(url).host;
        if (/n8n/i.test(url)) return `n8n · ${host}`.slice(0, 80);
        if (/make\.com|integromat/i.test(host)) return `Make · ${host}`.slice(0, 80);
        if (/zapier\.com/i.test(host)) return `Zapier · ${host}`.slice(0, 80);
        return host.slice(0, 80);
    } catch {
        return 'Webhook';
    }
}

function networkError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (/SSRF|red interna/i.test(raw)) return 'La dirección apunta a una red interna: los avisos sólo van a direcciones públicas.';
    if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return `No respondió en ${SEND_TIMEOUT_MS / 1000} segundos.`;
    if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) return 'No se encontró la dirección (DNS).';
    if (/ECONNREFUSED/i.test(raw)) return 'La dirección rechazó la conexión.';
    if (/certificate|SSL|TLS/i.test(raw)) return 'El certificado de la dirección no es válido.';
    return `No se pudo conectar: ${raw.slice(0, 200)}`;
}

function toDto(s: SubRow, creatorName: string | null): WebhookSubscriptionDto {
    return {
        id: s.id,
        name: s.name,
        url: s.url,
        events: s.events.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e)),
        list_ids: s.listIds && s.listIds.length > 0 ? s.listIds.map(Number) : null,
        active: s.active,
        disabled_reason: s.disabledReason,
        secret_hint: s.secretHint,
        created_by: s.createdBy,
        created_by_name: creatorName,
        source: s.source === 'api' ? 'api' : 'app',
        consecutive_failures: s.consecutiveFailures,
        last_delivery_at: iso(s.lastDeliveryAt),
        last_status: (s.lastStatus as WebhookDeliveryStatus | null) ?? null,
        created_at: s.createdAt.toISOString(),
        updated_at: s.updatedAt.toISOString(),
    };
}

function toDeliveryDto(d: DeliveryRow): WebhookDeliveryDto {
    return {
        id: d.id,
        event_id: d.eventId,
        event: d.event as WebhookDeliveryDto['event'],
        record_id: d.recordId ?? null,
        list_id: d.listId ?? null,
        status: d.status as WebhookDeliveryStatus,
        attempts: d.attempts,
        response_status: d.responseStatus ?? null,
        response_body: d.responseBody ?? null,
        error: d.error ?? null,
        created_at: d.createdAt.toISOString(),
        delivered_at: iso(d.deliveredAt),
        next_attempt_at: d.status === 'pending' ? iso(d.nextAttemptAt) : null,
    };
}
