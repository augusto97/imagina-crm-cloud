import { Check, Clock, Mail, MailCheck, ShieldCheck } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Confirmar el correo con un clic: la respuesta queda pendiente, llega el correo, la persona confirma y recién ahí nace el registro. */

const CSS = `
@keyframes fdo-mail{0%,10%{opacity:0;transform:translateY(-10px)}16%,100%{opacity:1;transform:translateY(0)}}
@keyframes fdo-unread{0%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes fdo-body{0%,30%{opacity:0;transform:translateY(6px)}36%,100%{opacity:1;transform:translateY(0)}}
@keyframes fdo-cursor{0%,28%{transform:translate(300px,290px);opacity:0}34%{opacity:1}46%,52%{transform:translate(253px,197px);opacity:1}64%,100%{transform:translate(253px,197px);opacity:0}}
@keyframes fdo-ring{0%,48%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}54%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fdo-btn{0%,49%{transform:scale(1)}51%{transform:scale(.95)}54%,100%{transform:scale(1)}}
@keyframes fdo-wait{0%,53%{opacity:1}57%,94%{opacity:0}100%{opacity:1}}
@keyframes fdo-ok{0%,53%{opacity:0;transform:scale(.92)}58%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fdo-pend{0%,54%{opacity:1}58%,94%{opacity:0}100%{opacity:1}}
@keyframes fdo-row{0%,55%{opacity:0;transform:translateX(12px)}61%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes fdo-glow{0%,60%{background:${tone('mint', 0.16)}}86%,100%{background:transparent}}
`;

export default function FormDoubleOptin(): JSX.Element {
    return (
        <Stage label="Con la confirmación por correo, la respuesta queda pendiente; a la persona le llega un correo, toca Confirmar y recién ahí aparece el registro en la lista." tint="mint">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El formulario después de enviar */}
                <At
                    x={18}
                    y={56}
                    w={140}
                    h={188}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={0} y={30} w={140} a="fdo-wait" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '0 12px' }}>
                        <span style={{ width: 34, height: 34, borderRadius: 99, background: primary(0.14), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={16} />
                        </span>
                        <T size={10} weight={800}>
                            Revisa tu correo
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center' }}>
                            Te enviamos un enlace para confirmar tu respuesta. Vence en 48 horas.
                        </T>
                    </At>
                    <At x={0} y={30} w={140} a="fdo-ok" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '0 12px' }}>
                        <span style={{ width: 34, height: 34, borderRadius: 99, background: tone('mint', 0.18), color: tone('mint'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={18} strokeWidth={3} />
                        </span>
                        <T size={10} weight={800}>
                            ¡Confirmada!
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center' }}>
                            Tu inscripción quedó registrada.
                        </T>
                    </At>
                    <At x={12} y={150} w={116} style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                        <ShieldCheck size={9} color={C.mutedFg} />
                        <T size={6.5} color={C.mutedFg}>
                            Verificado: no es un robot
                        </T>
                    </At>
                </At>

                {/* El correo */}
                <Win x={170} y={50} w={168} h={200} title="Bandeja de entrada">
                    <At x={8} y={8} w={150} a="fdo-mail" style={{ display: 'flex', gap: 6, padding: 6, borderRadius: 7, background: primary(0.07) }}>
                        <Avatar initials="CA" t="amber" size={18} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <T size={8} weight={800}>
                                    Café Aurora
                                </T>
                                <span data-a="" style={{ width: 6, height: 6, borderRadius: 99, background: primary(), opacity: 0, animationName: 'fdo-unread' }} />
                            </span>
                            <T size={7.5} weight={600}>
                                Confirma tu inscripción
                            </T>
                        </span>
                    </At>
                    <At x={8} y={50} w={150} a="fdo-body" style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: 9, borderRadius: 8, border: `1px solid ${C.border}` }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <MailCheck size={11} color={primary()} />
                            <T size={8.5} weight={800}>
                                Hola, Mariana
                            </T>
                        </span>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Para completar tu inscripción al taller, confirma que este es tu correo.
                        </T>
                        <span data-a="" style={{ height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'fdo-btn' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Confirmar mi respuesta
                            </T>
                        </span>
                        <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Si no fuiste tú, ignora este correo.
                        </T>
                    </At>
                </Win>

                {/* La lista */}
                <Win x={350} y={66} w={114} h={170} title="Inscritos">
                    {['Laura P.', 'Pedro G.'].map((n, i) => (
                        <div key={n} style={{ position: 'absolute', left: 0, top: 30 + i * 26, width: 112, height: 26, display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', borderBottom: `1px solid ${C.border}` }}>
                            <Avatar initials={n.slice(0, 2).toUpperCase()} t={i ? 'blue' : 'violet'} size={14} />
                            <T size={8}>{n}</T>
                        </div>
                    ))}
                    {/* Pendiente: todavía no es un registro */}
                    <At x={6} y={4} w={100} h={22} a="fdo-pend" style={{ opacity: 0, borderRadius: 6, border: `1px dashed ${tone('amber', 0.7)}`, display: 'flex', alignItems: 'center', gap: 4, padding: '0 5px' }}>
                        <Clock size={8} color={tone('amber')} />
                        <T size={7} color={tone('amber')} weight={700}>
                            Mariana · pendiente
                        </T>
                    </At>
                    <At x={0} y={4} w={112} h={26} a="fdo-row">
                        <div data-a="" style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', animationName: 'fdo-glow' }}>
                            <Avatar initials="MR" t="mint" size={14} />
                            <T size={8} weight={700}>
                                Mariana R.
                            </T>
                            <Check size={10} color={tone('mint')} strokeWidth={3} />
                        </div>
                    </At>
                </Win>
                <Cursor a="fdo-cursor" click="fdo-ring" rest={[253, 197]} />
            </At>
        </Stage>
    );
}
