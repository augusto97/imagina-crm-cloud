import { Bell, CalendarPlus, Paperclip, Scissors } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, tone } from '../kit';

/** El correo de confirmación: resumen, enlaces para cambiar o cancelar y el archivo del calendario; después, el recordatorio. */

const CSS = `
@keyframes ce-mail{0%,3%{opacity:0;transform:translateY(10px)}10%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(10px)}}
@keyframes ce-cursor{0%,14%{transform:translate(200px,290px);opacity:0}18%{opacity:1}26%,30%{transform:translate(78px,256px);opacity:1}38%,100%{transform:translate(78px,256px);opacity:0}}
@keyframes ce-ring{0%,26%{opacity:0;transform:scale(.4)}28%{opacity:1;transform:scale(1)}32%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ce-ev{0%,31%{opacity:0;transform:scale(.6)}36%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ce-note{0%,56%{opacity:0;transform:translateY(-14px)}62%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(-14px)}}
`;

export default function CitasEmail(): JSX.Element {
    return (
        <Stage label="El cliente recibe el correo Tu cita está confirmada con el servicio, con quién, cuándo y dónde, los botones Cambiar el horario y Cancelar la cita y el archivo adjunto que la agrega a su calendario. El día antes le llega el recordatorio." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El correo */}
                <At
                    x={16}
                    y={16}
                    w={290}
                    h={268}
                    a="ce-mail"
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 16px 38px -16px rgba(15,23,42,.5)' }}
                >
                    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8.5} weight={800}>
                            Tu cita está confirmada: Corte, 29 oct, 10:30 a. m.
                        </T>
                        <T size={7} color={C.mutedFg}>
                            Barbería El Clásico · para carlos.mendez@correo.com
                        </T>
                    </div>
                    <div style={{ height: 4, background: tone('amber') }} />
                    <div style={{ padding: '9px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                            <span style={{ width: 18, height: 18, borderRadius: 99, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Scissors size={10} />
                            </span>
                            <T size={9} weight={800}>
                                Barbería El Clásico
                            </T>
                        </span>
                        <T size={7.5}>Hola, Carlos:</T>
                        <T size={7.5}>Tu cita con Barbería El Clásico quedó agendada.</T>
                        <span style={{ borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '3px 0', display: 'flex', flexDirection: 'column' }}>
                            {(
                                [
                                    ['Servicio', 'Corte · 40 min'],
                                    ['Con', 'Mateo Garza'],
                                    ['Cuándo', 'miércoles 29 de octubre, 10:30 a. m.'],
                                    ['Dónde', 'Av. Constitución 812, Monterrey'],
                                ] as const
                            ).map(([k, v]) => (
                                <span key={k} style={{ display: 'flex', gap: 8, padding: '2.5px 0' }}>
                                    <T size={7} color={C.mutedFg} style={{ width: 44 }}>
                                        {k}
                                    </T>
                                    <T size={7.5}>{v}</T>
                                </span>
                            ))}
                        </span>
                        <span style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 2 }}>
                            <span style={{ height: 21, padding: '0 10px', borderRadius: 6, background: tone('amber'), display: 'flex', alignItems: 'center' }}>
                                <T size={7.5} weight={700} color="#fff">
                                    Cambiar el horario
                                </T>
                            </span>
                            <span style={{ height: 21, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                                <T size={7.5} weight={700}>
                                    Cancelar la cita
                                </T>
                            </span>
                        </span>
                    </div>
                    {/* Adjunto */}
                    <At x={12} y={232} w={130} h={26} style={{ borderRadius: 7, border: `1px solid ${C.border}`, background: C.muted, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px' }}>
                        <Paperclip size={10} color={C.mutedFg} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={7.5} weight={700}>
                                cita.ics
                            </T>
                            <T size={6} color={C.mutedFg}>
                                Agregar al calendario
                            </T>
                        </span>
                    </At>
                </At>

                {/* El teléfono del cliente */}
                <At x={328} y={18} w={136} h={266} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}>
                    <div style={{ position: 'absolute', left: 46, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={10} y={24} w={106}>
                        <T size={9} weight={800}>
                            Miércoles 29
                        </T>
                    </At>
                    {[9, 10, 11, 12].map((h, i) => (
                        <At key={h} x={8} y={50 + i * 44} w={110} h={10} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <T size={6} color={C.mutedFg} style={{ width: 18, textAlign: 'right' }}>
                                {h}:00
                            </T>
                            <span style={{ flex: 1, height: 1, background: C.border }} />
                        </At>
                    ))}
                    {/* El evento que agregó el archivo */}
                    <At
                        x={32}
                        y={55 + 44 * 1.5}
                        w={86}
                        h={30}
                        a="ce-ev"
                        style={{ borderRadius: 6, background: tone('amber', 0.22), borderLeft: `3px solid ${tone('amber')}`, padding: '3px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <CalendarPlus size={8} color={tone('amber')} />
                            <T size={7} weight={700}>
                                Corte
                            </T>
                        </span>
                        <T size={6} color={C.mutedFg}>
                            10:30 – 11:10
                        </T>
                    </At>
                    {/* Recordatorio */}
                    <At
                        x={6}
                        y={14}
                        w={114}
                        a="ce-note"
                        style={{ borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -8px rgba(15,23,42,.5)', padding: '6px 7px', display: 'flex', gap: 5 }}
                    >
                        <span style={{ width: 16, height: 16, borderRadius: 5, background: tone('rose'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Bell size={9} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                            <T size={6.5} weight={800} style={{ whiteSpace: 'normal' }}>
                                Recordatorio de tu cita
                            </T>
                            <T size={6} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                Te recordamos tu cita mañana con Barbería El Clásico.
                            </T>
                        </span>
                    </At>
                </At>
                <Cursor a="ce-cursor" click="ce-ring" rest={[78, 256]} />
            </At>
        </Stage>
    );
}
