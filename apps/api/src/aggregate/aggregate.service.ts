import { relatedScopeSql, type RelatedScope } from '../records/related-scope';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import {
    type AggregateMetric,
    type AggregateRequest,
    type AggregateResult,
    type Field,
    type FieldType,
    type FilterNode,
    type Role,
    type TimeBucket,
    isSystemField,
    isThroughField,
    jsonbKeyForField,
    systemFieldBaseType,
    addDaysYmd,
    zonedInstant,
    zonedToday,
    FALLBACK_TIME_ZONE,
    AGGREGATE_OTHERS_KEY,
} from '@imagina-base/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { disableJitForTx, groupKeyHasSubquery } from '../db/no-jit';
import { records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { withComputedExprs } from '../records/computed-sql';
import { compileSearch } from '../records/search-sql';
import { effectivePermissions, resolvePermissions, scopeWhere, withDependentComputed } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import {
    compileFilterTree,
    descriptionSearchFilterable,
    fieldTextExpr,
    fieldTypedExpr,
    type FilterableField,
    type QueryClock,
} from '../records/query-builder';
import { TenantDb } from '../tenancy/tenant-db.service';
import { TenantTimeZones } from '../tenancy/tenant-time-zone.service';

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency', 'rating', 'percent', 'duration'];
const MINMAX_TYPES: readonly FieldType[] = [
    'number', 'currency', 'rating', 'percent', 'duration', 'date', 'datetime',
];

/**
 * Quién pide el agregado (SEC-25, v0.1.226). Con viewer se aplica el MISMO
 * ACL por lista que el listado de registros: el scope de lectura del rol (sólo
 * lo suyo / lo asignado / nada) y sus campos ocultos. Sin viewer (motores
 * internos: automatizaciones, sincronización) no hay recorte.
 */
export interface AggregateViewer {
    role: Role;
    userId: number;
}

/**
 * Motor de agregaciones (CONTRACT.md §5): footer de tabla + widgets de
 * dashboard. Compila la métrica a SQL sobre records.data con whitelist por
 * field_id y filter tree tipado; group_by opcional.
 */
@Injectable()
export class AggregateService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
        // v0.1.263 — "hoy/esta semana" y los buckets por día en el reloj de la empresa.
        @Optional() private readonly timeZones?: TenantTimeZones,
    ) {}

    /** v0.1.263 — "ahora" + la zona de la empresa para compilar filtros. */
    private async clock(tenantId: number): Promise<QueryClock> {
        return { now: new Date(), timeZone: this.timeZones ? await this.timeZones.orUtc(tenantId) : FALLBACK_TIME_ZONE };
    }

    /**
     * `aclFor` + SEC-36 (v0.1.239): los lookup/rollup hacia una lista que el
     * viewer no ve completa cuentan como ocultos (no se agregan, agrupan ni
     * filtran) — si no, un rollup "suma de las facturas" agrupado o filtrado
     * revelaba lo que la ACL de Facturas esconde.
     */
    private async aclWithThrough(
        tenantId: number,
        listId: number,
        settings: Record<string, unknown>,
        fields: Field[],
        viewer: AggregateViewer | undefined,
    ): Promise<ReturnType<typeof aclFor>> {
        const acl = aclFor(settings, fields, viewer);
        if (!viewer || viewer.role === 'admin' || !fields.some((f) => isThroughField(f.type))) return acl;
        const plans = await this.fields.throughPlansFor(tenantId, listId, fields);
        const restricted = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.fields.through.restrictedFor(tx, tenantId, plans, viewer),
        );
        if (restricted.size === 0) return acl;
        const hidden = withDependentComputed(fields, new Set([...acl.hidden, ...restricted]));
        return { ...acl, hidden, strip: <T>(m: Map<number, T>) => new Map([...m].filter(([id]) => !hidden.has(id))) };
    }

    /**
     * v0.1.286 — Lo que un agregado necesita saber de UNA lista: la lista, sus
     * campos, el ACL de quien pregunta (scope + ocultos, incluidos los
     * lookup/rollup restringidos de SEC-36), la whitelist filtrable con las
     * expresiones de rollup/computed y el reloj de la empresa. Todo en UNA
     * transacción (o en la que pasa el llamador). Antes `run` lo re-resolvía
     * por pedido en 4-9 transacciones: un tablero de 21 widgets abría ~107.
     */
    async listContext(
        tenantId: number,
        listIdOrSlug: string,
        viewer?: AggregateViewer,
        tx?: Tx,
    ): Promise<AggregateListContext> {
        const build = async (t: Tx): Promise<AggregateListContext> => {
            const list = await this.lists.getWithinTx(t, tenantId, listIdOrSlug);
            const fields = await this.fields.listByListIdWithinTx(t, tenantId, list.id);
            const plans = await this.fields.through.plans(t, tenantId, list.id, fields);
            const base = aclFor(list.settings, fields, viewer);
            let hidden = base.hidden;
            if (viewer && viewer.role !== 'admin' && plans.length > 0) {
                const restricted = await this.fields.through.restrictedFor(t, tenantId, plans, viewer);
                if (restricted.size > 0) hidden = withDependentComputed(fields, new Set([...hidden, ...restricted]));
            }
            const filterable = new Map<number, FilterableField>(
                [
                    ...fields.map((f): [number, FilterableField] => [f.id, { id: f.id, type: f.type }]),
                    ...this.fields.through.filterableFor(plans, tenantId),
                    descriptionSearchFilterable(),
                ].filter(([id]) => !hidden.has(id)),
            );
            const timeZone = this.timeZones ? await this.timeZones.orUtc(tenantId, t) : FALLBACK_TIME_ZONE;
            const now = new Date();
            return {
                list: { id: list.id, settings: list.settings },
                fields,
                byId: new Map(fields.filter((f) => !hidden.has(f.id)).map((f) => [f.id, f])),
                fieldsById: withComputedExprs(filterable, fields, timeZone, now),
                hidden,
                scope: base.scope,
                clock: { now, timeZone },
            };
        };
        return tx ? build(tx) : this.tenantDb.withTenant(tenantId, build);
    }

    async run(
        tenantId: number,
        listIdOrSlug: string,
        req: AggregateRequest,
        /**
         * v0.1.213 — `rootsOnly`: contar sólo las filas de primer nivel, las
         * que muestra la tabla (los grupos de la vista agrupada). Sin eso, en
         * una lista con subtareas (las líneas de un pedido) el contador de un
         * grupo sumaba filas que no se ven.
         */
        opts: AggregateRunOptions & { viewer?: AggregateViewer } = {},
    ): Promise<AggregateResult> {
        // v0.1.286 — contexto + consulta en UNA transacción.
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.listContext(tenantId, listIdOrSlug, opts.viewer, tx);
            return this.runIn(tx, tenantId, ctx, req, opts);
        });
    }

    /**
     * El agregado sobre un contexto YA resuelto y dentro de una transacción
     * abierta (v0.1.286): el bundle de un tablero resuelve cada lista una vez
     * y evalúa todos sus widgets así.
     */
    async runIn(
        tx: Tx,
        tenantId: number,
        ctx: AggregateListContext,
        req: AggregateRequest,
        opts: AggregateRunOptions = {},
    ): Promise<AggregateResult> {
        const { byId, fieldsById, clock } = ctx;
        const field = req.field_id !== undefined ? byId.get(req.field_id) : undefined;
        if (req.field_id !== undefined && !field) {
            throw badRequest('field_id no pertenece a la lista');
        }
        this.assertMetricCompat(req.metric, field, fieldsById);

        const filterWhere = compileFilterTree(fieldsById, req.filter_tree, clock);
        const baseWhere = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, ctx.list.id),
            isNull(records.deletedAt),
            opts.rootsOnly ? isNull(records.parentId) : undefined,
            ctx.scope,
            filterWhere,
            // v0.1.286 — la búsqueda de la tabla (vista agrupada), sólo sobre
            // los campos que quien pregunta puede ver.
            compileSearch(ctx.fields.filter((f) => !ctx.hidden.has(f.id)), opts.search),
            // v0.1.230 — sólo los vinculados a un registro (bloques de la ficha).
            opts.related ? relatedScopeSql(tenantId, opts.related) : undefined,
        );

        const aggExpr = this.metricExpr(req.metric, field, fieldsById);

        if (req.group_by_field_id !== undefined) {
            const groupField = byId.get(req.group_by_field_id);
            if (!groupField) throw badRequest('group_by_field_id no pertenece a la lista');
            const groupExpr = groupingExpr(groupField, req.time_bucket, fieldsById, clock.timeZone);
            if (groupKeyHasSubquery(groupField.type)) await disableJitForTx(tx);

            // v0.1.287 — SEGUNDO nivel (subgrupos de la vista agrupada, barras
            // apiladas, tabla dinámica): mismas reglas que el primero.
            if (req.sub_group_by_field_id !== undefined) {
                if (req.sub_group_by_field_id === groupField.id) throw badRequest('El segundo agrupado tiene que ser otro campo.');
                const subField = byId.get(req.sub_group_by_field_id);
                if (!subField) throw badRequest('sub_group_by_field_id no pertenece a la lista');
                const subExpr = groupingExpr(subField, req.sub_time_bucket, fieldsById, clock.timeZone);
                if (groupKeyHasSubquery(subField.type)) await disableJitForTx(tx);
                return this.twoLevelGroups(tx, baseWhere, groupExpr, subExpr, aggExpr, req.metric, opts);
            }

            if (opts.top) {
                return {
                    metric: req.metric,
                    value: null,
                    groups: await this.topGroups(tx, baseWhere, groupExpr, aggExpr, opts.top),
                };
            }
            const rows = await tx
                .select({ grp: groupExpr, val: aggExpr })
                .from(records)
                .where(baseWhere)
                // Por ORDINAL: la clave del multi_select lleva la clave del
                // campo como parámetro bindeado, y Postgres no reconoce
                // como "la misma expresión" a dos copias con placeholders
                // distintos ($1 en el SELECT, $6 en el GROUP BY).
                .groupBy(sql`1`)
                .orderBy(sql`1`);
            const groups = rows.map((r) => ({
                group: r.grp === null || r.grp === undefined ? null : String(r.grp),
                value: normalize(r.val),
            }));
            // El total global es la suma de los grupos para métricas aditivas;
            // para el resto devolvemos null (el desglose es lo relevante).
            return { metric: req.metric, value: null, groups };
        }

        const [row] = await tx.select({ val: aggExpr }).from(records).where(baseWhere);
        return { metric: req.metric, value: normalize(row?.val) };
    }

    /**
     * v0.1.287 — Agrupado en DOS niveles: `(grupo, subgrupo) → métrica` y,
     * además, la métrica de cada GRUPO entero (calculada sobre sus registros,
     * no sumando los subgrupos: así vale también para promedio, mín/máx o
     * valores únicos). Una sola consulta con `GROUPING SETS` sobre una
     * subconsulta que calcula las dos claves UNA vez por fila (la clave de un
     * multi_select o de un derivado es cara); la de afuera se llama "records",
     * así la métrica —que apunta a `"records"."data"`— vale sin tocarla.
     *
     * Con `top` (gráficos): los grupos son los de `topGroups` (los N primeros
     * + "Otros") y el desglose de "Otros" se calcula sobre SUS registros.
     * Tope de pares `(grupo, subgrupo)`: `MAX_SUB_GROUP_PAIRS`; los que no
     * entran se informan en `hidden_sub_groups`.
     *
     * v0.1.292 — `subTop`: lo mismo para el SEGUNDO nivel (las series de unas
     * barras apiladas, las columnas de una tabla dinámica): las N primeras y
     * el resto en "Otros", calculado sobre sus registros. `withTotals`: suma
     * los conjuntos `(subgrupo)` y `()` — el total de cada subgrupo sobre
     * TODOS los registros (`sub_totals`) y el total general (`value`), que
     * una tabla dinámica necesita bien calculados (un promedio por columna no
     * es la suma de las celdas).
     */
    private async twoLevelGroups(
        tx: Tx,
        baseWhere: SQL | undefined,
        groupExpr: SQL,
        subExpr: SQL,
        aggExpr: SQL,
        metric: AggregateMetric,
        opts: AggregateRunOptions,
    ): Promise<AggregateResult> {
        const { top, subTop, withTotals } = opts;
        const where = baseWhere ?? sql`true`;
        const K = sql.identifier('k');
        const R = sql.identifier('records');
        const kGrp = sql`${K}.${sql.identifier('grp')}`;
        const kSub = sql`${K}.${sql.identifier('sub')}`;
        let topList: NonNullable<AggregateResult['groups']> | null = null;
        let bucketCol = kGrp;
        if (top) {
            topList = await this.topGroups(tx, baseWhere, groupExpr, aggExpr, top);
            const kept = topList.filter((g) => g.group !== AGGREGATE_OTHERS_KEY);
            if (kept.length < topList.length) {
                // Lo que no entró en el tope cae en "Otros" también en el desglose.
                bucketCol = othersCase(kGrp, kept.map((g) => g.group));
            }
        }
        // v0.1.292 — las N series principales; el resto, "Otros".
        let subCol = kSub;
        let subRank: Map<string | null, number> | null = null;
        let subOthers = 0;
        if (subTop) {
            const limit = Math.max(1, Math.min(MAX_GROUPS, Math.floor(subTop.limit)));
            const order = subTop.byValue ? sql`val desc nulls last, sub asc nulls last` : sql`sub asc nulls last`;
            const ranked = await tx.execute(
                sql`select sub, cnt from (select sub, row_number() over (order by ${order}) as rn, count(*) over () as cnt from (select (${subExpr})::text as sub, ${aggExpr} as val from ${records} where ${where} group by 1) g) r where rn <= ${limit} order by rn`,
            );
            const kept = (ranked.rows as Array<{ sub: unknown; cnt: unknown }>).map((r) => keyOf(r.sub));
            subRank = new Map(kept.map((k, i) => [k, i]));
            const total = Number((ranked.rows as Array<{ cnt: unknown }>)[0]?.cnt ?? 0);
            if (total > limit) {
                subCol = othersCase(kSub, kept);
                subOthers = total - limit;
            }
        }
        const keyed = sql`(SELECT ${records}.*, (${groupExpr})::text AS grp, (${subExpr})::text AS sub FROM ${records} WHERE ${where} OFFSET 0) AS ${K}`;
        // Las claves FINALES (con "Otros") como columnas simples: así GROUPING()
        // las reconoce (con una expresión con parámetros no las matchea).
        const mid = sql`(SELECT ${K}.*, ${bucketCol} AS bkt, ${subCol} AS sbk FROM ${keyed}) AS ${R}`;
        const bkt = sql`${R}.${sql.identifier('bkt')}`;
        const sbk = sql`${R}.${sql.identifier('sbk')}`;
        const sets = withTotals ? sql`(${bkt}, ${sbk}), (${bkt}), (${sbk}), ()` : sql`(${bkt}, ${sbk}), (${bkt})`;
        const res = await tx.execute(sql`
            SELECT ${bkt} AS grp, ${sbk} AS sub, ${aggExpr} AS val, GROUPING(${bkt}) AS gg, GROUPING(${sbk}) AS gs
            FROM ${mid}
            GROUP BY GROUPING SETS (${sets})
            ORDER BY gg ASC, grp ASC NULLS LAST, gs DESC, sub ASC NULLS LAST`);
        const rows = res.rows as Array<{ grp: unknown; sub: unknown; val: unknown; gg: unknown; gs: unknown }>;
        const byGroup = new Map<string | null, { value: number | string | null; subs: Array<{ group: string | null; value: number | string | null }> }>();
        const order: Array<string | null> = [];
        const subTotals: Array<{ group: string | null; value: number | string | null; others?: number }> = [];
        let grand: number | string | null = null;
        let pairs = 0;
        let hidden = 0;
        for (const r of rows) {
            if (Number(r.gg) === 1) {
                // Totales del segundo nivel (sólo con `withTotals`).
                if (Number(r.gs) === 1) grand = normalize(r.val);
                else {
                    const k = keyOf(r.sub);
                    subTotals.push({ group: k, value: normalize(r.val), ...(k === AGGREGATE_OTHERS_KEY && subOthers > 0 ? { others: subOthers } : {}) });
                }
                continue;
            }
            const g = keyOf(r.grp);
            let entry = byGroup.get(g);
            if (!entry) {
                entry = { value: null, subs: [] };
                byGroup.set(g, entry);
                order.push(g);
            }
            if (Number(r.gs) === 1) {
                entry.value = normalize(r.val);
            } else if (pairs < MAX_SUB_GROUP_PAIRS) {
                entry.subs.push({ group: keyOf(r.sub), value: normalize(r.val) });
                pairs++;
            } else {
                hidden++;
            }
        }
        let groups: NonNullable<AggregateResult['groups']>;
        if (topList) {
            // El orden y los valores del grupo, los de `topGroups` (por valor o por clave).
            groups = topList.map((g) => ({ ...g, sub_groups: byGroup.get(g.group)?.subs ?? [] }));
        } else {
            groups = order.map((g) => ({ group: g, value: byGroup.get(g)!.value, sub_groups: byGroup.get(g)!.subs }));
        }
        if (subRank !== null) {
            // Los subtotales en el orden del tope (mayor primero, o por clave); "Otros" al final.
            const rank = (k: string | null): number => (k === AGGREGATE_OTHERS_KEY ? Number.MAX_SAFE_INTEGER : (subRank!.get(k) ?? Number.MAX_SAFE_INTEGER - 1));
            subTotals.sort((a, b) => rank(a.group) - rank(b.group));
        }
        return {
            metric,
            value: withTotals ? grand : null,
            groups,
            ...(withTotals ? { sub_totals: subTotals } : {}),
            ...(subOthers > 0 ? { sub_others: subOthers } : {}),
            ...(hidden > 0 ? { hidden_sub_groups: hidden } : {}),
        };
    }

    /**
     * v0.1.286 — Agrupado con TOPE: los `limit` primeros grupos (por valor
     * descendente o por clave) y el resto resumido en UN grupo "Otros"
     * (`AGGREGATE_OTHERS_KEY`). Antes un gráfico agrupado por un campo casi
     * único devolvía 100k grupos (7,5 MB). El valor de "Otros" se recalcula
     * sobre los REGISTROS de esos grupos (no sumando los parciales): así vale
     * también para promedio, mínimo/máximo y valores únicos.
     */
    private async topGroups(
        tx: Tx,
        baseWhere: SQL | undefined,
        groupExpr: SQL,
        aggExpr: SQL,
        top: AggregateTop,
    ): Promise<NonNullable<AggregateResult['groups']>> {
        const limit = Math.max(1, Math.min(MAX_GROUPS, Math.floor(top.limit)));
        const order = top.byValue ? sql`val desc nulls last, grp asc nulls last` : sql`grp asc nulls last`;
        const where = baseWhere ?? sql`true`;
        const grouped = sql`select ${groupExpr} as grp, ${aggExpr} as val from ${records} where ${where} group by 1`;
        const res = await tx.execute(
            sql`select grp, val, cnt from (select grp, val, row_number() over (order by ${order}) as rn, count(*) over () as cnt from (${grouped}) g) r where rn <= ${limit} order by rn`,
        );
        const rows = res.rows as Array<{ grp: unknown; val: unknown; cnt: unknown }>;
        const groups: NonNullable<AggregateResult['groups']> = rows.map((r) => ({
            group: r.grp === null || r.grp === undefined ? null : String(r.grp),
            value: normalize(r.val),
        }));
        const total = Number(rows[0]?.cnt ?? 0);
        if (total > limit) {
            const others = await tx.execute(
                sql`with g as (${grouped}), r as (select grp, row_number() over (order by ${order}) as rn from g)
                    select ${aggExpr} as val from ${records} where ${where} and (
                        (${groupExpr}) in (select grp from r where rn > ${limit} and grp is not null)
                        or ((${groupExpr}) is null and exists (select 1 from r where rn > ${limit} and grp is null))
                    )`,
            );
            const val = (others.rows as Array<{ val: unknown }>)[0]?.val;
            groups.push({ group: AGGREGATE_OTHERS_KEY, value: normalize(val), others: total - limit });
        }
        return groups;
    }

    /**
     * v0.1.297 — Totales del KANBAN (B5) en UNA consulta: por cada columna, carril y
     * celda (carril × columna) cuántas tarjetas hay y la suma (o el promedio)
     * de un campo numérico, más el total general. Mismo ACL, filtro, búsqueda
     * y regla de primer nivel que la vista agrupada: lo que se cuenta es
     * exactamente lo que el tablero puede mostrar, no lo que ya se cargó.
     *
     * `GROUPING SETS` sobre una subconsulta que arma las claves UNA vez por
     * fila (la de un multi_select o un derivado es cara); la de afuera se
     * llama "records", así la métrica —que apunta a `"records"."data"`— vale
     * sin tocarla. Un campo de valor que la persona no ve (oculto por su rol)
     * o que ya no es numérico se ignora en vez de romper el tablero.
     */
    async boardStats(
        tenantId: number,
        listIdOrSlug: string,
        opts: {
            groupFieldId: number;
            laneFieldId?: number;
            valueFieldId?: number;
            valueMetric?: 'sum' | 'avg';
            filter_tree?: AggregateRequest['filter_tree'];
            search?: string;
            viewer?: AggregateViewer;
        },
    ): Promise<BoardStats> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.listContext(tenantId, listIdOrSlug, opts.viewer, tx);
            const { byId, fieldsById, clock } = ctx;
            const groupField = byId.get(opts.groupFieldId);
            if (!groupField) throw badRequest('group_by no pertenece a la lista');
            // Un carril por un campo que esta persona no ve (oculto por su rol)
            // se ignora: el tablero sigue funcionando, sin carriles — agrupar
            // por él mostraría los valores ocultos (SEC-25).
            const laneField =
                opts.laneFieldId !== undefined && opts.laneFieldId !== groupField.id ? byId.get(opts.laneFieldId) : undefined;

            const metric = opts.valueMetric === 'avg' ? 'avg' : 'sum';
            let valueField = opts.valueFieldId !== undefined ? byId.get(opts.valueFieldId) : undefined;
            if (valueField) {
                try {
                    this.assertMetricCompat(metric, valueField, fieldsById);
                } catch {
                    valueField = undefined;
                }
            }

            const groupExpr = groupingExpr(groupField, undefined, fieldsById, clock.timeZone);
            const laneExpr = laneField ? groupingExpr(laneField, undefined, fieldsById, clock.timeZone) : undefined;
            if (groupKeyHasSubquery(groupField.type) || (laneField && groupKeyHasSubquery(laneField.type))) await disableJitForTx(tx);

            const where = and(
                eq(records.tenantId, tenantId),
                eq(records.listId, ctx.list.id),
                isNull(records.deletedAt),
                // Las tarjetas son las filas de primer nivel (como los grupos de la tabla).
                isNull(records.parentId),
                ctx.scope,
                compileFilterTree(fieldsById, opts.filter_tree, clock),
                compileSearch(ctx.fields.filter((f) => !ctx.hidden.has(f.id)), opts.search),
            ) ?? sql`true`;
            const valueExpr = valueField ? this.metricExpr(metric, valueField, fieldsById) : sql`NULL`;
            const R = sql.identifier('records');
            const bkt = sql`${R}.${sql.identifier('bkt')}`;
            const sbk = sql`${R}.${sql.identifier('sbk')}`;
            const keyed = laneExpr
                ? sql`(SELECT ${records}.*, (${groupExpr})::text AS bkt, (${laneExpr})::text AS sbk FROM ${records} WHERE ${where} OFFSET 0) AS ${R}`
                : sql`(SELECT ${records}.*, (${groupExpr})::text AS bkt FROM ${records} WHERE ${where} OFFSET 0) AS ${R}`;
            const res = laneExpr
                ? await tx.execute(sql`
                    SELECT ${bkt} AS grp, ${sbk} AS sub, count(*) AS cnt, ${valueExpr} AS val,
                           GROUPING(${bkt}) AS gg, GROUPING(${sbk}) AS gs
                    FROM ${keyed}
                    GROUP BY GROUPING SETS ((${bkt}, ${sbk}), (${bkt}), (${sbk}), ())`)
                : await tx.execute(sql`
                    SELECT ${bkt} AS grp, NULL AS sub, count(*) AS cnt, ${valueExpr} AS val,
                           GROUPING(${bkt}) AS gg, 1 AS gs
                    FROM ${keyed}
                    GROUP BY GROUPING SETS ((${bkt}), ())`);

            const out: BoardStats = {
                total: { count: 0, value: null },
                columns: [],
                lanes: laneField ? [] : undefined,
                cells: laneField ? [] : undefined,
                valueFieldId: valueField?.id ?? null,
                valueMetric: metric,
                laneFieldId: laneField?.id ?? null,
            };
            for (const r of res.rows as Array<{ grp: unknown; sub: unknown; cnt: unknown; val: unknown; gg: unknown; gs: unknown }>) {
                const count = Number(r.cnt ?? 0);
                const value = valueField ? toNumberOrNull(r.val) : null;
                const gg = Number(r.gg) === 1;
                const gs = Number(r.gs) === 1;
                if (gg && gs) out.total = { count, value };
                else if (!gg && gs) out.columns.push({ value: keyOf(r.grp), count, total: value });
                else if (gg && !gs) out.lanes!.push({ value: keyOf(r.sub), count, total: value });
                else out.cells!.push({ column: keyOf(r.grp), lane: keyOf(r.sub), count, total: value });
            }
            return out;
        });
    }

    /**
     * v0.1.97 — Delta vs período anterior (widget `stat_delta`). Evalúa la
     * MISMA métrica sobre dos ventanas consecutivas de N días ancladas a hoy
     * (en el reloj de la empresa):
     *
     *   actual   = [hoy-(N-1) .. hoy]
     *   anterior = [hoy-(2N-1) .. hoy-N]
     *
     * Cada ventana se compone como condiciones gte/lte sobre el campo de
     * fecha, en AND con el filter_tree del widget. `delta_pct` es null si el
     * período anterior es 0 o la métrica no es numérica (min/max de fecha).
     *
     * v0.1.286 — con `window` ({from, to} en YYYY-MM-DD: el período del widget
     * o el global del tablero) la ventana ACTUAL es ese rango y la anterior es
     * otra del mismo largo justo antes. Antes el período se sumaba en AND al
     * filtro y además se aplicaban las ventanas de N días: "este mes" contra
     * "los últimos 30 días" daba cualquier cosa.
     */
    async runDelta(
        tenantId: number,
        listIdOrSlug: string,
        req: AggregateRequest,
        opts: DeltaOptions & { viewer?: AggregateViewer },
    ): Promise<DeltaResult> {
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const ctx = await this.listContext(tenantId, listIdOrSlug, opts.viewer, tx);
            return this.runDeltaIn(tx, tenantId, ctx, req, opts);
        });
    }

    async runDeltaIn(
        tx: Tx,
        tenantId: number,
        ctx: AggregateListContext,
        req: AggregateRequest,
        opts: DeltaOptions,
    ): Promise<DeltaResult> {
        const dateField = ctx.byId.get(opts.dateFieldId);
        // v0.1.300 — también una fecha de sistema (creación / última modificación).
        const isSystemDate = dateField !== undefined && isSystemField(dateField.type) && systemFieldBaseType(dateField.type) === 'datetime';
        if (!dateField || (dateField.type !== 'date' && dateField.type !== 'datetime' && !isSystemDate)) {
            throw badRequest('date_field_id debe ser un campo date/datetime de la lista');
        }
        // v0.1.263 — las ventanas se cuentan en días del reloj de la empresa.
        const { timeZone } = ctx.clock;
        const today = zonedToday(timeZone, ctx.clock.now);
        let current: { from: string; to: string };
        if (opts.window) {
            current = opts.window.from <= opts.window.to ? opts.window : { from: opts.window.to, to: opts.window.from };
        } else {
            const days = Math.max(1, Math.min(365, Math.floor(opts.periodDays ?? 30) || 30));
            current = { from: addDaysYmd(today, -(days - 1)), to: today };
        }
        const length = daysBetween(current.from, current.to) + 1;
        const previous = { from: addDaysYmd(current.from, -length), to: addDaysYmd(current.from, -1) };

        const boundary = (ymd: string, edge: 'start' | 'end'): string => {
            if (dateField.type === 'date') return ymd;
            return edge === 'start'
                ? zonedInstant(ymd, timeZone).toISOString()
                : new Date(zonedInstant(addDaysYmd(ymd, 1), timeZone).getTime() - 1000).toISOString();
        };
        const windowTree = (w: { from: string; to: string }): AggregateRequest['filter_tree'] => {
            const children: FilterNode[] = [];
            if (req.filter_tree) children.push(req.filter_tree);
            children.push({ type: 'condition', field_id: dateField.id, op: 'gte', value: boundary(w.from, 'start') });
            children.push({ type: 'condition', field_id: dateField.id, op: 'lte', value: boundary(w.to, 'end') });
            return { type: 'group', logic: 'and', children };
        };

        const run = (w: { from: string; to: string }) =>
            this.runIn(tx, tenantId, ctx, { ...req, group_by_field_id: undefined, filter_tree: windowTree(w) }, {
                rootsOnly: opts.rootsOnly,
                related: opts.related,
            });
        // Secuenciales: comparten la conexión de la transacción.
        const cur = await run(current);
        const prev = await run(previous);

        const value = cur.value ?? 0;
        const prevValue = prev.value ?? 0;
        let deltaPct: number | null = null;
        if (typeof value === 'number' && typeof prevValue === 'number' && prevValue !== 0) {
            deltaPct = Math.round(((value - prevValue) / Math.abs(prevValue)) * 1000) / 10;
        }
        return { value, previous: prevValue, delta_pct: deltaPct, period_days: length };
    }

    /**
     * Footer de tabla: para VARIOS campos, calcula el bag de métricas aplicable
     * a cada tipo en UNA sola query (sin N+1). Devuelve `{ totals: {slug: bag},
     * groups }` — el shape que consume la UI del fork (`GET .../records/aggregates`).
     */
    async footer(
        tenantId: number,
        listIdOrSlug: string,
        opts: {
            fieldIds: number[];
            filter_tree?: AggregateRequest['filter_tree'];
            group_by_field_id?: number;
            viewer?: AggregateViewer;
            /** v0.1.286 — la búsqueda de la tabla: el pie suma lo que se ve. */
            search?: string;
            /**
             * v0.1.286 — sólo el desglose por grupo (la vista agrupada), y sólo
             * de estos grupos (`null` = «sin valor»): sumar 100k filas para
             * mostrar 40 grupos costaba 400 ms.
             */
            groupsOnly?: boolean;
            groupKeys?: Array<string | null>;
            /**
             * v0.1.287 — el pie por SUBGRUPO de la vista agrupada en dos
             * niveles: el desglose es por (grupo, subgrupo) y cada entrada
             * trae `sub_value`.
             */
            sub_group_by_field_id?: number;
        },
    ): Promise<FooterAggregates> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const acl = await this.aclWithThrough(tenantId, list.id, list.settings, fields, opts.viewer);
        const byId = new Map(fields.filter((f) => !acl.hidden.has(f.id)).map((f) => [f.id, f]));
        const targets = opts.fieldIds.map((id) => byId.get(id)).filter((f): f is Field => Boolean(f));

        const footerClock = await this.clock(tenantId);
        const fieldsById = withComputedExprs(acl.strip(await this.filterableFields(tenantId, list.id, fields)), fields, footerClock.timeZone, footerClock.now);
        const filterWhere = compileFilterTree(fieldsById, opts.filter_tree, footerClock);
        const baseWhere = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, list.id),
            isNull(records.deletedAt),
            acl.scope,
            // v0.1.213 — el pie suma lo que la tabla MUESTRA: las filas de
            // primer nivel. Sumar también las subtareas contaba dos veces el
            // total de un pedido (el pedido + sus líneas).
            isNull(records.parentId),
            filterWhere,
            compileSearch(fields.filter((f) => !acl.hidden.has(f.id)), opts.search),
            opts.groupsOnly ? groupKeysWhere(byId.get(opts.group_by_field_id ?? 0), fieldsById, opts.groupKeys) : undefined,
        );

        // v0.1.252 — un campo DERIVADO (rollup, lookup, computed) es una
        // subconsulta correlacionada; el pie pide 5-6 métricas sobre él y cada
        // una la repetía por fila (medido: 1,16 s con 20k registros). Ahora se
        // calcula UNA vez por fila en una subconsulta que se llama "records"
        // —así las expresiones de los campos comunes (`"records"."data"`) siguen
        // valiendo sin tocarlas— y las métricas leen esa columna.
        const derived = targets.filter((f) => fieldsById.get(f.id)?.expr !== undefined);
        const metricFields = new Map(fieldsById);
        const derivedCols: SQL[] = [];
        for (const f of derived) {
            const ff = fieldsById.get(f.id)!;
            const alias = `dv_${f.id}`;
            derivedCols.push(sql`${ff.expr} as ${sql.identifier(alias)}`);
            metricFields.set(f.id, { ...ff, expr: sql`${sql.identifier('records')}.${sql.identifier(alias)}` });
        }

        const cols: Record<string, SQL> = {};
        const plan: Array<{ slug: string; metric: AggregateMetric; key: string }> = [];
        for (const f of targets) {
            for (const metric of metricsFor(f.type, fieldsById.get(f.id))) {
                const key = `a${f.id}_${metric}`;
                cols[key] = this.metricExpr(metric, f, metricFields);
                plan.push({ slug: f.slug, metric, key });
            }
        }
        if (plan.length === 0) return { totals: {}, groups: [] };

        const source =
            derivedCols.length > 0
                ? // v0.1.300 — también las columnas de la fila que leen las columnas de
                  // sistema (agrupar el pie por «Creado por» las referencia afuera).
                  sql`(select ${records.id}, ${records.data}, ${records.createdAt}, ${records.updatedAt}, ${records.createdBy}, ${records.updatedBy}, ${sql.join(derivedCols, sql`, `)} from ${records} where ${baseWhere}) as ${sql.identifier('records')}`
                : sql`${records} where ${baseWhere}`;
        const selectList = (extra?: SQL): SQL =>
            sql.join(
                [
                    ...(extra ? [sql`${extra} as ${sql.identifier('grp')}`] : []),
                    ...Object.entries(cols).map(([k, v]) => sql`${v} as ${sql.identifier(k)}`),
                ],
                sql`, `,
            );

        const totalsRes = opts.groupsOnly
            ? undefined
            : await this.tenantDb.withTenant(tenantId, (tx) => tx.execute(sql`select ${selectList()} from ${source}`));
        const row = (totalsRes?.rows as Record<string, unknown>[] | undefined)?.[0];
        const bagFrom = (r: Record<string, unknown> | undefined): Record<string, AggregateBag> => {
            const out: Record<string, AggregateBag> = {};
            for (const p of plan) {
                (out[p.slug] ??= {})[p.metric] = normalize(r?.[p.key]);
            }
            return out;
        };
        const totals = bagFrom(row);

        let groups: FooterAggregates['groups'] = [];
        if (opts.group_by_field_id !== undefined) {
            const gf = byId.get(opts.group_by_field_id);
            if (gf) {
                // v0.1.286 — la MISMA clave que los buckets (combinación de un
                // multi_select, derivados por su expresión): antes un pie por
                // grupo de multi_select nunca encontraba su grupo.
                const groupExpr = groupKeyExpr(gf, fieldsById);
                const sf = opts.sub_group_by_field_id !== undefined ? byId.get(opts.sub_group_by_field_id) : undefined;
                const subExpr = sf ? groupKeyExpr(sf, fieldsById) : undefined;
                const res = await this.tenantDb.withTenant(tenantId, async (tx) => {
                    if (groupKeyHasSubquery(gf.type) || (sf && groupKeyHasSubquery(sf.type))) await disableJitForTx(tx);
                    return subExpr
                        ? tx.execute(sql`select ${selectList(groupExpr)}, ${subExpr} as ${sql.identifier('sub')} from ${source} group by 1, ${sql.raw(String(Object.keys(cols).length + 2))} order by 1`)
                        : tx.execute(sql`select ${selectList(groupExpr)} from ${source} group by 1 order by 1`);
                });
                groups = (res.rows as Record<string, unknown>[]).map((rec) => {
                    const grp = rec.grp;
                    return {
                        value: grp === null || grp === undefined ? null : String(grp),
                        ...(subExpr ? { sub_value: rec.sub === null || rec.sub === undefined ? null : String(rec.sub) } : {}),
                        aggregates: bagFrom(rec),
                    };
                });
            }
        }
        return { totals, groups };
    }

    /**
     * v0.1.170 — mapa de campos filtrables con las subconsultas de los
     * rollups (así un widget/footer filtra por "deuda > 0" y el pie suma la
     * columna rollup). Sin campos through no abre transacción.
     */
    private async filterableFields(
        tenantId: number,
        listId: number,
        fields: Field[],
    ): Promise<Map<number, FilterableField>> {
        const plans = await this.fields.throughPlansFor(tenantId, listId, fields);
        return new Map<number, FilterableField>([
            ...fields.map((f): [number, FilterableField] => [f.id, { id: f.id, type: f.type }]),
            ...this.fields.through.filterableFor(plans, tenantId),
            // v0.1.188 — buckets y pie de la vista agrupada buscan también
            // en la descripción del registro.
            descriptionSearchFilterable(),
        ]);
    }

    /** Expresión SQL de la métrica (opcionalmente sobre un campo tipado). */
    private metricExpr(
        metric: AggregateMetric,
        field: Field | undefined,
        fieldsById: Map<number, FilterableField>,
    ): SQL {
        const ff = field ? fieldsById.get(field.id) : undefined;
        // Un rollup no tiene texto JSONB: su "texto" es la propia subconsulta.
        const text = field ? (ff?.expr ?? fieldTextExpr(field.id)) : undefined;
        const typed = field ? fieldTypedExpr(ff ?? { id: field.id, type: field.type }) : undefined;
        switch (metric) {
            case 'count':
                return sql`count(*)`;
            case 'count_unique':
                return sql`count(distinct ${text})`;
            case 'count_empty':
                return sql`count(*) filter (where ${text} is null)`;
            case 'sum':
                return sql`coalesce(sum(${typed}), 0)`;
            case 'avg':
                return sql`avg(${typed})`;
            case 'min':
                return sql`min(${typed})`;
            case 'max':
                return sql`max(${typed})`;
            case 'count_true':
                return sql`count(*) filter (where ${text} = 'true')`;
            case 'count_false':
                // checkbox ausente = false → cuenta todo lo que no es 'true'.
                return sql`count(*) filter (where ${text} is distinct from 'true')`;
        }
    }

    private assertMetricCompat(
        metric: AggregateMetric,
        field: Field | undefined,
        fieldsById: Map<number, FilterableField>,
    ): void {
        // Un rollup resuelto cuenta como numérico (o texto de fecha en min/max).
        const ff = field ? fieldsById.get(field.id) : undefined;
        const numeric = field ? NUMERIC_TYPES.includes(field.type) || (ff?.expr !== undefined && ff.valueKind !== 'text') : false;
        const minmax = field ? MINMAX_TYPES.includes(field.type) || ff?.expr !== undefined : false;
        if ((metric === 'sum' || metric === 'avg') && !numeric) {
            throw badRequest(`${metric} sólo aplica a campos numéricos`);
        }
        if ((metric === 'min' || metric === 'max') && !minmax) {
            throw badRequest(`${metric} sólo aplica a campos numéricos o de fecha`);
        }
        if ((metric === 'count_true' || metric === 'count_false') && field!.type !== 'checkbox' && ff?.formulaKind !== 'boolean') {
            throw badRequest(`${metric} sólo aplica a checkbox`);
        }
    }
}

/** v0.1.286 — Tope de grupos que puede pedir cualquiera (endpoint incluido). */
export const MAX_GROUPS = 1000;

/** v0.1.287 — Tope de pares (grupo, subgrupo) de un agrupado en dos niveles. */
export const MAX_SUB_GROUP_PAIRS = 2000;

/** Clave de grupo tal como viaja (null = sin valor). */
function keyOf(v: unknown): string | null {
    return v === null || v === undefined ? null : String(v);
}

/** `col` si es una de las claves que se conservan; si no, "Otros". */
function othersCase(col: SQL, kept: Array<string | null>): SQL {
    const values = kept.filter((g): g is string => g !== null);
    const parts: SQL[] = [];
    if (values.length > 0) parts.push(sql`${col} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`);
    if (kept.includes(null)) parts.push(sql`${col} IS NULL`);
    const inTop = parts.length > 0 ? sql.join(parts, sql` OR `) : sql`false`;
    return sql`(CASE WHEN ${inTop} THEN ${col} ELSE ${AGGREGATE_OTHERS_KEY} END)`;
}

/** v0.1.286 — Agrupado con tope + "Otros". */
export interface AggregateTop {
    limit: number;
    /** true: los grupos de mayor valor primero; false: por clave (fechas, alfabético). */
    byValue: boolean;
}

export interface AggregateRunOptions {
    rootsOnly?: boolean;
    related?: RelatedScope;
    /** v0.1.286 — la búsqueda de la tabla (misma regla que el listado). */
    search?: string;
    /** v0.1.286 — con tope de grupos y "Otros" (gráficos y endpoint). */
    top?: AggregateTop;
    /** v0.1.292 — tope del SEGUNDO nivel (series / columnas) con "Otros". */
    subTop?: AggregateTop;
    /**
     * v0.1.292 — con segundo nivel: el total de cada subgrupo sobre todos los
     * registros (`sub_totals`) y el total general (`value`).
     */
    withTotals?: boolean;
}

export interface DeltaOptions {
    dateFieldId: number;
    /** Ventana de N días anclada a hoy (sin `window`). */
    periodDays?: number;
    /** v0.1.286 — ventana ACTUAL explícita (YYYY-MM-DD, inclusive). */
    window?: { from: string; to: string };
    rootsOnly?: boolean;
    related?: RelatedScope;
}

export interface DeltaResult {
    value: number | string | null;
    previous: number | string | null;
    delta_pct: number | null;
    period_days: number;
}

/** v0.1.297 — totales del kanban (ver `boardStats`). `value` es null sin campo de valor. */
export interface BoardStats {
    total: { count: number; value: number | null };
    columns: Array<{ value: string | null; count: number; total: number | null }>;
    /** Sólo con carriles. */
    lanes?: Array<{ value: string | null; count: number; total: number | null }>;
    /** Sólo con carriles: cada celda (carril × columna) con tarjetas. */
    cells?: Array<{ column: string | null; lane: string | null; count: number; total: number | null }>;
    /** El campo que se sumó de verdad (null si no había o no se podía). */
    valueFieldId: number | null;
    valueMetric: 'sum' | 'avg';
    /** El campo de los carriles que se usó (null: sin carriles o ignorado). */
    laneFieldId: number | null;
}

function toNumberOrNull(val: unknown): number | null {
    const n = normalize(val);
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** v0.1.286 — lo resuelto de una lista para agregar sobre ella (ver `listContext`). */
export interface AggregateListContext {
    list: { id: number; settings: Record<string, unknown> };
    fields: Field[];
    /** Campos VISIBLES para quien pregunta. */
    byId: Map<number, Field>;
    /** Whitelist filtrable (sin ocultos) con las expresiones de rollup/computed. */
    fieldsById: Map<number, FilterableField>;
    hidden: Set<number>;
    scope: SQL | undefined;
    clock: QueryClock;
}

/** Días entre dos fechas YYYY-MM-DD (b - a). */
function daysBetween(a: string, b: string): number {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Bag de métricas de un campo (las claves presentes dependen del tipo). */
export type AggregateBag = Partial<Record<AggregateMetric, number | string | null>>;

export interface FooterAggregates {
    totals: Record<string, AggregateBag>;
    /** `sub_value` sólo con `sub_group_by_field_id` (pie por subgrupo, v0.1.287). */
    groups: Array<{ value: string | null; sub_value?: string | null; aggregates: Record<string, AggregateBag> }>;
}

/**
 * Clave de grupo de un multi_select: el JSON del conjunto ORDENADO
 * (`["a", "b"]`) o NULL si no hay opciones. Es la misma forma con la que la
 * vista agrupada pide las filas del grupo (`eq` con array = igualdad de
 * conjunto) y que los dashboards parsean para etiquetas y click-through.
 */
function multiSelectSetExpr(fieldId: number): SQL {
    const col = sql`(${records.data} -> ${jsonbKeyForField(fieldId)})`;
    // Atajo para lo habitual (1-2 opciones de texto): la subconsulta con
    // `jsonb_agg` se paga por FILA y era lo más caro de agrupar por un
    // multi_select. Da EXACTAMENTE la misma clave que el camino general: la
    // salida de texto de un array jsonb de strings es la misma que la de
    // `jsonb_agg(text)`, y `<=` sobre `->>` usa la misma collation que el
    // `ORDER BY e` (los repetidos se conservan, como en `jsonb_agg`). Un array
    // con elementos que no son texto va por el camino general, que los pasa a
    // texto. `IS DISTINCT FROM` deja un NULL (clave ausente) en NULL sin
    // llamar a `jsonb_array_length`, que falla con lo que no es un array.
    return sql`(CASE
        WHEN jsonb_typeof(${col}) IS DISTINCT FROM 'array' THEN NULL
        WHEN jsonb_array_length(${col}) = 0 THEN NULL
        WHEN jsonb_array_length(${col}) = 1 AND jsonb_typeof(${col} -> 0) = 'string' THEN ${col}::text
        WHEN jsonb_array_length(${col}) = 2 AND jsonb_typeof(${col} -> 0) = 'string' AND jsonb_typeof(${col} -> 1) = 'string'
            THEN CASE WHEN (${col} ->> 0) <= (${col} ->> 1) THEN ${col}::text ELSE jsonb_build_array(${col} -> 1, ${col} -> 0)::text END
        ELSE (SELECT jsonb_agg(e ORDER BY e)::text FROM jsonb_array_elements_text(${col}) AS e)
    END)`;
}

/**
 * v0.1.286 — clave de grupo de una fila al agrupar por un campo (sin buckets
 * temporales): la que usan los buckets de `run`, el pie por grupo y las filas
 * de cada grupo de la vista agrupada — tiene que ser la misma en los tres.
 */
export function groupKeyExpr(field: Field, fieldsById: Map<number, FilterableField>): SQL {
    // Campo «Botón»: no tiene valor que agrupar.
    if (field.type === 'button') throw badRequest(`No se puede agrupar por «${field.label}»: es un botón.`);
    if (field.type === 'multi_select') return multiSelectSetExpr(field.id);
    // v0.1.300 — columnas de sistema: una fecha por DÍA (reloj de la empresa), una
    // persona por su id (ver `systemFilterable`).
    if (isSystemField(field.type)) {
        const ff = fieldsById.get(field.id);
        if (ff?.groupExpr) return ff.groupExpr;
        if (ff?.expr) return sql`(${ff.expr})::text`;
        throw badRequest(`No se puede agrupar por «${field.label}».`);
    }
    if (isThroughField(field.type) || field.type === 'computed' || field.type === 'time_tracked') return throughGroupExpr(field, fieldsById);
    // C5 — «Aprobación»: por el estado de la última solicitud (NULL = sin pedir).
    if (field.type === 'approval') {
        const ff = fieldsById.get(field.id);
        if (ff?.groupExpr) return ff.groupExpr;
        throw badRequest(`No se puede agrupar por «${field.label}».`);
    }
    // Fórmulas (A1): por su valor (una fecha por día, en el reloj de la empresa).
    if (field.type === 'formula') {
        const ff = fieldsById.get(field.id);
        if (ff?.groupExpr) return ff.groupExpr;
        throw badRequest(
            `No se puede agrupar por la fórmula «${field.label}»${ff?.formulaReason ? `: ${ff.formulaReason}` : ''}.`,
        );
    }
    return fieldTextExpr(field.id);
}

/**
 * Clave de agrupado de un campo para el motor de agregados (`run`), con sus
 * reglas: relación y archivo no forman grupos (se dice, en vez de devolver
 * un único grupo con todo); una fecha con `bucket` agrupa por día/semana/mes/
 * trimestre/año en el reloj de la empresa; un multi_select por COMBINACIÓN
 * normalizada; un derivado (lookup / rollup / computed) por su expresión.
 * La comparten el primer y el segundo nivel de agrupado.
 */
function groupingExpr(
    field: Field,
    bucket: TimeBucket | undefined,
    fieldsById: Map<number, FilterableField>,
    timeZone: string,
): SQL {
    // v0.1.252 — una relación no vive en `data`: agrupar por ella daba UN
    // solo grupo con todo.
    if (field.type === 'relation' || field.type === 'file') {
        throw badRequest(`No se puede agrupar por «${field.label}»: los campos de tipo ${field.type === 'relation' ? 'relación' : 'archivo'} no forman grupos.`);
    }
    // v0.1.97 — bucketing temporal (labels ordenables cronológicamente como string).
    if (bucket !== undefined && (field.type === 'date' || field.type === 'datetime')) {
        return timeBucketExpr(field, bucket, timeZone);
    }
    // Fórmulas (A1) con resultado de fecha: por día/semana/mes… como un campo fecha.
    if (bucket !== undefined && field.type === 'formula') {
        const ff = fieldsById.get(field.id);
        if (ff?.expr && (ff.formulaKind === 'date' || ff.formulaKind === 'datetime')) {
            return timeBucketExpr({ ...field, type: ff.formulaKind }, bucket, timeZone, ff.expr);
        }
    }
    // v0.1.300 — las fechas de sistema también se agrupan por día/semana/mes…
    if (bucket !== undefined && isSystemField(field.type) && systemFieldBaseType(field.type) === 'datetime') {
        const ff = fieldsById.get(field.id);
        if (ff?.expr) return timeBucketExpr({ ...field, type: 'datetime' }, bucket, timeZone, ff.expr);
    }
    // v0.1.190 — multi_select por combinación; v0.1.200 — derivados por su expresión.
    return groupKeyExpr(field, fieldsById);
}

/** Filas de ciertos grupos (`groupKeys`) del campo agrupado; sin claves, todas. */
function groupKeysWhere(
    field: Field | undefined,
    fieldsById: Map<number, FilterableField>,
    keys: Array<string | null> | undefined,
): SQL | undefined {
    if (!field || !keys) return undefined;
    const expr = groupKeyExpr(field, fieldsById);
    const values = keys.filter((k): k is string => k !== null);
    const parts: SQL[] = [];
    if (values.length > 0) parts.push(sql`(${expr}) IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`);
    if (keys.includes(null)) parts.push(sql`(${expr}) IS NULL`);
    return parts.length > 0 ? sql`(${sql.join(parts, sql` OR `)})` : sql`false`;
}

/** Métricas base aplicables a cada tipo de campo (la UI deriva pct/range). */
function metricsFor(type: FieldType, ff?: FilterableField): AggregateMetric[] {
    if (type === 'rollup') {
        // v0.1.170 — sólo si el motor resolvió la subconsulta; un rollup de
        // fecha (min/max) es texto ISO: no se suma ni promedia.
        if (!ff?.expr) return [];
        return ff.valueKind === 'text'
            ? ['count', 'count_empty', 'min', 'max']
            : ['count', 'count_empty', 'sum', 'avg', 'min', 'max'];
    }
    if (type === 'lookup' || type === 'button') return [];
    // Fórmulas (A1): según el tipo de su resultado, si compila a SQL.
    if (type === 'formula') {
        if (!ff?.expr) return [];
        switch (ff.formulaKind) {
            case 'number':
                return ['count', 'count_empty', 'count_unique', 'sum', 'avg', 'min', 'max'];
            case 'date':
            case 'datetime':
                return ['count', 'count_empty', 'min', 'max'];
            case 'boolean':
                return ['count', 'count_true', 'count_false'];
            default:
                return ['count', 'count_empty', 'count_unique'];
        }
    }
    // v0.1.300 — columnas de sistema: fechas (mínimo/máximo) o personas (únicos).
    if (isSystemField(type)) {
        if (!ff?.expr) return [];
        return systemFieldBaseType(type) === 'datetime' ? ['count', 'count_empty', 'min', 'max'] : ['count', 'count_empty', 'count_unique'];
    }
    // v0.1.291 — el tiempo registrado (minutos) se suma y promedia como número.
    if (type === 'time_tracked') return ff?.expr ? ['count', 'sum', 'avg', 'min', 'max'] : [];
    // v0.1.252 — una relación vive en otra tabla: «vacíos» y «únicos» se
    // calculaban sobre `data` (siempre vacío) y mentían. Sólo el conteo.
    if (type === 'relation' || type === 'file') return ['count'];
    // v0.1.229 — un computed numérico con expresión SQL se suma como número.
    if (type === 'computed') {
        return ff?.expr ? ['count', 'count_empty', 'sum', 'avg', 'min', 'max'] : ['count', 'count_empty', 'count_unique'];
    }
    if (NUMERIC_TYPES.includes(type)) {
        return ['count', 'count_empty', 'count_unique', 'sum', 'avg', 'min', 'max'];
    }
    if (type === 'date' || type === 'datetime') return ['count', 'count_empty', 'min', 'max'];
    if (type === 'checkbox') return ['count', 'count_true', 'count_false'];
    return ['count', 'count_empty', 'count_unique'];
}

/**
 * Expresión de bucket temporal para agrupar por un campo date/datetime
 * (v0.1.97). Los formatos elegidos ordenan cronológicamente como string
 * (así el ORDER BY del group sigue siendo correcto) y son los labels que
 * muestra el chart: 2026-07-21 / 2026-W30 / 2026-07 / 2026-Q3 / 2026.
 */
function timeBucketExpr(field: Field, bucket: TimeBucket, timeZone: string, expr?: SQL): SQL {
    // v0.1.263 — un datetime cae en el día/mes del reloj de la EMPRESA (una
    // venta a las 9 pm del 31 en Colombia es de ese mes, no del siguiente).
    const raw = expr ?? fieldTypedExpr({ id: field.id, type: field.type });
    const typed = field.type === 'datetime' ? sql`(${raw} AT TIME ZONE ${timeZone})` : raw;
    switch (bucket) {
        case 'day':
            return sql`to_char(date_trunc('day', ${typed}), 'YYYY-MM-DD')`;
        case 'week':
            return sql`to_char(date_trunc('week', ${typed}), 'IYYY-"W"IW')`;
        case 'month':
            return sql`to_char(date_trunc('month', ${typed}), 'YYYY-MM')`;
        case 'quarter':
            return sql`to_char(date_trunc('quarter', ${typed}), 'YYYY-"Q"Q')`;
        case 'year':
            return sql`to_char(date_trunc('year', ${typed}), 'YYYY')`;
    }
}

/** Postgres devuelve numéricos como string; los convertimos a number. */
function normalize(val: unknown): number | string | null {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const n = Number(val);
        return Number.isFinite(n) && val.trim() !== '' ? n : val;
    }
    if (typeof val === 'bigint') return Number(val);
    if (val instanceof Date) return val.toISOString();
    return String(val);
}

/**
 * Expresión de agrupación de un campo derivado (lookup / rollup, v0.1.200).
 * Se agrupa por su valor como TEXTO: la clave de un bucket viaja como string
 * y el filtro por bucket la vuelve a castear según el tipo.
 */
function throughGroupExpr(field: Field, byId: Map<number, FilterableField>): SQL {
    const expr = byId.get(field.id)?.expr;
    if (!expr) {
        throw badRequest(
            field.type === 'computed'
                ? `El campo calculado «${field.label}» no se puede agrupar: sólo los cálculos numéricos (suma, resta, producto, división) tienen valor agrupable.`
                : `El campo «${field.label}» no está configurado del todo (falta la relación o el campo destino): no se puede agrupar por él.`,
        );
    }
    return sql`(${expr})::text`;
}

function badRequest(message: string): BadRequestException {
    return new BadRequestException({
        code: 'invalid_aggregate',
        message,
        data: { status: 400 },
    });
}

/**
 * SEC-25 (v0.1.226) — ACL por lista aplicado a un agregado. Antes el motor no
 * miraba al que preguntaba: un agente con "sólo lo suyo" (o sin acceso a la
 * lista) agrupaba por un campo oculto y los NOMBRES de los grupos eran los
 * valores ocultos de todos los registros; una suma daba el total de toda la
 * lista. Ahora:
 *  - `scope`: la misma condición de lectura que el listado (`scopeWhere`);
 *  - `hidden`: los campos ocultos para ese rol NO existen para el agregado —
 *    ni como métrica, ni como agrupación, ni como filtro (un filtro sobre un
 *    campo oculto sería un oráculo: "¿cuántos cobran más de X?").
 */
export function aclFor(
    settings: Record<string, unknown>,
    fields: Field[],
    viewer: AggregateViewer | undefined,
): { scope: SQL | undefined; hidden: Set<number>; strip: <T>(m: Map<number, T>) => Map<number, T> } {
    if (!viewer) return { scope: undefined, hidden: new Set(), strip: (m) => m };
    const perms = effectivePermissions(settings, viewer.role, viewer.userId);
    const assignmentId = resolvePermissions(settings).assignment_field_id;
    const scope = scopeWhere(perms.view, viewer.userId, assignmentId ? jsonbKeyForField(assignmentId) : null);
    const hiddenSlugs = new Set(perms.fields_hidden);
    const hidden = withDependentComputed(fields, new Set(fields.filter((f) => hiddenSlugs.has(f.slug)).map((f) => f.id)));
    return {
        scope,
        hidden,
        strip: <T>(m: Map<number, T>) => new Map([...m].filter(([id]) => !hidden.has(id))),
    };
}
