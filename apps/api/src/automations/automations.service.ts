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
                description: input.description ?? null,
                triggerType: input.trigger_type,
                triggerConfig: input.trigger_config ?? {},
                actions: input.actions,
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
            if (patch.description !== undefined) changes.description = patch.description ?? null;
            if (patch.trigger_type !== undefined) changes.triggerType = patch.trigger_type;
            if (patch.trigger_config !== undefined) changes.triggerConfig = patch.trigger_config;
            if (patch.actions !== undefined) changes.actions = patch.actions;
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

    /** Runs de una automatización por id (sin contexto de lista — la ruta del fork). */
    async runsById(
        tenantId: number,
        automationId: number,
        opts: { cursor?: number; limit?: number },
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        const auto = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.findById(tx, tenantId, automationId),
        );
        if (!auto) throw notFound(automationId);
        const limit = Math.min(opts.limit ?? 50, 200);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            this.repo.listRuns(tx, tenantId, automationId, { cursor: opts.cursor, limit: limit + 1 }),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? String(page[page.length - 1]!.id) : null;
        return { data: page.map((r) => toRun(r, auto.listId)), meta: { next_cursor: nextCursor } };
    }
}

function toAutomation(row: AutomationRow): Automation {
    return {
        id: row.id,
        list_id: row.listId,
        name: row.name,
        description: row.description ?? null,
        trigger_type: row.triggerType,
        trigger_config: row.triggerConfig ?? {},
        actions: row.actions,
        is_active: row.isActive,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
    };
}

function toRun(row: AutomationRunRow, listId: number): AutomationRun {
    return {
        id: row.id,
        automation_id: row.automationId,
        list_id: listId,
        record_id: row.recordId,
        status: row.status as AutomationRunStatus,
        actions_log: row.actionsLog,
        error: row.error ?? null,
        started_at: row.startedAt ? row.startedAt.toISOString() : null,
        finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
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
