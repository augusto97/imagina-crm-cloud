import { useState } from 'react';
import { Link } from 'react-router';
import {
    Bot,
    CalendarClock,
    ChartColumn,
    CircleCheck,
    ClipboardList,
    CreditCard,
    Database,
    Globe,
    Inbox,
    Mail,
    Plug,
    Repeat,
    ShoppingBag,
    Sparkles,
    TriangleAlert,
    Zap,
    type LucideIcon,
} from 'lucide-react';

import { INCIDENT_SOURCE_LABELS, incidentLink, type IncidentDto, type IncidentSource } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ViewSwitch } from '@/components/ui/view-switch';
import { useIncidents, useResolveIncident } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';

const SOURCE_ICON: Record<IncidentSource, LucideIcon> = {
    automation: Zap,
    mail: Mail,
    connection: Plug,
    sql_sync: Database,
    store_sync: ShoppingBag,
    // v0.1.333 — un sitio WordPress sincronizado.
    site_sync: Globe,
    ai_field: Sparkles,
    form: ClipboardList,
    recurrence: Repeat,
    collections: CreditCard,
    dashboard: ChartColumn,
    booking: CalendarClock,
    // D2 — el buzón de soporte de una lista.
    helpdesk: Inbox,
    ai_agent: Bot,
};

/**
 * v0.1.285 (ADR-S44) — Ajustes → Problemas: lo que corre solo y dejó de
 * funcionar (automatizaciones, correo, conectores, sincronizaciones…). Cada
 * problema dice qué pasó, cuántas veces, y lleva a donde se arregla. Se
 * cierran solos cuando lo que fallaba vuelve a funcionar; «Ya lo arreglé» lo
 * cierra a mano (si vuelve a fallar, se abre otro y se avisa de nuevo).
 */
export function IncidentsPanel(): JSX.Element {
    const [status, setStatus] = useState<'open' | 'resolved'>('open');
    const q = useIncidents(status);
    const items = q.data?.items ?? [];

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="incidents-panel">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-min-w-0">
                    <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__(
                            'Lo que corre solo y dejó de funcionar: automatizaciones, el correo de la empresa, conectores y sincronizaciones. Te avisamos en la campana y por correo apenas pasa, y se cierra solo cuando vuelve a funcionar.',
                        )}
                    </p>
                </div>
                <ViewSwitch
                    label={__('Mostrar')}
                    value={status}
                    onChange={setStatus}
                    testId="incidents-status"
                    options={[
                        { value: 'open', label: q.data && status === 'open' ? sprintf(__('Abiertos (%d)'), q.data.open) : __('Abiertos') },
                        { value: 'resolved', label: __('Resueltos') },
                    ]}
                />
            </div>

            {q.isLoading ? (
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
            ) : q.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar los problemas.')}</p>
            ) : items.length === 0 ? (
                <div
                    className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    data-testid="incidents-empty"
                >
                    <CircleCheck className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-emerald-600" />
                    <p className="imcrm-text-sm">
                        {status === 'open'
                            ? __('Todo está funcionando: no hay problemas abiertos.')
                            : __('Todavía no se resolvió ningún problema.')}
                    </p>
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {items.map((i) => (
                        <IncidentItem key={i.id} incident={i} />
                    ))}
                </ul>
            )}
        </section>
    );
}

function IncidentItem({ incident: i }: { incident: IncidentDto }): JSX.Element {
    const resolve = useResolveIncident();
    const toast = useToast();
    const Icon = SOURCE_ICON[i.source] ?? TriangleAlert;
    const open = i.resolved_at === null;

    return (
        <li
            className="imcrm-flex imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
            data-incident={i.id}
            data-source={i.source}
        >
            <span
                className={
                    open
                        ? 'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive/10 imcrm-text-destructive'
                        : 'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground'
                }
            >
                <Icon className="imcrm-h-4 imcrm-w-4" />
            </span>
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                    <Badge variant="secondary">{__(INCIDENT_SOURCE_LABELS[i.source] ?? i.source)}</Badge>
                    {i.list_name && <span className="imcrm-text-xs imcrm-text-muted-foreground">{i.list_name}</span>}
                </div>
                <p className="imcrm-mt-1.5 imcrm-text-sm imcrm-font-semibold">{i.title}</p>
                <p className="imcrm-mt-1 imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-sm imcrm-text-muted-foreground">{i.message}</p>
                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-muted-foreground" title={formatDateTimeStr(i.last_at)}>
                    {i.count > 1
                        ? sprintf(__('Falló %1$d veces · la primera %2$s · la última %3$s'), i.count, relativeTime(i.first_at), relativeTime(i.last_at))
                        : sprintf(__('Falló %s'), relativeTime(i.last_at))}
                    {!open &&
                        ` · ${
                            i.resolved_by_name
                                ? sprintf(__('%1$s lo marcó resuelto %2$s'), i.resolved_by_name, relativeTime(i.resolved_at!))
                                : sprintf(__('se resolvió solo %s'), relativeTime(i.resolved_at!))
                        }`}
                </p>
                {open && (
                    <div className="imcrm-mt-3 imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button asChild size="sm">
                            <Link to={incidentLink(i)} data-testid="incident-fix">
                                {__('Ir a arreglarlo')}
                            </Link>
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={resolve.isPending}
                            data-testid="incident-resolve"
                            onClick={() =>
                                resolve.mutate(i.id, {
                                    onError: (err) =>
                                        toast.error(__('No se pudo marcar como resuelto'), err instanceof Error ? err.message : String(err)),
                                })
                            }
                        >
                            {__('Ya lo arreglé')}
                        </Button>
                    </div>
                )}
            </div>
        </li>
    );
}
