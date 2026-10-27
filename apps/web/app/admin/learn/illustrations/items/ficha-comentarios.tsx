import type { ReactNode } from 'react';
import { BellRing, CornerDownRight, MessageSquare, Send } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** Comentarios: una mención a @Juan, una reacción y una respuesta en hilo; la casilla decide si lo ve el cliente. */

const CSS = `
@keyframes fc-type{0%,8%{width:0}30%,34%{width:190px}38%,100%{width:0}}
@keyframes fc-ph{0%,7%{opacity:1}9%,36%{opacity:0}40%,100%{opacity:1}}
@keyframes fc-pop{0%,12%{opacity:0;transform:translateY(4px)}15%,22%{opacity:1;transform:translateY(0)}25%,100%{opacity:0}}
@keyframes fc-new{0%,36%{opacity:0;transform:translateY(8px)}41%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes fc-react{0%,50%{opacity:0;transform:scale(.4)}54%,94%{opacity:1;transform:scale(1)}99%,100%{opacity:0}}
@keyframes fc-reply{0%,64%{opacity:0;transform:translateY(6px)}69%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes fc-send{0%,32%{background:${primary(0.45)}}34%,36%{background:${primary()}}40%,100%{background:${primary(0.45)}}}
`;

function Bubble({ children }: { children: ReactNode }): JSX.Element {
    return <span style={{ display: 'block', background: C.muted, borderRadius: '3px 10px 10px 10px', padding: '4px 8px', fontSize: 9.5, lineHeight: 1.35, color: C.fg }}>{children}</span>;
}

function Head({ name, when, ini, t }: { name: string; when: string; ini: string; t: 'violet' | 'amber' | 'cyan' }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <Avatar initials={ini} t={t} size={16} />
            <T size={9.5} weight={700}>
                {name}
            </T>
            <T size={8} color={C.mutedFg}>
                {when}
            </T>
        </span>
    );
}

export default function FichaComentarios(): JSX.Element {
    const mention = { color: primary(), fontWeight: 700, background: primary(0.12), borderRadius: 4, padding: '0 3px' } as const;
    return (
        <Stage label="El panel de comentarios de un registro: se escribe un comentario mencionando a @Juan, aparece en la conversación, recibe una reacción con el pulgar arriba y Juan responde en el hilo." tint="blue">
            <Keyframes css={CSS} />
            <At x={70} y={14} w={340} h={276} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(15,23,42,.45)', overflow: 'hidden' }}>
                <At x={0} y={0} w={340} h={32} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: primary(), borderBottom: `2px solid ${primary()}`, height: 32 }}>
                        <MessageSquare size={11} />
                        <T size={9.5} weight={700} color={primary()}>
                            Comentarios
                        </T>
                    </span>
                    <T size={9.5} weight={600} color={C.mutedFg}>
                        Actividad
                    </T>
                </At>

                <At x={14} y={40} w={312} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                        <Head name="Laura Gómez" when="hace 2 h" ini="LG" t="cyan" />
                        <Bubble>El cliente pidió cambiar la fecha de entrega al 15/11.</Bubble>
                    </div>
                    <div data-a="" style={{ animationName: 'fc-new' }}>
                        <Head name="Ana Martínez" when="hace un momento" ini="AM" t="violet" />
                        <Bubble>
                            <span style={mention}>@Juan</span> revisa el contrato antes del viernes, por favor.
                        </Bubble>
                        <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3, padding: '0 7px', borderRadius: 99, border: `1px solid ${primary(0.5)}`, background: primary(0.1), fontSize: 9, fontWeight: 700, animationName: 'fc-react' }}>
                            👍 1
                        </span>
                        <div data-a="" style={{ display: 'flex', gap: 5, marginTop: 4, marginLeft: 12, animationName: 'fc-reply' }}>
                            <CornerDownRight size={11} color={C.mutedFg} style={{ marginTop: 4 }} />
                            <div style={{ flex: 1 }}>
                                <Head name="Juan Pérez" when="ahora" ini="JP" t="amber" />
                                <Bubble>Listo, ya lo revisé ✅</Bubble>
                            </div>
                        </div>
                    </div>
                </At>

                {/* Caja para comentar */}
                <At x={14} y={206} w={312} h={60} style={{ border: `1px solid ${primary(0.5)}`, borderRadius: 9, padding: '7px 9px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <span style={{ position: 'relative', height: 14 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, fontSize: 9.5, color: C.mutedFg, animationName: 'fc-ph' }}>
                            Escribe un comentario… Usa @ para mencionar.
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, width: 0, overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 9.5, animationName: 'fc-type' }}>
                            <span style={mention}>@Juan</span> revisa el contrato antes…
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, border: `1px solid ${C.border}` }} />
                            <T size={8.5} color={C.mutedFg}>
                                Visible para el cliente
                            </T>
                        </span>
                        <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 9px', borderRadius: 6, color: C.primaryFg, fontSize: 9, fontWeight: 600, animationName: 'fc-send', background: primary(0.45) }}>
                            <Send size={10} />
                            Enviar
                        </span>
                    </span>
                </At>

                {/* Sugerencias de mención */}
                <At x={30} y={142} w={170} a="fc-pop" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: 5, boxShadow: '0 14px 30px -12px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {(
                        [
                            ['Juan Pérez', 'JP', 'amber', true],
                            ['Juana Ríos', 'JR', 'cyan', false],
                            ['Equipo Comercial · 4', 'EC', 'violet', false],
                        ] as const
                    ).map(([n, i, t, on]) => (
                        <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: on ? primary(0.12) : 'transparent' }}>
                            <Avatar initials={i} t={t} size={16} />
                            <T size={9} weight={600}>
                                {n}
                            </T>
                        </span>
                    ))}
                </At>
            </At>
            <At x={420} y={60} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: tone('amber', 0.2), display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone('amber') }}><BellRing size={14} /></span>
                <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center', width: 52 }}>
                    Juan recibe el aviso
                </T>
            </At>
        </Stage>
    );
}
