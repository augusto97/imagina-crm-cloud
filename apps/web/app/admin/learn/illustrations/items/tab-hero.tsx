import { CalendarDays, ChevronDown, CircleDollarSign, Share2, Target, Trophy } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Portada de «Tableros»: un tablero de ventas que se arma solo (indicadores,
 * barras y dona) y, al cambiar el período de «Este mes» a «Este año», todos
 * los números se recalculan a la vez.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const BARS: Array<{ label: string; t: Tn; a: number; b: number; va: string; vb: string }> = [
    { label: 'Nuevo', t: 'cyan', a: 92, b: 118, va: '11,2 M', vb: '38,4 M' },
    { label: 'Contactado', t: 'blue', a: 34, b: 70, va: '3,4 M', vb: '21,9 M' },
    { label: 'Propuesta', t: 'violet', a: 118, b: 132, va: '12,9 M', vb: '44,0 M' },
    { label: 'Ganado', t: 'mint', a: 80, b: 104, va: '8,9 M', vb: '33,5 M' },
    { label: 'Perdido', t: 'rose', a: 26, b: 40, va: '2,8 M', vb: '12,1 M' },
];

// Dona: perímetro de un círculo de radio 26 ≈ 163.
const DONUT: Array<{ t: Tn; len: number; off: number }> = [
    { t: 'cyan', len: 62, off: 0 },
    { t: 'amber', len: 48, off: -62 },
    { t: 'mint', len: 33, off: -110 },
    { t: 'violet', len: 20, off: -143 },
];

const barKeys = BARS.map(
    (b, i) =>
        `@keyframes th-bar${i}{0%,${10 + i * 2}%{width:0;opacity:1}${24 + i * 2}%,56%{width:${b.a}px;opacity:1}64%,92%{width:${b.b}px;opacity:1}97%,100%{width:${b.b}px;opacity:0}}`,
).join('\n');

const donutKeys = DONUT.map(
    (d, i) => `@keyframes th-arc${i}{0%,${20 + i * 3}%{stroke-dasharray:0 163;opacity:1}${34 + i * 3}%,92%{stroke-dasharray:${d.len} 163;opacity:1}97%,100%{stroke-dasharray:${d.len} 163;opacity:0}}`,
).join('\n');

const CSS = `
@keyframes th-tile{0%,2%{opacity:0;transform:translateY(6px)}10%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes th-card{0%,6%{opacity:0;transform:translateY(8px)}16%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes th-a{0%,56%{opacity:1}62%,100%{opacity:0}}
@keyframes th-b{0%,56%{opacity:0}62%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes th-pick{0%,47%{box-shadow:0 0 0 0 transparent}50%,58%{box-shadow:0 0 0 3px ${primary(0.3)}}64%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes th-cursor{0%,30%{transform:translate(420px,250px);opacity:0}36%{opacity:1}50%,60%{transform:translate(328px,40px);opacity:1}74%,90%{transform:translate(360px,120px);opacity:1}96%,100%{transform:translate(360px,120px);opacity:0}}
@keyframes th-ring{0%,52%{opacity:0;transform:scale(.4)}54%{opacity:1;transform:scale(1)}58%,100%{opacity:0;transform:scale(1.6)}}
@keyframes th-flash{0%,58%{background:transparent}61%{background:${primary(0.08)}}66%,100%{background:transparent}}
${barKeys}
${donutKeys}
`;

/** Dos textos que se cruzan: «a» hasta el cambio de período, «b» después. */
function Swap({ a, b, size, weight = 700, color }: { a: string; b: string; size: number; weight?: number; color?: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-grid', lineHeight: 1.25 }}>
            <span data-a="" style={{ gridArea: '1 / 1', opacity: 0, animationName: 'th-a' }}>
                <T size={size} weight={weight} color={color}>
                    {a}
                </T>
            </span>
            <span data-a="" style={{ gridArea: '1 / 1', animationName: 'th-b' }}>
                <T size={size} weight={weight} color={color}>
                    {b}
                </T>
            </span>
        </span>
    );
}

function Tile({
    x,
    title,
    sub,
    icon,
    a,
    b,
    delay,
}: {
    x: number;
    title: string;
    sub: string;
    icon: JSX.Element;
    a: string;
    b: string;
    delay: number;
}): JSX.Element {
    return (
        <At
            x={x}
            y={34}
            w={134}
            h={60}
            a="th-tile"
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 9,
                padding: '8px 9px',
                animationDelay: `${delay}s`,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={8.5} weight={700}>
                        {title}
                    </T>
                    <T size={7} color={C.mutedFg}>
                        {sub}
                    </T>
                </span>
                <span
                    style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: C.muted,
                        color: C.mutedFg,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {icon}
                </span>
            </div>
            <div style={{ marginTop: 6 }}>
                <Swap a={a} b={b} size={15} />
            </div>
        </At>
    );
}

export default function TabHero(): JSX.Element {
    return (
        <Stage label="Un tablero de ventas que se arma solo: indicadores, barras por etapa y una dona por origen. Al cambiar el período a «Este año», todos los números se recalculan a la vez." tint="blue">
            <Keyframes css={CSS} />
            <Win x={16} y={12} w={448} h={276} title="Tableros · Ventas">
                {/* Cabecera del tablero */}
                <At x={12} y={7} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={13} weight={700}>
                        Ventas
                    </T>
                </At>
                <At
                    x={268}
                    y={6}
                    w={86}
                    h={20}
                    a="th-pick"
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        background: C.card,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '0 6px',
                        color: C.mutedFg,
                    }}
                >
                    <CalendarDays size={10} />
                    <Swap a="Este mes" b="Este año" size={8.5} weight={600} color={C.fg} />
                    <ChevronDown size={9} style={{ marginLeft: 'auto' }} />
                </At>
                <At
                    x={360}
                    y={6}
                    w={74}
                    h={20}
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                    }}
                >
                    <Share2 size={9} color={C.mutedFg} />
                    <T size={8.5} weight={600}>
                        Compartir
                    </T>
                </At>

                <Tile x={12} title="Oportunidades" sub="Conteo · Oportunidades" icon={<Target size={10} />} a="16" b="148" delay={0} />
                <Tile x={156} title="Monto en pipeline" sub="Suma · Oportunidades" icon={<CircleDollarSign size={10} />} a="$ 39,4 M" b="$ 149,9 M" delay={0.15} />
                <Tile x={300} title="Ganadas" sub="Conteo · Oportunidades" icon={<Trophy size={10} />} a="7" b="61" delay={0.3} />

                {/* Barras por etapa */}
                <At
                    x={12}
                    y={102}
                    w={262}
                    h={138}
                    a="th-card"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px', animationDelay: '0.2s' }}
                >
                    <T size={8.5} weight={700}>
                        Monto por etapa
                    </T>
                    <T size={7} color={C.mutedFg} style={{ display: 'block', marginTop: 1 }}>
                        Suma · Oportunidades
                    </T>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 7 }}>
                        {BARS.map((b, i) => (
                            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 12 }}>
                                <span style={{ width: 52, textAlign: 'right' }}>
                                    <T size={7.5} color={C.mutedFg}>
                                        {b.label}
                                    </T>
                                </span>
                                <span style={{ position: 'relative', width: 134, height: 10, borderRadius: 3, background: C.muted, overflow: 'hidden' }}>
                                    <span
                                        data-a=""
                                        style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            height: 10,
                                            width: b.b,
                                            borderRadius: 3,
                                            background: tone(b.t),
                                            animationName: `th-bar${i}`,
                                        }}
                                    />
                                </span>
                                <span style={{ width: 40 }}>
                                    <Swap a={b.va} b={b.vb} size={7.5} />
                                </span>
                            </div>
                        ))}
                    </div>
                </At>

                {/* Dona */}
                <At
                    x={284}
                    y={102}
                    w={150}
                    h={138}
                    a="th-card"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px', animationDelay: '0.35s' }}
                >
                    <T size={8.5} weight={700}>
                        Por origen
                    </T>
                    <T size={7} color={C.mutedFg} style={{ display: 'block', marginTop: 1 }}>
                        Conteo · Oportunidades
                    </T>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
                        <span style={{ position: 'relative', width: 66, height: 66 }}>
                            <svg width="66" height="66" viewBox="0 0 66 66" style={{ transform: 'rotate(-90deg)' }}>
                                <circle cx="33" cy="33" r="26" fill="none" stroke={C.muted} strokeWidth="9" />
                                {DONUT.map((d, i) => (
                                    <circle
                                        key={d.t}
                                        data-a=""
                                        cx="33"
                                        cy="33"
                                        r="26"
                                        fill="none"
                                        stroke={tone(d.t)}
                                        strokeWidth="9"
                                        strokeDasharray={`${d.len} 163`}
                                        strokeDashoffset={d.off}
                                        style={{ animationName: `th-arc${i}` }}
                                    />
                                ))}
                            </svg>
                            <span
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Swap a="16" b="148" size={11} />
                                <T size={5.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                                    TOTAL
                                </T>
                            </span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {[
                                ['Referido', 'cyan'],
                                ['Web', 'amber'],
                                ['Feria', 'mint'],
                                ['Redes', 'violet'],
                            ].map(([l, t]) => (
                                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 7, height: 7, borderRadius: 2, background: tone(t as Tn) }} />
                                    <T size={7.5} color={C.mutedFg}>
                                        {l}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </div>
                </At>
                {/* Destello cuando todo se recalcula */}
                <At x={0} y={0} w={446} h={250} a="th-flash" style={{ pointerEvents: 'none', borderRadius: 0 }} />
            </Win>
            <Cursor a="th-cursor" click="th-ring" rest={[360, 120]} />
        </Stage>
    );
}
