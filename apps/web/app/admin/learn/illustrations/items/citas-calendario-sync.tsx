import { CalendarDays, Mail, MousePointer2, Video } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * v0.1.350 — El calendario de cada asesor: la reunión que ya tenía no se
 * ofrece en la agenda, la cita llega a su calendario con su enlace de Meet, y
 * si la arrastra a otra hora en su calendario, la cita se mueve sola y al
 * cliente le llega el aviso.
 */

const CSS = `
@keyframes cc-move{0%,34%{transform:translateY(0)}50%,92%{transform:translateY(128px)}97%,100%{transform:translateY(0)}}
@keyframes cc-hand{0%,26%{opacity:0;transform:translate(10px,8px)}32%{opacity:1;transform:none}50%,58%{opacity:1;transform:translateY(128px)}64%,100%{opacity:0;transform:translateY(128px)}}
@keyframes cc-slot10{0%,52%{opacity:1}58%,92%{opacity:.35}97%,100%{opacity:1}}
@keyframes cc-slot15{0%,52%{background:${tone('mint', 0.12)};color:${C.fg}}58%,92%{background:${tone('rose', 0.14)};color:${tone('rose')}}97%,100%{background:${tone('mint', 0.12)};color:${C.fg}}}
@keyframes cc-moved{0%,58%{opacity:0;transform:translateY(6px)}66%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes cc-mail{0%,70%{opacity:0;transform:scale(.6)}78%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;
const HOURS = ['9:00', '10:00', '11:00', '12:00', '14:00', '15:00'];
const ROW = 32;

export default function CitasCalendarioSync(): JSX.Element {
    return (
        <Stage
            label="El calendario de cada asesor: su reunión de las 9:00 no se ofrece en la agenda; la cita de las 10:00 llega a su Google Calendar con el enlace de Meet; la arrastra a las 15:00 y la cita se mueve sola y al cliente le llega el aviso."
            tint="blue"
            cycle={9}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Su Google Calendar */}
                <At x={16} y={26} w={214} h={252} style={{ ...card, padding: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarDays size={11} color={tone('blue')} />
                        <T size={8.5} weight={800}>
                            Calendario de Ana
                        </T>
                        <T size={6.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                            jueves
                        </T>
                    </span>
                    <At x={10} y={32} w={194} h={ROW * HOURS.length}>
                        {HOURS.map((h, i) => (
                            <At key={h} x={0} y={i * ROW} w={194} h={ROW} style={{ borderTop: `1px solid ${C.border}` }}>
                                <T size={6} color={C.mutedFg} style={{ position: 'absolute', left: 0, top: 3 }}>
                                    {h}
                                </T>
                            </At>
                        ))}
                        {/* Lo que ya tenía (no se ofrece) */}
                        <At x={34} y={3} w={156} h={ROW - 6} style={{ borderRadius: 6, background: tone('slate', 0.18), padding: '4px 6px' }}>
                            <T size={7} weight={700}>
                                Reunión con el banco
                            </T>
                        </At>
                        {/* La cita (creada por la app) */}
                        <At x={34} y={ROW + 3} w={156} h={ROW - 6} a="cc-move" style={{ borderRadius: 6, background: tone('blue', 0.2), borderLeft: `3px solid ${tone('blue')}`, padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <T size={7} weight={700} style={{ flex: 1 }}>
                                Asesoría · Carla
                            </T>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 2, borderRadius: 4, background: tone('mint', 0.2), padding: '1px 4px' }}>
                                <Video size={7} color={tone('mint')} />
                                <T size={5.5} weight={700} color={tone('mint')}>
                                    Meet
                                </T>
                            </span>
                        </At>
                        <At x={150} y={ROW + 14} a="cc-hand">
                            <MousePointer2 size={13} color={C.fg} fill={C.card} />
                        </At>
                    </At>
                </At>

                {/* La agenda pública y la cita */}
                <At x={246} y={26} w={218} h={130} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8.5} weight={800}>
                        Agenda · jueves
                    </T>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {[
                            ['9:00', 'busy'],
                            ['10:00', 'slot10'],
                            ['11:00', ''],
                            ['14:00', ''],
                            ['15:00', 'slot15'],
                        ].map(([h, k]) => (
                            <span
                                key={h}
                                data-a={k === 'slot10' || k === 'slot15' ? '' : undefined}
                                style={{
                                    borderRadius: 6,
                                    border: `1px solid ${C.border}`,
                                    padding: '4px 8px',
                                    background: k === 'busy' ? 'transparent' : tone('mint', 0.12),
                                    color: k === 'busy' ? C.mutedFg : C.fg,
                                    textDecoration: k === 'busy' ? 'line-through' : undefined,
                                    animationName: k === 'slot10' ? 'cc-slot10' : k === 'slot15' ? 'cc-slot15' : undefined,
                                }}
                            >
                                <T size={7} weight={700} color="inherit">
                                    {h}
                                </T>
                            </span>
                        ))}
                    </span>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Lo ocupado en su calendario no se ofrece: de sus eventos sólo se mira el inicio y el fin.
                    </T>
                </At>
                <At x={246} y={168} w={218} h={86} a="cc-moved" style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} weight={800}>
                        La cita se movió a las 15:00
                    </T>
                    <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Ana la cambió en su calendario y la lista se actualizó sola.
                    </T>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 5, borderRadius: 8, background: tone('mint', 0.14), padding: '5px 7px', animationName: 'cc-mail' }}>
                        <Mail size={10} color={tone('mint')} />
                        <T size={7} weight={700}>
                            Le avisamos a Carla por correo
                        </T>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
