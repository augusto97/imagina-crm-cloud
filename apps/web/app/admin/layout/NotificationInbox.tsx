import { useState } from 'react';
import { useNavigate } from 'react-router';
import { AlarmClock, AtSign, Bell, Bot, CheckCheck, ClipboardCheck, ListChecks, MessageSquare, PenLine, Reply, Scale, Settings2, Timer, TriangleAlert, UserPlus, Users, type LucideIcon } from 'lucide-react';
import type { NotificationDto, NotificationKind } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { useMarkNotifications, useNotifications } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
    mention: AtSign,
    assigned: UserPlus,
    comment: MessageSquare,
    update: PenLine,
    reminder: AlarmClock,
    failure: TriangleAlert,
    reply: Reply,
    consent: Scale,
    // C5 — te toca aprobar, o se resolvió lo que pediste.
    approval: ClipboardCheck,
    team_assigned: Users,
    // E5 — un ticket de la mesa de ayuda en riesgo o vencido.
    sla: Timer,
    // E6 — un agente de IA propone cambios que revisas.
    agent: Bot,
};

/** A dónde lleva cada aviso al abrirlo. */
export function notificationTarget(n: NotificationDto): string {
    // v0.1.285 — una falla lleva a la página de Problemas (ahí está a dónde ir a arreglarla).
    if (n.kind === 'failure') return '/settings?s=problemas';
    // Ley 1581 — un retiro sin registro (p. ej. desde el portal) lleva a la evidencia.
    if (n.kind === 'consent' && !(n.list_slug && n.record_id)) return '/settings?s=privacidad';
    if (n.list_slug && n.record_id) return `/lists/${n.list_slug}/records/${n.record_id}`;
    return '/my-work';
}

/**
 * v0.1.276 (ADR-S40) — La BANDEJA de avisos: menciones, asignaciones,
 * comentarios y cambios en lo que la persona sigue, y sus recordatorios.
 * v0.1.342 — extraída de la campana: en escritorio se ve en el desplegable
 * de la campana (`variant="popover"`) y en el celular es la pestaña
 * **Avisos** de la barra de abajo, a pantalla completa (`variant="page"`).
 */
export function NotificationInbox({
    variant,
    onNavigate,
}: {
    variant: 'popover' | 'page';
    /** Antes de navegar (el desplegable se cierra). */
    onNavigate?: () => void;
}): JSX.Element {
    const [onlyUnread, setOnlyUnread] = useState(false);
    const navigate = useNavigate();
    const page = useNotifications(onlyUnread);
    const all = useNotifications(false);
    const mark = useMarkNotifications();
    // El contador de «sin leer» sale siempre de la página completa (el filtro
    // de sin leer también lo trae, pero así no parpadea al cambiar de pestaña).
    const unread = all.data?.unread ?? page.data?.unread ?? 0;
    const items = page.data?.items ?? [];
    const isPage = variant === 'page';

    const go = (to: string): void => {
        onNavigate?.();
        navigate(to);
    };

    const openItem = (n: NotificationDto): void => {
        if (!n.read_at) mark.mutate({ ids: [n.id] });
        go(notificationTarget(n));
    };

    return (
        <div className={cn('imcrm-flex imcrm-min-h-0 imcrm-flex-col', isPage ? 'imcrm-flex-1' : 'imcrm-max-h-[inherit] imcrm-flex-1')} data-testid={isPage ? 'inbox-page' : undefined}>
            <header
                className={cn(
                    'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border',
                    isPage ? 'imcrm-px-1 imcrm-pb-3' : 'imcrm-px-3 imcrm-py-2',
                )}
            >
                {isPage ? (
                    <h1 className="imcrm-mr-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        <Bell className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" aria-hidden />
                        {__('Avisos')}
                    </h1>
                ) : (
                    <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Avisos')}</h2>
                )}
                <div role="tablist" className={cn('imcrm-flex imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5', isPage ? 'imcrm-order-last imcrm-w-full imcrm-text-[13px]' : 'imcrm-ml-2 imcrm-text-[11px]')}>
                    {([false, true] as const).map((u) => (
                        <button
                            key={String(u)}
                            type="button"
                            role="tab"
                            aria-selected={onlyUnread === u}
                            onClick={() => setOnlyUnread(u)}
                            className={cn(
                                'imcrm-rounded',
                                isPage ? 'imcrm-flex-1 imcrm-px-3 imcrm-py-1.5' : 'imcrm-px-2 imcrm-py-0.5',
                                onlyUnread === u ? 'imcrm-bg-background imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground',
                            )}
                        >
                            {u ? sprintf(__('Sin leer (%d)'), unread) : __('Todos')}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    disabled={unread === 0 || mark.isPending}
                    onClick={() => mark.mutate({ all: true })}
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-40',
                        isPage ? 'imcrm-px-2 imcrm-py-1.5 imcrm-text-[13px]' : 'imcrm-ml-auto imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px]',
                    )}
                    data-testid="notification-read-all"
                >
                    <CheckCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                    {isPage ? __('Marcar todo leído') : __('Marcar todo como leído')}
                </button>
            </header>

            <div className={cn('imcrm-min-h-0 imcrm-flex-1', !isPage && 'imcrm-overflow-y-auto')}>
                {page.isLoading ? (
                    <p className="imcrm-px-3 imcrm-py-4 imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>
                ) : items.length === 0 ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5 imcrm-px-6 imcrm-py-10 imcrm-text-center">
                        <Bell className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" />
                        <p className="imcrm-text-sm imcrm-font-medium">{onlyUnread ? __('Estás al día') : __('Todavía no hay avisos')}</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Te avisamos cuando te mencionen, te asignen un registro o cambie algo que sigues.')}
                        </p>
                    </div>
                ) : (
                    <ul>
                        {items.map((n) => {
                            const Icon = KIND_ICON[n.kind] ?? Bell;
                            return (
                                <li key={n.id}>
                                    <button
                                        type="button"
                                        onClick={() => openItem(n)}
                                        className={cn(
                                            'imcrm-flex imcrm-w-full imcrm-gap-2.5 imcrm-border-b imcrm-border-border/60 imcrm-text-left hover:imcrm-bg-accent',
                                            isPage ? 'imcrm-px-2 imcrm-py-3' : 'imcrm-px-3 imcrm-py-2.5',
                                            !n.read_at && 'imcrm-bg-primary/[0.04]',
                                        )}
                                        data-notification={n.id}
                                        data-unread={n.read_at ? undefined : ''}
                                    >
                                        <span
                                            className={cn(
                                                'imcrm-mt-0.5 imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                                                isPage ? 'imcrm-h-9 imcrm-w-9' : 'imcrm-h-7 imcrm-w-7',
                                                n.kind === 'failure' || n.kind === 'consent'
                                                    ? 'imcrm-bg-destructive/10 imcrm-text-destructive'
                                                    : 'imcrm-bg-muted imcrm-text-muted-foreground',
                                            )}
                                        >
                                            <Icon className={isPage ? 'imcrm-h-4 imcrm-w-4' : 'imcrm-h-3.5 imcrm-w-3.5'} />
                                        </span>
                                        <span className="imcrm-min-w-0 imcrm-flex-1">
                                            <span
                                                className={cn(
                                                    'imcrm-block imcrm-leading-snug',
                                                    isPage ? 'imcrm-text-[14px]' : 'imcrm-text-[13px]',
                                                    !n.read_at && 'imcrm-font-semibold',
                                                )}
                                            >
                                                {n.title}
                                            </span>
                                            {n.body && (
                                                <span className={cn('imcrm-mt-0.5 imcrm-line-clamp-2 imcrm-block imcrm-text-muted-foreground', isPage ? 'imcrm-text-[13px]' : 'imcrm-text-xs')}>
                                                    {n.body}
                                                </span>
                                            )}
                                            <span
                                                className="imcrm-mt-1 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground"
                                                title={formatDateTime(parseUtcDate(n.created_at))}
                                            >
                                                {relativeTime(n.created_at)}
                                                {n.list_name ? ` · ${n.list_name}` : ''}
                                            </span>
                                        </span>
                                        {!n.read_at && <span className="imcrm-mt-2 imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary" aria-label={__('Sin leer')} />}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            <footer
                className={cn(
                    'imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-t imcrm-border-border',
                    isPage ? 'imcrm-mt-2 imcrm-gap-2 imcrm-px-0 imcrm-py-2' : 'imcrm-px-2 imcrm-py-1.5',
                )}
            >
                <button
                    type="button"
                    onClick={() => go('/my-work')}
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-font-medium hover:imcrm-bg-accent',
                        isPage ? 'imcrm-px-2 imcrm-py-2 imcrm-text-[13px]' : 'imcrm-px-2 imcrm-py-1 imcrm-text-xs',
                    )}
                >
                    <ListChecks className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ir a Mi trabajo')}
                </button>
                <button
                    type="button"
                    onClick={() => go('/settings?s=avisos')}
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        isPage ? 'imcrm-px-2 imcrm-py-2 imcrm-text-[13px]' : 'imcrm-px-2 imcrm-py-1 imcrm-text-xs',
                    )}
                >
                    <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Preferencias')}
                </button>
            </footer>
        </div>
    );
}

/** v0.1.342 — `/avisos`: la bandeja a pantalla completa (la pestaña del celular). */
export function InboxPage(): JSX.Element {
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-2xl imcrm-flex-col imcrm-pt-1">
            <NotificationInbox variant="page" />
        </div>
    );
}
