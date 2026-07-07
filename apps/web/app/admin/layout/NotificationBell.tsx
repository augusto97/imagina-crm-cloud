import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';

import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ActivityEntity } from '@/types/activity';

const SEEN_AT_KEY = 'imcrm:mentions-seen-at';

/**
 * Notification bell para el topbar. Consume `/me/mentions` y muestra
 * un badge con el número de menciones nuevas desde la última vez que
 * el usuario abrió el panel.
 *
 * "Visto" es client-side (localStorage). No persistimos read state en
 * el backend porque (a) no quiero introducir una tabla más en este
 * commit y (b) per-device es razonable para esta UX. La semántica:
 * "no leídas" = mentions con created_at > seen_at_local.
 */
export function NotificationBell(): JSX.Element {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [seenAt, setSeenAt] = useState<number>(() => readSeenAt());

    const mentions = useQuery({
        queryKey: ['me-mentions'],
        queryFn: async () => {
            const res = await api.get<ActivityEntity[]>('/me/mentions', {
                query: { limit: 20 },
            });
            return res.data;
        },
        // 0.36.7: subimos a 5 minutos. Las menciones no son chat
        // real-time; con 60s eran 60 fetches/hora dejando la app
        // abierta — peso desproporcionado al uso real. TanStack Query
        // ya pausa polling cuando la pestaña está en background
        // (`refetchIntervalInBackground: false` default), así que con
        // 5 min en foreground el costo es razonable.
        refetchInterval: 5 * 60 * 1000,
        staleTime: 60 * 1000,
    });

    const items = mentions.data ?? [];
    const unread = items.filter((m) => {
        const ts = m.created_at ? Date.parse(m.created_at + 'Z') : 0;
        return ts > seenAt;
    }).length;

    // Click fuera cierra.
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [open]);

    const handleOpen = (): void => {
        setOpen((o) => {
            const willOpen = !o;
            if (willOpen) {
                // Al abrir, marcamos como visto el "ahora".
                const now = Date.now();
                setSeenAt(now);
                writeSeenAt(now);
            }
            return willOpen;
        });
    };

    return (
        <div ref={containerRef} className="imcrm-relative">
            <button
                type="button"
                onClick={handleOpen}
                aria-label={__('Notificaciones')}
                aria-haspopup="true"
                aria-expanded={open}
                className={cn(
                    'imcrm-relative imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                )}
            >
                <Bell className="imcrm-h-4 imcrm-w-4" />
                {unread > 0 && (
                    <span
                        className="imcrm-absolute imcrm--top-1 imcrm--right-1 imcrm-flex imcrm-h-4 imcrm-min-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive imcrm-px-1 imcrm-text-[9px] imcrm-font-semibold imcrm-text-destructive-foreground"
                        aria-label={sprintf(
                            /* translators: %d: unread mentions count */
                            __('%d menciones sin leer'),
                            unread,
                        )}
                    >
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="imcrm-absolute imcrm-right-0 imcrm-top-full imcrm-z-50 imcrm-mt-1 imcrm-w-80 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg">
                    <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                        <h2 className="imcrm-text-sm imcrm-font-medium">{__('Menciones')}</h2>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {sprintf(
                                /* translators: %d: total mentions */
                                __('Últimas %d'),
                                items.length,
                            )}
                        </span>
                    </header>

                    {mentions.isLoading ? (
                        <p className="imcrm-px-3 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Cargando…')}
                        </p>
                    ) : items.length === 0 ? (
                        <p className="imcrm-px-3 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Aún no tienes menciones.')}
                        </p>
                    ) : (
                        <ul className="imcrm-flex imcrm-max-h-80 imcrm-flex-col imcrm-overflow-y-auto">
                            {items.map((m) => (
                                <li
                                    key={m.id}
                                    className="imcrm-border-b imcrm-border-border/60 imcrm-px-3 imcrm-py-2 imcrm-text-xs last:imcrm-border-0"
                                >
                                    <p className="imcrm-text-foreground imcrm-line-clamp-2">
                                        {String(m.changes.snippet ?? '')}
                                    </p>
                                    <p className="imcrm-mt-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                                        {m.created_at
                                            ? new Date(m.created_at + 'Z').toLocaleString()
                                            : ''}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function readSeenAt(): number {
    try {
        const raw = window.localStorage.getItem(SEEN_AT_KEY);
        const ts = raw ? Number(raw) : 0;
        return Number.isFinite(ts) ? ts : 0;
    } catch {
        return 0;
    }
}

function writeSeenAt(ts: number): void {
    try {
        window.localStorage.setItem(SEEN_AT_KEY, String(ts));
    } catch {
        // Sin localStorage (modo privado raro), nada que hacer.
    }
}
