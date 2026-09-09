import {
    evaluateComputed,
    isThroughField,
    jsonbKeyForField,
    type Field,
    type FilterGroup,
    type RollupOperation,
    type ThroughInfo,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';
import { compileFilterTree, fieldTypedExpr, type FilterableField } from './query-builder';

/**
 * Campos "a través de una relación" — lookup / rollup (v0.1.170, ADR-S19).
 *
 * Un lookup muestra un campo de los registros VINCULADOS; un rollup los
 * cuenta o agrega. Ninguno se persiste: se resuelven en cada lectura
 * cruzando la tabla `relations`, y por eso viven acá y no en el evaluador
 * compartido (que sólo ve la fila propia).
 *
 * La relación puede ir en las dos direcciones:
 *  - `forward`: el campo relation vive en ESTA lista (Facturas.cliente →
 *    lookup "teléfono del cliente"). El ancla es `source_record_id`.
 *  - `reverse`: el campo relation vive en OTRA lista y apunta a esta
 *    (Clientes ← Facturas.cliente → rollup "deuda"). El ancla es
 *    `target_record_id`.
 *
 * Costo por página (regla de oro nº 8): UNA query por relación para los
 * lookups (con tope de LOOKUP_CAP vinculados por registro — una relación
 * inversa no tiene límite natural) y UNA query agregada por rollup. Nunca
 * se cargan en memoria los registros del otro lado para un rollup: el
 * filtro se compila con el MISMO QueryBuilder whitelisteado de la app
 * contra el alias `rr` (regla de oro nº 4).
 */
export interface ThroughPlan {
    /** El campo lookup/rollup de ESTA lista. */
    field: Field;
    relationField: Field;
    direction: 'forward' | 'reverse';
    otherListId: number;
    otherFields: Field[];
    /** Campo del otro lado (null sólo para `count`). */
    targetField: Field | null;
    operation: RollupOperation | null;
    filter: FilterGroup | undefined;
    /** Cómo se compara el resultado (min/max de fecha son texto ISO). */
    valueKind: 'numeric' | 'text';
}

/** Lo que el motor necesita de FieldsService (interfaz mínima, testeable). */
export interface ThroughFieldsSource {
    listByListIdWithinTx(tx: Tx, tenantId: number, listId: number): Promise<Field[]>;
    findAnyByIdWithinTx(tx: Tx, tenantId: number, fieldId: number): Promise<Field | null>;
}

/** Vinculados por registro que trae un lookup (el resto no se muestra). */
export const LOOKUP_CAP = 50;

/** Alias de los registros del OTRO lado dentro de las subconsultas. */
const RR_DATA = sql.raw('"rr"."data"');

type RowLike = { id: number; data: Record<string, unknown> };

export class ThroughEngine {
    constructor(private readonly fields: ThroughFieldsSource) {}

    static hasThrough(fields: Array<Pick<Field, 'type'>>): boolean {
        return fields.some((f) => isThroughField(f.type));
    }

    /**
     * Resuelve la config de cada lookup/rollup de la lista contra el estado
     * real: la relación tiene que existir, ser `relation` y tocar esta lista
     * por alguno de sus extremos; el campo destino tiene que ser de la lista
     * del otro lado. Lo que no resuelve se SALTA (el campo sale vacío) — una
     * relación borrada no puede tumbar el listado entero.
     */
    async plans(tx: Tx, tenantId: number, listId: number, fields: Field[]): Promise<ThroughPlan[]> {
        const through = fields.filter((f) => isThroughField(f.type));
        if (through.length === 0) return [];
        const relCache = new Map<number, Field | null>();
        const listFields = new Map<number, Field[]>([[listId, fields]]);
        const out: ThroughPlan[] = [];
        for (const field of through) {
            const cfg = field.config as {
                relation_field_id?: unknown;
                target_field_id?: unknown;
                operation?: unknown;
                filter_tree?: unknown;
            };
            const relId = asId(cfg.relation_field_id);
            if (relId === null) continue;
            let rel = relCache.get(relId);
            if (rel === undefined) {
                rel = await this.fields.findAnyByIdWithinTx(tx, tenantId, relId);
                relCache.set(relId, rel);
            }
            if (!rel || rel.type !== 'relation') continue;
            const targetListId = asId((rel.config as { target_list_id?: unknown }).target_list_id);
            let direction: ThroughPlan['direction'];
            let otherListId: number;
            if (rel.list_id === listId && targetListId !== null) {
                direction = 'forward';
                otherListId = targetListId;
            } else if (targetListId === listId) {
                direction = 'reverse';
                otherListId = rel.list_id;
            } else {
                continue;
            }
            let otherFields = listFields.get(otherListId);
            if (!otherFields) {
                otherFields = await this.fields.listByListIdWithinTx(tx, tenantId, otherListId);
                listFields.set(otherListId, otherFields);
            }
            const targetId = asId(cfg.target_field_id);
            const targetField = targetId === null ? null : (otherFields.find((o) => o.id === targetId) ?? null);
            // Un lookup/rollup del otro lado no se encadena (ver LOOKUP_TARGET_TYPES).
            if (targetField && isThroughField(targetField.type)) continue;
            const operation = field.type === 'rollup' && typeof cfg.operation === 'string'
                ? (cfg.operation as RollupOperation)
                : null;
            if (field.type === 'lookup' && !targetField) continue;
            if (field.type === 'rollup' && (!operation || (operation !== 'count' && !targetField))) continue;
            const isDateTarget = targetField?.type === 'date' || targetField?.type === 'datetime';
            out.push({
                field,
                relationField: rel,
                direction,
                otherListId,
                otherFields,
                targetField,
                operation,
                filter: field.type === 'rollup' && cfg.filter_tree && typeof cfg.filter_tree === 'object'
                    ? (cfg.filter_tree as FilterGroup)
                    : undefined,
                valueKind: isDateTarget && (operation === 'min' || operation === 'max') ? 'text' : 'numeric',
            });
        }
        return out;
    }

    /** Info derivada para el DTO de campos (lo que la UI necesita para formatear). */
    static info(plan: ThroughPlan, listNames: Map<number, string>): ThroughInfo {
        return {
            direction: plan.direction,
            relation_label: plan.relationField.label,
            other_list_id: plan.otherListId,
            other_list_name: listNames.get(plan.otherListId) ?? `#${plan.otherListId}`,
            target_field: plan.targetField
                ? {
                      id: plan.targetField.id,
                      label: plan.targetField.label,
                      type: plan.targetField.type,
                      config: plan.targetField.config,
                  }
                : null,
        };
    }

    /**
     * Entradas de `FilterableField` para los rollups: la subconsulta
     * correlacionada con la fila del listado (`records.id`), que sirve tanto
     * para WHERE como para ORDER BY y para las métricas del footer.
     */
    filterableFor(plans: ThroughPlan[], tenantId: number): Map<number, FilterableField> {
        const out = new Map<number, FilterableField>();
        for (const p of plans) {
            if (p.field.type !== 'rollup') continue;
            out.set(p.field.id, {
                id: p.field.id,
                type: 'rollup',
                expr: this.rollupSubquery(p, tenantId),
                valueKind: p.valueKind,
            });
        }
        return out;
    }

    /**
     * Inyecta en `data` de cada fila los valores de los lookups y rollups.
     * Los campos through SIN plan (config a medias o relación borrada) salen
     * con su valor vacío (`[]` / `null`), no ausentes: la UI no distingue
     * "no resolvió" de "no existe la clave".
     */
    async attach<T extends RowLike>(
        tx: Tx,
        tenantId: number,
        plans: ThroughPlan[],
        rows: T[],
        allFields: Field[] = [],
    ): Promise<T[]> {
        const planned = new Set(plans.map((p) => p.field.id));
        const unresolved = allFields.filter((f) => isThroughField(f.type) && !planned.has(f.id));
        if ((plans.length === 0 && unresolved.length === 0) || rows.length === 0) return rows;
        const ids = rows.map((r) => r.id);
        const values = new Map<number, Map<number, unknown>>();

        // Lookups: una query por relación (varios lookups sobre la misma
        // relación comparten las filas vinculadas).
        const groups = new Map<string, ThroughPlan[]>();
        for (const p of plans) {
            if (p.field.type !== 'lookup') continue;
            const key = `${p.relationField.id}:${p.direction}`;
            groups.set(key, [...(groups.get(key) ?? []), p]);
        }
        for (const group of groups.values()) {
            const linked = await this.linkedRows(tx, tenantId, group[0]!, ids);
            for (const p of group) {
                const m = new Map<number, unknown>();
                for (const [anchor, datas] of linked) {
                    m.set(
                        anchor,
                        datas
                            .map((d) => readTarget(p, d))
                            .filter((v) => v !== null && v !== undefined && v !== ''),
                    );
                }
                values.set(p.field.id, m);
            }
        }
        for (const p of plans) {
            if (p.field.type === 'rollup') values.set(p.field.id, await this.rollupBatch(tx, tenantId, p, ids));
        }

        return rows.map((r) => {
            const data = { ...r.data };
            for (const p of plans) {
                const v = values.get(p.field.id)?.get(r.id);
                data[jsonbKeyForField(p.field.id)] = v === undefined ? emptyValue(p) : v;
            }
            for (const f of unresolved) {
                data[jsonbKeyForField(f.id)] = f.type === 'lookup' ? [] : null;
            }
            return { ...r, data };
        });
    }

    // ── SQL ───────────────────────────────────────────────────────────────

    private async linkedRows(
        tx: Tx,
        tenantId: number,
        p: ThroughPlan,
        ids: number[],
    ): Promise<Map<number, Array<Record<string, unknown>>>> {
        const { anchor, other } = cols(p);
        const res = await tx.execute(sql`
            SELECT x.anchor AS anchor, rr.data AS data
            FROM (
                SELECT ${anchor} AS anchor, ${other} AS other,
                       row_number() OVER (PARTITION BY ${anchor} ORDER BY rel.position, rel.id) AS rn
                FROM relations rel
                WHERE rel.tenant_id = ${tenantId} AND rel.field_id = ${p.relationField.id}
                  AND ${anchor} IN (${idList(ids)})
            ) x
            JOIN records rr ON rr.id = x.other AND rr.deleted_at IS NULL
            WHERE x.rn <= ${LOOKUP_CAP}
            ORDER BY x.anchor, x.rn
        `);
        const out = new Map<number, Array<Record<string, unknown>>>();
        for (const row of res.rows as Array<{ anchor: unknown; data: unknown }>) {
            const a = Number(row.anchor);
            const list = out.get(a) ?? [];
            list.push((row.data ?? {}) as Record<string, unknown>);
            out.set(a, list);
        }
        return out;
    }

    private async rollupBatch(
        tx: Tx,
        tenantId: number,
        p: ThroughPlan,
        ids: number[],
    ): Promise<Map<number, unknown>> {
        const { anchor, other } = cols(p);
        const res = await tx.execute(sql`
            SELECT ${anchor} AS anchor, ${aggExpr(p)} AS val
            FROM relations rel
            JOIN records rr ON rr.id = ${other} AND rr.deleted_at IS NULL
            WHERE ${this.whereCore(p, tenantId, sql`${anchor} IN (${idList(ids)})`)}
            GROUP BY ${anchor}
        `);
        const out = new Map<number, unknown>();
        for (const row of res.rows as Array<{ anchor: unknown; val: unknown }>) {
            out.set(Number(row.anchor), normalize(p, row.val));
        }
        return out;
    }

    /** `(SELECT agg FROM relations … WHERE ancla = records.id AND filtro)`. */
    private rollupSubquery(p: ThroughPlan, tenantId: number): SQL {
        const { anchor, other } = cols(p);
        return sql`(
            SELECT ${aggExpr(p)}
            FROM relations rel
            JOIN records rr ON rr.id = ${other} AND rr.deleted_at IS NULL
            WHERE ${this.whereCore(p, tenantId, sql`${anchor} = ${records.id}`)}
        )`;
    }

    private whereCore(p: ThroughPlan, tenantId: number, anchorCond: SQL): SQL {
        const byId = new Map<number, FilterableField>(
            p.otherFields.map((f) => [f.id, { id: f.id, type: f.type }]),
        );
        const filter = compileFilterTree(byId, p.filter, new Date(), RR_DATA);
        const base = sql`rel.tenant_id = ${tenantId} AND rel.field_id = ${p.relationField.id} AND ${anchorCond}`;
        return filter ? sql`${base} AND (${filter})` : base;
    }
}

// ── helpers puros ─────────────────────────────────────────────────────────

/**
 * `IN ($1, $2, …)` con cada id bindeado. (`= ANY($1)` no sirve: drizzle
 * serializa un array JS como JSON, no como array de Postgres.)
 */
function idList(ids: number[]): SQL {
    return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

function asId(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Columnas de `relations` según la dirección: ancla = el registro de ESTA lista. */
function cols(p: ThroughPlan): { anchor: SQL; other: SQL } {
    return p.direction === 'forward'
        ? { anchor: sql.raw('rel.source_record_id'), other: sql.raw('rel.target_record_id') }
        : { anchor: sql.raw('rel.target_record_id'), other: sql.raw('rel.source_record_id') };
}

function aggExpr(p: ThroughPlan): SQL {
    const t = p.targetField;
    const typed = t ? fieldTypedExpr({ id: t.id, type: t.type }, RR_DATA) : sql`NULL`;
    // Las fechas se comparan como texto ISO (ordenan igual y no dependen del
    // parser de fechas del driver).
    const text = t ? sql`(${RR_DATA} ->> ${sql.raw(`'${jsonbKeyForField(t.id)}'`)})` : sql`NULL`;
    switch (p.operation) {
        case 'sum':
            return sql`coalesce(sum(${typed}), 0)`;
        case 'avg':
            return sql`avg(${typed})`;
        case 'min':
            return p.valueKind === 'text' ? sql`min(${text})` : sql`min(${typed})`;
        case 'max':
            return p.valueKind === 'text' ? sql`max(${text})` : sql`max(${typed})`;
        case 'count':
        default:
            return sql`count(*)`;
    }
}

function normalize(p: ThroughPlan, v: unknown): unknown {
    if (v === null || v === undefined) return null;
    if (p.valueKind === 'text') return String(v);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function emptyValue(p: ThroughPlan): unknown {
    if (p.field.type === 'lookup') return [];
    return p.operation === 'count' || p.operation === 'sum' ? 0 : null;
}

/** Valor del campo destino en una fila vinculada (evalúa computed del otro lado). */
function readTarget(p: ThroughPlan, data: Record<string, unknown>): unknown {
    const t = p.targetField;
    if (!t) return null;
    if (t.type === 'computed') {
        return evaluateComputed(t, p.otherFields, (id) => data[jsonbKeyForField(id)] ?? null);
    }
    return data[jsonbKeyForField(t.id)] ?? null;
}
