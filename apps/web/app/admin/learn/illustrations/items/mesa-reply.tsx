import { ChevronDown, Lock, Send } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Responder por correo» desde la ficha del ticket: se elige una respuesta
 * guardada, se agrega la firma, se elige el estado en que queda el ticket y se
 * envía. La nota interna, en cambio, se queda adentro: nunca sale por correo.
 */

const CSS = `
@keyframes mr-txt{0%,14%{opacity:0}20%,100%{opacity:1}}
@keyframes mr-ph{0%,14%{opacity:1}18%,100%{opacity:0}}
@keyframes mr-pick{0%,8%{background:${C.card}}11%,15%{background:${primary(0.14)}}19%,100%{background:${C.card}}}
@keyframes mr-cur{0%{transform:translate(170px,290px);opacity:0}5%{opacity:1}10%,14%{transform:translate(150px,130px)}40%,46%{transform:translate(268px,260px)}58%,100%{transform:translate(300px,290px);opacity:0}}
@keyframes mr-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}16%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}47%,100%{opacity:0;transform:scale(1.6)}}
@keyframes mr-sent{0%,48%{opacity:0;transform:translateY(6px)}54%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mr-st1{0%,48%{opacity:1}52%,100%{opacity:0}}
@keyframes mr-st2{0%,48%{opacity:0}52%,92%{opacity:1}97%,100%{opacity:0}}
`;

function Line({ label, value }: { label: string; value: JSX.Element | string }): JSX.Element {
    return (
        <span style={{ display: 'grid', gridTemplateColumns: '44px 1fr', alignItems: 'center', gap: 6, height: 20, borderBottom: `1px solid ${C.border}` }}>
            <T size={8} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ fontSize: 8.5, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{value}</span>
        </span>
    );
}

export default function MesaReply(): JSX.Element {
    return (
        <Stage label="Responder por correo desde la ficha del ticket: se elige una respuesta guardada, se agrega la firma, se elige el estado en que queda el ticket y se envía; las notas internas nunca salen por correo." tint="blue">
            <Keyframes css={CSS} />

            <At x={18} y={14} w={290} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 12, boxShadow: '0 16px 38px -18px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={8} weight={700} color={primary()} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        TCK-0042
                    </T>
                    <T size={10.5} weight={700}>
                        Responder por correo
                    </T>
                </span>
                <Line label="De" value="soporte@cafeaurora.co" />
                <Line label="Para" value="ana@hotelbrisas.co" />
                <Line label="Asunto" value="Re: No puedo descargar mi factura [TCK-0042]" />
                <span data-a="" style={{ animationName: 'mr-pick', height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 7px', fontSize: 8.5, fontWeight: 600 }}>
                    Insertar una respuesta guardada: «Lo resolvimos» <ChevronDown size={10} />
                </span>
                <span style={{ position: 'relative', height: 72, borderRadius: 6, border: `1px solid ${C.border}`, padding: '6px 8px' }}>
                    <span data-a="" style={{ animationName: 'mr-ph', position: 'absolute', left: 8, top: 6, opacity: 0 }}>
                        <T size={8.5} color={C.mutedFg}>
                            Escribe la respuesta al cliente…
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: 'mr-txt', position: 'absolute', left: 8, right: 8, top: 6 }}>
                        <T size={8.5} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.4 }}>
                            Hola Ana, ya resolvimos tu solicitud (TCK-0042). Si algo no quedó bien, responde a este correo y la volvemos a abrir.
                            <br />
                            Saludos, Jorge Herrera
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: primary(), color: C.primaryFg, fontSize: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                    <T size={8.5}>Agregar mi firma</T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={8.5} color={C.mutedFg}>
                        Después, poner el estado en
                    </T>
                    <Chip label="Resuelto" t="mint" />
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'auto' }}>
                    <Btn label="Cancelar" kind="outline" />
                    <Btn label={<><Send size={10} /> Enviar</>} />
                </span>
            </At>

            {/* Lo que pasa con el ticket */}
            <At x={326} y={30} w={136} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={8} weight={700} color={C.mutedFg}>
                        ESTADO DEL TICKET
                    </T>
                    <span style={{ position: 'relative', display: 'block', height: 16 }}>
                        <span data-a="" style={{ animationName: 'mr-st1', position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0 }}>
                            <Chip label="En proceso" t="amber" />
                        </span>
                        <span data-a="" style={{ animationName: 'mr-st2', position: 'absolute', left: 0, top: 0, display: 'flex' }}>
                            <Chip label="Resuelto" t="mint" />
                        </span>
                    </span>
                </span>
                <span data-a="" style={{ animationName: 'mr-sent', background: C.card, border: `1px solid ${tone('mint', 0.5)}`, borderRadius: 10, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={9} weight={700} color={C.success}>
                        El correo salió
                    </T>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                        A ana@hotelbrisas.co, en la misma conversación.
                    </T>
                </span>
                <span style={{ background: C.muted, borderRadius: 10, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={10} color={C.mutedFg} />
                        <T size={8.5} weight={700}>
                            Nota interna
                        </T>
                    </span>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                        «Fue un error del sistema de facturas.» Nunca sale por correo.
                    </T>
                </span>
            </At>

            <Cursor a="mr-cur" click="mr-ring" />
        </Stage>
    );
}
