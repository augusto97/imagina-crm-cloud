import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { ActionMeta, AutomationRun, HookCapture, TriggerMeta } from '@imagina-base/shared';
import type { FastifyRequest } from 'fastify';
import { SessionGuard } from '../auth/session.guard';
import { CapabilitiesGuard } from '../authz/capabilities.guard';
import { RequireCapability } from '../authz/require-capability.decorator';
import { TenantGuard } from '../tenancy/tenant.guard';
import { ConnectorsService } from '../connectors/connectors.service';
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
    { slug: 'scheduled', label: 'En un horario', event: 'imagina_crm/scheduled_tick', config_schema: {} },
    { slug: 'incoming_webhook', label: 'Webhook entrante (URL pública)', event: 'imagina_crm/incoming_webhook', config_schema: {} },
    // v0.1.251 — un cliente pagó un link de Mercado Pago o Wompi del registro.
    { slug: 'payment_received', label: 'Cuando se recibe un pago', event: 'imagina_crm/payment_received', config_schema: {} },
    { slug: 'form_submitted', label: 'Cuando se envía un formulario', event: 'imagina_crm/form_submitted', config_schema: {} },
    // Campo «Botón» — alguien presionó un botón del registro (todos o uno).
    { slug: 'button_pressed', label: 'Al presionar el botón', event: 'imagina_crm/button_pressed', config_schema: {} },
    // C5 — una solicitud de aprobación del registro se resolvió.
    { slug: 'approval_resolved', label: 'Cuando se aprueba o se rechaza', event: 'imagina_crm/approval_resolved', config_schema: {} },
    // A9 — un checklist del registro quedó completo (uno por nombre o todos).
    { slug: 'checklist_completed', label: 'Cuando se completa un checklist', event: 'imagina_crm/checklist_completed', config_schema: {} },
    // D5 — una cita de una página de agenda se agendó, se reprogramó o se canceló.
    { slug: 'booking_event', label: 'Cuando se agenda, reprograma o cancela una cita', event: 'imagina_crm/booking_event', config_schema: {} },
    // D3 — un contacto escribió por WhatsApp oficial (el registro ya se encontró o creó).
    { slug: 'whatsapp_message_received', label: 'Cuando llega un mensaje de WhatsApp', event: 'imagina_crm/whatsapp_message_received', config_schema: {} },
    // D2 — llegó un correo al buzón de soporte (ticket nuevo o respuesta del cliente).
    { slug: 'email_received', label: 'Cuando llega un correo', event: 'imagina_crm/email_received', config_schema: {} },
    // E5 — un SLA de la mesa de ayuda entró en riesgo o se venció.
    { slug: 'sla_alert', label: 'Cuando un SLA está en riesgo o se vence', event: 'imagina_crm/sla_alert', config_schema: {} },
];

const ACTIONS: ActionMeta[] = [
    { slug: 'send_email', label: 'Enviar email', config_schema: {} },
    { slug: 'call_webhook', label: 'Llamar webhook externo', config_schema: {} },
    { slug: 'update_field', label: 'Actualizar un campo', config_schema: {} },
    { slug: 'create_record', label: 'Crear un registro', config_schema: {} },
    { slug: 'bulk_edit', label: 'Editar en lote', config_schema: {} },
    // v0.1.266 — un PDF con una plantilla de documento (cuenta de cobro, recibo).
    { slug: 'generate_pdf', label: 'Generar un PDF', config_schema: {} },
    { slug: 'if_else', label: 'Si / sino (condicional)', config_schema: {} },
    // v0.1.288 — esperar un tiempo o hasta una fecha, y repetir por cada vinculado.
    { slug: 'wait', label: 'Esperar', config_schema: {} },
    { slug: 'for_each_linked', label: 'Repetir por cada registro vinculado', config_schema: {} },
    // C5 — aprobaciones: pedir una y esperar a que se resuelva.
    { slug: 'request_approval', label: 'Pedir aprobación', config_schema: {} },
    { slug: 'wait_approval', label: 'Esperar aprobación', config_schema: {} },
    // C6 — las subtareas (y checklists) de una plantilla de registro sobre el registro.
    { slug: 'create_subtasks_from_template', label: 'Crear subtareas desde una plantilla', config_schema: {} },
    // D2 — responder por correo al hilo del ticket (mesa de ayuda).
    { slug: 'reply_email', label: 'Responder por correo al hilo del registro', config_schema: {} },
    // E6 — pedirle a un agente de IA que trabaje sobre el registro.
    { slug: 'ask_agent', label: 'Pedirle a un agente', config_schema: {} },
];

@Controller()
@UseGuards(SessionGuard, TenantGuard, CapabilitiesGuard)
export class AutomationsCatalogController {
    constructor(
        private readonly automations: AutomationsService,
        private readonly connectors: ConnectorsService,
    ) {}

    @Get('triggers')
    @RequireCapability('manage_automations')
    triggers(): { data: TriggerMeta[] } {
        return { data: TRIGGERS };
    }

    /**
     * v0.1.198 — el catálogo deja de ser una constante: además de los 5 tipos
     * fijos devuelve UNA entrada por acción con nombre de cada conector visible
     * ("Enviar WhatsApp" de «Gateway»). El menú del editor deja de preguntar
     * "¿qué tipo de acción?" para ofrecer directamente lo que la empresa
     * conectó, que es lo que pasa en Zapier y en n8n.
     */
    @Get('actions')
    @RequireCapability('manage_automations')
    async actions(@Req() req: FastifyRequest): Promise<{ data: ActionMeta[] }> {
        const tenant = req.tenant!;
        const connections = await this.connectors.list(
            tenant.tenantId,
            req.authUserId as number,
            tenant.role,
        );
        const fromConnectors: ActionMeta[] = [];
        for (const conn of connections) {
            for (const action of conn.actions) {
                fromConnectors.push({
                    slug: 'connector_action',
                    label: action.label,
                    config_schema: {},
                    connector: {
                        connection_id: conn.id,
                        connection_name: conn.name,
                        action_key: action.key,
                        description: action.description,
                        integration_key: conn.integration_key,
                    },
                });
            }
        }
        return { data: [...ACTIONS, ...fromConnectors] };
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

    /** v0.1.288 — «Cancelar espera» de una corrida en pausa (desde el historial). */
    @Post('automations/:id/runs/:runId/cancel')
    @HttpCode(200)
    @RequireCapability('manage_automations')
    cancelRun(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
        @Param('runId', ParseIntPipe) runId: number,
    ): Promise<{ cancelled: boolean }> {
        return this.automations.cancelWaitingRun(req.tenant!.tenantId, id, runId, req.authUserId as number);
    }

    /**
     * v0.1.111 — capturas de prueba del webhook entrante (últimos POST
     * recibidos en la URL pública), para el panel "Probar" del editor.
     */
    @Get('automations/:id/hook-captures')
    @RequireCapability('manage_automations')
    hookCaptures(
        @Req() req: FastifyRequest,
        @Param('id', ParseIntPipe) id: number,
    ): Promise<{ data: HookCapture[] }> {
        return this.automations.hookCaptures(req.tenant!.tenantId, id).then((data) => ({ data }));
    }
}

/** E6 — el historial de los agentes de IA nombra el disparador con este mismo catálogo. */
export { TRIGGERS as AUTOMATION_TRIGGERS };
