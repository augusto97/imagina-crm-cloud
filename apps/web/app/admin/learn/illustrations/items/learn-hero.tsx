import { BarChart3, BookOpen, CalendarClock, Columns3, GraduationCap, MessageCircle, Sparkles, Table, Zap } from 'lucide-react';

import { At, Avatar, C, Chip, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada del centro de aprendizaje: una «lección» en el centro que se va
 * completando (las casillas se marcan una a una y la barra avanza) mientras
 * alrededor flotan piezas de la app —una tabla, un tablero, una
 * automatización y un gráfico— que se encienden cuando se marca su lección.
 */

const CSS = `
@keyframes lh-bob1{0%,100%{transform:translate(0,0)}50%{transform:translate(0,-6px)}}
@keyframes lh-bob2{0%,100%{transform:translate(0,-5px)}50%{transform:translate(0,2px)}}
@keyframes lh-bob3{0%,100%{transform:translate(0,3px)}50%{transform:translate(0,-4px)}}
@keyframes lh-bob4{0%,100%{transform:translate(0,-2px)}50%{transform:translate(0,5px)}}
@keyframes lh-progress{0%,6%{width:0%}22%{width:25%}38%{width:50%}54%{width:75%}70%,92%{width:100%}97%,100%{width:0%}}
@keyframes lh-chk1{0%,14%{transform:scale(0);opacity:0}18%,94%{transform:scale(1);opacity:1}98%,100%{transform:scale(0);opacity:0}}
@keyframes lh-chk2{0%,30%{transform:scale(0);opacity:0}34%,94%{transform:scale(1);opacity:1}98%,100%{transform:scale(0);opacity:0}}
@keyframes lh-chk3{0%,46%{transform:scale(0);opacity:0}50%,94%{transform:scale(1);opacity:1}98%,100%{transform:scale(0);opacity:0}}
@keyframes lh-chk4{0%,62%{transform:scale(0);opacity:0}66%,94%{transform:scale(1);opacity:1}98%,100%{transform:scale(0);opacity:0}}
@keyframes lh-glow1{0%,12%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}18%,30%{box-shadow:0 0 0 3px ${primary(0.45)},0 14px 30px -12px rgba(15,23,42,.4)}38%,100%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}}
@keyframes lh-glow2{0%,28%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}34%,46%{box-shadow:0 0 0 3px ${primary(0.45)},0 14px 30px -12px rgba(15,23,42,.4)}54%,100%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}}
@keyframes lh-glow3{0%,44%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}50%,62%{box-shadow:0 0 0 3px ${primary(0.45)},0 14px 30px -12px rgba(15,23,42,.4)}70%,100%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}}
@keyframes lh-glow4{0%,60%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}66%,78%{box-shadow:0 0 0 3px ${primary(0.45)},0 14px 30px -12px rgba(15,23,42,.4)}86%,100%{box-shadow:0 10px 30px -14px rgba(15,23,42,.35)}}
@keyframes lh-bar{0%,58%{transform:scaleY(.15)}70%,92%{transform:scaleY(1)}98%,100%{transform:scaleY(.15)}}
@keyframes lh-done{0%,70%{opacity:0;transform:translateY(6px) scale(.9)}75%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes lh-cap{0%,100%{transform:translateY(0) rotate(-6deg)}50%{transform:translateY(-4px) rotate(4deg)}}
@keyframes lh-twinkle{0%,100%{opacity:.25;transform:scale(.7)}50%{opacity:1;transform:scale(1.15)}}
@keyframes lh-move{0%,34%{transform:translate(0,0)}46%,92%{transform:translate(29px,0)}98%,100%{transform:translate(0,0)}}
`;

const LESSONS = [
    { label: 'Listas y campos', t: 'blue' as const },
    { label: 'Vistas y tableros', t: 'violet' as const },
    { label: 'Automatizaciones', t: 'amber' as const },
    { label: 'Reportes', t: 'mint' as const },
];

const card = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, boxShadow: '0 10px 30px -14px rgba(15,23,42,.35)' };

function Float({ x, y, w, h, bob, glow, delay = 0, children }: { x: number; y: number; w: number; h: number; bob: string; glow: string; delay?: number; children: JSX.Element }): JSX.Element {
    return (
        <At x={x} y={y} w={w} h={h} a={bob} style={{ animationDuration: `${3.5 + delay}s`, animationTimingFunction: 'ease-in-out' }}>
            <div data-a="" style={{ ...card, width: w, height: h, overflow: 'hidden', animationName: glow }}>
                {children}
            </div>
        </At>
    );
}

function Kicker({ icon, text, t }: { icon: JSX.Element; text: string; t: 'blue' | 'violet' | 'amber' | 'mint' }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 8px 4px' }}>
            <span style={{ color: tone(t), display: 'flex' }}>{icon}</span>
            <T size={8.5} weight={700} color={C.mutedFg}>
                {text}
            </T>
        </div>
    );
}

export default function LearnHero(): JSX.Element {
    return (
        <Stage label="Una lección del centro de aprendizaje que se completa paso a paso mientras alrededor se encienden una tabla, un tablero, una automatización y un gráfico de la app." tint="violet">
            <Keyframes css={CSS} />

            {/* Tabla */}
            <Float x={16} y={22} w={132} h={92} bob="lh-bob1" glow="lh-glow1">
                <div>
                    <Kicker icon={<Table size={10} />} text="Clientes" t="blue" />
                    {[
                        ['Café Bahía', 'Activo', 'mint'],
                        ['Clínica Norte', 'Nuevo', 'blue'],
                        ['Hotel Brisas', 'VIP', 'violet'],
                    ].map(([n, s, t], i) => (
                        <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', height: 21, borderTop: `1px solid ${C.border}` }}>
                            <T size={8.5} weight={600}>
                                {n}
                            </T>
                            <Chip label={s!} t={t as 'mint'} style={{ height: 13, fontSize: 7.5, padding: '0 5px', opacity: i === 2 ? 0.95 : 1 }} />
                        </div>
                    ))}
                </div>
            </Float>

            {/* Tablero */}
            <Float x={334} y={16} w={128} h={98} bob="lh-bob2" glow="lh-glow2" delay={0.4}>
                <div>
                    <Kicker icon={<Columns3 size={10} />} text="Por etapa" t="violet" />
                    <div style={{ position: 'relative', display: 'flex', gap: 5, padding: '0 7px' }}>
                        {(['slate', 'blue', 'mint'] as const).map((t, i) => (
                            <div key={t} style={{ flex: 1, height: 62, borderRadius: 6, background: tone(t, 0.1), borderTop: `2px solid ${tone(t)}`, padding: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {Array.from({ length: i === 1 ? 1 : 2 }).map((_, k) => (
                                    <span key={k} style={{ display: 'block', height: 14, borderRadius: 3, background: C.card, border: `1px solid ${C.border}` }} />
                                ))}
                            </div>
                        ))}
                        {/* La tarjeta que avanza de etapa */}
                        <At x={10} y={41} w={29} h={14} a="lh-move" style={{ transform: 'translate(29px,0)' }}>
                            <span style={{ display: 'block', width: 29, height: 14, borderRadius: 3, background: C.card, border: `1.5px solid ${primary()}`, boxShadow: '0 4px 8px -4px rgba(15,23,42,.4)' }} />
                        </At>
                    </div>
                </div>
            </Float>

            {/* Automatización */}
            <Float x={14} y={186} w={136} h={92} bob="lh-bob3" glow="lh-glow3" delay={0.8}>
                <div>
                    <Kicker icon={<Zap size={10} />} text="Automatización" t="amber" />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px' }}>
                        {[
                            ['Vence una factura', 'amber'],
                            ['Enviar WhatsApp', 'mint'],
                        ].map(([txt, t], i) => (
                            <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <IconSquare t={t as 'amber'} size={15}>
                                    {i === 0 ? <CalendarClock size={9} /> : <MessageCircle size={9} />}
                                </IconSquare>
                                <T size={8.5} weight={600}>
                                    {txt}
                                </T>
                            </div>
                        ))}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Avatar initials="LG" t="blue" size={14} />
                                <T size={8} color={C.mutedFg}>
                                    hace 2 min
                                </T>
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', width: 22, height: 12, borderRadius: 99, background: C.success, padding: 2, justifyContent: 'flex-end' }}>
                                <span style={{ width: 8, height: 8, borderRadius: 99, background: '#fff' }} />
                            </span>
                        </div>
                    </div>
                </div>
            </Float>

            {/* Gráfico */}
            <Float x={330} y={182} w={134} h={98} bob="lh-bob4" glow="lh-glow4" delay={0.2}>
                <div>
                    <Kicker icon={<BarChart3 size={10} />} text="Ventas del mes" t="mint" />
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 56, padding: '0 10px', borderBottom: `1px solid ${C.border}`, margin: '0 8px' }}>
                        {[0.45, 0.7, 0.55, 0.9, 0.75].map((h, i) => (
                            <span
                                key={i}
                                data-a=""
                                style={{
                                    flex: 1,
                                    height: `${h * 100}%`,
                                    borderRadius: '3px 3px 0 0',
                                    background: i === 3 ? primary() : tone('mint', 0.55),
                                    transformOrigin: 'bottom',
                                    animationName: 'lh-bar',
                                    animationDelay: `${i * 0.08}s`,
                                }}
                            />
                        ))}
                    </div>
                </div>
            </Float>

            {/* La lección del centro */}
            <At x={160} y={52} w={160} h={210} style={{ ...card, borderRadius: 14, boxShadow: '0 22px 50px -20px rgba(15,23,42,.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '12px 12px 8px' }}>
                    <IconSquare t="violet" size={24}>
                        <BookOpen size={13} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10.5} weight={700}>
                            Aprende la app
                        </T>
                        <T size={8} weight={500} color={C.mutedFg}>
                            Guías paso a paso
                        </T>
                    </span>
                </div>
                <div style={{ margin: '0 12px 8px', height: 6, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                    <span data-a="" style={{ display: 'block', height: '100%', width: '100%', borderRadius: 99, background: primary(), animationName: 'lh-progress' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px' }}>
                    {LESSONS.map((l, i) => (
                        <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 24, padding: '0 7px', borderRadius: 7, background: tone(l.t, 0.08) }}>
                            <span style={{ position: 'relative', width: 13, height: 13, borderRadius: 99, border: `1.5px solid ${C.border}`, background: C.card, flexShrink: 0 }}>
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        inset: -1.5,
                                        borderRadius: 99,
                                        background: C.success,
                                        color: '#fff',
                                        fontSize: 8,
                                        fontWeight: 800,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        animationName: `lh-chk${i + 1}`,
                                    }}
                                >
                                    ✓
                                </span>
                            </span>
                            <T size={9} weight={600}>
                                {l.label}
                            </T>
                        </div>
                    ))}
                </div>
                <At x={0} y={176} w={160} a="lh-done" style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 10px', borderRadius: 99, background: tone('mint', 0.16), color: tone('mint'), fontSize: 9, fontWeight: 700 }}>
                        ¡Ya sabes cómo!
                    </span>
                </At>
            </At>

            {/* Birrete */}
            <At x={222} y={20} a="lh-cap" style={{ animationDuration: '3s', animationTimingFunction: 'ease-in-out', zIndex: 3 }}>
                <span style={{ width: 38, height: 38, borderRadius: 99, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 10px 24px -8px ${primary(0.7)}, 0 0 0 5px ${primary(0.15)}` }}>
                    <GraduationCap size={21} />
                </span>
            </At>

            {/* Destellos */}
            {[
                [182, 28, 0],
                [290, 34, 0.9],
                [150, 160, 1.6],
                [322, 150, 2.3],
            ].map(([x, y, d]) => (
                <At key={`${x}-${y}`} x={x!} y={y!} a="lh-twinkle" style={{ color: tone('amber'), animationDuration: '2.4s', animationDelay: `${d}s` }}>
                    <Sparkles size={11} />
                </At>
            ))}
        </Stage>
    );
}
