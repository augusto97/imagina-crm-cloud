import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
    dateRangePresetSchema,
    timeBucketSchema,
    type AggregateMetric,
    type AggregateRequest,
    type CreateDashboardInput,
    type Dashboard,
    type FilterNode,
    type Role,
    type UpdateDashboardInput,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { AggregateService } from '../aggregate/aggregate.service';
import { dashboards } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';

type Row = typeof dashboards.$inferSelect;

/** Quién mira: para filtrar por visibilidad (el backend SIEMPRE decide). */
export interface DashboardViewer {
    userId: number;
    role: string;
}

/**
 * ¿`viewer` puede VER este dashboard? El admin y el creador siempre;
 * `workspace` lo ve cualquiera; `roles` sólo los roles listados.
 */
function canSee(row: Row, viewer: DashboardViewer): boolean {
    if (viewer.role === 'admin') return true;
    if (row.createdBy === viewer.userId) return true;
    if (row.visibility === 'workspace') return true;
    if (row.visibility === 'roles') return (row.allowedRoles ?? []).includes(viewer.role);
    return false; // private de otro usuario
}

/** Métricas que operan sobre un campo (sin field_id caen a `count`). */
const FIELD_METRICS = new Set(['count_unique', 'count_empty', 'sum', 'avg', 'min', 'max', 'count_true', 'count_false']);

/**
 * Dashboards del workspace + evaluación de widgets sobre el motor de agregados
 * (AggregateService). CRUD con RLS por tenant; los widgets se guardan como jsonb
 * y se evalúan on-demand en `widgetData`.
 */
@Injectable()
export class DashboardsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly aggregate: AggregateService,
        private readonly records: RecordsService,
        private readonly fields: FieldsService,
    ) {}

    async list(tenantId: number, viewer: DashboardViewer): Promise<Dashboard[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(dashboards).where(eq(dashboards.tenantId, tenantId)).orderBy(dashboards.position),
        );
        return rows.filter((r) => canSee(r, viewer)).map(toDashboard);
    }

    async get(tenantId: number, id: number, viewer: DashboardViewer): Promise<Dashboard> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)))
                .limit(1),
        );
        // 404 también cuando existe pero no es visible (no filtramos existencia).
        if (!row || !canSee(row, viewer)) throw notFound(id);
        return toDashboard(row);
    }

    async create(tenantId: number, userId: number, input: CreateDashboardInput): Promise<Dashboard> {
        const [row] = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (input.is_default) await clearDefault(tx, tenantId);
            return tx
                .insert(dashboards)
                .values({
                    tenantId,
                    userId,
                    name: input.name,
                    description: input.description ?? null,
                    widgets: (input.widgets ?? []) as unknown[],
                    isDefault: input.is_default ?? false,
                    position: input.position ?? 0,
                    visibility: input.visibility ?? 'workspace',
                    allowedRoles: input.allowed_roles ?? [],
                    createdBy: userId,
                })
                .returning();
        });
        return toDashboard(row!);
    }

    async update(tenantId: number, id: number, viewer: DashboardViewer, patch: UpdateDashboardInput): Promise<Dashboard> {
        await this.assertCanManage(tenantId, id, viewer);
        const [row] = await this.tenantDb.withTenant(tenantId, async (tx) => {
            if (patch.is_default) await clearDefault(tx, tenantId);
            return tx
                .update(dashboards)
                .set({
                    ...(patch.name !== undefined ? { name: patch.name } : {}),
                    ...(patch.description !== undefined ? { description: patch.description } : {}),
                    ...(patch.widgets !== undefined ? { widgets: patch.widgets as unknown[] } : {}),
                    ...(patch.is_default !== undefined ? { isDefault: patch.is_default } : {}),
                    ...(patch.position !== undefined ? { position: patch.position } : {}),
                    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
                    ...(patch.allowed_roles !== undefined ? { allowedRoles: patch.allowed_roles } : {}),
                    updatedAt: new Date(),
                })
                .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)))
                .returning();
        });
        if (!row) throw notFound(id);
        return toDashboard(row);
    }

    async remove(tenantId: number, id: number, viewer: DashboardViewer): Promise<void> {
        await this.assertCanManage(tenantId, id, viewer);
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(dashboards).where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id))),
        );
    }

    /**
     * Mutar un dashboard exige (además de `manage_dashboards`, que valida el
     * guard) ser el CREADOR o admin — un manager no edita/borra tableros
     * ajenos que ni siquiera puede ver.
     */
    private async assertCanManage(tenantId: number, id: number, viewer: DashboardViewer): Promise<void> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)))
                .limit(1),
        );
        if (!row) throw notFound(id);
        if (viewer.role === 'admin' || row.createdBy === viewer.userId) return;
        if (!canSee(row, viewer)) throw notFound(id); // invisible → existencia opaca
        throw new ForbiddenException({
            code: 'dashboard_not_owner',
            message: 'Sólo el creador o un admin pueden modificar este dashboard',
            data: { status: 403 },
        });
    }

    /**
     * Evalúa un widget (por id) y devuelve su data en el shape que consume la
     * UI del fork: KPI `{value, metric}`, charts `{data:[{label,value}]}`,
     * stat_delta `{value, previous, delta_pct, period_days, metric}`, table
     * `{columns, rows}`.
     */
    async widgetData(tenantId: number, dashboardId: number, viewer: DashboardViewer, widgetId: string): Promise<unknown> {
        const dash = await this.get(tenantId, dashboardId, viewer);
        const widget = dash.widgets.find((w) => w.id === widgetId);
        if (!widget) throw new NotFoundException({ code: 'widget_not_found', message: 'Widget no encontrado', data: { status: 404 } });
        return this.computeWidget(tenantId, viewer, widget);
    }

    /**
     * Evalúa TODOS los widgets del dashboard en UN request (PERF-03). Resuelve
     * el dashboard una sola vez (antes cada widget lo re-resolvía: N GETs × varias
     * queries). Devuelve `{ [widgetId]: data }`. El front lo comparte entre los
     * widgets vía un único queryKey → una sola llamada HTTP para todo el tablero.
     */
    async widgetsData(tenantId: number, dashboardId: number, viewer: DashboardViewer): Promise<Record<string, unknown>> {
        const dash = await this.get(tenantId, dashboardId, viewer);
        const entries = await Promise.all(
            dash.widgets.map(async (w) => [w.id, await this.computeWidget(tenantId, viewer, w)] as const),
        );
        return Object.fromEntries(entries);
    }

    private async computeWidget(tenantId: number, viewer: DashboardViewer, widget: WidgetSpec): Promise<unknown> {
        const cfg = widget.config as Record<string, unknown>;
        const list = String(widget.list_id);
        const metricFieldId = numOrUndef(cfg.metric_field_id);
        let metric: AggregateMetric = (typeof cfg.metric === 'string' ? cfg.metric : 'count') as AggregateMetric;
        // Métricas que necesitan campo pero no lo tienen → caen a count.
        if (FIELD_METRICS.has(metric) && metricFieldId === undefined) metric = 'count';
        // v0.1.97 — el "Período" del widget POR FIN filtra: se inyecta como
        // condición `between_relative` en AND con el filter_tree (se resuelve
        // contra now() en cada evaluación — "este mes" es siempre el actual).
        const filterTree = withPeriod(cfg);

        if (widget.type === 'kpi') {
            const r = await this.aggregate.run(tenantId, list, { metric, field_id: metricFieldId, filter_tree: filterTree });
            return { value: r.value ?? 0, metric };
        }

        if (widget.type === 'stat_delta') {
            // v0.1.97 — delta REAL: misma métrica sobre dos ventanas
            // consecutivas de `period_days` días sobre el campo de fecha.
            const dateFieldId = numOrUndef(cfg.date_field_id);
            if (dateFieldId === undefined) {
                const r = await this.aggregate.run(tenantId, list, { metric, field_id: metricFieldId, filter_tree: filterTree });
                return { value: r.value ?? 0, previous: r.value ?? 0, delta_pct: null, period_days: 0, metric };
            }
            const d = await this.aggregate.runDelta(
                tenantId,
                list,
                { metric, field_id: metricFieldId, filter_tree: filterTree },
                { dateFieldId, periodDays: Number(cfg.period_days) || 30 },
            );
            return { ...d, metric };
        }

        if (widget.type === 'table') {
            // v0.1.97 — tabla REAL: reusa RecordsService.list (ACL del viewer:
            // scope por rol + campos ocultos ya stripped) y traduce data
            // f{id}→slug al shape {columns, rows} que consume la UI.
            return this.computeTable(tenantId, viewer, widget, filterTree);
        }

        // charts (bar/pie/line/area/funnel): agrupado. Si el campo agrupado es
        // date/datetime, `time_bucket` define la granularidad (default month
        // para los charts de tendencia, que agrupan por date_field_id).
        const groupBy = numOrUndef(cfg.group_by_field_id) ?? numOrUndef(cfg.date_field_id);
        const bucketParsed = timeBucketSchema.safeParse(cfg.time_bucket);
        const timeBucket = bucketParsed.success
            ? bucketParsed.data
            : (widget.type === 'chart_line' || widget.type === 'chart_area' ? 'month' as const : undefined);
        const r = await this.aggregate.run(tenantId, list, {
            metric,
            field_id: metricFieldId,
            group_by_field_id: groupBy,
            filter_tree: filterTree,
            time_bucket: timeBucket,
        });
        const data = (r.groups ?? []).map((g) => ({
            label: g.group ?? '(sin valor)',
            value: g.value ?? 0,
        }));
        return { data };
    }

    /** Widget de tabla: Top N registros con columnas visibles y orden. */
    private async computeTable(
        tenantId: number,
        viewer: DashboardViewer,
        widget: WidgetSpec,
        filterTree: AggregateRequest['filter_tree'],
    ): Promise<{ columns: Array<{ label: string; slug: string; type: string }>; rows: Array<{ id: number; fields: Record<string, unknown> }> }> {
        const cfg = widget.config as Record<string, unknown>;
        const fields = await this.fields.list(tenantId, String(widget.list_id));

        // Columnas: las visibles configuradas (en su orden) o todas (orden de
        // la lista) capadas a 8 para que el card no explote.
        const visibleIds = Array.isArray(cfg.visible_field_ids)
            ? (cfg.visible_field_ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
            : [];
        const byId = new Map(fields.map((f) => [f.id, f]));
        const columns = (visibleIds.length > 0
            ? visibleIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => f !== undefined)
            : fields.slice(0, 8)
        ).map((f) => ({ label: f.label, slug: f.slug, type: f.type, id: f.id }));

        const sortFieldId = numOrUndef(cfg.sort_field_id);
        const sortDir: 'asc' | 'desc' = cfg.sort_dir === 'asc' ? 'asc' : 'desc';
        const limit = Math.max(1, Math.min(50, Number(cfg.limit) || 10));

        const page = await this.records.list(
            tenantId,
            { userId: viewer.userId, role: viewer.role as Role },
            String(widget.list_id),
            {
                limit,
                // Sin campo de orden: los más recientes primero (id desc).
                sort_dir: sortFieldId === undefined ? 'desc' : 'asc',
                sort: sortFieldId !== undefined ? `field_${sortFieldId}:${sortDir}` : undefined,
                filter_tree: filterTree,
            },
        );

        const rows = page.data.map((rec) => {
            const out: Record<string, unknown> = {};
            for (const col of columns) {
                out[col.slug] = (rec.data as Record<string, unknown>)[`f${col.id}`] ?? null;
            }
            return { id: rec.id, fields: out };
        });
        return { columns: columns.map(({ label, slug, type }) => ({ label, slug, type })), rows };
    }
}

/**
 * Compone el filter_tree del widget con su período relativo (si tiene). Un
 * preset desconocido se ignora (no rompe el bundle completo del dashboard).
 */
function withPeriod(cfg: Record<string, unknown>): AggregateRequest['filter_tree'] {
    const base = cfg.filter_tree as AggregateRequest['filter_tree'];
    const period = cfg.period as { field_id?: unknown; preset?: unknown } | null | undefined;
    const fieldId = numOrUndef(period?.field_id);
    const preset = dateRangePresetSchema.safeParse(period?.preset);
    if (fieldId === undefined || !preset.success) return base;
    const cond: FilterNode = { type: 'condition', field_id: fieldId, op: 'between_relative', value: preset.data };
    const children: FilterNode[] = base ? [base, cond] : [cond];
    return { type: 'group', logic: 'and', children };
}

function toDashboard(row: Row): Dashboard {
    return {
        id: row.id,
        user_id: row.userId,
        name: row.name,
        description: row.description,
        widgets: (row.widgets as WidgetSpec[]) ?? [],
        is_default: row.isDefault,
        position: row.position,
        visibility: (row.visibility ?? 'workspace') as Dashboard['visibility'],
        allowed_roles: row.allowedRoles ?? [],
        created_by: row.createdBy,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

async function clearDefault(tx: Parameters<Parameters<TenantDb['withTenant']>[1]>[0], tenantId: number): Promise<void> {
    await tx.update(dashboards).set({ isDefault: false }).where(eq(dashboards.tenantId, tenantId));
}

function numOrUndef(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'dashboard_not_found', message: `Dashboard ${id} no encontrado`, data: { status: 404 } });
}
