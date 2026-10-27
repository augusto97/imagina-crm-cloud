import { CheckCheck, ChevronDown, Send } from 'lucide-react';

import { At, Btn, Bubble, C, Cursor, Keyframes, Pill, Stage, T, tone } from '../kit';

/**
 * Mandar una plantilla desde el registro: «Enviar WhatsApp», eliges la
 * plantilla aprobada, cada variable se llena con un campo del registro y la
 * vista previa muestra el mensaje tal como le llega al cliente.
 */

const CSS = `
@keyframes wt-v1{0%,14%{opacity:0}19%,100%{opacity:1}}
@keyframes wt-v2{0%,24%{opacity:0}29%,100%{opacity:1}}
@keyframes wt-p1{0%,16%{opacity:0}20%,100%{opacity:1}}
@keyframes wt-p2{0%,26%{opacity:0}30%,100%{opacity:1}}
@keyframes wt-cur{0%{transform:translate(120px,290px);opacity:0}8%{opacity:1}44%,50%{transform:translate(276px,262px)}60%,100%{transform:translate(300px,290px);opacity:0}}
@keyframes wt-ring{0%,46%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%,100%{opacity:0;transform:scale(1.6)}}
@keyframes wt-phone{0%,52%{opacity:0;transform:translateY(8px) scale(.96)}58%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes wt-tick{0%,72%{color:${C.mutedFg}}78%,100%{color:${tone('blue')}}}
`;

export default function WabTemplateSend(): JSX.Element {
    return (
        <Stage label="Enviar una plantilla de WhatsApp desde el registro: eliges la plantilla aprobada, sus variables se llenan con los campos del registro y la vista previa muestra el mensaje como le llega al cliente." tint="mint">
            <Keyframes css={CSS} />

            <At
                x={18}
                y={16}
                w={296}
                h={270}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, padding: 13, boxShadow: '0 16px 38px -18px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={12} weight={700}>
                        Enviar WhatsApp
                    </T>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                        Desde +57 601 555 0101. En el registro queda el último mensaje y su estado.
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                    <Pill label="Ventana cerrada: sólo plantillas" t="amber" />
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8} weight={600}>
                            Para
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px', fontSize: 8.5 }}>+57 310 222 3344</span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8} weight={600}>
                            Plantilla
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', fontSize: 8.5, fontWeight: 600 }}>
                            recordatorio_pago <ChevronDown size={10} />
                        </span>
                    </span>
                </span>
                {[
                    { l: 'Mensaje {{1}}', v: '{{cliente}}', a: 'wt-v1' },
                    { l: 'Mensaje {{2}}', v: '{{saldo}}', a: 'wt-v2' },
                ].map((r) => (
                    <span key={r.l} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 6 }}>
                        <T size={8.5} weight={600} color={C.mutedFg}>
                            {r.l}
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                            <span data-a="" style={{ animationName: r.a }}>
                                <Pill label={r.v} t="violet" />
                            </span>
                        </span>
                    </span>
                ))}
                <span style={{ borderRadius: 8, background: tone('mint', 0.08), border: `1px dashed ${tone('mint', 0.5)}`, padding: '7px 9px' }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>
                        Así lo verá el contacto
                    </T>
                    <T size={9} style={{ whiteSpace: 'normal', display: 'block' }}>
                        Hola{' '}
                        <b data-a="" style={{ animationName: 'wt-p1' }}>
                            Ana Gómez
                        </b>
                        , tienes un saldo de{' '}
                        <b data-a="" style={{ animationName: 'wt-p2' }}>
                            $ 450.000
                        </b>
                        . Puedes pagarlo con el botón de abajo.
                    </T>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'auto' }}>
                    <Btn label="Cancelar" kind="outline" />
                    <Btn label={<><Send size={10} /> Enviar</>} />
                </span>
            </At>

            {/* Lo que le llega al cliente */}
            <At x={340} y={30} w={124} h={240} style={{ borderRadius: 20, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)' }}>
                <div style={{ height: 30, background: '#128C7E', display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px' }}>
                    <span style={{ width: 15, height: 15, borderRadius: 99, background: 'rgba(255,255,255,.35)' }} />
                    <T size={8} weight={700} color="#fff">
                        Café Aurora ✓
                    </T>
                </div>
                <div style={{ position: 'relative', height: 200, background: tone('mint', 0.08) }}>
                    <At x={6} y={12} a="wt-phone" style={{ opacity: 1 }}>
                        <Bubble side="left" style={{ maxWidth: 104 }}>
                            Hola <b>Ana Gómez</b>, tienes un saldo de <b>$ 450.000</b>. Puedes pagarlo con el botón de abajo.
                            <span data-a="" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, marginTop: 2, animationName: 'wt-tick', color: tone('blue') }}>
                                <T size={7} color={C.mutedFg}>
                                    9:05
                                </T>
                                <CheckCheck size={10} />
                            </span>
                            <span style={{ display: 'block', marginTop: 5, paddingTop: 4, borderTop: `1px solid ${C.border}`, textAlign: 'center', color: tone('blue'), fontWeight: 700 }}>Pagar ahora</span>
                        </Bubble>
                    </At>
                </div>
            </At>

            <Cursor a="wt-cur" click="wt-ring" />
        </Stage>
    );
}
