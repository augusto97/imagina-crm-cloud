import { Coffee, KeyRound, Mail } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Dar acceso al portal: se escribe el correo del cliente en su ficha, le llega el enlace y con un toque entra a su portal. */

const CSS = `
@keyframes pml-type{0%,6%{width:0}20%,100%{width:78px}}
@keyframes pml-cursor{0%{transform:translate(120px,280px);opacity:0}6%{opacity:1}22%,27%{transform:translate(198px,121px)}34%{opacity:1}38%,100%{transform:translate(198px,121px);opacity:0}}
@keyframes pml-ring{0%,23%{opacity:0;transform:scale(.4)}25%{opacity:1;transform:scale(1)}29%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pml-btn{0%,24%{transform:scale(1)}26%{transform:scale(.94)}29%,100%{transform:scale(1)}}
@keyframes pml-form{0%,28%{opacity:1}32%,94%{opacity:0}100%{opacity:1}}
@keyframes pml-row{0%,28%{opacity:0;transform:translateY(6px)}34%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pml-not{0%,70%{opacity:1}74%,100%{opacity:0}}
@keyframes pml-in{0%,70%{opacity:0}74%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pml-fly{0%,30%{opacity:0;transform:translate(0,0) scale(.6)}33%{opacity:1;transform:translate(0,0) scale(1)}44%{opacity:1;transform:translate(150px,-60px) scale(1)}47%,100%{opacity:0;transform:translate(156px,-62px) scale(.6)}}
@keyframes pml-mail{0%,44%{opacity:0;transform:translateY(-8px)}49%,62%{opacity:1;transform:translateY(0)}66%,100%{opacity:0}}
@keyframes pml-tap{0%,52%{transform:translate(420px,290px);opacity:0}56%{opacity:1}60%,63%{transform:translate(386px,147px);opacity:1}70%,100%{transform:translate(386px,147px);opacity:0}}
@keyframes pml-tapring{0%,60%{opacity:0;transform:scale(.4)}62%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pml-lock{0%,40%{opacity:1}44%,94%{opacity:0}100%{opacity:1}}
@keyframes pml-portal{0%,64%{opacity:0;transform:scale(.96)}69%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

export default function PortalMagicLink(): JSX.Element {
    return (
        <Stage label="En la ficha del cliente se escribe su correo y se toca Dar acceso; al cliente le llega el enlace, lo toca y entra a su portal sin crear cuenta; en la ficha queda su última entrada." tint="cyan">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Tarjeta de la ficha */}
                <At
                    x={18}
                    y={64}
                    w={212}
                    h={170}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: primary(0.14), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <KeyRound size={12} />
                        </span>
                        <T size={9} weight={800}>
                            Acceso al portal del cliente
                        </T>
                    </span>
                    <At x={12} y={44} w={188} a="pml-form" style={{ opacity: 0, display: 'flex', gap: 6 }}>
                        <span style={{ flex: 1, height: 22, borderRadius: 6, border: `1px solid ${primary(0.6)}`, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 78, animationName: 'pml-type' }}>
                                <T size={8.5}>ana@gomez.co</T>
                            </span>
                        </span>
                        <span data-a="" style={{ height: 22, padding: '0 9px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', animationName: 'pml-btn' }}>
                            <T size={8.5} weight={700} color={C.primaryFg}>
                                Dar acceso
                            </T>
                        </span>
                    </At>
                    <At x={12} y={44} w={188} a="pml-row" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: 8, borderRadius: 8, border: `1px solid ${C.border}` }}>
                        <Avatar initials="AG" t="violet" size={22} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <T size={8.5} weight={700}>
                                    ana@gomez.co
                                </T>
                                <Chip label="Activo" t="mint" style={{ height: 13, fontSize: 7, padding: '0 5px' }} />
                            </span>
                            <span style={{ position: 'relative', height: 10 }}>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'pml-not' }}>
                                    <T size={7.5} color={C.mutedFg}>
                                        Todavía no entró
                                    </T>
                                </span>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'pml-in' }}>
                                    <T size={7.5} color={tone('mint')} weight={600}>
                                        Última entrada: hace un momento
                                    </T>
                                </span>
                            </span>
                        </span>
                    </At>
                    <At x={12} y={100} w={188} style={{ display: 'flex', gap: 6 }}>
                        {['Reenviar enlace', 'Quitar acceso'].map((l) => (
                            <span key={l} style={{ height: 19, padding: '0 8px', borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                                <T size={7.5} weight={600} color={l === 'Quitar acceso' ? C.destructive : C.fg}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </At>
                    <At x={12} y={128} w={188}>
                        <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            El enlace es de un solo uso y vence en 24 h. Su sesión dura 30 días y se renueva cada vez que vuelve.
                        </T>
                    </At>
                </At>
                {/* El sobre que viaja */}
                <At x={196} y={128} a="pml-fly" style={{ opacity: 0, zIndex: 8 }}>
                    <span style={{ width: 30, height: 22, borderRadius: 6, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 18px -6px ${primary(0.6)}` }}>
                        <Mail size={13} />
                    </span>
                </At>

                {/* El celular del cliente */}
                <At
                    x={312}
                    y={18}
                    w={148}
                    h={266}
                    style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}
                >
                    <div style={{ position: 'absolute', left: 52, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={0} y={52} w={138} a="pml-lock" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                        <T size={26} weight={300}>
                            9:41
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            lunes, 26 de octubre
                        </T>
                    </At>
                    {/* El correo */}
                    <At x={8} y={22} w={122} a="pml-mail" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10, borderRadius: 10, background: C.card, border: `1px solid ${C.border}` }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 4, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Coffee size={9} />
                            </span>
                            <T size={7.5} weight={800}>
                                Café Aurora
                            </T>
                        </span>
                        <T size={9} weight={800} style={{ whiteSpace: 'normal' }}>
                            Tu acceso al portal de Café Aurora
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Hola Ana, toca el botón para ver tus facturas y pedidos.
                        </T>
                        <span style={{ height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Entrar a mi portal
                            </T>
                        </span>
                    </At>
                    {/* El portal */}
                    <At x={0} y={14} w={138} h={240} a="pml-portal" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 4, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Coffee size={9} />
                            </span>
                            <T size={7.5} weight={800}>
                                Café Aurora
                            </T>
                        </span>
                        <T size={11} weight={800}>
                            Hola, Ana
                        </T>
                        <span style={{ borderRadius: 8, border: `1px solid ${C.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                                SALDO PENDIENTE
                            </T>
                            <T size={11} weight={800} color={tone('rose')}>
                                $ 380.000
                            </T>
                        </span>
                        <T size={8} weight={800}>
                            Tus facturas
                        </T>
                        {(
                            [
                                ['FAC-0051', 'Pendiente', 'amber'],
                                ['FAC-0049', 'Pagada', 'mint'],
                                ['FAC-0047', 'Pagada', 'mint'],
                            ] as const
                        ).map(([n, st, t]) => (
                            <span key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 5, borderBottom: `1px solid ${C.border}` }}>
                                <T size={8} weight={600}>
                                    {n}
                                </T>
                                <Chip label={st} t={t} style={{ height: 14, fontSize: 7.5 }} />
                            </span>
                        ))}
                    </At>
                </At>
                <Cursor a="pml-cursor" click="pml-ring" rest={[198, 121]} />
                <Cursor a="pml-tap" click="pml-tapring" rest={[386, 147]} />
            </At>
        </Stage>
    );
}
