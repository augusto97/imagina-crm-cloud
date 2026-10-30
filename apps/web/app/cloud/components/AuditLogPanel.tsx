import { useQuery } from '@tanstack/react-query';
import { History, ShieldAlert } from 'lucide-react';

import type { AuditEntry } from '@imagina-base/shared';

import { api, activeMembership, useSession } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

/**
 * v0.1.114 — "Registro de actividad": bitácora de las acciones
 * ADMINISTRATIVAS del workspace (quién borró una lista o un campo, quién tocó
 * los permisos, quién publicó una lista al mundo, quién movió miembros o
 * cambió plan/SMTP/dominio).
 *
 * Los cambios de REGISTROS siguen viéndose en la actividad de cada ficha —
 * esto es la capa de arriba, la que antes no dejaba ningún rastro.
 */

/** Acción → frase en español + si es destructiva (se marca en rojo). */
const ACTION_META: Record<string, { text: string; danger?: boolean }> = {
    'list.create': { text: 'creó la lista' },
    'list.delete': { text: 'borró la lista', danger: true },
    'list.duplicate': { text: 'duplicó una lista como' },
    'template.create': { text: 'guardó la plantilla' },
    'template.delete': { text: 'borró la plantilla', danger: true },
    'template.apply': { text: 'creó desde una plantilla la lista' },
    // F7 — bienvenida de una empresa nueva.
    'onboarding.ai_request': { text: 'aceptó enviar la descripción de su negocio a la IA para armar el espacio' },
    'onboarding.apply': { text: 'armó el espacio con la bienvenida:' },
    'onboarding.samples_delete': { text: 'borró los datos de ejemplo de' },
    // C6 — plantillas de registro (y de checklist) de una lista.
    'record_template.create': { text: 'creó la plantilla de registro' },
    'record_template.update': { text: 'cambió la plantilla de registro' },
    'record_template.delete': { text: 'borró la plantilla de registro', danger: true },
    'dashboard_template.create': { text: 'guardó la plantilla de dashboard' },
    'dashboard_template.delete': { text: 'borró la plantilla de dashboard', danger: true },
    'dashboard_template.apply': { text: 'creó desde una plantilla el dashboard' },
    'automation_template.create': { text: 'guardó la plantilla de automatización' },
    'automation_template.delete': { text: 'borró la plantilla de automatización', danger: true },
    'list.permissions': { text: 'cambió los permisos de' },
    'list.public_enable': { text: 'publicó al público la lista', danger: true },
    'form.publish': { text: 'publicó el formulario', danger: true },
    'form.unpublish': { text: 'dejó de publicar el formulario' },
    'form.regenerate_link': { text: 'cambió la dirección del formulario' },
    'form.delete': { text: 'eliminó el formulario', danger: true },
    'booking.publish': { text: 'publicó la agenda de citas', danger: true },
    'booking.unpublish': { text: 'dejó de publicar la agenda de citas' },
    'booking.regenerate_link': { text: 'cambió la dirección de la agenda de citas' },
    'booking.delete': { text: 'eliminó la agenda de citas', danger: true },
    'form.captcha_on': { text: 'activó la verificación anti-robots en el formulario' },
    'form.captcha_off': { text: 'quitó la verificación anti-robots del formulario', danger: true },
    'workspace.captcha_change': { text: 'cambió las llaves de captcha:' },
    'workspace.portal_password_on': { text: 'permitió entrar al portal con contraseña', danger: true },
    'workspace.portal_password_off': { text: 'quitó la entrada al portal con contraseña' },
    'list.public_disable': { text: 'despublicó la lista' },
    // v0.1.292 (ADR-S50) — tableros hacia afuera.
    'dashboard.public_enable': { text: 'publicó con un enlace público el tablero', danger: true },
    'dashboard.public_disable': { text: 'dejó de publicar el tablero' },
    'dashboard.public_regenerate': { text: 'cambió la dirección pública del tablero' },
    'dashboard.subscription_create': { text: 'programó un envío por correo del tablero', danger: true },
    'dashboard.subscription_update': { text: 'cambió un envío por correo del tablero' },
    'dashboard.subscription_delete': { text: 'eliminó un envío por correo del tablero' },
    'field.delete': { text: 'borró el campo', danger: true },
    'field.type_change': { text: 'cambió el tipo del campo', danger: true },
    'member.add': { text: 'agregó al workspace a' },
    // C1 — equipos.
    'team.create': { text: 'creó el equipo' },
    'team.update': { text: 'cambió el equipo' },
    'team.delete': { text: 'borró el equipo', danger: true },
    // C2 — roles propios.
    'role.create': { text: 'creó el rol' },
    'role.update': { text: 'cambió el rol' },
    'role.delete': { text: 'borró el rol', danger: true },
    // C3 — invitados externos.
    'guest.share_list': { text: 'compartió con un invitado la lista', danger: true },
    'guest.share_record': { text: 'compartió con un invitado el registro', danger: true },
    'guest.level_change': { text: 'cambió el acceso del invitado' },
    'guest.unshare': { text: 'le quitó el acceso al invitado' },
    'guest.remove': { text: 'quitó al invitado', danger: true },
    'guest.promote': { text: 'pasó a miembro al invitado' },
    'member.invite_resend': { text: 'reenvió la invitación a' },
    'member.role_change': { text: 'cambió el rol de' },
    // B2 — capacidad de una persona en la carga de trabajo.
    'workload.capacity': { text: 'cambió la capacidad de trabajo de' },
    'member.remove': { text: 'quitó del workspace a', danger: true },
    'billing.plan_change': { text: 'cambió el plan' },
    'billing.lapse_to_trial': { text: 'pasó al plan de prueba por no renovar' },
    'workspace.smtp_change': { text: 'cambió el correo (SMTP)' },
    'workspace.mail_account_change': { text: 'cambió la cuenta de envío del correo' },
    'workspace.storage_change': { text: 'cambió dónde se guardan los archivos' },
    'workspace.storage_move': { text: 'movió archivos de almacenamiento' },
    'workspace.domain_change': { text: 'cambió el dominio' },
    'workspace.domain_verified': { text: 'verificó el dominio' },
    'workspace.portal_domain_change': { text: 'cambió el dominio del portal' },
    'workspace.portal_domain_verified': { text: 'verificó el dominio del portal' },
    'import.run': { text: 'importó datos a' },
    'document.reissue': { text: 'anuló y volvió a emitir el documento', danger: true },
    'store_sync.create': { text: 'activó la sincronización de la tienda' },
    'store_sync.migrate': { text: 'reorganizó las listas de la tienda (variaciones y líneas como subtareas)' },
    'store_sync.update': { text: 'cambió la sincronización de la tienda' },
    'store_sync.delete': { text: 'desactivó la sincronización de la tienda', danger: true },
    'store_sync.map_meta': { text: 'trajo un campo de la tienda a' },
    // v0.1.333 — sitios WordPress.
    'site_sync.create': { text: 'activó la sincronización del sitio' },
    'site_sync.update': { text: 'cambió la sincronización del sitio' },
    'site_sync.delete': { text: 'desactivó la sincronización del sitio', danger: true },
    'site_sync.map_column': { text: 'trajo una columna del sitio a' },
    // D3 — WhatsApp oficial.
    'whatsapp.config': { text: 'cambió dónde caen los mensajes de WhatsApp de' },
    'whatsapp.columns': { text: 'cambió las columnas de WhatsApp de la lista' },
    'whatsapp.subscribe': { text: 'suscribió a los avisos de Meta la cuenta de WhatsApp' },
};

function describe(entry: AuditEntry): { text: string; danger: boolean } {
    const meta = ACTION_META[entry.action];
    return { text: meta?.text ?? entry.action, danger: meta?.danger ?? false };
}

/** Detalle corto del `meta` cuando aporta (rol nuevo, tipos, dominios…). */
function metaHint(entry: AuditEntry): string {
    const m = entry.meta ?? {};
    if (typeof m.role === 'string') return `${__('rol')}: ${m.role}`;
    if (typeof m.from === 'string' && typeof m.to === 'string') return `${m.from} → ${m.to}`;
    if (Array.isArray(m.roles) && m.roles.length > 0) return `${__('roles')}: ${m.roles.join(', ')}`;
    if (Array.isArray(m.domains) && m.domains.length > 0) return String(m.domains.join(', '));
    if (typeof m.host === 'string') return m.host;
    return '';
}

export function AuditLogPanel(): JSX.Element | null {
    const tenantId = useSession((s) => s.activeTenantId);
    const isAdmin = activeMembership()?.role === 'admin';
    const query = useQuery({
        queryKey: ['workspace-audit', tenantId],
        queryFn: async () => (await api.getAuditLog(50)).data,
        enabled: isAdmin,
        staleTime: 30_000,
        retry: false,
    });

    // Se auto-oculta si el backend responde 403 (no admin) — mismo patrón que
    // el resto de los paneles gateados.
    if (!isAdmin || query.isError) return null;

    const entries = query.data ?? [];

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div>
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                    <History className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Registro de actividad')}
                </h2>
                <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Quién cambió la configuración de la empresa o borró datos. Los cambios de registros se ven en la actividad de cada ficha.')}
                </p>
            </div>

            {query.isLoading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : entries.length === 0 ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Todavía no hay acciones registradas.')}
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    {entries.map((entry) => {
                        const { text, danger } = describe(entry);
                        const hint = metaHint(entry);
                        return (
                            <li key={entry.id} className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-px-4 imcrm-py-2.5">
                                {danger && (
                                    <ShieldAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-destructive" />
                                )}
                                <div className="imcrm-min-w-0 imcrm-flex-1">
                                    <p className="imcrm-text-sm imcrm-text-foreground">
                                        <strong className="imcrm-font-medium">
                                            {entry.user_name ?? __('Sistema')}
                                        </strong>{' '}
                                        {__(text)}{' '}
                                        {entry.target_label !== '' && (
                                            <span className="imcrm-font-medium">«{entry.target_label}»</span>
                                        )}
                                    </p>
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {formatDateTimeStr(entry.created_at)}
                                        {hint !== '' ? ` · ${hint}` : ''}
                                    </p>
                                </div>
                                {danger && (
                                    <Badge variant="secondary" className="imcrm-shrink-0 imcrm-text-[10px]">
                                        {__('destructiva')}
                                    </Badge>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
