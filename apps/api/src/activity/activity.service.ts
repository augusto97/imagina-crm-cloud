import { Injectable } from '@nestjs/common';
import type { ActivityAction, ActivityDto } from '@imagina-base/shared';
import type { Tx } from '../db/client';
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
        opts: { recordId?: number; cursor?: number; limit?: number },
    ): Promise<{ data: ActivityDto[]; meta: { next_cursor: string | null } }> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.list(tx, tenantId, list.id, {
                recordId: opts.recordId,
                cursor: opts.cursor,
                limit: limit + 1,
            }),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map(toActivity), meta: { next_cursor: nextCursor } };
    }
}

function toActivity(row: ActivityRow): ActivityDto {
    return {
        id: row.id,
        list_id: row.listId,
        record_id: row.recordId,
        user_id: row.userId,
        action: row.action as ActivityAction,
        diff: row.diff,
        created_at: row.createdAt.toISOString(),
    };
}
