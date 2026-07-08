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
