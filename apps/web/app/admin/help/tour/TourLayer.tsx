import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Check, Compass, Keyboard, Lightbulb, MousePointer2, PartyPopper, Wand2, X } from 'lucide-react';

import { lazyWithReload } from '@/lib/lazyWithReload';

import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __, sprintf } from '@/lib/i18n';
import { isTypingTarget } from '@/lib/shortcuts';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

import { help } from '../helpBus';
import { InlineRich } from '../RichLite';
import { BALLOON_GAP, holeBox, mobileCardEdge, placeBalloon, wellInView, type Box } from './geometry';
import { routeMatches, stepProgress } from './resolve';
import { tourStore, useTourRun } from './tourStore';

const TourArt = lazyWithReload(() => import('./TourCards').then((m) => ({ default: m.TourArt })));
const TourIntroCard = lazyWithReload(() => import('./TourCards').then((m) => ({ default: m.TourIntroCard })));
const TourOutroCard = lazyWithReload(() => import('./TourCards').then((m) => ({ default: m.TourOutroCard })));

/** Ancho del globo de un paso (escritorio). */
const BALLOON_W = 360;

/** Encima de todo lo de la app: diálogos y menús de Radix van en z-50. */
const LAYER_Z = 80;
const SEEK_INTERVAL_MS = 120;
/** Cada cuánto se mira si el elemento ya quedó quieto, y cuánto se lo espera. */
const SETTLE_INTERVAL_MS = 60;
const SETTLE_MAX_MS = 1500;
/** Si el elemento desaparece por más de esto, el globo se centra. */
const LOST_AFTER_MS = 1200;

export type TourOutcome = 'completed' | 'dismissed';

/** El primer elemento VISIBLE con ese `data-tour` (puede haber uno por pantalla). */
export function findTourTarget(name: string): HTMLElement | null {
    const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
    const vw = window.innerWidth;
    for (const el of nodes) {
        if (!el.isConnected || el.closest('[inert]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        // Fuera de la pantalla hacia los lados = cajón del menú cerrado.
        if (r.right <= 0 || r.left >= vw) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        return el;
    }
    return null;
}

function toBox(r: DOMRect): Box {
    return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sameBox(a: Box | null, b: Box | null): boolean {
    if (a === null || b === null) return a === b;
    return (
        Math.abs(a.top - b.top) < 0.5 &&
        Math.abs(a.left - b.left) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5 &&
        Math.abs(a.height - b.height) < 0.5
    );
}

/**
 * Fase 7 — el motor de los recorridos: una capa por encima de la app (portal
 * al `<body>`) que oscurece todo menos el elemento señalado y muestra el
 * globo del paso.
 *
 * Lo delicado:
 *  - El elemento puede estar DENTRO de un diálogo o menú de Radix que abrió el
 *    paso anterior. Un diálogo modal de Radix cierra con cualquier
 *    `pointerdown` afuera, le roba el foco a lo que esté fuera de él y apaga
 *    los clics del `<body>`: la capa corta esos eventos en su raíz y se
 *    prende `pointer-events` sólo donde hace falta.
 *  - El scroller de la app es el `<main>`, no la ventana: la posición se
 *    re-mide con cualquier scroll (en captura), con ResizeObserver y con un
 *    chequeo cada 250 ms (los datos que cargan arriba mueven el elemento).
 *  - Un elemento que no aparece (no hay permisos, la lista está vacía) no
 *    rompe el recorrido: el paso se salta solo.
 */
export function TourLayer({
    onFinish,
}: {
    onFinish: (tourId: string, outcome: TourOutcome, shown: number) => void;
}): JSX.Element | null {
    const run = useTourRun();
    const navigate = useNavigate();
    const location = useLocation();
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const asCard = useMediaQuery('(max-width: 639px)');
    const theme = useTheme();

    const step = run ? (run.steps[run.index] ?? null) : null;
    const [target, setTarget] = useState<HTMLElement | null>(null);
    const [phase, setPhase] = useState<'seeking' | 'showing'>('seeking');
    const [box, setBox] = useState<Box | null>(null);
    const [lost, setLost] = useState(false);
    const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const [balloonSize, setBalloonSize] = useState({ width: BALLOON_W, height: 220 });
    /** En un paso de escribir: ¿ya escribió algo? */
    const [typed, setTyped] = useState(false);

    const layerRef = useRef<HTMLDivElement | null>(null);
    const [balloonEl, setBalloonEl] = useState<HTMLDivElement | null>(null);
    const primaryRef = useRef<HTMLButtonElement | null>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const runIdRef = useRef<string | null>(null);

    // Al empezar, recordar dónde estaba el foco para devolverlo al terminar.
    useEffect(() => {
        const id = run?.tourId ?? null;
        if (id !== null && runIdRef.current === null) {
            restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }
        if (id === null && runIdRef.current !== null) {
            const prev = restoreFocusRef.current;
            restoreFocusRef.current = null;
            if (prev && prev.isConnected) prev.focus({ preventScroll: true });
        }
        runIdRef.current = id;
    }, [run?.tourId]);

    const finish = useCallback(
        (outcome: TourOutcome) => {
            const r = tourStore.get();
            if (!r) return;
            // Cerrar el cierre (con la X o con Esc) es terminar, no abandonar.
            const atOutro = r.steps[r.index]?.kind === 'outro';
            tourStore.stop();
            onFinish(r.tourId, atOutro ? 'completed' : outcome, r.shown);
        },
        [onFinish],
    );

    /** Desde el cierre: terminar éste y empezar otro (o el mismo de nuevo). */
    const startAnother = useCallback(
        (tourId: string, skipIntro: boolean) => {
            finish('completed');
            window.setTimeout(() => help.startTour(tourId, { skipIntro }), 60);
        },
        [finish],
    );

    const go = useCallback(
        (dir: 1 | -1) => {
            const r = tourStore.get();
            if (!r) return;
            const next = r.index + dir;
            if (next >= r.steps.length) {
                finish('completed');
                return;
            }
            if (next < 0) return;
            tourStore.goto(next, dir);
        },
        [finish],
    );

    /**
     * Un paso cuyo elemento no apareció: sale del recorrido (el «2 de 8» se
     * recalcula) y se sigue en la dirección en que se venía.
     */
    const skipMissing = useCallback(() => {
        const r = tourStore.get();
        if (!r) return;
        if (!tourStore.drop(r.index, r.direction)) finish('completed');
    }, [finish]);

    // ── Buscar el elemento del paso (navegando antes si hace falta) ───────
    // En un layout effect: el estado del paso anterior (o del recorrido
    // anterior, que este componente sigue montado) se limpia ANTES de
    // pintar, así nunca se ve un cuadro con el recorte viejo.
    useLayoutEffect(() => {
        if (!run || !step) return;
        let cancelled = false;
        let timer: number | undefined;
        setTarget(null);
        setLost(false);
        setTyped(false);
        setPhase('seeking');
        const navigated = step.route !== null && !routeMatches(step.route, location.pathname, location.search);
        if (navigated) navigate(step.route!);
        if (step.target === null) {
            setPhase('showing');
            tourStore.markShown();
            return;
        }
        const name = step.target;
        const deadline = Date.now() + step.waitMs;
        // Un panel o diálogo que se acaba de abrir todavía se está deslizando:
        // se espera a que el elemento quede QUIETO antes de recortarlo (si no,
        // el recorte llega volando detrás de él). Después, si no se ve entero,
        // se lo trae a la vista y se espera a que el scroll termine.
        let last: Box | null = null;
        let settleUntil = 0;
        let scrolled = false;
        const tick = (): void => {
            if (cancelled) return;
            const found = findTourTarget(name);
            if (found) {
                const now = Date.now();
                if (settleUntil === 0) settleUntil = now + SETTLE_MAX_MS;
                const box = toBox(found.getBoundingClientRect());
                const vp = { width: window.innerWidth, height: window.innerHeight };
                const still = last !== null && sameBox(last, box);
                last = box;
                const settled = now >= settleUntil;
                if (!still && !settled) {
                    timer = window.setTimeout(tick, SETTLE_INTERVAL_MS);
                    return;
                }
                if (!wellInView(box, vp)) {
                    if (!scrolled) {
                        scrolled = true;
                        last = null;
                        settleUntil = now + SETTLE_MAX_MS;
                        found.scrollIntoView({
                            block: box.height > vp.height * 0.6 ? 'start' : 'center',
                            inline: 'nearest',
                            behavior: reducedMotion ? 'auto' : 'smooth',
                        });
                        timer = window.setTimeout(tick, SETTLE_INTERVAL_MS);
                        return;
                    }
                    // El scroll todavía no lo trajo: se espera (con tope).
                    if (!settled) {
                        timer = window.setTimeout(tick, SETTLE_INTERVAL_MS);
                        return;
                    }
                }
                setTarget(found);
                setPhase('showing');
                tourStore.markShown();
                return;
            }
            last = null;
            if (Date.now() > deadline) {
                skipMissing();
                return;
            }
            timer = window.setTimeout(tick, SEEK_INTERVAL_MS);
        };
        // Tras navegar, la página nueva todavía no está: un respiro antes de
        // buscar (si no, se encuentra el elemento de la pantalla anterior).
        timer = window.setTimeout(tick, navigated ? 160 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
        // Sólo al cambiar de paso: la ubicación se lee en ese momento.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run?.seq]);

    // ── Medir mientras se muestra ─────────────────────────────────────────
    useLayoutEffect(() => {
        if (phase !== 'showing' || target === null || !step || step.target === null) {
            setBox(null);
            return;
        }
        const name = step.target;
        let current = target;
        let raf = 0;
        let lostSince: number | null = null;
        const measure = (): void => {
            raf = 0;
            setViewport((v) => (v.width === window.innerWidth && v.height === window.innerHeight ? v : { width: window.innerWidth, height: window.innerHeight }));
            if (!current.isConnected) return;
            const next = toBox(current.getBoundingClientRect());
            setBox((prev) => (sameBox(prev, next) ? prev : next));
        };
        const schedule = (): void => {
            if (raf === 0) raf = window.requestAnimationFrame(measure);
        };
        measure();
        window.addEventListener('resize', schedule);
        document.addEventListener('scroll', schedule, true);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
        ro?.observe(current);
        const check = window.setInterval(() => {
            const r = current.isConnected ? current.getBoundingClientRect() : null;
            const gone = r === null || r.width <= 0 || r.height <= 0;
            if (!gone) {
                lostSince = null;
                setLost(false);
                schedule();
                return;
            }
            // Re-render que reemplazó el nodo: buscarlo de nuevo.
            const again = findTourTarget(name);
            if (again) {
                ro?.unobserve(current);
                current = again;
                ro?.observe(current);
                lostSince = null;
                setLost(false);
                setTarget(again);
                schedule();
                return;
            }
            if (lostSince === null) lostSince = Date.now();
            else if (Date.now() - lostSince > LOST_AFTER_MS) setLost(true);
        }, 250);
        return () => {
            window.removeEventListener('resize', schedule);
            document.removeEventListener('scroll', schedule, true);
            ro?.disconnect();
            window.clearInterval(check);
            if (raf !== 0) window.cancelAnimationFrame(raf);
        };
    }, [phase, target, step]);

    // ── Avanzar cuando aparece lo que abre el paso (un diálogo, la ficha) ──
    useEffect(() => {
        if (phase !== 'showing' || !step || step.advanceOn !== 'appear' || !step.waitFor) return;
        const name = step.waitFor;
        const id = window.setInterval(() => {
            if (findTourTarget(name)) {
                window.clearInterval(id);
                go(1);
            }
        }, 180);
        return () => window.clearInterval(id);
    }, [phase, step, go]);

    // ── Un paso de escribir: celebrar cuando escribe ───────────────────────
    useEffect(() => {
        if (phase !== 'showing' || target === null || !step || step.advanceOn !== 'input') return;
        const el = target;
        const onInput = (e: Event): void => {
            const t = e.target;
            if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) setTyped(t.value.trim().length >= 2);
        };
        el.addEventListener('input', onInput, true);
        return () => el.removeEventListener('input', onInput, true);
    }, [phase, target, step]);

    // ── Avanzar cuando la persona hace clic en el elemento ────────────────
    useEffect(() => {
        if (phase !== 'showing' || target === null || !step || step.advanceOn !== 'click') return;
        const el = target;
        const onClick = (e: MouseEvent): void => {
            if (e.target instanceof Node && el.contains(e.target)) {
                window.setTimeout(() => go(1), 0);
            }
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [phase, target, step, go]);

    // ── Teclado: ← → y Escape (en la ventana y en captura: antes que Radix) ─
    // Tab queda dentro del globo: lo de abajo está tapado por el velo.
    useEffect(() => {
        if (!run) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Tab' && balloonEl) {
                const items = [...balloonEl.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')];
                if (items.length === 0) return;
                e.preventDefault();
                e.stopPropagation();
                const i = items.indexOf(document.activeElement as HTMLElement);
                const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === -1 || i === items.length - 1 ? 0 : i + 1;
                items[next]!.focus();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finish('dismissed');
                return;
            }
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            if (isTypingTarget(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            const s = tourStore.get();
            const cur = s?.steps[s.index];
            if (e.key === 'ArrowLeft') {
                if (cur && cur.kind !== 'outro') go(-1);
            } else if (cur && (cur.advanceOn === 'next' || cur.advanceOn === 'input')) go(1);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [run, go, finish, balloonEl]);

    // ── Aislar la capa de los diálogos de Radix que haya debajo ───────────
    useEffect(() => {
        const root = layerRef.current;
        if (!root) return;
        const stop = (e: Event): void => e.stopPropagation();
        const kinds = ['pointerdown', 'mousedown', 'touchstart', 'focusin'] as const;
        for (const k of kinds) root.addEventListener(k, stop);
        // Un diálogo modal abierto debajo (la ficha) devuelve el foco a sí
        // mismo cuando lo pierde: si el foco viene a la capa, ese aviso no
        // le llega (si no, Enter en «Empezar» caería en un botón de la ficha).
        const onFocusOut = (e: FocusEvent): void => {
            if (e.relatedTarget instanceof Node && root.contains(e.relatedTarget)) e.stopPropagation();
        };
        window.addEventListener('focusout', onFocusOut, true);
        // Un diálogo que se abre DESPUÉS marca a sus hermanos con aria-hidden:
        // el globo tiene que seguir siendo legible para un lector de pantalla.
        const mo = new MutationObserver(() => {
            if (root.getAttribute('aria-hidden') === 'true') root.removeAttribute('aria-hidden');
        });
        mo.observe(root, { attributes: true, attributeFilter: ['aria-hidden'] });
        return () => {
            for (const k of kinds) root.removeEventListener(k, stop);
            window.removeEventListener('focusout', onFocusOut, true);
            mo.disconnect();
        };
    }, [run !== null]); // eslint-disable-line react-hooks/exhaustive-deps

    // Tamaño real del globo (para ubicarlo sin taparse con el elemento): se
    // mide al montarse y cada vez que cambia (otro texto, otra ventana).
    useLayoutEffect(() => {
        const el = balloonEl;
        if (!el) return;
        const measure = (): void => {
            const r = el.getBoundingClientRect();
            setBalloonSize((s) => (Math.abs(s.width - r.width) < 1 && Math.abs(s.height - r.height) < 1 ? s : { width: r.width, height: r.height }));
        };
        measure();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        ro?.observe(el);
        return () => ro?.disconnect();
    }, [balloonEl]);

    // El foco va al botón principal en cada paso.
    useEffect(() => {
        if (phase !== 'showing') return;
        // La portada y el cierre se bajan aparte: se reintenta unos cuadros.
        let tries = 0;
        let raf = 0;
        const focus = (): void => {
            if (primaryRef.current) {
                primaryRef.current.focus({ preventScroll: true });
                return;
            }
            if (++tries < 30) raf = window.requestAnimationFrame(focus);
        };
        focus();
        return () => window.cancelAnimationFrame(raf);
    }, [phase, run?.seq]);

    if (!run || !step) return null;

    const showing = phase === 'showing';
    const isCard = step.kind !== 'step';
    const hole = showing && !isCard && box && !lost ? holeBox(box, viewport) : null;
    const interactive = step.advanceOn !== 'next' && hole !== null;
    const isClickLike = interactive && (step.advanceOn === 'click' || step.advanceOn === 'appear');
    const isInput = interactive && step.advanceOn === 'input';
    const progress = stepProgress(run.steps, run.index);
    const nextIsOutro = run.steps[run.index + 1]?.kind === 'outro' || run.index === run.steps.length - 1;
    const dark = theme.resolved === 'dark';
    const dim = dark ? 'rgba(0,0,0,0.7)' : 'rgba(10,14,22,0.58)';
    const transition = reducedMotion ? undefined : 'top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease';
    // La ilustración acompaña al paso cuando hay lugar: en el celular, sólo
    // en los pasos sin elemento (si no, la tarjeta taparía lo que se explica).
    const showArt = step.art !== null && (asCard ? hole === null && viewport.height >= 640 : viewport.height >= 660);

    let balloonStyle: React.CSSProperties;
    let caret: { style: React.CSSProperties; sides: string } | null = null;
    if (asCard) {
        const edge = mobileCardEdge(hole, viewport);
        balloonStyle = edge === 'bottom' ? { left: 12, right: 12, bottom: 12 } : { left: 12, right: 12, top: 12 };
    } else {
        const pos = placeBalloon(hole, balloonSize, viewport, step.placement);
        balloonStyle = { top: pos.top, left: pos.left, width: BALLOON_W, transition: reducedMotion ? undefined : 'top 220ms ease, left 220ms ease' };
        // La flecha del globo apunta al centro de lo resaltado.
        if (hole && pos.placement !== 'center') {
            const clampX = (v: number): number => Math.min(Math.max(v, 18), balloonSize.width - 32);
            const clampY = (v: number): number => Math.min(Math.max(v, 18), balloonSize.height - 32);
            const cx = hole.left + hole.width / 2 - pos.left - 7;
            const cy = hole.top + hole.height / 2 - pos.top - 7;
            const gapOk = (pos.placement === 'bottom' && pos.top >= hole.top + hole.height + BALLOON_GAP - 1)
                || (pos.placement === 'top' && pos.top + balloonSize.height <= hole.top - BALLOON_GAP + 1)
                || (pos.placement === 'right' && pos.left >= hole.left + hole.width + BALLOON_GAP - 1)
                || (pos.placement === 'left' && pos.left + balloonSize.width <= hole.left - BALLOON_GAP + 1);
            if (gapOk) {
                if (pos.placement === 'bottom') caret = { style: { top: -7, left: clampX(cx) }, sides: 'imcrm-border-l imcrm-border-t' };
                else if (pos.placement === 'top') caret = { style: { bottom: -7, left: clampX(cx) }, sides: 'imcrm-border-r imcrm-border-b' };
                else if (pos.placement === 'right') caret = { style: { left: -7, top: clampY(cy) }, sides: 'imcrm-border-l imcrm-border-b' };
                else caret = { style: { right: -7, top: clampY(cy) }, sides: 'imcrm-border-r imcrm-border-t' };
            }
        }
    }

    const titleId = `imcrm-tour-title-${run.seq}`;
    const bodyId = `imcrm-tour-body-${run.seq}`;
    const touch = asCard;
    const dotsMax = 12;

    return createPortal(
        <div
            ref={layerRef}
            data-testid="tour-layer"
            data-help-overlay=""
            data-tour-id={run.tourId}
            data-tour-step={step.id}
            data-tour-kind={step.kind}
            data-tour-target={step.target ?? ''}
            data-tour-seq={run.seq}
            data-tour-phase={phase}
            className="imcrm-fixed imcrm-inset-0"
            style={{ zIndex: LAYER_Z, pointerEvents: 'none' }}
        >
            {/* Velo: con elemento, cuatro bloques alrededor del recorte (los
                clics afuera no hacen nada); sin elemento, uno entero. */}
            {hole ? (
                <>
                    <div className="imcrm-fixed" style={{ pointerEvents: 'auto', top: 0, left: 0, right: 0, height: hole.top }} />
                    <div className="imcrm-fixed" style={{ pointerEvents: 'auto', top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
                    <div className="imcrm-fixed" style={{ pointerEvents: 'auto', top: hole.top, left: 0, width: hole.left, height: hole.height }} />
                    <div className="imcrm-fixed" style={{ pointerEvents: 'auto', top: hole.top, left: hole.left + hole.width, right: 0, height: hole.height }} />
                    {/* En un paso de «Siguiente» el elemento se ve pero no se toca. */}
                    {!interactive && (
                        <div
                            className="imcrm-fixed"
                            style={{ pointerEvents: 'auto', top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
                        />
                    )}
                    <div
                        aria-hidden
                        data-testid="tour-spotlight"
                        className="imcrm-fixed imcrm-rounded-[10px]"
                        style={{
                            top: hole.top,
                            left: hole.left,
                            width: hole.width,
                            height: hole.height,
                            boxShadow: `0 0 0 2px hsl(var(--imcrm-primary)), 0 0 0 7px hsl(var(--imcrm-primary) / 0.22), 0 0 0 9999px ${dim}`,
                            transition,
                            pointerEvents: 'none',
                        }}
                    />
                    {/* Lo que hay que tocar «late», y una mano lo señala. */}
                    {interactive && !reducedMotion && (
                        <div
                            aria-hidden
                            data-testid="tour-pulse"
                            className="imcrm-tour-pulse imcrm-fixed imcrm-rounded-[10px]"
                            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, pointerEvents: 'none' }}
                        />
                    )}
                    {isClickLike && !touch && (
                        <div
                            aria-hidden
                            data-testid="tour-hand"
                            className="imcrm-fixed"
                            style={{ top: hole.top + hole.height - 10, left: hole.left + hole.width - 14, pointerEvents: 'none', transition }}
                        >
                            <MousePointer2
                                className={cn('imcrm-h-7 imcrm-w-7 imcrm-text-primary imcrm-drop-shadow-md', !reducedMotion && 'imcrm-tour-hand')}
                                fill="hsl(var(--imcrm-primary))"
                                stroke="hsl(var(--imcrm-primary-foreground))"
                                strokeWidth={1.5}
                            />
                        </div>
                    )}
                </>
            ) : (
                <div
                    aria-hidden
                    className="imcrm-fixed imcrm-inset-0"
                    style={{
                        pointerEvents: 'auto',
                        background: showing ? dim : 'transparent',
                        backdropFilter: showing && isCard ? 'blur(2px)' : undefined,
                        transition: reducedMotion ? undefined : 'background 150ms ease',
                    }}
                />
            )}

            {showing && step.kind === 'intro' && (
                <div ref={setBalloonEl}>
                    <Suspense fallback={null}>
                        <TourIntroCard
                            run={run}
                            titleId={titleId}
                            bodyId={bodyId}
                            primaryRef={primaryRef}
                            onStart={() => go(1)}
                            onDismiss={() => finish('dismissed')}
                            reducedMotion={reducedMotion}
                        />
                    </Suspense>
                </div>
            )}

            {showing && step.kind === 'outro' && (
                <div ref={setBalloonEl}>
                    <Suspense fallback={null}>
                        <TourOutroCard
                            run={run}
                            titleId={titleId}
                            bodyId={bodyId}
                            primaryRef={primaryRef}
                            onClose={() => finish('completed')}
                            onRepeat={() => startAnother(run.tourId, true)}
                            onNext={(id) => startAnother(id, false)}
                            reducedMotion={reducedMotion}
                        />
                    </Suspense>
                </div>
            )}

            {showing && step.kind === 'step' && (
                <div
                    ref={setBalloonEl}
                    role="dialog"
                    aria-modal="false"
                    aria-labelledby={titleId}
                    aria-describedby={bodyId}
                    data-testid="tour-balloon"
                    className={cn(
                        'imcrm-fixed imcrm-flex imcrm-flex-col imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                        !reducedMotion && 'imcrm-tour-pop',
                    )}
                    style={{ ...balloonStyle, pointerEvents: 'auto', maxHeight: 'calc(100dvh - 24px)' }}
                >
                    {caret && (
                        <span
                            aria-hidden
                            data-testid="tour-caret"
                            className={cn('imcrm-absolute imcrm-h-3.5 imcrm-w-3.5 imcrm-rotate-45 imcrm-border-border imcrm-bg-card', caret.sides)}
                            style={caret.style}
                        />
                    )}
                    <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-p-4">
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                            <span className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary">
                                <Compass className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                                <span className="imcrm-truncate">{run.title}</span>
                            </span>
                            <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2">
                                {progress.total > 1 && progress.total <= dotsMax && (
                                    <span aria-hidden className="imcrm-flex imcrm-items-center imcrm-gap-1" data-testid="tour-dots">
                                        {Array.from({ length: progress.total }, (_, i) => (
                                            <span
                                                key={i}
                                                className={cn(
                                                    'imcrm-block imcrm-h-1.5 imcrm-rounded-full',
                                                    i + 1 === progress.current ? 'imcrm-w-4 imcrm-bg-primary' : i + 1 < progress.current ? 'imcrm-w-1.5 imcrm-bg-primary/50' : 'imcrm-w-1.5 imcrm-bg-muted-foreground/25',
                                                )}
                                                style={{ transition: reducedMotion ? undefined : 'width 200ms ease' }}
                                            />
                                        ))}
                                    </span>
                                )}
                                <span className="imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                                    <span className="imcrm-sr-only">{run.title}: </span>
                                    <span data-testid="tour-progress">{sprintf(__('%1$d de %2$d'), progress.current, progress.total)}</span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => finish('dismissed')}
                                    aria-label={__('Cerrar el recorrido')}
                                    title={__('Cerrar el recorrido (Esc)')}
                                    className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                >
                                    <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </button>
                            </div>
                        </div>
                        {showArt && step.art && (
                            <Suspense fallback={<div className="imcrm-w-full imcrm-animate-pulse imcrm-rounded-lg imcrm-bg-muted/50" style={{ aspectRatio: '480 / 300' }} />}>
                                <TourArt name={step.art} className="imcrm-border imcrm-border-border/60" testId="tour-art" />
                            </Suspense>
                        )}
                        <div aria-live="polite" className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <h2 id={titleId} className="imcrm-text-base imcrm-font-semibold imcrm-leading-snug imcrm-tracking-tight">
                                {step.title}
                            </h2>
                            <p id={bodyId} className="imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                                <InlineRich text={step.body} />
                            </p>
                        </div>
                        {step.tip && (
                            <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-bg-warning/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-leading-relaxed imcrm-text-foreground/85" data-testid="tour-tip">
                                <Lightbulb className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                                <span>
                                    <InlineRich text={step.tip} />
                                </span>
                            </p>
                        )}
                        {isClickLike && (
                            <p
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-text-primary"
                                data-testid="tour-click-hint"
                            >
                                <MousePointer2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                {touch ? __('Pruébalo tú: toca lo resaltado.') : __('Pruébalo tú: haz clic en lo resaltado.')}
                            </p>
                        )}
                        {isInput &&
                            (typed ? (
                                <p
                                    className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-success/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-text-success"
                                    data-testid="tour-typed"
                                >
                                    <PartyPopper className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                    {__('¡Así se hace! Sigue cuando quieras.')}
                                </p>
                            ) : (
                                <p
                                    className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-font-medium imcrm-text-primary"
                                    data-testid="tour-input-hint"
                                >
                                    <Keyboard className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                                    {__('Pruébalo tú: escribe algo en lo resaltado.')}
                                    <span aria-hidden className="imcrm-tour-caret imcrm-ml-0.5 imcrm-inline-block imcrm-h-3.5 imcrm-w-px imcrm-bg-primary" />
                                </p>
                            ))}
                    </div>
                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2.5">
                        <button
                            type="button"
                            onClick={() => finish('dismissed')}
                            data-testid="tour-skip"
                            className="imcrm-rounded-md imcrm-px-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                        >
                            {__('Saltar recorrido')}
                        </button>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                            {progress.current > 1 && (
                                <button
                                    type="button"
                                    onClick={() => go(-1)}
                                    data-testid="tour-back"
                                    aria-label={__('Anterior')}
                                    title={__('Anterior (←)')}
                                    className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card hover:imcrm-bg-canvas focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                >
                                    <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                </button>
                            )}
                            <button
                                ref={primaryRef}
                                type="button"
                                data-testid="tour-next"
                                onClick={() => {
                                    if (isClickLike && target) {
                                        // «Hacerlo por mí»: el clic del elemento avanza solo.
                                        target.click();
                                        return;
                                    }
                                    go(1);
                                }}
                                className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40 focus-visible:imcrm-ring-offset-2 focus-visible:imcrm-ring-offset-card"
                            >
                                {isClickLike ? (
                                    <>
                                        <Wand2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        {__('Hacerlo por mí')}
                                    </>
                                ) : nextIsOutro ? (
                                    <>
                                        <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                        {__('Terminar')}
                                    </>
                                ) : (
                                    <>
                                        {__('Siguiente')}
                                        <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>,
        document.body,
    );
}
