import {
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    TRASH_ITEM_TYPES,
    TRASH_RETENTION_DAYS_DEFAULT,
    fieldSlugSchema,
    listSlugSchema,
    mirrorFromPlace,
    mirrorSourceName,
    readMirrorListMarker,
    resolveTitleFieldId,
    type Capability,
    type ListTrashQuery,
    type Role,
    type TrashItem,
    type TrashItemType,
    type TrashPageMeta,
    type TrashRestoreResult,
} from '@imagina-base/shared';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { AutomationDispatcher } from '../automations/automation-dispatcher.service';
import { AutomationScheduler } from '../automations/automation-scheduler.service';
import type { AutomationRow } from '../automations/automations.repository';
import { BillingService } from '../billing/billing.service';
import { ENV, type Env } from '../config/env';
import { DRIZZLE, type Db, type Tx } from '../db/client';
import { activity, automations, records } from '../db/schema';
import { FilesService } from '../files/files.service';
import { assignmentKeys, listRowInScope, effectivePermissions, scopeWhere } from '../lists/list-acl';
import { RealtimeService } from '../realtime/realtime.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { enterTrashMode, exitTrashMode } from './trash-ops';
import { can } from '../authz/can';

export interface TrashViewer {
    userId: number;
    role: Role;
    /** C1 — equipos de la persona (ACL por equipo y «los asignados» por equipo). */
    teamIds?: readonly number[];
}

/** Fila cruda del listado (una por cosa en la papelera). */
type RawItem = {
    type: TrashItemType;
    id: number | string;
    name: string | null;
    list_id: number | string | null;
    list_name: string | null;
    list_slug: string | null;
    subtype: string | null;
    children: number | string | null;
    deleted_at: Date | string;
    deleted_by: number | string | null;
    deleted_by_name: string | null;
};

/** Qué capacidad hace falta (además de haberlo borrado) para restaurar cada cosa. */
const CAPABILITY_FOR: Record<Exclude<TrashItemType, 'record'>, Capability> = {
    list: 'manage_lists',
    field: 'manage_fields',
    view: 'manage_views',
    automation: 'manage_automations',
    dashboard: 'manage_dashboards',
};

/** Tablas (nombre SQL) de cada tipo. */
const TABLE_OF: Record<TrashItemType, string> = {
    record: 'records',
    list: 'lists',
    field: 'fields',
    view: 'saved_views',
    automation: 'automations',
    dashboard: 'dashboards',
};

/** Los registros se purgan en tandas: un DELETE de 100 000 filas a la vez traba la base. */
const PURGE_BATCH = 500;

/**
 * Papelera: listar lo borrado, restaurarlo, borrarlo para siempre y el
 * barrido diario que vacía lo que pasó el plazo.
 *
 * Todo corre con `app.trash = 'on'` (ver `trash-ops.ts`): es la única parte de
 * la app que ve lo que está en la papelera.
 */
@Injectable()
export class TrashService {
    private readonly logger = new Logger(TrashService.name);

    constructor(
        private readonly tenantDb: TenantDb,
        @Inject(DRIZZLE) private readonly db: Db,
        @Inject(ENV) private readonly env: Env,
        private readonly realtime: RealtimeService,
        private readonly audit: AuditService,
        private readonly files: FilesService,
        @Optional() private readonly scheduler?: AutomationScheduler,
        @Optional() private readonly dispatcher?: AutomationDispatcher,
        @Optional() private readonly billing?: BillingService,
    ) {}

    /** Días que algo queda en la papelera (env; más adelante, por plan). */
    retentionDays(): number {
        return this.env.TRASH_RETENTION_DAYS ?? TRASH_RETENTION_DAYS_DEFAULT;
    }

    // ── Listado ─────────────────────────────────────────────────────────

    async list(
        tenantId: number,
        viewer: TrashViewer,
        q: ListTrashQuery,
    ): Promise<{ data: TrashItem[]; meta: TrashPageMeta }> {
        const isAdmin = viewer.role === 'admin';
        const days = this.retentionDays();
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const union = await this.unionSql(tx, tenantId, viewer);
            await enterTrashMode(tx);
            const filters: SQL[] = [];
            if (q.list_id) filters.push(sql`i.list_id = ${q.list_id}`);
            if (q.q) {
                const like = `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
                filters.push(
                    /^\d{1,15}$/.test(q.q)
                        ? sql`(coalesce(i.name, '') ILIKE ${like} OR i.id = ${Number(q.q)})`
                        : sql`coalesce(i.name, '') ILIKE ${like}`,
                );
            }
            const where = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
            const countRes = await tx.execute<{ type: TrashItemType; n: number | string }>(
                sql`SELECT i.type, count(*)::int AS n FROM (${union}) i ${where} GROUP BY i.type`,
            );
            const counts = Object.fromEntries(TRASH_ITEM_TYPES.map((t) => [t, 0])) as Record<TrashItemType, number>;
            for (const r of countRes.rows) counts[r.type] = Number(r.n);
            const typeWhere = q.type
                ? filters.length > 0
                    ? sql`${where} AND i.type = ${q.type}`
                    : sql`WHERE i.type = ${q.type}`
                : where;
            const total = q.type ? counts[q.type] : Object.values(counts).reduce((a, b) => a + b, 0);
            const offset = (q.page - 1) * q.limit;
            const page = await tx.execute<RawItem>(sql`
                SELECT i.*, u.name AS deleted_by_name
                FROM (${union}) i
                LEFT JOIN users u ON u.id = i.deleted_by
                ${typeWhere}
                ORDER BY i.deleted_at DESC, i.id DESC
                LIMIT ${q.limit} OFFSET ${offset}
            `);
            await exitTrashMode(tx);
            const items: TrashItem[] = page.rows.map((r) => {
                const deletedAt = toDate(r.deleted_at);
                const deletedBy = r.deleted_by === null ? null : Number(r.deleted_by);
                return {
                    type: r.type,
                    id: Number(r.id),
                    name: r.name ?? '',
                    list_id: r.list_id === null ? null : Number(r.list_id),
                    list_name: r.list_name,
                    list_slug: r.list_slug,
                    subtype: r.subtype,
                    children: r.children === null ? null : Number(r.children),
                    deleted_at: deletedAt.toISOString(),
                    deleted_by: deletedBy,
                    deleted_by_name: r.deleted_by_name,
                    purge_at: new Date(deletedAt.getTime() + days * 86_400_000).toISOString(),
                    can_restore: isAdmin || (deletedBy !== null && deletedBy === viewer.userId),
                };
            });
            return {
                data: items,
                meta: {
                    total,
                    page: q.page,
                    per_page: q.limit,
                    total_pages: Math.max(1, Math.ceil(total / q.limit)),
                    retention_days: days,
                    counts,
                    can_empty: isAdmin,
                },
            };
        });
    }

    /**
     * Las seis consultas de la papelera en un UNION. Lo que está DENTRO de una
     * lista borrada no se lista aparte (vuelve con ella), ni las subtareas de
     * un registro borrado; los registros de una lista de tienda tampoco (los
     * borra la sincronización). Quien no es admin ve lo que borró y, de los
     * registros, los de las listas que puede ver (con su alcance).
     *
     * Se arma ANTES de encender el modo papelera: las listas y campos que mira
     * (títulos, permisos) son los vivos.
     */
    private async unionSql(tx: Tx, tenantId: number, viewer: TrashViewer): Promise<SQL> {
        const isAdmin = viewer.role === 'admin';
        const uid = viewer.userId;
        const liveLists = (
            await tx.execute<{ id: number | string; settings: Record<string, unknown> | null }>(
                sql`SELECT id, settings FROM lists WHERE tenant_id = ${tenantId}`,
            )
        ).rows.map((l) => ({ id: Number(l.id), settings: (l.settings ?? {}) as Record<string, unknown> }));
        const fieldRows = (
            await tx.execute<{ id: number | string; list_id: number | string; slug: string; type: string }>(
                sql`SELECT id, list_id, slug, type FROM fields WHERE tenant_id = ${tenantId} ORDER BY position, id`,
            )
        ).rows.map((f) => ({ id: Number(f.id), listId: Number(f.list_id), slug: f.slug, type: f.type }));
        const fieldsByList = new Map<number, Array<{ id: number; slug: string; type: string }>>();
        for (const f of fieldRows) {
            const arr = fieldsByList.get(f.listId) ?? [];
            arr.push(f);
            fieldsByList.set(f.listId, arr);
        }

        const whens: SQL[] = [];
        const visible: SQL[] = [];
        for (const l of liveLists) {
            const listFields = fieldsByList.get(l.id) ?? [];
            const perms = effectivePermissions(l.settings, { ...viewer, userId: uid });
            const titleId = resolveTitleFieldId(listFields as never, l.settings);
            const title = titleId === null ? undefined : listFields.find((f) => f.id === titleId);
            if (title && (isAdmin || !perms.fields_hidden.includes(title.slug))) {
                whens.push(sql`WHEN ${l.id} THEN (${records.data} ->> ${`f${title.id}`})`);
            }
            if (isAdmin || perms.view === 'none') continue;
            const scope = scopeWhere(perms.view, { ...viewer, userId: uid }, assignmentKeys(l.settings));
            visible.push(scope ? sql`(${records.listId} = ${l.id} AND ${scope})` : sql`${records.listId} = ${l.id}`);
        }
        const titleExpr = whens.length > 0 ? sql`(CASE ${records.listId} ${sql.join(whens, sql` `)} END)` : sql`NULL::text`;
        const recordVisible = isAdmin
            ? sql`true`
            : visible.length > 0
              ? sql`(${records.deletedBy} = ${uid} OR ${or(...visible)})`
              : sql`${records.deletedBy} = ${uid}`;
        // Las demás cosas: un no-admin ve lo que borró él.
        const mine = (alias: string): SQL => (isAdmin ? sql`true` : sql`${sql.raw(alias)}.deleted_by = ${uid}`);

        return sql`
            SELECT 'list'::text AS type, l.id, l.name AS name, NULL::bigint AS list_id, NULL::text AS list_name,
                   NULL::text AS list_slug, NULL::text AS subtype,
                   (SELECT count(*) FROM records rr WHERE rr.tenant_id = l.tenant_id AND rr.list_id = l.id
                       AND rr.deleted_at = l.deleted_at AND rr.parent_id IS NULL)::int AS children,
                   l.deleted_at, l.deleted_by
            FROM lists l
            WHERE l.tenant_id = ${tenantId} AND l.deleted_at IS NOT NULL AND ${mine('l')}
            UNION ALL
            SELECT 'field', f.id, f.label, f.list_id, pl.name, pl.slug, f.type, NULL::int, f.deleted_at, f.deleted_by
            FROM fields f JOIN lists pl ON pl.id = f.list_id AND pl.deleted_at IS NULL
            WHERE f.tenant_id = ${tenantId} AND f.deleted_at IS NOT NULL AND ${mine('f')}
            UNION ALL
            SELECT 'view', v.id, v.name, v.list_id, pl.name, pl.slug, v.type, NULL::int, v.deleted_at, v.deleted_by
            FROM saved_views v JOIN lists pl ON pl.id = v.list_id AND pl.deleted_at IS NULL
            WHERE v.tenant_id = ${tenantId} AND v.deleted_at IS NOT NULL AND ${mine('v')}
              AND (NOT v.is_private OR v.created_by = ${uid} OR v.deleted_by = ${uid})
            UNION ALL
            SELECT 'automation', a.id, a.name, a.list_id, pl.name, pl.slug, a.trigger_type, NULL::int, a.deleted_at, a.deleted_by
            FROM automations a JOIN lists pl ON pl.id = a.list_id AND pl.deleted_at IS NULL
            WHERE a.tenant_id = ${tenantId} AND a.deleted_at IS NOT NULL AND ${mine('a')}
            UNION ALL
            SELECT 'dashboard', d.id, d.name, NULL::bigint, NULL::text, NULL::text, NULL::text, NULL::int, d.deleted_at, d.deleted_by
            FROM dashboards d
            WHERE d.tenant_id = ${tenantId} AND d.deleted_at IS NOT NULL AND ${mine('d')}
              AND (d.visibility <> 'private' OR d.created_by = ${uid} OR d.deleted_by = ${uid})
            UNION ALL
            SELECT 'record', ${records.id}, ${titleExpr}, ${records.listId}, pl.name, pl.slug, NULL::text,
                   (SELECT count(*) FROM records c WHERE c.parent_id = ${records.id} AND c.deleted_at IS NOT NULL
                       AND c.deleted_at BETWEEN ${records.deletedAt} - interval '1 second' AND ${records.deletedAt} + interval '1 second')::int,
                   ${records.deletedAt}, ${records.deletedBy}
            FROM records JOIN lists pl ON pl.id = ${records.listId} AND pl.deleted_at IS NULL AND NOT (pl.settings ? 'store_sync') AND NOT (pl.settings ? 'site_sync')
            WHERE ${records.tenantId} = ${tenantId} AND ${records.deletedAt} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM records p WHERE p.id = ${records.parentId} AND p.deleted_at IS NOT NULL)
              AND ${recordVisible}
        `;
    }

    // ── Restaurar ───────────────────────────────────────────────────────

    async restore(tenantId: number, viewer: TrashViewer, type: TrashItemType, id: number): Promise<TrashRestoreResult> {
        const result = await this.restoreInner(tenantId, viewer, type, id);
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'trash.restore',
            targetType: type,
            targetId: id,
            targetLabel: result.name || `#${id}`,
            meta: result.renamed_slug ? { renamed_slug: result.renamed_slug } : {},
        });
        return result;
    }

    private async restoreInner(tenantId: number, viewer: TrashViewer, type: TrashItemType, id: number): Promise<TrashRestoreResult> {
        switch (type) {
            case 'record':
                return this.restoreRecord(tenantId, viewer, id);
            case 'list':
                return this.restoreList(tenantId, viewer, id);
            case 'field':
                return this.restoreField(tenantId, viewer, id);
            case 'view':
                return this.restoreView(tenantId, viewer, id);
            case 'automation':
                return this.restoreAutomation(tenantId, viewer, id);
            case 'dashboard':
                return this.restoreDashboard(tenantId, viewer, id);
        }
    }

    private async restoreRecord(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        // Lo que se restaura vuelve a contar para el límite de registros del plan.
        const pre = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRecord(tx, tenantId, id);
            const list = await this.liveList(tx, tenantId, row.listId, 'registro');
            this.assertCanRestoreRecord(viewer, list.settings, row);
            const kids = await this.kidsDeletedWith(tx, tenantId, id);
            return { count: 1 + kids };
        });
        await this.billing?.assertCanCreateRecords(tenantId, pre.count);

        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRecord(tx, tenantId, id);
            const list = await this.liveList(tx, tenantId, row.listId, 'registro');
            const mirror = readMirrorListMarker(list.settings);
            if (mirror) {
                throw new ForbiddenException({
                    code: 'store_managed',
                    message: `Esta lista viene ${mirrorFromPlace(mirror)}: los registros se recuperan en ${mirrorSourceName(mirror)}.`,
                    data: { status: 403 },
                });
            }
            this.assertCanRestoreRecord(viewer, list.settings, row);
            if (row.parentId !== null) {
                const [parent] = (
                    await tx.execute<{ deleted_at: Date | null }>(
                        sql`SELECT deleted_at FROM records WHERE tenant_id = ${tenantId} AND id = ${row.parentId}`,
                    )
                ).rows;
                if (parent && parent.deleted_at !== null) {
                    throw new ConflictException({
                        code: 'trash_parent_in_trash',
                        message: 'Es una subtarea de un registro que también está en la papelera: restaura primero ese registro.',
                        data: { status: 409 },
                    });
                }
            }
            const res = await tx.execute<{ id: number | string }>(sql`
                UPDATE records SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
                WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL
                  AND (id = ${id} OR (parent_id = ${id}
                       AND deleted_at BETWEEN ${row.deletedAt}::timestamptz - interval '1 second' AND ${row.deletedAt}::timestamptz + interval '1 second'))
                RETURNING id
            `);
            await tx.insert(activity).values({
                tenantId,
                listId: row.listId,
                recordId: id,
                userId: viewer.userId,
                action: 'record_restored',
                diff: {},
            });
            const title = await this.recordTitle(tx, tenantId, row.listId, row.data);
            return { list, title, restored: res.rows.length };
        });
        this.realtime.records(tenantId, out.list.id);
        const kids = out.restored - 1;
        const name = out.title ?? '';
        return {
            type: 'record',
            id,
            name,
            list_id: out.list.id,
            list_slug: out.list.slug,
            renamed_slug: null,
            paused: false,
            message:
                (name ? `Se restauró «${name}»` : 'Se restauró el registro') +
                (kids > 0 ? ` con ${kids} ${kids === 1 ? 'subtarea' : 'subtareas'}.` : '.'),
        };
    }

    private async restoreList(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        this.assertCapability(viewer, 'list');
        const pre = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'list', tenantId, id);
            this.assertCanRestore(viewer, 'list', row.deleted_by);
            const [n] = (
                await tx.execute<{ n: number | string }>(sql`
                    SELECT count(*)::int AS n FROM records
                    WHERE tenant_id = ${tenantId} AND list_id = ${id} AND deleted_at = ${row.deleted_at}::timestamptz
                `)
            ).rows;
            return { records: Number(n?.n ?? 0) };
        });
        await this.billing?.assertCanCreateRecords(tenantId, pre.records);

        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'list', tenantId, id);
            this.assertCanRestore(viewer, 'list', row.deleted_by);
            const at = row.deleted_at;
            await exitTrashMode(tx);
            // El slug lo puede haber tomado otra lista mientras estaba borrada.
            const slug = await this.freeListSlug(tx, tenantId, String(row.slug));
            await enterTrashMode(tx);
            await tx.execute(sql`
                UPDATE lists SET deleted_at = NULL, deleted_by = NULL, slug = ${slug}, updated_at = now()
                WHERE tenant_id = ${tenantId} AND id = ${id}
            `);
            for (const table of ['fields', 'saved_views', 'records']) {
                await tx.execute(sql`
                    UPDATE ${sql.raw(table)} SET deleted_at = NULL, deleted_by = NULL
                    WHERE tenant_id = ${tenantId} AND list_id = ${id} AND deleted_at = ${at}::timestamptz
                `);
            }
            const autos = await tx.execute<{ id: number | string }>(sql`
                UPDATE automations SET deleted_at = NULL, deleted_by = NULL
                WHERE tenant_id = ${tenantId} AND list_id = ${id} AND deleted_at = ${at}::timestamptz
                RETURNING id
            `);
            await exitTrashMode(tx);
            const autoRows = autos.rows.length
                ? await tx
                      .select()
                      .from(automations)
                      .where(and(eq(automations.tenantId, tenantId), sql`${automations.id} IN (${sql.join(autos.rows.map((a) => sql`${Number(a.id)}`), sql`, `)})`))
                : [];
            return { name: String(row.name), oldSlug: String(row.slug), slug, autoRows };
        });
        await this.syncAutomations(tenantId, id, out.autoRows);
        this.realtime.lists(tenantId);
        this.realtime.fields(tenantId, id);
        this.realtime.views(tenantId, id);
        this.realtime.records(tenantId, id);
        const renamed = out.slug !== out.oldSlug ? out.slug : null;
        return {
            type: 'list',
            id,
            name: out.name,
            list_id: id,
            list_slug: out.slug,
            renamed_slug: renamed,
            paused: false,
            message:
                `Se restauró la lista «${out.name}»` +
                (pre.records > 0 ? ` con ${pre.records} ${pre.records === 1 ? 'registro' : 'registros'}.` : '.') +
                (renamed ? ` Su nombre interno ahora es «${renamed}»: «${out.oldSlug}» ya lo usaba otra lista.` : ''),
        };
    }

    private async restoreField(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        this.assertCapability(viewer, 'field');
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'field', tenantId, id);
            this.assertCanRestore(viewer, 'field', row.deleted_by);
            await exitTrashMode(tx);
            const list = await this.liveList(tx, tenantId, Number(row.list_id), 'campo');
            const slug = await this.freeFieldSlug(tx, list.id, String(row.slug));
            await enterTrashMode(tx);
            await tx.execute(sql`
                UPDATE fields SET deleted_at = NULL, deleted_by = NULL, slug = ${slug}, updated_at = now()
                WHERE tenant_id = ${tenantId} AND id = ${id}
            `);
            await exitTrashMode(tx);
            // v0.1.300 — Un ID automático en la papelera no numera (el trigger
            // sólo mira campos vivos): lo que se creó mientras tanto recibe su
            // número ahora, en orden de creación, del mismo contador.
            if (row.type === 'autonumber') await numberUnnumbered(tx, tenantId, list.id, id);
            return { list, name: String(row.label), oldSlug: String(row.slug), slug };
        });
        this.realtime.fields(tenantId, out.list.id);
        this.realtime.records(tenantId, out.list.id);
        const renamed = out.slug !== out.oldSlug ? out.slug : null;
        return {
            type: 'field',
            id,
            name: out.name,
            list_id: out.list.id,
            list_slug: out.list.slug,
            renamed_slug: renamed,
            paused: false,
            message:
                `Se restauró el campo «${out.name}» con sus valores.` +
                (renamed ? ` Su nombre interno ahora es «${renamed}»: «${out.oldSlug}» ya lo usaba otro campo.` : ''),
        };
    }

    private async restoreView(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        this.assertCapability(viewer, 'view');
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'view', tenantId, id);
            this.assertCanRestore(viewer, 'view', row.deleted_by);
            await exitTrashMode(tx);
            const list = await this.liveList(tx, tenantId, Number(row.list_id), 'vista');
            // "Una sola por defecto": si mientras estaba borrada se eligió otra, vuelve sin serlo.
            const [def] = (
                await tx.execute(sql`SELECT 1 FROM saved_views WHERE tenant_id = ${tenantId} AND list_id = ${list.id} AND is_default`)
            ).rows;
            await enterTrashMode(tx);
            await tx.execute(sql`
                UPDATE saved_views SET deleted_at = NULL, deleted_by = NULL, updated_at = now(),
                       is_default = CASE WHEN ${def !== undefined} THEN false ELSE is_default END
                WHERE tenant_id = ${tenantId} AND id = ${id}
            `);
            await exitTrashMode(tx);
            return { list, name: String(row.name) };
        });
        this.realtime.views(tenantId, out.list.id);
        return {
            type: 'view',
            id,
            name: out.name,
            list_id: out.list.id,
            list_slug: out.list.slug,
            renamed_slug: null,
            paused: false,
            message: `Se restauró la vista «${out.name}».`,
        };
    }

    private async restoreAutomation(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        this.assertCapability(viewer, 'automation');
        const pre = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'automation', tenantId, id);
            this.assertCanRestore(viewer, 'automation', row.deleted_by);
            await exitTrashMode(tx);
            await this.liveList(tx, tenantId, Number(row.list_id), 'automatización');
            return { active: Boolean(row.is_active) };
        });
        // Una activa que ya no cabe en el plan vuelve pausada (no se rechaza:
        // lo que se quería recuperar era la automatización, no que corra ya).
        let paused = false;
        if (pre.active && this.billing) {
            try {
                await this.billing.assertCanActivateAutomation(tenantId);
            } catch {
                paused = true;
            }
        }
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'automation', tenantId, id);
            this.assertCanRestore(viewer, 'automation', row.deleted_by);
            await tx.execute(sql`
                UPDATE automations SET deleted_at = NULL, deleted_by = NULL, updated_at = now(),
                       is_active = CASE WHEN ${paused} THEN false ELSE is_active END
                WHERE tenant_id = ${tenantId} AND id = ${id}
            `);
            await exitTrashMode(tx);
            const list = await this.liveList(tx, tenantId, Number(row.list_id), 'automatización');
            const [auto] = await tx.select().from(automations).where(and(eq(automations.tenantId, tenantId), eq(automations.id, id)));
            return { list, auto: auto!, name: String(row.name) };
        });
        await this.syncAutomations(tenantId, out.list.id, [out.auto]);
        return {
            type: 'automation',
            id,
            name: out.name,
            list_id: out.list.id,
            list_slug: out.list.slug,
            renamed_slug: null,
            paused,
            message: paused
                ? `Se restauró la automatización «${out.name}», pausada: tu plan no permite más automatizaciones activas.`
                : `Se restauró la automatización «${out.name}».`,
        };
    }

    private async restoreDashboard(tenantId: number, viewer: TrashViewer, id: number): Promise<TrashRestoreResult> {
        this.assertCapability(viewer, 'dashboard');
        const out = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const row = await this.trashedRow(tx, 'dashboard', tenantId, id);
            this.assertCanRestore(viewer, 'dashboard', row.deleted_by);
            await exitTrashMode(tx);
            const [def] = (await tx.execute(sql`SELECT 1 FROM dashboards WHERE tenant_id = ${tenantId} AND is_default`)).rows;
            await enterTrashMode(tx);
            await tx.execute(sql`
                UPDATE dashboards SET deleted_at = NULL, deleted_by = NULL, updated_at = now(),
                       is_default = CASE WHEN ${def !== undefined} THEN false ELSE is_default END
                WHERE tenant_id = ${tenantId} AND id = ${id}
            `);
            await exitTrashMode(tx);
            return { name: String(row.name) };
        });
        return {
            type: 'dashboard',
            id,
            name: out.name,
            list_id: null,
            list_slug: null,
            renamed_slug: null,
            paused: false,
            message: `Se restauró el tablero «${out.name}».`,
        };
    }

    // ── Borrar para siempre ─────────────────────────────────────────────

    /** «Borrar definitivamente» UNA cosa de la papelera (quien la borró o un admin). */
    async purge(tenantId: number, viewer: TrashViewer, type: TrashItemType, id: number): Promise<{ purged: number }> {
        const label = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (type === 'record') {
                const row = await this.trashedRecord(tx, tenantId, id);
                if (viewer.role !== 'admin' && row.deletedBy !== viewer.userId) throw notAllowed();
                return (await this.recordTitle(tx, tenantId, row.listId, row.data)) ?? `#${id}`;
            }
            const row = await this.trashedRow(tx, type, tenantId, id);
            this.assertCanRestore(viewer, type, row.deleted_by);
            await exitTrashMode(tx);
            return String(row.name ?? row.label ?? `#${id}`);
        });
        const purged = await this.purgeItems(tenantId, type, [id]);
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'trash.purge',
            targetType: type,
            targetId: id,
            targetLabel: label,
        });
        return { purged };
    }

    /** «Vaciar papelera»: todo lo que hay, de la empresa entera (sólo admin). */
    async empty(tenantId: number, viewer: TrashViewer): Promise<{ purged: number }> {
        if (viewer.role !== 'admin') {
            throw new ForbiddenException({ code: 'trash_forbidden', message: 'Sólo un admin puede vaciar la papelera.', data: { status: 403 } });
        }
        const purged = await this.purgeOlderThan(tenantId, null);
        await this.audit.log({
            tenantId,
            userId: viewer.userId,
            action: 'trash.empty',
            targetType: 'trash',
            targetLabel: 'Papelera',
            meta: { purged },
        });
        return { purged };
    }

    /**
     * Barrido diario (todas las empresas): borra de verdad lo que pasó el
     * plazo. La conexión base sólo enumera QUÉ empresas tienen algo vencido;
     * el borrado corre dentro del scope de cada una.
     */
    async purgeExpired(now: Date = new Date()): Promise<number> {
        const cutoff = new Date(now.getTime() - this.retentionDays() * 86_400_000);
        const res = await this.db.execute<{ tenant_id: number | string }>(sql`
            SELECT tenant_id FROM lists WHERE deleted_at < ${cutoff}
            UNION SELECT tenant_id FROM fields WHERE deleted_at < ${cutoff}
            UNION SELECT tenant_id FROM saved_views WHERE deleted_at < ${cutoff}
            UNION SELECT tenant_id FROM automations WHERE deleted_at < ${cutoff}
            UNION SELECT tenant_id FROM dashboards WHERE deleted_at < ${cutoff}
            UNION SELECT tenant_id FROM records WHERE deleted_at < ${cutoff}
        `);
        let total = 0;
        for (const r of res.rows) {
            const tenantId = Number(r.tenant_id);
            try {
                const n = await this.purgeOlderThan(tenantId, cutoff);
                total += n;
                if (n > 0) {
                    await this.audit.log({
                        tenantId,
                        userId: null,
                        action: 'trash.purge',
                        targetType: 'trash',
                        targetLabel: `Vaciado automático (${this.retentionDays()} días)`,
                        meta: { purged: n, auto: true },
                    });
                }
            } catch (err) {
                this.logger.error(`No se pudo vaciar la papelera de la empresa ${tenantId}: ${String(err)}`);
            }
        }
        return total;
    }

    /**
     * Purga todo lo borrado ANTES de `cutoff` (null = todo). Primero las
     * listas (se llevan lo de adentro por cascada), después tableros, campos,
     * vistas, automatizaciones y registros sueltos, en tandas.
     */
    private async purgeOlderThan(tenantId: number, cutoff: Date | null): Promise<number> {
        const before = cutoff === null ? sql`` : sql` AND deleted_at < ${cutoff}`;
        let total = 0;
        for (const type of ['list', 'dashboard', 'field', 'view', 'automation', 'record'] as const) {
            for (;;) {
                const ids = await this.tenantDb.withTenant(tenantId, async (tx) => {
                    await enterTrashMode(tx);
                    const rows = await tx.execute<{ id: number | string }>(sql`
                        SELECT id FROM ${sql.raw(TABLE_OF[type])}
                        WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL${before}
                        ORDER BY id LIMIT ${PURGE_BATCH}
                    `);
                    await exitTrashMode(tx);
                    return rows.rows.map((r) => Number(r.id));
                });
                if (ids.length === 0) break;
                const n = await this.purgeItems(tenantId, type, ids);
                total += n;
                // Sin avance (no debería pasar) mejor cortar que girar para siempre.
                if (n === 0 || ids.length < PURGE_BATCH) break;
            }
        }
        return total;
    }

    /**
     * El borrado de verdad (el de antes de la papelera), con cascadas. Junta
     * los archivos que usaban esas filas y, después del commit, borra los que
     * ya no usa nadie (bytes incluidos).
     */
    private async purgeItems(tenantId: number, type: TrashItemType, ids: number[]): Promise<number> {
        if (ids.length === 0) return 0;
        const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);
        const done = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await enterTrashMode(tx);
            let candidates: number[] = [];
            let automationIds: number[] = [];
            let n = 0;
            if (type === 'record') {
                candidates = await this.recordFiles(tx, tenantId, sql`(r.id IN (${idList}) OR r.parent_id IN (${idList}))`);
                const res = await tx.execute(sql`DELETE FROM records WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`);
                n = res.rows.length;
            } else if (type === 'list') {
                candidates = [
                    ...(await this.recordFiles(tx, tenantId, sql`r.list_id IN (${idList})`)),
                    ...(await this.jsonFiles(tx, sql`SELECT settings AS doc FROM lists WHERE tenant_id = ${tenantId} AND id IN (${idList})`)),
                ];
                automationIds = (
                    await tx.execute<{ id: number | string }>(sql`SELECT id FROM automations WHERE tenant_id = ${tenantId} AND list_id IN (${idList})`)
                ).rows.map((a) => Number(a.id));
                const res = await tx.execute(sql`DELETE FROM lists WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`);
                n = res.rows.length;
            } else if (type === 'field') {
                const doomed = (
                    await tx.execute<{ id: number | string; list_id: number | string; type: string }>(sql`
                        SELECT id, list_id, type FROM fields WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList})
                    `)
                ).rows;
                for (const f of doomed) {
                    const key = `f${Number(f.id)}`;
                    if (f.type === 'file') {
                        candidates.push(
                            ...(await this.numbersIn(tx, sql`
                                SELECT v FROM records r, jsonb_path_query(r.data -> ${key}, 'lax $[*]') v
                                WHERE r.tenant_id = ${tenantId} AND r.list_id = ${Number(f.list_id)} AND r.data ? ${key}
                            `)),
                        );
                    }
                    // Los valores del campo se van con él.
                    await tx.execute(sql`
                        UPDATE records SET data = data - ${key}
                        WHERE tenant_id = ${tenantId} AND list_id = ${Number(f.list_id)} AND data ? ${key}
                    `);
                }
                const res = await tx.execute(sql`DELETE FROM fields WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`);
                n = res.rows.length;
            } else if (type === 'view') {
                n = (await tx.execute(sql`DELETE FROM saved_views WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`)).rows.length;
            } else if (type === 'automation') {
                automationIds = ids;
                n = (await tx.execute(sql`DELETE FROM automations WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`)).rows.length;
            } else {
                candidates = await this.jsonFiles(
                    tx,
                    sql`SELECT widgets AS doc FROM dashboards WHERE tenant_id = ${tenantId} AND id IN (${idList})
                        UNION ALL SELECT settings FROM dashboards WHERE tenant_id = ${tenantId} AND id IN (${idList})`,
                );
                n = (await tx.execute(sql`DELETE FROM dashboards WHERE tenant_id = ${tenantId} AND deleted_at IS NOT NULL AND id IN (${idList}) RETURNING id`)).rows.length;
            }
            await exitTrashMode(tx);
            return { n, candidates, automationIds };
        });
        for (const id of done.automationIds) await this.scheduler?.remove(id);
        await this.cleanupFiles(tenantId, done.candidates);
        return done.n;
    }

    // ── Archivos que ya no usa nadie ─────────────────────────────────────

    /** Ids de adjuntos que usan estos registros: campos de archivo, descripción y documentos emitidos. */
    private async recordFiles(tx: Tx, tenantId: number, which: SQL): Promise<number[]> {
        const keys = await this.fileFieldKeys(tx, tenantId);
        const out: number[] = [];
        if (keys.length > 0) {
            out.push(
                ...(await this.numbersIn(tx, sql`
                    SELECT v FROM records r, jsonb_each(r.data) kv, jsonb_path_query(kv.value, 'lax $[*]') v
                    WHERE r.tenant_id = ${tenantId} AND ${which}
                      AND kv.key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
                `)),
            );
        }
        out.push(
            ...(await this.numbersIn(tx, sql`
                SELECT v FROM records r, jsonb_path_query(r.description, 'lax $.**.fileId') v
                WHERE r.tenant_id = ${tenantId} AND r.description IS NOT NULL AND ${which}
            `)),
            ...(await this.numbersIn(tx, sql`
                SELECT to_jsonb(dn.file_id) AS v FROM document_numbers dn JOIN records r ON r.id = dn.record_id
                WHERE dn.tenant_id = ${tenantId} AND dn.file_id IS NOT NULL AND ${which}
            `)),
        );
        return out;
    }

    /**
     * Ids de archivos en unos JSON de configuración (diseños de ficha/portal,
     * tableros, correos, documentos, marca): por las claves con que se guardan
     * (`file_id`, `image_file_id`, `logo_file_id`, `fileId`, `attachment_ids`) y
     * por los enlaces `/files/<id>/` (las imágenes de un correo van por URL).
     */
    private async jsonFiles(tx: Tx, docs: SQL): Promise<number[]> {
        return this.numbersIn(
            tx,
            sql`WITH d AS (${docs})
                SELECT v FROM d, jsonb_path_query(d.doc, 'lax $.**.file_id') v
                UNION ALL SELECT v FROM d, jsonb_path_query(d.doc, 'lax $.**.image_file_id') v
                UNION ALL SELECT v FROM d, jsonb_path_query(d.doc, 'lax $.**.logo_file_id') v
                UNION ALL SELECT v FROM d, jsonb_path_query(d.doc, 'lax $.**.fileId') v
                UNION ALL SELECT v FROM d, jsonb_path_query(d.doc, 'lax $.**.attachment_ids[*]') v
                UNION ALL SELECT v FROM d, jsonb_path_query(CASE WHEN jsonb_typeof(d.doc) = 'array' THEN d.doc ELSE '[]'::jsonb END, 'lax $[*] ? (@.type() == "number")') v
                UNION ALL SELECT to_jsonb(m[1]) FROM d, regexp_matches(d.doc::text, '/files/([0-9]+)/', 'g') m`,
        );
    }

    private async numbersIn(tx: Tx, query: SQL): Promise<number[]> {
        const res = await tx.execute<{ n: string }>(sql`
            SELECT DISTINCT (q.v #>> '{}') AS n FROM (${query}) q
            WHERE (q.v #>> '{}') ~ '^[0-9]{1,15}$'
        `);
        return res.rows.map((r) => Number(r.n)).filter((n) => Number.isSafeInteger(n) && n > 0);
    }

    private async fileFieldKeys(tx: Tx, tenantId: number): Promise<string[]> {
        const rows = await tx.execute<{ id: number | string }>(sql`SELECT id FROM fields WHERE tenant_id = ${tenantId} AND type = 'file'`);
        return rows.rows.map((r) => `f${Number(r.id)}`);
    }

    /**
     * De los candidatos, borra los que no usa NADA: ni otro registro (vivo o en
     * la papelera — se puede restaurar), ni una descripción, ni un documento
     * emitido, ni un diseño (ficha, portal, correos, tableros, formularios,
     * marca de la empresa). Ante la duda se queda: un archivo de más es mejor
     * que un archivo que falta.
     */
    private async cleanupFiles(tenantId: number, candidateIds: number[]): Promise<void> {
        const candidates = [...new Set(candidateIds)];
        if (candidates.length === 0) return;
        const doomed = await this.tenantDb.withTenant(tenantId, async (tx) => {
            await enterTrashMode(tx);
            const cand = sql.join(candidates.map((c) => sql`${String(c)}`), sql`, `);
            const keep = new Set<number>();
            const add = (ns: number[]) => ns.forEach((n) => keep.add(n));
            const keys = await this.fileFieldKeys(tx, tenantId);
            if (keys.length > 0) {
                add(
                    await this.numbersIn(tx, sql`
                        SELECT v FROM records r, jsonb_each(r.data) kv, jsonb_path_query(kv.value, 'lax $[*]') v
                        WHERE r.tenant_id = ${tenantId} AND kv.key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
                          AND (v #>> '{}') IN (${cand})
                    `),
                );
            }
            add(
                await this.numbersIn(tx, sql`
                    SELECT v FROM records r, jsonb_path_query(r.description, 'lax $.**.fileId') v
                    WHERE r.tenant_id = ${tenantId} AND r.description IS NOT NULL AND (v #>> '{}') IN (${cand})
                `),
            );
            add(
                await this.numbersIn(tx, sql`
                    SELECT to_jsonb(file_id) AS v FROM document_numbers
                    WHERE tenant_id = ${tenantId} AND file_id IS NOT NULL AND file_id::text IN (${cand})
                `),
            );
            const docs = sql`
                SELECT settings AS doc FROM lists WHERE tenant_id = ${tenantId}
                UNION ALL SELECT config FROM saved_views WHERE tenant_id = ${tenantId}
                UNION ALL SELECT widgets FROM dashboards WHERE tenant_id = ${tenantId}
                UNION ALL SELECT settings FROM dashboards WHERE tenant_id = ${tenantId}
                UNION ALL SELECT actions FROM automations WHERE tenant_id = ${tenantId}
                UNION ALL SELECT trigger_config FROM automations WHERE tenant_id = ${tenantId}
                UNION ALL SELECT design FROM document_templates WHERE tenant_id = ${tenantId}
                UNION ALL SELECT config FROM forms WHERE tenant_id = ${tenantId}
                UNION ALL SELECT attachment_ids FROM form_pending_submissions WHERE tenant_id = ${tenantId}
                UNION ALL SELECT metadata FROM comments WHERE tenant_id = ${tenantId}
                UNION ALL SELECT settings FROM tenants WHERE id = ${tenantId}
            `;
            const inDocs = new Set(await this.jsonFiles(tx, docs));
            for (const c of candidates) if (inDocs.has(c)) keep.add(c);
            await exitTrashMode(tx);
            return candidates.filter((c) => !keep.has(c));
        });
        for (const id of doomed) {
            // Sin actor: lo borra el sistema. Respeta lo que `remove` protege
            // (el PDF de un documento emitido) y borra los bytes.
            await this.files.remove(tenantId, id).catch(() => undefined);
        }
    }

    // ── Ayudas ──────────────────────────────────────────────────────────

    private async syncAutomations(tenantId: number, listId: number, rows: AutomationRow[]): Promise<void> {
        for (const row of rows) await this.scheduler?.sync(tenantId, row);
        await this.dispatcher?.invalidate(tenantId, listId);
    }

    private assertCapability(viewer: TrashViewer, type: Exclude<TrashItemType, 'record'>): void {
        if (!can(viewer, CAPABILITY_FOR[type])) throw notAllowed();
    }

    private assertCanRestore(viewer: TrashViewer, type: TrashItemType, deletedBy: unknown): void {
        if (viewer.role === 'admin') return;
        if (type !== 'record' && !can(viewer, CAPABILITY_FOR[type])) throw notAllowed();
        if (deletedBy === null || Number(deletedBy) !== viewer.userId) throw notAllowed();
    }

    /** Un registro: quien lo borró (si todavía puede borrar ese registro) o un admin. */
    private assertCanRestoreRecord(
        viewer: TrashViewer,
        settings: Record<string, unknown>,
        row: { createdBy: number; data: Record<string, unknown>; deletedBy: number | null },
    ): void {
        if (viewer.role === 'admin') return;
        if (row.deletedBy !== viewer.userId) throw notAllowed();
        if (!listRowInScope(settings, viewer, 'delete', { createdBy: row.createdBy, data: row.data })) throw notAllowed();
    }

    /** Una fila de la papelera (deja el modo papelera ENCENDIDO). */
    private async trashedRow(tx: Tx, type: Exclude<TrashItemType, 'record'>, tenantId: number, id: number): Promise<Record<string, unknown>> {
        await enterTrashMode(tx);
        const [row] = (
            await tx.execute<Record<string, unknown>>(sql`
                SELECT * FROM ${sql.raw(TABLE_OF[type])}
                WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
            `)
        ).rows;
        if (!row) throw notInTrash();
        // Lo de adentro de una lista borrada vuelve con la lista.
        if (type !== 'list' && type !== 'dashboard') {
            const [list] = (
                await tx.execute<{ deleted_at: Date | null }>(sql`SELECT deleted_at FROM lists WHERE tenant_id = ${tenantId} AND id = ${Number(row.list_id)}`)
            ).rows;
            if (list && list.deleted_at !== null) throw parentListInTrash();
        }
        return row;
    }

    private async trashedRecord(
        tx: Tx,
        tenantId: number,
        id: number,
    ): Promise<{ id: number; listId: number; parentId: number | null; createdBy: number; deletedBy: number | null; deletedAt: string; data: Record<string, unknown> }> {
        const [row] = (
            await tx.execute<{
                id: number | string;
                list_id: number | string;
                parent_id: number | string | null;
                created_by: number | string;
                deleted_by: number | string | null;
                deleted_at: Date | string;
                data: Record<string, unknown>;
            }>(sql`
                SELECT id, list_id, parent_id, created_by, deleted_by, deleted_at, data FROM records
                WHERE tenant_id = ${tenantId} AND id = ${id} AND deleted_at IS NOT NULL
            `)
        ).rows;
        if (!row) throw notInTrash();
        return {
            id: Number(row.id),
            listId: Number(row.list_id),
            parentId: row.parent_id === null ? null : Number(row.parent_id),
            createdBy: Number(row.created_by),
            deletedBy: row.deleted_by === null ? null : Number(row.deleted_by),
            deletedAt: toDate(row.deleted_at).toISOString(),
            data: (row.data ?? {}) as Record<string, unknown>,
        };
    }

    /** Subtareas que se fueron con este registro (mismo instante). */
    private async kidsDeletedWith(tx: Tx, tenantId: number, id: number): Promise<number> {
        const [n] = (
            await tx.execute<{ n: number | string }>(sql`
                SELECT count(*)::int AS n FROM records c JOIN records p ON p.id = c.parent_id
                WHERE c.tenant_id = ${tenantId} AND p.id = ${id} AND c.deleted_at IS NOT NULL
                  AND c.deleted_at BETWEEN p.deleted_at - interval '1 second' AND p.deleted_at + interval '1 second'
            `)
        ).rows;
        return Number(n?.n ?? 0);
    }

    /** La lista VIVA (modo papelera apagado); si está en la papelera, el motivo. */
    private async liveList(
        tx: Tx,
        tenantId: number,
        listId: number,
        what: string,
    ): Promise<{ id: number; slug: string; name: string; settings: Record<string, unknown> }> {
        await exitTrashMode(tx);
        const [l] = (
            await tx.execute<{ id: number | string; slug: string; name: string; settings: Record<string, unknown> | null }>(
                sql`SELECT id, slug, name, settings FROM lists WHERE tenant_id = ${tenantId} AND id = ${listId}`,
            )
        ).rows;
        if (l) return { id: Number(l.id), slug: l.slug, name: l.name, settings: (l.settings ?? {}) as Record<string, unknown> };
        await enterTrashMode(tx);
        const [gone] = (
            await tx.execute<{ name: string }>(sql`SELECT name FROM lists WHERE tenant_id = ${tenantId} AND id = ${listId}`)
        ).rows;
        await exitTrashMode(tx);
        if (gone) {
            throw new ConflictException({
                code: 'trash_parent_in_trash',
                message: `Este ${what} es de la lista «${gone.name}», que está en la papelera: restaura primero la lista.`,
                data: { status: 409 },
            });
        }
        throw notInTrash();
    }

    private async recordTitle(tx: Tx, tenantId: number, listId: number, data: Record<string, unknown>): Promise<string | null> {
        const listRow = (
            await tx.execute<{ settings: Record<string, unknown> | null }>(sql`SELECT settings FROM lists WHERE tenant_id = ${tenantId} AND id = ${listId}`)
        ).rows[0];
        const fieldRows = (
            await tx.execute<{ id: number | string; type: string }>(
                sql`SELECT id, type FROM fields WHERE tenant_id = ${tenantId} AND list_id = ${listId} AND deleted_at IS NULL ORDER BY position, id`,
            )
        ).rows.map((f) => ({ id: Number(f.id), type: f.type }));
        const titleId = resolveTitleFieldId(fieldRows as never, listRow?.settings ?? {});
        if (titleId === null) return null;
        const v = data[`f${titleId}`];
        return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 190) : null;
    }

    /** El slug de la lista, o con sufijo `_2`, `_3`… si lo tomó otra viva. */
    private async freeListSlug(tx: Tx, tenantId: number, slug: string): Promise<string> {
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? slug : `${slug.slice(0, 60)}_${i + 1}`;
            if (i > 0 && !listSlugSchema.safeParse(candidate).success) continue;
            const [hit] = (await tx.execute(sql`SELECT 1 FROM lists WHERE tenant_id = ${tenantId} AND slug = ${candidate}`)).rows;
            if (!hit) return candidate;
        }
        throw new ConflictException({ code: 'slug_taken', message: 'No se encontró un nombre interno libre para la lista.', data: { status: 409 } });
    }

    private async freeFieldSlug(tx: Tx, listId: number, slug: string): Promise<string> {
        for (let i = 0; i < 1000; i++) {
            const candidate = i === 0 ? slug : `${slug.slice(0, 60)}_${i + 1}`;
            if (i > 0 && !fieldSlugSchema.safeParse(candidate).success) continue;
            const [hit] = (await tx.execute(sql`SELECT 1 FROM fields WHERE list_id = ${listId} AND slug = ${candidate}`)).rows;
            if (!hit) return candidate;
        }
        throw new ConflictException({ code: 'slug_taken', message: 'No se encontró un nombre interno libre para el campo.', data: { status: 409 } });
    }
}

function toDate(v: Date | string): Date {
    return v instanceof Date ? v : new Date(v);
}

function notInTrash(): NotFoundException {
    return new NotFoundException({ code: 'trash_item_not_found', message: 'Eso ya no está en la papelera.', data: { status: 404 } });
}

function notAllowed(): ForbiddenException {
    return new ForbiddenException({
        code: 'trash_forbidden',
        message: 'Sólo quien lo borró o un admin de la empresa puede restaurarlo o borrarlo para siempre.',
        data: { status: 403 },
    });
}

function parentListInTrash(): ConflictException {
    return new ConflictException({
        code: 'trash_parent_in_trash',
        message: 'Es de una lista que está en la papelera: restaura primero la lista (vuelve con todo lo de adentro).',
        data: { status: 409 },
    });
}

/**
 * v0.1.300 — Numera, uno por uno y en orden de creación, los registros vivos
 * de la lista que no tienen el ID automático `fieldId`. Cada UPDATE pasa por
 * el trigger `imcrm_records_autonumber`, que toma el siguiente número del
 * contador del campo (no se repite ninguno ya emitido).
 */
async function numberUnnumbered(tx: Tx, tenantId: number, listId: number, fieldId: number): Promise<void> {
    const key = `f${fieldId}`;
    const pending = (
        await tx.execute<{ id: number }>(sql`
            SELECT id FROM records
            WHERE tenant_id = ${tenantId} AND list_id = ${listId} AND deleted_at IS NULL
              AND coalesce(data ->> ${key}, '') = ''
            ORDER BY created_at, id
        `)
    ).rows;
    for (const r of pending) {
        await tx.execute(sql`UPDATE records SET data = data WHERE tenant_id = ${tenantId} AND id = ${Number(r.id)}`);
    }
}
