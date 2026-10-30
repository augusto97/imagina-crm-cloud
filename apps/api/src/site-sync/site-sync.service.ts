import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    SITE_SYNC_PROVIDER,
    fieldSlugSchema,
    isSitePluginColumn,
    siteColumnKeySchema,
    siteCoreColumns,
    siteResourceKey,
    slugify,
    WP_MEDIA_STATUS_OPTIONS,
    WP_POST_STATUS_OPTIONS,
    WP_TERM_STATUS_OPTIONS,
    type AddSiteObjectsInput,
    type BlueprintField,
    type ListBlueprint,
    type Role,
    type SetupSiteSyncInput,
    type SiteColumn,
    type SiteColumnChangeInput,
    type SiteDiscovery,
    type SiteListMarker,
    type SiteObject,
    type SiteObjectChoice,
    type SitePluginInfo,
    type SiteSyncStatus,
    type SourceGoneCount,
    type DismissSiteNoveltiesInput,
    type UpdateSiteSyncInput,
    readMirrorListMarker,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { ActivityService } from '../activity/activity.service';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { parseWpUser, wpRoleLabel, wpSiteUrl } from '../connectors/wordpress/wp-api';
import { revokeWpAppPassword } from '../connectors/wordpress/wp-verify';
import { DRIZZLE, type Db } from '../db/client';
import { connections, connectionSyncs, lists, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListGroupsService } from '../lists/list-groups.service';
import { stripSiteMarkers } from '../lists/store-guard';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { countGoneInList, goneIdsInList, removeGoneInTx } from '../sync/source-gone';
import { computeNovelties, dismissNovelties, pendingNovelties, readNovelties, readSeen } from './site-novelties';
import { SiteRealtimeService } from './site-realtime.service';
import { SiteSyncEngine, nextRunMinutes, type SiteRunOptions } from './site-sync.engine';
import { SiteSyncQueue } from './site-sync.queue';
import { readSiteSettings, readSiteState, type SiteColumnSettings, type SiteObjectSettings, type SiteSyncSettings } from './site-sync.types';
import { SiteWriteBackService } from './site-writeback.service';
import { WordpressPluginService, versionNewer } from './wordpress-plugin.service';
import { ibcColumnToSite, ibcHooksDelete, ibcInfo, ibcSchema, type IbcSchemaObject } from './wordpress/ibc';
import { wpGet, wpGetPage } from './wordpress/wp-fetch';
import { discoverExtraColumns, titleColumnOf } from './wordpress/wp-map';
import { planIncludesSql } from '../billing/plan-module-gate';

/** v0.1.336 — `on_source_delete` es opcional al dar de alta (por defecto, conservar lo borrado). */
type WithOptionalDelete<T extends { on_source_delete: unknown }> = Omit<T, 'on_source_delete'> & { on_source_delete?: T['on_source_delete'] };

/** Lo que el alta necesita de cada columna además de lo que se guarda. */
interface ColumnPlan extends SiteColumnSettings {
    always: boolean;
    hint: string | null;
    /** Lo que declara el plugin (ACF, Meta Box): las opciones de un select y si es una imagen. */
    options: Array<{ value: string; label: string }> | null;
    image: boolean;
}

/** Cada cuánto se revisa solo si el sitio tiene tipos de contenido o columnas nuevas. */
const NOVELTIES_EVERY_MS = 24 * 60 * 60 * 1000;

/** Tipos de contenido que nunca se ofrecen (no son contenido del sitio). */
const HIDDEN_TYPES = new Set(['attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face']);
const HIDDEN_TAXONOMIES = new Set(['nav_menu', 'wp_pattern_category', 'link_category', 'post_format', 'wp_theme', 'wp_template_part_area']);

/**
 * Sincronización con sitios WordPress — lo que ve y toca la persona (v0.1.333,
 * ADR-S83). El trabajo pesado lo hace `SiteSyncEngine` en la cola; aquí se
 * descubre qué tiene el sitio, se arman las listas con SÓLO las columnas
 * elegidas, se guardan los ajustes y se arma el estado de la página del sitio.
 */
@Injectable()
export class SiteSyncService {
    private readonly logger = new Logger(SiteSyncService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly connectors: ConnectorsService,
        private readonly blueprints: BlueprintService,
        private readonly groups: ListGroupsService,
        private readonly fields: FieldsService,
        private readonly audit: AuditService,
        private readonly engine: SiteSyncEngine,
        private readonly queue: SiteSyncQueue,
        private readonly writeBack: SiteWriteBackService,
        private readonly realtime: SiteRealtimeService,
        private readonly plugin: WordpressPluginService,
        private readonly activity: ActivityService,
        @Optional() private readonly rt?: RealtimeService,
    ) {
        // Borrar la CONEXIÓN de un sitio también borra su contraseña de
        // aplicación en WordPress. ANTES de borrar: después ya no hay con qué.
        this.connectors.onBeforeRemove(async (tenantId, connectionId) => {
            const found = await this.connectors.integrationCredsFor(tenantId, connectionId).catch(() => null);
            if (!found || found.provider !== 'wordpress') return;
            const { creds } = found;
            // Y el aviso en tiempo real del complemento (si estaba): que deje de anotar.
            await ibcHooksDelete(creds).catch(() => undefined);
            const login = (creds.fields.user_login ?? '').trim();
            if (login === '' || creds.secret === '') return;
            await revokeWpAppPassword(
                { base: wpSiteUrl(creds.fields.site_url ?? ''), style: creds.fields.api_style === 'plain' ? 'plain' : 'pretty' },
                login,
                creds.secret,
            );
        });
    }

    // ── Descubrir qué hay en el sitio ───────────────────────────────────────

    async discover(tenantId: number, userId: number, role: Role, connectionId: number): Promise<SiteDiscovery> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const creds = await this.credsOf(tenantId, connectionId);
        const row = await this.findSync(tenantId, connectionId);
        const settings = row ? readSiteSettings(row.settings) : null;
        const synced = new Set(Object.keys(settings?.objects ?? {}));
        const discovery = await this.discoverWith(creds, conn.name, synced, syncedColumns(settings));
        // De paso, las novedades del sitio quedan al día (ya se miró todo).
        if (row && settings) await this.saveNovelties(tenantId, row, settings, discovery).catch(() => undefined);
        return discovery;
    }

    // ── Novedades del sitio (v0.1.336) ──────────────────────────────────────

    /** Compara lo que ofrece hoy el sitio con la base y guarda las novedades. */
    private async saveNovelties(
        tenantId: number,
        row: Pick<typeof connectionSyncs.$inferSelect, 'id' | 'connectionId' | 'state'>,
        settings: SiteSyncSettings,
        discovery: SiteDiscovery,
    ): Promise<void> {
        const { items, seen } = computeNovelties(discovery, readSeen(row.state), settings);
        await this.engine.saveState(tenantId, row.id, { seen, novelties: { checked_at: new Date().toISOString(), items, error: null } });
        await this.markLists(tenantId, row.connectionId, settings);
    }

    /** «Buscar novedades»: vuelve a mirar el sitio ahora. */
    async checkNovelties(tenantId: number, userId: number, role: Role, connectionId: number): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        await this.refreshNovelties(tenantId, row, conn.name);
        return this.toStatus(tenantId, (await this.findSync(tenantId, connectionId)) ?? row);
    }

    private async refreshNovelties(tenantId: number, row: typeof connectionSyncs.$inferSelect, connName: string): Promise<void> {
        const settings = readSiteSettings(row.settings);
        try {
            const creds = await this.credsOf(tenantId, row.connectionId);
            const discovery = await this.discoverWith(creds, connName, new Set(Object.keys(settings.objects)), syncedColumns(settings));
            await this.saveNovelties(tenantId, row, settings, discovery);
        } catch (err) {
            // Lo de antes se conserva; se dice que no se pudo mirar.
            const prev = readNovelties(row.state);
            await this.engine.saveState(tenantId, row.id, {
                novelties: { checked_at: new Date().toISOString(), items: prev?.items ?? [], error: errMessage(err) },
            });
        }
    }

    /** Una vez por día, después de una vuelta (no frena la sincronización si falla). */
    private async refreshNoveltiesIfDue(tenantId: number, syncId: number): Promise<void> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1);
            return r ?? null;
        });
        if (!row) return;
        const last = readNovelties(row.state)?.checked_at;
        if (last && Date.now() - Date.parse(last) < NOVELTIES_EVERY_MS) return;
        const [conn] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ name: connections.name }).from(connections).where(and(eq(connections.tenantId, tenantId), eq(connections.id, row.connectionId))).limit(1),
        );
        await this.refreshNovelties(tenantId, row, conn?.name ?? '');
    }

    /** «Ya lo vi»: esas novedades (o todas) dejan de mostrarse. */
    async dismissNovelties(tenantId: number, userId: number, role: Role, connectionId: number, input: DismissSiteNoveltiesInput): Promise<SiteSyncStatus> {
        await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const prev = readNovelties(row.state);
        const { items, seen } = dismissNovelties(prev?.items ?? [], readSeen(row.state), input.items);
        await this.engine.saveState(tenantId, row.id, { seen, novelties: { checked_at: prev?.checked_at ?? null, items, error: prev?.error ?? null } });
        await this.markLists(tenantId, connectionId, readSiteSettings(row.settings));
        return this.toStatus(tenantId, (await this.findSync(tenantId, connectionId)) ?? row);
    }

    // ── Lo que WordPress ya borró (v0.1.336) ────────────────────────────────

    /** Quita de la app todo lo que el sitio ya borró (al elegir «quitarlo de la app»). */
    private async removeExistingGone(tenantId: number, settings: SiteSyncSettings): Promise<number> {
        let total = 0;
        for (const listId of [...new Set(Object.values(settings.lists))]) {
            const n = await this.tenantDb.withTenant(tenantId, async (tx) => {
                const [l] = await tx.select({ settings: lists.settings }).from(lists).where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId))).limit(1);
                const marker = l ? readMirrorListMarker(l.settings) : null;
                if (!marker) return 0;
                const ids = await goneIdsInList(tx, tenantId, listId, marker);
                return removeGoneInTx(tx, this.activity, tenantId, listId, 'WordPress', ids);
            });
            if (n > 0) this.rt?.records(tenantId, listId);
            total += n;
        }
        return total;
    }

    /**
     * El complemento en el sitio: si está, qué versión, qué plugin de SEO y de
     * campos encontró, y si hay una versión más nueva para instalar.
     */
    private async pluginInfo(creds: IntegrationCreds): Promise<{ info: SitePluginInfo; schema: IbcSchemaObject[] }> {
        const latest = this.plugin.version();
        const found = await ibcInfo(creds);
        if (!found.installed) {
            return {
                info: {
                    installed: false,
                    version: null,
                    latest,
                    outdated: false,
                    seo: null,
                    providers: { acf: false, metabox: false, jetengine: false },
                    can_manage: false,
                    can_hooks: false,
                    signed: false,
                    updates: false,
                    error: found.error,
                },
                schema: [],
            };
        }
        let schema: IbcSchemaObject[] = [];
        let error: string | null = null;
        try {
            schema = await ibcSchema(creds);
        } catch (err) {
            error = `El complemento está, pero no pudimos leer lo que ofrece: ${err instanceof Error ? err.message : String(err)}`;
        }
        const { info } = found;
        return {
            info: {
                installed: true,
                version: info.version,
                latest,
                outdated: versionNewer(latest, info.version),
                seo: info.seo ? { plugin: info.seo.plugin, name: info.seo.name, version: info.seo.version, terms: info.seo.terms, problem: info.seo.problem } : null,
                providers: info.providers,
                can_manage: info.can_manage,
                can_hooks: info.can_hooks,
                signed: info.signed,
                updates: info.updates,
                error,
            },
            schema,
        };
    }

    /**
     * Tipos de contenido y taxonomías con API, y en una muestra de cada uno los
     * campos de ACF y personalizados que aparecen. Una muestra que falla (un
     * tipo que un plugin registra mal) se avisa y no frena el resto.
     */
    private async discoverWith(
        creds: IntegrationCreds,
        connName: string,
        synced: Set<string>,
        syncedCols: Map<string, Set<string>> = new Map(),
    ): Promise<SiteDiscovery> {
        const warnings: string[] = [];
        const plugin = await this.pluginInfo(creds);
        if (plugin.info.error) warnings.push(plugin.info.error);
        if (plugin.info.seo?.problem) warnings.push(plugin.info.seo.problem);
        /** Las columnas del complemento para un objeto, sin duplicar lo que ya llega por la API. */
        const withPlugin = (kind: SiteObject['kind'], object: string, base: SiteColumn[]): SiteColumn[] => {
            const extra = (plugin.schema.find((x) => x.kind === kind && x.object === object)?.columns ?? []).map(ibcColumnToSite);
            const resource = siteResourceKey(kind, object);
            const have = syncedCols.get(resource) ?? new Set<string>();
            // Un campo de ACF llega de las dos formas: con el complemento se prefiere la suya (tiene el
            // tipo y las opciones), salvo que la lista ya traiga la de la API (no se duplica la columna).
            const pluginAcf = new Set(extra.filter((c) => c.key.startsWith('cf:acf.')).map((c) => c.key.slice('cf:acf.'.length)));
            const core = base.filter((c) => !(c.key.startsWith('acf:') && pluginAcf.has(c.key.slice(4)) && !have.has(c.key)));
            const restAcf = new Set(core.filter((c) => c.key.startsWith('acf:')).map((c) => c.key.slice(4)));
            const fromPlugin = extra.filter((c) => !(c.key.startsWith('cf:acf.') && restAcf.has(c.key.slice('cf:acf.'.length))));
            return [...core, ...validKeys(fromPlugin)];
        };
        const me = parseWpUser(JSON.stringify((await wpGet(creds, '/wp/v2/users/me', [['context', 'edit']])).json));
        if (!me) throw new BadRequestException({ code: 'site_user_unknown', message: 'El sitio no dijo quién es el usuario conectado.', data: { status: 400 } });
        const types = asRecord((await wpGet(creds, '/wp/v2/types', [['context', 'edit']])).json);
        const taxes = asRecord((await wpGet(creds, '/wp/v2/taxonomies', [['context', 'edit']])).json);
        const taxInfo = new Map<string, { label: string; rest_base: string; rest_namespace: string; hierarchical: boolean }>();
        for (const [slug, raw] of Object.entries(taxes)) {
            const t = asRecord(raw);
            const rest = typeof t.rest_base === 'string' ? t.rest_base : '';
            const visibility = asRecord(t.visibility);
            if (!rest || HIDDEN_TAXONOMIES.has(slug) || visibility.show_ui === false) continue;
            taxInfo.set(slug, {
                label: typeof t.name === 'string' ? t.name : slug,
                rest_base: rest,
                rest_namespace: typeof t.rest_namespace === 'string' && t.rest_namespace ? t.rest_namespace : 'wp/v2',
                hierarchical: t.hierarchical === true,
            });
        }
        const objects: SiteObject[] = [];
        let acf = false;
        for (const [slug, raw] of Object.entries(types)) {
            const t = asRecord(raw);
            const rest = typeof t.rest_base === 'string' ? t.rest_base : '';
            if (slug === 'attachment' && rest) {
                // La biblioteca de medios (v0.1.334): con su texto alternativo, título y leyenda.
                let count: number | null = null;
                try {
                    count = (await wpGetPage(creds, `/wp/v2/${rest}`, [['per_page', '1'], ['_fields', 'id']])).total;
                } catch (err) {
                    warnings.push(`${__('Medios')}: ${err instanceof Error ? err.message : String(err)}`);
                }
                objects.push({
                    kind: 'media',
                    object: 'attachment',
                    label: __('Medios'),
                    rest_base: rest,
                    rest_namespace: typeof t.rest_namespace === 'string' && t.rest_namespace ? t.rest_namespace : 'wp/v2',
                    count,
                    hierarchical: false,
                    columns: withPlugin('media', 'attachment', siteCoreColumns('media', { supports: [], hierarchical: false, taxonomies: [] })),
                    synced: synced.has(siteResourceKey('media', 'attachment')),
                });
                continue;
            }
            if (!rest || HIDDEN_TYPES.has(slug) || t.viewable === false) continue;
            const ns = typeof t.rest_namespace === 'string' && t.rest_namespace ? t.rest_namespace : 'wp/v2';
            const supports = Object.entries(asRecord(t.supports)).filter(([, v]) => v === true || (Array.isArray(v) && v.length > 0)).map(([k]) => k);
            const taxonomies = (Array.isArray(t.taxonomies) ? t.taxonomies : [])
                .filter((x): x is string => typeof x === 'string' && taxInfo.has(x))
                .map((x) => ({ taxonomy: x, label: taxInfo.get(x)!.label, rest_base: taxInfo.get(x)!.rest_base }));
            const hierarchical = t.hierarchical === true;
            let count: number | null = null;
            let extra: SiteColumn[] = [];
            try {
                const sample = await wpGetPage(creds, `/${ns}/${rest}`, [['context', 'edit'], ['status', 'any'], ['per_page', '20'], ['_fields', 'id,acf,meta']]);
                count = sample.total;
                extra = discoverExtraColumns(sample.rows);
            } catch (err) {
                warnings.push(`${typeof t.name === 'string' ? t.name : slug}: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (extra.some((c) => c.source === 'acf')) acf = true;
            objects.push({
                kind: 'post_type',
                object: slug,
                label: typeof t.name === 'string' ? t.name : slug,
                rest_base: rest,
                rest_namespace: ns,
                count,
                hierarchical,
                columns: withPlugin('post_type', slug, [...siteCoreColumns('post_type', { supports, hierarchical, taxonomies }), ...validKeys(extra)]),
                synced: synced.has(siteResourceKey('post_type', slug)),
            });
        }
        for (const [slug, info] of taxInfo) {
            let count: number | null = null;
            let extra: SiteColumn[] = [];
            try {
                const sample = await wpGetPage(creds, `/${info.rest_namespace}/${info.rest_base}`, [['context', 'edit'], ['per_page', '20'], ['hide_empty', 'false'], ['_fields', 'id,acf,meta']]);
                count = sample.total;
                extra = discoverExtraColumns(sample.rows);
            } catch (err) {
                warnings.push(`${info.label}: ${err instanceof Error ? err.message : String(err)}`);
            }
            if (extra.some((c) => c.source === 'acf')) acf = true;
            objects.push({
                kind: 'taxonomy',
                object: slug,
                label: info.label,
                rest_base: info.rest_base,
                rest_namespace: info.rest_namespace,
                count,
                hierarchical: info.hierarchical,
                columns: withPlugin('taxonomy', slug, [...siteCoreColumns('taxonomy', { supports: [], hierarchical: info.hierarchical, taxonomies: [] }), ...validKeys(extra)]),
                synced: synced.has(siteResourceKey('taxonomy', slug)),
            });
        }
        const index = await wpGet(creds, '/', [['_fields', 'name']]).catch(() => null);
        const name = typeof asRecord(index?.json).name === 'string' ? String(asRecord(index?.json).name) : '';
        if (!me.canManageTerms) {
            warnings.push('El usuario conectado no puede crear categorías ni etiquetas: podrá elegir las que ya existen, pero no crear nuevas.');
        }
        return {
            site_name: name || siteLabel(connName),
            site_url: creds.fields.site_url ?? '',
            user: { login: me.login, name: me.name, roles: me.roles, can_edit: me.canEdit, can_manage_terms: me.canManageTerms },
            objects,
            acf: acf || plugin.info.providers.acf,
            plugin: plugin.info,
            warnings,
        };
    }

    // ── Estado ──────────────────────────────────────────────────────────────

    async status(tenantId: number, userId: number, role: Role, connectionId: number): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.findSync(tenantId, connectionId);
        if (!row) {
            const creds = await this.credsOf(tenantId, connectionId).catch(() => null);
            return {
                configured: false,
                connection_id: connectionId,
                site_name: siteLabel(conn.name),
                site_url: creds?.fields.site_url ?? '',
                enabled: false,
                interval_minutes: 60,
                mode: 'interval',
                effective_mode: 'interval',
                write_back: true,
                on_source_delete: 'keep',
                gone: [],
                novelties: null,
                folder_id: null,
                objects: [],
                plugin: null,
                plugin_latest: this.plugin.version(),
                realtime: { registered: false, received: 0, last_at: null, error: null },
                running: false,
                current: null,
                initial_done: false,
                last_run_at: null,
                last_success_at: null,
                next_run_at: null,
                last_error: null,
                warnings: [],
                write_back_status: { pushed: 0, failed: 0, last_at: null, last_error: null },
            };
        }
        return this.toStatus(tenantId, row);
    }

    private async toStatus(tenantId: number, row: typeof connectionSyncs.$inferSelect): Promise<SiteSyncStatus> {
        const settings = readSiteSettings(row.settings);
        const state = readSiteState(row.state);
        const { counts, listRows, gone } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const c = await tx
                .select({ resource: syncLinks.resource, n: sql<number>`count(DISTINCT ${syncLinks.recordId})::int` })
                .from(syncLinks)
                .where(eq(syncLinks.syncId, row.id))
                .groupBy(syncLinks.resource);
            const ids = Object.values(settings.lists);
            const l = ids.length
                ? await tx
                      .select({ id: lists.id, slug: lists.slug, name: lists.name, settings: lists.settings })
                      .from(lists)
                      .where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids)))
                : [];
            // v0.1.336 — cuántas filas de cada lista ya se borraron en WordPress.
            const gone: SourceGoneCount[] = [];
            for (const list of l) {
                const marker = readMirrorListMarker(list.settings);
                const n = marker ? await countGoneInList(tx, tenantId, list.id, marker) : 0;
                if (n > 0) gone.push({ list: { id: list.id, slug: list.slug, name: list.name }, count: n });
            }
            return { counts: c, listRows: l, gone };
        });
        const countOf = new Map(counts.map((c) => [c.resource, c.n]));
        const byId = new Map(listRows.map((l) => [l.id, l]));
        const pluginMissing = state.plugin !== null && !state.plugin.installed;
        // JSONB reordena las claves: el orden es el de las listas (el que eligió la persona).
        const order = (resource: string): number => settings.lists[resource] ?? Number.MAX_SAFE_INTEGER;
        const entries = Object.entries(settings.objects).sort(([a], [b]) => order(a) - order(b));
        const objects = entries.map(([resource, o]) => {
            const listId = settings.lists[resource];
            const l = listId ? byId.get(listId) : undefined;
            const p = state.progress[resource];
            const map = settings.fields[resource] ?? {};
            return {
                resource,
                kind: o.kind,
                object: o.object,
                label: o.label,
                list: l ? { id: l.id, slug: l.slug, name: l.name } : null,
                count: countOf.get(resource) ?? 0,
                done: p?.done ?? 0,
                total: p?.total ?? null,
                columns: o.columns.map((c) => ({
                    key: c.key,
                    label: c.label,
                    source: c.source,
                    type: c.type,
                    field_id: map[c.key] ?? null,
                    can_edit: c.can_edit,
                    editable: c.can_edit && o.editable.includes(c.key),
                    always: isAlwaysColumn(o, c.key),
                    hint: columnHint(o, c.key),
                    needs_plugin: pluginMissing && isSitePluginColumn(c.key),
                })),
            };
        });
        return {
            configured: true,
            connection_id: row.connectionId,
            site_name: settings.site_name,
            site_url: settings.site_url,
            enabled: row.enabled,
            interval_minutes: settings.interval_minutes,
            mode: settings.mode,
            effective_mode: settings.mode === 'realtime' && state.plugin?.installed !== false ? 'realtime' : 'interval',
            write_back: settings.write_back,
            on_source_delete: settings.on_source_delete,
            gone,
            novelties: (() => {
                const n = readNovelties(row.state);
                return n ? { ...n, items: pendingNovelties(n.items, settings) } : null;
            })(),
            folder_id: settings.folder_id,
            objects,
            plugin: state.plugin,
            plugin_latest: this.plugin.version(),
            realtime: state.realtime,
            running: state.running,
            current: state.current,
            initial_done: state.initial_done,
            last_run_at: state.last_run_at,
            last_success_at: state.last_success_at,
            next_run_at: row.nextRunAt ? row.nextRunAt.toISOString() : null,
            last_error: state.last_error,
            warnings: state.warnings,
            write_back_status: state.write_back,
        };
    }

    // ── Alta ────────────────────────────────────────────────────────────────

    async setup(tenantId: number, userId: number, role: Role, connectionId: number, input: WithOptionalDelete<SetupSiteSyncInput>): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        if (await this.findSync(tenantId, connectionId)) {
            throw new ConflictException({ code: 'site_sync_exists', message: 'Este sitio ya se está sincronizando.', data: { status: 409 } });
        }
        const creds = await this.credsOf(tenantId, connectionId);
        const discovery = await this.discoverWith(creds, conn.name, new Set());
        if (!discovery.user.can_edit) throw this.cantEdit(discovery);
        const plans = resolveChoices(discovery, input.objects);
        const siteName = discovery.site_name;
        const folder = await this.groups.create(tenantId, { name: `WordPress · ${siteName}`.slice(0, 120), icon: 'globe', color: '#21759B' });
        // En tiempo real sólo con el complemento (sin él no hay quién avise).
        const wantsRealtime = input.mode === 'realtime' && discovery.plugin.installed;
        const settings: SiteSyncSettings = {
            site_url: discovery.site_url,
            site_name: siteName,
            interval_minutes: input.interval_minutes,
            mode: wantsRealtime ? 'realtime' : 'interval',
            write_back: input.write_back,
            on_source_delete: input.on_source_delete ?? 'keep',
            folder_id: folder.id,
            objects: {},
            lists: {},
            fields: {},
        };
        await this.materializeObjects(tenantId, userId, settings, plans, folder.id, discovery.plugin.seo?.name ?? null);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(connectionSyncs)
                .values({
                    tenantId,
                    connectionId,
                    provider: SITE_SYNC_PROVIDER,
                    settings: settings as unknown as Record<string, unknown>,
                    state: {
                        // Lo que el sitio ofrece hoy es la base de las novedades (v0.1.336).
                        seen: computeNovelties(discovery, null, settings).seen,
                        novelties: { checked_at: new Date().toISOString(), items: [], error: null },
                        plugin: {
                            installed: discovery.plugin.installed,
                            version: discovery.plugin.version,
                            seo_name: discovery.plugin.seo?.name ?? null,
                            checked_at: new Date().toISOString(),
                            missing_since: null,
                        },
                    },
                    enabled: true,
                    nextRunAt: new Date(Date.now() + nextRunMinutes(settings, discovery.plugin.installed) * 60_000),
                    createdBy: userId,
                })
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'site_sync.create',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { objects: Object.keys(settings.objects), write_back: input.write_back, interval_minutes: input.interval_minutes, mode: settings.mode },
            });
            return created!;
        });
        await this.markLists(tenantId, connectionId, settings);
        this.writeBack.forget(tenantId);
        let fresh = row;
        if (wantsRealtime) {
            try {
                await this.realtime.register(tenantId, row.id, creds, settings);
            } catch (err) {
                // No se pudo: corre por intervalos y se dice por qué (no frena el alta).
                fresh = await this.setMode(tenantId, row.id, 'interval');
                await this.realtime.saveRealtime(tenantId, row.id, { registered: false, error: errMessage(err) });
            }
        }
        this.queue.enqueueRun(tenantId, row.id, { full: true });
        return this.toStatus(tenantId, (await this.findSync(tenantId, connectionId)) ?? fresh);
    }

    private async setMode(tenantId: number, syncId: number, mode: 'interval' | 'realtime') {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).for('update');
            const s = readSiteSettings(locked!.settings);
            s.mode = mode;
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, syncId))
                .returning();
            return next!;
        });
    }

    /** Sumar tipos de contenido a una sincronización que ya existe. */
    async addObjects(tenantId: number, userId: number, role: Role, connectionId: number, input: AddSiteObjectsInput): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const before = readSiteSettings(row.settings);
        const creds = await this.credsOf(tenantId, connectionId);
        const discovery = await this.discoverWith(creds, conn.name, new Set(Object.keys(before.objects)));
        const plans = resolveChoices(discovery, input.objects).filter((p) => !before.objects[p.resource]);
        if (plans.length === 0) {
            throw new BadRequestException({ code: 'site_objects_exist', message: 'Esos tipos de contenido ya se sincronizan.', data: { status: 400 } });
        }
        const added: SiteSyncSettings = { ...before, objects: {}, lists: {}, fields: {} };
        await this.materializeObjects(tenantId, userId, added, plans, before.folder_id, discovery.plugin.seo?.name ?? null);
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            Object.assign(s.objects, added.objects);
            Object.assign(s.lists, added.lists);
            Object.assign(s.fields, added.fields);
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'site_sync.update',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { added: Object.keys(added.objects) },
            });
            return next!;
        });
        await this.markLists(tenantId, connectionId, readSiteSettings(fresh.settings));
        this.writeBack.forget(tenantId);
        // En tiempo real: el aviso del sitio tiene que incluir lo nuevo.
        const freshSettings = readSiteSettings(fresh.settings);
        if (freshSettings.mode === 'realtime') await this.realtime.ensure(tenantId, row.id, creds, freshSettings).catch(() => undefined);
        this.queue.enqueueRun(tenantId, row.id, { full: true, only: Object.keys(added.objects) });
        return this.toStatus(tenantId, fresh);
    }

    /**
     * Crea una lista por tipo de contenido (dentro de la carpeta del sitio) con
     * SÓLO las columnas elegidas, y llena `settings` con lo creado.
     */
    private async materializeObjects(
        tenantId: number,
        userId: number,
        settings: SiteSyncSettings,
        plans: ObjectPlan[],
        folderId: number | null,
        seoName: string | null = null,
    ): Promise<void> {
        const pack: ListBlueprint = { version: 1, lists: [], dashboards: [] };
        const slugsByPlan: Array<Map<string, string>> = [];
        for (const [i, p] of plans.entries()) {
            const slugs = new Map<string, string>();
            const used = new Set<string>();
            const blueprintFields: BlueprintField[] = orderColumns(p.columns).map((c) => {
                const slug = uniqueSlug(columnSlug(c), used);
                slugs.set(c.key, slug);
                return {
                    label: c.label,
                    slug,
                    type: c.type,
                    config: columnConfig(p.kind, c),
                    is_required: false,
                    is_unique: false,
                    is_indexed: false,
                    description: columnDescription(c, seoName),
                };
            });
            const title = slugs.get(titleColumnOf(p.kind));
            pack.lists.push({
                key: `o${i}`,
                name: p.label.slice(0, 190),
                icon: objectIcon(p.kind, p.object),
                color: '#21759B',
                settings: title ? { title_field_id: { $field: title } } : {},
                fields: blueprintFields,
                views: [],
                automations: [],
                records: [],
                record_templates: [],
                booking_pages: [],
            });
            slugsByPlan.push(slugs);
        }
        const made = await this.blueprints.materialize(tenantId, userId, pack, { includeRecords: false, groupId: folderId });
        if (made.warnings.length > 0) this.logger.warn(`Listas del sitio con avisos: ${made.warnings.join(' | ')}`);
        for (const [i, p] of plans.entries()) {
            const list = made.lists[i];
            if (!list) continue;
            const bySlug = made.fieldIds[`o${i}`] ?? {};
            const map: Record<string, number> = {};
            for (const [key, slug] of slugsByPlan[i]!) {
                if (bySlug[slug]) map[key] = bySlug[slug]!;
            }
            settings.lists[p.resource] = list.id;
            settings.fields[p.resource] = map;
            settings.objects[p.resource] = {
                kind: p.kind,
                object: p.object,
                label: p.label,
                rest_base: p.rest_base,
                rest_namespace: p.rest_namespace,
                hierarchical: p.hierarchical,
                columns: p.columns.map(({ key, label, source, type, can_edit, hint }) => ({ key, label, source, type, can_edit, hint: source === 'core' ? null : hint })),
                editable: p.editable,
                taxonomies: p.taxonomies,
            };
        }
    }

    private cantEdit(d: SiteDiscovery): BadRequestException {
        return new BadRequestException({
            code: 'site_user_cannot_edit',
            message: `El usuario «${d.user.login}» no tiene permiso para editar en WordPress (es «${wpRoleLabel(d.user.roles)}»). Conecta un usuario Editor o Administrador.`,
            data: { status: 400 },
        });
    }

    // ── Cambios ─────────────────────────────────────────────────────────────

    async update(tenantId: number, userId: number, role: Role, connectionId: number, input: UpdateSiteSyncInput): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const before = readSiteSettings(row.settings);
        // Cambiar el modo habla con el sitio ANTES de guardar: si el aviso no se
        // puede registrar, el modo no cambia y se dice por qué.
        if (input.mode && input.mode !== before.mode) {
            const creds = await this.credsOf(tenantId, connectionId);
            if (input.mode === 'realtime') {
                const found = await ibcInfo(creds);
                if (!found.installed) {
                    throw new BadRequestException({
                        code: 'site_plugin_missing',
                        message: 'Para el modo en tiempo real hace falta el complemento para WordPress activo en el sitio. Instálalo desde esta página y vuelve a intentar.',
                        data: { status: 400 },
                    });
                }
                await this.realtime.register(tenantId, row.id, creds, before);
            } else {
                await this.realtime.unregister(tenantId, row.id, creds);
            }
        }
        const pluginInstalled = readSiteState(row.state).plugin?.installed !== false;
        const updated = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            if (input.interval_minutes !== undefined) s.interval_minutes = input.interval_minutes;
            if (input.write_back !== undefined) s.write_back = input.write_back;
            if (input.mode !== undefined) s.mode = input.mode;
            if (input.on_source_delete !== undefined) s.on_source_delete = input.on_source_delete;
            if (input.editable_toggle) {
                const { resource, key, on } = input.editable_toggle;
                const o = s.objects[resource];
                const c = o?.columns.find((x) => x.key === key);
                if (!o || !c) throw new NotFoundException({ code: 'site_column_not_found', message: 'Esa columna no se trae de este sitio.', data: { status: 404 } });
                if (on && !c.can_edit) {
                    throw new BadRequestException({ code: 'site_column_readonly', message: `«${c.label}» no se puede editar desde la app: la pone WordPress.`, data: { status: 400 } });
                }
                o.editable = on ? [...new Set([...o.editable, key])] : o.editable.filter((k) => k !== key);
            }
            const [next] = await tx
                .update(connectionSyncs)
                .set({
                    settings: s as unknown as Record<string, unknown>,
                    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
                    nextRunAt: new Date(Date.now() + nextRunMinutes(s, pluginInstalled) * 60_000),
                    updatedAt: new Date(),
                })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'site_sync.update',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
                meta: { ...input },
            });
            return next!;
        });
        const after = readSiteSettings(updated.settings);
        await this.markLists(tenantId, connectionId, after);
        this.writeBack.forget(tenantId);
        // «Quitarlo de la app» vale también para lo que ya estaba marcado como borrado.
        if (input.on_source_delete === 'remove' && before.on_source_delete !== 'remove') await this.removeExistingGone(tenantId, after);
        return this.toStatus(tenantId, updated);
    }

    /** Traer una columna más: se crea el campo y se recorre ese tipo de contenido para llenarlo. */
    async addColumn(tenantId: number, userId: number, role: Role, connectionId: number, input: SiteColumnChangeInput): Promise<SiteSyncStatus> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const before = readSiteSettings(row.settings);
        const o = before.objects[input.resource];
        const listId = before.lists[input.resource];
        if (!o || !listId) throw new NotFoundException({ code: 'site_object_not_found', message: 'Ese tipo de contenido no se sincroniza.', data: { status: 404 } });
        if (o.columns.some((c) => c.key === input.key)) {
            throw new ConflictException({ code: 'site_column_exists', message: 'Esa columna ya se trae.', data: { status: 409 } });
        }
        const creds = await this.credsOf(tenantId, connectionId);
        const discovery = await this.discoverWith(creds, conn.name, new Set());
        const found = discovery.objects.find((x) => siteResourceKey(x.kind, x.object) === input.resource)?.columns.find((c) => c.key === input.key);
        if (!found) throw new BadRequestException({ code: 'site_column_unknown', message: 'El sitio ya no tiene esa columna.', data: { status: 400 } });
        const current = await this.fields.listByListId(tenantId, listId);
        const field = await this.fields.create(tenantId, String(listId), {
            label: found.label,
            slug: uniqueSlug(columnSlug(found), new Set(current.map((f) => f.slug))),
            type: found.type,
            config: columnConfig(o.kind, found),
            description: columnDescription(found, discovery.plugin.seo?.name ?? null),
        });
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            const so = s.objects[input.resource]!;
            so.columns.push({ key: found.key, label: found.label, source: found.source, type: found.type, can_edit: found.can_edit, hint: found.source === 'core' ? null : found.hint });
            s.fields[input.resource] = { ...(s.fields[input.resource] ?? {}), [found.key]: field.id };
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'site_sync.map_column',
                targetType: 'field',
                targetId: field.id,
                targetLabel: found.label,
                meta: { resource: input.resource, key: input.key },
            });
            return next!;
        });
        await this.markLists(tenantId, connectionId, readSiteSettings(fresh.settings));
        this.writeBack.forget(tenantId);
        // Para llenar lo que ya estaba hay que pasar por todos.
        this.queue.enqueueRun(tenantId, row.id, { full: true, only: [input.resource] });
        return this.toStatus(tenantId, fresh);
    }

    /**
     * Traer varias columnas de una vez (lo que necesita un kit): crea los campos
     * que faltan y recorre ese tipo de contenido UNA vez para llenarlos. Las
     * que el sitio no ofrece se devuelven en `missing` (sin error: el kit dice
     * qué le faltó). Con `editable`, las que se pueden editar quedan habilitadas.
     */
    async ensureColumns(
        tenantId: number,
        userId: number,
        role: Role,
        connectionId: number,
        resource: string,
        keys: string[],
        editable: string[] = [],
    ): Promise<{ settings: SiteSyncSettings; added: string[]; missing: string[]; plugin: SitePluginInfo; syncId: number }> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const before = readSiteSettings(row.settings);
        const o = before.objects[resource];
        const listId = before.lists[resource];
        if (!o || !listId) throw new NotFoundException({ code: 'site_object_not_found', message: 'Ese tipo de contenido no se sincroniza.', data: { status: 404 } });
        const creds = await this.credsOf(tenantId, connectionId);
        const discovery = await this.discoverWith(creds, conn.name, new Set(), syncedColumns(before));
        const offered = discovery.objects.find((x) => siteResourceKey(x.kind, x.object) === resource)?.columns ?? [];
        const have = new Set(o.columns.map((c) => c.key));
        const toAdd = keys.filter((k) => !have.has(k)).map((k) => offered.find((c) => c.key === k)).filter((c): c is SiteColumn => c !== undefined);
        const missing = keys.filter((k) => !have.has(k) && !offered.some((c) => c.key === k));
        const current = await this.fields.listByListId(tenantId, listId);
        const used = new Set(current.map((f) => f.slug));
        const created: Array<{ col: SiteColumn; fieldId: number }> = [];
        for (const c of toAdd) {
            const field = await this.fields.create(tenantId, String(listId), {
                label: c.label,
                slug: uniqueSlug(columnSlug(c), used),
                type: c.type,
                config: columnConfig(o.kind, c),
                description: columnDescription(c, discovery.plugin.seo?.name ?? null),
            });
            created.push({ col: c, fieldId: field.id });
        }
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const st = readSiteSettings(locked!.settings);
            const so = st.objects[resource]!;
            for (const { col, fieldId } of created) {
                so.columns.push({ key: col.key, label: col.label, source: col.source, type: col.type, can_edit: col.can_edit, hint: col.source === 'core' ? null : col.hint });
                st.fields[resource] = { ...(st.fields[resource] ?? {}), [col.key]: fieldId };
            }
            const can = new Set(so.columns.filter((c) => c.can_edit).map((c) => c.key));
            so.editable = [...new Set([...so.editable, ...editable.filter((k) => can.has(k))])];
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: st as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            if (created.length > 0) {
                await this.audit.logInTx(tx, {
                    tenantId,
                    userId,
                    action: 'site_sync.map_column',
                    targetType: 'connection',
                    targetId: connectionId,
                    targetLabel: conn.name,
                    meta: { resource, keys: created.map((c) => c.col.key) },
                });
            }
            return next!;
        });
        const settings = readSiteSettings(fresh.settings);
        await this.markLists(tenantId, connectionId, settings);
        this.writeBack.forget(tenantId);
        if (created.length > 0) this.queue.enqueueRun(tenantId, row.id, { full: true, only: [resource] });
        return { settings, added: created.map((c) => c.col.key), missing, plugin: discovery.plugin, syncId: row.id };
    }

    /** Dejar de traer una columna: el campo y lo que tiene QUEDAN, como una columna propia. */
    async removeColumn(tenantId: number, userId: number, role: Role, connectionId: number, input: SiteColumnChangeInput): Promise<SiteSyncStatus> {
        await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            const o = s.objects[input.resource];
            if (!o || !o.columns.some((c) => c.key === input.key)) {
                throw new NotFoundException({ code: 'site_column_not_found', message: 'Esa columna no se trae de este sitio.', data: { status: 404 } });
            }
            if (isAlwaysColumn(o, input.key)) {
                throw new BadRequestException({ code: 'site_column_required', message: 'Esa columna la necesita la sincronización: no se puede quitar.', data: { status: 400 } });
            }
            o.columns = o.columns.filter((c) => c.key !== input.key);
            o.editable = o.editable.filter((k) => k !== input.key);
            const map = { ...(s.fields[input.resource] ?? {}) };
            delete map[input.key];
            s.fields[input.resource] = map;
            const [next] = await tx
                .update(connectionSyncs)
                .set({ settings: s as unknown as Record<string, unknown>, updatedAt: new Date() })
                .where(eq(connectionSyncs.id, row.id))
                .returning();
            return next!;
        });
        await this.markLists(tenantId, connectionId, readSiteSettings(fresh.settings));
        this.writeBack.forget(tenantId);
        return this.toStatus(tenantId, fresh);
    }

    async runNow(tenantId: number, userId: number, role: Role, connectionId: number, full: boolean): Promise<SiteSyncStatus> {
        await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        this.queue.enqueueRun(tenantId, row.id, { full });
        return this.toStatus(tenantId, row);
    }

    /** Deja de sincronizar. Las listas y sus datos QUEDAN (son de la empresa) y se liberan. */
    async remove(tenantId: number, userId: number, role: Role, connectionId: number): Promise<void> {
        const conn = await this.requireSite(tenantId, userId, role, connectionId);
        const row = await this.requireSync(tenantId, connectionId);
        // El aviso del complemento se apaga en el sitio (si se puede): que deje de anotar cambios.
        if (readSiteSettings(row.settings).mode === 'realtime' || readSiteState(row.state).realtime.registered) {
            const creds = await this.credsOf(tenantId, connectionId).catch(() => null);
            await this.realtime.unregister(tenantId, row.id, creds).catch(() => undefined);
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            await tx.delete(connectionSyncs).where(eq(connectionSyncs.id, row.id));
            await stripSiteMarkers(tx, tenantId, connectionId);
            await this.audit.logInTx(tx, {
                tenantId,
                userId,
                action: 'site_sync.delete',
                targetType: 'connection',
                targetId: connectionId,
                targetLabel: conn.name,
            });
        });
        this.rt?.lists(tenantId);
        this.writeBack.forget(tenantId);
        for (const part of ['run', 'push', 'realtime'] as const) this.engine.siteIncident({ tenantId, connectionId, actorId: 0 }, part, null, '');
    }

    /**
     * Marca cada lista del sitio (`settings.site_sync`): de qué conexión es,
     * qué guarda y qué columnas son del sitio y cuáles se editan. Con eso el
     * backend rechaza lo que WordPress no permitiría y la interfaz lo bloquea
     * antes (`site-rules.ts`). Idempotente: sólo escribe donde cambió.
     */
    async markLists(tenantId: number, connectionId: number, settings: SiteSyncSettings): Promise<void> {
        const markers: Array<[number, SiteListMarker]> = [];
        // Sin el complemento, lo que él da queda con lo último que llegó y bloqueado.
        const row = await this.findSync(tenantId, connectionId);
        const pluginMissing = row ? readSiteState(row.state).plugin?.installed === false : false;
        // v0.1.336 — las columnas nuevas del sitio también se avisan en la lista.
        const novel = row ? pendingNovelties(readNovelties(row.state)?.items ?? [], settings) : [];
        for (const [resource, o] of Object.entries(settings.objects)) {
            const listId = settings.lists[resource];
            if (!listId) continue;
            const can = o.columns.filter((c) => c.can_edit).map((c) => c.key);
            markers.push([
                listId,
                {
                    connection_id: connectionId,
                    resource,
                    kind: o.kind,
                    object: o.object,
                    object_label: o.label,
                    site_name: settings.site_name,
                    site_url: settings.site_url,
                    write_back: settings.write_back,
                    fields: settings.fields[resource] ?? {},
                    can_edit: can,
                    editable: o.editable.filter((k) => can.includes(k)),
                    needs_plugin: pluginMissing ? o.columns.map((c) => c.key).filter(isSitePluginColumn) : [],
                    new_columns: novel.filter((n) => n.resource === resource && n.column).map((n) => n.column!.label),
                },
            ]);
        }
        if (markers.length === 0) return;
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            for (const [listId, marker] of markers) {
                const json = JSON.stringify({ site_sync: marker });
                await tx
                    .update(lists)
                    .set({ settings: sql`${lists.settings} || ${json}::jsonb` })
                    .where(and(eq(lists.tenantId, tenantId), eq(lists.id, listId), sql`${lists.settings}->'site_sync' IS DISTINCT FROM ${json}::jsonb->'site_sync'`));
            }
        });
        // Las pestañas abiertas vuelven a leer la marca (candados, banner, altas).
        this.rt?.lists(tenantId);
    }

    // ── Cola ────────────────────────────────────────────────────────────────

    /** Lo llama el worker. `false` = otra corrida la tenía tomada. */
    async runJob(tenantId: number, syncId: number, opts: SiteRunOptions): Promise<boolean> {
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1);
            return r ?? null;
        });
        if (!row || !row.enabled || row.provider !== SITE_SYNC_PROVIDER) return true;
        let creds: IntegrationCreds;
        try {
            creds = await this.credsOf(tenantId, row.connectionId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await this.engine.saveState(tenantId, syncId, { running: false, last_error: message });
            this.engine.siteIncident({ tenantId, connectionId: row.connectionId, actorId: row.createdBy ?? 0 }, 'run', message, 'No se puede usar la conexión con el sitio');
            return true;
        }
        const settings = readSiteSettings(row.settings);
        await this.markLists(tenantId, row.connectionId, settings).catch(() => undefined);
        const ran = await this.engine.run(tenantId, syncId, creds, opts);
        await this.flagConnection(tenantId, row.connectionId, syncId).catch(() => undefined);
        // La vuelta detectó si el complemento sigue: los candados de las listas siguen eso.
        await this.markLists(tenantId, row.connectionId, settings).catch(() => undefined);
        if (ran && settings.mode === 'realtime') await this.checkRealtime(tenantId, syncId, creds, settings);
        // Una vez por día: ¿hay tipos de contenido o columnas nuevas en el sitio?
        if (ran) await this.refreshNoveltiesIfDue(tenantId, syncId).catch((err: unknown) => this.logger.warn(`Novedades del sitio #${syncId}: ${errMessage(err)}`));
        return ran;
    }

    /**
     * Red de seguridad del modo en tiempo real (en cada vuelta horaria): con el
     * complemento, el aviso se revisa y se vuelve a registrar si hizo falta; sin
     * él, se dice que los cambios llegan en la vuelta (sin romper nada).
     */
    private async checkRealtime(tenantId: number, syncId: number, creds: IntegrationCreds, settings: SiteSyncSettings): Promise<void> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ state: connectionSyncs.state }).from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1));
        const plugin = readSiteState(row?.state).plugin;
        if (plugin?.installed) {
            await this.realtime.ensure(tenantId, syncId, creds, settings);
            return;
        }
        await this.realtime.saveRealtime(tenantId, syncId, {
            registered: false,
            error: `El complemento para WordPress no está activo en el sitio: mientras tanto los cambios llegan en la vuelta de cada ${settings.interval_minutes} minutos. Al instalarlo de nuevo, el tiempo real vuelve solo.`,
        });
    }

    /**
     * Si la corrida terminó porque WordPress rechazó la contraseña (la
     * revocaron), la conexión queda marcada «Hay que volver a conectarla» en
     * Integraciones; al volver a andar se limpia.
     */
    private async flagConnection(tenantId: number, connectionId: number, syncId: number): Promise<void> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) => tx.select({ state: connectionSyncs.state }).from(connectionSyncs).where(eq(connectionSyncs.id, syncId)).limit(1));
        const state = readSiteState(row?.state);
        const raw = (row?.state ?? {}) as Record<string, unknown>;
        const revoked = state.last_error !== null && raw.auth_failed === true;
        await this.connectors.markCheck(tenantId, connectionId, !revoked, revoked ? state.last_error : null);
    }

    /** Tick global (cada minuto): encola las sincronizaciones de sitios que tocan. */
    async tick(): Promise<number> {
        const due = await this.db
            .select({ id: connectionSyncs.id, tenantId: connectionSyncs.tenantId })
            .from(connectionSyncs)
            .where(
                and(
                    eq(connectionSyncs.enabled, true),
                    eq(connectionSyncs.provider, SITE_SYNC_PROVIDER),
                    lte(connectionSyncs.nextRunAt, new Date()),
                    // v0.1.338 (ADR-S87) — sólo si el plan incluye «Sitio WordPress».
                    planIncludesSql(connectionSyncs.tenantId, 'wordpress'),
                ),
            )
            .orderBy(asc(connectionSyncs.nextRunAt))
            .limit(100);
        for (const d of due) {
            // Provisorio: evita re-encolar mientras espera; el motor pone el real al terminar.
            await this.db.update(connectionSyncs).set({ nextRunAt: new Date(Date.now() + 10 * 60_000) }).where(eq(connectionSyncs.id, d.id));
            this.queue.enqueueRun(d.tenantId, d.id, {});
        }
        return due.length;
    }

    /** Credenciales del sitio de una sincronización (para la cola). `null` si ya no se pueden leer. */
    async credsForSync(tenantId: number, syncId: number): Promise<IntegrationCreds | null> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({ connectionId: connectionSyncs.connectionId, enabled: connectionSyncs.enabled, createdBy: connectionSyncs.createdBy })
                .from(connectionSyncs)
                .where(eq(connectionSyncs.id, syncId))
                .limit(1),
        );
        if (!row || !row.enabled) return null;
        return this.credsOf(tenantId, row.connectionId).catch((err: unknown) => {
            this.engine.siteIncident(
                { tenantId, connectionId: row.connectionId, actorId: row.createdBy ?? 0 },
                'push',
                `${err instanceof Error ? err.message : String(err)} Los cambios hechos en la app no se están enviando al sitio: vuelve a conectarlo en Ajustes → Integraciones.`,
                'No se puede usar la conexión con el sitio',
            );
            return null;
        });
    }

    // ── Ayudas ──────────────────────────────────────────────────────────────

    private async requireSite(tenantId: number, userId: number, role: Role, connectionId: number) {
        const conn = await this.connectors.editableConnection(tenantId, userId, role, connectionId);
        if (conn.provider !== 'wordpress') {
            throw new BadRequestException({ code: 'not_a_site', message: 'Esa conexión no es un sitio WordPress.', data: { status: 400 } });
        }
        return conn;
    }

    private async findSync(tenantId: number, connectionId: number) {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [r] = await tx
                .select()
                .from(connectionSyncs)
                .where(and(eq(connectionSyncs.tenantId, tenantId), eq(connectionSyncs.connectionId, connectionId), eq(connectionSyncs.provider, SITE_SYNC_PROVIDER)))
                .limit(1);
            return r ?? null;
        });
    }

    private async requireSync(tenantId: number, connectionId: number) {
        const row = await this.findSync(tenantId, connectionId);
        if (!row) throw new NotFoundException({ code: 'site_sync_not_found', message: 'Este sitio no se está sincronizando.', data: { status: 404 } });
        return row;
    }

    private async credsOf(tenantId: number, connectionId: number): Promise<IntegrationCreds> {
        const found = await this.connectors.integrationCredsFor(tenantId, connectionId);
        if (!found) throw new NotFoundException({ code: 'connection_not_found', message: 'La conexión con el sitio ya no existe.', data: { status: 404 } });
        return found.creds;
    }
}

// ── Alta: de lo elegido a un plan por tipo de contenido ───────────────────

interface ObjectPlan {
    resource: string;
    kind: SiteObjectSettings['kind'];
    object: string;
    label: string;
    rest_base: string;
    rest_namespace: string;
    hierarchical: boolean;
    columns: ColumnPlan[];
    editable: string[];
    taxonomies: SiteObjectSettings['taxonomies'];
}

/**
 * Valida lo elegido contra lo que el SITIO dice que tiene (nunca contra lo que
 * mandó el navegador: el tipo de cada columna lo decide el descubrimiento),
 * suma las columnas obligatorias y deja como editables sólo las que se pueden.
 */
export function resolveChoices(discovery: SiteDiscovery, choices: SiteObjectChoice[]): ObjectPlan[] {
    const seen = new Set<string>();
    const out: ObjectPlan[] = [];
    for (const choice of choices) {
        const resource = siteResourceKey(choice.kind, choice.object);
        if (seen.has(resource)) continue;
        seen.add(resource);
        const obj = discovery.objects.find((o) => o.kind === choice.kind && o.object === choice.object);
        if (!obj) {
            throw new BadRequestException({ code: 'site_object_unknown', message: `El sitio no tiene «${choice.object}» (o no se ve en su API).`, data: { status: 400 } });
        }
        const wanted = new Set(choice.columns);
        const columns: ColumnPlan[] = obj.columns
            .filter((c) => c.always || wanted.has(c.key))
            .map((c) => ({ key: c.key, label: c.label, source: c.source, type: c.type, can_edit: c.can_edit, always: c.always, hint: c.hint, options: c.options, image: c.image }));
        const unknown = choice.columns.filter((k) => !obj.columns.some((c) => c.key === k));
        if (unknown.length > 0) {
            throw new BadRequestException({ code: 'site_column_unknown', message: `«${obj.label}» no tiene ${unknown.map((k) => `«${k}»`).join(', ')}.`, data: { status: 400 } });
        }
        const editable = choice.editable.filter((k) => columns.some((c) => c.key === k && c.can_edit));
        const taxonomies = obj.columns
            .filter((c) => c.key.startsWith('tax:'))
            .map((c) => c.key.slice(4))
            .map((taxonomy) => {
                const t = discovery.objects.find((o) => o.kind === 'taxonomy' && o.object === taxonomy);
                return t ? { taxonomy, label: t.label, rest_base: t.rest_base, rest_namespace: t.rest_namespace } : null;
            })
            .filter((t): t is NonNullable<typeof t> => t !== null);
        out.push({
            resource,
            kind: obj.kind,
            object: obj.object,
            label: obj.label,
            rest_base: obj.rest_base,
            rest_namespace: obj.rest_namespace,
            hierarchical: obj.hierarchical,
            columns,
            editable,
            taxonomies,
        });
    }
    return out;
}

const CORE_SLUGS: Record<string, string> = {
    title: 'titulo',
    name: 'nombre',
    status: 'estado',
    wp_id: 'id_wordpress',
    edit_link: 'editar_en_wordpress',
    link: 'enlace',
    slug: 'direccion',
    date: 'fecha_publicacion',
    modified: 'ultima_modificacion',
    author: 'autor',
    excerpt: 'extracto',
    featured_image: 'imagen_destacada',
    parent: 'superior',
    menu_order: 'orden',
    template: 'plantilla',
    description: 'descripcion',
    count: 'cantidad',
    alt_text: 'texto_alternativo',
    caption: 'leyenda',
    thumbnail: 'imagen',
    source_url: 'archivo',
    mime_type: 'tipo_de_archivo',
    dimensions: 'medidas',
    filesize: 'peso_kb',
    'seo:title': 'titulo_seo',
    'seo:description': 'descripcion_seo',
    'seo:focus_keyword': 'palabra_clave',
    'seo:canonical': 'url_canonica',
    'seo:noindex': 'no_indexar',
    'seo:google_title': 'titulo_en_google',
    'seo:google_description': 'descripcion_en_google',
    'seo:score': 'puntaje_seo',
    'plugin:words': 'palabras',
    'plugin:used_in': 'donde_se_usa',
    'plugin:used_count': 'veces_usada',
};

function columnSlug(c: Pick<SiteColumn, 'key' | 'label'>): string {
    const core = CORE_SLUGS[c.key];
    if (core) return core;
    // `cf:acf.precio` → `precio` (el proveedor no es parte del nombre).
    const name = c.key.startsWith('cf:') ? c.key.slice(c.key.indexOf('.') + 1) : c.key.slice(c.key.indexOf(':') + 1);
    const base = slugify(c.key.startsWith('tax:') ? c.label : name) || 'campo';
    return /^[a-z]/.test(base) ? base.slice(0, 50) : `c_${base}`.slice(0, 50);
}

function uniqueSlug(base: string, used: Set<string>): string {
    let slug = fieldSlugSchema.safeParse(base).success ? base : `wp_${base}`.slice(0, 60);
    let n = 2;
    const root = slug;
    while (used.has(slug)) slug = `${root.slice(0, 58)}_${n++}`;
    used.add(slug);
    return slug;
}

/** Las columnas que se traen hoy, por recurso (para no ofrecer dos veces el mismo dato). */
function syncedColumns(settings: SiteSyncSettings | null): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const [resource, o] of Object.entries(settings?.objects ?? {})) out.set(resource, new Set(o.columns.map((c) => c.key)));
    return out;
}

const PALETTE = ['sky', 'violet', 'amber', 'emerald', 'rose', 'blue', 'orange', 'pink', 'teal', 'slate'];
/** Números que NO llevan decimales (ids, conteos, palabras, puntajes). */
const INTEGER_COLUMNS = new Set(['wp_id', 'count', 'menu_order', 'filesize', 'seo:score', 'plugin:words', 'plugin:used_count']);

function columnConfig(
    kind: SiteObjectSettings['kind'],
    c: Pick<SiteColumn, 'key' | 'type'> & Partial<Pick<SiteColumn, 'options' | 'image'>>,
): Record<string, unknown> {
    if (c.key === 'status') return { options: kind === 'taxonomy' ? WP_TERM_STATUS_OPTIONS : kind === 'media' ? WP_MEDIA_STATUS_OPTIONS : WP_POST_STATUS_OPTIONS };
    if (c.key === 'featured_image' || c.image) return { display: 'image' };
    if (c.type === 'multi_select' || c.type === 'select') {
        // Las opciones que declara el plugin (ACF, Meta Box) llegan desde el alta, con su etiqueta.
        return { options: (c.options ?? []).slice(0, 200).map((o, i) => ({ value: o.value, label: o.label || o.value, color: PALETTE[i % PALETTE.length] })) };
    }
    if (c.type === 'number' && !INTEGER_COLUMNS.has(c.key)) return { precision: 2 };
    return {};
}

function columnDescription(c: Pick<SiteColumn, 'key' | 'source'>, seoName: string | null = null): string {
    if (c.source === 'acf') return `Viene de WordPress (campo de ACF «${c.key.slice(4)}»).`;
    if (c.source === 'meta') return `Viene de WordPress (campo personalizado «${c.key.slice(5)}»).`;
    if (c.source === 'seo') return seoName ? `Viene de WordPress (SEO de ${seoName}, por el complemento).` : 'Viene de WordPress (SEO, por el complemento).';
    if (c.source === 'plugin') {
        const m = /^cf:([a-z]+)\.(.+)$/.exec(c.key);
        const provider = m ? ({ acf: 'ACF', mb: 'Meta Box', je: 'JetEngine', meta: 'un plugin' } as Record<string, string>)[m[1]!] ?? 'un plugin' : null;
        return m ? `Viene de WordPress (campo «${m[2]}» de ${provider}, por el complemento).` : 'Viene de WordPress (por el complemento).';
    }
    return 'Viene de WordPress.';
}

function objectIcon(kind: SiteObjectSettings['kind'], object: string): string {
    if (kind === 'taxonomy') return 'tag';
    if (kind === 'media') return 'image';
    if (object === 'post') return 'newspaper';
    if (object === 'page') return 'file_text';
    return 'note';
}

/** Las columnas que necesita la sincronización (no se pueden quitar). */
function isAlwaysColumn(o: Pick<SiteObjectSettings, 'kind'>, key: string): boolean {
    return [titleColumnOf(o.kind), 'status', 'wp_id', 'edit_link'].includes(key);
}

function columnHint(o: SiteObjectSettings, key: string): string | null {
    const core = siteCoreColumns(o.kind, {
        supports: ['author', 'excerpt', 'thumbnail', 'page-attributes'],
        hierarchical: o.hierarchical,
        taxonomies: o.taxonomies.map((t) => ({ taxonomy: t.taxonomy, label: t.label, rest_base: t.rest_base })),
    }).find((c) => c.key === key);
    if (core) return core.hint;
    const col = o.columns.find((c) => c.key === key);
    if (col?.hint) return col.hint;
    return col && !col.can_edit && col.source !== 'core' ? 'Tiene varias partes (una lista o un grupo): se trae como texto y se edita en WordPress.' : null;
}

function errMessage(err: unknown): string {
    if (err instanceof BadRequestException) {
        const r = err.getResponse();
        if (r && typeof r === 'object' && typeof (r as { message?: unknown }).message === 'string') return (r as { message: string }).message;
    }
    return err instanceof Error ? err.message : String(err);
}

/** Textos de la pantalla (español neutro). */
function __(s: string): string {
    return s;
}

/** Un campo con un nombre raro (con espacios o símbolos) no se puede elegir: se descarta. */
function validKeys(cols: SiteColumn[]): SiteColumn[] {
    return cols.filter((c) => siteColumnKeySchema.safeParse(c.key).success);
}

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** «WordPress · Mi blog» → «Mi blog». */
function siteLabel(connectionName: string): string {
    return connectionName.replace(/^WordPress\s*·\s*/i, '').trim() || connectionName;
}

/**
 * El orden de las columnas en la lista nueva: el título y el estado primero,
 * después los datos (fechas, extracto, categorías, ACF, campos de plugins) y
 * al final lo técnico (el ID, los enlaces, la fecha de modificación). Así lo
 * que se mira y se edita queda a la vista sin correr la tabla.
 */
const TECH_COLUMNS = new Set(['wp_id', 'edit_link', 'link', 'modified', 'count', 'source_url', 'mime_type']);
function columnRank(key: string): number {
    if (key === 'title' || key === 'name') return 0;
    if (key === 'status') return 1;
    return TECH_COLUMNS.has(key) ? 3 : 2;
}
export function orderColumns<T extends { key: string }>(columns: readonly T[]): T[] {
    return columns
        .map((c, i) => ({ c, i }))
        .sort((a, b) => columnRank(a.c.key) - columnRank(b.c.key) || a.i - b.i)
        .map((x) => x.c);
}
