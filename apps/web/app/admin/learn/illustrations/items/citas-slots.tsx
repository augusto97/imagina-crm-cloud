import { CalendarClock, CalendarDays, Clock } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** Cómo salen los horarios libres: la semana de atención menos lo ocupado (Google Calendar, otras citas) y los márgenes. */

const HOUR = 44;
const TOP = 34;
const y = (h: number): number => TOP + (h - 9) * HOUR;

const CHIPS: Array<{ t: string; gone?: 'g' | 'm' }> = [
    { t: '9:00' },
    { t: '9:30' },
    { t: '10:00', gone: 'g' },
    { t: '10:30', gone: 'g' },
    { t: '11:00', gone: 'm' },
    { t: '11:30', gone: 'm' },
    { t: '12:00', gone: 'm' },
    { t: '12:30' },
];

const CSS = `
@keyframes cs-g{0%,14%{opacity:0;transform:scaleY(.2)}20%,92%{opacity:1;transform:scaleY(1)}97%,100%{opacity:0}}
@keyframes cs-m{0%,36%{opacity:0}42%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cs-gone-g{0%,24%{opacity:1}30%,92%{opacity:.32}100%{opacity:1}}
@keyframes cs-gone-m{0%,46%{opacity:1}52%,92%{opacity:.32}100%{opacity:1}}
@keyframes cs-strike-g{0%,24%{transform:scaleX(0)}30%,92%{transform:scaleX(1)}97%,100%{transform:scaleX(0)}}
@keyframes cs-strike-m{0%,46%{transform:scaleX(0)}52%,92%{transform:scaleX(1)}97%,100%{transform:scaleX(0)}}
@keyframes cs-ok{0%,58%{opacity:0;transform:translateY(5px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cs-free{0%,58%{box-shadow:0 0 0 1px ${C.border}}64%,92%{box-shadow:0 0 0 1.5px ${tone('mint')}}97%,100%{box-shadow:0 0 0 1px ${C.border}}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

export default function CitasSlots(): JSX.Element {
    return (
        <Stage label="Los horarios libres salen de la semana de atención, menos lo ocupado en Google Calendar, las otras citas y los márgenes entre citas: de ocho horarios quedan tres." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Semana de atención */}
                <At x={16} y={40} w={138} h={220} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarDays size={11} color={tone('rose')} />
                        <T size={8.5} weight={800}>
                            Horario de atención
                        </T>
                    </span>
                    {(
                        [
                            ['Lun', '9:00 – 13:00'],
                            ['Mar', '9:00 – 13:00'],
                            ['Mié', '9:00 – 13:00'],
                            ['Jue', '14:00 – 18:00'],
                            ['Vie', '9:00 – 13:00'],
                            ['Sáb', 'No atiende'],
                        ] as const
                    ).map(([d, h]) => (
                        <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <T size={7.5} weight={700} style={{ width: 20 }}>
                                {d}
                            </T>
                            <span
                                style={{
                                    flex: 1,
                                    height: 17,
                                    borderRadius: 5,
                                    background: h === 'No atiende' ? 'transparent' : tone('rose', 0.12),
                                    border: h === 'No atiende' ? `1px dashed ${C.border}` : 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 6px',
                                }}
                            >
                                <T size={7} color={h === 'No atiende' ? C.mutedFg : C.fg}>
                                    {h}
                                </T>
                            </span>
                        </span>
                    ))}
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Los festivos no se ofrecen.
                    </T>
                </At>

                {/* El día por dentro */}
                <At x={166} y={40} w={152} h={220} style={card}>
                    <At x={10} y={10}>
                        <T size={8.5} weight={800}>
                            Martes 28
                        </T>
                    </At>
                    {[9, 10, 11, 12, 13].map((h) => (
                        <At key={h} x={8} y={y(h) - 5} w={136} h={10} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <T size={6.5} color={C.mutedFg} style={{ width: 24, textAlign: 'right' }}>
                                {h}:00
                            </T>
                            <span style={{ flex: 1, height: 1, background: C.border }} />
                        </At>
                    ))}
                    {/* Tramo de atención */}
                    <At x={38} y={y(9)} w={104} h={HOUR * 4} style={{ borderRadius: 6, background: tone('mint', 0.1) }} />
                    {/* Ocupado en Google Calendar */}
                    <At
                        x={40}
                        y={y(10)}
                        w={100}
                        h={HOUR * 0.75}
                        a="cs-g"
                        style={{ transformOrigin: 'top', borderRadius: 5, background: C.muted, border: `1px solid ${C.border}`, padding: '3px 5px', display: 'flex', flexDirection: 'column', gap: 1 }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <CalendarClock size={8} color={tone('blue')} />
                            <T size={6.5} weight={700}>
                                Ocupado
                            </T>
                        </span>
                        <T size={6} color={C.mutedFg}>
                            Google Calendar
                        </T>
                    </At>
                    {/* Margen antes y después de la cita */}
                    {[11 + 20 / 60, 12].map((h) => (
                        <At
                            key={h}
                            x={40}
                            y={y(h)}
                            w={100}
                            h={(HOUR * 10) / 60}
                            a="cs-m"
                            style={{ borderRadius: 3, background: `repeating-linear-gradient(135deg, ${tone('amber', 0.35)} 0 3px, transparent 3px 6px)` }}
                        />
                    ))}
                    {/* Una cita existente */}
                    <At
                        x={40}
                        y={y(11.5)}
                        w={100}
                        h={HOUR * 0.5}
                        style={{ borderRadius: 5, background: tone('rose', 0.18), borderLeft: `3px solid ${tone('rose')}`, padding: '0 5px', display: 'flex', alignItems: 'center' }}
                    >
                        <T size={6.5} weight={700}>
                            Cita · Juan Pérez
                        </T>
                    </At>
                    <At x={86} y={y(12) + 9} a="cs-m">
                        <T size={6} weight={700} color={tone('amber')}>
                            margen 10 min
                        </T>
                    </At>
                </At>

                {/* Lo que ve el cliente */}
                <At x={330} y={40} w={134} h={220} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={11} color={primary()} />
                        <T size={8.5} weight={800}>
                            Elige la hora
                        </T>
                    </span>
                    <T size={6.5} color={C.mutedFg}>
                        Corte de cabello · 30 min
                    </T>
                    <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 2 }}>
                        {CHIPS.map((c) => (
                            <span
                                key={c.t}
                                data-a=""
                                style={{
                                    position: 'relative',
                                    height: 22,
                                    borderRadius: 6,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: c.gone ? `0 0 0 1px ${C.border}` : `0 0 0 1.5px ${tone('mint')}`,
                                    opacity: c.gone ? 0.32 : 1,
                                    animationName: c.gone ? `cs-gone-${c.gone}` : 'cs-free',
                                }}
                            >
                                <T size={8} weight={700} color={c.gone ? C.mutedFg : C.fg}>
                                    {c.t}
                                </T>
                                {c.gone ? (
                                    <span
                                        data-a=""
                                        style={{ position: 'absolute', left: 8, right: 8, top: 10.5, height: 1.2, background: C.mutedFg, transformOrigin: 'left', animationName: `cs-strike-${c.gone}` }}
                                    />
                                ) : null}
                            </span>
                        ))}
                    </span>
                    <At x={10} y={186} w={114} a="cs-ok" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 22, borderRadius: 99, background: tone('mint', 0.15) }}>
                        <T size={7.5} weight={700} color={tone('mint')}>
                            3 horarios libres
                        </T>
                    </At>
                </At>
            </At>
        </Stage>
    );
}
