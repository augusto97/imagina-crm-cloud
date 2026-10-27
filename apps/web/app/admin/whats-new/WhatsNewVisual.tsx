import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { EMPTY_WHATS_NEW_MEDIA, type WhatsNewMedia, type WhatsNewSlide } from '@imagina-base/shared';

import { DemoPlayer } from '@/admin/learn/demos/DemoPlayer';
import { hasIllustration, Illustration } from '@/admin/learn/illustrations/registry';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { WhatsNewImage } from './WhatsNewCard';

/**
 * Lo visual de una novedad (v0.1.325): una ilustración ANIMADA de la app (las
 * del centro de aprendizaje: se dibujan con los colores del tema y de la
 * marca, en claro y en oscuro), una captura real paso a paso, una imagen, o un
 * CARRUSEL de diapositivas como el «Qué hay de nuevo» de ClickUp. Vive en su
 * propio chunk: el panel y el diálogo lo piden sólo cuando una novedad trae
 * algo para mostrar.
 */

export type WhatsNewVisualVariant = 'card' | 'dialog';

export interface WhatsNewVisualProps {
    imageUrl: string | null;
    media: WhatsNewMedia | null | undefined;
    variant: WhatsNewVisualVariant;
    title: string;
}

/** Una ilustración que esta versión de la app ya no trae se ignora (nunca un hueco). */
function usableIllustration(key: string | null): string | null {
    return key && hasIllustration(key) ? key : null;
}

/** El fondo suave con el color de la marca que enmarca una ilustración. */
function Backdrop({ children, variant, className }: { children: JSX.Element; variant: WhatsNewVisualVariant; className?: string }): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-relative imcrm-overflow-hidden imcrm-bg-gradient-to-br imcrm-from-primary/15 imcrm-via-primary/5 imcrm-to-transparent',
                variant === 'dialog' ? 'imcrm-px-6 imcrm-pb-4 imcrm-pt-6 sm:imcrm-px-10' : 'imcrm-rounded-lg imcrm-p-2.5',
                className,
            )}
        >
            <div aria-hidden className="imcrm-pointer-events-none imcrm-absolute imcrm--right-10 imcrm--top-12 imcrm-h-36 imcrm-w-36 imcrm-rounded-full imcrm-bg-primary/10 imcrm-blur-2xl" />
            <div className="imcrm-relative">{children}</div>
        </div>
    );
}

/** Lo visual de UNA pieza (la novedad o una diapositiva). `null` si no hay nada utilizable. */
function SingleVisual({
    illustration,
    demo,
    imageUrl,
    variant,
}: {
    illustration: string | null;
    demo: string | null;
    imageUrl: string | null;
    variant: WhatsNewVisualVariant;
}): JSX.Element | null {
    const ill = usableIllustration(illustration);
    if (imageUrl) {
        return (
            <WhatsNewImage
                src={imageUrl}
                className={variant === 'dialog' ? 'imcrm-max-h-72 imcrm-rounded-none imcrm-border-0 imcrm-border-b' : 'imcrm-max-h-60'}
            />
        );
    }
    if (demo) {
        // Sin capturas en este servidor, la ilustración (o nada).
        const fallback = ill ? <Backdrop variant={variant}><Illustration name={ill} /></Backdrop> : null;
        return (
            <div className={variant === 'dialog' ? 'imcrm-p-4 imcrm-pb-0' : undefined}>
                <DemoPlayer demoKey={demo} fallback={fallback} />
            </div>
        );
    }
    if (ill) {
        return (
            <Backdrop variant={variant}>
                <Illustration name={ill} />
            </Backdrop>
        );
    }
    return null;
}

const reducedMotion = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Cuánto dura cada diapositiva cuando avanza sola. */
export const SLIDE_MS = 7000;

/** Siguiente índice con vuelta al principio (también hacia atrás). */
export function wrapIndex(i: number, length: number): number {
    if (length <= 0) return 0;
    return ((i % length) + length) % length;
}

/**
 * Carrusel de diapositivas: avanza solo mientras se ve (se detiene al pasar el
 * mouse, al tener el foco adentro, en una captura —que tiene su propio
 * reproductor— y con «reducir movimiento»), con flechas, puntos y ← →.
 */
export function WhatsNewCarousel({
    slides,
    variant,
    title,
}: {
    slides: readonly WhatsNewSlide[];
    variant: WhatsNewVisualVariant;
    title: string;
}): JSX.Element | null {
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [userPaused, setUserPaused] = useState(() => reducedMotion());
    const [visible, setVisible] = useState(true);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const regionId = useId();
    const touchX = useRef<number | null>(null);
    const n = slides.length;
    const current = slides[wrapIndex(index, n)];
    const go = useCallback((i: number) => setIndex(wrapIndex(i, n)), [n]);

    useEffect(() => {
        const el = rootRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(([e]) => setVisible(Boolean(e?.isIntersecting)), { threshold: 0.4 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const auto = n > 1 && !paused && !userPaused && visible && !current?.demo;
    useEffect(() => {
        if (!auto) return;
        const t = window.setTimeout(() => go(index + 1), SLIDE_MS);
        return () => window.clearTimeout(t);
    }, [auto, index, go]);

    if (!current) return null;

    const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(index + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(index - 1);
        }
    };
    const position = wrapIndex(index, n);
    const visual = (
        <SingleVisual illustration={current.illustration} demo={current.demo} imageUrl={current.image_url} variant={variant} />
    );

    return (
        <div
            ref={rootRef}
            role="region"
            aria-roledescription={__('carrusel')}
            aria-label={title}
            tabIndex={-1}
            onKeyDown={onKey}
            onPointerEnter={() => setPaused(true)}
            onPointerLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
            }}
            className={cn('imcrm-flex imcrm-flex-col', variant === 'card' ? 'imcrm-gap-2' : 'imcrm-gap-0')}
            data-testid="whats-new-carousel"
            data-slide={position}
        >
            <div
                className="imcrm-relative imcrm-touch-pan-y"
                // En el teléfono, deslizar con el dedo pasa de diapositiva.
                onTouchStart={(e) => {
                    touchX.current = e.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(e) => {
                    const start = touchX.current;
                    touchX.current = null;
                    const end = e.changedTouches[0]?.clientX;
                    if (start === null || end === undefined || n < 2) return;
                    if (Math.abs(end - start) > 40) go(end < start ? index + 1 : index - 1);
                }}
            >
                <div
                    key={position}
                    id={`${regionId}-slide`}
                    role="group"
                    aria-roledescription={__('diapositiva')}
                    aria-label={sprintf(__('%1$d de %2$d'), position + 1, n)}
                    className="motion-safe:imcrm-animate-imcrm-fade-in"
                >
                    {visual ?? (
                        <Backdrop variant={variant}>
                            <div className="imcrm-flex imcrm-aspect-[480/300] imcrm-items-center imcrm-justify-center imcrm-text-4xl imcrm-font-semibold imcrm-text-primary/70">
                                {position + 1}
                            </div>
                        </Backdrop>
                    )}
                </div>
                {n > 1 && (
                    <>
                        <ArrowButton side="left" onClick={() => go(index - 1)} label={__('Diapositiva anterior')} />
                        <ArrowButton side="right" onClick={() => go(index + 1)} label={__('Diapositiva siguiente')} />
                    </>
                )}
            </div>
            <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1', variant === 'dialog' ? 'imcrm-px-5 imcrm-pt-4 sm:imcrm-px-6' : 'imcrm-px-0.5')}>
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3">
                    <p className="imcrm-text-sm imcrm-font-semibold imcrm-leading-snug" data-testid="whats-new-slide-title">
                        {current.title}
                    </p>
                    {n > 1 && (
                        <span className="imcrm-shrink-0 imcrm-pt-0.5 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">
                            {sprintf(__('%1$d de %2$d'), position + 1, n)}
                        </span>
                    )}
                </div>
                {current.text && <p className="imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">{current.text}</p>}
                {n > 1 && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-pt-1.5">
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5" role="tablist" aria-label={__('Diapositivas')}>
                            {slides.map((s, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    role="tab"
                                    aria-selected={i === position}
                                    aria-controls={`${regionId}-slide`}
                                    aria-label={sprintf(__('Ir a «%s»'), s.title)}
                                    onClick={() => go(i)}
                                    className={cn(
                                        'imcrm-h-1.5 imcrm-rounded-full motion-safe:imcrm-transition-all focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                                        i === position ? 'imcrm-w-5 imcrm-bg-primary' : 'imcrm-w-1.5 imcrm-bg-muted-foreground/30 hover:imcrm-bg-muted-foreground/60',
                                    )}
                                    data-testid={`whats-new-slide-dot-${i}`}
                                />
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={() => setUserPaused((p) => !p)}
                            aria-label={userPaused ? __('Reproducir el carrusel') : __('Pausar el carrusel')}
                            className="imcrm-ml-auto imcrm-inline-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                        >
                            {userPaused ? <Play className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> : <Pause className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function ArrowButton({ side, onClick, label }: { side: 'left' | 'right'; onClick: () => void; label: string }): JSX.Element {
    const Icon = side === 'left' ? ChevronLeft : ChevronRight;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={cn(
                'imcrm-absolute imcrm-top-1/2 imcrm-z-10 imcrm-hidden imcrm-h-8 imcrm-w-8 sm:imcrm-flex [@media(hover:hover)]:imcrm-flex imcrm--translate-y-1/2 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card/90 imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-backdrop-blur hover:imcrm-bg-card focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                side === 'left' ? 'imcrm-left-2' : 'imcrm-right-2',
            )}
            data-testid={`whats-new-slide-${side === 'left' ? 'prev' : 'next'}`}
        >
            <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
        </button>
    );
}

/**
 * Lo visual principal de una novedad: el carrusel si trae diapositivas; si no,
 * su imagen, su captura o su ilustración (en ese orden: lo que eligió el
 * operador gana a lo que trae la versión).
 */
export default function WhatsNewVisual({ imageUrl, media, variant, title }: WhatsNewVisualProps): JSX.Element | null {
    const m = media ?? EMPTY_WHATS_NEW_MEDIA;
    if (m.slides.length > 0) return <WhatsNewCarousel slides={m.slides} variant={variant} title={title} />;
    return <SingleVisual illustration={m.illustration} demo={m.demo} imageUrl={imageUrl} variant={variant} />;
}
