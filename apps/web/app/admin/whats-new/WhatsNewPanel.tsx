import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CheckCheck, Megaphone } from 'lucide-react';

import { useSession } from '@/cloud/session';
import { Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useBrandingData } from '@/hooks/useBranding';
import { useMarkWhatsNewSeen, useWhatsNewEvent, useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { __, _n, sprintf } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';

import { WhatsNewCard } from './WhatsNewCard';
import { groupByMonth } from './whatsNewMeta';
import { useWhatsNewPanel, whatsNewPanel } from './whatsNewStore';

/**
 * El panel de Novedades (a la derecha). Abrirlo marca como vistas las
 * novedades que muestra; la marca «Nuevo» se conserva mientras está abierto
 * (si se borrara al instante, la persona no sabría qué era lo nuevo).
 */
export function WhatsNewPanel(): JSX.Element {
    const { open, focus } = useWhatsNewPanel();
    const feed = useWhatsNewFeed();
    const markSeen = useMarkWhatsNewSeen();
    const event = useWhatsNewEvent();
    const impersonating = useSession((s) => s.impersonating);
    const appName = useBrandingData().data?.app_name ?? null;
    const items = useMemo(() => feed.data?.items ?? [], [feed.data]);
    // Lo nuevo AL ABRIR (se congela mientras el panel siga abierto).
    const [newAtOpen, setNewAtOpen] = useState<Set<number>>(new Set());
    const marked = useRef(false);
    const cardRefs = useRef(new Map<number, HTMLElement>());

    useEffect(() => {
        if (!open) {
            marked.current = false;
            return;
        }
        if (marked.current || !feed.data) return;
        marked.current = true;
        const fresh = feed.data.items.filter((i) => i.is_new).map((i) => i.id);
        setNewAtOpen(new Set(fresh));
        if (fresh.length > 0 && !impersonating) markSeen.mutate({ ids: fresh });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- se marca UNA vez por apertura
    }, [open, feed.data]);

    // Abrir en una novedad puntual (por id o por clave): se lleva a la vista.
    const focusId = useMemo(() => {
        if (!focus) return null;
        const hit = items.find((i) => String(i.id) === focus || i.key === focus);
        return hit?.id ?? null;
    }, [focus, items]);
    useEffect(() => {
        if (!open || focusId === null) return;
        const t = window.setTimeout(() => cardRefs.current.get(focusId)?.scrollIntoView({ block: 'start' }), 80);
        return () => window.clearTimeout(t);
    }, [open, focusId]);

    const groups = useMemo(() => groupByMonth(items, parseUtcDate), [items]);
    const unseen = feed.data?.unseen_count ?? 0;

    return (
        <Sheet open={open} onOpenChange={(o) => (o ? whatsNewPanel.open() : whatsNewPanel.close())}>
            <SheetContent className="sm:imcrm-w-[440px]" data-testid="whats-new-panel">
                <SheetHeader className="imcrm-items-center">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                        <Megaphone className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <SheetTitle>{__('Novedades')}</SheetTitle>
                        <SheetDescription className="imcrm-text-xs">
                            {appName ? sprintf(__('Lo nuevo en %s'), appName) : __('Lo nuevo en la app')}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton aria-label={__('Cerrar novedades')} />
                </SheetHeader>
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-2">
                    <span className="imcrm-text-xs imcrm-text-muted-foreground" aria-live="polite">
                        {newAtOpen.size > 0
                            ? sprintf(_n(__('%d novedad nueva para ti'), __('%d novedades nuevas para ti'), newAtOpen.size), newAtOpen.size)
                            : __('Estás al día')}
                    </span>
                    <button
                        type="button"
                        disabled={unseen === 0 || markSeen.isPending || Boolean(impersonating)}
                        onClick={() => markSeen.mutate({ all: true })}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-40"
                        data-testid="whats-new-mark-all"
                    >
                        <CheckCheck className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Marcar todo como visto')}
                    </button>
                </div>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5 imcrm-bg-canvas/40">
                    {feed.isLoading ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando…')}</p>
                    ) : feed.isError ? (
                        <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las novedades. Inténtalo de nuevo en un momento.')}</p>
                    ) : items.length === 0 ? (
                        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-12 imcrm-text-center">
                            <Megaphone className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" aria-hidden />
                            <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay novedades')}</p>
                            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Aquí verás las funciones nuevas y las mejoras de la app cuando lleguen.')}
                            </p>
                        </div>
                    ) : (
                        groups.map((g) => (
                            <section key={g.key} aria-label={g.label} className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                <h3 className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {g.label}
                                </h3>
                                {g.items.map((item) => (
                                    <WhatsNewCard
                                        key={item.id}
                                        ref={(el) => {
                                            if (el) cardRefs.current.set(item.id, el);
                                            else cardRefs.current.delete(item.id);
                                        }}
                                        item={item}
                                        highlightNew={newAtOpen.has(item.id) || item.is_new}
                                        defaultExpanded={focusId === item.id}
                                        onOpened={() => !impersonating && event.mutate({ id: item.id, event: 'opened' })}
                                        onAction={() => {
                                            if (!impersonating) event.mutate({ id: item.id, event: 'clicked' });
                                            whatsNewPanel.close();
                                        }}
                                    />
                                ))}
                            </section>
                        ))
                    )}
                </SheetBody>
                <SheetFooter className="imcrm-justify-center">
                    <Link
                        to="/novedades"
                        onClick={() => whatsNewPanel.close()}
                        className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        data-testid="whats-new-history-link"
                    >
                        {__('Ver el historial completo')}
                    </Link>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
