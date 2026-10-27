import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Clock, Lightbulb, PlayCircle, ShieldAlert } from 'lucide-react';
import { HELP_CATEGORIES } from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';

import { fillGuideText, resolveGuideRoute, type VisibleGuide } from './guideAccess';
import { help, useHasTour } from './helpBus';
import { RichLite } from './RichLite';

/**
 * Una guía abierta en el panel de Ayuda: pasos numerados, consejo, video (si
 * el operador cargó uno), «Muéstrame» (el recorrido que la acompaña) e «Ir
 * ahí» (la pantalla donde se hace).
 */
export function GuideArticle({
    item,
    guides,
    firstListSlug,
    appName,
    onBack,
    onOpenGuide,
    onNavigate,
}: {
    item: VisibleGuide;
    guides: readonly VisibleGuide[];
    firstListSlug: string | null;
    appName: string;
    onBack: () => void;
    onOpenGuide: (id: string) => void;
    onNavigate: (path: string) => void;
}): JSX.Element {
    const { guide, restricted, videoSrc } = item;
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    const hasTour = useHasTour(guide.tour ?? null);
    const category = HELP_CATEGORIES.find((c) => c.id === guide.category);
    const related = guide.related
        .map((id) => guides.find((g) => g.guide.id === id))
        .filter((g): g is VisibleGuide => g !== undefined);
    const route = guide.route ? resolveGuideRoute(guide.route, firstListSlug) : null;

    // Al abrir una guía, el foco va a su título (lectores de pantalla y teclado).
    useEffect(() => {
        titleRef.current?.focus({ preventScroll: true });
    }, [guide.id]);

    return (
        <article className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="help-guide" data-guide-id={guide.id}>
            <button
                type="button"
                onClick={onBack}
                data-testid="help-guide-back"
                className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 -imcrm-ml-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
            >
                <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {__('Ayuda')}
            </button>

            <header className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {category && <span className="imcrm-font-medium imcrm-uppercase imcrm-tracking-wide">{__(category.label)}</span>}
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                        <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {sprintf(__('%d min'), guide.minutes)}
                    </span>
                    {guide.source === 'custom' && <span>{__('Guía de soporte')}</span>}
                </div>
                <h2
                    ref={titleRef}
                    tabIndex={-1}
                    className="imcrm-text-base imcrm-font-semibold imcrm-leading-snug focus:imcrm-outline-none"
                    data-testid="help-guide-title"
                >
                    {fillGuideText(guide.title, appName)}
                </h2>
            </header>

            {restricted && (
                <p
                    className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-leading-relaxed"
                    data-testid="help-guide-restricted"
                >
                    <ShieldAlert className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                    <span>
                        {__('Esto lo hace quien administra la empresa. Si lo necesitas, pídeselo a esa persona: aquí tienes los pasos para contárselo.')}
                    </span>
                </p>
            )}

            {videoSrc && (
                <div className="imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-black" data-testid="help-guide-video">
                    <iframe
                        src={videoSrc}
                        title={sprintf(__('Video: %s'), fillGuideText(guide.title, appName))}
                        className="imcrm-aspect-video imcrm-w-full"
                        loading="lazy"
                        allow="fullscreen; picture-in-picture; encrypted-media"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                    />
                </div>
            )}

            <RichLite text={fillGuideText(guide.body, appName)} onInternalLink={onNavigate} />

            {guide.tip && (
                <aside className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-bg-primary/5 imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-leading-relaxed">
                    <Lightbulb className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                    <RichLite text={fillGuideText(guide.tip, appName)} className="imcrm-gap-1 imcrm-text-xs" onInternalLink={onNavigate} />
                </aside>
            )}

            {((guide.tour && hasTour) || (route && !restricted)) && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    {guide.tour && hasTour && (
                        <button
                            type="button"
                            onClick={() => help.startTour(guide.tour!)}
                            data-testid="help-guide-show-me"
                            className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                        >
                            <PlayCircle className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            {__('Muéstrame')}
                        </button>
                    )}
                    {route && !restricted && (
                        <button
                            type="button"
                            onClick={() => onNavigate(route)}
                            data-testid="help-guide-go"
                            className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-text-[13px] imcrm-font-medium hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                        >
                            {__('Ir ahí')}
                            <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        </button>
                    )}
                </div>
            )}

            {related.length > 0 && (
                <section aria-label={__('Guías relacionadas')} className="imcrm-border-t imcrm-border-border imcrm-pt-4">
                    <h3 className="imcrm-mb-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('También te puede servir')}
                    </h3>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {related.map(({ guide: r }) => (
                            <li key={r.id}>
                                <button
                                    type="button"
                                    onClick={() => onOpenGuide(r.id)}
                                    data-testid={`help-related-${r.id}`}
                                    className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-[13px] hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                >
                                    <BookOpen className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                    <span className="imcrm-min-w-0">{fillGuideText(r.title, appName)}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </article>
    );
}
