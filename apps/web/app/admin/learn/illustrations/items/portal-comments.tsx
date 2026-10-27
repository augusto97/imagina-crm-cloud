import { Bell, Coffee, Eye, Lock, Send } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Comentarios con el cliente: la nota interna se queda en el equipo; la marcada «Visible para el cliente» llega a su portal y él responde. */

const CSS = `
@keyframes pc-type{0%,4%{width:0;opacity:1}16%,25%{width:112px;opacity:1}27%,100%{width:112px;opacity:0}}
@keyframes pc-check{0%,18%{background:transparent;border-color:${C.border}}21%,26%{background:${primary()};border-color:${primary()}}28%,100%{background:transparent;border-color:${C.border}}}
@keyframes pc-tick{0%,18%{opacity:0}21%,26%{opacity:1}28%,100%{opacity:0}}
@keyframes pc-cursor{0%{transform:translate(120px,290px);opacity:0}5%{opacity:1}16%,20%{transform:translate(43px,266px)}24%,27%{transform:translate(242px,266px);opacity:1}36%,100%{transform:translate(242px,266px);opacity:0}}
@keyframes pc-ring{0%,17%{opacity:0;transform:scale(.4)}19%{opacity:1;transform:scale(1)}22%{opacity:0;transform:scale(1.6)}24%{opacity:0;transform:scale(.4)}26%{opacity:1;transform:scale(1)}29%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pc-mine{0%,26%{opacity:0;transform:translateY(8px)}31%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pc-onphone{0%,32%{opacity:0;transform:translateY(8px)}38%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pc-reply{0%,50%{opacity:0;transform:translateY(8px)}56%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pc-replyteam{0%,58%{opacity:0;transform:translateY(8px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pc-bell{0%,60%{opacity:0;transform:scale(.5)}65%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Comment({ ini, t, name, text, tag, tagTone, tagIcon }: { ini: string; t: 'violet' | 'amber' | 'blue'; name: string; text: string; tag: string; tagTone: 'slate' | 'cyan' | 'mint'; tagIcon: JSX.Element }): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 6 }}>
            <Avatar initials={ini} t={t} size={18} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <T size={7.5} weight={800}>
                        {name}
                    </T>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 5px', borderRadius: 99, background: tone(tagTone, 0.14), color: tone(tagTone) }}>
                        {tagIcon}
                        <T size={6.5} weight={700} color="inherit">
                            {tag}
                        </T>
                    </span>
                </span>
                <T size={8} style={{ whiteSpace: 'normal' }}>
                    {text}
                </T>
            </span>
        </span>
    );
}

export default function PortalComments(): JSX.Element {
    return (
        <Stage label="En la ficha del registro, la nota interna sólo la ve el equipo; el comentario marcado Visible para el cliente aparece en su portal, el cliente responde y al equipo le llega el aviso." tint="cyan">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win x={18} y={20} w={272} h={262} title="Pedido #318 · Comentarios">
                    <At x={12} y={10} w={248} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <Comment ini="JP" t="blue" name="Julián (equipo)" text="Ojo: a este cliente le cobramos el envío aparte." tag="Interno" tagTone="slate" tagIcon={<Lock size={7} />} />
                        <span data-a="" style={{ animationName: 'pc-mine' }}>
                            <Comment ini="LG" t="violet" name="Laura" text="¡Hola Ana! Tu pedido sale mañana a primera hora. 🚚" tag="Visible para el cliente" tagTone="cyan" tagIcon={<Eye size={7} />} />
                        </span>
                        <span data-a="" style={{ animationName: 'pc-replyteam' }}>
                            <Comment ini="AG" t="amber" name="Ana Gómez" text="¡Gracias! ¿Me avisan cuando salga?" tag="Del cliente" tagTone="mint" tagIcon={<Eye size={7} />} />
                        </span>
                    </At>
                    {/* Composer */}
                    <At x={10} y={178} w={252} h={56} style={{ borderRadius: 8, border: `1px solid ${primary(0.6)}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 112, opacity: 0, animationName: 'pc-type' }}>
                            <T size={8}>¡Hola Ana! Tu pedido sale…</T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span
                                data-a=""
                                style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${C.border}`, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'pc-check' }}
                            >
                                <svg data-a="" width="7" height="7" viewBox="0 0 10 10" style={{ opacity: 0, animationName: 'pc-tick' }}>
                                    <path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </span>
                            <T size={7.5} weight={600}>
                                Visible para el cliente
                            </T>
                            <span style={{ marginLeft: 'auto', height: 18, padding: '0 8px', borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Send size={8} color={C.primaryFg} />
                                <T size={7.5} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </span>
                    </At>
                </Win>
                <At x={268} y={12} a="pc-bell" style={{ zIndex: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -8px rgba(15,23,42,.45)' }}>
                        <Bell size={10} color={tone('rose')} />
                        <T size={7.5} weight={700}>
                            Ana comentó
                        </T>
                    </span>
                </At>

                {/* El portal del cliente */}
                <At
                    x={316}
                    y={20}
                    w={146}
                    h={262}
                    style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}
                >
                    <div style={{ position: 'absolute', left: 51, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={10} y={18} w={116} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 15, height: 15, borderRadius: 4, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={9} />
                        </span>
                        <T size={7.5} weight={800}>
                            Café Aurora
                        </T>
                    </At>
                    <At x={10} y={40} w={116} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={9.5} weight={800}>
                            Comentarios
                        </T>
                        <span data-a="" style={{ animationName: 'pc-onphone', padding: 7, borderRadius: 9, borderTopLeftRadius: 3, background: C.muted }}>
                            <T size={6.5} weight={800} color={C.mutedFg} style={{ display: 'block', marginBottom: 2 }}>
                                Laura
                            </T>
                            <T size={7.5} style={{ whiteSpace: 'normal' }}>
                                ¡Hola Ana! Tu pedido sale mañana a primera hora. 🚚
                            </T>
                        </span>
                        <span data-a="" style={{ alignSelf: 'flex-end', maxWidth: 104, animationName: 'pc-reply', padding: 7, borderRadius: 9, borderTopRightRadius: 3, background: primary(0.14) }}>
                            <T size={6.5} weight={800} color={primary()} style={{ display: 'block', marginBottom: 2 }}>
                                Tú
                            </T>
                            <T size={7.5} style={{ whiteSpace: 'normal' }}>
                                ¡Gracias! ¿Me avisan cuando salga?
                            </T>
                        </span>
                    </At>
                    <At x={10} y={214} w={116} style={{ height: 22, borderRadius: 99, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                        <T size={7} color={C.mutedFg}>
                            Escribe un comentario…
                        </T>
                    </At>
                    <At x={10} y={186} w={116}>
                        <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            La nota interna del equipo no aparece aquí.
                        </T>
                    </At>
                </At>
                <Cursor a="pc-cursor" click="pc-ring" rest={[242, 266]} />
            </At>
        </Stage>
    );
}
