import { BadRequestException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
    AGGREGATE_OTHERS_KEY,
    BREAKDOWN_WIDGET_TYPES,
    CONTENT_WIDGET_TYPES,
    DEFAULT_PIVOT_COLS,
    DEFAULT_PIVOT_ROWS,
    DEFAULT_SERIES_TOP_N,
    DASHBOARD_FILTER_ME,
    dateRangePresetSchema,
    readStoreListMarker,
    resolveTitleFieldId,
    timeBucketSchema,
    zonedToday,
    addDaysYmd,
    type AggregateMetric,
    type AggregateRequest,
    type CreateDashboardInput,
    type Dashboard,
    type DashboardBundleRequest,
    type DashboardFilterValue,
    type Field,
    type FilterNode,
    type Role,
    type TimeBucket,
    type UpdateDashboardInput,
    type WidgetSpec,
} from '@imagina-base/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AggregateService, MAX_GROUPS, type AggregateListContext } from '../aggregate/aggregate.service';
import type { Tx } from '../db/client';
import { dashboards } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import type { RelatedScope } from '../records/related-scope';
import { relativeDateRange } from '../records/query-builder';
import { RecordsService } from '../records/records.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { mapLimit } from '../common/map-limit';
import { fillTimeBuckets, zeroFillable } from './time-buckets';
import { trashRow } from '../trash/trash-ops';

/**
 * v0.1.286 — El bundle agrupa los widgets por LISTA: cada lista resuelve su
 * contexto (lista, campos, ACL, reloj) UNA vez y evalúa sus widgets en a lo
 * sumo `CHUNKS_PER_LIST` transacciones en paralelo; de a `LIST_CONCURRENCY`
 * listas. Ninguna transacción espera a otra (sin riesgo de agotar el pool).
 */
const LIST_CONCURRENCY = 2;
const CHUNKS_PER_LIST = 2;

/** Tope de grupos de un gráfico por categoría (el resto va a "Otros"). */
const DEFAULT_TOP_N = 50;

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

/** v0.1.292 — La misma regla de `canSee`, sobre el DTO (destinatarios de un envío programado). */
export function dashboardVisibleTo(dash: Pick<Dashboard, 'created_by' | 'visibility' | 'allowed_roles'>, viewer: DashboardViewer): boolean {
    if (viewer.role === 'admin') return true;
    if (dash.created_by === viewer.userId) return true;
    if (dash.visibility === 'workspace') return true;
    if (dash.visibility === 'roles') return (dash.allowed_roles ?? []).includes(viewer.role);
    return false;
}

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
            // v0.1.286 — desempate por id: con todas las posiciones en 0 el
            // orden cambiaba después de editar un tablero.
            tx.select().from(dashboards).where(eq(dashboards.tenantId, tenantId)).orderBy(asc(dashboards.position), asc(dashboards.id)),
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
                    settings: input.settings ?? {},
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
                    ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
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

    /**
     * Papelera: el tablero deja de verse (su enlace público responde 404 y los
     * envíos programados no salen) y restaurarlo lo trae como estaba.
     */
    async remove(tenantId: number, id: number, viewer: DashboardViewer): Promise<void> {
        await this.assertCanManage(tenantId, id, viewer);
        await this.tenantDb.withTenant(tenantId, (tx) => trashRow(tx, 'dashboards', tenantId, id, viewer.userId));
    }

    /**
     * v0.1.286 — Reordenar los tableros del menú (arrastrar en el panel): la
     * posición es el índice en `ids`. Los ids tienen que ser tableros del
     * tenant y VISIBLES para quien reordena (un tablero privado ajeno ni
     * existe para él). Es orden compartido del workspace, como el de listas.
     */
    async reorder(tenantId: number, viewer: DashboardViewer, ids: number[]): Promise<Dashboard[]> {
        const unique = [...new Set(ids)];
        if (unique.length !== ids.length) {
            throw new BadRequestException({ code: 'dashboard_reorder_invalid', message: 'Ids repetidos', data: { status: 400 } });
        }
        await this.tenantDb.withTenant(tenantId, async (tx) => {
            const rows = await tx
                .select()
                .from(dashboards)
                .where(and(eq(dashboards.tenantId, tenantId), inArray(dashboards.id, unique)));
            const visible = new Set(rows.filter((r) => canSee(r, viewer)).map((r) => r.id));
            const missing = unique.find((id) => !visible.has(id));
            if (missing !== undefined) throw notFound(missing);
            for (let i = 0; i < unique.length; i++) {
                await tx
                    .update(dashboards)
                    .set({ position: i })
                    .where(and(eq(dashboards.tenantId, tenantId), eq(dashboards.id, unique[i]!)));
            }
        });
        return this.list(tenantId, viewer);
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
     * v0.1.292 — ¿`viewer` puede cambiar este tablero? (creador o admin). Lo
     * usan Compartir → enlace público y los envíos programados.
     */
    assertManageable(tenantId: number, id: number, viewer: DashboardViewer): Promise<void> {
        return this.assertCanManage(tenantId, id, viewer);
    }

    /**
     * v0.1.292 — Todos los widgets de un tablero YA leído, con el acceso de
     * `viewer` (la página pública y el correo programado: quien publicó o es
     * dueño del envío). Mismo motor y mismo shape que `widgetsData`.
     */
    evaluateDashboard(
        tenantId: number,
        dash: Dashboard,
        viewer: DashboardViewer,
        body: DashboardBundleRequest = {},
    ): Promise<Record<string, unknown>> {
        return this.evaluate(tenantId, viewer, dash.widgets, bundleOptions(body));
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
        const out = await this.evaluate(tenantId, viewer, [widget], {});
        const one = out[widget.id] as { __error?: string } | undefined;
        return one ?? {};
    }

    /**
     * Evalúa TODOS los widgets del dashboard en UN request (PERF-03). Resuelve
     * el dashboard una sola vez (antes cada widget lo re-resolvía: N GETs × varias
     * queries). Devuelve `{ [widgetId]: data }`. El front lo comparte entre los
     * widgets vía un único queryKey → una sola llamada HTTP para todo el tablero.
     *
     * v0.1.100 — `period_preset`: período GLOBAL (pisa el del widget).
     * v0.1.286 — `filters`: filtros del TABLERO (Responsable, Estado, "Yo").
     */
    async widgetsData(
        tenantId: number,
        dashboardId: number,
        viewer: DashboardViewer,
        body: DashboardBundleRequest | string | undefined = {},
    ): Promise<Record<string, unknown>> {
        const dash = await this.get(tenantId, dashboardId, viewer);
        // Compat: los llamadores viejos pasaban el preset suelto.
        const req: DashboardBundleRequest = typeof body === 'string' ? { period_preset: body } : (body ?? {});
        return this.evaluate(tenantId, viewer, dash.widgets, bundleOptions(req));
    }

    /**
     * v0.1.286 — Vista previa de un widget SIN guardar (el diálogo de edición
     * lo dibuja con datos reales mientras se configura). Mismo motor, mismo
     * ACL y los mismos período/filtros del tablero que se está mirando.
     */
    async previewWidget(
        tenantId: number,
        dashboardId: number,
        viewer: DashboardViewer,
        widget: WidgetSpec,
        body: DashboardBundleRequest = {},
    ): Promise<unknown> {
        await this.get(tenantId, dashboardId, viewer);
        const out = await this.evaluate(tenantId, viewer, [widget], bundleOptions(body));
        return out[widget.id] ?? {};
    }

    /**
     * v0.1.230 — evalúa un widget "suelto" (no guardado en un tablero): los
     * gráficos de la ficha del registro, acotados a los registros vinculados
     * a ese registro. Mismo motor, mismo ACL, mismo shape de respuesta — así
     * la ficha reusa los componentes de los tableros tal cual.
     */
    async computeLooseWidget(
        tenantId: number,
        viewer: DashboardViewer,
        widget: WidgetSpec,
        related?: RelatedScope,
    ): Promise<unknown> {
        if (CONTENT_WIDGET_TYPES.includes(widget.type)) return {};
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.aggregate.listContext(tenantId, String(widget.list_id), aggViewer(viewer), tx);
            // En la ficha se cuenta TODO lo vinculado (las líneas de un pedido
            // son subtareas: contar sólo el primer nivel las perdería).
            return this.computeWidget({ tx, tenantId, viewer, ctx, related, rootsDefault: false }, widget);
        });
    }

    /**
     * Evalúa una lista de widgets: agrupa por lista, resuelve cada contexto
     * una vez y aísla los errores POR widget (v0.1.229: uno mal configurado
     * devuelve `{ __error }` y el resto se dibuja).
     */
    private async evaluate(
        tenantId: number,
        viewer: DashboardViewer,
        widgets: WidgetSpec[],
        opts: BundleOptions,
    ): Promise<Record<string, unknown>> {
        const out: Record<string, unknown> = {};
        const byList = new Map<number, WidgetSpec[]>();
        for (const w of widgets) {
            if (CONTENT_WIDGET_TYPES.includes(w.type)) {
                out[w.id] = {};
                continue;
            }
            const group = byList.get(w.list_id) ?? [];
            group.push(w);
            byList.set(w.list_id, group);
        }
        await mapLimit([...byList.entries()], LIST_CONCURRENCY, async ([listId, ws]) => {
            let ctx: AggregateListContext;
            try {
                ctx = await this.aggregate.listContext(tenantId, String(listId), aggViewer(viewer));
            } catch (err) {
                // Lista borrada / inaccesible: todos sus widgets con el motivo.
                const message = widgetErrorMessage(err);
                for (const w of ws) out[w.id] = { __error: message };
                return;
            }
            const chunks: WidgetSpec[][] = Array.from({ length: Math.min(CHUNKS_PER_LIST, ws.length) }, () => []);
            ws.forEach((w, i) => chunks[i % chunks.length]!.push(w));
            await Promise.all(chunks.map((queue) => this.drain(tenantId, viewer, ctx, queue, opts, out)));
        });
        // Mismo orden que los widgets del tablero.
        return Object.fromEntries(widgets.map((w) => [w.id, out[w.id] ?? { __error: 'No se pudo calcular este widget.' }]));
    }

    /**
     * Evalúa una cola de widgets en UNA transacción. Un error de dominio (400:
     * "sum sólo aplica a campos numéricos") se lanza ANTES de tocar la base y
     * la transacción sigue sirviendo; cualquier otro error pudo dejarla
     * abortada → el resto de la cola sigue en una transacción nueva.
     */
    private async drain(
        tenantId: number,
        viewer: DashboardViewer,
        ctx: AggregateListContext,
        queue: WidgetSpec[],
        opts: BundleOptions,
        out: Record<string, unknown>,
    ): Promise<void> {
        const work = async (tx: Tx): Promise<void> => {
            while (queue.length > 0) {
                const w = queue.shift()!;
                try {
                    out[w.id] = await this.computeWidget(
                        { tx, tenantId, viewer, ctx, periodOverride: opts.periodOverride, filters: opts.filters, rootsDefault: true },
                        w,
                    );
                } catch (err) {
                    out[w.id] = { __error: widgetErrorMessage(err) };
                    if (!(err instanceof HttpException)) return;
                }
            }
        };
        while (queue.length > 0) {
            const before = queue.length;
            try {
                await this.tenantDb.withTenant(tenantId, work);
            } catch {
                // El COMMIT de una transacción abortada no tira; si algo más
                // falla, la vuelta siguiente lo detecta (sin progreso).
            }
            if (queue.length === before) {
                for (const w of queue.splice(0)) out[w.id] = { __error: 'No se pudo calcular este widget.' };
            }
        }
    }

    private async computeWidget(env: WidgetEnv, widget: WidgetSpec): Promise<unknown> {
        // v0.1.98 — los widgets de CONTENIDO (título/texto/imagen/separador/
        // espaciador) no evalúan datos: el front renderiza desde su config.
        if (CONTENT_WIDGET_TYPES.includes(widget.type)) return {};
        const { tx, tenantId, ctx, related } = env;
        // SEC-25 (v0.1.226): cada widget agrega lo que QUIEN MIRA puede ver
        // (scope de su rol en la lista + sin campos ocultos), igual que la
        // tabla — ya resuelto en `ctx`.
        const cfg = widget.config as Record<string, unknown>;
        const metricFieldId = numOrUndef(cfg.metric_field_id);
        let metric: AggregateMetric = (typeof cfg.metric === 'string' ? cfg.metric : 'count') as AggregateMetric;
        // Métricas que necesitan campo pero no lo tienen → caen a count.
        if (FIELD_METRICS.has(metric) && metricFieldId === undefined) metric = 'count';
        // v0.1.286 — los tableros cuentan lo que muestra la tabla: el PRIMER
        // nivel (las subtareas no son "tareas" del KPI), salvo que el widget
        // pida incluirlas. Las listas de una tienda cuentan todo (sus packs
        // filtran por `tipo`: producto/variación, pedido/línea).
        const rootsOnly = env.rootsDefault
            && cfg.include_subtasks !== true
            && (cfg.include_subtasks === false || readStoreListMarker(ctx.list.settings) === null);
        const runOpts = { rootsOnly, related };

        // Filtro del widget (normalizado a grupo) + filtros del tablero.
        const baseTree = combineTrees(
            normalizeTree(cfg.filter_tree),
            dashboardFilterNodes(env.filters ?? [], ctx, env.viewer),
        );
        // v0.1.97 — el "Período" del widget POR FIN filtra: se inyecta como
        // condición `between_relative` en AND con el filter_tree (se resuelve
        // contra now() en cada evaluación — "este mes" es siempre el actual).
        const period = effectivePeriod(cfg, env.periodOverride);
        const periodTree = period
            ? combineTrees(baseTree, [{ type: 'condition', field_id: period.fieldId, op: 'between_relative', value: period.value }])
            : baseTree;
        const metricField = metricFieldId !== undefined ? ctx.byId.get(metricFieldId) : undefined;

        if (widget.type === 'kpi' || widget.type === 'gauge') {
            const r = await this.aggregate.runIn(tx, tenantId, ctx, { metric, field_id: metricFieldId, filter_tree: periodTree }, runOpts);
            const value = displayValue(r.value ?? 0, metric, metricField);
            // v0.1.99 — mini-tendencia del KPI: si el widget configura
            // `spark_field_id` (campo fecha), se agrega la MISMA métrica
            // agrupada por día sobre los últimos 30 días → spark[].
            // v0.1.286 — con los 30 días COMPLETOS (los días sin registros
            // valen 0 en las métricas que lo permiten).
            const sparkFieldId = numOrUndef(cfg.spark_field_id);
            if (widget.type === 'kpi' && sparkFieldId !== undefined) {
                try {
                    const sparkTree = combineTrees(periodTree, [
                        { type: 'condition', field_id: sparkFieldId, op: 'between_relative', value: 'last_30_days' },
                    ]);
                    // Savepoint: un spark inválido no puede abortar la
                    // transacción del resto de los widgets.
                    const sp = await tx.transaction((stx) =>
                        this.aggregate.runIn(stx as unknown as Tx, tenantId, ctx, {
                            metric,
                            field_id: metricFieldId,
                            group_by_field_id: sparkFieldId,
                            filter_tree: sparkTree,
                            time_bucket: 'day',
                        }, runOpts),
                    );
                    let points = (sp.groups ?? [])
                        .filter((g) => g.group !== null)
                        .map((g) => ({ label: g.group as string, value: typeof g.value === 'number' ? g.value : 0 }));
                    if (zeroFillable(metric)) {
                        const today = zonedToday(ctx.clock.timeZone, ctx.clock.now);
                        points = fillTimeBuckets(points, 'day', { from: addDaysYmd(today, -29), to: today }) as typeof points;
                    }
                    return { value, metric, spark: points.map((p) => (typeof p.value === 'number' ? p.value : 0)) };
                } catch {
                    // Un spark inválido (campo borrado / tipo cambiado) no
                    // rompe el KPI — se devuelve sin tendencia.
                    return { value, metric };
                }
            }
            return { value, metric };
        }

        if (widget.type === 'stat_delta') {
            // v0.1.97 — delta REAL: misma métrica sobre dos ventanas
            // consecutivas de `period_days` días sobre el campo de fecha.
            const dateFieldId = numOrUndef(cfg.date_field_id) ?? period?.fieldId;
            if (dateFieldId === undefined) {
                const r = await this.aggregate.runIn(tx, tenantId, ctx, { metric, field_id: metricFieldId, filter_tree: periodTree }, runOpts);
                const v = displayValue(r.value ?? 0, metric, metricField);
                return { value: v, previous: v, delta_pct: null, period_days: 0, metric };
            }
            // v0.1.286 — con período (del widget o el global), la ventana
            // ACTUAL es el período y la anterior la del mismo largo justo
            // antes. Un período abierto ("de hoy en adelante") no es una
            // ventana: ahí manda `period_days` y el período filtra.
            const window = period ? relativeDateRange(period.value, ctx.clock) : null;
            const usable = window !== null && daysSpan(window) <= 3660;
            const d = await this.aggregate.runDeltaIn(
                tx,
                tenantId,
                ctx,
                { metric, field_id: metricFieldId, filter_tree: usable ? baseTree : periodTree },
                {
                    dateFieldId,
                    periodDays: Number(cfg.period_days) || 30,
                    window: usable ? window : undefined,
                    rootsOnly,
                    related,
                },
            );
            return {
                ...d,
                value: displayValue(d.value ?? 0, metric, metricField),
                previous: displayValue(d.previous ?? 0, metric, metricField),
                metric,
            };
        }

        if (widget.type === 'table') {
            // v0.1.97 — tabla REAL: reusa RecordsService.list (ACL del viewer:
            // scope por rol + campos ocultos ya stripped).
            return this.computeTable(env, widget, periodTree, rootsOnly);
        }

        if (widget.type === 'pivot') {
            return this.computePivot(env, cfg, { metric, metricFieldId, metricField, filterTree: periodTree, runOpts });
        }

        // charts (bar/pie/line/area/funnel): agrupado. Si el campo agrupado es
        // date/datetime, `time_bucket` define la granularidad (default month
        // para los charts de tendencia, que agrupan por date_field_id).
        const groupBy = numOrUndef(cfg.group_by_field_id) ?? numOrUndef(cfg.date_field_id);
        const bucketParsed = timeBucketSchema.safeParse(cfg.time_bucket);
        const timeBucket = bucketParsed.success
            ? bucketParsed.data
            : (widget.type === 'chart_line' || widget.type === 'chart_area' ? 'month' as const : undefined);
        const groupField = groupBy !== undefined ? ctx.byId.get(groupBy) : undefined;
        const bucketed: TimeBucket | undefined =
            timeBucket !== undefined && (groupField?.type === 'date' || groupField?.type === 'datetime') ? timeBucket : undefined;
        // v0.1.286 — tope de grupos con "Otros": los de mayor valor primero
        // en un gráfico por categoría; una serie temporal va completa y en
        // orden cronológico.
        const topN = Math.max(1, Math.min(200, Math.floor(Number(cfg.top_n)) || DEFAULT_TOP_N));
        const top = bucketed ? { limit: MAX_GROUPS, byValue: false } : { limit: topN, byValue: true };

        // v0.1.292 — "Desglosar por" un segundo campo: barras apiladas (o lado
        // a lado) y áreas/líneas por serie. El motor agrupa en dos niveles, con
        // las N series principales y el resto en "Otros".
        const subId = numOrUndef(cfg.sub_group_by_field_id);
        if (subId !== undefined && subId !== groupBy && BREAKDOWN_WIDGET_TYPES.includes(widget.type)) {
            const subField = ctx.byId.get(subId);
            const subBucket = subBucketFor(cfg, subField);
            const seriesN = Math.max(1, Math.min(20, Math.floor(Number(cfg.series_top_n)) || DEFAULT_SERIES_TOP_N));
            const rr = await this.aggregate.runIn(tx, tenantId, ctx, {
                metric,
                field_id: metricFieldId,
                group_by_field_id: groupBy,
                sub_group_by_field_id: subId,
                filter_tree: periodTree,
                time_bucket: timeBucket,
                sub_time_bucket: subBucket,
            }, { ...runOpts, top, subTop: subBucket ? { limit: MAX_GROUPS, byValue: false } : { limit: seriesN, byValue: true }, withTotals: true });
            const label = (k: string | null): string => k ?? '(sin valor)';
            let rows: Array<{ label: string; value: number | string; others?: number; segments?: Array<{ series: string; value: number | string }> }> = (rr.groups ?? []).map((g) => ({
                label: label(g.group),
                value: displayValue(g.value ?? 0, metric, metricField),
                ...(g.group === AGGREGATE_OTHERS_KEY && g.others !== undefined ? { others: g.others } : {}),
                segments: (g.sub_groups ?? []).map((sg) => ({ series: label(sg.group), value: displayValue(sg.value ?? 0, metric, metricField) })),
            }));
            if (bucketed && zeroFillable(metric)) rows = fillTimeBuckets(rows, bucketed);
            return {
                data: rows,
                series: (rr.sub_totals ?? []).map((st) => ({
                    key: label(st.group),
                    value: displayValue(st.value ?? 0, metric, metricField),
                    ...(st.others !== undefined ? { others: st.others } : {}),
                })),
                ...(rr.hidden_sub_groups ? { hidden_pairs: rr.hidden_sub_groups } : {}),
            };
        }

        const r = await this.aggregate.runIn(tx, tenantId, ctx, {
            metric,
            field_id: metricFieldId,
            group_by_field_id: groupBy,
            filter_tree: periodTree,
            time_bucket: timeBucket,
        }, { ...runOpts, top });
        let data: Array<{ label: string; value: number | string; others?: number }> = (r.groups ?? []).map((g) => ({
            label: g.group ?? '(sin valor)',
            value: displayValue(g.value ?? 0, metric, metricField),
            ...(g.group === AGGREGATE_OTHERS_KEY && g.others !== undefined ? { others: g.others } : {}),
        }));
        // v0.1.286 — los buckets vacíos valen 0 entre el primero y el último
        // (antes la línea unía meses no contiguos y la pendiente mentía).
        if (bucketed && zeroFillable(metric)) data = fillTimeBuckets(data, bucketed);
        return { data };
    }

    /**
     * v0.1.292 — Tabla dinámica: filas = un campo, columnas = otro, la
     * métrica en cada cruce. Una sola consulta del motor en dos niveles con
     * totales: el de cada fila y cada columna sale calculado sobre SUS
     * registros (bien también para promedio, mín/máx o únicos), igual que el
     * total general. Las N filas y columnas principales; el resto en "Otros".
     * Un eje de fecha va completo y en orden cronológico.
     */
    private async computePivot(
        env: WidgetEnv,
        cfg: Record<string, unknown>,
        m: {
            metric: AggregateMetric;
            metricFieldId: number | undefined;
            metricField: Field | undefined;
            filterTree: AggregateRequest['filter_tree'];
            runOpts: { rootsOnly: boolean; related?: RelatedScope };
        },
    ): Promise<unknown> {
        const { tx, tenantId, ctx } = env;
        const rowId = numOrUndef(cfg.group_by_field_id);
        const colId = numOrUndef(cfg.sub_group_by_field_id);
        if (rowId === undefined || colId === undefined || rowId === colId) {
            throw new BadRequestException({
                code: 'invalid_pivot',
                message: 'La tabla dinámica necesita un campo para las filas y otro distinto para las columnas.',
                data: { status: 400 },
            });
        }
        const rowBucket = subBucketFor({ sub_time_bucket: cfg.time_bucket }, ctx.byId.get(rowId));
        const colBucket = subBucketFor(cfg, ctx.byId.get(colId));
        const rowsN = Math.max(1, Math.min(200, Math.floor(Number(cfg.top_n)) || DEFAULT_PIVOT_ROWS));
        const colsN = Math.max(1, Math.min(50, Math.floor(Number(cfg.col_top_n)) || DEFAULT_PIVOT_COLS));
        const r = await this.aggregate.runIn(tx, tenantId, ctx, {
            metric: m.metric,
            field_id: m.metricFieldId,
            group_by_field_id: rowId,
            sub_group_by_field_id: colId,
            filter_tree: m.filterTree,
            time_bucket: rowBucket,
            sub_time_bucket: colBucket,
        }, {
            ...m.runOpts,
            // Un eje de fecha va COMPLETO y en orden (con un tope por clave se
            // perderían los períodos más recientes): el período lo acota.
            top: rowBucket ? { limit: MAX_GROUPS, byValue: false } : { limit: rowsN, byValue: true },
            subTop: colBucket ? { limit: MAX_GROUPS, byValue: false } : { limit: colsN, byValue: true },
            withTotals: true,
        });
        const label = (k: string | null): string => k ?? '(sin valor)';
        const show = (v: number | string | null): number | string | null => (v === null ? null : displayValue(v, m.metric, m.metricField));
        const cells: Array<{ row: string; col: string; value: number | string | null }> = [];
        for (const g of r.groups ?? []) {
            for (const sg of g.sub_groups ?? []) cells.push({ row: label(g.group), col: label(sg.group), value: show(sg.value) });
        }
        return {
            pivot: {
                rows: (r.groups ?? []).map((g) => ({ key: label(g.group), value: show(g.value), ...(g.others !== undefined ? { others: g.others } : {}) })),
                cols: (r.sub_totals ?? []).map((st) => ({ key: label(st.group), value: show(st.value), ...(st.others !== undefined ? { others: st.others } : {}) })),
                cells,
                total: show(r.value),
                ...(r.hidden_sub_groups ? { hidden_cells: r.hidden_sub_groups } : {}),
            },
        };
    }

    /** Widget de tabla: Top N registros con columnas visibles y orden. */
    private async computeTable(
        env: WidgetEnv,
        widget: WidgetSpec,
        filterTree: AggregateRequest['filter_tree'],
        rootsOnly: boolean,
    ): Promise<{ columns: Array<{ label: string; slug: string; type: string; id: number }>; rows: Array<{ id: number; fields: Record<string, unknown> }> }> {
        const { ctx } = env;
        const cfg = widget.config as Record<string, unknown>;
        // SEC-25: las columnas ocultas para el rol de quien mira no se listan
        // (antes salían con nombre y valor vacío — el nombre ya es un dato).
        const fields = ctx.fields.filter((f) => !ctx.hidden.has(f.id));

        // Columnas: las visibles configuradas (en su orden) o, sin elegir,
        // v0.1.286 — el campo TÍTULO primero y los 7 siguientes (antes las 8
        // primeras por posición: el nombre del registro podía quedar afuera).
        const visibleIds = Array.isArray(cfg.visible_field_ids)
            ? (cfg.visible_field_ids as unknown[]).map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)
            : [];
        const byId = new Map(fields.map((f) => [f.id, f]));
        const chosen = visibleIds.map((id) => byId.get(id)).filter((f): f is Field => f !== undefined);
        const columns = (chosen.length > 0 ? chosen : defaultTableColumns(fields, ctx.list.settings))
            .map((f) => ({ label: f.label, slug: f.slug, type: f.type, id: f.id }));

        const sortFieldId = numOrUndef(cfg.sort_field_id);
        const sortDir: 'asc' | 'desc' = cfg.sort_dir === 'asc' ? 'asc' : 'desc';
        const limit = Math.max(1, Math.min(50, Number(cfg.limit) || 10));

        const page = await this.records.list(
            env.tenantId,
            { userId: env.viewer.userId, role: env.viewer.role as Role },
            String(widget.list_id),
            {
                limit,
                // Sin campo de orden: los más recientes primero (id desc).
                sort_dir: sortFieldId === undefined ? 'desc' : 'asc',
                sort: sortFieldId !== undefined ? `field_${sortFieldId}:${sortDir}` : undefined,
                filter_tree: filterTree,
                ...(rootsOnly || env.related ? {} : { include_subtasks: true }),
            },
            { related: env.related, tx: env.tx },
        );

        const rows = page.data.map((rec) => {
            const out: Record<string, unknown> = {};
            for (const col of columns) {
                out[col.slug] = col.type === 'relation'
                    ? ((rec as { relations?: Record<string, unknown> }).relations?.[`f${col.id}`] ?? [])
                    : (rec.data as Record<string, unknown>)[`f${col.id}`] ?? null;
            }
            return { id: rec.id, fields: out };
        });
        return { columns, rows };
    }
}

/** Métricas que operan sobre un campo (sin field_id caen a `count`). */
const FIELD_METRICS = new Set(['count_unique', 'count_empty', 'sum', 'avg', 'min', 'max', 'count_true', 'count_false']);

interface BundleOptions {
    periodOverride?: string;
    filters?: DashboardFilterValue[];
}

interface WidgetEnv {
    tx: Tx;
    tenantId: number;
    viewer: DashboardViewer;
    ctx: AggregateListContext;
    periodOverride?: string;
    filters?: DashboardFilterValue[];
    related?: RelatedScope;
    /** Bundle de un tablero: el primer nivel por defecto (ver `rootsOnly`). */
    rootsDefault: boolean;
}

function aggViewer(viewer: DashboardViewer): { role: Role; userId: number } {
    return { role: viewer.role as Role, userId: viewer.userId };
}

function bundleOptions(req: DashboardBundleRequest): BundleOptions {
    // v0.1.100 — filtro global de período: preset válido, rango custom
    // (`custom:from:to`, v0.1.105) o nada.
    const preset = typeof req.period_preset === 'string' && parsePeriodOverride(req.period_preset) !== undefined
        ? req.period_preset
        : undefined;
    return { periodOverride: preset, filters: Array.isArray(req.filters) ? req.filters : undefined };
}

/** Columnas por defecto de la tabla: el título y los 7 siguientes (sin relaciones). */
function defaultTableColumns(fields: Field[], settings: Record<string, unknown>): Field[] {
    const usable = fields.filter((f) => f.type !== 'relation');
    const titleId = resolveTitleFieldId(usable, settings);
    const title = usable.find((f) => f.id === titleId);
    return [...(title ? [title] : []), ...usable.filter((f) => f.id !== titleId)].slice(0, 8);
}

/** Días que abarca una ventana inclusive. */
function daysSpan(w: { from: string; to: string }): number {
    return Math.round((Date.parse(`${w.to}T00:00:00Z`) - Date.parse(`${w.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * v0.1.286 — Un min/max de fecha-hora llega como el texto de Postgres
 * (`2026-10-22 04:30:00+00`) y el KPI lo mostraba tal cual. Se devuelve como
 * instante ISO (la UI lo pinta en la zona y el formato de la empresa); una
 * fecha sola queda `YYYY-MM-DD`.
 */
function displayValue(
    value: number | string,
    metric: AggregateMetric,
    field: Field | undefined,
): number | string {
    if (typeof value !== 'string' || (metric !== 'min' && metric !== 'max')) return value;
    if (field?.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 10);
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2}(?::?\d{2})?|Z)?$/.exec(value.trim());
    if (!m) return value;
    const zone = m[3] === undefined ? 'Z' : m[3] === 'Z' ? 'Z' : m[3].length === 3 ? `${m[3]}:00` : m[3];
    const d = new Date(`${m[1]}T${m[2]}${zone}`);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** El filter_tree guardado como GRUPO (una plantilla vieja lo guardaba como condición suelta). */
function normalizeTree(raw: unknown): FilterNode | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const node = raw as FilterNode;
    if (node.type === 'group') return node.children.length > 0 ? node : undefined;
    if (node.type === 'condition') return { type: 'group', logic: 'and', children: [node] };
    return undefined;
}

/** AND de un árbol con condiciones extra (sin anidar grupos de más). */
function combineTrees(base: FilterNode | undefined, extra: FilterNode[]): AggregateRequest['filter_tree'] {
    if (extra.length === 0) return base as AggregateRequest['filter_tree'];
    const children: FilterNode[] = base ? [base, ...extra] : [...extra];
    return { type: 'group', logic: 'and', children };
}

/**
 * v0.1.286 — Condiciones de los filtros del TABLERO que aplican a esta lista
 * (el campo es de ella y quien mira lo puede ver). "Yo" en un campo persona
 * es quien mira; una opción de multi_select se busca como "contiene".
 */
function dashboardFilterNodes(filters: DashboardFilterValue[], ctx: AggregateListContext, viewer: DashboardViewer): FilterNode[] {
    const out: FilterNode[] = [];
    for (const f of filters) {
        const field = ctx.byId.get(f.field_id);
        if (!field) continue;
        let value: unknown = f.value;
        if (value === '' || (Array.isArray(value) && value.length === 0)) continue;
        if (field.type === 'user') {
            const ids = (Array.isArray(value) ? value : [value])
                .map((v) => (v === DASHBOARD_FILTER_ME ? viewer.userId : Number(v)))
                .filter((n) => Number.isInteger(n) && n > 0);
            if (ids.length === 0) continue;
            out.push(ids.length === 1
                ? { type: 'condition', field_id: field.id, op: 'eq', value: ids[0] }
                : { type: 'condition', field_id: field.id, op: 'in', value: ids });
            continue;
        }
        if (field.type === 'checkbox') {
            value = value === true || value === 'true' || value === '1';
            out.push({ type: 'condition', field_id: field.id, op: 'eq', value });
            continue;
        }
        if (field.type === 'multi_select') {
            const vals = (Array.isArray(value) ? value : [value]).map(String);
            out.push(vals.length === 1
                ? { type: 'condition', field_id: field.id, op: 'contains', value: vals[0] }
                : { type: 'group', logic: 'or', children: vals.map((v) => ({ type: 'condition' as const, field_id: field.id, op: 'contains' as const, value: v })) });
            continue;
        }
        if (Array.isArray(value)) {
            out.push({ type: 'condition', field_id: field.id, op: 'in', value });
            continue;
        }
        const textual = field.type === 'text' || field.type === 'long_text' || field.type === 'email' || field.type === 'url' || field.type === 'phone';
        out.push({ type: 'condition', field_id: field.id, op: textual ? 'contains' : 'eq', value });
    }
    return out;
}

/**
 * Compone el filter_tree del widget con su período relativo (si tiene). Un
 * preset desconocido se ignora (no rompe el bundle completo del dashboard).
 */
const CUSTOM_PERIOD_RE = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;
const CUSTOM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * v0.1.105 — un período puede ser un preset relativo ("this_month") o un
 * rango FIJO personalizado. El override global viaja como string
 * `custom:YYYY-MM-DD:YYYY-MM-DD`; el del widget como `{preset:'custom',
 * from, to}` en su config. Ambos terminan como value del between_relative.
 */
function parsePeriodOverride(raw: string | undefined): string | { from: string; to: string } | undefined {
    if (raw === undefined) return undefined;
    const m = CUSTOM_PERIOD_RE.exec(raw);
    if (m) return { from: m[1]!, to: m[2]! };
    const parsed = dateRangePresetSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
}

function widgetPeriodValue(
    period: { preset?: unknown; from?: unknown; to?: unknown } | null | undefined,
): string | { from: string; to: string } | undefined {
    if (!period) return undefined;
    if (period.preset === 'custom') {
        const { from, to } = period;
        if (typeof from === 'string' && typeof to === 'string' && CUSTOM_DATE_RE.test(from) && CUSTOM_DATE_RE.test(to)) {
            return { from, to };
        }
        return undefined;
    }
    const parsed = dateRangePresetSchema.safeParse(period.preset);
    return parsed.success ? parsed.data : undefined;
}

/**
 * El período que aplica al widget: el override GLOBAL pisa el preset del
 * widget (v0.1.100) y aplica sobre el campo del período del widget o, si no
 * tiene, sobre su campo de fecha (date_field_id de tendencias/delta). Sin
 * campo de fecha, no aplica. Un preset desconocido se ignora.
 */
function effectivePeriod(
    cfg: Record<string, unknown>,
    override?: string,
): { fieldId: number; value: string | { from: string; to: string } } | undefined {
    const period = cfg.period as { field_id?: unknown; preset?: unknown; from?: unknown; to?: unknown } | null | undefined;
    const overrideValue = parsePeriodOverride(override);
    const fieldId = numOrUndef(period?.field_id)
        ?? (overrideValue !== undefined ? numOrUndef(cfg.date_field_id) : undefined);
    const value = overrideValue ?? widgetPeriodValue(period);
    if (fieldId === undefined || value === undefined) return undefined;
    return { fieldId, value };
}

function toDashboard(row: Row): Dashboard {
    return {
        id: row.id,
        user_id: row.userId,
        name: row.name,
        description: row.description,
        widgets: (row.widgets as WidgetSpec[]) ?? [],
        settings: (row.settings as Record<string, unknown>) ?? {},
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

/**
 * v0.1.292 — Bucket temporal del SEGUNDO campo (desglose / columnas de una
 * tabla dinámica): sólo si es una fecha; sin elegir, por mes.
 */
function subBucketFor(cfg: Record<string, unknown>, field: Field | undefined): TimeBucket | undefined {
    if (field?.type !== 'date' && field?.type !== 'datetime') return undefined;
    const parsed = timeBucketSchema.safeParse(cfg.sub_time_bucket);
    return parsed.success ? parsed.data : 'month';
}

function numOrUndef(v: unknown): number | undefined {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({ code: 'dashboard_not_found', message: `Dashboard ${id} no encontrado`, data: { status: 404 } });
}

/**
 * Mensaje legible del error de UN widget (v0.1.229). Los errores de dominio
 * (400 del motor de agregados: "sum sólo aplica a campos numéricos") viajan
 * tal cual; cualquier otra cosa se loguea y sale genérica — un error de base
 * no tiene por qué llegarle al navegador.
 */
function widgetErrorMessage(err: unknown): string {
    if (err instanceof HttpException) {
        const res = err.getResponse();
        if (typeof res === 'object' && res !== null && typeof (res as { message?: unknown }).message === 'string') {
            return (res as { message: string }).message;
        }
        return err.message;
    }
    Logger.error(`widget: ${err instanceof Error ? err.stack ?? err.message : String(err)}`, 'DashboardsService');
    return 'No se pudo calcular este widget.';
}
