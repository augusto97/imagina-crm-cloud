import { Shuffle, User } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** «El primero disponible»: cada reserva nueva va, por turno, a la persona que está libre a esa hora. */

const SLOTS: Array<{ col: number; row: number; label: string; who: string }> = [
    { col: 0, row: 0, label: 'Corte · 9:00', who: 'Mateo' },
    { col: 1, row: 0, label: 'Corte · 9:00', who: 'Luisa' },
    { col: 2, row: 0, label: 'Barba · 9:30', who: 'Pablo' },
    { col: 0, row: 1, label: 'Corte · 10:00', who: 'Andrés' },
];

function kf(i: number): string {
    const start = 6 + i * 20;
    const land = start + 10;
    const sx = 40 - (196 + SLOTS[i]!.col * 90);
    const sy = 94 - (96 + SLOTS[i]!.row * 44);
    return `@keyframes crr-c${i}{0%,${start}%{opacity:0;transform:translate(${sx}px,${sy - 8}px) scale(.9)}${start + 3}%{opacity:1;transform:translate(${sx}px,${sy}px) scale(1)}${land}%,92%{opacity:1;transform:translate(0,0) scale(1)}97%,100%{opacity:0;transform:translate(0,0)}}
@keyframes crr-h${i}{0%,${land - 1}%{box-shadow:0 0 0 0 transparent}${land + 1}%,${land + 6}%{box-shadow:0 0 0 2.5px ${tone('rose', 0.5)}}${land + 10}%,100%{box-shadow:0 0 0 0 transparent}}`;
}

const CSS = `${SLOTS.map((_, i) => kf(i)).join('\n')}
@keyframes crr-turn{0%,15%{transform:translateX(0)}17%,35%{transform:translateX(90px)}37%,55%{transform:translateX(180px)}57%,96%{transform:translateX(0)}100%{transform:translateX(0)}}
`;

const PEOPLE: Array<{ n: string; ini: string; t: 'violet' | 'blue' | 'amber' }> = [
    { n: 'Laura', ini: 'LR', t: 'violet' },
    { n: 'Diego', ini: 'DG', t: 'blue' },
    { n: 'Sofía', ini: 'SF', t: 'amber' },
];

export default function CitasRoundrobin(): JSX.Element {
    return (
        <Stage label="Con El primero disponible, las reservas nuevas se reparten por turno entre Laura, Diego y Sofía: cada una va a quien está libre y le toca." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Lo que ve el cliente */}
                <At
                    x={16}
                    y={58}
                    w={150}
                    h={184}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 11, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}
                >
                    <T size={9.5} weight={800}>
                        ¿Con quién?
                    </T>
                    <span style={{ height: 30, borderRadius: 8, boxShadow: `0 0 0 1.5px ${primary()}`, background: primary(0.08), display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                        <span style={{ width: 18, height: 18, borderRadius: 99, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Shuffle size={10} />
                        </span>
                        <T size={8} weight={700}>
                            El primero disponible
                        </T>
                    </span>
                    {PEOPLE.map((p) => (
                        <span key={p.n} style={{ height: 26, borderRadius: 8, boxShadow: `0 0 0 1px ${C.border}`, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                            <Avatar initials={p.ini} t={p.t} size={16} />
                            <T size={8}>{p.n}</T>
                        </span>
                    ))}
                </At>

                {/* Lo que pasa en el equipo */}
                <At
                    x={184}
                    y={40}
                    w={280}
                    h={230}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}
                >
                    {/* Marca de «le toca» */}
                    <At x={8} y={8} w={84} h={36} a="crr-turn" style={{ borderRadius: 8, background: primary(0.08) }} />
                    {PEOPLE.map((p, i) => (
                        <At key={p.n} x={8 + i * 90} y={8} w={84} h={36} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                            <Avatar initials={p.ini} t={p.t} size={20} />
                            <span style={{ display: 'flex', flexDirection: 'column' }}>
                                <T size={8.5} weight={800}>
                                    {p.n}
                                </T>
                                <T size={6.5} color={C.mutedFg}>
                                    Barbero
                                </T>
                            </span>
                        </At>
                    ))}
                    {[0, 1, 2].map((i) => (
                        <At key={i} x={8 + i * 90} y={50} w={84} h={170} style={{ borderRadius: 8, background: C.muted, opacity: 0.55 }} />
                    ))}
                    {/* Una cita ya tomada de Sofía */}
                    <At x={8 + 2 * 90 + 4} y={56 + 44} w={76} h={36} style={{ borderRadius: 7, background: C.card, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7} color={C.mutedFg}>
                            Ocupada 10:00
                        </T>
                    </At>
                </At>
                {SLOTS.map((s, i) => (
                    <At
                        key={i}
                        x={196 + s.col * 90}
                        y={96 + s.row * 44}
                        w={76}
                        h={36}
                        a={`crr-c${i}`}
                        style={{ borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${tone('rose')}`, padding: '4px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, boxShadow: '0 6px 14px -8px rgba(15,23,42,.45)', zIndex: 5 }}
                    >
                        <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 7, animationName: `crr-h${i}` }} />
                        <T size={7.5} weight={700}>
                            {s.label}
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <User size={7} color={C.mutedFg} />
                            <T size={7} color={C.mutedFg}>
                                {s.who}
                            </T>
                        </span>
                    </At>
                ))}
                <At x={190} y={14}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                        AGENDA DE HOY
                    </T>
                </At>
            </At>
        </Stage>
    );
}
