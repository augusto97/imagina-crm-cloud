import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    SCAN_SEARCH_FIELD_TYPES,
    TITLE_FIELD_TYPES,
    jsonbKeyForField,
    normalizeScanCode,
    pickScanField,
    resolveTitleFieldId,
    scanCodeAsNumber,
    type CodeSearchHit,
    type CodeSearchQuery,
    type CodeSearchResult,
    type FieldType,
    type GlobalSearchHit,
    type GlobalSearchQuery,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { fields, lists } from '../db/schema';
import { effectivePermissions, resolvePermissions } from '../lists/list-acl';
import { TenantDb } from '../tenancy/tenant-db.service';
import type { Actor } from './records.service';

/** Una lista que entra en la búsqueda, con lo que su fila de VALUES necesita. */
interface SearchTarget {
    listId: number;
    titleKey: string;
    scope: 'all' | 'own' | 'assigned';
    assignmentKey: string | null;
}

/**
 * Búsqueda GLOBAL de registros por TÍTULO (paleta de comandos).
 *
 * Una sola consulta para todas las listas que la persona puede ver (regla de
 * oro nº 8): las listas entran como filas de un `VALUES (lista, clave del
 * título, scope, clave de asignación)` que se une por `list_id` (hash join).
 * Probado con 300 listas: un `OR` de 300 ramas tardaba ~900 ms sobre 100k
 * registros; el `VALUES` hace un solo recorrido.
 *
 * Los permisos son los mismos del listado (`list-acl`):
 *  - scope de lectura `none` → la lista no entra;
 *  - `own` / `assigned` → la misma condición de `scopeWhere` (lo que creó, o
 *    asignado por el campo de asignación);
 *  - el título oculto para la persona (`fields_hidden`) → la lista no entra:
 *    buscar por un campo oculto sería un oráculo (SEC-25).
 * Todo va bindeado: claves `f{id}` y el texto buscado (regla de oro nº 4).
 */
@Injectable()
export class RecordSearchService {
    constructor(private readonly tenantDb: TenantDb) {}

    async search(tenantId: number, actor: Actor, query: GlobalSearchQuery): Promise<GlobalSearchHit[]> {
        const needle = query.q.trim().toLowerCase();
        if (needle === '' || actor.role === 'client') return [];
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const listRows = await tx
                .select({
                    id: lists.id,
                    slug: lists.slug,
                    name: lists.name,
                    icon: lists.icon,
                    color: lists.color,
                    settings: lists.settings,
                })
                .from(lists)
                .where(eq(lists.tenantId, tenantId));
            if (listRows.length === 0) return [];
            // Sólo los tipos que pueden ser título, en el orden en que los
            // considera `resolveTitleFieldId` (position, id).
            const fieldRows = await tx
                .select({ id: fields.id, listId: fields.listId, slug: fields.slug, type: fields.type })
                .from(fields)
                .where(and(eq(fields.tenantId, tenantId), inArray(fields.type, [...TITLE_FIELD_TYPES])))
                .orderBy(asc(fields.listId), asc(fields.position), asc(fields.id));
            const byList = new Map<number, typeof fieldRows>();
            for (const f of fieldRows) {
                const arr = byList.get(f.listId);
                if (arr) arr.push(f);
                else byList.set(f.listId, [f]);
            }

            const targets: SearchTarget[] = [];
            const meta = new Map<number, (typeof listRows)[number]>();
            for (const list of listRows) {
                const perms = effectivePermissions(list.settings, actor);
                if (perms.view === 'none') continue;
                const candidates = byList.get(list.id) ?? [];
                const titleId = resolveTitleFieldId(
                    candidates.map((f) => ({ id: f.id, type: f.type as (typeof TITLE_FIELD_TYPES)[number] })),
                    list.settings,
                );
                if (titleId === null) continue;
                const title = candidates.find((f) => f.id === titleId);
                if (!title || perms.fields_hidden.includes(title.slug)) continue;
                const assignmentId = resolvePermissions(list.settings).assignment_field_id;
                targets.push({
                    listId: list.id,
                    titleKey: jsonbKeyForField(title.id),
                    scope: perms.view,
                    assignmentKey: assignmentId ? jsonbKeyForField(assignmentId) : null,
                });
                meta.set(list.id, list);
            }
            if (targets.length === 0) return [];

            const values = sql.join(
                targets.map(
                    (t) =>
                        sql`(${t.listId}::bigint, ${t.titleKey}::text, ${t.scope}::text, ${t.assignmentKey}::text)`,
                ),
                sql`, `,
            );
            const userIdText = String(actor.userId);
            // El título se extrae y se pasa a minúsculas UNA vez por fila (las
            // capas con `OFFSET 0` impiden que el planner las aplane y vuelva
            // a calcular la expresión para el filtro y para el orden): con un
            // término que aparece en 100k registros, la mitad del tiempo se
            // iba en recalcularla.
            const result = await tx.execute(sql`
                SELECT s.id, s.parent_id, s.list_id, s.title, to_json(s.updated_at) #>> '{}' AS updated_at
                FROM (
                    SELECT x.*, strpos(lower(x.title), ${needle}) AS pos
                    FROM (
                        SELECT r.id, r.parent_id, r.list_id, r.updated_at, r.data ->> t.k AS title
                        FROM records r
                        JOIN (VALUES ${values}) AS t(list_id, k, scope, akey) ON r.list_id = t.list_id
                        WHERE r.tenant_id = ${tenantId}
                          AND r.deleted_at IS NULL
                          AND (
                              t.scope = 'all'
                              OR r.created_by = ${actor.userId}
                              OR (t.scope = 'assigned' AND t.akey IS NOT NULL AND (r.data ->> t.akey) = ${userIdText})
                          )
                        OFFSET 0
                    ) x
                    OFFSET 0
                ) s
                WHERE s.pos > 0
                ORDER BY (s.pos = 1) DESC, s.updated_at DESC, s.id DESC
                LIMIT ${query.limit}
            `);
            return (result.rows as Array<{
                id: number | string;
                parent_id: number | string | null;
                list_id: number | string;
                title: string | null;
                updated_at: Date | string;
            }>).flatMap((r): GlobalSearchHit[] => {
                const list = meta.get(Number(r.list_id));
                if (!list) return [];
                return [
                    {
                        record_id: Number(r.id),
                        parent_id: r.parent_id === null ? null : Number(r.parent_id),
                        title: r.title ?? '',
                        list_id: list.id,
                        list_slug: list.slug,
                        list_name: list.name,
                        list_icon: list.icon ?? null,
                        list_color: list.color ?? null,
                        updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
                    },
                ];
            });
        });
    }

    /**
     * H3 — Busca un CÓDIGO escaneado (QR o de barras) en los registros: en
     * todas las listas que la persona ve (búsqueda global) o en una (la barra
     * de la lista), por su campo «Código» o, si no eligió ninguno, por todos
     * los de texto, número e ID automático.
     *
     * Coincidencia EXACTA sin distinguir mayúsculas ni los espacios de los
     * bordes; un código numérico también encuentra el mismo número de un
     * campo numérico. Mismo ACL que la búsqueda por título: scope de lectura
     * por lista y campos ocultos fuera (buscar por un campo que la persona no
     * ve sería un oráculo, SEC-25). Una sola consulta (regla de oro nº 8).
     */
    async findByCode(tenantId: number, actor: Actor, query: CodeSearchQuery): Promise<CodeSearchResult> {
        const code = normalizeScanCode(query.code);
        const empty: CodeSearchResult = { code, hits: [], truncated: false, field_id: null };
        if (code === '' || actor.role === 'client') return empty;
        const asNumber = scanCodeAsNumber(code);
        return this.tenantDb.withTenant(tenantId, async (tx) => {
            const listCols = { id: lists.id, slug: lists.slug, name: lists.name, icon: lists.icon, color: lists.color, settings: lists.settings };
            let listRows: Array<{ id: number; slug: string; name: string; icon: string | null; color: string | null; settings: Record<string, unknown> }>;
            if (query.list !== undefined) {
                const key = query.list;
                const byId = /^\d+$/.test(key) ? Number(key) : null;
                listRows = await tx
                    .select(listCols)
                    .from(lists)
                    .where(and(eq(lists.tenantId, tenantId), byId !== null ? or(eq(lists.id, byId), eq(lists.slug, key)) : eq(lists.slug, key)))
                    .limit(1);
                if (listRows.length === 0) {
                    throw new NotFoundException({ code: 'list_not_found', message: 'Lista no encontrada', data: { status: 404 } });
                }
            } else {
                listRows = await tx.select(listCols).from(lists).where(eq(lists.tenantId, tenantId));
            }
            if (listRows.length === 0) return empty;
            const wanted = [...new Set<FieldType>([...TITLE_FIELD_TYPES, ...SCAN_SEARCH_FIELD_TYPES])];
            const fieldRows = await tx
                .select({ id: fields.id, listId: fields.listId, slug: fields.slug, label: fields.label, type: fields.type })
                .from(fields)
                .where(
                    and(
                        eq(fields.tenantId, tenantId),
                        inArray(fields.type, wanted),
                        inArray(
                            fields.listId,
                            listRows.map((l) => l.id),
                        ),
                    ),
                )
                .orderBy(asc(fields.listId), asc(fields.position), asc(fields.id));
            const byList = new Map<number, typeof fieldRows>();
            for (const f of fieldRows) {
                const arr = byList.get(f.listId);
                if (arr) arr.push(f);
                else byList.set(f.listId, [f]);
            }

            const targets: CodeTarget[] = [];
            const meta = new Map<number, (typeof listRows)[number]>();
            const fieldByKey = new Map<string, { id: number; label: string }>();
            let usedField: number | null = null;
            for (const list of listRows) {
                const perms = effectivePermissions(list.settings, actor);
                if (perms.view === 'none') continue;
                const all = byList.get(list.id) ?? [];
                const visible = all.filter((f) => !perms.fields_hidden.includes(f.slug));
                let searchable = visible.filter((f) => (SCAN_SEARCH_FIELD_TYPES as readonly string[]).includes(f.type));
                if (query.list !== undefined) {
                    if (query.field !== undefined) {
                        const one = searchable.find((f) => f.id === query.field);
                        if (!one) {
                            throw new BadRequestException({
                                code: 'scan_field_invalid',
                                message: 'Ese campo no sirve para buscar un código (tiene que ser de texto, número o ID automático)',
                                data: { status: 400 },
                            });
                        }
                        searchable = [one];
                    } else {
                        const chosen = pickScanField(searchable, list.settings);
                        if (chosen) searchable = [chosen];
                    }
                    usedField = searchable.length === 1 ? searchable[0]!.id : null;
                }
                if (searchable.length === 0) continue;
                const titleId = resolveTitleFieldId(
                    all.filter((f) => (TITLE_FIELD_TYPES as readonly string[]).includes(f.type)).map((f) => ({ id: f.id, type: f.type as FieldType })),
                    list.settings,
                );
                const title = titleId !== null ? visible.find((f) => f.id === titleId) : undefined;
                for (const f of searchable) fieldByKey.set(jsonbKeyForField(f.id), { id: f.id, label: f.label });
                const assignmentId = resolvePermissions(list.settings).assignment_field_id;
                targets.push({
                    listId: list.id,
                    textKeys: searchable.filter((f) => f.type !== 'number').map((f) => jsonbKeyForField(f.id)),
                    numberKeys: asNumber === null ? [] : searchable.filter((f) => f.type === 'number').map((f) => jsonbKeyForField(f.id)),
                    titleKey: title ? jsonbKeyForField(title.id) : null,
                    scope: perms.view,
                    assignmentKey: assignmentId ? jsonbKeyForField(assignmentId) : null,
                });
                meta.set(list.id, list);
            }
            if (targets.length === 0) return { ...empty, field_id: usedField };

            const arr = (keys: string[]): SQL =>
                keys.length === 0 ? sql`ARRAY[]::text[]` : sql`ARRAY[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`;
            const values = sql.join(
                targets.map(
                    (t) =>
                        sql`(${t.listId}::bigint, ${arr(t.textKeys)}, ${arr(t.numberKeys)}, ${t.titleKey}::text, ${t.scope}::text, ${t.assignmentKey}::text)`,
                ),
                sql`, `,
            );
            const userIdText = String(actor.userId);
            // El número SÓLO se compara cuando el valor guardado es número
            // (el CASE garantiza el orden: un texto nunca llega al ::numeric).
            const numberMatch =
                asNumber === null
                    ? sql`false`
                    : sql`(CASE WHEN jsonb_typeof(r.data -> k2) = 'number' THEN (r.data ->> k2)::numeric END) = ${String(asNumber)}::numeric`;
            const result = await tx.execute(sql`
                SELECT r.id, r.parent_id, r.list_id,
                       CASE WHEN t.tk IS NULL THEN NULL ELSE r.data ->> t.tk END AS title,
                       m.k AS field_key
                FROM records r
                JOIN (VALUES ${values}) AS t(list_id, tkeys, nkeys, tk, scope, akey) ON r.list_id = t.list_id
                CROSS JOIN LATERAL (
                    SELECT hit.k FROM (
                        SELECT k1 AS k FROM unnest(t.tkeys) AS k1 WHERE lower(btrim(r.data ->> k1)) = lower(${code})
                        UNION ALL
                        SELECT k2 AS k FROM unnest(t.nkeys) AS k2 WHERE ${numberMatch}
                    ) hit
                    LIMIT 1
                ) m
                WHERE r.tenant_id = ${tenantId}
                  AND r.deleted_at IS NULL
                  AND (
                      t.scope = 'all'
                      OR r.created_by = ${actor.userId}
                      OR (t.scope = 'assigned' AND t.akey IS NOT NULL AND (r.data ->> t.akey) = ${userIdText})
                  )
                ORDER BY r.updated_at DESC, r.id DESC
                LIMIT ${query.limit + 1}
            `);
            const rows = result.rows as Array<{
                id: number | string;
                parent_id: number | string | null;
                list_id: number | string;
                title: string | null;
                field_key: string;
            }>;
            const hits = rows.slice(0, query.limit).flatMap((r): CodeSearchHit[] => {
                const list = meta.get(Number(r.list_id));
                const field = fieldByKey.get(r.field_key);
                if (!list || !field) return [];
                return [
                    {
                        record_id: Number(r.id),
                        parent_id: r.parent_id === null ? null : Number(r.parent_id),
                        title: (r.title ?? '').trim(),
                        list_id: list.id,
                        list_slug: list.slug,
                        list_name: list.name,
                        list_icon: list.icon ?? null,
                        list_color: list.color ?? null,
                        field_id: field.id,
                        field_label: field.label,
                    },
                ];
            });
            return { code, hits, truncated: rows.length > query.limit, field_id: usedField };
        });
    }
}

/** H3 — Una lista en la búsqueda de un código, con sus claves `f{id}` por tipo. */
interface CodeTarget {
    listId: number;
    textKeys: string[];
    numberKeys: string[];
    titleKey: string | null;
    scope: 'all' | 'own' | 'assigned';
    assignmentKey: string | null;
}
