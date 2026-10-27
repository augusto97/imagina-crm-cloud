import { useMemo, type CSSProperties, type Ref } from 'react';
import { Link } from 'react-router';
import { ArrowRight, BookOpen, Check, Clock, Compass, Footprints, RotateCcw, Sparkles } from 'lucide-react';

import { moduleById } from '@/admin/learn/content/registry';
import { Illustration, hasIllustration } from '@/admin/learn/illustrations/registry';
import { ToneSquare } from '@/admin/learn/LearnIcon';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { help } from '../helpBus';
import { tourById } from '../tours/tours';
import { stepProgress } from './resolve';
import type { TourRun } from './tourStore';

/**
 * Las piezas visuales de los recorridos (v0.1.324): la ilustración de un
 * paso, la portada («qué vas a ver») y el cierre («lo que viste y qué
 * seguir»). Viven en su propio archivo para bajarse sólo cuando alguien
 * empieza un recorrido (traen el índice del manual y las ilustraciones).
 */

/** La ilustración animada de un paso o de la portada, con su marco. */
export function TourArt({ name, className, testId }: { name: string; className?: string; testId?: string }): JSX.Element | null {
    if (!hasIllustration(name)) return null;
    return (
        <div className={cn('imcrm-overflow-hidden imcrm-rounded-lg', className)} data-testid={testId} aria-hidden>
            <Illustration name={name} />
        </div>
    );
}

const CARD_STYLE: CSSProperties = {
    width: 'min(560px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 24px)',
};

function Chip({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }): JSX.Element {
    return (
        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
            <Icon className="imcrm-h-3 imcrm-w-3" aria-hidden />
            {children}
        </span>
    );
}

/** La portada: qué se va a ver, cuánto dura y «Empezar». */
export function TourIntroCard({
    run,
    titleId,
    bodyId,
    primaryRef,
    onStart,
    onDismiss,
    reducedMotion,
}: {
    run: TourRun;
    titleId: string;
    bodyId: string;
    primaryRef: Ref<HTMLButtonElement>;
    onStart: () => void;
    onDismiss: () => void;
    reducedMotion: boolean;
}): JSX.Element {
    const { total } = stepProgress(run.steps, 0);
    const outcomes = run.meta.outcomes.slice(0, 8);
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            data-testid="tour-intro"
            className={cn(
                'imcrm-pointer-events-auto imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-flex imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
            )}
            style={CARD_STYLE}
        >
            <div className={cn('imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-overflow-y-auto', !reducedMotion && 'imcrm-tour-pop')}>
                <div className="imcrm-relative imcrm-bg-gradient-to-b imcrm-from-primary/10 imcrm-to-transparent imcrm-px-5 imcrm-pt-5">
                    <TourArt name={run.meta.cover} className="imcrm-border imcrm-border-border/60 imcrm-shadow-imcrm-sm" testId="tour-intro-art" />
                </div>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-px-5 imcrm-pb-2 imcrm-pt-4">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <Chip icon={Compass}>{__('Recorrido guiado')}</Chip>
                        <Chip icon={Clock}>{sprintf(__('%d min'), run.meta.minutes)}</Chip>
                        <Chip icon={Footprints}>{sprintf(total === 1 ? __('%d paso') : __('%d pasos'), total)}</Chip>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <h2 id={titleId} className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            {run.title}
                        </h2>
                        <p id={bodyId} className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {run.meta.description}
                        </p>
                    </div>
                    {outcomes.length > 0 && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-canvas/60 imcrm-p-3">
                            <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                {__('Vas a ver')}
                            </span>
                            <ol className="imcrm-grid imcrm-gap-x-4 imcrm-gap-y-1.5 sm:imcrm-grid-cols-2" data-testid="tour-intro-outcomes">
                                {outcomes.map((o, i) => (
                                    <li key={o} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-[13px] imcrm-leading-snug">
                                        <span className="imcrm-mt-px imcrm-inline-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/15 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary">
                                            {i + 1}
                                        </span>
                                        <span>{o}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                <span className="imcrm-hidden imcrm-text-xs imcrm-text-muted-foreground sm:imcrm-inline">{__('Puedes salir cuando quieras con Esc.')}</span>
                <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-2">
                    <button
                        type="button"
                        onClick={onDismiss}
                        data-testid="tour-intro-later"
                        className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                    >
                        {__('Ahora no')}
                    </button>
                    <button
                        ref={primaryRef}
                        type="button"
                        onClick={onStart}
                        data-testid="tour-intro-start"
                        className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40 focus-visible:imcrm-ring-offset-2 focus-visible:imcrm-ring-offset-card"
                    >
                        {__('Empezar el recorrido')}
                        <ArrowRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Papel picado en los colores del tema (sólo con movimiento permitido). */
function Confetti(): JSX.Element {
    const pieces = useMemo(() => {
        const tones = ['primary', 'tone-mint', 'tone-amber', 'tone-rose', 'tone-blue', 'tone-violet', 'tone-cyan'];
        // Determinista (sin Math.random en el render): misma lluvia siempre.
        return Array.from({ length: 34 }, (_, i) => {
            const t = tones[i % tones.length]!;
            const left = (i * 37) % 100;
            return {
                key: i,
                style: {
                    left: `${left}%`,
                    background: `hsl(var(--imcrm-${t}))`,
                    width: i % 3 === 0 ? 6 : 8,
                    height: i % 4 === 0 ? 8 : 12,
                    borderRadius: i % 5 === 0 ? 999 : 2,
                    '--dx': `${((i * 53) % 120) - 60}px`,
                    '--rot': `${360 + ((i * 97) % 540)}deg`,
                    '--dur': `${1.5 + ((i * 13) % 10) / 10}s`,
                    '--delay': `${((i * 7) % 10) / 25}s`,
                } as CSSProperties,
            };
        });
    }, []);
    return (
        <div aria-hidden className="imcrm-tour-confetti imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-0 imcrm-top-0 imcrm-h-0" data-testid="tour-confetti">
            {pieces.map((p) => (
                <i key={p.key} style={p.style} />
            ))}
        </div>
    );
}

/** El cierre: lo que se vio, qué recorrido sigue y dónde leer más. */
export function TourOutroCard({
    run,
    titleId,
    bodyId,
    primaryRef,
    onClose,
    onRepeat,
    onNext,
    reducedMotion,
}: {
    run: TourRun;
    titleId: string;
    bodyId: string;
    primaryRef: Ref<HTMLButtonElement>;
    onClose: () => void;
    onRepeat: () => void;
    onNext: (tourId: string) => void;
    reducedMotion: boolean;
}): JSX.Element {
    const nothing = run.shown === 0;
    const next = run.meta.next
        .map((id) => tourById(id))
        .filter((t): t is NonNullable<typeof t> => Boolean(t) && help.hasTour(t!.id))
        .slice(0, 2);
    const learn = useMemo(() => {
        if (!run.meta.learn) return null;
        const [m, a] = run.meta.learn.split('/');
        const mod = moduleById(m ?? '');
        const art = mod?.articles.find((x) => x.id === a);
        return mod && art ? { mod, art } : null;
    }, [run.meta.learn]);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            data-testid="tour-outro"
            data-tour-outcome={nothing ? 'empty' : 'done'}
            className="imcrm-pointer-events-auto imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-flex imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl"
            style={CARD_STYLE}
        >
            {!nothing && !reducedMotion && <Confetti />}
            <div className={cn('imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-4 imcrm-overflow-y-auto imcrm-px-5 imcrm-pb-2 imcrm-pt-6', !reducedMotion && 'imcrm-tour-pop')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-text-center">
                    <span className="imcrm-relative imcrm-inline-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center">
                        {!nothing && <span aria-hidden className="imcrm-tour-ring imcrm-absolute imcrm-inset-0 imcrm-rounded-full imcrm-bg-primary/30" />}
                        <span
                            className={cn(
                                'imcrm-tour-check imcrm-relative imcrm-inline-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                                nothing ? 'imcrm-bg-muted imcrm-text-muted-foreground' : 'imcrm-bg-primary imcrm-text-primary-foreground',
                            )}
                        >
                            {nothing ? <Compass className="imcrm-h-7 imcrm-w-7" aria-hidden /> : <Check className="imcrm-h-7 imcrm-w-7" strokeWidth={3} aria-hidden />}
                        </span>
                    </span>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <h2 id={titleId} className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                            {nothing ? __('No había nada para mostrar aquí') : __('¡Recorrido completado!')}
                        </h2>
                        <p id={bodyId} className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {nothing
                                ? __('Este recorrido necesita algo en pantalla (por ejemplo, una lista con registros). Vuelve a probar cuando lo tengas.')
                                : sprintf(__('Terminaste «%s». Ya sabes dónde está cada cosa.'), run.title)}
                        </p>
                    </div>
                </div>

                {!nothing && run.seen.length > 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-canvas/60 imcrm-p-3">
                        <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Lo que viste')}
                        </span>
                        <ul className="imcrm-grid imcrm-gap-x-4 imcrm-gap-y-1.5 sm:imcrm-grid-cols-2" data-testid="tour-outro-seen">
                            {run.seen.slice(0, 10).map((s) => (
                                <li key={s} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-[13px] imcrm-leading-snug">
                                    <Check className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-success" strokeWidth={3} aria-hidden />
                                    <span>{s}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {(next.length > 0 || learn) && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Para seguir')}
                        </span>
                        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                            {next.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => onNext(t.id)}
                                    data-testid={`tour-outro-next-${t.id}`}
                                    className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-accent/40 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                >
                                    <TourArt name={t.cover} className="imcrm-w-[84px] imcrm-shrink-0 imcrm-rounded-md imcrm-border imcrm-border-border/60" />
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                        <span className="imcrm-text-[13px] imcrm-font-medium imcrm-leading-snug">{t.title}</span>
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                            <Sparkles className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {sprintf(__('Recorrido · %d min'), t.minutes)}
                                        </span>
                                    </span>
                                </button>
                            ))}
                            {learn && (
                                <Link
                                    to={`/aprende/${learn.mod.id}/${learn.art.id}`}
                                    onClick={onClose}
                                    data-testid="tour-outro-learn"
                                    className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-accent/40 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                >
                                    <ToneSquare icon={learn.mod.icon} tone={learn.mod.tone} size={40} />
                                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                        <span className="imcrm-text-[13px] imcrm-font-medium imcrm-leading-snug">{learn.art.title}</span>
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                            <BookOpen className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {__('Guía completa en Aprende')}
                                        </span>
                                    </span>
                                </Link>
                            )}
                        </div>
                    </div>
                )}
            </div>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                <button
                    type="button"
                    onClick={onRepeat}
                    data-testid="tour-outro-repeat"
                    className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-3 imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                >
                    <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Repetir')}
                </button>
                <button
                    ref={primaryRef}
                    type="button"
                    onClick={onClose}
                    data-testid="tour-outro-done"
                    className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40 focus-visible:imcrm-ring-offset-2 focus-visible:imcrm-ring-offset-card"
                >
                    <Check className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {__('Terminar')}
                </button>
            </div>
        </div>
    );
}
