import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Semana del calendario: una cita se arrastra del martes al jueves y después se estira para que dure más. */

const COL_W = 78;
const ROW_H = 28;
const X0 = 46;
const Y0 = 62;
const colX = (c: number): number => X0 + c * COL_W;
const hourY = (h: number): number => Y0 + (h - 9) * ROW_H;

const CSS = `
@keyframes vca-ev{0%,14%{transform:translate(-156px,-28px);opacity:1;box-shadow:none}18%{transform:translate(-154px,-31px);box-shadow:0 12px 22px -10px rgba(15,23,42,.5)}34%{transform:translate(0,-3px);box-shadow:0 12px 22px -10px rgba(15,23,42,.5)}38%,94%{transform:translate(0,0);opacity:1;box-shadow:0 2px 6px -3px rgba(15,23,42,.35)}97%{transform:translate(0,0);opacity:0}98%{transform:translate(-156px,-28px);opacity:0}100%{transform:translate(-156px,-28px);opacity:1}}
@keyframes vca-h{0%,52%{height:27px}68%,95%{height:41px}100%{height:27px}}
@keyframes vca-t1{0%,34%{opacity:1}37%,100%{opacity:0}}
@keyframes vca-t2{0%,35%{opacity:0}38%,60%{opacity:1}63%,100%{opacity:0}}
@keyframes vca-t3{0%,61%{opacity:0}64%,95%{opacity:1}98%,100%{opacity:0}}
@keyframes vca-cur{0%{transform:translate(200px,290px);opacity:0}6%{opacity:1}12%,16%{transform:translate(180px,150px)}34%,38%{transform:translate(336px,178px)}46%,52%{transform:translate(336px,191px)}68%,88%{transform:translate(336px,205px);opacity:1}95%,100%{transform:translate(336px,205px);opacity:0}}
@keyframes vca-toast{0%,38%{opacity:0;transform:translateY(8px)}42%,58%{opacity:1;transform:translateY(0)}62%,100%{opacity:0;transform:translateY(8px)}}
@keyframes vca-grip{0%,44%{opacity:0}48%,70%{opacity:1}74%,100%{opacity:0}}
`;

function Ev({ c, from, to, label, time, t }: { c: number; from: number; to: number; label: string; time: string; t: 'violet' | 'mint' | 'amber' }): JSX.Element {
    return (
        <At
            x={colX(c) + 3}
            y={hourY(from)}
            w={COL_W - 6}
            h={(to - from) * ROW_H - 1}
            style={{ borderRadius: 5, background: tone(t, 0.2), borderLeft: `3px solid ${tone(t)}`, padding: '3px 5px', display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden' }}
        >
            <T size={8.5} weight={700}>
                {label}
            </T>
            <T size={7.5} color={C.mutedFg}>
                {time}
            </T>
        </At>
    );
}

export default function VistasCalendario(): JSX.Element {
    return (
        <Stage label="La semana de un calendario de citas: la cita «Facial · Ana» se arrastra del martes a las 10:00 al jueves a las 11:00, y después se estira su borde para que termine a las 12:30." tint="mint">
            <Keyframes css={CSS} />
            <Win x={16} y={20} w={448} h={262} title="Citas · Agenda">
                {/* Barra */}
                <At x={10} y={6} w={428} h={22} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 600, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 7px' }}>Hoy</span>
                    <ChevronLeft size={12} color={C.mutedFg} />
                    <ChevronRight size={12} color={C.mutedFg} />
                    <T size={11} weight={700}>
                        26 – 30 oct de 2026
                    </T>
                    <span style={{ flex: 1 }} />
                    <span style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
                        {['Mes', 'Semana', 'Día', 'Agenda'].map((m) => (
                            <span key={m} style={{ fontSize: 8.5, fontWeight: 600, padding: '3px 7px', background: m === 'Semana' ? primary(0.14) : 'transparent', color: m === 'Semana' ? primary() : C.mutedFg }}>
                                {m}
                            </span>
                        ))}
                    </span>
                    <CalendarDays size={12} color={C.mutedFg} />
                </At>
                {/* Días */}
                {['LUN 26', 'MAR 27', 'MIÉ 28', 'JUE 29', 'VIE 30'].map((d, i) => (
                    <At key={d} x={colX(i)} y={36} w={COL_W} h={24} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700} color={i === 1 ? primary() : C.mutedFg}>
                            {d}
                        </T>
                    </At>
                ))}
                {/* Horas */}
                {[9, 10, 11, 12, 13, 14].map((h) => (
                    <At key={h} x={10} y={hourY(h)} w={428} h={ROW_H} style={{ borderTop: `1px solid ${C.border}` }}>
                        <T size={7.5} color={C.mutedFg} style={{ position: 'absolute', left: 0, top: 3 }}>
                            {h}:00
                        </T>
                    </At>
                ))}
                {[0, 1, 2, 3, 4].map((c) => (
                    <At key={c} x={colX(c)} y={Y0} w={1} h={6 * ROW_H} style={{ background: C.border }} />
                ))}

                <Ev c={0} from={9} to={10.5} label="Uñas · Lina" time="9:00 – 10:30" t="violet" />
                <Ev c={2} from={12} to={13} label="Masaje · Rosa" time="12:00 – 13:00" t="mint" />
                <Ev c={4} from={9.5} to={10.5} label="Facial · Sara" time="9:30 – 10:30" t="amber" />

                {/* La cita que se mueve: termina el jueves de 11:00 a 12:30 */}
                <At
                    x={colX(3) + 3}
                    y={hourY(11)}
                    w={COL_W - 6}
                    a="vca-ev"
                    style={{ zIndex: 5, borderRadius: 5, overflow: 'hidden' }}
                >
                    <div data-a="" style={{ height: 41, background: `linear-gradient(${tone('cyan', 0.24)}, ${tone('cyan', 0.24)}), ${C.card}`, borderLeft: `3px solid ${tone('cyan')}`, padding: '3px 5px', position: 'relative', animationName: 'vca-h' }}>
                        <T size={8.5} weight={700} style={{ display: 'block' }}>
                            Facial · Ana
                        </T>
                        <span style={{ position: 'relative', display: 'block', height: 11 }}>
                            {[
                                ['10:00 – 11:00', 'vca-t1', 0],
                                ['11:00 – 12:00', 'vca-t2', 0],
                                ['11:00 – 12:30', 'vca-t3', 1],
                            ].map(([txt, a, o]) => (
                                <span key={a as string} data-a="" style={{ position: 'absolute', left: 0, top: 0, fontSize: 7.5, color: C.mutedFg, whiteSpace: 'nowrap', animationName: a as string, opacity: o as number }}>
                                    {txt as string}
                                </span>
                            ))}
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: '35%', right: '35%', bottom: 2, height: 3, borderRadius: 3, background: tone('cyan'), opacity: 0, animationName: 'vca-grip' }} />
                    </div>
                </At>

                {/* Aviso con deshacer */}
                <At x={118} y={204} a="vca-toast" style={{ opacity: 0, zIndex: 8, background: C.fg, color: C.card, borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 24px -10px rgba(15,23,42,.6)' }}>
                    <T size={9} weight={600} color={C.card}>
                        «Facial · Ana» → jue 29, 11:00
                    </T>
                    <T size={9} weight={700} color={primary()}>
                        Deshacer
                    </T>
                </At>
            </Win>
            <Cursor a="vca-cur" rest={[336, 205]} />
        </Stage>
    );
}
