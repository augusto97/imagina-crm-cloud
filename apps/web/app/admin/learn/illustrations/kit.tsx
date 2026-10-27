import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Kit de las ilustraciones animadas del centro de aprendizaje (v0.1.322).
 *
 * Cada ilustración es una mini pantalla DIBUJADA con piezas de la app
 * (ventanas, filas, chips, tarjetas, un cursor) sobre un escenario de 480×300
 * puntos que se escala al ancho disponible. Los colores salen de los tokens
 * del tema (`--imcrm-*`), así toma el color de la marca de cada empresa y se
 * ve bien en claro y en oscuro sin dibujar dos veces.
 *
 * Las animaciones son CSS: cada ilustración declara sus `@keyframes` en un
 * `<Keyframes>` con nombres propios (prefijo = nombre del archivo) y todas
 * comparten un mismo ciclo (`--ill-cycle`, 7 s por defecto). El estilo SIN
 * animación es el cuadro final: con «reducir movimiento» se ve una escena
 * quieta y completa. Fuera de pantalla se pausa (no gasta batería).
 */

export const STAGE_W = 480;
export const STAGE_H = 300;

type Tone = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

/** Color de un tono del tema (los mismos de los indicadores de la app). */
export function tone(t: Tone, alpha = 1): string {
    return alpha === 1 ? `hsl(var(--imcrm-tone-${t}))` : `hsl(var(--imcrm-tone-${t}) / ${alpha})`;
}
export const primary = (alpha = 1): string => (alpha === 1 ? 'hsl(var(--imcrm-primary))' : `hsl(var(--imcrm-primary) / ${alpha})`);
export const C = {
    card: 'hsl(var(--imcrm-card))',
    fg: 'hsl(var(--imcrm-foreground))',
    muted: 'hsl(var(--imcrm-muted))',
    mutedFg: 'hsl(var(--imcrm-muted-foreground))',
    border: 'hsl(var(--imcrm-border))',
    canvas: 'hsl(var(--imcrm-canvas))',
    success: 'hsl(var(--imcrm-success))',
    warning: 'hsl(var(--imcrm-warning))',
    destructive: 'hsl(var(--imcrm-destructive))',
    primaryFg: 'hsl(var(--imcrm-primary-foreground))',
} as const;

const prefersReduced = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * El escenario: fondo con degradado suave en el color de la marca, una grilla
 * de puntos, y el lienzo de 480×300 escalado al ancho del contenedor.
 */
export function Stage({
    children,
    label,
    cycle = 7,
    tint = 'violet',
}: {
    children: ReactNode;
    /** Qué muestra la escena (para lectores de pantalla). */
    label: string;
    /** Segundos de un ciclo completo de la animación. */
    cycle?: number;
    /** Segundo color del degradado de fondo. */
    tint?: Tone;
}): JSX.Element {
    const box = useRef<HTMLDivElement | null>(null);
    const [scale, setScale] = useState(1);
    const [visible, setVisible] = useState(true);
    const reduced = prefersReduced();

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const update = (): void => setScale(el.clientWidth / STAGE_W || 1);
        update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        ro?.observe(el);
        const io =
            typeof IntersectionObserver !== 'undefined'
                ? new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? true), { threshold: 0.05 })
                : null;
        io?.observe(el);
        return () => {
            ro?.disconnect();
            io?.disconnect();
        };
    }, []);

    return (
        <div
            ref={box}
            role="img"
            aria-label={label}
            className="ill-stage imcrm-relative imcrm-w-full imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border"
            data-paused={visible ? undefined : ''}
            data-reduced={reduced ? '' : undefined}
            style={
                {
                    aspectRatio: `${STAGE_W} / ${STAGE_H}`,
                    background: `radial-gradient(120% 90% at 0% 0%, ${primary(0.16)} 0%, transparent 55%), radial-gradient(110% 90% at 100% 100%, ${tone(tint, 0.16)} 0%, transparent 55%), ${C.canvas}`,
                    '--ill-cycle': `${cycle}s`,
                } as CSSProperties
            }
        >
            <style>{STAGE_CSS}</style>
            <div
                aria-hidden
                className="imcrm-absolute imcrm-inset-0"
                style={{
                    backgroundImage: `radial-gradient(${C.border} 1px, transparent 1px)`,
                    backgroundSize: '18px 18px',
                    opacity: 0.55,
                    maskImage: 'linear-gradient(180deg, black, transparent 85%)',
                }}
            />
            <div
                aria-hidden
                className="imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-origin-top-left"
                style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, fontFamily: 'inherit', color: C.fg }}
            >
                {children}
            </div>
        </div>
    );
}

const STAGE_CSS = `
.ill-stage [data-a]{animation-duration:var(--ill-cycle);animation-iteration-count:infinite;animation-timing-function:cubic-bezier(.4,0,.2,1);animation-fill-mode:both}
.ill-stage[data-paused] *{animation-play-state:paused!important}
.ill-stage[data-reduced] *{animation:none!important}
@media (prefers-reduced-motion: reduce){.ill-stage *{animation:none!important}}
`;

/** Las `@keyframes` propias de una ilustración (nombres con su prefijo). */
export function Keyframes({ css }: { css: string }): JSX.Element {
    return <style>{css}</style>;
}

/**
 * Atajo para animar: `anim('ka-card')` → estilo con la animación del ciclo.
 * `delay` en segundos (negativo = arranca adelantada).
 */
export function anim(name: string, extra: CSSProperties = {}): { 'data-a': ''; style: CSSProperties } {
    return { 'data-a': '', style: { animationName: name, ...extra } };
}

/** Caja posicionada en el lienzo. */
export function At({
    x,
    y,
    w,
    h,
    children,
    style,
    a,
}: {
    x: number;
    y: number;
    w?: number;
    h?: number;
    children?: ReactNode;
    style?: CSSProperties;
    /** Nombre de la animación (de sus `Keyframes`). */
    a?: string;
}): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{ position: 'absolute', left: x, top: y, width: w, height: h, ...(a ? { animationName: a } : null), ...style }}
        >
            {children}
        </div>
    );
}

/** Una ventana de la app: tarjeta con sombra y cabecera con título. */
export function Win({
    x,
    y,
    w,
    h,
    title,
    children,
    a,
    style,
}: {
    x: number;
    y: number;
    w: number;
    h: number;
    title?: ReactNode;
    children?: ReactNode;
    a?: string;
    style?: CSSProperties;
}): JSX.Element {
    return (
        <At
            x={x}
            y={y}
            w={w}
            h={h}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                boxShadow: '0 10px 30px -12px rgba(15,23,42,.28), 0 2px 6px -2px rgba(15,23,42,.12)',
                overflow: 'hidden',
                ...style,
            }}
        >
            {title !== undefined && (
                <div
                    style={{
                        height: 26,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '0 10px',
                        borderBottom: `1px solid ${C.border}`,
                        fontSize: 10.5,
                        fontWeight: 600,
                    }}
                >
                    <span style={{ display: 'flex', gap: 3 }}>
                        {[0.9, 0.6, 0.35].map((o) => (
                            <span key={o} style={{ width: 6, height: 6, borderRadius: 99, background: C.mutedFg, opacity: o * 0.5 }} />
                        ))}
                    </span>
                    <span style={{ marginLeft: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                </div>
            )}
            <div style={{ position: 'relative', height: title !== undefined ? h - 26 : h }}>{children}</div>
        </At>
    );
}

/** Una línea de texto «borrosa» (esqueleto). */
export function Bar({ w, h = 6, color = C.muted, style }: { w: number | string; h?: number; color?: string; style?: CSSProperties }): JSX.Element {
    return <span style={{ display: 'block', width: w, height: h, borderRadius: 99, background: color, ...style }} />;
}

/** Texto real, chico, como en la app. */
export function T({
    children,
    size = 10,
    weight = 500,
    color = C.fg,
    style,
}: {
    children: ReactNode;
    size?: number;
    weight?: number;
    color?: string;
    style?: CSSProperties;
}): JSX.Element {
    return <span style={{ fontSize: size, fontWeight: weight, color, lineHeight: 1.25, whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

/** Chip de opción sólido, como los de selección de la tabla. */
export function Chip({ label, t = 'blue', style }: { label: string; t?: Tone; style?: CSSProperties }): JSX.Element {
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                height: 16,
                padding: '0 7px',
                borderRadius: 5,
                fontSize: 9,
                fontWeight: 600,
                color: '#fff',
                background: tone(t),
                whiteSpace: 'nowrap',
                ...style,
            }}
        >
            {label}
        </span>
    );
}

/** Pastilla suave (fondo tenue + texto del tono). */
export function Pill({ label, t = 'blue', icon, style }: { label: ReactNode; t?: Tone; icon?: ReactNode; style?: CSSProperties }): JSX.Element {
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 18,
                padding: '0 8px',
                borderRadius: 99,
                fontSize: 9.5,
                fontWeight: 600,
                color: tone(t),
                background: tone(t, 0.14),
                whiteSpace: 'nowrap',
                ...style,
            }}
        >
            {icon}
            {label}
        </span>
    );
}

/** Avatar con iniciales. */
export function Avatar({ initials, t = 'violet', size = 18 }: { initials: string; t?: Tone; size?: number }): JSX.Element {
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: 99,
                background: tone(t, 0.2),
                color: tone(t),
                fontSize: size * 0.42,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            {initials}
        </span>
    );
}

/** Botón de la app. */
export function Btn({ label, kind = 'primary', style }: { label: ReactNode; kind?: 'primary' | 'outline'; style?: CSSProperties }): JSX.Element {
    const isP = kind === 'primary';
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                height: 20,
                padding: '0 9px',
                borderRadius: 6,
                fontSize: 9.5,
                fontWeight: 600,
                color: isP ? C.primaryFg : C.fg,
                background: isP ? primary() : C.card,
                border: isP ? 'none' : `1px solid ${C.border}`,
                whiteSpace: 'nowrap',
                ...style,
            }}
        >
            {label}
        </span>
    );
}

/** Ícono dentro de un cuadrado de color (como los de listas y tableros). */
export function IconSquare({ children, t = 'violet', size = 22 }: { children: ReactNode; t?: Tone; size?: number }): JSX.Element {
    return (
        <span
            style={{
                width: size,
                height: size,
                borderRadius: 6,
                background: tone(t),
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            {children}
        </span>
    );
}

/**
 * El puntero del mouse. Se mueve con la animación que le pases (usa
 * `transform: translate(...)` en sus keyframes); `click` = nombre de una
 * animación para el anillo del clic (opacidad/escala).
 */
export function Cursor({ x = 0, y = 0, a, click, rest }: { x?: number; y?: number; a?: string; click?: string; rest?: [number, number] }): JSX.Element {
    return (
        <At x={x} y={y} a={a} style={{ zIndex: 50, pointerEvents: 'none', transform: rest ? `translate(${rest[0]}px,${rest[1]}px)` : undefined }}>
            {click && (
                <span
                    data-a=""
                    style={{
                        position: 'absolute',
                        left: -9,
                        top: -9,
                        width: 18,
                        height: 18,
                        borderRadius: 99,
                        border: `2px solid ${primary()}`,
                        opacity: 0,
                        animationName: click,
                    }}
                />
            )}
            <svg width="16" height="18" viewBox="0 0 16 18" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}>
                <path d="M1 1l5.4 15.2 2.3-6.4 6.4-2.3L1 1z" fill="#111827" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
        </At>
    );
}

/** Globo de mensaje (WhatsApp, correo, chat). */
export function Bubble({
    children,
    side = 'left',
    color,
    style,
}: {
    children: ReactNode;
    side?: 'left' | 'right';
    color?: string;
    style?: CSSProperties;
}): JSX.Element {
    const bg = color ?? (side === 'right' ? tone('mint', 0.2) : C.card);
    return (
        <span
            style={{
                display: 'inline-block',
                maxWidth: 200,
                padding: '6px 9px',
                borderRadius: 10,
                borderTopLeftRadius: side === 'left' ? 3 : 10,
                borderTopRightRadius: side === 'right' ? 3 : 10,
                background: bg,
                border: `1px solid ${C.border}`,
                fontSize: 9.5,
                lineHeight: 1.35,
                color: C.fg,
                boxShadow: '0 4px 12px -6px rgba(15,23,42,.25)',
                ...style,
            }}
        >
            {children}
        </span>
    );
}

/** Línea de conexión punteada animada (de un paso a otro). */
export function Flow({ x1, y1, x2, y2, a }: { x1: number; y1: number; x2: number; y2: number; a?: string }): JSX.Element {
    const w = Math.max(Math.abs(x2 - x1), 2);
    const h = Math.max(Math.abs(y2 - y1), 2);
    return (
        <svg
            data-a={a ? '' : undefined}
            width={w + 4}
            height={h + 4}
            style={{ position: 'absolute', left: Math.min(x1, x2) - 2, top: Math.min(y1, y2) - 2, overflow: 'visible', ...(a ? { animationName: a } : null) }}
        >
            <path
                d={`M ${x1 - Math.min(x1, x2) + 2} ${y1 - Math.min(y1, y2) + 2} C ${(x1 + x2) / 2 - Math.min(x1, x2) + 2} ${y1 - Math.min(y1, y2) + 2}, ${(x1 + x2) / 2 - Math.min(x1, x2) + 2} ${y2 - Math.min(y1, y2) + 2}, ${x2 - Math.min(x1, x2) + 2} ${y2 - Math.min(y1, y2) + 2}`}
                fill="none"
                stroke={primary(0.55)}
                strokeWidth="1.6"
                strokeDasharray="4 4"
                className="ill-flow"
            />
            <style>{'.ill-flow{animation:ill-dash 1s linear infinite}@keyframes ill-dash{to{stroke-dashoffset:-16}}'}</style>
        </svg>
    );
}
