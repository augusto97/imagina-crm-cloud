import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlarmClock, AtSign, Bell, CheckCheck, ListChecks, MessageSquare, PenLine, Settings2, UserPlus, type LucideIcon } from 'lucide-react';
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
};

/**
 * v0.1.276 (ADR-S40) — La campana del topbar es la BANDEJA de avisos:
 * menciones, asignaciones, comentarios y cambios en lo que la persona sigue,
 * y sus recordatorios. El "sin leer" vive en el servidor (antes era un
 * timestamp en localStorage de cada dispositivo) y se refresca por realtime.
 */
export function NotificationBell(): JSX.Element {
    const [open, setOpen] = useState(false);
    const [onlyUnread, setOnlyUnread] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const navigate = useNavigate();
    const page = useNotifications(onlyUnread);
    const mark = useMarkNotifications();
    const unread = page.data?.unread ?? 0;
    const items = page.data?.items ?? [];

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const go = (to: string): void => {
        setOpen(false);
        navigate(to);
    };

    const openItem = (n: NotificationDto): void => {
        if (!n.read_at) mark.mutate({ ids: [n.id] });
        if (n.list_slug && n.record_id) go(`/lists/${n.list_slug}/records/${n.record_id}`);
        else go('/my-work');
    };

    return (
        <div ref={containerRef} className="imcrm-relative" data-testid="notification-bell">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label={unread > 0 ? sprintf(__('Avisos: %d sin leer'), unread) : __('Avisos')}
                aria-haspopup="true"
                aria-expanded={open}
                className="imcrm-relative imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            >
                <Bell className="imcrm-h-4 imcrm-w-4" />
                {unread > 0 && (
                    <span
                        className="imcrm-absolute imcrm--right-1 imcrm--top-1 imcrm-flex imcrm-h-4 imcrm-min-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive imcrm-px-1 imcrm-text-[9px] imcrm-font-semibold imcrm-text-destructive-foreground"
                        data-testid="notification-count"
                    >
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="imcrm-fixed imcrm-inset-x-2 imcrm-top-12 imcrm-z-50 imcrm-flex imcrm-max-h-[min(560px,calc(100dvh-4rem))] imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-text-popover-foreground imcrm-shadow-imcrm-lg sm:imcrm-absolute sm:imcrm-inset-x-auto sm:imcrm-right-0 sm:imcrm-top-full sm:imcrm-mt-1 sm:imcrm-w-[400px]"
                    data-testid="notification-panel"
                >
                    <header className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                        <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Avisos')}</h2>
                        <div role="tablist" className="imcrm-ml-2 imcrm-flex imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5 imcrm-text-[11px]">
                            {([false, true] as const).map((u) => (
                                <button
                                    key={String(u)}
                                    type="button"
                                    role="tab"
                                    aria-selected={onlyUnread === u}
                                    onClick={() => setOnlyUnread(u)}
                                    className={cn(
                                        'imcrm-rounded imcrm-px-2 imcrm-py-0.5',
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
                            className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-40"
                            data-testid="notification-read-all"
                        >
                            <CheckCheck className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Marcar todo como leído')}
                        </button>
                    </header>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">
                        {page.isLoading ? (
                            <p className="imcrm-px-3 imcrm-py-4 imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</p>
                        ) : items.length === 0 ? (
                            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1.5 imcrm-px-6 imcrm-py-10 imcrm-text-center">
                                <Bell className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" />
                                <p className="imcrm-text-sm imcrm-font-medium">{onlyUnread ? __('Estás al día') : __('Todavía no hay avisos')}</p>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Te avisamos cuando te mencionen, te asignen un registro o cambie algo que seguís.')}
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
                                                    'imcrm-flex imcrm-w-full imcrm-gap-2.5 imcrm-border-b imcrm-border-border/60 imcrm-px-3 imcrm-py-2.5 imcrm-text-left hover:imcrm-bg-accent',
                                                    !n.read_at && 'imcrm-bg-primary/[0.04]',
                                                )}
                                                data-notification={n.id}
                                                data-unread={n.read_at ? undefined : ''}
                                            >
                                                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                                                    <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
                                                </span>
                                                <span className="imcrm-min-w-0 imcrm-flex-1">
                                                    <span className={cn('imcrm-block imcrm-text-[13px] imcrm-leading-snug', !n.read_at && 'imcrm-font-semibold')}>
                                                        {n.title}
                                                    </span>
                                                    {n.body && (
                                                        <span className="imcrm-mt-0.5 imcrm-line-clamp-2 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{n.body}</span>
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

                    <footer className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                        <button
                            type="button"
                            onClick={() => go('/my-work')}
                            className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium hover:imcrm-bg-accent"
                        >
                            <ListChecks className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Ir a Mi trabajo')}
                        </button>
                        <button
                            type="button"
                            onClick={() => go('/settings?s=avisos')}
                            className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <Settings2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Preferencias')}
                        </button>
                    </footer>
                </div>
            )}
        </div>
    );
}
