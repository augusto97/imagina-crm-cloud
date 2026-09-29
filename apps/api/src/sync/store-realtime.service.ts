import { BadRequestException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { defaultStoreEditable, type StoreListRole, type StoreMetaResource } from '@imagina-base/shared';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { devPrivateEgressAllowed } from '../common/safe-fetch';
import { decryptSecret, encryptSecret, isEncrypted } from '../common/secret-box';
import { ENV, type Env } from '../config/env';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { DRIZZLE, type Db } from '../db/client';
import { connectionSyncs, storeHooks } from '../db/schema';
import type { RecordChange } from '../records/record-change-hub';
import { TenantDb } from '../tenancy/tenant-db.service';
import { StoreSyncEngine } from './store-sync.engine';
import { StoreSyncQueue, type StoreSyncHookJob, type StoreSyncPushJob } from './store-sync.queue';
import { META_RESOURCES_OF, readSettings, readState, type SyncSettings } from './store-sync.types';
import { WooApiError, wooGetPage, wooSend } from './woocommerce/woo-fetch';
import {
    isWooPing,
    parseWooTopic,
    verifyWooSignature,
    wooDeliveryUrlProblem,
    wooDisabledHooksMessage,
    wooHookTopics,
} from './woocommerce/woo-hooks';

/** Lo que el listener de cambios necesita saber de una lista sincronizada. */
interface WriteTarget {
    syncId: number;
    /** Ids de los campos que viajan a la tienda (precios, stock y estados). */
    fieldIds: Set<number>;
}

const TARGETS_TTL_MS = 30_000;

/**
 * Tiempo real y edición en los dos sentidos (v0.1.207, ADR-S24 fase 3).
 *
 *  - **Avisos**: se registran en la tienda (un webhook por tema) apuntando a
 *    `POST /public/store-hooks/:token`. Cada entrega se verifica con el
 *    secreto propio de esa sincronización y se encola; la respuesta no espera
 *    a escribir (WooCommerce corta a los 5 s y, tras varios fallos seguidos,
 *    DESACTIVA el aviso).
 *  - **Red de seguridad**: en modo tiempo real igual se corre la sincronización
 *    cada hora; si un aviso quedó desactivado o se borró en la tienda, se
 *    reactiva o se vuelve a crear en esa vuelta.
 *  - **Edición en los dos sentidos**: lo que una persona (o una automatización)
 *    cambia en la app en una columna de la tienda viaja a la tienda. Lo que
 *    escribe la sincronización nunca vuelve (no pasa por el aviso de cambios):
 *    un cambio no puede rebotar en un bucle.
 */
@Injectable()
export class StoreRealtimeService {
    private readonly logger = new Logger(StoreRealtimeService.name);
    private readonly targets = new Map<number, { at: number; byList: Map<number, WriteTarget> }>();

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly engine: StoreSyncEngine,
        private readonly queue: StoreSyncQueue,
    ) {}

    // ── Registro de avisos en la tienda ─────────────────────────────────────

    private deliveryUrl(token: string): string {
        return `${this.env.APP_BASE_URL}/api/v1/public/store-hooks/${token}`;
    }

    /** Token + secreto de la sincronización (se crean la primera vez). */
    private async credentials(tenantId: number, syncId: number): Promise<{ token: string; secret: string }> {
        const [row] = await this.db.select().from(storeHooks).where(eq(storeHooks.syncId, syncId)).limit(1);
        if (row) {
            const secret = this.readSecret(row.secretEnc);
            if (secret !== null) return { token: row.token, secret };
            // Cifrado con otra SECRETS_KEY: se rota (la tienda recibe el secreto nuevo al re-registrar).
            await this.db.delete(storeHooks).where(eq(storeHooks.syncId, syncId));
        }
        const token = randomBytes(24).toString('base64url');
        const secret = randomBytes(24).toString('base64url');
        await this.db.insert(storeHooks).values({ token, tenantId, syncId, secretEnc: encryptSecret(secret, this.env.SECRETS_KEY) });
        return { token, secret };
    }

    /**
     * Registra un aviso por tema. Si alguno falla se borran los que sí se
     * crearon y se explica por qué (típico: la clave es de sólo lectura).
     */
    async register(tenantId: number, syncId: number, creds: IntegrationCreds, settings: SyncSettings): Promise<number[]> {
        const { token, secret } = await this.credentials(tenantId, syncId);
        // Una dirección a la que WordPress no entrega (puerto fuera de 80/443/8080)
        // se rechaza ANTES de registrar: si no, la app diría «en tiempo real» y la
        // tienda descartaría cada aviso en silencio.
        const problem = devPrivateEgressAllowed() ? null : wooDeliveryUrlProblem(this.deliveryUrl(token));
        if (problem) {
            throw new BadRequestException({
                code: 'store_hooks_failed',
                message: `La tienda no va a poder avisar en tiempo real: ${problem}`,
                data: { status: 400 },
            });
        }
        const created: number[] = [];
        try {
            for (const topic of wooHookTopics(settings)) {
                const res = (await wooSend(creds, 'POST', '/webhooks', {
                    name: `Imagina Base · ${topic}`,
                    topic,
                    delivery_url: this.deliveryUrl(token),
                    secret,
                    status: 'active',
                })) as { id?: unknown } | null;
                const id = Number(res?.id);
                if (Number.isInteger(id) && id > 0) created.push(id);
            }
        } catch (err) {
            for (const id of created) await wooSend(creds, 'DELETE', `/webhooks/${id}`, null, [['force', 'true']]).catch(() => undefined);
            throw new BadRequestException({
                code: 'store_hooks_failed',
                message: `La tienda no aceptó los avisos en tiempo real: ${explain(err)}`,
                data: { status: 400 },
            });
        }
        await this.saveRealtime(tenantId, syncId, { webhook_ids: created, error: null });
        return created;
    }

    /** Borra los avisos de la tienda (a lo mejor ya no existen: best-effort). */
    async unregister(tenantId: number, syncId: number, creds: IntegrationCreds | null): Promise<void> {
        const state = await this.state(tenantId, syncId);
        if (creds) {
            for (const id of state?.realtime.webhook_ids ?? []) {
                await wooSend(creds, 'DELETE', `/webhooks/${id}`, null, [['force', 'true']]).catch(() => undefined);
            }
        }
        // Sin token, un aviso que la tienda siga mandando recibe 404 y la tienda lo apaga sola.
        await this.db.delete(storeHooks).where(eq(storeHooks.syncId, syncId));
        if (state) await this.saveRealtime(tenantId, syncId, { webhook_ids: [], error: null });
    }

    /**
     * Red de seguridad (en cada vuelta horaria del modo tiempo real): los
     * avisos que la tienda desactivó (tras fallas de entrega) se reactivan y
     * los que faltan se vuelven a crear.
     */
    async ensure(tenantId: number, syncId: number, creds: IntegrationCreds, settings: SyncSettings): Promise<void> {
        const state = await this.state(tenantId, syncId);
        if (!state) return;
        try {
            const { token, secret } = await this.credentials(tenantId, syncId);
            const url = this.deliveryUrl(token);
            const page = await wooGetPage(creds, '/webhooks', [['per_page', '100']]);
            const ours = page.rows.filter((w) => w.delivery_url === url);
            const ids: number[] = [];
            // `disabled` es lo que WooCommerce pone tras varias entregas fallidas
            // (`paused` es una pausa manual): se cuentan para decirlo en pantalla,
            // en vez de reactivarlos en silencio cada hora para siempre.
            let disabled = 0;
            for (const topic of wooHookTopics(settings)) {
                const hit = ours.find((w) => w.topic === topic);
                if (hit) {
                    ids.push(Number(hit.id));
                    if (hit.status === 'disabled') disabled++;
                    if (hit.status !== 'active') {
                        await wooSend(creds, 'PUT', `/webhooks/${Number(hit.id)}`, { status: 'active' });
                    }
                } else {
                    const res = (await wooSend(creds, 'POST', '/webhooks', {
                        name: `Imagina Base · ${topic}`,
                        topic,
                        delivery_url: url,
                        secret,
                        status: 'active',
                    })) as { id?: unknown } | null;
                    if (Number(res?.id) > 0) ids.push(Number(res!.id));
                }
            }
            await this.saveRealtime(tenantId, syncId, {
                webhook_ids: ids,
                error: disabled > 0 ? wooDisabledHooksMessage(disabled, new URL(url).origin) : null,
            });
        } catch (err) {
            await this.saveRealtime(tenantId, syncId, { error: `No pudimos revisar los avisos de la tienda: ${explain(err)}` });
        }
    }

    // ── Recepción ───────────────────────────────────────────────────────────

    /**
     * Un aviso llega SIN sesión: el token dice a qué sincronización va y la
     * firma prueba que lo mandó la tienda. Token desconocido → 404 opaco (la
     * tienda desactiva el aviso sola); firma inválida → 401.
     */
    async receive(token: string, headers: Record<string, string | undefined>, rawBody: string, body: unknown): Promise<void> {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw notFound();
        const [hook] = await this.db.select().from(storeHooks).where(eq(storeHooks.token, token)).limit(1);
        if (!hook) throw notFound();
        const topic = headers['x-wc-webhook-topic'];
        // El «ping» al crear el aviso: si no se contesta 2xx la tienda no lo crea.
        if (isWooPing(topic, typeof body === 'object' ? body : rawBody)) return;
        const secret = this.readSecret(hook.secretEnc);
        if (secret === null || !verifyWooSignature(secret, rawBody, headers['x-wc-webhook-signature'])) {
            throw new UnauthorizedException({ code: 'bad_signature', message: 'Firma inválida', data: { status: 401 } });
        }
        if (!parseWooTopic(topic)) return; // un tema que no usamos: se acepta y se ignora.
        const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
        if (!payload) return;
        const job: StoreSyncHookJob = { tenantId: hook.tenantId, syncId: hook.syncId, topic: topic!, payload };
        // Sin cola (sin Redis): se procesa en el acto antes que perder el aviso.
        if (!this.queue.enqueueHook(job)) await this.processHook(job, null);
    }

    async processHook(job: StoreSyncHookJob, creds: IntegrationCreds | null): Promise<void> {
        const c = creds ?? (await this.credsFor(job.tenantId, job.syncId));
        if (!c) return;
        await this.engine.applyHook(job.tenantId, job.syncId, c, job.topic, job.payload);
    }

    // ── Edición en los dos sentidos ─────────────────────────────────────────

    /** Oyente del `RecordChangeHub`: si el registro vive en una lista de la tienda, encola el envío. */
    async onRecordChange(change: RecordChange): Promise<void> {
        // Un alta hecha en la app no tiene contraparte en la tienda (no hay a qué mandarla).
        if (change.kind === 'created') return;
        const target = (await this.writeTargets(change.tenantId)).get(change.listId);
        if (!target) return;
        const changed: number[] = [];
        for (const fieldId of target.fieldIds) {
            const key = `f${fieldId}`;
            if (JSON.stringify(change.before[key] ?? null) !== JSON.stringify(change.after[key] ?? null)) changed.push(fieldId);
        }
        if (changed.length === 0) return;
        const job: StoreSyncPushJob = {
            tenantId: change.tenantId,
            syncId: target.syncId,
            recordId: change.recordId,
            fieldIds: changed,
        };
        this.queue.enqueuePush(job);
    }

    async processPush(job: StoreSyncPushJob, creds: IntegrationCreds | null = null): Promise<void> {
        const c = creds ?? (await this.credsFor(job.tenantId, job.syncId));
        if (!c) return;
        let error: string | null = null;
        let sent = false;
        try {
            const res = await this.engine.push(job.tenantId, job.syncId, c, job.recordId, job.fieldIds);
            sent = res !== null;
        } catch (err) {
            error = explain(err);
            this.logger.warn(`Envío a la tienda (sincronización #${job.syncId}, registro ${job.recordId}): ${error}`);
        }
        if (!sent && !error) return;
        await this.tenantDb.withTenant(job.tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({
                    state: sql`jsonb_set(
                        ${connectionSyncs.state},
                        '{write_back}',
                        coalesce(${connectionSyncs.state}->'write_back', '{}'::jsonb) || jsonb_build_object(
                            'pushed', coalesce((${connectionSyncs.state}->'write_back'->>'pushed')::int, 0) + ${sent ? 1 : 0}::int,
                            'failed', coalesce((${connectionSyncs.state}->'write_back'->>'failed')::int, 0) + ${error ? 1 : 0}::int,
                            'last_at', ${new Date().toISOString()}::text,
                            'last_error', ${error}::text
                        )
                    )`,
                    updatedAt: new Date(),
                })
                .where(and(eq(connectionSyncs.tenantId, job.tenantId), eq(connectionSyncs.id, job.syncId))),
        );
    }

    /** Qué listas de este tenant mandan cambios a una tienda (cache corta: se consulta en CADA edición). */
    private async writeTargets(tenantId: number): Promise<Map<number, WriteTarget>> {
        const hit = this.targets.get(tenantId);
        if (hit && Date.now() - hit.at < TARGETS_TTL_MS) return hit.byList;
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ id: connectionSyncs.id, settings: connectionSyncs.settings })
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.enabled, true))),
        );
        const byList = new Map<number, WriteTarget>();
        for (const row of rows) {
            const settings = readSettings(row.settings);
            if (!settings.write_back) continue;
            // Productos y variaciones comparten lista (v0.1.213): se juntan sus
            // columnas; qué es cada fila lo resuelve el envío. Sólo cuentan las
            // columnas que la empresa habilitó (v0.1.214).
            for (const [role, resources] of Object.entries(META_RESOURCES_OF) as Array<[StoreListRole, StoreMetaResource[]]>) {
                const listId = settings.lists[role];
                if (!listId) continue;
                const enabled = settings.editable[role] ?? defaultStoreEditable(role);
                const ids = new Set<number>();
                for (const resource of resources) {
                    const packFields = settings.fields[resource] ?? {};
                    for (const slug of enabled) {
                        if (slug.startsWith('meta:')) {
                            const id = Number(slug.slice(5));
                            if (Object.values(settings.meta_map[resource] ?? {}).includes(id)) ids.add(id);
                        } else if (packFields[slug]) {
                            ids.add(packFields[slug]!);
                        }
                    }
                }
                if (ids.size > 0) byList.set(listId, { syncId: row.id, fieldIds: ids });
            }
        }
        this.targets.set(tenantId, { at: Date.now(), byList });
        return byList;
    }

    /** Tras cambiar los ajustes (activar/desactivar la edición, traer un campo). */
    forget(tenantId: number): void {
        this.targets.delete(tenantId);
    }

    // ── Ayudas ──────────────────────────────────────────────────────────────

    private credsResolver: ((tenantId: number, syncId: number) => Promise<IntegrationCreds | null>) | null = null;

    /** El service de la sincronización sabe resolver credenciales (evita el ciclo de dependencias). */
    setCredsResolver(fn: (tenantId: number, syncId: number) => Promise<IntegrationCreds | null>): void {
        this.credsResolver = fn;
    }

    private async credsFor(tenantId: number, syncId: number): Promise<IntegrationCreds | null> {
        return this.credsResolver ? this.credsResolver(tenantId, syncId) : null;
    }

    /** El secreto en claro, o `null` si no se puede leer (otra SECRETS_KEY). */
    private readSecret(enc: string): string | null {
        try {
            const plain = decryptSecret(enc, this.env.SECRETS_KEY);
            return isEncrypted(plain) ? null : plain;
        } catch {
            return null;
        }
    }

    private async state(tenantId: number, syncId: number) {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ state: connectionSyncs.state }).from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1),
        );
        return row ? readState(row.state) : null;
    }

    private async saveRealtime(
        tenantId: number,
        syncId: number,
        patch: { webhook_ids?: number[]; error?: string | null },
    ): Promise<void> {
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
    }
}

function notFound(): NotFoundException {
    return new NotFoundException({ code: 'not_found', message: 'Not found', data: { status: 404 } });
}

function explain(err: unknown): string {
    if (err instanceof WooApiError) return err.message;
    if (err instanceof BadRequestException) {
        const r = err.getResponse() as { message?: unknown };
        return typeof r.message === 'string' ? r.message : err.message;
    }
    return err instanceof Error ? err.message : String(err);
}
