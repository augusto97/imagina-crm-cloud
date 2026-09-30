import { Injectable } from '@nestjs/common';
import { jsonbKeyForField, type ActivityAction, type ActivityDto, type Role } from '@imagina-base/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { activity, fields as fieldsTable, records } from '../db/schema';
import { effectivePermissions, resolvePermissions, scopeWhere } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ActivityRepository, type ActivityRow } from './activity.repository';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Diff por campo entre dos `data` de record: `{ fN: { from, to } }`. */
export function computeDiff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const from = before[key] ?? null;
        const to = after[key] ?? null;
        if (JSON.stringify(from) !== JSON.stringify(to)) {
            diff[key] = { from, to };
        }
    }
    return diff;
}

@Injectable()
export class ActivityService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: ActivityRepository,
        private readonly lists: ListsService,
    ) {}

    /** Escribe una entrada DENTRO del tx de la mutación (atómico). */
    logInTx(
        tx: Tx,
        params: {
            tenantId: number;
            listId: number;
            recordId: number | null;
            userId: number | null;
            action: ActivityAction;
            diff?: Record<string, unknown>;
        },
    ): Promise<void> {
        return this.repo.log(tx, {
            tenantId: params.tenantId,
            listId: params.listId,
            recordId: params.recordId,
            userId: params.userId,
            action: params.action,
            diff: params.diff ?? {},
        });
    }

    async list(
        tenantId: number,
        listIdOrSlug: string,
        opts: { recordId?: number; cursor?: number; limit?: number; viewer?: { role: Role; userId: number } },
    ): Promise<{ data: ActivityDto[]; meta: { next_cursor: string | null } }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const { rows, hiddenKeys } = await this.tenantDb.withTenant(tenantId, async (tx) => {
            // SEC-25 (v0.1.226): la actividad es una LECTURA de los registros
            // (el alta guarda TODOS sus valores en el diff). Se muestra sólo la
            // de los registros que esta persona puede ver, sin los campos que
            // su rol tiene ocultos.
            let where;
            let hiddenKeys = new Set<string>();
            if (opts.viewer) {
                const perms = effectivePermissions(list.settings, opts.viewer.role, opts.viewer.userId);
                const assignmentId = resolvePermissions(list.settings).assignment_field_id;
                const scope = scopeWhere(perms.view, opts.viewer.userId, assignmentId ? jsonbKeyForField(assignmentId) : null);
                if (scope) {
                    where = inArray(
                        activity.recordId,
                        tx
                            .select({ id: records.id })
                            .from(records)
                            .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), scope)),
                    );
                }
                if (perms.fields_hidden.length > 0) {
                    const hidden = await tx
                        .select({ id: fieldsTable.id })
                        .from(fieldsTable)
                        .where(
                            and(
                                eq(fieldsTable.listId, list.id),
                                inArray(fieldsTable.slug, perms.fields_hidden),
                            ),
                        );
                    hiddenKeys = new Set(hidden.map((h) => jsonbKeyForField(h.id)));
                }
            }
            const rows = await this.repo.list(tx, tenantId, list.id, {
                recordId: opts.recordId,
                cursor: opts.cursor,
                limit: limit + 1,
                where: where ?? sql`true`,
            });
            return { rows, hiddenKeys };
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return {
            data: page.map((r) => toActivity(hiddenKeys.size > 0 ? { ...r, diff: stripKeys(r.diff, hiddenKeys) } : r)),
            meta: { next_cursor: nextCursor },
        };
    }
}

function toActivity(row: ActivityRow): ActivityDto {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        action: row.action as ActivityAction,
        // v0.1.149 — el nombre de quien hizo el cambio: sin esto el feed
        // sólo podía decir "por usuario #2".
        user_name: row.userName,
        diff: row.diff,
        created_at: row.createdAt.toISOString(),
    };
}

/** El diff sin las claves `f{id}` de los campos ocultos para quien mira. */
function stripKeys(diff: unknown, hidden: Set<string>): Record<string, unknown> {
    if (!diff || typeof diff !== 'object') return {};
    return Object.fromEntries(Object.entries(diff as Record<string, unknown>).filter(([k]) => !hidden.has(k)));
}
