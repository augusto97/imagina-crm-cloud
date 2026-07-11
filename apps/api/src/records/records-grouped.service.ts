import { BadRequestException, Injectable } from '@nestjs/common';
import type { FilterGroup, FilterNode } from '@imagina-base/shared';
import { AggregateService } from '../aggregate/aggregate.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, type Actor } from './records.service';

const NULL_KEY = '__null__';

interface GroupBucket {
    value: string | null;
    count: number;
}
interface GroupsMeta {
    group_by_field_id: number;
    group_by_slug: string;
    group_by_type: string;
    total_groups: number;
    total_records: number;
}

/**
 * Vista "agrupar por" (CONTRACT.md §7). Compone el motor de agregados (buckets +
 * footer por grupo) con el listado de records (filas de cada grupo expandido),
 * en el shape que consume `GroupedTableView` del fork. Devuelve los records ya
 * mapeados a `fields` por slug (el adaptador no alcanza los anidados).
 */
@Injectable()
export class RecordsGroupedService {
    constructor(
        private readonly records: RecordsService,
        private readonly aggregate: AggregateService,
        private readonly lists: ListsService,
        private readonly fields: FieldsService,
    ) {}

    /** Solo los buckets (valor + conteo) + meta del grupo. */
    async groups(
        tenantId: number,
        listKey: string,
        groupBy: number,
        filterTree?: FilterGroup,
        search?: string,
    ): Promise<{ data: GroupBucket[]; meta: GroupsMeta }> {
        const meta = await this.groupMeta(tenantId, listKey, groupBy);
        const effectiveTree = await this.withSearch(tenantId, listKey, filterTree, search);
        const buckets = await this.buckets(tenantId, listKey, groupBy, effectiveTree);
        return {
            data: buckets,
            meta: { ...meta, total_groups: buckets.length, total_records: buckets.reduce((s, b) => s + b.count, 0) },
        };
    }

    /** Buckets + records/agregados de los grupos expandidos (bundle). */
    async groupedBundle(
        tenantId: number,
        actor: Actor,
        listKey: string,
        opts: {
            groupBy: number;
            expanded: string[];
            filterTree?: FilterGroup;
            search?: string;
            perPage: number;
            aggregateFieldIds: number[];
        },
    ): Promise<unknown> {
        const meta = await this.groupMeta(tenantId, listKey, opts.groupBy);
        // La búsqueda se COMPONE como subtree OR de `contains` sobre los
        // campos searchables → aplica igual a buckets, filas y agregados.
        const effectiveTree = await this.withSearch(tenantId, listKey, opts.filterTree, opts.search);
        const buckets = await this.buckets(tenantId, listKey, opts.groupBy, effectiveTree);
        const totalRecords = buckets.reduce((s, b) => s + b.count, 0);

        const fields = await this.fields.list(tenantId, listKey);
        const toSlug = new Map(fields.map((f) => [`f${f.id}`, f.slug]));

        const expanded: Record<string, unknown> = {};
        for (const key of opts.expanded) {
            const isNull = key === NULL_KEY;
            const cond: FilterNode = isNull
                ? { type: 'condition', field_id: opts.groupBy, op: 'is_null' }
                : { type: 'condition', field_id: opts.groupBy, op: 'eq', value: key };
            const combined: FilterGroup = {
                type: 'group',
                logic: 'and',
                children: [...(effectiveTree ? [effectiveTree] : []), cond],
            };

            const page = await this.records.list(tenantId, actor, listKey, {
                limit: opts.perPage,
                sort_dir: 'asc',
                filter_tree: combined,
            } as never);
            const rows = page.data.map((r) => ({
                id: r.id,
                fields: mapKeys(r.data as Record<string, unknown>, toSlug),
                relations: {},
                created_by: r.created_by,
                created_at: stripZ(r.created_at),
                updated_at: stripZ(r.updated_at),
            }));
            const bucketCount = buckets.find((b) => (b.value ?? NULL_KEY) === key)?.count ?? rows.length;

            const entry: { records: unknown; aggregates?: unknown } = {
                records: {
                    data: rows,
                    meta: {
                        page: 1,
                        per_page: opts.perPage,
                        total: bucketCount,
                        total_pages: Math.max(1, Math.ceil(bucketCount / opts.perPage)),
                    },
                },
            };
            if (opts.aggregateFieldIds.length > 0) {
                entry.aggregates = await this.aggregate.footer(tenantId, listKey, {
                    fieldIds: opts.aggregateFieldIds,
                    filter_tree: combined,
                });
            }
            expanded[key] = entry;
        }

        return { buckets, meta: { ...meta, total_groups: buckets.length, total_records: totalRecords }, expanded };
    }

    /**
     * Compone la búsqueda como subtree `OR contains` sobre los campos
     * searchables (text/long_text/email/url) y lo ANDea al tree existente.
     * Sin campos searchables la búsqueda se ignora (los buckets no cambian).
     */
    private async withSearch(
        tenantId: number,
        listKey: string,
        filterTree: FilterGroup | undefined,
        search: string | undefined,
    ): Promise<FilterGroup | undefined> {
        const needle = (search ?? '').trim();
        if (needle === '') return filterTree;
        const fields = await this.fields.list(tenantId, listKey);
        const searchable = fields.filter((f) =>
            f.type === 'text' || f.type === 'long_text' || f.type === 'email' || f.type === 'url',
        );
        if (searchable.length === 0) return filterTree;
        const or: FilterGroup = {
            type: 'group',
            logic: 'or',
            children: searchable.map((f) => ({
                type: 'condition',
                field_id: f.id,
                op: 'contains',
                value: needle,
            })),
        };
        return {
            type: 'group',
            logic: 'and',
            children: [...(filterTree ? [filterTree] : []), or],
        };
    }

    private async groupMeta(tenantId: number, listKey: string, groupBy: number): Promise<GroupsMeta> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.list(tenantId, String(list.id));
        const gf = fields.find((f) => f.id === groupBy);
        if (!gf) {
            throw new BadRequestException({ code: 'invalid_group_by', message: 'group_by no pertenece a la lista', data: { status: 400 } });
        }
        return { group_by_field_id: gf.id, group_by_slug: gf.slug, group_by_type: gf.type, total_groups: 0, total_records: 0 };
    }

    private async buckets(
        tenantId: number,
        listKey: string,
        groupBy: number,
        filterTree?: FilterGroup,
    ): Promise<GroupBucket[]> {
        const agg = await this.aggregate.run(tenantId, listKey, {
            metric: 'count',
            group_by_field_id: groupBy,
            filter_tree: filterTree,
        });
        return (agg.groups ?? []).map((g) => ({ value: g.group, count: Number(g.value ?? 0) }));
    }
}

function mapKeys(data: Record<string, unknown>, toSlug: Map<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) out[toSlug.get(k) ?? k] = v;
    return out;
}

function stripZ(value: string): string {
    return value.replace(/Z$/, '');
}
