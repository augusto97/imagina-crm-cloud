import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Megaphone } from 'lucide-react';
import { WHATS_NEW_KINDS, type WhatsNewKind } from '@imagina-base/shared';

import { useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useBrandingData } from '@/hooks/useBranding';
import { useMarkWhatsNewSeen, useWhatsNewEvent, useWhatsNewHistory } from '@/hooks/useWhatsNew';
import { __, sprintf } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { WhatsNewCard } from './WhatsNewCard';
import { groupByMonth, WHATS_NEW_KIND_META, WHATS_NEW_KIND_PLURALS } from './whatsNewMeta';

type Filter = WhatsNewKind | 'all';

/**
 * `/novedades`: todo el historial de novedades, por mes, con filtro por tipo.
 * Lo nuevo que se muestra queda marcado como visto (igual que en el panel) y
 * conserva su marca «Nuevo» mientras la página siga abierta.
 */
export function WhatsNewPage(): JSX.Element {
    const [filter, setFilter] = useState<Filter>('all');
    const history = useWhatsNewHistory(filter);
    const markSeen = useMarkWhatsNewSeen();
    const event = useWhatsNewEvent();
    const impersonating = useSession((s) => s.impersonating);
    const appName = useBrandingData().data?.app_name ?? null;
    const items = useMemo(() => (history.data?.pages ?? []).flatMap((p) => p.items), [history.data]);
    const groups = useMemo(() => groupByMonth(items, parseUtcDate), [items]);
    const [newIds, setNewIds] = useState<Set<number>>(new Set());
    const sent = useRef(new Set<number>());

    // Lo nuevo que llega a la pantalla se marca visto (una vez por novedad).
    useEffect(() => {
        const fresh = items.filter((i) => i.is_new && !sent.current.has(i.id)).map((i) => i.id);
        if (fresh.length === 0) return;
        for (const id of fresh) sent.current.add(id);
        setNewIds((prev) => new Set([...prev, ...fresh]));
        if (!impersonating) markSeen.mutate({ ids: fresh });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando llegan novedades
    }, [items]);

    const filters: Array<{ id: Filter; label: string }> = [
        { id: 'all', label: __('Todas') },
        ...WHATS_NEW_KINDS.map((k) => ({ id: k, label: __(WHATS_NEW_KIND_PLURALS[k]) })),
    ];

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-3xl imcrm-flex-col imcrm-gap-5 imcrm-pb-10 imcrm-pt-2" data-testid="whats-new-page">
            <header className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                    <Megaphone className="imcrm-h-5 imcrm-w-5" aria-hidden />
                </span>
                <div className="imcrm-min-w-0">
                    <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Novedades')}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {appName
                            ? sprintf(__('Las funciones nuevas, las mejoras y los avisos de %s.'), appName)
                            : __('Las funciones nuevas, las mejoras y los avisos de la app.')}
                    </p>
                </div>
            </header>

            <div role="group" aria-label={__('Filtrar por tipo')} className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                {filters.map((f) => {
                    const active = filter === f.id;
                    const Icon = f.id === 'all' ? null : WHATS_NEW_KIND_META[f.id].icon;
                    return (
                        <button
                            key={f.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setFilter(f.id)}
                            data-whats-new-filter={f.id}
                            className={cn(
                                'imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-transition-colors focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                                active
                                    ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground'
                                    : 'imcrm-border-border imcrm-bg-card imcrm-text-foreground/80 hover:imcrm-bg-accent',
                            )}
                        >
                            {Icon && <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                            {f.label}
                        </button>
                    );
                })}
            </div>

            {history.isLoading ? (
                <div className="imcrm-flex imcrm-justify-center imcrm-py-16">
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Cargando…')} />
                </div>
            ) : history.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las novedades. Inténtalo de nuevo en un momento.')}</p>
            ) : items.length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-14 imcrm-text-center">
                    <Megaphone className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" aria-hidden />
                    <p className="imcrm-text-sm imcrm-font-medium">
                        {filter === 'all' ? __('Todavía no hay novedades') : __('No hay novedades de este tipo')}
                    </p>
                </div>
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-7">
                    {groups.map((g) => (
                        <section key={g.key} aria-label={g.label} className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <h2 className="imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{g.label}</h2>
                            {g.items.map((item) => (
                                <WhatsNewCard
                                    key={item.id}
                                    item={item}
                                    highlightNew={newIds.has(item.id) || item.is_new}
                                    onOpened={() => !impersonating && event.mutate({ id: item.id, event: 'opened' })}
                                    onAction={() => !impersonating && event.mutate({ id: item.id, event: 'clicked' })}
                                />
                            ))}
                        </section>
                    ))}
                    {history.hasNextPage && (
                        <Button
                            type="button"
                            variant="outline"
                            className="imcrm-self-center"
                            disabled={history.isFetchingNextPage}
                            onClick={() => void history.fetchNextPage()}
                            data-testid="whats-new-load-more"
                        >
                            {history.isFetchingNextPage && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" aria-hidden />}
                            {__('Ver más novedades')}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
