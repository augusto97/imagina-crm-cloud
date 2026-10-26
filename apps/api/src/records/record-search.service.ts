import { Injectable } from '@nestjs/common';
import {
    TITLE_FIELD_TYPES,
    jsonbKeyForField,
    resolveTitleFieldId,
    type GlobalSearchHit,
    type GlobalSearchQuery,
} from '@imagina-base/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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
}
