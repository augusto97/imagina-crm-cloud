import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { SITE_SYNC_PROVIDER } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { DRIZZLE, type Db } from '../db/client';
import { connectionSyncs, storeHooks } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';
import { SiteSyncEngine, type SiteHookEvent } from './site-sync.engine';
import { SiteSyncQueue } from './site-sync.queue';
import type { SiteSyncSettings } from './site-sync.types';
import { ibcHooksDelete, ibcHooksRegister, ibcHooksStatus } from './wordpress/ibc';
import { parseSiteHookBody, sameHookUrl, secretFingerprint, verifySiteSignature } from './wordpress/ibc-hooks';
import { WpApiError } from './wordpress/wp-fetch';

const APPLY_ERROR_PREFIX = 'Un aviso del sitio no se pudo aplicar:';

/** Un aviso ya verificado, para la cola. */
export interface SiteSyncHookJob {
    tenantId: number;
    syncId: number;
    events: SiteHookEvent[];
}

/**
 * Tiempo real con el complemento (v0.1.334, ADR-S84). El mismo molde que la
 * tienda (ADR-S24 fase 3), con lo propio del complemento:
 *
 *  - **Registro**: la app le da al complemento una dirección propia
 *    (`/public/site-hooks/:token`) y un secreto; el complemento prueba la
 *    dirección en el acto con un «ping» firmado (si WordPress no llega a la
 *    app —un firewall, una app sin dirección pública—, se sabe en ese momento).
 *    Reusa la tabla `store_hooks` (token → sincronización, secreto cifrado).
 *  - **Recepción**: sin sesión; el token dice a qué sincronización va y la
 *    firma HMAC (con el timestamp a ±5 min) prueba que lo mandó el sitio.
 *    Token desconocido → 404 (el complemento deja de avisar solo); firma mala
 *    → 401. Se contesta enseguida: el aviso se procesa en la cola.
 *  - **Red de seguridad**: en tiempo real igual se recorre el sitio cada hora,
 *    y en esa vuelta se revisa el aviso: si el complemento lo perdió, lo
 *    apagó por fallas o cambió la dirección, se vuelve a registrar.
 */
@Injectable()
export class SiteRealtimeService {
    private readonly logger = new Logger(SiteRealtimeService.name);
    private credsResolver: ((tenantId: number, syncId: number) => Promise<IntegrationCreds | null>) | null = null;

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly engine: SiteSyncEngine,
        private readonly queue: SiteSyncQueue,
    ) {}

    setCredsResolver(fn: (tenantId: number, syncId: number) => Promise<IntegrationCreds | null>): void {
        this.credsResolver = fn;
    }

    deliveryUrl(token: string): string {
        return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/public/site-hooks/${token}`;
    }

    /** Token + secreto de la sincronización (se crean la primera vez). */
    private async credentials(tenantId: number, syncId: number): Promise<{ token: string; secret: string }> {
        const [row] = await this.db.select().from(storeHooks).where(eq(storeHooks.syncId, syncId)).limit(1);
        if (row) {
            const secret = this.readSecret(row.secretEnc);
            if (secret !== null) return { token: row.token, secret };
            // Cifrado con otra SECRETS_KEY: se rota (el sitio recibe el secreto nuevo al registrar).
            await this.db.delete(storeHooks).where(eq(storeHooks.syncId, syncId));
        }
        const token = randomBytes(24).toString('base64url');
        const secret = randomBytes(32).toString('base64url');
        await this.db.insert(storeHooks).values({ token, tenantId, syncId, secretEnc: encryptSecret(secret, this.env.SECRETS_KEY) });
        return { token, secret };
    }

    /** Qué tiene que avisar el complemento: sólo lo que esta sincronización trae. */
    private objectsOf(settings: SiteSyncSettings): { post_types: string[]; taxonomies: string[]; media: boolean } {
        const objects = Object.values(settings.objects);
        return {
            post_types: objects.filter((o) => o.kind === 'post_type').map((o) => o.object),
            taxonomies: objects.filter((o) => o.kind === 'taxonomy').map((o) => o.object),
            media: objects.some((o) => o.kind === 'media'),
        };
    }

    /**
     * Registra el aviso en el sitio. Si no se puede (sin el complemento, sin un
     * administrador conectado, o WordPress no llega a la app) se explica por qué
     * y no queda nada registrado.
     */
    async register(tenantId: number, syncId: number, creds: IntegrationCreds, settings: SiteSyncSettings): Promise<void> {
        const { token, secret } = await this.credentials(tenantId, syncId);
        let res;
        try {
            res = await ibcHooksRegister(creds, { url: this.deliveryUrl(token), secret, objects: this.objectsOf(settings) });
        } catch (err) {
            throw new BadRequestException({ code: 'site_realtime_failed', message: `El sitio no aceptó los avisos en tiempo real: ${explain(err)}`, data: { status: 400 } });
        }
        if (!res.ping.ok) {
            await ibcHooksDelete(creds).catch(() => undefined);
            const why = res.ping.status > 0 ? `la app respondió ${res.ping.status}` : res.ping.error ?? 'sin respuesta';
            throw new BadRequestException({
                code: 'site_realtime_unreachable',
                message: `WordPress no pudo llegar a la app para avisar los cambios (${why}). Revisa que el servidor del sitio pueda salir a ${new URL(this.deliveryUrl(token)).origin} (un firewall del hosting a veces lo bloquea).`,
                data: { status: 400 },
            });
        }
        await this.saveRealtime(tenantId, syncId, { registered: true, error: null });
    }

    /** Apaga el aviso en el sitio (si se puede) y olvida el token: lo que siga llegando recibe 404. */
    async unregister(tenantId: number, syncId: number, creds: IntegrationCreds | null): Promise<void> {
        if (creds) await ibcHooksDelete(creds).catch(() => undefined);
        await this.db.delete(storeHooks).where(eq(storeHooks.syncId, syncId));
        await this.saveRealtime(tenantId, syncId, { registered: false, error: null });
    }

    /**
     * Red de seguridad (en cada vuelta del modo en tiempo real): si el aviso
     * no está, apunta a otro lado, tiene otro secreto, cambió lo que hay que
     * avisar o el complemento lo apagó por fallas, se vuelve a registrar.
     */
    async ensure(tenantId: number, syncId: number, creds: IntegrationCreds, settings: SiteSyncSettings): Promise<void> {
        try {
            const { token, secret } = await this.credentials(tenantId, syncId);
            const status = await ibcHooksStatus(creds);
            const want = this.objectsOf(settings);
            const sameObjects =
                status.objects !== null &&
                JSON.stringify([...status.objects.post_types].sort()) === JSON.stringify([...want.post_types].sort()) &&
                JSON.stringify([...status.objects.taxonomies].sort()) === JSON.stringify([...want.taxonomies].sort()) &&
                status.objects.media === want.media;
            const healthy =
                status.registered && sameHookUrl(status.url, this.deliveryUrl(token)) && status.secret_fingerprint === secretFingerprint(secret) && sameObjects && !status.disabled;
            if (!healthy) {
                await this.register(tenantId, syncId, creds, settings);
                return;
            }
            // El complemento sigue anotando pero no logra mandar: se muestra el motivo.
            const failing = status.fails >= 3 && status.last_error ? `El sitio no está pudiendo avisar los cambios: ${status.last_error} (${status.pending} pendientes).` : null;
            await this.saveRealtime(tenantId, syncId, { registered: true, error: failing });
        } catch (err) {
            await this.saveRealtime(tenantId, syncId, { error: `No pudimos revisar los avisos en tiempo real: ${explain(err)}` });
        }
    }

    // ── Recepción ───────────────────────────────────────────────────────────

    async receive(token: string, headers: Record<string, string | undefined>, rawBody: string, body: unknown): Promise<void> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
        const [hook] = await this.db
            .select({ tenantId: storeHooks.tenantId, syncId: storeHooks.syncId, secretEnc: storeHooks.secretEnc, provider: connectionSyncs.provider })
            .from(storeHooks)
            .innerJoin(connectionSyncs, eq(connectionSyncs.id, storeHooks.syncId))
            .where(eq(storeHooks.token, token))
            .limit(1);
        // El token de una TIENDA no sirve aquí (y al revés): cada uno en su ruta.
        if (!hook || hook.provider !== SITE_SYNC_PROVIDER) throw notFound();
        const secret = this.readSecret(hook.secretEnc);
        const check = secret === null ? 'bad' : verifySiteSignature(secret, headers['x-imagina-timestamp'], rawBody, headers['x-imagina-signature']);
        if (check !== 'ok') {
            throw new UnauthorizedException({
                code: check === 'stale' ? 'stale_signature' : 'bad_signature',
                message: check === 'stale' ? 'Aviso vencido' : 'Firma inválida',
                data: { status: 401 },
            });
        }
        const parsed = parseSiteHookBody(body ?? safeJson(rawBody));
        if (!parsed || parsed.type === 'ping' || parsed.events.length === 0) return;
        await this.countReceived(hook.tenantId, hook.syncId, parsed.events.length);
        const job: SiteSyncHookJob = { tenantId: hook.tenantId, syncId: hook.syncId, events: parsed.events };
        // Sin cola (sin Redis): se procesa en el acto antes que perder el aviso.
        if (!this.queue.enqueueHook(job)) await this.processHook(job, null).catch(() => undefined);
    }

    async processHook(job: SiteSyncHookJob, creds: IntegrationCreds | null): Promise<void> {
        const c = creds ?? (this.credsResolver ? await this.credsResolver(job.tenantId, job.syncId) : null);
        if (!c) return;
        try {
            await this.engine.applyEvents(job.tenantId, job.syncId, c, job.events);
        } catch (err) {
            // La cola reintenta; si igual no se puede, lo trae la vuelta horaria.
            this.logger.warn(`Aviso del sitio (sincronización #${job.syncId}): ${explain(err)}`);
            await this.saveRealtime(job.tenantId, job.syncId, { error: `${APPLY_ERROR_PREFIX} ${explain(err)} Se pone al día en la próxima vuelta.` });
            throw err;
        }
        // Un aviso que antes falló y ahora entró: ya no hay nada que mostrar.
        const [row] = await this.tenantDb.withTenant(job.tenantId, (tx) =>
            tx.select({ state: connectionSyncs.state }).from(connectionSyncs).where(and(eq(connectionSyncs.tenantId, job.tenantId), eq(connectionSyncs.id, job.syncId))).limit(1),
        );
        const prev = (row?.state as { realtime?: { error?: unknown } } | undefined)?.realtime?.error;
        if (typeof prev === 'string' && prev.startsWith(APPLY_ERROR_PREFIX)) await this.saveRealtime(job.tenantId, job.syncId, { error: null });
    }

    // ── Ayudas ──────────────────────────────────────────────────────────────

    private readSecret(enc: string): string | null {
        try {
            const plain = decryptSecret(enc, this.env.SECRETS_KEY);
            return isEncrypted(plain) ? null : plain;
        } catch {
            return null;
        }
    }

    private async countReceived(tenantId: number, syncId: number, n: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    state: sql`jsonb_set(
                        ${connectionSyncs.state},
                        '{realtime}',
                        coalesce(${connectionSyncs.state}->'realtime', '{}'::jsonb) || jsonb_build_object(
                            'received', coalesce((${connectionSyncs.state}->'realtime'->>'received')::int, 0) + ${n}::int,
                            'last_at', ${new Date().toISOString()}::text
                        )
                    )`,
                })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
    }

    async saveRealtime(tenantId: number, syncId: number, patch: { registered?: boolean; error?: string | null }): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    state: sql`jsonb_set(
                        ${connectionSyncs.state},
                        '{realtime}',
                        coalesce(${connectionSyncs.state}->'realtime', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
                    )`,
                    updatedAt: new Date(),
                })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
        if ('error' in patch) {
            const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ connectionId: connectionSyncs.connectionId, createdBy: connectionSyncs.createdBy })
                    .from(connectionSyncs)
                    .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId)))
                    .limit(1),
            );
            if (row) {
                this.engine.siteIncident(
                    { tenantId, connectionId: row.connectionId, actorId: row.createdBy ?? 0 },
                    'realtime',
                    patch.error ?? null,
                    'El sitio dejó de avisar los cambios en tiempo real',
                );
            }
        }
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'not_found', message: 'Not found', data: { status: 404 } });
}

function safeJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

function explain(err: unknown): string {
    if (err instanceof WpApiError) {
        if (err.wp.code === 'ibc_needs_admin') return 'para los avisos en tiempo real hace falta conectar el sitio con un usuario Administrador.';
        if (err.wp.code === 'rest_no_route' || err.status === 404) return 'el complemento para WordPress no está activo en el sitio.';
        return err.message;
    }
    if (err instanceof BadRequestException) {
        const r = err.getResponse();
        if (r && typeof r === 'object' && typeof (r as { message?: unknown }).message === 'string') return (r as { message: string }).message;
    }
    return err instanceof Error ? err.message : String(err);
}
