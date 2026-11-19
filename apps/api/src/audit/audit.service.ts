import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { desc, eq, lt, and } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { auditLog, users } from '../db/schema';
import { TenantDb } from '../tenancy/tenant-db.service';

/**
 * v0.1.114 — Bitácora de acciones ADMINISTRATIVAS del workspace.
 *
 * Qué se registra: lo que cambia la configuración o DESTRUYE datos (borrar
 * listas/campos, tocar permisos por rol, publicar una lista al mundo, mover
 * miembros, cambiar plan, SMTP o dominio). Los cambios de registros siguen en
 * `activity` — esto es la capa de arriba.
 *
 * Dos reglas de diseño:
 *  - **Nunca rompe la mutación**: si el insert falla, se loguea y se sigue. Una
 *    bitácora caída no puede impedir que el admin trabaje.
 *  - **Se guarda el nombre** (`targetLabel`) al momento de la acción: cuando el
 *    objeto se borra, la entrada sigue siendo legible ("borró la lista
 *    «Clientes»" en vez de "borró la lista 87").
 */

/** Acciones conocidas (string libre en DB para no migrar por cada alta). */
export type AuditAction =
    | 'list.create'
    | 'list.delete'
    | 'list.permissions'
    | 'list.public_enable'
    | 'list.public_disable'
    // A14 (v0.1.445) — duplicados: reglas de la lista y fusiones.
    | 'list.duplicates'
    | 'records.merge'
    // D6 (v0.1.446) — firma electrónica: pedir firmas y anular una solicitud.
    | 'signature.request'
    | 'signature.void'
    // v0.1.275 — formularios públicos (escriben en la lista sin cuenta).
    | 'form.publish'
    | 'form.unpublish'
    | 'form.regenerate_link'
    | 'form.delete'
    | 'form.duplicate'
    // D5 — páginas de agenda públicas (crean citas en la lista sin cuenta).
    | 'booking.publish'
    | 'booking.unpublish'
    | 'booking.regenerate_link'
    | 'booking.delete'
    // v0.1.394 (ADR-S99) — widgets de contacto (el sitio de la empresa los muestra).
    | 'widget.create'
    | 'widget.publish'
    | 'widget.unpublish'
    | 'widget.regenerate_link'
    | 'widget.delete'
    // v0.1.412 (ADR-S103) — tiendas (catálogo público de una lista).
    | 'shop.create'
    | 'shop.publish'
    | 'shop.unpublish'
    | 'shop.regenerate_link'
    | 'shop.delete'
    | 'shop.mark_paid'
    | 'shop.kind_column'
    | 'shop.unit_columns'
    | 'shop.domain_change'
    | 'shop.domain_verified'
    | 'shop.origin_columns'
    | 'shop.resend_downloads'
    | 'shop.variants_create'
    | 'shop.coupon_create'
    | 'shop.coupon_update'
    | 'shop.coupon_delete'
    | 'shop.suspend'
    | 'shop.unsuspend'
    // v0.1.353 — aprobar o rechazar una cita por confirmar.
    | 'booking.approve'
    | 'booking.decline'
    | 'booking.mark_paid'
    // v0.1.289 — verificación anti-robots de un formulario y de la empresa,
    // y la contraseña del portal de clientes.
    | 'form.captcha_on'
    // v0.1.351 — «Mis temas» de los formularios.
    | 'public_theme.create'
    | 'public_theme.update'
    | 'public_theme.delete'
    | 'public_theme.default'
    | 'form.captcha_off'
    | 'workspace.captcha_change'
    | 'workspace.portal_password_on'
    | 'workspace.portal_password_off'
    | 'field.delete'
    | 'field.type_change'
    | 'member.add'
    | 'member.role_change'
    // v0.1.240 — reenviar la invitación a quien no definió su contraseña.
    | 'member.invite_resend'
    | 'member.remove'
    | 'billing.plan_change'
    // v0.1.338 (ADR-S87) — no renovó: pasó al plan de prueba.
    | 'billing.lapse_to_trial'
    | 'workspace.smtp_change'
    | 'workspace.mobile_nav_change'
    | 'workspace.mail_account_change'
    | 'workspace.storage_change'
    | 'workspace.storage_move'
    | 'workspace.domain_change'
    | 'workspace.domain_verified'
    | 'workspace.portal_domain_change'
    | 'workspace.portal_domain_verified'
    | 'import.run'
    | 'list.duplicate'
    | 'template.create'
    | 'template.delete'
    | 'template.apply'
    // C6 / A9 — plantillas de registro y de checklist de una lista.
    | 'record_template.create'
    | 'record_template.update'
    | 'record_template.delete'
    | 'dashboard_template.create'
    | 'dashboard_template.delete'
    | 'dashboard_template.apply'
    | 'automation_template.create'
    | 'automation_template.delete'
    // v0.1.181 (ADR-S21) — el asistente IA: aplicar una propuesta y cambiar
    // la configuración del asistente de la empresa.
    | 'ai.apply'
    | 'workspace.ai_change'
    // v0.1.183 (ADR-S21 fase 3) — tokens de acceso personal (MCP).
    | 'token.create'
    // v0.1.442 — webhooks de eventos (sin el secreto).
    | 'webhook.create'
    | 'webhook.update'
    | 'webhook.delete'
    | 'webhook.rotate_secret'
    | 'token.revoke'
    // v0.1.196 (ADR-S22) — conectores: credenciales de servicios externos.
    // `connection.convert` es la mudanza de un secreto que estaba escrito
    // dentro de una automatización a una conexión cifrada.
    // v0.1.399 — secreto del webhook entrante de una automatización.
    | 'automation.webhook_secret'
    | 'connection.create'
    | 'connection.update'
    | 'connection.delete'
    | 'connection.convert'
    // v0.1.400 — pasó las acciones de otras conexiones (o las llamadas directas a WAS) a una.
    | 'connection.swap'
    // OAuth2 como cliente (v0.1.199): quién autorizó una app externa en nombre
    // de la empresa y quién le cortó el acceso.
    | 'connection.oauth_connect'
    | 'connection.oauth_disconnect'
    // v0.1.206 — sincronización con una tienda (crea listas, trae datos de afuera).
    | 'store_sync.create'
    | 'store_sync.migrate'
    | 'store_sync.update'
    | 'store_sync.delete'
    | 'store_sync.map_meta'
    | 'store_sync.bulk_edit'
    | 'store_sync.create_variations'
    // v0.1.333 (ADR-S83) — sincronización con un sitio WordPress.
    | 'site_sync.create'
    | 'site_sync.update'
    | 'site_sync.delete'
    | 'site_sync.map_column'
    // v0.1.243 — sincronización desde SQL Server (trae datos de una base externa).
    | 'sql_sync.create'
    | 'sql_sync.update'
    | 'sql_sync.delete'
    | 'bulk_edit.revert'
    // v0.1.251 — cobros de la empresa (Mercado Pago / Wompi).
    | 'collections.setup'
    | 'payment_link.create'
    | 'payment_link.cancel'
    // v0.1.367 — suscripciones de la empresa a sus clientes (Mercado Pago).
    | 'subscription_plan.create'
    | 'subscription_plan.update'
    | 'subscription_plan.delete'
    | 'subscription.create'
    | 'subscription.pause'
    | 'subscription.resume'
    | 'subscription.cancel'
    | 'subscription.amount'
    | 'subscriptions.setup'
    // v0.1.371 — el registro de cobros de una lista de suscriptores.
    | 'subscriptions.charge_log'
    | 'subscriptions.import'
    | 'subscriptions.import_auto'
    // v0.1.266 — plantillas de documentos PDF.
    | 'document_template.create'
    | 'document_template.update'
    | 'document_template.delete'
    // v0.1.290 — «Anular y emitir de nuevo» un documento emitido.
    | 'document.reissue'
    // v0.1.292 (ADR-S50) — un tablero hacia afuera: enlace público sin sesión
    // y envíos programados por correo (también a direcciones externas).
    | 'dashboard.public_enable'
    | 'dashboard.public_disable'
    | 'dashboard.public_regenerate'
    | 'dashboard.subscription_create'
    | 'dashboard.subscription_update'
    | 'dashboard.subscription_delete'
    // Papelera: devolver algo a la vida, borrarlo para siempre a mano y
    // vaciarla entera (el barrido automático de los 30 días no deja rastro
    // por cada cosa: deja uno por corrida).
    | 'trash.restore'
    | 'trash.purge'
    | 'trash.empty'
    // Autorización de tratamiento de datos (Ley 1581): el texto, sus
    // versiones, un retiro que registra la empresa y la descarga de la
    // evidencia (lleva correos e IP de los titulares).
    | 'data_consent.update'
    | 'data_consent.version'
    | 'data_consent.withdraw_admin'
    | 'data_consent.export'
    // A8/B1 — reprogramación por dependencias (ajuste de la lista) y línea base del Gantt.
    | 'list.dependencies_settings'
    | 'gantt.baseline_save'
    | 'gantt.baseline_delete'
    // B2 — capacidad de una persona en la vista «Carga de trabajo».
    | 'workload.capacity'
    // C5 — flujos de aprobación de una lista (quién aprueba y qué se pone al resolver).
    | 'approval_flow.create'
    | 'approval_flow.update'
    | 'approval_flow.delete'
    // C1 — equipos.
    | 'team.create'
    | 'team.update'
    | 'team.delete'
    // C2 — roles propios.
    | 'role.create'
    | 'role.update'
    | 'role.delete'
    // C3 — invitados externos: compartir una lista o un registro con alguien
    // de afuera, cambiarle el nivel, quitárselo o pasarlo a miembro.
    | 'guest.share_list'
    | 'guest.share_record'
    | 'guest.level_change'
    | 'guest.unshare'
    | 'guest.remove'
    | 'guest.promote'
    // D3 — WhatsApp oficial: dónde caen los mensajes, columnas de la lista y
    // suscribir la app de Meta a la cuenta.
    | 'whatsapp.config'
    | 'whatsapp.columns'
    | 'whatsapp.subscribe'
    // SMS (ADR-S82): envío a una selección y columnas de estado de la lista.
    | 'sms.bulk'
    | 'sms.columns'
    // D2/E5 — mesa de ayuda: el buzón de la lista (credencial) y sus ajustes (mapeo, SLA).
    | 'helpdesk.mailbox_connect'
    | 'helpdesk.mailbox_update'
    | 'helpdesk.mailbox_delete'
    | 'helpdesk.settings'
    // E6 — agentes de IA.
    | 'ai_agent.create'
    | 'ai_agent.update'
    | 'ai_agent.delete'
    | 'ai_agent.trigger_add'
    // v0.1.456 (ADR-S109) — un agente corrido en lote sobre registros existentes.
    | 'ai_agent.batch'
    // F7 (ADR-S72) — «Empezar fácil»: el pedido único a la IA (con su
    // consentimiento en línea), lo que se creó con la bienvenida y el borrado
    // de los datos de ejemplo.
    | 'onboarding.ai_request'
    | 'onboarding.apply'
    | 'onboarding.samples_delete'
    // v0.1.339 (ADR-S88) — «Crear desde un archivo»: el análisis con IA (con
    // su consentimiento en línea) y las listas creadas.
    | 'file_import.ai_request'
    | 'file_import.apply'
    // v0.1.458 — «Importar de Airtable»: las listas creadas (nunca el token).
    | 'airtable_import.apply'
    // v0.1.341 (ADR-S89) — sugerencias por lista: el análisis con IA (con su
    // consentimiento en línea), lo aplicado y el modo de la empresa.
    | 'list_suggestions.ai_request'
    | 'list_suggestion.apply'
    | 'list_suggestions.mode'
    // I3 (v0.1.449, ADR-S108) — modo agencia. En la bitácora del CLIENTE:
    // quién de la agencia lo creó, entró (`agency.access`, a lo sumo una vez
    // por hora y persona), lo pausó o lo reactivó, y si el operador lo
    // vinculó o desvinculó. En la de la AGENCIA: el alta del cliente.
    | 'agency.client_create'
    | 'agency.client_rename'
    | 'agency.client_pause'
    | 'agency.client_resume'
    | 'agency.enter'
    | 'agency.access'
    | 'agency.support'
    | 'agency.billing'
    | 'agency.client_billing'
    | 'agency.payment'
    | 'agency.payment_undo'
    | 'agency.charge_create'
    | 'agency.charge_cancel'
    | 'agency.debit_start'
    | 'agency.debit_cancel'
    | 'agency.clients_list'
    | 'agency.link'
    | 'agency.unlink'
    | 'agency.settings';

export interface AuditEntryDto {
    id: number;
    action: string;
    target_type: string;
    target_id: number | null;
    target_label: string;
    meta: Record<string, unknown>;
    user_id: number | null;
    user_name: string | null;
    created_at: string;
}

export interface AuditParams {
    tenantId: number;
    userId: number | null;
    action: AuditAction;
    targetType?: string;
    targetId?: number | null;
    targetLabel?: string;
    meta?: Record<string, unknown>;
}

const MAX_LIMIT = 100;

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(private readonly tenantDb: TenantDb) {}

    /** Registra dentro de un tx existente (atómico con la mutación). */
    logInTx(tx: Tx, params: AuditParams): Promise<unknown> {
        return tx
            .insert(auditLog)
            .values({
                tenantId: params.tenantId,
                userId: params.userId,
                action: params.action,
                targetType: params.targetType ?? '',
                targetId: params.targetId ?? null,
                targetLabel: params.targetLabel ?? '',
                meta: params.meta ?? {},
            })
            .catch((err: unknown) => {
                // Best-effort: no tumbar la mutación por la bitácora.
                this.logger.warn(
                    `No se pudo registrar ${params.action}: ${err instanceof Error ? err.message : String(err)}`,
                );
            });
    }

    /** Registra fuera de un tx (abre el suyo con el scope del tenant). */
    async log(params: AuditParams): Promise<void> {
        try {
            await this.tenantDb.withTenant(params.tenantId, (tx) => this.logInTx(tx, params));
        } catch (err) {
            this.logger.warn(
                `No se pudo registrar ${params.action}: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    /** Feed del workspace, más reciente primero (cursor keyset por id). */
    async list(
        tenantId: number,
        opts: { limit?: number; cursor?: number } = {},
    ): Promise<{ data: AuditEntryDto[]; meta: { next_cursor: string | null } }> {
        const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIMIT);
        const rows = await this.tenantDb.withTenant(tenantId, (tx) =>
            tx
                .select({
                    id: auditLog.id,
                    action: auditLog.action,
                    targetType: auditLog.targetType,
                    targetId: auditLog.targetId,
                    targetLabel: auditLog.targetLabel,
                    meta: auditLog.meta,
                    userId: auditLog.userId,
                    userName: users.name,
                    createdAt: auditLog.createdAt,
                })
                .from(auditLog)
                .leftJoin(users, eq(users.id, auditLog.userId))
                .where(
                    opts.cursor
                        ? and(eq(auditLog.tenantId, tenantId), lt(auditLog.id, opts.cursor))
                        : eq(auditLog.tenantId, tenantId),
                )
                .orderBy(desc(auditLog.id))
                .limit(limit + 1),
        );
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        return {
            data: page.map((r) => ({
                id: r.id,
                action: r.action,
                target_type: r.targetType,
                target_id: r.targetId,
                target_label: r.targetLabel,
                meta: r.meta,
                user_id: r.userId,
                user_name: r.userName ?? null,
                created_at: r.createdAt.toISOString(),
            })),
            meta: { next_cursor: hasMore ? String(page[page.length - 1]!.id) : null },
        };
    }
}

/**
 * Global: la bitácora se escribe desde muchos módulos (lists, fields, members,
 * billing, workspaces, import) y no aporta nada importarla en cada uno.
 */
@Global()
@Module({
    providers: [AuditService],
    exports: [AuditService],
})
export class AuditModule {}
