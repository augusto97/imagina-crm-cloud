import { randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
    brandingSchema,
    jsonbKeyForField,
    publicListSettingsSchema,
    PUBLIC_LIST_DEFAULTS,
    type PublicListAdmin,
    type PublicListMeta,
    type PublicListSettings,
    type PublicRecord,
    type PublicRecordsPage,
    type PublicRecordsQuery,
    type UpdatePublicListInput,
} from '@imagina-base/shared';
import { and, asc, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/client';
import { fields, lists, publicLists, records, savedViews, tenants } from '../db/schema';
import { ListsService } from '../lists/lists.service';
import { compileFilterTree, type FilterableField } from '../records/query-builder';
import { FilesService } from '../files/files.service';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * ¿El enlace ya venció? La fecha es un día calendario (`YYYY-MM-DD`) y
 * vale hasta el final de ese día en UTC — que caduque "el 31" y deje de
 * andar a las 00:00 del 31 sería una sorpresa desagradable.
 */
function isExpired(expiresAt: string, now: Date = new Date()): boolean {
    const end = Date.parse(`${expiresAt}T23:59:59.999Z`);
    return Number.isFinite(end) && now.getTime() > end;
}

/** Tipos de campo cuyo texto se busca en la búsqueda pública. */
const SEARCHABLE_TYPES = new Set(['text', 'long_text', 'email', 'url', 'select', 'phone']);

@Injectable()
export class PublicListsService {
    constructor(
        @Inject(DRIZZLE) private readonly db: Db,
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly files: FilesService,
    ) {}

    // ─────────────────────────── Admin ───────────────────────────

    private readSettings(settings: Record<string, unknown>): PublicListSettings {
        const parsed = publicListSettingsSchema.safeParse(settings.public);
        return parsed.success ? parsed.data : { ...PUBLIC_LIST_DEFAULTS };
    }

    private toAdmin(cfg: PublicListSettings): PublicListAdmin {
        return { ...cfg, public_path: cfg.enabled && cfg.token ? `/public/l/${cfg.token}` : null };
    }

    async getAdmin(tenantId: number, idOrSlug: string): Promise<PublicListAdmin> {
        const list = await this.lists.get(tenantId, idOrSlug);
        return this.toAdmin(this.readSettings(list.settings));
    }

    async updateAdmin(
        tenantId: number,
        idOrSlug: string,
        input: UpdatePublicListInput,
    ): Promise<PublicListAdmin> {
        const list = await this.lists.get(tenantId, idOrSlug);
        const current = this.readSettings(list.settings);
        const next: PublicListSettings = { ...current, ...input };

        // Al habilitar sin token, generamos uno; al deshabilitar lo conservamos
        // (para reusar el mismo link si se re-habilita) pero sacamos el mapeo.
        if (next.enabled && !next.token) {
            next.token = randomBytes(18).toString('base64url');
        }

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

        return this.toAdmin(next);
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
        return row;
    }

    /** Config pública (incluye allowed_domains) — para CSP y cache. */
    async publicConfig(token: string): Promise<{ tenantId: number; listId: number; cfg: PublicListSettings }> {
        const { tenantId, listId } = await this.resolveToken(token);
        const cfg = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx.select({ settings: lists.settings }).from(lists).where(eq(lists.id, listId)).limit(1);
            return this.readSettings(l?.settings ?? {});
        });
        if (!cfg.enabled) {
            throw new NotFoundException({ code: 'public_list_disabled', data: { status: 404 } });
        }
        // Caducidad: vencido responde 404 igual que un token desconocido —
        // a quien tenga el link viejo no se le confirma que existió.
        if (cfg.expires_at !== null && isExpired(cfg.expires_at)) {
            throw new NotFoundException({ code: 'public_list_expired', data: { status: 404 } });
        }
        return { tenantId, listId, cfg };
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
        tx: Parameters<Parameters<TenantDb['withTenant']>[1]>[0],
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
        if (!view) return { sql: undefined, name: null };
        const tree = (view.config as Record<string, unknown>).filter_tree;
        if (tree === undefined || tree === null) return { sql: undefined, name: view.name };
        const byId = new Map<number, FilterableField>(
            fieldRows.map((f) => [f.id, { id: f.id, type: f.type as FilterableField['type'] }] as const),
        );
        try {
            return { sql: compileFilterTree(byId, tree as never, new Date()), name: view.name };
        } catch {
            // Un filtro que ya no compila (campo borrado, operador viejo) no
            // debe tumbar la página pública.
            return { sql: undefined, name: view.name };
        }
    }

    async getMeta(token: string): Promise<PublicListMeta> {
        const { tenantId, listId, cfg } = await this.publicConfig(token);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const [l] = await tx
                .select({ name: lists.name, settings: lists.settings })
                .from(lists)
                .where(eq(lists.id, listId))
                .limit(1);
            const fieldRows = await tx.select().from(fields).where(eq(fields.listId, listId)).orderBy(fields.position);
            const visible = new Set(cfg.visible_field_slugs);
            const visibleFields = fieldRows
                .filter((f) => visible.has(f.slug))
                .map((f) => ({ slug: f.slug, label: f.label, type: f.type }));
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
            const parsed = brandingSchema.safeParse(
                (tenantRow?.settings as Record<string, unknown> | undefined)?.branding ?? {},
            );
            const b = parsed.success ? parsed.data : brandingSchema.parse({});

            const publishedView = await this.viewFilterSql(tx, listId, cfg.view_id, fieldRows);

            return {
                name: l?.name ?? 'Lista',
                description,
                fields: visibleFields,
                view_name: publishedView.name,
                sort_allowed: cfg.sort_allowed_slugs.filter((s) => visible.has(s)),
                default_sort: cfg.default_sort,
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
            };
        });
    }

    async getRecords(token: string, query: PublicRecordsQuery): Promise<PublicRecordsPage> {
        const { tenantId, listId, cfg } = await this.publicConfig(token);
        const limit = Math.min(query.limit ?? cfg.per_page, 100);
        const offset = query.cursor ?? 0;

        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const fieldRows = await tx.select().from(fields).where(eq(fields.listId, listId));
            const visible = new Set(cfg.visible_field_slugs);
            const visibleFields = fieldRows.filter((f) => visible.has(f.slug));
            const slugToKey = new Map(visibleFields.map((f) => [f.slug, jsonbKeyForField(f.id)]));

            // WHERE: no borrados + filtros de la vista publicada + búsqueda
            // (si está habilitada) sobre los campos de texto visibles.
            const conds: SQL[] = [eq(records.listId, listId), isNull(records.deletedAt)];
            const viewCond = (await this.viewFilterSql(tx, listId, cfg.view_id, fieldRows)).sql;
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

            // ORDER BY: sort permitido (slug:dir) o id asc por defecto.
            let orderBy: SQL = asc(records.id);
            const sort = query.sort ?? cfg.default_sort ?? '';
            const [sortSlug, sortDir] = sort.split(':');
            if (sortSlug && cfg.sort_allowed_slugs.includes(sortSlug) && slugToKey.has(sortSlug)) {
                const key = slugToKey.get(sortSlug)!;
                const expr = sql`(${records.data} ->> ${sql.raw(`'${key}'`)})`;
                orderBy = sortDir === 'desc' ? desc(expr) : asc(expr);
            }

            const rows = await tx
                .select({ id: records.id, data: records.data })
                .from(records)
                .where(and(...conds))
                .orderBy(orderBy, asc(records.id))
                .limit(limit + 1)
                .offset(offset);

            const hasMore = rows.length > limit;
            const page = hasMore ? rows.slice(0, limit) : rows;
            const keyToSlug = new Map([...slugToKey].map(([s, k]) => [k, s]));
            const data: PublicRecord[] = page.map((r) => {
                const out: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) {
                    const slug = keyToSlug.get(k);
                    if (slug) out[slug] = v;
                }
                return { id: r.id, data: out };
            });
            return { data, meta: { next_cursor: hasMore ? String(offset + limit) : null } };
        });
    }
}
