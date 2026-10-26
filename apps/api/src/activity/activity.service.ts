import { Injectable, NotFoundException } from '@nestjs/common';
import {
    jsonbKeyForField,
    type ActivityAction,
    type ActivityDto,
    type FieldHistoryEntry,
    type FieldHistoryPage
    } from '@imagina-base/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { activity, fields as fieldsTable, records } from '../db/schema';
import { assignmentKeys, listRowInScope, type AclSubject } from '../lists/list-acl';
import { effectivePermissions, scopeWhere } from '../lists/list-acl';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { ActivityRepository, type ActivityRow } from './activity.repository';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Ventana en la que las ediciones de la descripción de una persona se juntan. */
export const DESCRIPTION_MERGE_MS = 10 * 60 * 1000;

/** `{ description: { from, to } }` y nada más → el par; si no, null. */
function descriptionOnlyChange(diff: unknown): { from: unknown; to: unknown } | null {
    if (!diff || typeof diff !== 'object') return null;
    const keys = Object.keys(diff as Record<string, unknown>);
    if (keys.length !== 1 || keys[0] !== 'description') return null;
    const pair = (diff as { description?: unknown }).description;
    if (!pair || typeof pair !== 'object' || !('to' in pair)) return null;
    return pair as { from: unknown; to: unknown };
}

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

    /**
     * Edición de la DESCRIPCIÓN de un registro.
     *
     * La descripción se guarda sola mientras la persona escribe (cada ~1 s):
     * con una entrada por guardado, la actividad se llenaba de "actualizó
     * este registro" vacíos. Ahora el diff es `{ description: { from, to } }`
     * con un RESUMEN de texto (no el documento entero) y las ediciones
     * seguidas de la misma persona dentro de `DESCRIPTION_MERGE_MS` reescriben
     * su última entrada en vez de sumar otra — siempre que sea la última del
     * registro (si en el medio pasó otra cosa, la línea de tiempo la respeta).
     */
    async logDescriptionEdit(
        tx: Tx,
        params: { tenantId: number; listId: number; recordId: number; userId: number | null; from: string; to: string },
    ): Promise<void> {
        const last = await this.repo.latestForRecord(tx, params.tenantId, params.recordId);
        const prev = last ? descriptionOnlyChange(last.diff) : null;
        if (
            last
            && prev
            && last.action === 'record_updated'
            && (last.userId ?? null) === (params.userId ?? null)
            && Date.now() - last.createdAt.getTime() <= DESCRIPTION_MERGE_MS
        ) {
            await this.repo.rewrite(tx, params.tenantId, last.id, { description: { from: prev.from, to: params.to } });
            return;
        }
        await this.repo.log(tx, {
            tenantId: params.tenantId,
            listId: params.listId,
            recordId: params.recordId,
            userId: params.userId,
            action: 'record_updated',
            diff: { description: { from: params.from, to: params.to } },
        });
    }

    /**
     * v0.1.291 — Historial de UN campo de un registro, paginado por cursor.
     *
     * El mismo ACL que la ficha: el registro tiene que existir en ESTA lista
     * y estar al alcance del rol de quien mira, y el campo tiene que ser de la
     * lista y no estar oculto para él (si no, 404 opaco: no se revela si
     * existe). La actividad no cuelga del registro con FK, así que un registro
     * borrado no tiene historial que mostrar.
     */
    async fieldHistory(
        tenantId: number,
        listIdOrSlug: string,
        recordId: number,
        fieldId: number,
        opts: { cursor?: number; limit?: number; viewer: AclSubject },
    ): Promise<FieldHistoryPage> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const limit = Math.min(Math.max(Math.trunc(opts.limit ?? HISTORY_DEFAULT_LIMIT) || HISTORY_DEFAULT_LIMIT, 1), HISTORY_MAX_LIMIT);
        const key = jsonbKeyForField(fieldId);
        const rows = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const [field] = await tx
                .select({ id: fieldsTable.id, slug: fieldsTable.slug, type: fieldsTable.type })
                .from(fieldsTable)
                .where(and(eq(fieldsTable.id, fieldId), eq(fieldsTable.listId, list.id)))
                .limit(1);
            if (!field) throw historyNotFound();
            const perms = effectivePermissions(list.settings, opts.viewer);
            if (perms.fields_hidden.includes(field.slug)) throw historyNotFound();
            // C3 — un invitado no ve las relaciones (registros de otras listas).
            if (opts.viewer.role === 'guest' && field.type === 'relation') throw historyNotFound();
            const [rec] = await tx
                .select({ id: records.id, data: records.data, createdBy: records.createdBy })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, list.id), eq(records.id, recordId), sql`${records.deletedAt} IS NULL`))
                .limit(1);
            if (!rec) throw historyNotFound();
            if (!listRowInScope(list.settings, opts.viewer, 'view', { id: rec.id, createdBy: rec.createdBy, data: rec.data })) {
                throw historyNotFound();
            }
            return this.repo.fieldHistory(tx, tenantId, list.id, recordId, key, { cursor: opts.cursor, limit: limit + 1 });
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
            data: page.map((r) => toHistoryEntry(r, key)),
            meta: { next_cursor: hasMore ? String(page[page.length - 1]!.id) : null },
        };
    }

    async list(
        tenantId: number,
        listIdOrSlug: string,
        opts: { recordId?: number; cursor?: number; limit?: number; viewer?: AclSubject },
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
                const perms = effectivePermissions(list.settings, opts.viewer);
                const scope = scopeWhere(perms.view, opts.viewer, assignmentKeys(list.settings));
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
                // C3 — a un invitado tampoco le llegan los cambios de relaciones.
                if (opts.viewer.role === 'guest') {
                    const rels = await tx
                        .select({ id: fieldsTable.id })
                        .from(fieldsTable)
                        .where(and(eq(fieldsTable.listId, list.id), eq(fieldsTable.type, 'relation')));
                    for (const r of rels) hiddenKeys.add(jsonbKeyForField(r.id));
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

const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 100;

function historyNotFound(): NotFoundException {
    return new NotFoundException({
        code: 'field_history_not_found',
        message: 'No se encontró el historial de ese campo',
        data: { status: 404 },
    });
}

function toHistoryEntry(row: ActivityRow, key: string): FieldHistoryEntry {
    const pair = (row.diff as Record<string, unknown> | null)?.[key];
    const p = pair && typeof pair === 'object' ? (pair as { from?: unknown; to?: unknown }) : {};
    return {
        id: row.id,
        user_id: row.userId,
        user_name: row.userName,
        action: row.action as ActivityAction,
        from: p.from ?? null,
        to: p.to ?? null,
        created_at: row.createdAt.toISOString(),
    };
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
