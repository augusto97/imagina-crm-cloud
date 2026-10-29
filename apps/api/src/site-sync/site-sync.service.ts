import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
    SITE_SYNC_PROVIDER,
    fieldSlugSchema,
    siteColumnKeySchema,
    siteCoreColumns,
    siteResourceKey,
    slugify,
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
    type SiteSyncStatus,
    type UpdateSiteSyncInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { ConnectorsService } from '../connectors/connectors.service';
import type { IntegrationCreds } from '../connectors/integration-calls';
import { parseWpUser, wpRoleLabel, wpSiteUrl } from '../connectors/wordpress/wp-api';
import { revokeWpAppPassword } from '../connectors/wordpress/wp-verify';
import { DRIZZLE, type Db } from '../db/client';
import { connectionSyncs, lists, syncLinks } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListGroupsService } from '../lists/list-groups.service';
import { stripSiteMarkers } from '../lists/store-guard';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { BlueprintService } from '../templates/blueprint.service';
import { SiteSyncEngine, type SiteRunOptions } from './site-sync.engine';
import { SiteSyncQueue } from './site-sync.queue';
import { readSiteSettings, readSiteState, type SiteColumnSettings, type SiteObjectSettings, type SiteSyncSettings } from './site-sync.types';
import { SiteWriteBackService } from './site-writeback.service';
import { wpGet, wpGetPage } from './wordpress/wp-fetch';
import { discoverExtraColumns, titleColumnOf } from './wordpress/wp-map';

/** Lo que el alta necesita de cada columna además de lo que se guarda. */
interface ColumnPlan extends SiteColumnSettings {
    always: boolean;
    hint: string | null;
}

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
        @Optional() private readonly rt?: RealtimeService,
    ) {
        // Borrar la CONEXIÓN de un sitio también borra su contraseña de
        // aplicación en WordPress. ANTES de borrar: después ya no hay con qué.
        this.connectors.onBeforeRemove(async (tenantId, connectionId) => {
            const found = await this.connectors.integrationCredsFor(tenantId, connectionId).catch(() => null);
            if (!found || found.provider !== 'wordpress') return;
            const { creds } = found;
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
        const synced = new Set(Object.keys(row ? readSiteSettings(row.settings).objects : {}));
        return this.discoverWith(creds, conn.name, synced);
    }

    /**
     * Tipos de contenido y taxonomías con API, y en una muestra de cada uno los
     * campos de ACF y personalizados que aparecen. Una muestra que falla (un
     * tipo que un plugin registra mal) se avisa y no frena el resto.
     */
    private async discoverWith(creds: IntegrationCreds, connName: string, synced: Set<string>): Promise<SiteDiscovery> {
        const warnings: string[] = [];
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
                columns: [...siteCoreColumns('post_type', { supports, hierarchical, taxonomies }), ...validKeys(extra)],
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
                columns: [...siteCoreColumns('taxonomy', { supports: [], hierarchical: info.hierarchical, taxonomies: [] }), ...validKeys(extra)],
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
            acf,
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
                write_back: true,
                folder_id: null,
                objects: [],
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
        const { counts, listRows } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const c = await tx
                .select({ resource: syncLinks.resource, n: sql<number>`count(DISTINCT ${syncLinks.recordId})::int` })
                .from(syncLinks)
                .where(eq(syncLinks.syncId, row.id))
                .groupBy(syncLinks.resource);
            const ids = Object.values(settings.lists);
            const l = ids.length
                ? await tx.select({ id: lists.id, slug: lists.slug, name: lists.name }).from(lists).where(and(eq(lists.tenantId, tenantId), inArray(lists.id, ids)))
                : [];
            return { counts: c, listRows: l };
        });
        const countOf = new Map(counts.map((c) => [c.resource, c.n]));
        const byId = new Map(listRows.map((l) => [l.id, l]));
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
            write_back: settings.write_back,
            folder_id: settings.folder_id,
            objects,
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

    async setup(tenantId: number, userId: number, role: Role, connectionId: number, input: SetupSiteSyncInput): Promise<SiteSyncStatus> {
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
        const settings: SiteSyncSettings = {
            site_url: discovery.site_url,
            site_name: siteName,
            interval_minutes: input.interval_minutes,
            mode: 'interval',
            write_back: input.write_back,
            folder_id: folder.id,
            objects: {},
            lists: {},
            fields: {},
        };
        await this.materializeObjects(tenantId, userId, settings, plans, folder.id);

        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [created] = await tx
                .insert(connectionSyncs)
                .values({
                    tenantId,
                    connectionId,
                    provider: SITE_SYNC_PROVIDER,
                    settings: settings as unknown as Record<string, unknown>,
                    state: {},
                    enabled: true,
                    nextRunAt: new Date(Date.now() + input.interval_minutes * 60_000),
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
                meta: { objects: Object.keys(settings.objects), write_back: input.write_back, interval_minutes: input.interval_minutes },
            });
            return created!;
        });
        await this.markLists(tenantId, connectionId, settings);
        this.writeBack.forget(tenantId);
        this.queue.enqueueRun(tenantId, row.id, { full: true });
        return this.toStatus(tenantId, row);
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
        await this.materializeObjects(tenantId, userId, added, plans, before.folder_id);
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
                    description: columnDescription(c),
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
                columns: p.columns.map(({ key, label, source, type, can_edit }) => ({ key, label, source, type, can_edit })),
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
        const updated = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            if (input.interval_minutes !== undefined) s.interval_minutes = input.interval_minutes;
            if (input.write_back !== undefined) s.write_back = input.write_back;
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
                    nextRunAt: new Date(Date.now() + s.interval_minutes * 60_000),
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
        await this.markLists(tenantId, connectionId, readSiteSettings(updated.settings));
        this.writeBack.forget(tenantId);
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
            description: columnDescription(found),
        });
        const fresh = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [locked] = await tx.select().from(connectionSyncs).where(eq(connectionSyncs.id, row.id)).for('update');
            const s = readSiteSettings(locked!.settings);
            const so = s.objects[input.resource]!;
            so.columns.push({ key: found.key, label: found.label, source: found.source, type: found.type, can_edit: found.can_edit });
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
        for (const part of ['run', 'push'] as const) this.engine.siteIncident({ tenantId, connectionId, actorId: 0 }, part, null, '');
    }

    /**
     * Marca cada lista del sitio (`settings.site_sync`): de qué conexión es,
     * qué guarda y qué columnas son del sitio y cuáles se editan. Con eso el
     * backend rechaza lo que WordPress no permitiría y la interfaz lo bloquea
     * antes (`site-rules.ts`). Idempotente: sólo escribe donde cambió.
     */
    async markLists(tenantId: number, connectionId: number, settings: SiteSyncSettings): Promise<void> {
        const markers: Array<[number, SiteListMarker]> = [];
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
        return ran;
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
            .where(and(eq(connectionSyncs.enabled, true), eq(connectionSyncs.provider, SITE_SYNC_PROVIDER), lte(connectionSyncs.nextRunAt, new Date())))
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
            .map((c) => ({ key: c.key, label: c.label, source: c.source, type: c.type, can_edit: c.can_edit, always: c.always, hint: c.hint }));
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
};

function columnSlug(c: Pick<SiteColumn, 'key' | 'label'>): string {
    const core = CORE_SLUGS[c.key];
    if (core) return core;
    const base = slugify(c.key.startsWith('tax:') ? c.label : c.key.slice(c.key.indexOf(':') + 1)) || 'campo';
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

function columnConfig(kind: SiteObjectSettings['kind'], c: Pick<SiteColumn, 'key' | 'type'>): Record<string, unknown> {
    if (c.key === 'status') return { options: kind === 'taxonomy' ? WP_TERM_STATUS_OPTIONS : WP_POST_STATUS_OPTIONS };
    if (c.key === 'featured_image') return { display: 'image' };
    if (c.type === 'multi_select' || c.type === 'select') return { options: [] };
    if (c.type === 'number' && c.key !== 'wp_id' && c.key !== 'count' && c.key !== 'menu_order') return { precision: 2 };
    return {};
}

function columnDescription(c: Pick<SiteColumn, 'key' | 'source'>): string {
    if (c.source === 'acf') return `Viene de WordPress (campo de ACF «${c.key.slice(4)}»).`;
    if (c.source === 'meta') return `Viene de WordPress (campo personalizado «${c.key.slice(5)}»).`;
    return 'Viene de WordPress.';
}

function objectIcon(kind: SiteObjectSettings['kind'], object: string): string {
    if (kind === 'taxonomy') return 'tag';
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
    return col && !col.can_edit && col.source !== 'core' ? 'Tiene varias partes (una lista o un grupo): se trae como texto y se edita en WordPress.' : null;
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
const TECH_COLUMNS = new Set(['wp_id', 'edit_link', 'link', 'modified', 'count']);
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
