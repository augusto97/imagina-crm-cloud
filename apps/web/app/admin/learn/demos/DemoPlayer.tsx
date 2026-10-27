import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, RotateCcw, X } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { MEDIA_BASE, frameDuration, loadDemoManifest, panFor, zoomFor, type Demo, type DemoFrame, type DemoManifest } from './demoManifest';

/**
 * Reproductor de una demo con capturas reales (v0.1.322): cada cuadro es la
 * app de verdad y encima se anima lo que hace la persona — el cursor viaja a
 * lo que hay que tocar, la cámara se acerca para que se lea, el clic deja su
 * onda, lo que se escribe aparece letra por letra y lo que se arrastra se
 * mueve. Avanza solo mientras se ve (y se puede pausar, ir atrás o adelante,
 * o abrir en grande). Con «reducir movimiento» no avanza solo ni anima.
 */

const reducedMotion = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useManifest(): DemoManifest | null | undefined {
    const [m, setM] = useState<DemoManifest | null | undefined>(undefined);
    useEffect(() => {
        let alive = true;
        void loadDemoManifest().then((v) => alive && setM(v));
        return () => {
            alive = false;
        };
    }, []);
    return m;
}

/** ¿Existe la captura? (`undefined` mientras se averigua). */
export function useDemo(key: string): { demo: Demo | null | undefined; viewport: DemoManifest['viewport'] | null } {
    const m = useManifest();
    if (m === undefined) return { demo: undefined, viewport: null };
    return { demo: m?.demos[key] ?? null, viewport: m?.viewport ?? null };
}

export function DemoPlayer({
    demoKey,
    fallback,
    caption,
}: {
    demoKey: string;
    /** Qué mostrar si esta instalación no tiene la captura. */
    fallback?: JSX.Element | null;
    caption?: string;
}): JSX.Element | null {
    const { demo, viewport } = useDemo(demoKey);
    const [big, setBig] = useState(false);
    if (demo === undefined) {
        return <div className="imcrm-w-full imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40" style={{ aspectRatio: '1100 / 760' }} />;
    }
    if (!demo || !viewport) return fallback ?? null;
    return (
        <figure className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={`demo-${demoKey}`}>
            <DemoStage demo={demo} viewport={viewport} onExpand={() => setBig(true)} autoPlay />
            {caption && <figcaption className="imcrm-text-xs imcrm-text-muted-foreground">{caption}</figcaption>}
            <Dialog.Root open={big} onOpenChange={setBig}>
                <Dialog.Portal>
                    <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/55 imcrm-backdrop-blur-sm" />
                    <Dialog.Content
                        data-testid="demo-dialog"
                        aria-describedby={undefined}
                        className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[calc(100dvh-1.5rem)] imcrm-w-[min(1180px,calc(100%-1.5rem))] imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-lg sm:imcrm-p-5"
                    >
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{demo.title}</Dialog.Title>
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded-md imcrm-p-1.5 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        </div>
                        {big && <DemoStage demo={demo} viewport={viewport} autoPlay large />}
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </figure>
    );
}

function DemoStage({
    demo,
    viewport,
    onExpand,
    autoPlay,
    large,
}: {
    demo: Demo;
    viewport: DemoManifest['viewport'];
    onExpand?: () => void;
    autoPlay: boolean;
    large?: boolean;
}): JSX.Element {
    const reduced = useMemo(reducedMotion, []);
    const box = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);
    const [inView, setInView] = useState(false);
    const [i, setI] = useState(0);
    const [playing, setPlaying] = useState(autoPlay && !reduced);
    const [phase, setPhase] = useState(0); // 0 llega el cuadro · 1 cursor y cámara · 2 acción
    const [ended, setEnded] = useState(false);
    const frames = demo.frames;
    const frame = frames[i]!;
    const prevTarget = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const update = (): void => setWidth(el.clientWidth);
        update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        ro?.observe(el);
        const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => setInView(e?.isIntersecting ?? false), { threshold: 0.35 }) : null;
        io?.observe(el);
        if (!io) setInView(true);
        return () => {
            ro?.disconnect();
            io?.disconnect();
        };
    }, []);

    // Precarga de todos los cuadros (son pocos y livianos).
    useEffect(() => {
        for (const f of frames) {
            const img = new Image();
            img.src = MEDIA_BASE + f.src;
        }
    }, [frames]);

    // Las fases de cada cuadro.
    useEffect(() => {
        if (reduced) {
            setPhase(2);
            return;
        }
        setPhase(0);
        const t1 = window.setTimeout(() => setPhase(1), 350);
        const t2 = window.setTimeout(() => setPhase(2), 1350);
        return () => {
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [i, reduced]);

    const go = useCallback(
        (n: number) => {
            const cur = frames[i];
            if (cur?.target) prevTarget.current = { x: cur.target.x + cur.target.w / 2, y: cur.target.y + cur.target.h / 2 };
            setEnded(false);
            setI(((n % frames.length) + frames.length) % frames.length);
        },
        [frames, i],
    );

    // Avance automático mientras se ve.
    useEffect(() => {
        if (!playing || !inView) return;
        const t = window.setTimeout(() => {
            if (i === frames.length - 1) {
                setEnded(true);
                setPlaying(false);
            } else go(i + 1);
        }, frameDuration(frame));
        return () => window.clearTimeout(t);
    }, [playing, inView, i, frame, frames.length, go]);

    const vw = viewport.width;
    const vh = viewport.height;
    const fit = width > 0 ? width / vw : 0;
    const z = phase >= 1 && frame.action !== 'view' ? zoomFor(width, vw, frame.target) : 1;
    const pan = phase >= 1 ? panFor(z, vw, vh, frame.target) : { x: 0, y: 0 };
    const scale = fit * z;
    const tCenter = frame.target ? { x: frame.target.x + frame.target.w / 2, y: frame.target.y + frame.target.h / 2 } : null;
    const cursorStart = prevTarget.current ?? { x: vw * 0.78, y: vh * 0.82 };
    const cursorAt =
        frame.action === 'drag' && frame.to && phase >= 2
            ? { x: frame.to.x + frame.to.w / 2, y: frame.to.y + frame.to.h / 2 }
            : phase >= 1 && tCenter
              ? tCenter
              : cursorStart;
    const showCursor = frame.action === 'click' || frame.action === 'hover' || frame.action === 'type' || frame.action === 'drag';
    const camTransition = reduced ? 'none' : 'transform 950ms cubic-bezier(.45,0,.2,1)';

    const onKey = (e: React.KeyboardEvent): void => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            setPlaying(false);
            go(i + 1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setPlaying(false);
            go(i - 1);
        } else if (e.key === ' ') {
            e.preventDefault();
            setPlaying((p) => !p);
        }
    };

    return (
        <div
            className="imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-sm focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
            tabIndex={0}
            onKeyDown={onKey}
            role="group"
            aria-roledescription={__('demostración')}
            aria-label={demo.title}
        >
            <div ref={box} className="imcrm-relative imcrm-w-full imcrm-overflow-hidden imcrm-bg-muted" style={{ aspectRatio: `${vw} / ${vh}` }}>
                {fit > 0 && (
                    <div
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            width: vw,
                            height: vh,
                            transformOrigin: '0 0',
                            transform: `scale(${scale}) translate(${-pan.x}px, ${-pan.y}px)`,
                            transition: camTransition,
                        }}
                    >
                        <img
                            key={frame.src}
                            src={MEDIA_BASE + frame.src}
                            alt={frame.caption}
                            width={vw}
                            height={vh}
                            draggable={false}
                            className={cn('imcrm-block imcrm-select-none', !reduced && 'imcrm-animate-in imcrm-fade-in imcrm-duration-300')}
                            style={{ width: vw, height: vh }}
                        />
                        <Overlays frame={frame} phase={phase} scale={scale} reduced={reduced} vw={vw} />
                        {showCursor && (
                            <Cursor
                                x={cursorAt.x}
                                y={cursorAt.y}
                                scale={scale}
                                moving={phase >= 1}
                                pressed={phase >= 2 && (frame.action === 'click' || frame.action === 'drag')}
                                reduced={reduced}
                                dragging={frame.action === 'drag'}
                            />
                        )}
                    </div>
                )}
                <div className="imcrm-absolute imcrm-right-2 imcrm-top-2 imcrm-flex imcrm-gap-1.5">
                    {onExpand && (
                        <button
                            type="button"
                            onClick={onExpand}
                            className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-black/55 imcrm-text-white imcrm-backdrop-blur hover:imcrm-bg-black/70 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-white"
                            aria-label={__('Ver en grande')}
                            title={__('Ver en grande')}
                            data-testid="demo-expand"
                        >
                            <Maximize2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        </button>
                    )}
                </div>
                {ended && (
                    <button
                        type="button"
                        onClick={() => {
                            go(0);
                            prevTarget.current = null;
                            setPlaying(!reduced);
                        }}
                        className="imcrm-absolute imcrm-inset-0 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-bg-black/35 imcrm-text-white imcrm-backdrop-blur-[1px]"
                        data-testid="demo-replay"
                    >
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-bg-black/60 imcrm-px-4 imcrm-py-2 imcrm-text-sm imcrm-font-medium">
                            <RotateCcw className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            {__('Ver de nuevo')}
                        </span>
                    </button>
                )}
            </div>

            <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border', large ? 'imcrm-p-4' : 'imcrm-p-3')}>
                <div className="imcrm-flex imcrm-gap-1" role="tablist" aria-label={__('Pasos de la demostración')}>
                    {frames.map((f, n) => (
                        <button
                            key={f.src}
                            type="button"
                            role="tab"
                            aria-selected={n === i}
                            aria-label={sprintf(__('Paso %1$d: %2$s'), n + 1, f.caption)}
                            onClick={() => {
                                setPlaying(false);
                                go(n);
                            }}
                            className="imcrm-group imcrm-h-4 imcrm-flex-1 imcrm-py-1.5 focus-visible:imcrm-outline-none"
                            data-testid={`demo-step-${n + 1}`}
                        >
                            <span className="imcrm-relative imcrm-block imcrm-h-1 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted group-focus-visible:imcrm-ring-2 group-focus-visible:imcrm-ring-ring">
                                <span
                                    key={n === i ? `${i}-${playing}-${inView}` : 'x'}
                                    className="imcrm-absolute imcrm-inset-y-0 imcrm-left-0 imcrm-rounded-full imcrm-bg-primary"
                                    style={
                                        n < i || (n === i && (!playing || !inView))
                                            ? { width: n < i ? '100%' : '100%', opacity: n === i ? 1 : 0.55 }
                                            : n === i
                                              ? ({ width: '0%', animation: `demo-progress ${frameDuration(f)}ms linear forwards` } as CSSProperties)
                                              : { width: 0 }
                                    }
                                />
                            </span>
                        </button>
                    ))}
                </div>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <p className={cn('imcrm-min-w-0 imcrm-flex-1 imcrm-leading-relaxed', large ? 'imcrm-text-sm' : 'imcrm-text-[13px]')} aria-live="polite" data-testid="demo-caption">
                        <span className="imcrm-mr-1.5 imcrm-inline-flex imcrm-h-5 imcrm-min-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/12 imcrm-px-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary">
                            {i + 1}
                        </span>
                        {frame.caption}
                    </p>
                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5">
                        <IconBtn label={__('Anterior')} onClick={() => (setPlaying(false), go(i - 1))} disabled={i === 0} testId="demo-prev">
                            <ChevronLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </IconBtn>
                        <IconBtn
                            label={playing ? __('Pausar') : __('Reproducir')}
                            onClick={() => {
                                if (ended) {
                                    go(0);
                                    prevTarget.current = null;
                                }
                                setPlaying((p) => !p);
                            }}
                            testId="demo-play"
                        >
                            {playing ? <Pause className="imcrm-h-4 imcrm-w-4" aria-hidden /> : <Play className="imcrm-h-4 imcrm-w-4" aria-hidden />}
                        </IconBtn>
                        <IconBtn label={__('Siguiente')} onClick={() => (setPlaying(false), go(i + 1))} disabled={i === frames.length - 1} testId="demo-next">
                            <ChevronRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </IconBtn>
                    </div>
                </div>
            </div>
            <style>{'@keyframes demo-progress{to{width:100%}}@keyframes demo-ripple{0%{opacity:.9;transform:translate(-50%,-50%) scale(.3)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}@keyframes demo-pulse{0%,100%{box-shadow:0 0 0 0 hsl(var(--imcrm-primary)/.45)}50%{box-shadow:0 0 0 6px hsl(var(--imcrm-primary)/0)}}@keyframes demo-caret{50%{opacity:0}}'}</style>
        </div>
    );
}

function IconBtn({
    label,
    onClick,
    disabled,
    children,
    testId,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
    testId: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            data-testid={testId}
            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-35 disabled:hover:imcrm-bg-transparent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
        >
            {children}
        </button>
    );
}

/** Lo que se dibuja encima del cuadro, en sus coordenadas (se acerca con la cámara). */
function Overlays({ frame, phase, scale, reduced, vw }: { frame: DemoFrame; phase: number; scale: number; reduced: boolean; vw: number }): JSX.Element | null {
    const t = frame.target;
    if (!t) return null;
    const px = (n: number): number => n / Math.max(scale, 0.01); // grosores que se ven igual con cualquier zoom
    const pad = px(5);
    const ring: CSSProperties = {
        position: 'absolute',
        left: t.x - pad,
        top: t.y - pad,
        width: t.w + pad * 2,
        height: t.h + pad * 2,
        borderRadius: px(9),
        pointerEvents: 'none',
        transition: reduced ? 'none' : 'opacity 400ms ease',
    };
    if (frame.action === 'look') {
        return (
            <div
                style={{
                    ...ring,
                    opacity: phase >= 1 ? 1 : 0,
                    boxShadow: `0 0 0 9999px rgba(15,23,42,.42), 0 0 0 ${px(2)}px hsl(var(--imcrm-primary))`,
                }}
            />
        );
    }
    return (
        <>
            <div
                style={{
                    ...ring,
                    opacity: phase >= 1 ? 1 : 0,
                    border: `${px(2)}px solid hsl(var(--imcrm-primary))`,
                    background: 'hsl(var(--imcrm-primary) / .08)',
                    animation: reduced || phase < 2 ? undefined : 'demo-pulse 1.6s ease-in-out infinite',
                }}
            />
            {frame.action === 'click' && phase >= 2 && !reduced && (
                <span
                    style={{
                        position: 'absolute',
                        left: t.x + t.w / 2,
                        top: t.y + t.h / 2,
                        width: px(44),
                        height: px(44),
                        borderRadius: 999,
                        background: 'hsl(var(--imcrm-primary) / .35)',
                        animation: 'demo-ripple 700ms ease-out forwards',
                        pointerEvents: 'none',
                    }}
                />
            )}
            {frame.action === 'type' && frame.text && phase >= 2 && <Typing frame={frame} reduced={reduced} />}
            {frame.action === 'drag' && frame.to && (
                <div
                    style={{
                        position: 'absolute',
                        left: phase >= 2 ? frame.to.x + frame.to.w / 2 - t.w / 2 : t.x,
                        top: phase >= 2 ? frame.to.y + frame.to.h / 2 - t.h / 2 : t.y,
                        width: t.w,
                        height: t.h,
                        opacity: phase >= 1 ? 0.92 : 0,
                        borderRadius: px(6),
                        boxShadow: '0 18px 36px -12px rgba(15,23,42,.5)',
                        transform: phase >= 1 ? 'rotate(1.5deg)' : 'none',
                        transition: reduced ? 'none' : 'left 900ms cubic-bezier(.45,0,.2,1), top 900ms cubic-bezier(.45,0,.2,1), opacity 300ms',
                        backgroundImage: `url(${MEDIA_BASE + frame.src})`,
                        backgroundSize: `${vw}px auto`,
                        backgroundPosition: `${-t.x}px ${-t.y}px`,
                        pointerEvents: 'none',
                    }}
                />
            )}
        </>
    );
}

/** El texto que se «escribe» dentro del campo. */
function Typing({ frame, reduced }: { frame: DemoFrame; reduced: boolean }): JSX.Element {
    const t = frame.target!;
    const text = frame.text ?? '';
    const [n, setN] = useState(reduced ? text.length : 0);
    useEffect(() => {
        if (reduced) return;
        setN(0);
        let k = 0;
        const id = window.setInterval(() => {
            k += 1;
            setN(k);
            if (k >= text.length) window.clearInterval(id);
        }, 65);
        return () => window.clearInterval(id);
    }, [text, reduced]);
    const size = Math.max(11, Math.min(t.h * 0.42, 16));
    return (
        <span
            style={{
                position: 'absolute',
                left: t.x + Math.min(12, t.w * 0.06),
                top: t.y,
                height: t.h,
                maxWidth: t.w - 16,
                display: 'flex',
                alignItems: 'center',
                fontSize: size,
                color: 'hsl(var(--imcrm-foreground))',
                background: 'hsl(var(--imcrm-card))',
                paddingRight: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                pointerEvents: 'none',
            }}
        >
            {text.slice(0, n)}
            <span style={{ display: 'inline-block', width: 1.5, height: size * 1.1, marginLeft: 1, background: 'hsl(var(--imcrm-foreground))', animation: 'demo-caret 1s step-end infinite' }} />
        </span>
    );
}

/** El puntero, siempre del mismo tamaño en pantalla aunque la cámara se acerque. */
function Cursor({
    x,
    y,
    scale,
    moving,
    pressed,
    reduced,
    dragging,
}: {
    x: number;
    y: number;
    scale: number;
    moving: boolean;
    pressed: boolean;
    reduced: boolean;
    dragging: boolean;
}): JSX.Element {
    const s = 1 / Math.max(scale, 0.01);
    return (
        <span
            aria-hidden
            style={{
                position: 'absolute',
                left: x,
                top: y,
                zIndex: 5,
                pointerEvents: 'none',
                transformOrigin: '0 0',
                transform: `scale(${s * (pressed && !dragging ? 0.86 : 1)})`,
                transition: reduced
                    ? 'none'
                    : `left ${dragging && pressed ? 900 : 950}ms cubic-bezier(.45,0,.2,1), top ${dragging && pressed ? 900 : 950}ms cubic-bezier(.45,0,.2,1), transform ${moving ? 950 : 0}ms cubic-bezier(.45,0,.2,1)`,
            }}
        >
            <svg width="22" height="25" viewBox="0 0 16 18" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))', display: 'block' }}>
                <path d="M1 1l5.4 15.2 2.3-6.4 6.4-2.3L1 1z" fill="#111827" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
        </span>
    );
}
