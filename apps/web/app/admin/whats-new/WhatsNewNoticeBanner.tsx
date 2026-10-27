import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { useWhatsNewEvent, useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { useIsGuest } from '@/lib/guest';
import { __ } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';

import { WhatsNewActionButton } from './WhatsNewActionButton';
import type { WhatsNewCardItem } from './WhatsNewCard';
import { whatsNewPanel } from './whatsNewStore';

/**
 * Avisos de la plataforma («Mantenimiento programado el sábado de 10 a 11
 * p. m.»): una franja arriba de la app hasta que la persona la cierra o el
 * aviso vence. También la ven los invitados (es lo único de Novedades que les
 * llega). Se esconde sola al vencer aunque la pestaña siga abierta.
 */
export function WhatsNewNoticeBanner(): JSX.Element | null {
    const feed = useWhatsNewFeed();
    const event = useWhatsNewEvent();
    const isGuest = useIsGuest();
    const impersonating = useSession((s) => s.impersonating);
    const [now, setNow] = useState(() => Date.now());
    const notices = (feed.data?.notices ?? []).filter((n) => !n.expires_at || parseUtcDate(n.expires_at).getTime() > now);

    // Despierta al vencer el próximo aviso (y re-chequea cada minuto como red).
    const nextExpiry = Math.min(
        ...(feed.data?.notices ?? []).map((n) => (n.expires_at ? parseUtcDate(n.expires_at).getTime() : Infinity)),
    );
    useEffect(() => {
        if (!Number.isFinite(nextExpiry)) return;
        const wait = Math.max(1000, Math.min(nextExpiry - Date.now() + 500, 60_000));
        const t = window.setTimeout(() => setNow(Date.now()), wait);
        return () => window.clearTimeout(t);
    }, [nextExpiry, now]);

    if (notices.length === 0) return null;

    return (
        <div className="imcrm-flex imcrm-flex-col" data-testid="whats-new-notices">
            {notices.slice(0, 2).map((n) => (
                <WhatsNewNoticeRow
                    key={n.id}
                    notice={n}
                    onMore={n.body.trim() !== '' && !isGuest ? () => whatsNewPanel.open(String(n.id)) : undefined}
                    onAction={() => !impersonating && event.mutate({ id: n.id, event: 'clicked' })}
                    onDismiss={impersonating ? undefined : () => event.mutate({ id: n.id, event: 'dismissed' })}
                />
            ))}
        </div>
    );
}

/** Un aviso en la franja (la misma pieza en la app y en la vista previa del operador). */
export function WhatsNewNoticeRow({
    notice,
    onMore,
    onAction,
    onDismiss,
}: {
    notice: Pick<WhatsNewCardItem, 'id' | 'title' | 'summary' | 'action'>;
    onMore?: () => void;
    onAction?: () => void;
    /** Sin esto (el operador mirando como otra persona) la X queda deshabilitada. */
    onDismiss?: () => void;
}): JSX.Element {
    return (
        <div
            role="region"
            aria-label={__('Aviso')}
            data-whats-new-notice={notice.id}
            className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-border-b imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm sm:imcrm-items-center sm:imcrm-px-4"
        >
            <Megaphone className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-[hsl(var(--imcrm-warning-ink))] sm:imcrm-mt-0" aria-hidden />
            <p className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-foreground">
                <span className="imcrm-font-semibold">{notice.title}</span> <span className="imcrm-text-foreground/80">{notice.summary}</span>
                {onMore && (
                    <button
                        type="button"
                        onClick={onMore}
                        className="imcrm-ml-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-[hsl(var(--imcrm-warning-ink))] imcrm-underline imcrm-underline-offset-2"
                    >
                        {__('Ver más')}
                    </button>
                )}
            </p>
            {notice.action && (
                <WhatsNewActionButton
                    action={notice.action}
                    size="sm"
                    className="imcrm-h-7 imcrm-shrink-0 imcrm-bg-card imcrm-px-2.5 imcrm-text-xs"
                    onActivate={onAction}
                />
            )}
            <button
                type="button"
                onClick={onDismiss}
                disabled={!onDismiss}
                aria-label={__('Cerrar este aviso')}
                data-testid="whats-new-notice-close"
                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-warning/15 hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring disabled:imcrm-opacity-40"
            >
                <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </button>
        </div>
    );
}
