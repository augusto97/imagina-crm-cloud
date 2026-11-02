import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';

import { useNotifications } from '@/hooks/useNotifications';
import { __, sprintf } from '@/lib/i18n';

import { NotificationInbox } from './NotificationInbox';

/**
 * v0.1.276 (ADR-S40) — La campana del topbar es la BANDEJA de avisos:
 * menciones, asignaciones, comentarios y cambios en lo que la persona sigue,
 * y sus recordatorios. El "sin leer" vive en el servidor (antes era un
 * timestamp en localStorage de cada dispositivo) y se refresca por realtime.
 * v0.1.342 — el contenido es `NotificationInbox`, el mismo de la pestaña
 * **Avisos** del celular.
 */
export function NotificationBell(): JSX.Element {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const page = useNotifications(false);
    const unread = page.data?.unread ?? 0;

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

    return (
        <div ref={containerRef} className="imcrm-relative" data-testid="notification-bell" data-tour="topbar-notifications">
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
                    <NotificationInbox variant="popover" onNavigate={() => setOpen(false)} />
                </div>
            )}
        </div>
    );
}
