import { CalendarDays, Check, Plane } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * v0.1.349 — Festivos por país y vacaciones: se elige el país, los festivos
 * del calendario oficial se cierran solos, uno se marca como «Atiende» y unas
 * vacaciones bloquean un rango de días.
 */

const CSS = `
@keyframes cf-hol{0%,16%{background:transparent;color:${C.fg}}22%,92%{background:${tone('rose', 0.16)};color:${tone('rose')}}97%,100%{background:transparent;color:${C.fg}}}
@keyframes cf-open{0%,46%{background:${tone('rose', 0.16)};color:${tone('rose')}}52%,92%{background:${tone('mint', 0.18)};color:${tone('mint')}}97%,100%{background:transparent;color:${C.fg}}}
@keyframes cf-check{0%,46%{opacity:0;transform:scale(.4)}52%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes cf-vac{0%,62%{opacity:0;transform:scaleX(.1)}70%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes cf-tag{0%,62%{opacity:0}70%,92%{opacity:1}97%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

// Septiembre de 2026 empieza en martes (lunes primero).
const FIRST_DOW = 1;
const HOLIDAYS = new Set([16]);
const WORKED = 16;
const VACATION: [number, number] = [21, 25];

export default function CitasFestivos(): JSX.Element {
    const days = Array.from({ length: 30 }, (_, i) => i + 1);
    const cell = 22;
    return (
        <Stage
            label="Festivos por país: se elige México y sus festivos oficiales se cierran solos; el 16 de septiembre se marca como día que sí se atiende, y unas vacaciones del 21 al 25 bloquean esos días."
            tint="amber"
            cycle={8}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* País y festivos */}
                <At x={16} y={34} w={176} h={232} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={8.5} weight={800}>
                        Festivos
                    </T>
                    <span style={{ borderRadius: 7, border: `1px solid ${C.border}`, padding: '5px 7px' }}>
                        <T size={7.5} weight={700}>
                            No atiende festivos de México
                        </T>
                    </span>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Salen del calendario oficial y se actualizan solos cada año.
                    </T>
                    {[
                        ['16 sep', 'Día de la Independencia', true],
                        ['16 nov', 'Día de la Revolución', false],
                        ['25 dic', 'Navidad', false],
                    ].map(([d, n, worked]) => (
                        <span key={String(d)} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ position: 'relative', width: 11, height: 11, borderRadius: 3, border: `1px solid ${C.border}`, flexShrink: 0 }}>
                                {worked ? (
                                    <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'cf-check' }}>
                                        <Check size={9} color={tone('mint')} strokeWidth={3} />
                                    </span>
                                ) : null}
                            </span>
                            <T size={6.5} color={C.mutedFg} style={{ width: 30 }}>
                                {d}
                            </T>
                            <T size={7} weight={600} style={{ flex: 1 }}>
                                {n}
                            </T>
                        </span>
                    ))}
                    <span style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 5, borderRadius: 8, background: tone('amber', 0.12), padding: '5px 7px' }}>
                        <Plane size={10} color={tone('amber')} />
                        <T size={7} weight={700}>
                            Vacaciones: 21 al 25 sep
                        </T>
                    </span>
                </At>

                {/* El mes */}
                <At x={206} y={34} w={258} h={232} style={{ ...card, padding: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarDays size={11} color={tone('rose')} />
                        <T size={8.5} weight={800}>
                            Septiembre de 2026
                        </T>
                    </span>
                    <At x={18} y={34} w={7 * (cell + 8)} style={{ display: 'grid', gridTemplateColumns: `repeat(7, ${cell}px)`, columnGap: 8, rowGap: 6 }}>
                        {['LU', 'MA', 'MI', 'JU', 'VI', 'SÁ', 'DO'].map((d) => (
                            <T key={d} size={6.5} color={C.mutedFg} style={{ textAlign: 'center' }}>
                                {d}
                            </T>
                        ))}
                        {Array.from({ length: FIRST_DOW }, (_, i) => (
                            <span key={`e${i}`} />
                        ))}
                        {days.map((d) => {
                            const dow = (FIRST_DOW + d - 1) % 7;
                            const weekend = dow >= 5;
                            const hol = HOLIDAYS.has(d);
                            const vac = d >= VACATION[0] && d <= VACATION[1];
                            return (
                                <span
                                    key={d}
                                    data-a={hol ? '' : undefined}
                                    style={{
                                        position: 'relative',
                                        height: cell,
                                        borderRadius: 6,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: weekend ? 'transparent' : tone('mint', 0.08),
                                        color: weekend ? C.mutedFg : C.fg,
                                        animationName: hol ? (d === WORKED ? 'cf-open' : 'cf-hol') : undefined,
                                    }}
                                >
                                    <T size={7.5} weight={700} color="inherit">
                                        {d}
                                    </T>
                                    {vac ? (
                                        <span
                                            data-a=""
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
                                                borderRadius: 6,
                                                transformOrigin: 'left',
                                                background: `repeating-linear-gradient(135deg, ${tone('amber', 0.4)} 0 3px, transparent 3px 6px)`,
                                                animationName: 'cf-vac',
                                            }}
                                        />
                                    ) : null}
                                </span>
                            );
                        })}
                    </At>
                    <At x={18} y={206} w={230} a="cf-tag" style={{ display: 'flex', gap: 10 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 3, background: tone('mint', 0.4) }} />
                            <T size={6.5}>Atiende el festivo</T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 3, background: tone('amber', 0.5) }} />
                            <T size={6.5}>Vacaciones</T>
                        </span>
                    </At>
                </At>
            </At>
        </Stage>
    );
}
