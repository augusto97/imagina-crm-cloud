import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    type OnApplicationShutdown,
    type OnModuleInit,
} from '@nestjs/common';
import {
    pushLine,
    pushTag,
    type NotificationKind,
    type NotificationPrefs,
    type PushDeviceDto,
    type PushPayload,
    type PushStatusDto,
    type PushSubscribeInput,
    type PushTestResult,
} from '@imagina-base/shared';
import { Queue, Worker } from 'bullmq';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import type Redis from 'ioredis';
import { sessionPublicId, SessionService } from '../auth/session.service';
import { devPrivateEgressAllowed, safeWebhookFetch } from '../common/safe-fetch';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db } from '../db/client';
import { lists, pushSubscriptions, tenants, type PushSubscriptionRow } from '../db/schema';
import { QUEUE_JOB_RETENTION, guardRedis } from '../redis/redis.util';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { PushKeysService } from './push-keys.service';
import { encryptPushPayload, endpointHash, vapidAuthorization } from './web-push';

/** Notificaciones push por persona y hora (como el correo: el resto queda en la campana). */
export const PUSH_PER_HOUR = 20;
/** Dispositivos por persona y empresa (el más viejo se descarta). */
const MAX_DEVICES = 20;
/** Fallos seguidos (que no son 404/410) antes de dar por muerta una suscripción. */
const MAX_FAILURES = 5;
/** Un aviso que el servicio no pudo entregar en un día ya no sirve. */
const PUSH_TTL_SECONDS = 24 * 3600;
const SEND_TIMEOUT_MS = 6000;
const CONCURRENCY = 5;
const QUEUE = 'push';
/** Endpoints que el servicio de push dio de baja (404/410): no se re-vinculan. */
const GONE_PREFIX = 'pushgone:';
const GONE_TTL_SECONDS = 30 * 24 * 3600;

/** Lo que el pipeline de avisos le pasa al canal push. */
export interface PushNotice {
    kind: NotificationKind;
    listId: number | null;
    recordId: number | null;
    title: string;
    body: string;
}

interface PushJob {
    tenantId: number;
    userIds: number[];
    notice: PushNotice;
}

interface SendOutcome {
    ok: boolean;
    removed: boolean;
    error: string | null;
}

/**
 * H1 — Notificaciones push (Web Push con VAPID).
 *
 * Es un CANAL más del pipeline de avisos (ADR-S40): `NotificationsService`
 * ya decidió a quién (miembro, no cliente, puede ver el registro, no es quien
 * lo hizo) y le pasa a este servicio las personas cuyas preferencias piden
 * push para ese tipo. Aquí: el tope por hora, los dispositivos de cada una con
 * su SESIÓN viva, el cifrado por dispositivo (RFC 8291) y el envío con la
 * firma VAPID (RFC 8292) por el fetch con guard anti-SSRF — el endpoint lo
 * eligió el navegador, pero llega por la API y no se le cree.
 *
 * El envío va por una cola de BullMQ (como el correo): un servicio de push
 * lento no frena el aviso en la bandeja. Sin cola (tests) se envía en el acto.
 */
@Injectable()
export class PushService implements OnModuleInit, OnApplicationShutdown {
    private readonly logger = new Logger(PushService.name);
    private queue: Queue<PushJob> | null = null;
    private worker: Worker<PushJob> | null = null;
    private connections: IORedis[] = [];
    private readonly authCache = new Map<string, { value: string; until: number }>();

    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        @Inject(REDIS) private readonly redis: Redis,
        @Inject(ENV) private readonly env: Env,
        private readonly keys: PushKeysService,
        private readonly sessions: SessionService,
        /** Tests: reemplaza el envío HTTP (devuelve el status del servicio). */
        @Optional() @Inject('PUSH_TRANSPORT') private readonly transport?: PushTransport,
    ) {}

    async onModuleInit(): Promise<void> {
        if (this.env.NODE_ENV === 'test') return;
        try {
            const conn = () => {
                const c = guardRedis(new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null }), this.logger, QUEUE);
                this.connections.push(c);
                return c;
            };
            this.queue = new Queue<PushJob>(QUEUE, { connection: conn(), defaultJobOptions: QUEUE_JOB_RETENTION });
            this.queue.on('error', (err) => this.logger.warn(`Cola de push con error: ${err.message}`));
            this.worker = new Worker<PushJob>(QUEUE, async (job) => this.sendNotice(job.data), { connection: conn(), concurrency: 4 });
            this.worker.on('failed', (job, err) => this.logger.warn(`Push (${job?.id ?? '?'}) falló: ${err.message}`));
            this.worker.on('error', (err) => this.logger.warn(`Worker de push con error: ${err.message}`));
        } catch (err) {
            this.logger.warn(`Cola de push deshabilitada (sin Redis): se envía en el acto. ${String(err)}`);
            this.queue = null;
        }
    }

    async onApplicationShutdown(): Promise<void> {
        await this.worker?.close();
        await this.queue?.close();
        await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
    }

    // ─────────────────────────── Dispositivos ───────────────────────────

    async status(tenantId: number, userId: number): Promise<PushStatusDto> {
        return {
            public_key: await this.keys.publicKey(),
            devices: await this.devices(tenantId, userId),
            per_hour: PUSH_PER_HOUR,
        };
    }

    async devices(tenantId: number, userId: number): Promise<PushDeviceDto[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(pushSubscriptions)
                .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId)))
                .orderBy(asc(pushSubscriptions.createdAt)),
        );
        return rows.map(toDevice);
    }

    /**
     * Activa ESTE dispositivo (upsert por endpoint): si el mismo navegador ya
     * estaba suscripto —con esta persona o con otra que cerró sesión— pasa a
     * esta persona y a esta sesión.
     */
    async subscribe(
        tenantId: number,
        actor: { userId: number; sessionToken: string; impersonated: boolean },
        input: PushSubscribeInput,
        userAgent: string,
    ): Promise<PushDeviceDto> {
        if (actor.impersonated) {
            // Quien mira la app como otra persona (soporte) no recibe sus avisos.
            throw new ForbiddenException({ code: 'push_impersonating', message: 'No se pueden activar notificaciones mientras ves la app como otra persona', data: { status: 403 } });
        }
        assertPushEndpoint(input.endpoint);
        const hash = endpointHash(input.endpoint);
        if ((await this.redis.exists(`${GONE_PREFIX}${hash}`).catch(() => 0)) === 1) {
            throw new HttpException(
                {
                    code: 'push_subscription_gone',
                    message: 'El servicio de notificaciones dio de baja esta suscripción: el navegador debe crear una nueva',
                    data: { status: 410 },
                },
                HttpStatus.GONE,
            );
        }
        const sessionId = sessionPublicId(actor.sessionToken);
        const ua = userAgent.slice(0, 300);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [saved] = await tx
                .insert(pushSubscriptions)
                .values({
                    tenantId,
                    userId: actor.userId,
                    endpoint: input.endpoint,
                    p256dh: input.keys.p256dh,
                    auth: input.keys.auth,
                    endpointHash: hash,
                    sessionId,
                    userAgent: ua,
                })
                .onConflictDoUpdate({
                    target: [pushSubscriptions.tenantId, pushSubscriptions.endpointHash],
                    set: {
                        userId: actor.userId,
                        endpoint: input.endpoint,
                        p256dh: input.keys.p256dh,
                        auth: input.keys.auth,
                        sessionId,
                        userAgent: ua,
                        failures: 0,
                        lastError: null,
                    },
                })
                .returning();
            // Tope de dispositivos: se descartan los más viejos.
            const mine = await tx
                .select({ id: pushSubscriptions.id })
                .from(pushSubscriptions)
                .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, actor.userId)))
                .orderBy(asc(pushSubscriptions.createdAt));
            const extra = mine.slice(0, Math.max(0, mine.length - MAX_DEVICES)).map((r) => r.id);
            if (extra.length > 0) await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), inArray(pushSubscriptions.id, extra)));
            return saved!;
        });
        return toDevice(row);
    }

    /** Desactiva ESTE dispositivo (por su endpoint): al apagarlo o al cerrar sesión. */
    async unsubscribe(tenantId: number, userId: number, endpoint: string): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(pushSubscriptions)
                .where(
                    and(
                        eq(pushSubscriptions.tenantId, tenantId),
                        eq(pushSubscriptions.userId, userId),
                        eq(pushSubscriptions.endpointHash, endpointHash(endpoint)),
                    ),
                ),
        );
    }

    /** Quita un dispositivo de la lista (puede ser otro: el teléfono perdido). */
    async remove(tenantId: number, userId: number, id: number): Promise<void> {
        const out = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .delete(pushSubscriptions)
                .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)))
                .returning({ id: pushSubscriptions.id }),
        );
        if (out.length === 0) throw new NotFoundException({ code: 'push_device_not_found', message: 'Dispositivo no encontrado', data: { status: 404 } });
    }

    // ─────────────────────────── Envío ───────────────────────────

    /**
     * El canal push del pipeline de avisos: personas YA filtradas por el ACL
     * del registro; aquí se aplica su preferencia por tipo.
     */
    async deliver(tenantId: number, recipients: ReadonlyArray<{ userId: number; prefs: NotificationPrefs }>, notice: PushNotice): Promise<void> {
        const userIds = recipients.filter((r) => r.prefs.push?.[notice.kind] === true).map((r) => r.userId);
        if (userIds.length === 0) return;
        const job: PushJob = { tenantId, userIds, notice };
        if (this.queue) {
            await this.queue.add('notice', job).catch(async (err) => {
                this.logger.warn(`No se pudo encolar el push: ${String(err)} — se envía en el acto`);
                await this.sendNotice(job);
            });
            return;
        }
        await this.sendNotice(job);
    }

    /** «Enviarme una prueba»: a TODOS los dispositivos de la persona, sin preferencias ni tope. */
    async sendTest(tenantId: number, userId: number): Promise<PushTestResult> {
        const subs = await this.liveSubscriptions(tenantId, [userId]);
        const result: PushTestResult = { sent: 0, failed: 0, removed: 0, errors: [] };
        if (subs.length === 0) return result;
        const company = await this.tenantName(tenantId);
        const payload: PushPayload = {
            v: 1,
            title: pushLine(`Prueba de ${company}`, 80),
            body: 'Las notificaciones de este dispositivo funcionan.',
            url: '/#/settings?s=avisos',
            tag: `test-${Date.now()}`,
            tenant_id: tenantId,
            kind: 'test',
            ts: Date.now(),
        };
        const outcomes = await this.sendToAll(tenantId, subs, payload, 'high');
        for (const o of outcomes) {
            if (o.ok) result.sent++;
            else {
                result.failed++;
                if (o.removed) result.removed++;
                if (o.error) result.errors.push(o.error);
            }
        }
        return result;
    }

    /** El trabajo de la cola: tope por hora, dispositivos vivos y envío. */
    async sendNotice(job: PushJob): Promise<number> {
        const allowed: number[] = [];
        for (const userId of [...new Set(job.userIds)]) {
            if (await this.underCap(job.tenantId, userId)) allowed.push(userId);
        }
        if (allowed.length === 0) return 0;
        const subs = await this.liveSubscriptions(job.tenantId, allowed);
        if (subs.length === 0) return 0;
        const payload = await this.payloadFor(job.tenantId, job.notice);
        const urgent = job.notice.kind === 'mention' || job.notice.kind === 'approval' || job.notice.kind === 'reminder';
        const outcomes = await this.sendToAll(job.tenantId, subs, payload, urgent ? 'high' : 'normal');
        return outcomes.filter((o) => o.ok).length;
    }

    private async payloadFor(tenantId: number, n: PushNotice): Promise<PushPayload> {
        let url = n.kind === 'failure' ? '/#/settings?s=problemas' : '/#/my-work';
        if (n.listId !== null && n.recordId !== null && n.kind !== 'failure') {
            const slug = await this.listSlug(tenantId, n.listId);
            if (slug) url = `/#/lists/${slug}/records/${n.recordId}`;
        }
        return {
            v: 1,
            title: pushLine(n.title, 120),
            // UNA línea: el detalle completo (el comentario, los cambios) se ve
            // al abrir el registro, con la sesión de la persona.
            body: pushLine(n.body, 140),
            url,
            tag: pushTag(n.kind, n.recordId),
            tenant_id: tenantId,
            kind: n.kind,
            ts: Date.now(),
        };
    }

    /**
     * Los dispositivos de esas personas cuya SESIÓN sigue viva. Los de una
     * sesión cerrada, vencida o revocada se borran: ese navegador ya no es de
     * la persona (o nadie la está usando) y no tiene por qué ver sus avisos.
     */
    private async liveSubscriptions(tenantId: number, userIds: number[]): Promise<PushSubscriptionRow[]> {
        if (userIds.length === 0) return [];
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(pushSubscriptions)
                .where(and(eq(pushSubscriptions.tenantId, tenantId), inArray(pushSubscriptions.userId, userIds))),
        );
        if (rows.length === 0) return [];
        const alive = new Map<number, Set<string>>();
        for (const uid of new Set(rows.map((r) => r.userId))) alive.set(uid, await this.sessions.alivePublicIds(uid));
        const dead = rows.filter((r) => r.sessionId === null || !alive.get(r.userId)?.has(r.sessionId));
        if (dead.length > 0) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), inArray(pushSubscriptions.id, dead.map((r) => r.id)))),
            );
        }
        const deadIds = new Set(dead.map((r) => r.id));
        return rows.filter((r) => !deadIds.has(r.id));
    }

    private async sendToAll(tenantId: number, subs: PushSubscriptionRow[], payload: PushPayload, urgency: 'high' | 'normal'): Promise<SendOutcome[]> {
        const out: SendOutcome[] = [];
        let next = 0;
        const run = async (): Promise<void> => {
            while (next < subs.length) {
                const sub = subs[next++]!;
                out.push(await this.sendOne(tenantId, sub, payload, urgency));
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, run));
        return out;
    }

    private async sendOne(tenantId: number, sub: PushSubscriptionRow, payload: PushPayload, urgency: 'high' | 'normal'): Promise<SendOutcome> {
        let status = 0;
        let error: string | null = null;
        try {
            const keys = await this.keys.keys();
            const body = encryptPushPayload(JSON.stringify(payload), { p256dh: sub.p256dh, auth: sub.auth });
            const headers: Record<string, string> = {
                ttl: String(PUSH_TTL_SECONDS),
                'content-encoding': 'aes128gcm',
                'content-type': 'application/octet-stream',
                urgency,
                authorization: this.authorization(sub.endpoint, keys),
            };
            status = this.transport ? await this.transport(sub.endpoint, headers, body) : (await safeWebhookFetch(sub.endpoint, { method: 'POST', headers, body, timeoutMs: SEND_TIMEOUT_MS })).status;
            if (status >= 200 && status < 300) {
                await this.mark(tenantId, sub.id, { ok: true });
                return { ok: true, removed: false, error: null };
            }
            error = serviceError(status);
        } catch (err) {
            error = err instanceof Error ? err.message.slice(0, 200) : String(err);
        }
        // 404/410: el navegador la dio de baja (o venció) — se borra en el acto.
        // Lo demás (401/403 de un JWT rechazado, 5xx, 429, red) cuenta como
        // fallo: un problema de configuración de ESTE servidor no tiene que
        // borrar los dispositivos de todos de un saque.
        const gone = status === 404 || status === 410;
        if (gone || sub.failures + 1 >= MAX_FAILURES) {
            await this.tenantDb.withTenant(tenantId, (tx) =>
                tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.id, sub.id))),
            );
            // El navegador puede seguir devolviendo esa suscripción muerta en
            // `getSubscription()` (no se entera del 410): se recuerda para que
            // al re-vincularla se rechace y el dispositivo pida una NUEVA.
            if (gone) await this.redis.set(`${GONE_PREFIX}${sub.endpointHash}`, '1', 'EX', GONE_TTL_SECONDS).catch(() => undefined);
            return { ok: false, removed: true, error };
        }
        await this.mark(tenantId, sub.id, { ok: false, error: error ?? 'Error desconocido' });
        return { ok: false, removed: false, error };
    }

    private authorization(endpoint: string, keys: { publicKey: string; privateKey: string }): string {
        const aud = new URL(endpoint).origin;
        const hit = this.authCache.get(aud);
        const now = Date.now();
        if (hit && hit.until > now) return hit.value;
        // El JWT vale 12 h; se reusa una hora (firmar por cada push no hace falta).
        const value = vapidAuthorization(endpoint, keys, this.keys.subject());
        this.authCache.set(aud, { value, until: now + 3600_000 });
        return value;
    }

    private async mark(tenantId: number, id: number, r: { ok: true } | { ok: false; error: string }): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(pushSubscriptions)
                .set(
                    r.ok
                        ? { lastUsedAt: new Date(), failures: 0, lastError: null }
                        : { failures: sql`${pushSubscriptions.failures} + 1`, lastError: r.error.slice(0, 300) },
                )
                .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.id, id))),
        );
    }

    private async underCap(tenantId: number, userId: number): Promise<boolean> {
        const key = `notifpush:${tenantId}:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
        try {
            const n = await this.redis.incr(key);
            if (n === 1) await this.redis.expire(key, 3700);
            return n <= PUSH_PER_HOUR;
        } catch {
            return true;
        }
    }

    private async listSlug(tenantId: number, listId: number): Promise<string | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ slug: lists.slug }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId))).limit(1),
        );
        return row?.slug ?? null;
    }

    private async tenantName(tenantId: number): Promise<string> {
        const [row] = await this.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
        return row?.name ?? 'tu empresa';
    }
}

/** Envío HTTP reemplazable en los tests: devuelve el status del servicio de push. */
export type PushTransport = (endpoint: string, headers: Record<string, string>, body: Buffer) => Promise<number>;

/**
 * El endpoint lo entrega el navegador, pero llega por la API: sólo https (en
 * desarrollo, con la salida a la red privada habilitada, también http para el
 * servidor de push de prueba). El guard anti-SSRF del envío hace el resto.
 */
export function assertPushEndpoint(endpoint: string): void {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new BadRequestException({ code: 'push_endpoint_invalid', message: 'La dirección del servicio de notificaciones no es válida', data: { status: 400 } });
    }
    const okProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && devPrivateEgressAllowed());
    if (!okProtocol || url.username || url.password) {
        throw new BadRequestException({ code: 'push_endpoint_invalid', message: 'El servicio de notificaciones tiene que usar https', data: { status: 400 } });
    }
}

function serviceError(status: number): string {
    if (status === 404 || status === 410) return 'El navegador dio de baja este dispositivo';
    if (status === 401 || status === 403) return 'El servicio de notificaciones rechazó las llaves de este servidor';
    if (status === 413) return 'El aviso era demasiado grande';
    if (status === 429) return 'El servicio de notificaciones pidió esperar (demasiados envíos)';
    if (status >= 500) return `El servicio de notificaciones no respondió (${status})`;
    return `El servicio de notificaciones respondió ${status}`;
}

function toDevice(r: PushSubscriptionRow): PushDeviceDto {
    return {
        id: r.id,
        user_agent: r.userAgent,
        endpoint_hash: r.endpointHash,
        created_at: r.createdAt.toISOString(),
        last_used_at: r.lastUsedAt?.toISOString() ?? null,
        last_error: r.lastError,
    };
}
