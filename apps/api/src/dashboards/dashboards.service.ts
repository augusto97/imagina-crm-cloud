import { Injectable, NotFoundException } from '@nestjs/common';
import {
    type AggregateMetric,
    type AggregateRequest,
    type CreateDashboardInput,
    type Dashboard,
    type UpdateDashboardInput,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, eq } from 'drizzle-orm';
import { AggregateService } from '../aggregate/aggregate.service';
import { dashboards } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

type Row = typeof dashboards.$inferSelect;

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
    ) {}

    async list(tenantId: number): Promise<Dashboard[]> {
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select().from(dashboards).where(eq(dashboards.tenantId, tenantId)).orderBy(dashboards.position),
        );
        return rows.map(toDashboard);
    }

    async get(tenantId: number, id: number): Promise<Dashboard> {
        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)))
                .limit(1),
        );
        if (!row) throw notFound(id);
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
                    createdBy: userId,
                })
                .returning();
        });
        return toDashboard(row!);
    }

    async update(tenantId: number, id: number, patch: UpdateDashboardInput): Promise<Dashboard> {
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
                    updatedAt: new Date(),
                })
                .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id)))
                .returning();
        });
        if (!row) throw notFound(id);
        return toDashboard(row);
    }

    async remove(tenantId: number, id: number): Promise<void> {
        await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.delete(dashboards).where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, id))),
        );
    }

    /**
     * Evalúa un widget (por id) y devuelve su data en el shape que consume la
     * UI del fork: KPI `{value, metric}`, charts `{data:[{label,value}]}`,
     * stat_delta `{value, previous, delta_pct, period_days, metric}`, table
     * `{columns, rows}`.
     */
    async widgetData(tenantId: number, dashboardId: number, widgetId: string): Promise<unknown> {
        const dash = await this.get(tenantId, dashboardId);
        const widget = dash.widgets.find((w) => w.id === widgetId);
        if (!widget) throw new NotFoundException({ code: 'widget_not_found', message: 'Widget no encontrado', data: { status: 404 } });
        return this.computeWidget(tenantId, widget);
    }

    /**
     * Evalúa TODOS los widgets del dashboard en UN request (PERF-03). Resuelve
     * el dashboard una sola vez (antes cada widget lo re-resolvía: N GETs × varias
     * queries). Devuelve `{ [widgetId]: data }`. El front lo comparte entre los
     * widgets vía un único queryKey → una sola llamada HTTP para todo el tablero.
     */
    async widgetsData(tenantId: number, dashboardId: number): Promise<Record<string, unknown>> {
        const dash = await this.get(tenantId, dashboardId);
        const entries = await Promise.all(
            dash.widgets.map(async (w) => [w.id, await this.computeWidget(tenantId, w)] as const),
        );
        return Object.fromEntries(entries);
    }

    private async computeWidget(tenantId: number, widget: WidgetSpec): Promise<unknown> {
        const cfg = widget.config as Record<string, unknown>;
        const list = String(widget.list_id);
        const metricFieldId = numOrUndef(cfg.metric_field_id);
        let metric: AggregateMetric = (typeof cfg.metric === 'string' ? cfg.metric : 'count') as AggregateMetric;
        // Métricas que necesitan campo pero no lo tienen → caen a count.
        if (FIELD_METRICS.has(metric) && metricFieldId === undefined) metric = 'count';
        const filterTree = cfg.filter_tree as AggregateRequest['filter_tree'];

        if (widget.type === 'kpi') {
            const r = await this.aggregate.run(tenantId, list, { metric, field_id: metricFieldId, filter_tree: filterTree });
            return { value: r.value ?? 0, metric };
        }

        if (widget.type === 'stat_delta') {
            const r = await this.aggregate.run(tenantId, list, { metric, field_id: metricFieldId, filter_tree: filterTree });
            // Delta básico: sin partición temporal previa devolvemos previous=value.
            return { value: r.value ?? 0, previous: r.value ?? 0, delta_pct: 0, period_days: 30, metric };
        }

        if (widget.type === 'table') {
            // El detalle de filas del widget de tabla llega en una iteración
            // siguiente; por ahora no rompe (se muestra vacío).
            return { columns: [], rows: [] };
        }

        // charts (bar/pie/line/area/funnel): agrupado.
        const groupBy = numOrUndef(cfg.group_by_field_id) ?? numOrUndef(cfg.date_field_id);
        const r = await this.aggregate.run(tenantId, list, {
            metric,
            field_id: metricFieldId,
            group_by_field_id: groupBy,
            filter_tree: filterTree,
        });
        const data = (r.groups ?? []).map((g) => ({
            label: g.group ?? '(sin valor)',
            value: g.value ?? 0,
        }));
        return { data };
    }
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
