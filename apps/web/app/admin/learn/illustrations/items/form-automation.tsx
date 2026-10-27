import { ClipboardList, Mail, UserCheck } from 'lucide-react';

import { At, Avatar, Bubble, C, Flow, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/** Cada respuesta dispara una automatización: correo de respuesta a quien llenó el formulario y responsable asignado. */

const CSS = `
@keyframes fa-form{0%,6%{transform:scale(1)}9%{transform:scale(.96)}12%,100%{transform:scale(1)}}
@keyframes fa-s1{0%,12%{box-shadow:0 0 0 0 transparent}16%,24%{box-shadow:0 0 0 3px ${primary(0.35)}}30%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes fa-s2{0%,30%{box-shadow:0 0 0 0 transparent}34%,42%{box-shadow:0 0 0 3px ${primary(0.35)}}48%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes fa-s3{0%,48%{box-shadow:0 0 0 0 transparent}52%,60%{box-shadow:0 0 0 3px ${primary(0.35)}}66%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes fa-dot{0%,10%{opacity:0;transform:translate(0,0)}12%{opacity:1;transform:translate(0,0)}22%{opacity:1;transform:translate(32px,-64px)}24%,28%{opacity:0;transform:translate(107px,-42px)}30%{opacity:1;transform:translate(107px,-42px)}40%{opacity:1;transform:translate(107px,-18px)}42%,46%{opacity:0;transform:translate(107px,30px)}48%{opacity:1;transform:translate(107px,30px)}58%{opacity:1;transform:translate(107px,54px)}60%,100%{opacity:0;transform:translate(107px,54px)}}
@keyframes fa-mail{0%,38%{opacity:0;transform:translateY(8px) scale(.96)}44%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes fa-assign{0%,56%{opacity:0;transform:translateY(8px) scale(.96)}62%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes fa-ok{0%,22%{opacity:0;transform:scale(.4)}26%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Step({ y, kicker, title, icon, t, a }: { y: number; kicker: string; title: string; icon: JSX.Element; t: 'amber' | 'blue' | 'violet'; a: string }): JSX.Element {
    return (
        <At
            x={176}
            y={y}
            w={150}
            h={48}
            a={a}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}
        >
            <IconSquare t={t} size={24}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={8.5} weight={700} style={{ whiteSpace: 'normal', lineHeight: 1.15 }}>
                    {title}
                </T>
            </span>
        </At>
    );
}

export default function FormAutomation(): JSX.Element {
    return (
        <Stage label="Llega una respuesta del formulario y la automatización Cuando se envía un formulario le manda un correo a quien lo llenó y le asigna un responsable al registro." tint="amber">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* La respuesta */}
                <At
                    x={18}
                    y={104}
                    w={128}
                    h={92}
                    a="fa-form"
                    style={{ background: C.card, borderRadius: 11, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 12px 28px -14px rgba(15,23,42,.4)' }}
                >
                    <div style={{ height: 3, background: primary() }} />
                    <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <ClipboardList size={10} color={primary()} />
                            <T size={8.5} weight={800}>
                                Respuesta nueva
                            </T>
                        </span>
                        {(
                            [
                                ['Nombre', 'Camilo Duarte'],
                                ['Correo', 'camilo@duarte.co'],
                                ['Ciudad', 'Medellín'],
                            ] as const
                        ).map(([k, v]) => (
                            <span key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 4 }}>
                                <T size={7} color={C.mutedFg}>
                                    {k}
                                </T>
                                <T size={7.5} weight={600}>
                                    {v}
                                </T>
                            </span>
                        ))}
                    </div>
                </At>
                <Flow x1={146} y1={150} x2={176} y2={86} />
                <Flow x1={251} y1={110} x2={251} y2={134} />
                <Flow x1={251} y1={182} x2={251} y2={206} />
                <Step y={62} kicker="Cuando" title="Se envía un formulario" icon={<ClipboardList size={13} />} t="amber" a="fa-s1" />
                <Step y={134} kicker="Entonces" title="Enviar email a {{correo}}" icon={<Mail size={13} />} t="blue" a="fa-s2" />
                <Step y={206} kicker="Y" title="Responsable = Ana (Medellín)" icon={<UserCheck size={13} />} t="violet" a="fa-s3" />
                <At x={142} y={146} a="fa-dot" style={{ opacity: 0, zIndex: 6 }}>
                    <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
                </At>
                <At x={314} y={56} a="fa-ok">
                    <span style={{ width: 16, height: 16, borderRadius: 99, background: C.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>✓</span>
                </At>

                {/* El correo que recibe */}
                <At x={342} y={76} a="fa-mail">
                    <Bubble side="left" style={{ maxWidth: 124, width: 124 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                            <Mail size={9} color={tone('blue')} />
                            <b style={{ fontSize: 8 }}>Recibimos tu solicitud</b>
                        </span>
                        Hola Camilo, tu cotización está en proceso. Te escribimos en menos de 24 horas.
                    </Bubble>
                </At>
                {/* El registro asignado */}
                <At x={342} y={212} a="fa-assign">
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 124, padding: 8, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -10px rgba(15,23,42,.4)' }}>
                        <T size={8} weight={800}>
                            Camilo Duarte
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <T size={7} color={C.mutedFg}>
                                Responsable
                            </T>
                            <Avatar initials="AM" t="violet" size={14} />
                            <T size={7.5} weight={700}>
                                Ana M.
                            </T>
                        </span>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
