import { Injectable, NotFoundException } from '@nestjs/common';
import type {
    Automation,
    AutomationRun,
    AutomationRunStatus,
    CreateAutomationInput,
    UpdateAutomationInput,
} from '@imagina-base/shared';
import { ListsService } from '../lists/lists.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import { AutomationScheduler } from './automation-scheduler.service';
import {
    AutomationsRepository,
    type AutomationRow,
    type AutomationRunRow,
} from './automations.repository';

@Injectable()
export class AutomationsService {
    constructor(
        private readonly tenantDb: TenantDb,
        private readonly repo: AutomationsRepository,
        private readonly lists: ListsService,
        private readonly scheduler: AutomationScheduler,
    ) {}

    async list(tenantId: number, listIdOrSlug: string): Promise<Automation[]> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listByList(tx, tenantId, list.id),
        );
        return rows.map(toAutomation);
    }

    async get(tenantId: number, listIdOrSlug: string, id: number): Promise<Automation> {
        await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, id),
        );
        if (!row) throw notFound(id);
        return toAutomation(row);
    }

    async create(
        tenantId: number,
        listIdOrSlug: string,
        input: CreateAutomationInput,
    ): Promise<Automation> {
        const list = await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.insert(tx, {
                tenantId,
                listId: list.id,
                name: input.name,
                trigger: input.trigger,
                actions: input.actions,
                condition: input.condition ?? null,
                isActive: input.is_active ?? true,
            }),
        );
        await this.scheduler.sync(tenantId, row);
        return toAutomation(row);
    }

    async update(
        tenantId: number,
        listIdOrSlug: string,
        id: number,
        patch: UpdateAutomationInput,
    ): Promise<Automation> {
        await this.lists.get(tenantId, listIdOrSlug);
        const row = await this.tenantDb.withTenant(tenantId, async (tx) => {
            const current = await this.repo.findById(tx, tenantId, id);
            if (!current) throw notFound(id);
            const changes: Partial<typeof import('../db/schema').automations.$inferInsert> = {};
            if (patch.name !== undefined) changes.name = patch.name;
            if (patch.trigger !== undefined) changes.trigger = patch.trigger;
            if (patch.actions !== undefined) changes.actions = patch.actions;
            if (patch.condition !== undefined) changes.condition = patch.condition;
            if (patch.is_active !== undefined) changes.isActive = patch.is_active;
            const updated = await this.repo.update(tx, tenantId, id, changes);
            if (!updated) throw notFound(id);
            return updated;
        });
        await this.scheduler.sync(tenantId, row);
        return toAutomation(row);
    }

    async remove(tenantId: number, listIdOrSlug: string, id: number): Promise<void> {
        await this.lists.get(tenantId, listIdOrSlug);
        const deleted = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.remove(tx, tenantId, id),
        );
        if (!deleted) throw notFound(id);
        await this.scheduler.remove(id);
    }

    async runs(
        tenantId: number,
        listIdOrSlug: string,
        automationId: number,
        opts: { cursor?: number; limit?: number },
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        await this.get(tenantId, listIdOrSlug, automationId);
        const limit = Math.min(opts.limit ?? 50, 200);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listRuns(tx, tenantId, automationId, { cursor: opts.cursor, limit: limit + 1 }),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map(toRun), meta: { next_cursor: nextCursor } };
    }
}

function toAutomation(row: AutomationRow): Automation {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        trigger: row.trigger,
        actions: row.actions,
        condition: row.condition ?? null,
        is_active: row.isActive,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function toRun(row: AutomationRunRow): AutomationRun {
    return {
        id: row.id,
        automation_id: row.automationId,
        record_id: row.recordId,
        status: row.status as AutomationRunStatus,
        logs: row.logs,
        duration_ms: row.durationMs,
        created_at: row.createdAt.toISOString(),
    };
}

function notFound(id: number): NotFoundException {
    return new NotFoundException({
        code: 'automation_not_found',
        message: `Automatización ${id} no encontrada`,
        data: { status: 404 },
    });
}
