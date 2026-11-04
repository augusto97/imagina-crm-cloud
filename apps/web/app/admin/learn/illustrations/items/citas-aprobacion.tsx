import { CalendarCheck, Check, Clock, Mail, MousePointer2, ShieldCheck, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * v0.1.353 — La aprobación de una cita: el cliente confirma su correo con un
 * código, la cita queda «Por confirmar» (el horario queda apartado), alguien
 * del equipo la aprueba desde la ficha y sólo entonces llega la confirmación con
 * el evento para el calendario.
 */

const CSS = `
@keyframes ca-digit{0%,6%{opacity:0;transform:translateY(4px)}12%,100%{opacity:1;transform:none}}
@keyframes ca-code{0%,27%{opacity:1}31%,100%{opacity:0}}
@keyframes ca-pending{0%,33%{opacity:0;transform:translateY(6px)}39%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes ca-ficha{0%,37%{opacity:0;transform:translateY(6px)}43%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes ca-hand{0%,48%{opacity:0;transform:translate(14px,10px)}54%{opacity:1;transform:none}60%,64%{opacity:1;transform:scale(.88)}68%{opacity:1;transform:none}74%,100%{opacity:0}}
@keyframes ca-chip-pending{0%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes ca-chip-ok{0%,62%{opacity:0}66%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ca-buttons{0%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes ca-decided{0%,64%{opacity:0;transform:translateY(4px)}70%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes ca-mail{0%,72%{opacity:0;transform:scale(.6)}80%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;
const DIGITS = ['4', '8', '2', '0', '7', '1'];

export default function CitasAprobacion(): JSX.Element {
    return (
        <Stage
            label="La aprobación de una cita: el cliente confirma su correo con un código de 6 números, la cita queda «Por confirmar» con el horario apartado, alguien del equipo la aprueba desde la ficha y al cliente le llega la confirmación con el evento para su calendario."
            tint="violet"
            cycle={10}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* La página pública: código y «por confirmar» */}
                <At x={16} y={26} w={210} h={252} style={{ ...card, padding: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={11} color={tone('violet')} />
                        <T size={8.5} weight={800}>
                            Agenda tu cita
                        </T>
                    </span>
                    <At x={12} y={34} w={186} h={120} a="ca-code" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Te enviamos un código a carla@correo.com
                        </T>
                        <span style={{ display: 'flex', gap: 5 }}>
                            {DIGITS.map((d, i) => (
                                <span
                                    key={i}
                                    style={{ width: 24, height: 30, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.canvas }}
                                >
                                    <span data-a="" style={{ animationName: 'ca-digit', animationDelay: `${i * 0.18}s` }}>
                                        <T size={10} weight={800}>
                                            {d}
                                        </T>
                                    </span>
                                </span>
                            ))}
                        </span>
                        <span style={{ borderRadius: 6, background: tone('violet'), padding: '6px 0', textAlign: 'center' }}>
                            <T size={7.5} weight={700} color="#fff">
                                Confirmar
                            </T>
                        </span>
                    </At>
                    <At x={12} y={34} w={186} h={150} a="ca-pending" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 99, background: tone('amber', 0.16) }}>
                            <Clock size={15} color={tone('amber')} />
                        </span>
                        <T size={9} weight={800}>
                            Recibimos tu solicitud
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Asesoría · jueves 10:00. Te avisaremos por correo cuando la confirmemos.
                        </T>
                        <span style={{ alignSelf: 'flex-start', borderRadius: 99, background: tone('amber', 0.16), padding: '2px 8px' }}>
                            <T size={6.5} weight={700} color={tone('amber')}>
                                Por confirmar
                            </T>
                        </span>
                        <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            El horario queda apartado mientras tanto.
                        </T>
                    </At>
                </At>

                {/* La ficha del registro: aprobar */}
                <At x={242} y={26} w={222} h={150} a="ca-ficha" style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarCheck size={11} color={tone('blue')} />
                        <T size={8.5} weight={800}>
                            Carla Gómez
                        </T>
                        <span style={{ marginLeft: 'auto', position: 'relative', width: 66, height: 14 }}>
                            <span data-a="" style={{ position: 'absolute', right: 0, borderRadius: 99, background: tone('amber', 0.16), padding: '2px 7px', animationName: 'ca-chip-pending' }}>
                                <T size={6.5} weight={700} color={tone('amber')}>
                                    Por confirmar
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', right: 0, borderRadius: 99, background: tone('mint', 0.16), padding: '2px 7px', animationName: 'ca-chip-ok' }}>
                                <T size={6.5} weight={700} color={tone('mint')}>
                                    Confirmada
                                </T>
                            </span>
                        </span>
                    </span>
                    <T size={7} color={C.mutedFg}>
                        Cita por confirmar · decide antes de 24 horas
                    </T>
                    <span style={{ position: 'relative', height: 24 }}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', gap: 6, animationName: 'ca-buttons' }}>
                            <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 6, background: tone('mint'), padding: '5px 0' }}>
                                <Check size={9} color="#fff" />
                                <T size={7.5} weight={700} color="#fff">
                                    Aprobar
                                </T>
                            </span>
                            <span style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 6, border: `1px solid ${C.border}`, padding: '5px 0' }}>
                                <X size={9} color={C.mutedFg} />
                                <T size={7.5} weight={700}>
                                    Rechazar
                                </T>
                            </span>
                        </span>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 5, animationName: 'ca-decided' }}>
                            <Check size={10} color={tone('mint')} />
                            <T size={7.5} weight={700}>
                                Cita aprobada por Ana
                            </T>
                        </span>
                    </span>
                    <At x={50} y={88} a="ca-hand">
                        <MousePointer2 size={13} color={C.fg} fill={C.card} />
                    </At>
                </At>
                <At x={242} y={190} w={222} h={64} a="ca-mail" style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: tone('mint', 0.16) }}>
                        <Mail size={13} color={tone('mint')} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={800}>
                            Tu cita está confirmada
                        </T>
                        <T size={6.5} color={C.mutedFg}>
                            Con el evento para su calendario
                        </T>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
