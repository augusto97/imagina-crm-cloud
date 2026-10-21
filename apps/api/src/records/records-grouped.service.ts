import { BadRequestException, Injectable } from '@nestjs/common';
import type { Field, FilterGroup, RecordDto } from '@imagina-base/shared';
import { AggregateService, groupKeyExpr } from '../aggregate/aggregate.service';
import { FieldsService } from '../fields/fields.service';
import { ListsService } from '../lists/lists.service';
import { RecordsService, subGroupPairKey, type Actor } from './records.service';

const NULL_KEY = '__null__';
/** Tope de grupos que se abren solos (el resto se pide al abrirlo). */
const MAX_AUTO_EXPANDED = 40;
/** Grupos que viajan como máximo (el resto se informa en `hidden_groups`). */
const MAX_BUCKETS = 300;

export interface GroupBucket {
    value: string | null;
    count: number;
    /** v0.1.287 — con segundo nivel: los subgrupos del grupo, en el orden del campo. */
    sub_buckets?: GroupBucket[];
}
interface GroupsMeta {
    group_by_field_id: number;
    group_by_slug: string;
    group_by_type: string;
    total_groups: number;
    total_records: number;
    /** v0.1.252 — grupos que existen pero NO viajan (tope MAX_BUCKETS). */
    hidden_groups?: number;
    /** v0.1.287 — segundo nivel de agrupado (si se pidió). */
    sub_group_by_field_id?: number;
    sub_group_by_slug?: string;
    sub_group_by_type?: string;
    /** v0.1.287 — pares (grupo, subgrupo) que existen pero no viajan (tope del motor). */
    hidden_sub_groups?: number;
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
        const { meta, groupField } = await this.groupMeta(tenantId, listKey, groupBy);
        const all = await this.buckets(tenantId, listKey, groupField, filterTree, search, actor);
        const buckets = all.slice(0, MAX_BUCKETS);
        return {
            data: buckets,
            meta: {
                ...meta,
                total_groups: all.length,
                total_records: all.reduce((s, b) => s + b.count, 0),
                hidden_groups: all.length - buckets.length,
            },
        };
    }

    /**
     * Buckets + records/agregados de los grupos expandidos (bundle).
     *
     * v0.1.286 — tres consultas en total, no dos por grupo: los buckets (un
     * GROUP BY), las filas de TODOS los grupos abiertos (una ventana
     * `row_number()` particionada por la clave del grupo, ver
     * `RecordsService.listGroupRows`) y los pies de todos los grupos (otro
     * GROUP BY). Agrupar por fecha sobre 100k registros bajó de ~950
     * sentencias y 1,3 s a una fracción. La respuesta conserva el shape.
     */
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
            /** v0.1.286 — orden de las filas DENTRO de cada grupo (`field_{id}:{dir},…`). */
            sort?: string;
            perPage: number;
            aggregateFieldIds: number[];
            /**
             * v0.1.287 — SEGUNDO nivel («y luego por…»): subgrupos dentro de
             * cada grupo, en la MISMA request. `collapsedSub` son los pares
             * (grupo, subgrupo) cerrados, con las claves crudas (`__null__`).
             */
            subGroupBy?: number;
            collapsedSub?: Array<[string, string]>;
        },
    ): Promise<unknown> {
        if (opts.subGroupBy !== undefined) return this.subGroupedBundle(tenantId, actor, listKey, { ...opts, subGroupBy: opts.subGroupBy });
        const { meta, groupField, fields } = await this.groupMeta(tenantId, listKey, opts.groupBy);
        // v0.1.252 — tope de grupos: agrupar por un campo casi único (email,
        // monto) devolvía un grupo por registro — 20k grupos, ~1 MB por
        // request y una pantalla inservible. Se muestran los primeros (en el
        // orden del catálogo, ver `orderBuckets`) y se avisa cuántos quedan
        // afuera; los totales siguen siendo de todos.
        const allBuckets = await this.buckets(tenantId, listKey, groupField, opts.filterTree, opts.search, actor);
        const buckets = allBuckets.slice(0, MAX_BUCKETS);
        const totalRecords = allBuckets.reduce((s, b) => s + b.count, 0);
        const toSlug = new Map(fields.map((f) => [`f${f.id}`, f.slug]));

        // Sólo grupos que EXISTEN en esta consulta: con una búsqueda, los que
        // estaban abiertos antes y ya no tienen filas no cuestan nada.
        const present = new Set(buckets.map((b) => b.value ?? NULL_KEY));
        const collapsed = new Set(opts.collapsed ?? []);
        const keys = opts.expandAll
            ? buckets.map((b) => b.value ?? NULL_KEY).filter((k) => !collapsed.has(k)).slice(0, MAX_AUTO_EXPANDED)
            : [...new Set(opts.expanded)].filter((k) => present.has(k));

        const [rowsByGroup, footer] = await Promise.all([
            this.records.listGroupRows(tenantId, actor, listKey, {
                groupFieldId: opts.groupBy,
                groupKeyExpr,
                keys: keys.map((k) => (k === NULL_KEY ? null : k)),
                perGroup: opts.perPage,
                filter_tree: opts.filterTree,
                search: opts.search,
                sort: opts.sort,
            }),
            keys.length > 0 && opts.aggregateFieldIds.length > 0
                ? this.aggregate.footer(tenantId, listKey, {
                      fieldIds: opts.aggregateFieldIds,
                      filter_tree: opts.filterTree,
                      search: opts.search,
                      group_by_field_id: opts.groupBy,
                      viewer: actor,
                      groupsOnly: true,
                      // Con TODOS los grupos abiertos, el filtro por clave sobra
                      // (y en un multi_select la clave es cara de calcular).
                      groupKeys: keys.length < allBuckets.length ? keys.map((k) => (k === NULL_KEY ? null : k)) : undefined,
                  })
                : Promise.resolve(undefined),
        ]);
        const footerByKey = new Map((footer?.groups ?? []).map((g) => [g.value ?? NULL_KEY, g.aggregates]));
        const countByKey = new Map(buckets.map((b) => [b.value ?? NULL_KEY, b.count]));

        const expanded: Record<string, unknown> = {};
        for (const key of keys) {
            const rows = (rowsByGroup.get(key === NULL_KEY ? null : key) ?? []).map((r) => toBundleRow(r, toSlug));
            const bucketCount = countByKey.get(key) ?? rows.length;
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
            if (footer) entry.aggregates = { totals: footerByKey.get(key) ?? {}, groups: [] };
            expanded[key] = entry;
        }

        return {
            buckets,
            meta: {
                ...meta,
                total_groups: allBuckets.length,
                total_records: totalRecords,
                hidden_groups: allBuckets.length - buckets.length,
            },
            expanded,
        };
    }

    /**
     * v0.1.287 — Bundle de la vista agrupada en DOS niveles. Igual que el de
     * un nivel —tres consultas en total— pero las claves son PARES: los
     * buckets salen del agrupado en dos niveles del motor (cada grupo con sus
     * subgrupos y conteos), las filas de todos los subgrupos abiertos en UNA
     * consulta particionada por (grupo, subgrupo) y el pie de cada subgrupo en
     * otro GROUP BY. Las entradas de `expanded` van por la clave del par
     * (`subGroupPairKey`).
     */
    private async subGroupedBundle(
        tenantId: number,
        actor: Actor,
        listKey: string,
        opts: {
            groupBy: number;
            subGroupBy: number;
            expanded: string[];
            expandAll?: boolean;
            collapsed?: string[];
            collapsedSub?: Array<[string, string]>;
            filterTree?: FilterGroup;
            search?: string;
            sort?: string;
            perPage: number;
            aggregateFieldIds: number[];
        },
    ): Promise<unknown> {
        const { meta, groupField, fields } = await this.groupMeta(tenantId, listKey, opts.groupBy);
        const subField = fields.find((f) => f.id === opts.subGroupBy);
        if (!subField || subField.id === groupField.id) {
            throw new BadRequestException({
                code: 'invalid_sub_group_by',
                message: 'El segundo agrupado tiene que ser otro campo de la lista',
                data: { status: 400 },
            });
        }
        const agg = await this.aggregate.run(
            tenantId,
            listKey,
            { metric: 'count', group_by_field_id: groupField.id, sub_group_by_field_id: subField.id, filter_tree: opts.filterTree },
            { rootsOnly: true, viewer: actor, search: opts.search },
        );
        const allBuckets = orderBuckets(
            groupField,
            (agg.groups ?? []).map((g) => ({
                value: g.group,
                count: Number(g.value ?? 0),
                sub_buckets: orderBuckets(
                    subField,
                    (g.sub_groups ?? []).map((sg) => ({ value: sg.group, count: Number(sg.value ?? 0) })),
                ),
            })),
        );
        const buckets = allBuckets.slice(0, MAX_BUCKETS);
        const totalRecords = allBuckets.reduce((sum, b) => sum + b.count, 0);
        const toSlug = new Map(fields.map((f) => [`f${f.id}`, f.slug]));

        const collapsed = new Set(opts.collapsed ?? []);
        const collapsedSub = new Set((opts.collapsedSub ?? []).map(([g, sb]) => JSON.stringify([g, sb])));
        const wanted = new Set(opts.expanded);
        const pairs: Array<[string, string]> = [];
        outer: for (const b of buckets) {
            const g = b.value ?? NULL_KEY;
            if (opts.expandAll ? collapsed.has(g) : !wanted.has(g)) continue;
            for (const sb of b.sub_buckets ?? []) {
                const sk = sb.value ?? NULL_KEY;
                if (collapsedSub.has(JSON.stringify([g, sk]))) continue;
                pairs.push([g, sk]);
                if (pairs.length >= MAX_AUTO_EXPANDED) break outer;
            }
        }
        const raw = (k: string): string | null => (k === NULL_KEY ? null : k);
        const openGroups = [...new Set(pairs.map(([g]) => g))];

        const [rowsByPair, footer] = await Promise.all([
            this.records.listSubGroupRows(tenantId, actor, listKey, {
                groupFieldId: groupField.id,
                subGroupFieldId: subField.id,
                groupKeyExpr,
                pairs: pairs.map(([g, sb]) => [raw(g), raw(sb)]),
                perGroup: opts.perPage,
                filter_tree: opts.filterTree,
                search: opts.search,
                sort: opts.sort,
            }),
            pairs.length > 0 && opts.aggregateFieldIds.length > 0
                ? this.aggregate.footer(tenantId, listKey, {
                      fieldIds: opts.aggregateFieldIds,
                      filter_tree: opts.filterTree,
                      search: opts.search,
                      group_by_field_id: groupField.id,
                      sub_group_by_field_id: subField.id,
                      viewer: actor,
                      groupsOnly: true,
                      groupKeys: openGroups.length < allBuckets.length ? openGroups.map(raw) : undefined,
                  })
                : Promise.resolve(undefined),
        ]);
        const footerByPair = new Map(
            (footer?.groups ?? []).map((g) => [subGroupPairKey(g.value, g.sub_value ?? null), g.aggregates]),
        );
        const countByPair = new Map(
            buckets.flatMap((b) => (b.sub_buckets ?? []).map((sb) => [subGroupPairKey(b.value, sb.value), sb.count] as const)),
        );

        const expanded: Record<string, unknown> = {};
        for (const [g, sb] of pairs) {
            const key = subGroupPairKey(raw(g), raw(sb));
            const rows = (rowsByPair.get(key) ?? []).map((r) => toBundleRow(r, toSlug));
            const count = countByPair.get(key) ?? rows.length;
            const entry: { records: unknown; aggregates?: unknown } = {
                records: {
                    data: rows,
                    meta: { page: 1, per_page: opts.perPage, total: count, total_pages: Math.max(1, Math.ceil(count / opts.perPage)) },
                },
            };
            if (footer) entry.aggregates = { totals: footerByPair.get(key) ?? {}, groups: [] };
            expanded[key] = entry;
        }

        return {
            buckets,
            meta: {
                ...meta,
                total_groups: allBuckets.length,
                total_records: totalRecords,
                hidden_groups: allBuckets.length - buckets.length,
                sub_group_by_field_id: subField.id,
                sub_group_by_slug: subField.slug,
                sub_group_by_type: subField.type,
                ...(agg.hidden_sub_groups ? { hidden_sub_groups: agg.hidden_sub_groups } : {}),
            },
            expanded,
        };
    }

    private async groupMeta(
        tenantId: number,
        listKey: string,
        groupBy: number,
    ): Promise<{ meta: GroupsMeta; groupField: Field; fields: Field[] }> {
        const list = await this.lists.get(tenantId, listKey);
        const fields = await this.fields.list(tenantId, String(list.id));
        const gf = fields.find((f) => f.id === groupBy);
        if (!gf) {
            throw new BadRequestException({ code: 'invalid_group_by', message: 'group_by no pertenece a la lista', data: { status: 400 } });
        }
        return {
            meta: { group_by_field_id: gf.id, group_by_slug: gf.slug, group_by_type: gf.type, total_groups: 0, total_records: 0 },
            groupField: gf,
            fields,
        };
    }

    private async buckets(
        tenantId: number,
        listKey: string,
        groupField: Field,
        filterTree: FilterGroup | undefined,
        search: string | undefined,
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
            { metric: 'count', group_by_field_id: groupField.id, filter_tree: filterTree },
            { rootsOnly: true, viewer: actor, search },
        );
        return orderBuckets(
            groupField,
            (agg.groups ?? []).map((g) => ({ value: g.group, count: Number(g.value ?? 0) })),
        );
    }
}

/**
 * v0.1.286 — orden de los grupos ANTES de recortar al tope: el del catálogo de
 * opciones (select / multi_select, como las columnas del kanban), numérico en
 * los campos numéricos y alfabético —sin distinguir acentos— en el resto;
 * «(sin valor)» siempre al final. Antes salían por el valor INTERNO como texto
 * («hecho» antes que «pendiente», «10» antes que «9») y el tope de 300 cortaba
 * alfabéticamente.
 */
export function orderBuckets<T extends GroupBucket>(field: Pick<Field, 'type' | 'config'>, buckets: T[]): T[] {
    const options = Array.isArray((field.config as { options?: unknown }).options)
        ? ((field.config as { options: unknown[] }).options
              .map((o) => (o && typeof o === 'object' ? (o as { value?: unknown }).value : undefined))
              .filter((v): v is string => typeof v === 'string'))
        : [];
    const rank = new Map(options.map((v, i) => [v, i]));
    const UNKNOWN = Number.MAX_SAFE_INTEGER;
    const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
    const numeric = NUMERIC_GROUP_TYPES.has(field.type);
    const tuple = (value: string): number[] => {
        if (field.type === 'multi_select') return (parseSetKey(value) ?? [value]).map((v) => rank.get(v) ?? UNKNOWN).sort((a, b) => a - b);
        return [rank.get(value) ?? UNKNOWN];
    };
    const compare = (a: string, b: string): number => {
        if (field.type === 'select' || field.type === 'multi_select') {
            const ta = tuple(a);
            const tb = tuple(b);
            for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
                const x = ta[i] ?? -1;
                const y = tb[i] ?? -1;
                if (x !== y) return x - y;
            }
        }
        if (numeric) {
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        }
        return collator.compare(a, b);
    };
    return [...buckets].sort((a, b) => {
        if (a.value === null || b.value === null) return a.value === b.value ? 0 : a.value === null ? 1 : -1;
        return compare(a.value, b.value);
    });
}

const NUMERIC_GROUP_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'rating', 'percent', 'duration', 'rollup', 'time_tracked']);

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

/** Un registro del bundle con `fields` por slug (el adaptador del front no alcanza los anidados). */
function toBundleRow(r: RecordDto, toSlug: Map<string, string>): Record<string, unknown> {
    return {
        id: r.id,
        fields: mapKeys(r.data as Record<string, unknown>, toSlug),
        // v0.1.137 — sale lo mismo que en el listado plano: relaciones,
        // subtareas y el icono de descripción.
        relations: mapKeys((r.relations ?? {}) as Record<string, unknown>, toSlug),
        parent_id: r.parent_id ?? null,
        subtask_count: r.subtask_count ?? 0,
        has_description: r.has_description ?? false,
        created_by: r.created_by,
        created_at: stripZ(r.created_at),
        updated_at: stripZ(r.updated_at),
    };
}

function mapKeys(data: Record<string, unknown>, toSlug: Map<string, string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) out[toSlug.get(k) ?? k] = v;
    return out;
}

function stripZ(value: string): string {
    return value.replace(/Z$/, '');
}
