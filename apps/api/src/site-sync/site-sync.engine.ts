import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { isSitePluginColumn, validateFieldValue, type Field, type SiteObjectKind } from '@imagina-base/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { ActivityService, computeDiff } from '../activity/activity.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { BillingService } from '../billing/billing.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { explainLostAccess } from '../connectors/wordpress/wp-verify';
import type { Tx } from '../db/client';
import { connectionSyncs, records, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { IncidentHub } from '../incidents/incident-hub';
import { RealtimeService } from '../realtime/realtime.service';
import { REDIS } from '../redis/redis.module';
import { TenantDb } from '../tenancy/tenant-db.service';
import { readSiteSettings, readSiteState, type SiteKeysetCursor, type SiteObjectSettings, type SitePluginState, type SiteSyncSettings, type SiteSyncState } from './site-sync.types';
import { ibcInfo, ibcRead, ibcWrite, type IbcInfo } from './wordpress/ibc';
import { WP_PAGE_SIZE, WpApiError, wpGet, wpGetPage, wpSend } from './wordpress/wp-fetch';
import {
    IBC_VALUES,
    buildWpWriteBack,
    emptyLookups,
    mapWpItem,
    wpCollectionRoute,
    wpFieldsParam,
    wpLookupIds,
    wpMediaThumb,
    type MappedSiteItem,
    type WpJson,
    type WpLookups,
    type WpTerm,
} from './wordpress/wp-map';

/**
 * Motor de sincronización con un sitio WordPress (v0.1.333, ADR-S83). Copia
 * el molde de la tienda (ADR-S24) con lo propio de WordPress:
 *
 *  - **Actualizar, no duplicar**: cada entrada o término queda vinculado a su
 *    id en el sitio (`sync_links`, recurso `post:propiedad`). La segunda vez
 *    se ACTUALIZA el registro.
 *  - **Incremental por fecha de modificación (keyset)**: `orderby=modified` +
 *    `modified_after` (WP 5.7+) desde un cursor (fecha + ids de ese segundo,
 *    porque la API compara por segundo y el filtro es exclusivo). La fecha es
 *    la del SITIO (`modified`, sin zona): `modified_after` compara contra esa
 *    columna. Un sitio que ignora el filtro (WordPress viejo) se detecta y se
 *    pagina por número.
 *  - **Borradores, privadas y programadas también** (`status=any`, en
 *    contexto de edición). La papelera va aparte (`status=trash`): una entrada
 *    que se manda a la papelera queda en la app con ese estado.
 *  - **Lo borrado del todo** se detecta en un barrido completo diario: el
 *    registro queda en «Papelera» — nunca se borra nada (ADR-S09).
 *  - **Sólo las columnas elegidas** (`_fields`): jamás el contenido completo.
 *  - **Una corrida a la vez** (candado en Redis) + `pg_advisory_xact_lock` en
 *    cada escritura (una corrida y un envío que se cruzan no duplican nada).
 *  - **La primera carga no dispara automatizaciones**: es una puesta al día.
 *  - **El límite del plan manda**: se detiene con el motivo, no trunca.
 *  - **Sin bucles**: el motor escribe por su propio camino y NUNCA emite en el
 *    `RecordChangeHub`; lo que llega del sitio no vuelve al sitio.
 */

const LOCK_TTL_MS = 10 * 60 * 1000;
/** Barrido completo (lo borrado del todo sólo se ve recorriendo todo). */
const FULL_SWEEP_MS = 24 * 60 * 60 * 1000;
const MAX_WARNINGS = 20;
/** Tope de páginas por recurso y corrida: un sitio enorme sigue en la próxima. */
const MAX_PAGES_PER_RUN = 400;
/** Términos que se leen de una taxonomía para traducir ids (5.000). */
const MAX_TERM_PAGES = 50;
const INSERT_CHUNK = 500;
/** La red de seguridad del modo en tiempo real: una vuelta por hora. */
const REALTIME_SWEEP_MINUTES = 60;

export class SiteSyncStopped extends Error {}

/** Un aviso del complemento (ya verificado): qué cambió en el sitio. */
export interface SiteHookEvent {
    kind: 'post' | 'term' | 'media';
    object: string;
    id: number;
    action: 'saved' | 'trashed' | 'deleted';
}

/** Mensaje cuando una columna del complemento no se puede mandar porque el sitio ya no lo tiene. */
export const PLUGIN_MISSING_WRITE =
    'Ese dato lo guarda el complemento para WordPress y el sitio ya no lo tiene activo: no se pudo mandar. Instálalo de nuevo desde la página del sitio.';

interface ListTarget {
    listId: number;
    fields: Map<number, Field>;
}

export interface SiteRunCtx {
    tenantId: number;
    syncId: number;
    connectionId: number;
    actorId: number;
    settings: SiteSyncSettings;
    state: SiteSyncState;
    creds: IntegrationCreds;
    targets: Record<string, ListTarget>;
    /** La primera corrida (y una vuelta completa pedida) no disparan automatizaciones. */
    dispatch: boolean;
    lockToken: string;
    warnings: Set<string>;
    touchedLists: Set<number>;
    /** Términos ya leídos en esta corrida (taxonomía → id → término). */
    terms: Map<string, Map<number, WpTerm>>;
    /** El complemento, si está (null = no está o no se sabe: sus columnas quedan como estaban). */
    plugin: IbcInfo | null;
}

export interface SiteRunOptions {
    full?: boolean;
    /** Limitar la corrida a estos recursos (al traer una columna nueva). */
    only?: string[];
}

@Injectable()
export class SiteSyncEngine {
    private readonly logger = new Logger(SiteSyncEngine.name);

    constructor(
        private readonly tenantDb: TenantDb,
        private readonly fields: FieldsService,
        private readonly billing: BillingService,
        private readonly realtime: RealtimeService,
        private readonly automations: AutomationDispatcher,
        private readonly activity: ActivityService,
        @Inject(REDIS) private readonly redis: Redis,
        @Optional() private readonly incidents?: IncidentHub,
    ) {}

    /** Abre (con error) o cierra (sin error) el problema del sitio (ADR-S44). */
    siteIncident(ctx: Pick<SiteRunCtx, 'tenantId' | 'connectionId' | 'actorId'>, part: 'run' | 'push' | 'realtime', error: string | null, title: string): void {
        const key = `site_sync:${ctx.connectionId}:${part}`;
        if (error === null) {
            this.incidents?.resolve(ctx.tenantId, key);
            return;
        }
        this.incidents?.report({
            tenantId: ctx.tenantId,
            key,
            source: 'site_sync',
            sourceId: ctx.connectionId,
            ownerId: ctx.actorId > 0 ? ctx.actorId : null,
            title,
            message: error,
        });
    }

    // ── Candado ─────────────────────────────────────────────────────────────

    private lockKey(syncId: number): string {
        return `sitesync:lock:${syncId}`;
    }

    async acquire(syncId: number): Promise<string | null> {
        const token = randomBytes(12).toString('hex');
        const ok = await this.redis.set(this.lockKey(syncId), token, 'PX', LOCK_TTL_MS, 'NX');
        return ok === 'OK' ? token : null;
    }

    private async renew(ctx: SiteRunCtx): Promise<void> {
        const current = await this.redis.get(this.lockKey(ctx.syncId));
        if (current !== ctx.lockToken) throw new SiteSyncStopped('Otra corrida tomó la sincronización.');
        await this.redis.pexpire(this.lockKey(ctx.syncId), LOCK_TTL_MS);
    }

    async release(syncId: number, token: string): Promise<void> {
        const current = await this.redis.get(this.lockKey(syncId));
        if (current === token) await this.redis.del(this.lockKey(syncId));
    }

    // ── Corrida ─────────────────────────────────────────────────────────────

    /** `false` = otra corrida la tiene tomada (el que llama decide si reintentar). */
    async run(tenantId: number, syncId: number, creds: IntegrationCreds, opts: SiteRunOptions = {}): Promise<boolean> {
        const token = await this.acquire(syncId);
        if (!token) return false;
        try {
            const ctx = await this.context(tenantId, syncId, creds, token);
            if (!ctx) return true;
            ctx.dispatch = ctx.state.initial_done && opts.full !== true;
            await this.saveState(tenantId, syncId, {
                running: true,
                current: null,
                progress: {},
                last_run_at: new Date().toISOString(),
                last_error: null,
            });
            let error: string | null = null;
            let authFailed = false;
            try {
                await this.detectPlugin(ctx);
                for (const [resource, o] of Object.entries(ctx.settings.objects)) {
                    if (opts.only && !opts.only.includes(resource)) continue;
                    if (!ctx.targets[resource]) continue;
                    if (o.kind === 'taxonomy') await this.syncTerms(ctx, resource, o);
                    else await this.syncPosts(ctx, resource, o, opts.full === true);
                }
            } catch (err) {
                error = err instanceof Error ? err.message : String(err);
                authFailed = err instanceof WpApiError && (err.kind === 'auth' || err.kind === 'not_seen');
                // ¿Revocaron la contraseña, o un plugin de seguridad (Wordfence) apagó las contraseñas de aplicación?
                if (err instanceof WpApiError && err.kind === 'not_seen') error = (await explainLostAccess(ctx.settings.site_url)) ?? error;
                if (!(err instanceof SiteSyncStopped)) this.logger.warn(`Sincronización del sitio #${syncId} (tenant ${tenantId}): ${error}`);
            }
            const now = new Date();
            const patch: Record<string, unknown> = {
                running: false,
                current: null,
                warnings: [...ctx.warnings].slice(0, MAX_WARNINGS),
                cursors: ctx.state.cursors,
                full_at: ctx.state.full_at,
                last_error: error,
                // Lo lee la página del sitio y la fila de Integraciones («Hay que volver a conectarlo»).
                auth_failed: authFailed,
            };
            if (!error) {
                patch.initial_done = true;
                patch.last_success_at = now.toISOString();
            }
            await this.saveState(tenantId, syncId, patch);
            const lostLock = error !== null && error.startsWith('Otra corrida');
            if (!lostLock) {
                this.siteIncident(
                    ctx,
                    'run',
                    error,
                    authFailed ? `El sitio ${siteHost(ctx.settings.site_url)} rechazó la conexión` : `No se pudo sincronizar el sitio ${siteHost(ctx.settings.site_url)}`,
                );
            }
            await this.setNextRun(tenantId, syncId, new Date(now.getTime() + nextRunMinutes(ctx.settings, ctx.plugin !== null) * 60_000));
            for (const listId of ctx.touchedLists) this.realtime.records(tenantId, listId);
            return true;
        } finally {
            await this.release(syncId, token);
        }
    }

    async context(tenantId: number, syncId: number, creds: IntegrationCreds, lockToken: string): Promise<SiteRunCtx | null> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId)))
                .limit(1);
            return r ?? null;
        });
        if (!row) return null;
        const settings = readSiteSettings(row.settings);
        const state = readSiteState(row.state);
        return {
            tenantId,
            syncId,
            connectionId: row.connectionId,
            actorId: row.createdBy ?? 0,
            settings,
            state,
            creds,
            targets: await this.loadTargets(tenantId, settings),
            dispatch: state.initial_done,
            lockToken,
            warnings: new Set(),
            touchedLists: new Set(),
            terms: new Map(),
            // Fuera de una vuelta (envíos, avisos) se confía en lo último que se supo.
            plugin: state.plugin?.installed ? { version: state.plugin.version ?? '', seo: null, providers: { acf: false, metabox: false, jetengine: false }, can_manage: false, can_hooks: false, hooks: null, updates: false, signed: false, media_index: null } : null,
        };
    }

    /**
     * ¿Está el complemento? Se pregunta al empezar cada vuelta: si lo
     * desinstalaron, sus columnas quedan con lo último que llegó (bloqueadas en
     * la lista) y el tiempo real vuelve a intervalos sin romper nada.
     */
    async detectPlugin(ctx: SiteRunCtx): Promise<void> {
        const prev = ctx.state.plugin;
        const found = await ibcInfo(ctx.creds).catch((err: unknown) => ({ installed: false as const, error: err instanceof Error ? err.message : String(err) }));
        const now = new Date().toISOString();
        const uses = Object.values(ctx.settings.objects).some((o) => o.columns.some((c) => isSitePluginColumn(c.key)));
        if (found.installed) {
            ctx.plugin = found.info;
            let mediaPending = prev?.media_pending === true;
            if (mediaPending && found.info.media_index?.status === 'ready') {
                // El sitio terminó de calcular «Dónde se usa»: esta vuelta relee los medios enteros.
                for (const [resource, o] of Object.entries(ctx.settings.objects)) {
                    if (o.kind === 'media') delete ctx.state.cursors[resource];
                }
                mediaPending = false;
            }
            ctx.state.plugin = { installed: true, version: found.info.version, seo_name: found.info.seo?.name ?? null, checked_at: now, missing_since: null, media_pending: mediaPending };
            if (found.info.seo?.problem) ctx.warnings.add(found.info.seo.problem);
        } else {
            ctx.plugin = null;
            const missingSince = prev?.installed ? now : (prev?.missing_since ?? (uses ? now : null));
            ctx.state.plugin = { installed: false, version: null, seo_name: null, checked_at: now, missing_since: missingSince };
            if (uses) {
                ctx.warnings.add(
                    found.error
                        ? `No pudimos leer el complemento para WordPress: ${found.error} Las columnas de SEO y campos quedaron con lo último que llegó.`
                        : 'El complemento para WordPress ya no está activo en el sitio: las columnas que da (SEO, campos, medios) quedaron con lo último que llegó y no se pueden editar. Instálalo de nuevo desde la página del sitio.',
                );
            }
        }
        await this.saveState(ctx.tenantId, ctx.syncId, { plugin: ctx.state.plugin satisfies SitePluginState });
    }

    private async loadTargets(tenantId: number, settings: SiteSyncSettings): Promise<Record<string, ListTarget>> {
        const out: Record<string, ListTarget> = {};
        for (const [resource, listId] of Object.entries(settings.lists)) {
            try {
                const fields = await this.fields.listByListId(tenantId, listId);
                out[resource] = { listId, fields: new Map(fields.map((f) => [f.id, f])) };
            } catch {
                // La lista se borró: ese recurso deja de escribirse (sin romper el resto).
            }
        }
        return out;
    }

    async saveState(tenantId: number, syncId: number, patch: Record<string, unknown>): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({ state: sql`${connectionSyncs.state} || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
    }

    private async setNextRun(tenantId: number, syncId: number, at: Date): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .update(connectionSyncs)
                .set({ nextRunAt: at })
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.id, syncId))),
        );
    }

    private async progress(ctx: SiteRunCtx, resource: string, done: number, total: number | null): Promise<void> {
        ctx.state.progress[resource] = { done, total };
        if (ctx.lockToken) await this.renew(ctx);
        await this.saveState(ctx.tenantId, ctx.syncId, { current: resource, progress: ctx.state.progress });
    }

    // ── Entradas, páginas y tipos propios ───────────────────────────────────

    private async syncPosts(ctx: SiteRunCtx, resource: string, o: SiteObjectSettings, forceFull: boolean): Promise<void> {
        // Los medios no tienen borradores: están «inherit» (o privados) en la biblioteca.
        const live = o.kind === 'media' ? 'inherit,private' : 'any';
        const last = ctx.state.full_at[resource] ? Date.parse(ctx.state.full_at[resource]!) : 0;
        const sweep = forceFull || !ctx.state.initial_done || ctx.state.cursors[resource] === undefined || Date.now() - last > FULL_SWEEP_MS;
        const seen = sweep ? new Set<string>() : null;
        let done = 0;
        const onPage = async (rows: WpJson[], remaining: number | null) => {
            const total = remaining === null ? null : done + remaining;
            await this.upsertRows(ctx, resource, o, rows);
            for (const r of rows) seen?.add(String(Number(r.id)));
            done += rows.length;
            await this.progress(ctx, resource, done, total);
        };
        const complete = await this.keyset(ctx, resource, o, live, sweep, onPage);
        // La papelera va aparte: `status=any` no la incluye.
        const trashComplete = await this.keyset(ctx, `${resource}|trash`, o, 'trash', sweep, onPage);
        if (sweep && complete && trashComplete && seen) {
            await this.markMissing(ctx, resource, seen);
            ctx.state.full_at[resource] = new Date().toISOString();
        }
    }

    /**
     * Recorre una colección por fecha de modificación (keyset). Devuelve si
     * llegó al final (un sitio enorme corta en el tope y sigue la próxima vez).
     */
    private async keyset(
        ctx: SiteRunCtx,
        cursorKey: string,
        o: SiteObjectSettings,
        status: string,
        fromStart: boolean,
        onPage: (rows: WpJson[], remaining: number | null) => Promise<void>,
    ): Promise<boolean> {
        let cursor: SiteKeysetCursor | null = fromStart ? null : (ctx.state.cursors[cursorKey] ?? null);
        let page = 1;
        let plainPaging = false;
        const fields = wpFieldsParam(o);
        for (let n = 0; n < MAX_PAGES_PER_RUN; n++) {
            const query: Array<[string, string]> = [
                ['context', 'edit'],
                ['status', status],
                ['per_page', String(WP_PAGE_SIZE)],
                ['page', String(page)],
                ['orderby', 'modified'],
                ['order', 'asc'],
                ['_fields', fields],
            ];
            // Exclusivo y por segundo: se pide desde un segundo antes y los ya vistos se descartan.
            if (cursor) query.push(['modified_after', minusOneSecond(cursor.at)]);
            let res;
            try {
                res = await wpGetPage(ctx.creds, wpCollectionRoute(o), query);
            } catch (err) {
                // Página fuera de rango (WordPress responde 400 rest_post_invalid_page_number).
                if (err instanceof WpApiError && err.status === 400 && page > 1) return true;
                throw err;
            }
            if (cursor && !plainPaging && res.rows.some((r) => local(r) !== '' && local(r) < minusOneSecond(cursor!.at))) {
                // Un WordPress viejo ignora `modified_after`: se pagina por número.
                plainPaging = true;
            }
            const fresh = res.rows.filter((r) => !(cursor && local(r) === cursor.at && cursor.ids.includes(String(r.id))));
            if (fresh.length > 0) await onPage(fresh, res.total);
            const maxAt = res.rows.reduce<string>((m, r) => (local(r) > m ? local(r) : m), cursor?.at ?? '');
            if (plainPaging) {
                page += 1;
                if (maxAt !== '' && (!cursor || maxAt > cursor.at)) {
                    cursor = { at: maxAt, ids: res.rows.filter((r) => local(r) === maxAt).map((r) => String(r.id)) };
                }
            } else if (maxAt !== '' && (!cursor || maxAt > cursor.at)) {
                cursor = { at: maxAt, ids: res.rows.filter((r) => local(r) === maxAt).map((r) => String(r.id)) };
                page = 1;
            } else if (cursor && maxAt === cursor.at) {
                cursor = { at: cursor.at, ids: [...new Set([...cursor.ids, ...res.rows.map((r) => String(r.id))])] };
                page += 1;
            }
            ctx.state.cursors[cursorKey] = cursor;
            await this.saveState(ctx.tenantId, ctx.syncId, { cursors: ctx.state.cursors });
            if (res.rows.length < WP_PAGE_SIZE) return true;
        }
        return false;
    }

    // ── Taxonomías ──────────────────────────────────────────────────────────

    /**
     * Los términos no tienen fecha de modificación: se recorren enteros en
     * cada corrida (suelen ser pocos), y lo que deja de aparecer queda como
     * «Borrado en WordPress».
     */
    private async syncTerms(ctx: SiteRunCtx, resource: string, o: SiteObjectSettings): Promise<void> {
        const seen = new Set<string>();
        let done = 0;
        let complete = false;
        for (let page = 1; page <= MAX_PAGES_PER_RUN; page++) {
            const res = await wpGetPage(ctx.creds, wpCollectionRoute(o), [
                ['context', 'edit'],
                ['per_page', String(WP_PAGE_SIZE)],
                ['page', String(page)],
                ['orderby', 'id'],
                ['order', 'asc'],
                ['hide_empty', 'false'],
                ['_fields', wpFieldsParam(o)],
            ]);
            await this.upsertRows(ctx, resource, o, res.rows);
            for (const r of res.rows) seen.add(String(Number(r.id)));
            done += res.rows.length;
            await this.progress(ctx, resource, done, res.total);
            if (res.rows.length < WP_PAGE_SIZE) {
                complete = true;
                break;
            }
        }
        if (complete) {
            await this.markMissing(ctx, resource, seen);
            ctx.state.full_at[resource] = new Date().toISOString();
        }
    }

    // ── Traducciones (términos, medios, autores, padres) ────────────────────

    private async termsOf(ctx: SiteRunCtx, taxonomy: string): Promise<Map<number, WpTerm>> {
        const hit = ctx.terms.get(taxonomy);
        if (hit) return hit;
        const ref = Object.values(ctx.settings.objects)
            .flatMap((o) => o.taxonomies)
            .find((t) => t.taxonomy === taxonomy);
        const map = new Map<number, WpTerm>();
        if (ref) {
            for (let page = 1; page <= MAX_TERM_PAGES; page++) {
                const res = await wpGetPage(ctx.creds, `/${ref.rest_namespace}/${ref.rest_base}`, [
                    ['per_page', String(WP_PAGE_SIZE)],
                    ['page', String(page)],
                    ['orderby', 'id'],
                    ['hide_empty', 'false'],
                    ['_fields', 'id,name,slug'],
                ]);
                for (const t of res.rows) {
                    const id = Number(t.id);
                    if (id > 0) map.set(id, { slug: wpSlugText(t.slug), name: decodeName(t.name) });
                }
                if (res.rows.length < WP_PAGE_SIZE) break;
            }
        }
        ctx.terms.set(taxonomy, map);
        return map;
    }

    private async lookups(ctx: SiteRunCtx, o: SiteObjectSettings, rows: WpJson[]): Promise<WpLookups> {
        const out = emptyLookups();
        const cols = new Set(o.columns.map((c) => c.key));
        for (const t of o.taxonomies) {
            if (cols.has(`tax:${t.taxonomy}`)) out.terms.set(t.taxonomy, await this.termsOf(ctx, t.taxonomy));
        }
        const ids = wpLookupIds(o, rows);
        const batch = async (route: string, list: number[], fields: string, extra: Array<[string, string]>, put: (r: WpJson) => void) => {
            for (let i = 0; i < list.length; i += WP_PAGE_SIZE) {
                const chunk = list.slice(i, i + WP_PAGE_SIZE);
                try {
                    const res = await wpGetPage(ctx.creds, route, [['include', chunk.join(',')], ['per_page', String(WP_PAGE_SIZE)], ['_fields', fields], ...extra]);
                    for (const r of res.rows) put(r);
                } catch (err) {
                    // Un dato de adorno (la miniatura, el nombre del autor) no frena la corrida.
                    ctx.warnings.add(`No pudimos leer ${route.endsWith('/media') ? 'las imágenes' : route.endsWith('/users') ? 'los autores' : 'las páginas madre'}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        };
        await batch('/wp/v2/media', ids.media, 'id,source_url,media_details', [], (m) => {
            const url = wpMediaThumb(m);
            if (url) out.media.set(Number(m.id), url);
        });
        await batch('/wp/v2/users', ids.users, 'id,name', [], (u) => out.users.set(Number(u.id), decodeName(u.name)));
        // Los padres que ya llegaron en esta misma tanda no se piden.
        const inPage = new Map(rows.map((r) => [Number(r.id), o.kind === 'taxonomy' ? decodeName(r.name) : titleOf(r)]));
        const missing = ids.parents.filter((p) => !inPage.has(p));
        for (const [id, t] of inPage) if (ids.parents.includes(id)) out.parents.set(id, t);
        await batch(
            wpCollectionRoute(o),
            missing,
            o.kind === 'taxonomy' ? 'id,name' : 'id,title',
            o.kind === 'taxonomy' ? [] : [['status', 'any'], ['context', 'edit']],
            (p) => out.parents.set(Number(p.id), o.kind === 'taxonomy' ? decodeName(p.name) : titleOf(p)),
        );
        return out;
    }

    async upsertRows(ctx: SiteRunCtx, resource: string, o: SiteObjectSettings, rows: WpJson[]): Promise<{ created: number; updated: number }> {
        if (rows.length === 0) return { created: 0, updated: 0 };
        const lookups = await this.lookups(ctx, o, rows);
        await this.attachPluginValues(ctx, o, rows);
        return this.upsert(ctx, resource, rows.map((r) => mapWpItem(o, r, ctx.settings.site_url, lookups)), {});
    }

    /**
     * Lo que da el complemento (SEO, campos con su tipo, palabras, dónde se usa
     * una imagen), leído EN LOTE para la misma tanda y pegado a cada fila. Sin
     * el complemento no se toca nada (quedan los valores anteriores). Una tanda
     * que falla se avisa y no frena la vuelta: lo de WordPress igual se guarda.
     */
    async attachPluginValues(ctx: SiteRunCtx, o: SiteObjectSettings, rows: WpJson[]): Promise<void> {
        const keys = o.columns.map((c) => c.key).filter(isSitePluginColumn);
        if (keys.length === 0 || !ctx.plugin) return;
        const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n) && n > 0);
        try {
            const meta: { mediaIndexBuilding?: boolean } = {};
            const values = await ibcRead(ctx.creds, o.kind, o.object, ids, keys, meta);
            for (const r of rows) {
                const v = values.get(Number(r.id));
                if (v) r[IBC_VALUES] = v;
            }
            if (meta.mediaIndexBuilding) {
                ctx.warnings.add('El sitio está calculando por primera vez dónde se usa cada imagen: esa columna se completa sola en las próximas vueltas.');
                if (ctx.state.plugin && !ctx.state.plugin.media_pending) {
                    ctx.state.plugin = { ...ctx.state.plugin, media_pending: true };
                    await this.saveState(ctx.tenantId, ctx.syncId, { plugin: ctx.state.plugin satisfies SitePluginState });
                }
            }
        } catch (err) {
            ctx.warnings.add(`No pudimos leer los datos del complemento (${o.label}): ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ── Escritura ───────────────────────────────────────────────────────────

    /**
     * Escribe una tanda: crea lo nuevo, actualiza SÓLO lo que cambió. Todo en
     * UNA transacción con el candado de Postgres de la sincronización.
     * `updateOnly` = no crear (marcar como borrado algo que nunca se trajo).
     */
    async upsert(ctx: SiteRunCtx, resource: string, items: MappedSiteItem[], opts: { updateOnly?: boolean }): Promise<{ created: number; updated: number }> {
        const target = ctx.targets[resource];
        if (!target || items.length === 0) return { created: 0, updated: 0 };
        await this.ensureOptions(ctx, resource, target, items);
        const fieldMap = ctx.settings.fields[resource] ?? {};

        // Límite de registros del plan (SEC-09): se cuenta lo NUEVO antes de escribir.
        const known = await this.tenantDb.withTenant(ctx.tenantId, (tx) => this.existingLinks(tx, ctx, resource, items.map((i) => i.externalId)));
        const newCount = opts.updateOnly ? 0 : items.filter((i) => !known.has(i.externalId)).length;
        if (newCount > 0) {
            try {
                await this.billing.assertCanCreateRecords(ctx.tenantId, newCount);
            } catch {
                throw new SiteSyncStopped(
                    'Se llegó al límite de registros de tu plan: la sincronización se detuvo. Sube de plan o trae menos tipos de contenido.',
                );
            }
        }

        const result = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${ctx.syncId})`);
            const links = await this.existingLinks(tx, ctx, resource, items.map((i) => i.externalId));
            const recordIds = [...new Set([...links.values()])];
            const current = recordIds.length
                ? await tx
                      .select({ id: records.id, data: records.data })
                      .from(records)
                      .where(and(eq(records.tenantId, ctx.tenantId), inArray(records.id, recordIds), isNull(records.deletedAt)))
                : [];
            const byId = new Map(current.map((r) => [r.id, r.data]));
            const toCreate: Array<{ item: MappedSiteItem; data: Record<string, unknown> }> = [];
            const toUpdate: Array<{ id: number; before: Record<string, unknown>; after: Record<string, unknown> }> = [];
            for (const item of items) {
                const data = this.buildData(ctx, target, fieldMap, item);
                const linked = links.get(item.externalId);
                const before = linked !== undefined ? byId.get(linked) : undefined;
                if (linked !== undefined && before) {
                    if (Object.keys(data).some((k) => !sameValue(before[k], data[k]))) {
                        toUpdate.push({ id: linked, before, after: { ...before, ...data } });
                    }
                } else if (!opts.updateOnly) {
                    toCreate.push({ item, data });
                }
            }
            const created: Array<{ id: number; data: Record<string, unknown>; item: MappedSiteItem }> = [];
            for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
                const chunk = toCreate.slice(i, i + INSERT_CHUNK);
                const rows = await tx
                    .insert(records)
                    .values(chunk.map((c) => ({ tenantId: ctx.tenantId, listId: target.listId, data: c.data, createdBy: ctx.actorId })))
                    .returning({ id: records.id });
                rows.forEach((r, j) => created.push({ id: r.id, data: chunk[j]!.data, item: chunk[j]!.item }));
            }
            if (created.length > 0) {
                await tx
                    .insert(syncLinks)
                    .values(
                        created.map((c) => ({
                            tenantId: ctx.tenantId,
                            syncId: ctx.syncId,
                            resource,
                            externalId: c.item.externalId,
                            parentExternalId: null,
                            recordId: c.id,
                        })),
                    )
                    .onConflictDoUpdate({
                        target: [syncLinks.syncId, syncLinks.resource, syncLinks.externalId],
                        set: { recordId: sql`excluded.record_id`, updatedAt: new Date() },
                    });
            }
            for (const u of toUpdate) {
                await tx
                    .update(records)
                    .set({ data: u.after, updatedAt: new Date(), updatedBy: 0 })
                    .where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, u.id)));
                if (ctx.dispatch) {
                    await this.activity.logInTx(tx, {
                        tenantId: ctx.tenantId,
                        listId: target.listId,
                        recordId: u.id,
                        userId: null,
                        action: 'record_updated',
                        diff: computeDiff(u.before, u.after),
                    });
                }
            }
            return { created, toUpdate };
        });

        if (result.created.length > 0 || result.toUpdate.length > 0) ctx.touchedLists.add(target.listId);
        if (ctx.dispatch) {
            for (const c of result.created) {
                this.automations.dispatch({ tenantId: ctx.tenantId, listId: target.listId, recordId: c.id, trigger: 'record_created', after: c.data });
            }
            for (const u of result.toUpdate) {
                this.automations.dispatch({ tenantId: ctx.tenantId, listId: target.listId, recordId: u.id, trigger: 'record_updated', after: u.after, before: u.before });
            }
        }
        return { created: result.created.length, updated: result.toUpdate.length };
    }

    private async existingLinks(tx: Tx, ctx: SiteRunCtx, resource: string, ids: string[]): Promise<Map<string, number>> {
        if (ids.length === 0) return new Map();
        const rows = await tx
            .select({ externalId: syncLinks.externalId, recordId: syncLinks.recordId })
            .from(syncLinks)
            .where(and(eq(syncLinks.syncId, ctx.syncId), eq(syncLinks.resource, resource), inArray(syncLinks.externalId, [...new Set(ids)])));
        return new Map(rows.map((r) => [r.externalId, r.recordId]));
    }

    /** clave de columna → `f{id}`, validando cada valor contra el campo REAL de hoy. */
    private buildData(ctx: SiteRunCtx, target: ListTarget, fieldMap: Record<string, number>, item: MappedSiteItem): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(item.values)) {
            if (raw === undefined) continue;
            const field = target.fields.get(fieldMap[key] ?? -1);
            if (!field || !isDataField(field)) continue;
            if (raw === null) {
                out[`f${field.id}`] = null;
                continue;
            }
            const v = validateFieldValue({ type: field.type, config: field.config, is_required: false }, raw);
            if (v.ok) out[`f${field.id}`] = v.value;
            else ctx.warnings.add(`${field.label}: ${v.error} (valor «${String(raw).slice(0, 60)}»)`);
        }
        return out;
    }

    /** Términos y estados que no existen como opción del select: se suman. */
    private async ensureOptions(ctx: SiteRunCtx, resource: string, target: ListTarget, items: MappedSiteItem[]): Promise<void> {
        const fieldMap = ctx.settings.fields[resource] ?? {};
        const wanted = new Map<string, Map<string, string>>();
        for (const it of items) {
            for (const [key, opts] of Object.entries(it.options)) {
                if (!wanted.has(key)) wanted.set(key, new Map());
                for (const o of opts) wanted.get(key)!.set(o.value, o.label);
            }
        }
        const palette = ['sky', 'violet', 'amber', 'emerald', 'rose', 'blue', 'orange', 'pink', 'teal', 'slate'];
        for (const [key, values] of wanted) {
            const field = target.fields.get(fieldMap[key] ?? -1);
            if (!field || (field.type !== 'select' && field.type !== 'multi_select')) continue;
            const current = Array.isArray(field.config.options) ? (field.config.options as Array<{ value: string; label?: string }>) : [];
            const have = new Map(current.map((o) => [o.value, o.label ?? o.value]));
            const missing = [...values].filter(([v]) => !have.has(v));
            // Un término renombrado en WordPress cambia la etiqueta de su opción. Un valor
            // sin etiqueta propia (un select de ACF por el complemento llega con su valor,
            // `disponible`) nunca pisa la etiqueta que se le puso («Disponible»).
            const renamed = [...values].filter(([v, label]) => have.has(v) && label !== v && have.get(v) !== label);
            if (missing.length === 0 && renamed.length === 0) continue;
            const relabel = new Map(renamed);
            const options = [
                ...current.map((o) => (relabel.has(o.value) ? { ...o, label: relabel.get(o.value)! } : o)),
                ...missing.map(([value, label], i) => ({ value, label, color: palette[(current.length + i) % palette.length] })),
            ];
            try {
                const updated = await this.fields.update(ctx.tenantId, String(target.listId), String(field.id), { config: { ...field.config, options } }, { internal: true });
                target.fields.set(updated.id, updated);
            } catch (err) {
                ctx.warnings.add(`No se pudieron agregar opciones a «${field.label}»: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    /**
     * Lo que ya no está en el sitio (se borró del todo): el registro NO se
     * borra (los datos son de la empresa, ADR-S09) — queda en «Papelera».
     */
    private async markMissing(ctx: SiteRunCtx, resource: string, seen: Set<string>): Promise<void> {
        const target = ctx.targets[resource];
        const statusField = ctx.settings.fields[resource]?.status;
        if (!target || !statusField) return;
        const key = `f${statusField}`;
        const changed = await this.tenantDb.withTenant(ctx.tenantId, async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${ctx.syncId})`);
            // Se leen todos los vínculos del recurso y se filtra aquí: un sitio
            // con decenas de miles de entradas pasaría el tope de parámetros de
            // un `NOT IN`.
            const linked = await tx
                .select({ externalId: syncLinks.externalId, id: records.id, data: records.data })
                .from(syncLinks)
                .innerJoin(records, eq(records.id, syncLinks.recordId))
                .where(
                    and(
                        eq(syncLinks.syncId, ctx.syncId),
                        eq(syncLinks.resource, resource),
                        isNull(records.deletedAt),
                        sql`coalesce(${records.data}->>${key}, '') <> 'trash'`,
                    ),
                );
            const gone = linked.filter((l) => !seen.has(l.externalId));
            for (const g of gone) {
                const after = { ...g.data, [key]: 'trash' };
                await tx.update(records).set({ data: after, updatedAt: new Date(), updatedBy: 0 }).where(and(eq(records.tenantId, ctx.tenantId), eq(records.id, g.id)));
                if (ctx.dispatch) {
                    await this.activity.logInTx(tx, {
                        tenantId: ctx.tenantId,
                        listId: target.listId,
                        recordId: g.id,
                        userId: null,
                        action: 'record_updated',
                        diff: computeDiff(g.data, after),
                    });
                }
            }
            return gone.length;
        });
        if (changed > 0) ctx.touchedLists.add(target.listId);
    }

    // ── Edición: lo que se cambió en la app viaja al sitio ──────────────────

    /**
     * Manda al sitio lo que cambió en un registro. Los valores se leen AHORA
     * (si la edición se revirtió, se manda lo que el sitio ya tenía: inocuo).
     * Lo que el sitio devuelve se aplica sin disparar nada (WordPress limpia
     * un slug, por ejemplo). Si el sitio RECHAZA el cambio, se vuelve a leer
     * el objeto y la app queda con lo que tiene WordPress, con el motivo.
     */
    async push(tenantId: number, syncId: number, creds: IntegrationCreds, recordId: number, changedFieldIds: number[]): Promise<{ sent: string[] } | null> {
        const ctx = await this.context(tenantId, syncId, creds, '');
        if (!ctx) return null;
        const found = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [link] = await tx
                .select({ resource: syncLinks.resource, externalId: syncLinks.externalId })
                .from(syncLinks)
                .where(and(eq(syncLinks.syncId, syncId), eq(syncLinks.recordId, recordId)))
                .limit(1);
            const [rec] = await tx
                .select({ data: records.data })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.id, recordId), isNull(records.deletedAt)))
                .limit(1);
            return link && rec ? { link, data: rec.data } : null;
        });
        if (!found) return null;
        const resource = found.link.resource;
        const o = ctx.settings.objects[resource];
        if (!o) return null;
        const changed = new Set(changedFieldIds);
        const values: Record<string, unknown> = {};
        for (const [key, fieldId] of Object.entries(ctx.settings.fields[resource] ?? {})) {
            if (changed.has(fieldId)) values[key] = found.data[`f${fieldId}`] ?? null;
        }
        if (!ctx.settings.write_back) return null;
        // Términos: la API sólo acepta ids, así que se buscan (o se crean) antes.
        const termIds: Record<string, number[]> = {};
        for (const key of Object.keys(values)) {
            if (!key.startsWith('tax:') || !o.editable.includes(key)) continue;
            const tax = o.taxonomies.find((t) => `tax:${t.taxonomy}` === key);
            if (!tax) continue;
            const fieldId = ctx.settings.fields[resource]?.[key];
            const field = fieldId ? ctx.targets[resource]?.fields.get(fieldId) : undefined;
            termIds[key] = await this.resolveTerms(ctx, tax, Array.isArray(values[key]) ? (values[key] as unknown[]).map(String) : [], optionLabels(field));
        }
        const req = buildWpWriteBack(o, found.link.externalId, values, termIds);
        const pluginValues = pluginWriteValues(o, values);
        if (!req && Object.keys(pluginValues).length === 0) return null;
        const route = `${wpCollectionRoute(o)}/${found.link.externalId}`;
        const query: Array<[string, string]> = [['context', 'edit'], ['_fields', wpFieldsParam(o)]];
        const sent: string[] = [];
        let res: unknown = null;
        let pluginError: string | null = null;
        if (Object.keys(pluginValues).length > 0) {
            // Lo del complemento primero: si el sitio ya no lo tiene, se dice (y lo de WordPress igual viaja).
            if (!ctx.plugin) {
                pluginError = PLUGIN_MISSING_WRITE;
            } else {
                const [result] = await ibcWrite(creds, o.kind, o.object, [{ id: Number(found.link.externalId), values: pluginValues }]);
                const errors = Object.entries(result?.errors ?? {});
                const labels = new Map(o.columns.map((c) => [c.key, c.label]));
                if (errors.length > 0) pluginError = errors.map(([k, m]) => (k === '*' ? m : `${labels.get(k) ?? k}: ${m}`)).join(' · ');
                sent.push(...Object.keys(pluginValues).filter((k) => !(result?.errors ?? {})[k]));
            }
        }
        if (req) {
            try {
                res = await wpSend(creds, 'POST', req.route, req.body, query);
                sent.push(...req.keys);
            } catch (err) {
                if (err instanceof WpApiError && err.status >= 400 && err.status < 500 && err.kind !== 'auth' && err.kind !== 'not_seen') {
                    const current = await wpGet(creds, req.route, query).catch(() => null);
                    const json = current?.json;
                    if (json && typeof json === 'object' && !Array.isArray(json)) {
                        await this.applyObject(ctx, resource, o, json as WpJson);
                        throw new WpApiError(`${err.message} En la app quedó lo que tiene el sitio.`, err.status, err.kind);
                    }
                }
                throw err;
            }
        }
        // Lo que quedó en el sitio vuelve a la app: el objeto de WordPress y, si
        // hay columnas del complemento, sus valores RELEÍDOS en un pedido aparte
        // (lo que ve Google se recalcula con lo recién guardado).
        let json = res && typeof res === 'object' && !Array.isArray(res) ? (res as WpJson) : null;
        if (!json && (Object.keys(pluginValues).length > 0 || pluginError)) {
            const current = await wpGet(creds, route, query).catch(() => null);
            json = current?.json && typeof current.json === 'object' && !Array.isArray(current.json) ? (current.json as WpJson) : null;
        }
        if (json) await this.applyObject(ctx, resource, o, json);
        if (pluginError) throw new WpApiError(`${pluginError}${json ? ' En la app quedó lo que tiene el sitio.' : ''}`, 400, 'invalid');
        return { sent };
    }

    // ── Avisos en tiempo real ───────────────────────────────────────────────

    /**
     * Lo que avisó el complemento (ya verificado). Cada objeto se VUELVE A LEER
     * del sitio con los permisos de la conexión (el aviso sólo trae el id):
     * guardado o en la papelera → se trae como está; borrado → queda en
     * «Papelera» en la app (nunca se borra nada, ADR-S09).
     */
    async applyEvents(tenantId: number, syncId: number, creds: IntegrationCreds, events: SiteHookEvent[]): Promise<{ applied: number }> {
        const ctx = await this.context(tenantId, syncId, creds, '');
        if (!ctx) return { applied: 0 };
        ctx.dispatch = ctx.state.initial_done;
        const byResource = new Map<string, { o: SiteObjectSettings; saved: Set<number>; deleted: Set<number> }>();
        for (const e of events) {
            const kind: SiteObjectKind = e.kind === 'term' ? 'taxonomy' : e.kind === 'media' ? 'media' : 'post_type';
            const resource = kind === 'media' ? 'media:attachment' : `${kind === 'taxonomy' ? 'term' : 'post'}:${e.object}`;
            const o = ctx.settings.objects[resource];
            if (!o || !ctx.targets[resource]) continue;
            const bucket = byResource.get(resource) ?? { o, saved: new Set<number>(), deleted: new Set<number>() };
            if (e.action === 'deleted') {
                bucket.deleted.add(e.id);
                bucket.saved.delete(e.id);
            } else if (!bucket.deleted.has(e.id)) {
                bucket.saved.add(e.id);
            }
            byResource.set(resource, bucket);
        }
        let applied = 0;
        for (const [resource, { o, saved, deleted }] of byResource) {
            const ids = [...saved];
            const fields = wpFieldsParam(o);
            const statuses = o.kind === 'taxonomy' ? [null] : o.kind === 'media' ? ['inherit,private', 'trash'] : ['any', 'trash'];
            let pending = ids;
            for (const status of statuses) {
                if (pending.length === 0) break;
                const found: WpJson[] = [];
                for (let i = 0; i < pending.length; i += WP_PAGE_SIZE) {
                    const chunk = pending.slice(i, i + WP_PAGE_SIZE);
                    const query: Array<[string, string]> = [
                        ['context', 'edit'],
                        ['include', chunk.join(',')],
                        ['per_page', String(WP_PAGE_SIZE)],
                        ['_fields', fields],
                    ];
                    if (status) query.push(['status', status]);
                    if (o.kind === 'taxonomy') query.push(['hide_empty', 'false']);
                    const page = await wpGetPage(ctx.creds, wpCollectionRoute(o), query);
                    found.push(...page.rows);
                }
                if (found.length > 0) {
                    const r = await this.upsertRows(ctx, resource, o, found);
                    applied += r.created + r.updated;
                }
                const got = new Set(found.map((r) => Number(r.id)));
                pending = pending.filter((id) => !got.has(id));
            }
            if (deleted.size > 0) {
                const r = await this.upsert(
                    ctx,
                    resource,
                    [...deleted].map((id) => ({ externalId: String(id), values: { status: 'trash' }, options: {} })),
                    { updateOnly: true },
                );
                applied += r.updated;
            }
        }
        for (const listId of ctx.touchedLists) this.realtime.records(tenantId, listId);
        return { applied };
    }

    /** El objeto tal como quedó en el sitio, sin disparar automatizaciones (no es una novedad del sitio). */
    async applyObject(ctx: SiteRunCtx, resource: string, o: SiteObjectSettings, json: WpJson): Promise<void> {
        ctx.dispatch = false;
        await this.upsertRows(ctx, resource, o, [json]);
        for (const listId of ctx.touchedLists) this.realtime.records(ctx.tenantId, listId);
    }

    /**
     * Ids de WordPress de un conjunto de términos (por su slug, que es el valor
     * de la opción en la app). Los que no existen se CREAN con la etiqueta de
     * la opción: «agregar una categoría» desde la app funciona como en WordPress.
     */
    async resolveTerms(ctx: SiteRunCtx, tax: SiteObjectSettings['taxonomies'][number], slugs: string[], labels: Map<string, string>): Promise<number[]> {
        const known = await this.termsOf(ctx, tax.taxonomy);
        const bySlug = new Map([...known].map(([id, t]) => [t.slug, id]));
        const route = `/${tax.rest_namespace}/${tax.rest_base}`;
        const ids: number[] = [];
        for (const slug of [...new Set(slugs)].slice(0, 50)) {
            let id = bySlug.get(slug) ?? 0;
            if (!(id > 0)) {
                const found = await wpGetPage(ctx.creds, route, [['slug', slug], ['per_page', '1'], ['_fields', 'id,name,slug']]).catch(() => null);
                id = Number(found?.rows[0]?.id) || 0;
            }
            if (!(id > 0)) {
                const label = labels.get(slug) ?? slug;
                try {
                    const made = (await wpSend(ctx.creds, 'POST', route, { name: label, slug })) as WpJson | null;
                    id = Number(made?.id) || 0;
                } catch (err) {
                    // Ya existe con ese NOMBRE pero otro slug (`term_exists`): WordPress dice cuál.
                    const existing = err instanceof WpApiError && err.wp.code === 'term_exists' ? Number(err.wp.data.term_id) : 0;
                    if (existing > 0) id = existing;
                    else {
                        throw new WpApiError(`No pudimos crear «${label}» en ${tax.label}: ${err instanceof Error ? err.message : String(err)}`, err instanceof WpApiError ? err.status : 0);
                    }
                }
                if (id > 0) known.set(id, { slug, name: label });
            }
            if (id > 0) ids.push(id);
        }
        return ids;
    }
}

// ── Utilidades ─────────────────────────────────────────────────────────────

/** Lo que se manda al complemento: SÓLO lo que cambió y está habilitado. */
export function pluginWriteValues(o: SiteObjectSettings, changed: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const editable = new Set(o.editable);
    for (const [key, value] of Object.entries(changed)) {
        if (!isSitePluginColumn(key) || !editable.has(key)) continue;
        const c = o.columns.find((x) => x.key === key);
        if (!c || !c.can_edit) continue;
        out[key] = value === undefined ? null : value;
    }
    return out;
}

/**
 * Cada cuánto corre la próxima vuelta: en tiempo real (con el complemento) es
 * la red de seguridad horaria; sin él, el intervalo elegido.
 */
export function nextRunMinutes(settings: Pick<SiteSyncSettings, 'mode' | 'interval_minutes'>, pluginInstalled: boolean): number {
    return settings.mode === 'realtime' && pluginInstalled ? REALTIME_SWEEP_MINUTES : settings.interval_minutes;
}

/** `modified` del sitio (hora local de WordPress, sin zona). */
function local(row: WpJson): string {
    const v = row.modified;
    return typeof v === 'string' ? v.slice(0, 19) : '';
}

function minusOneSecond(at: string): string {
    const t = Date.parse(`${at}Z`);
    return Number.isFinite(t) ? new Date(t - 1000).toISOString().slice(0, 19) : at;
}

function isDataField(f: Field): boolean {
    return !['relation', 'computed', 'lookup', 'rollup', 'time_tracked', 'created_at', 'updated_at', 'created_by', 'updated_by', 'formula', 'approval', 'checklist_progress', 'button', 'autonumber', 'ai'].includes(f.type);
}

function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if ((a === undefined || a === null) && (b === undefined || b === null)) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

function decodeName(v: unknown): string {
    return typeof v === 'string' ? v.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"') : '';
}

function titleOf(r: WpJson): string {
    const t = r.title;
    if (typeof t === 'string') return t;
    if (t && typeof t === 'object') {
        const o = t as Record<string, unknown>;
        if (typeof o.raw === 'string') return o.raw;
        if (typeof o.rendered === 'string') return o.rendered.replace(/<[^>]*>/g, '');
    }
    return '';
}

function wpSlugText(v: unknown): string {
    const s = typeof v === 'string' ? v : '';
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/** value → etiqueta de las opciones de un select/multi_select. */
function optionLabels(field: Field | undefined): Map<string, string> {
    const out = new Map<string, string>();
    const options = (field?.config as { options?: unknown } | undefined)?.options;
    if (Array.isArray(options)) {
        for (const o of options as Array<{ value?: unknown; label?: unknown }>) {
            if (typeof o.value === 'string') out.set(o.value, typeof o.label === 'string' && o.label !== '' ? o.label : o.value);
        }
    }
    return out;
}

/** «misitio.com» (sin esquema ni ruta), para los títulos de los avisos. */
export function siteHost(url: string | null | undefined): string {
    try {
        return url ? new URL(url).host : '';
    } catch {
        return '';
    }
}
