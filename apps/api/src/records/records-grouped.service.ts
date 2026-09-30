import { BadRequestException, Injectable } from '@nestjs/common';
import type { FilterGroup, FilterNode } from '@imagina-base/shared';
import { AggregateService } from '../aggregate/aggregate.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { DESCRIPTION_SEARCH_FIELD_ID } from './query-builder';
import { RecordsService, type Actor } from './records.service';

const NULL_KEY = '__null__';
/** Tope de grupos que se abren solos (el resto se pide al abrirlo). */
const MAX_AUTO_EXPANDED = 40;
/**
 * Grupos que se arman en paralelo por request. Cada uno usa una conexión del
 * pool (10) mientras corre: 3 deja lugar a las demás requests.
 */
const GROUP_CONCURRENCY = 3;

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
        actor: Actor,
        listKey: string,
        groupBy: number,
        filterTree?: FilterGroup,
        search?: string,
    ): Promise<{ data: GroupBucket[]; meta: GroupsMeta }> {
        const meta = await this.groupMeta(tenantId, listKey, groupBy);
        const effectiveTree = await this.withSearch(tenantId, listKey, filterTree, search);
        const buckets = await this.buckets(tenantId, listKey, groupBy, effectiveTree, actor);
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
            /**
             * v0.1.224 — abrir TODOS los grupos que devuelva esta consulta salvo
             * los `collapsed`. Antes el front pedía primero los grupos y después,
             * con otra request, las filas de los abiertos: al buscar, los grupos
             * nuevos aparecían vacíos entre las dos vueltas.
             */
            expandAll?: boolean;
            collapsed?: string[];
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
        const buckets = await this.buckets(tenantId, listKey, opts.groupBy, effectiveTree, actor);
        const totalRecords = buckets.reduce((s, b) => s + b.count, 0);

        const fields = await this.fields.list(tenantId, listKey);
        const toSlug = new Map(fields.map((f) => [`f${f.id}`, f.slug]));

        // Sólo grupos que EXISTEN en esta consulta: con una búsqueda, los que
        // estaban abiertos antes y ya no tienen filas costaban dos consultas
        // cada uno para devolver nada.
        const present = new Set(buckets.map((b) => b.value ?? NULL_KEY));
        const collapsed = new Set(opts.collapsed ?? []);
        const keys = opts.expandAll
            ? buckets.map((b) => b.value ?? NULL_KEY).filter((k) => !collapsed.has(k)).slice(0, MAX_AUTO_EXPANDED)
            : [...new Set(opts.expanded)].filter((k) => present.has(k));

        const expanded: Record<string, unknown> = {};
        // Los grupos se arman de a GROUP_CONCURRENCY en paralelo (antes, uno
        // tras otro: con 14 grupos abiertos eran 28 viajes a la base en fila).
        await mapLimit(keys, GROUP_CONCURRENCY, async (key) => {
            const isNull = key === NULL_KEY;
            // v0.1.190 — multi_select agrupa por COMBINACIÓN (como ClickUp):
            // la clave es el JSON del set y las filas del grupo son las que
            // tienen EXACTAMENTE ese conjunto (`eq` con array). Antes `eq`
            // con la cadena JSON no matcheaba nada y el grupo salía vacío.
            const cond: FilterNode = isNull
                ? { type: 'condition', field_id: opts.groupBy, op: 'is_null' }
                : {
                      type: 'condition',
                      field_id: opts.groupBy,
                      op: 'eq',
                      value: meta.group_by_type === 'multi_select' ? (parseSetKey(key) ?? key) : key,
                  };
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
                // v0.1.137 — el bundle armaba su propio DTO recortado y se
                // comía `relations` (siempre vacío), `parent_id`,
                // `subtask_count` y `has_description`: por eso la vista
                // AGRUPADA no mostraba subtareas ni el icono de descripción,
                // y los campos relation salían en blanco. Sale lo mismo que
                // en el listado plano.
                relations: mapKeys(
                    (r.relations ?? {}) as Record<string, unknown>,
                    toSlug,
                ),
                parent_id: r.parent_id ?? null,
                subtask_count: r.subtask_count ?? 0,
                has_description: r.has_description ?? false,
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
                    viewer: actor,
                });
            }
            expanded[key] = entry;
        });

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
            f.type === 'text' || f.type === 'long_text' || f.type === 'email' || f.type === 'url'
            || f.type === 'phone',
        );
        const or: FilterGroup = {
            type: 'group',
            logic: 'or',
            children: [
                ...searchable.map((f): FilterNode => ({
                    type: 'condition',
                    field_id: f.id,
                    op: 'contains',
                    value: needle,
                })),
                // v0.1.188 — la descripción del registro también se busca
                // (pseudo-campo que sólo el servidor puede componer).
                { type: 'condition', field_id: DESCRIPTION_SEARCH_FIELD_ID, op: 'contains', value: needle },
            ],
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
        filterTree: FilterGroup | undefined,
        actor: Actor,
    ): Promise<GroupBucket[]> {
        // SEC-25: los buckets cuentan lo que ESTA persona puede ver (su scope)
        // y no se puede agrupar por un campo oculto para su rol — los nombres
        // de los grupos serían los valores ocultos.
        // multi_select: un bucket por COMBINACIÓN exacta (clave = JSON del
        // set normalizado, la arma el motor) — cada registro cae en UN grupo,
        // como en ClickUp, así los grupos son disjuntos y la suma es el total.
        // Sólo filas de primer nivel: son las que el grupo muestra (v0.1.213).
        const agg = await this.aggregate.run(
            tenantId,
            listKey,
            { metric: 'count', group_by_field_id: groupBy, filter_tree: filterTree },
            { rootsOnly: true, viewer: actor },
        );
        return (agg.groups ?? []).map((g) => ({ value: g.group, count: Number(g.value ?? 0) }));
    }
}

/** Clave de un grupo multi_select (`["a", "b"]`) → array; otra cosa → null. */
function parseSetKey(key: string): string[] | null {
    if (!key.startsWith('[')) return null;
    try {
        const parsed: unknown = JSON.parse(key);
        return Array.isArray(parsed) ? parsed.map((v) => String(v)) : null;
    } catch {
        return null;
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

/** `items.map(fn)` con a lo sumo `limit` promesas en vuelo. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const item = items[next++] as T;
            await fn(item);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
