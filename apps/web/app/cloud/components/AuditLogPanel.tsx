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
    'list.permissions': { text: 'cambió los permisos de' },
    'list.public_enable': { text: 'publicó al público la lista', danger: true },
    'list.public_disable': { text: 'despublicó la lista' },
    'field.delete': { text: 'borró el campo', danger: true },
    'field.type_change': { text: 'cambió el tipo del campo', danger: true },
    'member.add': { text: 'agregó al workspace a' },
    'member.role_change': { text: 'cambió el rol de' },
    'member.remove': { text: 'quitó del workspace a', danger: true },
    'billing.plan_change': { text: 'cambió el plan' },
    'workspace.smtp_change': { text: 'cambió el correo (SMTP)' },
    'workspace.domain_change': { text: 'cambió el dominio' },
    'import.run': { text: 'importó datos a' },
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
                    {__('Quién cambió la configuración del workspace o borró datos. Los cambios de registros se ven en la actividad de cada ficha.')}
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
