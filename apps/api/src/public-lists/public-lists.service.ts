import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
    FALLBACK_TIME_ZONE,
    addDaysYmd,
    brandingSchema,
    jsonbKeyForField,
    publicListSettingsSchema,
    PUBLIC_LIST_DEFAULTS,
    resolveTimeZone,
    tenantFormatSchema,
    zonedInstant,
    type FieldType,
    type PublicFieldMeta,
    type PublicListAdmin,
    type PublicListMeta,
    type PublicListSettings,
    type PublicRecord,
    type PublicRecordsPage,
    type PublicRecordsQuery,
    type UpdatePublicListInput,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { attachments, fields, lists, publicLists, records, savedViews, tenants, users } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { compileFilterTree, fieldTypedExpr, type FilterableField } from '../records/query-builder';
import { FilesService } from '../files/files.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { publicSurfaceOff } from '../billing/tenant-access';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

/**
 * ¿El enlace ya venció? La fecha es un día calendario (`YYYY-MM-DD`) y vale
 * hasta el final de ese día en la ZONA HORARIA de la empresa (antes, en UTC:
 * en Colombia el enlace dejaba de andar a las 7 p. m. del día elegido).
 */
export function isExpired(expiresAt: string, timeZone: string, now: Date = new Date()): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) return false;
    const end = zonedInstant(addDaysYmd(expiresAt, 1), timeZone);
    return now.getTime() >= end.getTime();
}

/** Tipos de campo cuyo texto se busca en la búsqueda pública. */
const SEARCHABLE_TYPES = new Set(['text', 'long_text', 'email', 'url', 'select', 'phone']);
/** Tipos que se pueden ordenar en la página pública (con su expresión tipada). */
const SORTABLE_TYPES = new Set([
    'text', 'long_text', 'email', 'url', 'phone', 'select', 'number', 'currency', 'rating', 'percent', 'duration', 'date', 'datetime', 'checkbox',
]);
const TEXT_SORT_TYPES = new Set(['text', 'long_text', 'email', 'url', 'phone', 'select']);
/** Tipos que una lista pública no muestra (no viven en `data` o apuntan a otras listas). */
const NOT_PUBLIC_TYPES = new Set(['relation', 'computed', 'lookup', 'rollup', 'time_tracked', 'created_at', 'updated_at', 'created_by', 'updated_by', 'button', 'formula', 'approval', 'checklist_progress']);

type FieldRow = typeof fields.$inferSelect;

/** La config guardada, con los campos por ID (convierte el formato anterior por slug). */
export function canonicalPublicSettings(raw: unknown, fieldRows: ReadonlyArray<{ id: number; slug: string }>): PublicListSettings {
    const parsed = publicListSettingsSchema.safeParse(raw ?? {});
    const cfg: PublicListSettings = parsed.success ? parsed.data : { ...PUBLIC_LIST_DEFAULTS };
    const bySlug = new Map(fieldRows.map((f) => [f.slug, f.id]));
    const own = new Set(fieldRows.map((f) => f.id));
    const fromSlugs = (slugs: string[] | undefined): number[] =>
        (slugs ?? []).map((s) => bySlug.get(s)).filter((id): id is number => id !== undefined);
    const visible = cfg.visible_field_ids.length > 0 ? cfg.visible_field_ids : fromSlugs(cfg.visible_field_slugs);
    const sortable = cfg.sort_allowed_field_ids.length > 0 ? cfg.sort_allowed_field_ids : fromSlugs(cfg.sort_allowed_slugs);
    let sortId = cfg.default_sort_field_id;
    let sortDir = cfg.default_sort_dir;
    if (sortId === null && typeof cfg.default_sort === 'string' && cfg.default_sort !== '') {
        const [slug, dir] = cfg.default_sort.split(':');
        sortId = bySlug.get(slug ?? '') ?? null;
        sortDir = dir === 'desc' ? 'desc' : 'asc';
    }
    const uniq = (ids: number[]) => [...new Set(ids)].filter((id) => own.has(id));
    const out: PublicListSettings = {
        enabled: cfg.enabled,
        token: cfg.token,
        visible_field_ids: uniq(visible),
        sort_allowed_field_ids: uniq(sortable),
        default_sort_field_id: sortId !== null && own.has(sortId) ? sortId : null,
        default_sort_dir: sortDir,
        per_page: cfg.per_page,
        search_enabled: cfg.search_enabled,
        allowed_domains: cfg.allowed_domains,
        view_id: cfg.view_id,
        expires_at: cfg.expires_at,
    };
    return out;
}

@Injectable()
export class PublicListsService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly files: FilesService,
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    // ─────────────────────────── Admin ───────────────────────────

    private async fieldRowsOf(tenantId: number, listId: number): Promise<FieldRow[]> {
        return this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(fields).where(eq(fields.listId, listId)).orderBy(fields.position),
        );
    }

    private toAdmin(cfg: PublicListSettings, fieldRows: ReadonlyArray<{ id: number; slug: string }>): PublicListAdmin {
        const slugOf = new Map(fieldRows.map((f) => [f.id, f.slug]));
        const slugs = (ids: number[]) => ids.map((id) => slugOf.get(id)).filter((s): s is string => s !== undefined);
        const sortSlug = cfg.default_sort_field_id !== null ? slugOf.get(cfg.default_sort_field_id) : undefined;
        const { visible_field_slugs: _v, sort_allowed_slugs: _s, default_sort: _d, ...rest } = cfg;
        void _v;
        void _s;
        void _d;
        return {
            ...rest,
            visible_field_slugs: slugs(cfg.visible_field_ids),
            sort_allowed_slugs: slugs(cfg.sort_allowed_field_ids),
            default_sort: sortSlug ? `${sortSlug}:${cfg.default_sort_dir}` : null,
            public_path: cfg.enabled && cfg.token ? `/public/l/${cfg.token}` : null,
        };
    }

    async getAdmin(tenantId: number, idOrSlug: string): Promise<PublicListAdmin> {
        const list = await this.lists.get(tenantId, idOrSlug);
        const fieldRows = await this.fieldRowsOf(tenantId, list.id);
        return this.toAdmin(canonicalPublicSettings(list.settings.public, fieldRows), fieldRows);
    }

    async updateAdmin(
        tenantId: number,
        idOrSlug: string,
        input: UpdatePublicListInput,
    ): Promise<PublicListAdmin> {
        const list = await this.lists.get(tenantId, idOrSlug);
        const fieldRows = await this.fieldRowsOf(tenantId, list.id);
        const current = canonicalPublicSettings(list.settings.public, fieldRows);
        // Lo que llega por slug (clientes viejos, el asistente) se resuelve a
        // ids sobre la config actual; lo que llega por id manda.
        const merged = canonicalPublicSettings(
            {
                ...current,
                ...input,
                visible_field_ids: input.visible_field_ids ?? (input.visible_field_slugs ? [] : current.visible_field_ids),
                sort_allowed_field_ids: input.sort_allowed_field_ids ?? (input.sort_allowed_slugs ? [] : current.sort_allowed_field_ids),
                default_sort_field_id:
                    input.default_sort_field_id !== undefined
                        ? input.default_sort_field_id
                        : input.default_sort !== undefined
                          ? null
                          : current.default_sort_field_id,
                visible_field_slugs: input.visible_field_slugs,
                sort_allowed_slugs: input.sort_allowed_slugs,
                default_sort: input.default_sort,
            },
            fieldRows,
        );
        const next: PublicListSettings = {
            ...merged,
            // Sólo se puede ordenar por lo que se muestra.
            sort_allowed_field_ids: merged.sort_allowed_field_ids.filter((id) => merged.visible_field_ids.includes(id)),
        };

        // Al habilitar sin token, generamos uno; al deshabilitar lo conservamos
        // (para reusar el mismo link si se re-habilita) pero sacamos el mapeo.
        if (next.enabled && !next.token) {
            next.token = randomBytes(18).toString('base64url');
        }

        // Se guarda sólo la forma canónica: ids, sin slugs ni `cache_ttl`.
        await this.lists.update(tenantId, idOrSlug, {
            settings: { ...list.settings, public: next },
        });

        // Sincronizar el mapeo público (tabla sin RLS, en la conexión base).
        //
        // OJO con el UNIQUE (tenant_id, list_id): si la fila ya existía con
        // OTRO token, un `onConflictDoNothing` no hacía nada y el mapeo se
        // quedaba con el token viejo — la app mostraba un enlace que devolvía
        // 404 para siempre. El token de `settings` es la verdad: se borra
        // cualquier mapeo de esta lista que no sea ese y se inserta el bueno.
        if (next.enabled && next.token) {
            await this.db
                .delete(publicLists)
                .where(and(eq(publicLists.listId, list.id), ne(publicLists.token, next.token)));
            await this.db
                .insert(publicLists)
                .values({ token: next.token, tenantId, listId: list.id })
                .onConflictDoNothing();
        } else {
            await this.db.delete(publicLists).where(eq(publicLists.listId, list.id));
        }

        return this.toAdmin(next, fieldRows);
    }

    // ─────────────────────────── Público ───────────────────────────

    /** Resuelve el token público → (tenant, lista). Sin tenant scope. */
    private async resolveToken(token: string): Promise<{ tenantId: number; listId: number }> {
        const [row] = await this.db
            .select({ tenantId: publicLists.tenantId, listId: publicLists.listId })
            .from(publicLists)
            .where(eq(publicLists.token, token))
            .limit(1);
        if (!row) throw new NotFoundException({ code: 'public_list_not_found', data: { status: 404 } });
        // v0.1.338 (ADR-S87) — empresa pausada o plan sin «Enlaces públicos»:
        // el mismo 404 opaco que un token desconocido (nada se borra).
        if (await publicSurfaceOff(this.db, row.tenantId, 'public_sharing')) throw new NotFoundException({ code: 'public_list_not_found', data: { status: 404 } });
        return row;
    }

    /** Config pública (incluye allowed_domains) — para CSP. */
    async publicConfig(token: string): Promise<{ tenantId: number; listId: number; cfg: PublicListSettings; fieldRows: FieldRow[] }> {
        const { tenantId, listId } = await this.resolveToken(token);
        const { cfg, fieldRows, timeZone } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)).limit(1);
            const rows = await tx.select().from(fields).where(eq(fields.listId, listId)).orderBy(fields.position);
            const tz = this.timeZones ? await this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
            return { cfg: canonicalPublicSettings(l?.settings?.public ?? {}, rows), fieldRows: rows, timeZone: tz };
        });
        if (!cfg.enabled) {
            throw new NotFoundException({ code: 'public_list_disabled', data: { status: 404 } });
        }
        // Caducidad: vencido responde 404 igual que un token desconocido —
        // a quien tenga el link viejo no se le confirma que existió.
        if (cfg.expires_at !== null && isExpired(cfg.expires_at, resolveTimeZone(timeZone))) {
            throw new NotFoundException({ code: 'public_list_expired', data: { status: 404 } });
        }
        return { tenantId, listId, cfg, fieldRows };
    }

    /** Datos mínimos para servir la página HTML embebible (nombre + CSP). */
    async pageBootstrap(token: string): Promise<{ name: string; allowed_domains: string[] }> {
        const { tenantId, listId, cfg } = await this.publicConfig(token);
        const name = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx.select({ name: lists.name }).from(lists).where(eq(lists.id, listId)).limit(1);
            return l?.name ?? 'Lista';
        });
        return { name, allowed_domains: cfg.allowed_domains };
    }

    /**
     * Condición extra cuando se publica una VISTA guardada: sus filtros
     * acotan lo que ve el visitante. Se compila con el mismo query builder
     * whitelisteado que usa la app (regla de oro nº 4) — nunca se interpola
     * nada del config crudo. Una vista de otra lista, borrada o con un
     * filtro ilegible simplemente no agrega condición.
     */
    private async viewFilterSql(
        tx: Tx,
        tenantId: number,
        listId: number,
        viewId: number | null,
        fieldRows: Array<{ id: number; type: string }>,
    ): Promise<{ sql: SQL | undefined; name: string | null }> {
        if (viewId === null) return { sql: undefined, name: null };
        const [view] = await tx
            .select({ name: savedViews.name, config: savedViews.config })
            .from(savedViews)
            .where(and(eq(savedViews.id, viewId), eq(savedViews.listId, listId)))
            .limit(1);
        // SEC-25 (v0.1.226): la vista publicada ACOTA lo que se ve; si no se
        // puede aplicar, no se muestra NADA (antes, vista borrada, filtro que ya
        // no compila o una condición sobre un campo que el filtro público no
        // entiende —lookup/rollup— dejaban la lista ENTERA a la vista).
        if (!view) return { sql: sql`false`, name: null };
        const tree = (view.config as Record<string, unknown>).filter_tree;
        if (tree === undefined || tree === null) return { sql: undefined, name: view.name };
        const byId = new Map<number, FilterableField>(
            fieldRows.map((f) => [f.id, { id: f.id, type: f.type as FilterableField['type'] }] as const),
        );
        if (conditionFieldIds(tree).some((id) => !byId.has(id))) return { sql: sql`false`, name: view.name };
        try {
            // v0.1.263 — "hoy/esta semana" de la vista en el reloj de la empresa.
            const timeZone = this.timeZones ? await this.timeZones.orUtc(tenantId, tx) : FALLBACK_TIME_ZONE;
            return { sql: compileFilterTree(byId, tree as never, { now: new Date(), timeZone }), name: view.name };
        } catch {
            return { sql: sql`false`, name: view.name };
        }
    }

    /** Los campos que la página pública muestra, en el orden de la lista. */
    private visibleFields(cfg: PublicListSettings, fieldRows: FieldRow[]): FieldRow[] {
        const wanted = new Set(cfg.visible_field_ids);
        return fieldRows.filter((f) => wanted.has(f.id) && !NOT_PUBLIC_TYPES.has(f.type));
    }

    async getMeta(token: string): Promise<PublicListMeta> {
        const { tenantId, listId, cfg, fieldRows } = await this.publicConfig(token);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(eq(lists.id, listId))
                .limit(1);
            const visible = this.visibleFields(cfg, fieldRows);
            const description =
                l && typeof (l.settings as Record<string, unknown>).description === 'string'
                    ? ((l.settings as Record<string, unknown>).description as string)
                    : null;
            // White-label del workspace dueño: color/nombre/logo (URL firmada
            // — la página pública no tiene sesión alguna).
            const [tenantRow] = await tx
                .select({ settings: tenants.settings })
                .from(tenants)
                .where(eq(tenants.id, tenantId))
                .limit(1);
            const tenantSettings = (tenantRow?.settings as Record<string, unknown> | undefined) ?? {};
            const parsed = brandingSchema.safeParse(tenantSettings.branding ?? {});
            const b = parsed.success ? parsed.data : brandingSchema.parse({});
            const fmt = tenantFormatSchema.safeParse(tenantSettings.format ?? {});
            const format = fmt.success ? fmt.data : tenantFormatSchema.parse({});

            const publishedView = await this.viewFilterSql(tx, tenantId, listId, cfg.view_id, fieldRows);
            const visibleIds = new Set(visible.map((f) => f.id));
            const slugOf = new Map(fieldRows.map((f) => [f.id, f.slug]));
            const sortSlug = cfg.default_sort_field_id !== null && visibleIds.has(cfg.default_sort_field_id) ? slugOf.get(cfg.default_sort_field_id) : undefined;

            return {
                name: l?.name ?? 'Lista',
                description,
                fields: visible.map(publicFieldMeta),
                view_name: publishedView.name,
                sort_allowed: cfg.sort_allowed_field_ids
                    .filter((id) => visibleIds.has(id))
                    .map((id) => fieldRows.find((f) => f.id === id))
                    .filter((f): f is FieldRow => f !== undefined && SORTABLE_TYPES.has(f.type))
                    .map((f) => f.slug),
                default_sort: sortSlug ? `${sortSlug}:${cfg.default_sort_dir}` : null,
                per_page: cfg.per_page,
                search_enabled: cfg.search_enabled,
                branding: {
                    primary_color: b.primary_color,
                    app_name: b.app_name,
                    logo_url:
                        b.logo_file_id !== null
                            ? this.files.signedUrl(tenantId, b.logo_file_id, 3600)
                            : null,
                },
                format,
            };
        });
    }

    async getRecords(token: string, query: PublicRecordsQuery): Promise<PublicRecordsPage> {
        const { tenantId, listId, cfg, fieldRows } = await this.publicConfig(token);
        const limit = Math.min(query.limit ?? cfg.per_page, 100);
        const offset = query.cursor ?? 0;

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const visibleFields = this.visibleFields(cfg, fieldRows);
            const bySlug = new Map(visibleFields.map((f) => [f.slug, f]));

            // WHERE: no borrados + filtros de la vista publicada + búsqueda
            // (si está habilitada) sobre los campos de texto visibles.
            const conds: SQL[] = [eq(records.listId, listId), isNull(records.deletedAt)];
            const viewCond = (await this.viewFilterSql(tx, tenantId, listId, cfg.view_id, fieldRows)).sql;
            if (viewCond) conds.push(viewCond);
            if (cfg.search_enabled && query.search && query.search.trim() !== '') {
                const term = `%${query.search.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
                const searchable = visibleFields.filter((f) => SEARCHABLE_TYPES.has(f.type));
                const ors = searchable.map(
                    (f) => sql`(${records.data} ->> ${sql.raw(`'${jsonbKeyForField(f.id)}'`)}) ILIKE ${term}`,
                );
                if (ors.length > 0) conds.push(or(...ors)!);
                else conds.push(sql`false`);
            }

            // ORDER BY: sólo un campo visible, permitido y ordenable, con su
            // expresión TIPADA (antes se ordenaba el texto: '9' > '10').
            const order: SQL[] = [];
            const sortRaw = query.sort ?? (() => {
                const slug = cfg.default_sort_field_id !== null ? visibleFields.find((f) => f.id === cfg.default_sort_field_id)?.slug : undefined;
                return slug ? `${slug}:${cfg.default_sort_dir}` : '';
            })();
            const [sortSlug, sortDir] = sortRaw.split(':');
            const sortField = sortSlug ? bySlug.get(sortSlug) : undefined;
            if (sortField && cfg.sort_allowed_field_ids.includes(sortField.id) && SORTABLE_TYPES.has(sortField.type)) {
                const typed = fieldTypedExpr({ id: sortField.id, type: sortField.type as FieldType });
                const expr = TEXT_SORT_TYPES.has(sortField.type) ? sql`${typed} COLLATE "und-x-icu"` : typed;
                order.push(sortDir === 'desc' ? sql`${expr} DESC NULLS LAST` : sql`${expr} ASC NULLS LAST`);
            }
            order.push(asc(records.id));

            const rows = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(...conds))
                .orderBy(...order)
                .limit(limit + 1)
                .offset(offset);

            const hasMore = rows.length > limit;
            const page = hasMore ? rows.slice(0, limit) : rows;
            const display = await this.displayResolvers(tx, tenantId, visibleFields, page.map((r) => r.data as Record<string, unknown>));
            const data: PublicRecord[] = page.map((r) => {
                const raw = r.data as Record<string, unknown>;
                const out: Record<string, unknown> = {};
                for (const f of visibleFields) {
                    const v = raw[jsonbKeyForField(f.id)];
                    if (v === undefined) continue;
                    out[f.slug] = display(f, v);
                }
                return { id: r.id, data: out };
            });
            return { data, meta: { next_cursor: hasMore ? String(offset + limit) : null } };
        });
    }

    /**
     * Personas y archivos guardan IDS: a la página pública le llegan como se
     * leen — el nombre de la persona y `{ name, url }` del archivo (URL firmada
     * de vida corta). Una consulta por tipo y por página, nunca por celda.
     */
    private async displayResolvers(
        tx: Tx,
        tenantId: number,
        visible: FieldRow[],
        rows: Array<Record<string, unknown>>,
    ): Promise<(field: FieldRow, value: unknown) => unknown> {
        const idsOf = (type: string): number[] => {
            const out = new Set<number>();
            for (const f of visible.filter((x) => x.type === type)) {
                for (const r of rows) {
                    const v = r[jsonbKeyForField(f.id)];
                    for (const x of Array.isArray(v) ? v : [v]) {
                        const n = Number(x);
                        if (Number.isInteger(n) && n > 0) out.add(n);
                    }
                }
            }
            return [...out];
        };
        const userIds = idsOf('user');
        const fileIds = idsOf('file');
        const names = new Map<number, string>();
        if (userIds.length > 0) {
            const found = await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds));
            for (const u of found) names.set(u.id, (u.name ?? '').includes('@') ? '' : (u.name ?? ''));
        }
        const filesById = new Map<number, string>();
        if (fileIds.length > 0) {
            const found = await tx
                .select({ id: attachments.id, filename: attachments.filename })
                .from(attachments)
                .where(and(eq(attachments.tenantId, tenantId), inArray(attachments.id, fileIds)));
            for (const a of found) filesById.set(a.id, a.filename);
        }
        return (field, value) => {
            if (field.type === 'user') {
                const id = Number(value);
                return names.get(id) || null;
            }
            if (field.type === 'file') {
                const list = (Array.isArray(value) ? value : [value])
                    .map((x) => Number(x))
                    .filter((id) => filesById.has(id))
                    .map((id) => ({ name: filesById.get(id)!, url: this.files.signedUrl(tenantId, id, 3600) }));
                return list;
            }
            return value;
        };
    }
}

/** Lo mínimo para mostrar el valor de un campo como en la app. */
function publicFieldMeta(f: FieldRow): PublicFieldMeta {
    const cfg = (f.config ?? {}) as Record<string, unknown>;
    const out: PublicFieldMeta = { slug: f.slug, label: f.label, type: f.type };
    if (f.type === 'select' || f.type === 'multi_select') {
        const raw = Array.isArray(cfg.options) ? cfg.options : [];
        out.options = raw.flatMap((o) => {
            if (!o || typeof o !== 'object') return [];
            const { value, label, color } = o as { value?: unknown; label?: unknown; color?: unknown };
            if (typeof value !== 'string') return [];
            return [{
                value,
                label: typeof label === 'string' && label !== '' ? label : value,
                color: typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null,
            }];
        });
    }
    if (typeof cfg.precision === 'number') out.precision = cfg.precision;
    if (f.type === 'rating' && typeof cfg.max === 'number') out.max = cfg.max;
    if (f.type === 'duration' && typeof cfg.format === 'string') out.duration_format = cfg.format;
    return out;
}

/** Los `field_id` de todas las condiciones de un filter tree (a cualquier profundidad). */
function conditionFieldIds(node: unknown): number[] {
    if (!node || typeof node !== 'object') return [];
    const n = node as { type?: string; field_id?: unknown; children?: unknown[] };
    if (n.type === 'condition') return [Number(n.field_id)];
    return Array.isArray(n.children) ? n.children.flatMap(conditionFieldIds) : [];
}
