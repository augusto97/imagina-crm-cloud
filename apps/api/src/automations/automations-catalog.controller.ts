import { Controller, Get, Param, ParseIntPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { ActionMeta, AutomationRun, TriggerMeta } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AutomationsService } from './automations.service';

/**
 * Catálogo de triggers/acciones (para el editor del plugin) + runs por id.
 * El editor renderiza formularios HARDCODED por tipo; el catálogo sólo provee
 * la lista (slug + label + event) para los dropdowns. `config_schema` va vacío.
 */
const TRIGGERS: TriggerMeta[] = [
    { slug: 'record_created', label: 'Cuando se crea un registro', event: 'imagina_crm/record_created', config_schema: {} },
    { slug: 'record_updated', label: 'Cuando se actualiza un registro', event: 'imagina_crm/record_updated', config_schema: {} },
    { slug: 'field_changed', label: 'Cuando cambia un campo', event: 'imagina_crm/record_updated', config_schema: {} },
    { slug: 'due_date_reached', label: 'Cuando se alcanza una fecha', event: 'imagina_crm/scheduled_tick', config_schema: {} },
    { slug: 'scheduled', label: 'En un horario (cron)', event: 'imagina_crm/scheduled_tick', config_schema: {} },
    { slug: 'incoming_webhook', label: 'Webhook entrante (URL pública)', event: 'imagina_crm/incoming_webhook', config_schema: {} },
];

const ACTIONS: ActionMeta[] = [
    { slug: 'send_email', label: 'Enviar email', config_schema: {} },
    { slug: 'call_webhook', label: 'Llamar webhook externo', config_schema: {} },
    { slug: 'update_field', label: 'Actualizar un campo', config_schema: {} },
    { slug: 'create_record', label: 'Crear un registro', config_schema: {} },
    { slug: 'if_else', label: 'Si / sino (condicional)', config_schema: {} },
];

@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AutomationsCatalogController {
    constructor(private readonly automations: AutomationsService) {}

    @Get('triggers')
    @RequireCapability('manage_automations')
    triggers(): { data: TriggerMeta[] } {
        return { data: TRIGGERS };
    }

    @Get('actions')
    @RequireCapability('manage_automations')
    actions(): { data: ActionMeta[] } {
        return { data: ACTIONS };
    }

    /** Runs por automation id (ruta que usa el editor del fork, sin lista). */
    @Get('automations/:id/runs')
    @RequireCapability('manage_automations')
    runs(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Query('cursor') cursor?: string,
    ): Promise<{ data: AutomationRun[]; meta: { next_cursor: string | null } }> {
        return this.automations.runsById(req.tenant!.tenantId, id, {
            cursor: cursor ? Number(cursor) : undefined,
        });
    }
}
