import type { CSSProperties } from 'react';
import { ArrowRight, CalendarClock, CalendarDays } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, tone } from '../kit';

/** El cliente cambia su cita desde el correo y la cita se mueve sola en el calendario de la lista, con estado Reprogramada. */

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16];
const ROW = 24;
const TOP = 46;
const COL = 82;
const LEFT = 36;

const CSS = `
@keyframes cr-a{0%,2%{opacity:0}6%,20%{opacity:1}23%,100%{opacity:0}}
@keyframes cr-b{0%,21%{opacity:0;transform:translateX(12px)}25%,43%{opacity:1;transform:translateX(0)}46%,100%{opacity:0}}
@keyframes cr-c{0%,44%{opacity:0;transform:translateX(12px)}48%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes cr-cursor{0%{transform:translate(90px,290px);opacity:0}5%{opacity:1}12%,17%{transform:translate(86px,170px);opacity:1}30%,35%{transform:translate(58px,137px);opacity:1}50%,55%{transform:translate(86px,166px);opacity:1}62%,100%{transform:translate(86px,166px);opacity:0}}
@keyframes cr-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}31%{opacity:0;transform:scale(.4)}33%{opacity:1;transform:scale(1)}36%{opacity:0;transform:scale(1.6)}51%{opacity:0;transform:scale(.4)}53%{opacity:1;transform:scale(1)}56%,100%{opacity:0;transform:scale(1.6)}}
@keyframes cr-pick{0%,32%{background:transparent;color:${C.fg}}34%,100%{background:${tone('amber')};color:#fff}}
@keyframes cr-move{0%,56%{transform:translate(${-COL}px,${-(14 - 10.5) * ROW}px)}64%,92%{transform:translate(0,0)}97%,100%{transform:translate(${-COL}px,${-(14 - 10.5) * ROW}px)}}
@keyframes cr-st1{0%,58%{opacity:1}62%,94%{opacity:0}100%{opacity:1}}
@keyframes cr-st2{0%,58%{opacity:0}62%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cr-ghost{0%,58%{opacity:0}62%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cr-toast{0%,64%{opacity:0;transform:translateY(8px)}69%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

const btn = (bg: string, fg: string, border = false): CSSProperties => ({
    height: 22,
    borderRadius: 6,
    background: bg,
    border: border ? `1px solid ${C.border}` : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: fg,
});

export default function CitasReschedule(): JSX.Element {
    return (
        <Stage label="Desde el enlace del correo, el cliente toca Cambiar el horario, elige el jueves a las 2:00 p. m. y confirma con Sí, cambiar. En el calendario de la lista la cita se mueve sola y queda como Reprogramada." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El teléfono del cliente */}
                <At x={16} y={18} w={142} h={266} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}>
                    <div style={{ position: 'absolute', left: 49, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, top: 16, height: 3, background: tone('amber') }} />
                    {/* A: la cita */}
                    <At x={10} y={30} w={112} a="cr-a" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={9} weight={800}>
                            Tu cita
                        </T>
                        <span style={{ borderRadius: 8, background: C.muted, padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={7.5} weight={700}>
                                Corte · 40 min
                            </T>
                            <T size={6.5} color={C.mutedFg}>
                                miércoles 29 · 10:30 a. m.
                            </T>
                            <T size={6.5} color={C.mutedFg}>
                                Con Mateo Garza
                            </T>
                        </span>
                        <span style={{ height: 40 }} />
                        <span style={btn(tone('amber'), '#fff')}>
                            <T size={7.5} weight={700} color="#fff">
                                Cambiar el horario
                            </T>
                        </span>
                        <span style={btn('transparent', C.fg, true)}>
                            <T size={7.5} weight={700} color={tone('rose')}>
                                Cancelar la cita
                            </T>
                        </span>
                    </At>
                    {/* B: nuevo horario */}
                    <At x={10} y={30} w={112} a="cr-b" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={9} weight={800}>
                            Elige el nuevo horario
                        </T>
                        <span style={{ display: 'flex', gap: 3 }}>
                            {['Mié 29', 'Jue 30', 'Vie 31'].map((d, i) => (
                                <span key={d} style={{ flex: 1, height: 26, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 1 ? tone('amber', 0.18) : 'transparent', boxShadow: `0 0 0 1px ${i === 1 ? tone('amber') : C.border}` }}>
                                    <T size={6.5} weight={700}>
                                        {d}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            {['9:00 a. m.', '11:20 a. m.', '2:00 p. m.', '4:00 p. m.'].map((h) => (
                                <span
                                    key={h}
                                    data-a={h === '2:00 p. m.' ? '' : undefined}
                                    style={{ height: 20, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 1px ${C.border}`, fontSize: 7, fontWeight: 700, color: C.fg, animationName: h === '2:00 p. m.' ? 'cr-pick' : undefined }}
                                >
                                    {h}
                                </span>
                            ))}
                        </span>
                    </At>
                    {/* C: confirmar */}
                    <At x={10} y={30} w={112} a="cr-c" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={9} weight={800} style={{ whiteSpace: 'normal' }}>
                            ¿Cambiar tu cita a este horario?
                        </T>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={6.5} color={C.mutedFg} style={{ textDecoration: 'line-through' }}>
                                miércoles 29 · 10:30 a. m.
                            </T>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <ArrowRight size={8} color={tone('amber')} />
                                <T size={7.5} weight={800}>
                                    jueves 30 · 2:00 p. m.
                                </T>
                            </span>
                        </span>
                        <span style={{ height: 42 }} />
                        <span style={btn(tone('amber'), '#fff')}>
                            <T size={7.5} weight={700} color="#fff">
                                Sí, cambiar
                            </T>
                        </span>
                    </At>
                </At>

                {/* El calendario de la lista */}
                <At x={176} y={22} w={288} h={256} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 16px 38px -16px rgba(15,23,42,.5)' }}>
                    <div style={{ height: 26, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <CalendarDays size={10} color={tone('rose')} />
                        <T size={8} weight={800}>
                            Citas
                        </T>
                        <T size={7} color={C.mutedFg}>
                            · Semana
                        </T>
                    </div>
                    {['Mié 29', 'Jue 30', 'Vie 31'].map((d, i) => (
                        <At key={d} x={LEFT + i * COL} y={28} w={COL} h={16} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={7} weight={700} color={C.mutedFg}>
                                {d}
                            </T>
                        </At>
                    ))}
                    {HOURS.map((h, i) => (
                        <At key={h} x={4} y={TOP + i * ROW - 4} w={280} h={8} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <T size={6} color={C.mutedFg} style={{ width: 26, textAlign: 'right' }}>
                                {h}:00
                            </T>
                            <span style={{ flex: 1, height: 1, background: C.border, opacity: 0.7 }} />
                        </At>
                    ))}
                    {[1, 2].map((i) => (
                        <At key={i} x={LEFT + i * COL} y={TOP} w={1} h={ROW * 7} style={{ background: C.border, opacity: 0.6 }} />
                    ))}
                    {/* Otras citas */}
                    {(
                        [
                            [0, 13, 'Barba · Luis'],
                            [1, 11, 'Corte · Ana'],
                            [2, 9.5, 'Corte · Jorge'],
                            [2, 12.5, 'Barba · Raúl'],
                        ] as const
                    ).map(([c, h, l]) => (
                        <At key={l} x={LEFT + c * COL + 3} y={TOP + (h - 9) * ROW} w={COL - 6} h={18} style={{ borderRadius: 4, background: tone('violet', 0.14), borderLeft: `2px solid ${tone('violet')}`, padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                            <T size={6.5}>{l}</T>
                        </At>
                    ))}
                    {/* Hueco que deja */}
                    <At x={LEFT + 3} y={TOP + 1.5 * ROW} w={COL - 6} h={30} a="cr-ghost" style={{ borderRadius: 4, border: `1px dashed ${C.border}` }} />
                    {/* La cita que se mueve */}
                    <At
                        x={LEFT + COL + 3}
                        y={TOP + 5 * ROW}
                        w={COL - 6}
                        h={30}
                        a="cr-move"
                        style={{ borderRadius: 5, background: C.card, border: `1px solid ${tone('amber', 0.6)}`, borderLeft: `3px solid ${tone('amber')}`, padding: '2px 4px', display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 6px 14px -8px rgba(15,23,42,.45)', zIndex: 4 }}
                    >
                        <T size={6.5} weight={700}>
                            Corte · Carlos M.
                        </T>
                        <span style={{ position: 'relative', height: 12 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'cr-st1' }}>
                                <Chip label="Confirmada" t="mint" style={{ height: 12, fontSize: 6, padding: '0 4px' }} />
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'cr-st2' }}>
                                <Chip label="Reprogramada" t="amber" style={{ height: 12, fontSize: 6, padding: '0 4px' }} />
                            </span>
                        </span>
                    </At>
                </At>
                <At x={196} y={244} a="cr-toast" style={{ zIndex: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 9px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -10px rgba(15,23,42,.5)' }}>
                        <CalendarClock size={10} color={tone('amber')} />
                        <T size={7.5} weight={600}>
                            Se reprogramó la cita de Carlos Méndez: jueves 30, 2:00 p. m.
                        </T>
                    </span>
                </At>
                <Cursor a="cr-cursor" click="cr-ring" rest={[86, 166]} />
            </At>
        </Stage>
    );
}
