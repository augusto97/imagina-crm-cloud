import { BadRequestException, Injectable } from '@nestjs/common';
import {
    type AggregateMetric,
    type AggregateRequest,
    type AggregateResult,
    type Field,
    type FieldType,
} from '@imagina-base/shared';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import {
    compileFilterTree,
    fieldTextExpr,
    fieldTypedExpr,
    type FilterableField,
} from '../records/query-builder';
import { TenantDb } from '../tenancy/tenant-db.service';

const NUMERIC_TYPES: readonly FieldType[] = ['number', 'currency'];
const MINMAX_TYPES: readonly FieldType[] = ['number', 'currency', 'date', 'datetime'];

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
    ) {}

    async run(
        tenantId: number,
        listIdOrSlug: string,
        req: AggregateRequest,
    ): Promise<AggregateResult> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const byId = new Map(fields.map((f) => [f.id, f]));

        const field = req.field_id !== undefined ? byId.get(req.field_id) : undefined;
        if (req.field_id !== undefined && !field) {
            throw badRequest('field_id no pertenece a la lista');
        }
        this.assertMetricCompat(req.metric, field);

        const fieldsById = new Map<number, FilterableField>(
            fields.map((f) => [f.id, { id: f.id, type: f.type }]),
        );
        const filterWhere = compileFilterTree(fieldsById, req.filter_tree, new Date());
        const baseWhere = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, list.id),
            isNull(records.deletedAt),
            filterWhere,
        );

        const aggExpr = this.metricExpr(req.metric, field);

        if (req.group_by_field_id !== undefined) {
            const groupField = byId.get(req.group_by_field_id);
            if (!groupField) throw badRequest('group_by_field_id no pertenece a la lista');
            const groupExpr = fieldTextExpr(groupField.id);
            const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                tx
                    .select({ grp: groupExpr, val: aggExpr })
                    .from(records)
                    .where(baseWhere)
                    .groupBy(groupExpr)
                    .orderBy(groupExpr),
            );
            const groups = rows.map((r) => ({
                group: r.grp === null || r.grp === undefined ? null : String(r.grp),
                value: normalize(r.val),
            }));
            // El total global es la suma de los grupos para métricas aditivas;
            // para el resto devolvemos null (el desglose es lo relevante).
            return { metric: req.metric, value: null, groups };
        }

        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select({ val: aggExpr }).from(records).where(baseWhere),
        );
        return { metric: req.metric, value: normalize(row?.val) };
    }

    /**
     * Footer de tabla: para VARIOS campos, calcula el bag de métricas aplicable
     * a cada tipo en UNA sola query (sin N+1). Devuelve `{ totals: {slug: bag},
     * groups }` — el shape que consume la UI del fork (`GET .../records/aggregates`).
     */
    async footer(
        tenantId: number,
        listIdOrSlug: string,
        opts: { fieldIds: number[]; filter_tree?: AggregateRequest['filter_tree']; group_by_field_id?: number },
    ): Promise<FooterAggregates> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const fields = await this.fields.list(tenantId, String(list.id));
        const byId = new Map(fields.map((f) => [f.id, f]));
        const targets = opts.fieldIds.map((id) => byId.get(id)).filter((f): f is Field => Boolean(f));

        const fieldsById = new Map<number, FilterableField>(
            fields.map((f) => [f.id, { id: f.id, type: f.type }]),
        );
        const filterWhere = compileFilterTree(fieldsById, opts.filter_tree, new Date());
        const baseWhere = and(
            eq(records.tenantId, tenantId),
            eq(records.listId, list.id),
            isNull(records.deletedAt),
            filterWhere,
        );

        const cols: Record<string, SQL> = {};
        const plan: Array<{ slug: string; metric: AggregateMetric; key: string }> = [];
        for (const f of targets) {
            for (const metric of metricsFor(f.type)) {
                const key = `a${f.id}_${metric}`;
                cols[key] = this.metricExpr(metric, f);
                plan.push({ slug: f.slug, metric, key });
            }
        }
        if (plan.length === 0) return { totals: {}, groups: [] };

        const [row] = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx.select(cols).from(records).where(baseWhere),
        );
        const bagFrom = (r: Record<string, unknown> | undefined): Record<string, AggregateBag> => {
            const out: Record<string, AggregateBag> = {};
            for (const p of plan) {
                (out[p.slug] ??= {})[p.metric] = normalize(r?.[p.key]);
            }
            return out;
        };
        const totals = bagFrom(row as Record<string, unknown> | undefined);

        let groups: FooterAggregates['groups'] = [];
        if (opts.group_by_field_id !== undefined) {
            const gf = byId.get(opts.group_by_field_id);
            if (gf) {
                const groupExpr = fieldTextExpr(gf.id);
                const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
                    tx
                        .select({ grp: groupExpr, ...cols })
                        .from(records)
                        .where(baseWhere)
                        .groupBy(groupExpr)
                        .orderBy(groupExpr),
                );
                groups = rows.map((r) => {
                    const rec = r as Record<string, unknown>;
                    const grp = rec.grp;
                    return {
                        value: grp === null || grp === undefined ? null : String(grp),
                        aggregates: bagFrom(rec),
                    };
                });
            }
        }
        return { totals, groups };
    }

    /** Expresión SQL de la métrica (opcionalmente sobre un campo tipado). */
    private metricExpr(metric: AggregateMetric, field?: Field): SQL {
        const text = field ? fieldTextExpr(field.id) : undefined;
        const typed = field ? fieldTypedExpr({ id: field.id, type: field.type }) : undefined;
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

    private assertMetricCompat(metric: AggregateMetric, field?: Field): void {
        if ((metric === 'sum' || metric === 'avg') && !NUMERIC_TYPES.includes(field!.type)) {
            throw badRequest(`${metric} sólo aplica a number/currency`);
        }
        if ((metric === 'min' || metric === 'max') && !MINMAX_TYPES.includes(field!.type)) {
            throw badRequest(`${metric} sólo aplica a number/currency/date/datetime`);
        }
        if ((metric === 'count_true' || metric === 'count_false') && field!.type !== 'checkbox') {
            throw badRequest(`${metric} sólo aplica a checkbox`);
        }
    }
}

/** Bag de métricas de un campo (las claves presentes dependen del tipo). */
export type AggregateBag = Partial<Record<AggregateMetric, number | string | null>>;

export interface FooterAggregates {
    totals: Record<string, AggregateBag>;
    groups: Array<{ value: string | null; aggregates: Record<string, AggregateBag> }>;
}

/** Métricas base aplicables a cada tipo de campo (la UI deriva pct/range). */
function metricsFor(type: FieldType): AggregateMetric[] {
    if (type === 'number' || type === 'currency') {
        return ['count', 'count_empty', 'count_unique', 'sum', 'avg', 'min', 'max'];
    }
    if (type === 'date' || type === 'datetime') return ['count', 'count_empty', 'min', 'max'];
    if (type === 'checkbox') return ['count', 'count_true', 'count_false'];
    return ['count', 'count_empty', 'count_unique'];
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

function badRequest(message: string): BadRequestException {
    return new BadRequestException({
        code: 'invalid_aggregate',
        message,
        data: { status: 400 },
    });
}
