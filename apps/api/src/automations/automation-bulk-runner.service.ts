import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { bulkEditTargetSchema, bulkOperationSchema, type ActionLogEntry } from '@imagina-base/shared';
import { BulkEditService } from '../records/bulk-edit.service';
import { TenantDb } from '../tenancy/tenant-db.service';
import type { BulkEditJob } from './automation-dispatcher.service';
import { AutomationsRepository } from './automations.repository';

/**
 * v0.1.221 — Corre la acción «Editar en lote» de una automatización (job
 * 'bulk-edit' de la cola). Resuelve lo que coincide con el filtro EN ESE
 * MOMENTO y lo edita con el mismo servicio que usa una persona, así queda en
 * el historial de ediciones masivas con su deshacer. El resultado se anota
 * como una corrida propia de la automatización, para que se vea en su
 * historial igual que el resto de sus acciones.
 *
 * `BulkEditService` vive en RecordsModule, que ya depende de este módulo
 * (el dispatcher es global): se resuelve con ModuleRef al usarlo para no
 * armar un ciclo de módulos.
 */
@Injectable()
export class AutomationBulkRunner {
    private readonly logger = new Logger(AutomationBulkRunner.name);

    constructor(
        private readonly moduleRef: ModuleRef,
        private readonly tenantDb: TenantDb,
        private readonly automations: AutomationsRepository,
    ) {}

    async run(job: BulkEditJob): Promise<ActionLogEntry> {
        const startedAt = new Date();
        let entry: ActionLogEntry;
        try {
            const bulk = this.moduleRef.get(BulkEditService, { strict: false });
            const target = bulkEditTargetSchema.parse({
                ...(job.filter_tree ? { filter_tree: job.filter_tree } : {}),
                ...(job.search ? { search: job.search } : {}),
                include_subtasks: false,
            });
            const operations = job.operations.map((o) => bulkOperationSchema.parse(o));
            const out = await bulk.runForAutomation(job.tenantId, job.listId, job.automationName, target, operations);
            const parts = [
                out.total === 0
                    ? 'Ningún registro coincidía con el filtro.'
                    : `Cambió ${out.changed} de ${out.total} ${out.total === 1 ? 'registro' : 'registros'}.`,
            ];
            if (out.unchanged > 0) parts.push(`${out.unchanged} ya estaban así.`);
            if (out.failed > 0) parts.push(`${out.failed} no se pudieron: ${out.errors.join(' · ')}`);
            entry = {
                action: 'bulk_edit',
                // Falla sólo si había algo que cambiar y no se pudo cambiar nada.
                status: out.failed > 0 && out.changed === 0 ? 'failed' : 'success',
                message: parts.join(' '),
                details: { ...out },
            };
        } catch (err) {
            entry = { action: 'bulk_edit', status: 'failed', message: explain(err), details: {} };
        }
        if (job.automationId > 0) {
            await this.tenantDb
                .withTenant(job.tenantId, (tx) =>
                    this.automations.logRun(tx, {
                        tenantId: job.tenantId,
                        automationId: job.automationId,
                        recordId: null,
                        status: entry.status === 'failed' ? 'failed' : 'success',
                        actionsLog: [entry],
                        error: entry.status === 'failed' ? entry.message : null,
                        startedAt,
                        finishedAt: new Date(),
                    }),
                )
                // La automatización pudo borrarse mientras corría: la edición ya quedó hecha.
                .catch((err) => this.logger.warn(`No se pudo anotar la corrida de la edición en lote: ${String(err)}`));
        }
        return entry;
    }
}

function explain(err: unknown): string {
    if (err && typeof err === 'object' && 'getResponse' in err && typeof (err as { getResponse: unknown }).getResponse === 'function') {
        const body = (err as { getResponse: () => unknown }).getResponse();
        if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
            return (body as { message: string }).message;
        }
    }
    return err instanceof Error ? err.message : 'Error';
}
