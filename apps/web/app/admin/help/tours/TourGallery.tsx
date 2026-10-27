import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { Check, Clock, Compass, Play, RotateCcw } from 'lucide-react';

import { Illustration } from '@/admin/learn/illustrations/registry';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { help, useHelpAvailability } from '../helpBus';
import { useGuideProgress, useHelpViewer } from '../useHelpData';
import { TOUR_CATEGORIES, TOURS } from './tours';

/**
 * Galería de recorridos guiados (v0.1.324): todos los que aplican a quien
 * mira, por tema, con su ilustración, cuánto duran y si ya los hizo. Vive en
 * la portada de Aprende (`#recorridos`).
 */
export function TourGallery(): JSX.Element | null {
    const availability = useHelpAvailability();
    const viewer = useHelpViewer();
    const progress = useGuideProgress(!viewer.isGuest);
    const done = useMemo(() => new Set(progress.data?.completed ?? []), [progress.data]);
    const tours = useMemo(
        () => TOURS.filter((t) => help.hasTour(t.id)),
        // `availability` cambia cuando se registran los recorridos.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [availability],
    );
    const location = useLocation();
    const ref = useRef<HTMLElement | null>(null);
    const hasTours = tours.length > 0;
    // `/aprende#recorridos` (desde la Ayuda) baja hasta la galería.
    useEffect(() => {
        if (location.hash === '#recorridos' && hasTours) ref.current?.scrollIntoView({ block: 'start' });
    }, [location.hash, hasTours]);
    if (!hasTours) return null;
    const doneCount = tours.filter((t) => done.has(t.id)).length;

    return (
        <section ref={ref} id="recorridos" className="imcrm-flex imcrm-scroll-mt-6 imcrm-flex-col imcrm-gap-5" aria-labelledby="learn-tours-title" data-testid="learn-tours">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold imcrm-text-primary">
                        <Compass className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Recorridos guiados')}
                    </span>
                    <h2 id="learn-tours-title" className="imcrm-text-lg imcrm-font-semibold">
                        {__('Que la app te muestre cada cosa en pantalla')}
                    </h2>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Te lleva a cada lugar, resalta lo que importa y te invita a probarlo tú. Duran entre 1 y 3 minutos.')}
                    </p>
                </div>
                <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="learn-tours-count">
                    {sprintf(__('%1$d de %2$d hechos'), doneCount, tours.length)}
                </span>
            </div>
            {TOUR_CATEGORIES.map((cat) => {
                const list = tours.filter((t) => t.category === cat.id);
                if (list.length === 0) return null;
                return (
                    <div key={cat.id} className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <div className="imcrm-flex imcrm-items-baseline imcrm-gap-2">
                            <h3 className="imcrm-text-sm imcrm-font-semibold">{cat.title}</h3>
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{cat.description}</span>
                        </div>
                        <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                            {list.map((t) => {
                                const isDone = done.has(t.id);
                                return (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => help.startTour(t.id)}
                                        data-testid={`learn-tour-${t.id}`}
                                        data-done={isDone ? 'true' : 'false'}
                                        className="imcrm-group imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-left hover:imcrm-border-primary/40 hover:imcrm-shadow-imcrm-md focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                    >
                                        <span className="imcrm-relative imcrm-block imcrm-border-b imcrm-border-border">
                                            <Illustration name={t.cover} />
                                            <span
                                                aria-hidden
                                                className="imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-bg-black/0 imcrm-transition-colors group-hover:imcrm-bg-black/20"
                                            >
                                                <span className="imcrm-inline-flex imcrm-h-11 imcrm-w-11 imcrm-scale-90 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-primary-foreground imcrm-opacity-0 imcrm-shadow-imcrm-lg imcrm-transition group-hover:imcrm-scale-100 group-hover:imcrm-opacity-100">
                                                    <Play className="imcrm-ml-0.5 imcrm-h-5 imcrm-w-5" fill="currentColor" />
                                                </span>
                                            </span>
                                            {isDone && (
                                                <span className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-success imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-success-foreground imcrm-shadow-imcrm-sm">
                                                    <Check className="imcrm-h-3 imcrm-w-3" strokeWidth={3} aria-hidden />
                                                    {__('Hecho')}
                                                </span>
                                            )}
                                        </span>
                                        <span className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5 imcrm-p-3.5">
                                            <span className="imcrm-font-semibold imcrm-leading-snug">{__(t.title)}</span>
                                            <span className="imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground">{__(t.description).replace(/\{app\}/g, __('la app'))}</span>
                                            <span className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-pt-1.5 imcrm-text-xs">
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-muted-foreground">
                                                    <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {sprintf(__('%d min'), t.minutes)}
                                                </span>
                                                <span className={cn('imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary')}>
                                                    {isDone ? <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                                                    {isDone ? __('Repetir') : __('Empezar')}
                                                </span>
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </section>
    );
}
