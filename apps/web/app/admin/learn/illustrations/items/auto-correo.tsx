import type { ReactNode } from 'react';
import { FileText, Mail, Send } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «Enviar email» con el diseño visual: a la izquierda la acción (para, asunto,
 * formato, PDF adjunto); a la derecha el correo que recibe el cliente, que se
 * arma bloque por bloque con los datos reales. Al final, «Enviarme una prueba».
 */

const CSS = `
@keyframes ac-cur{0%{transform:translate(260px,290px);opacity:0}50%{transform:translate(160px,280px);opacity:1}62%,68%{transform:translate(96px,252px)}80%,90%{transform:translate(150px,286px);opacity:1}96%,100%{opacity:0;transform:translate(150px,286px)}}
@keyframes ac-ring{0%,64%{opacity:0;transform:scale(.4)}66%{opacity:1;transform:scale(1)}70%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ac-toast{0%,68%{opacity:0;transform:translateY(8px)}72%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

/** Cada bloque del correo entra un poco después del anterior. */
function blockCss(i: number): string {
    const s = 8 + i * 7;
    return `@keyframes ac-b${i}{0%,${s}%{opacity:0;transform:translateY(8px)}${s + 6}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`;
}

function Row({ y, label, children }: { y: number; label: string; children: ReactNode }): JSX.Element {
    return (
        <At x={10} y={y} w={168} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={7.2} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ minHeight: 20, borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', gap: 4, padding: '0 7px' }}>{children}</span>
        </At>
    );
}

const tag = (t: string): JSX.Element => (
    <span style={{ display: 'inline-flex', alignItems: 'center', height: 14, padding: '0 5px', borderRadius: 4, background: primary(0.13), color: primary(), fontSize: 7.4, fontWeight: 700 }}>{t}</span>
);

export default function AutoCorreo(): JSX.Element {
    return (
        <Stage label="La acción Enviar email con el diseño visual: a la izquierda el destinatario, el asunto con variables y el PDF adjunto; a la derecha el correo que recibe el cliente, armado con sus datos reales, y la prueba que llega a tu correo." tint="blue" cycle={8}>
            <Keyframes css={CSS + [0, 1, 2, 3, 4, 5].map(blockCss).join('\n')} />
            {/* La acción */}
            <Win x={14} y={22} w={188} h={256} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={10} /> Enviar email</span>}>
                <Row y={8} label="Para">
                    {tag('{{email_cliente}}')}
                </Row>
                <Row y={46} label="Asunto">
                    <T size={8}>Tu factura</T>
                    {tag('{{numero}}')}
                </Row>
                <At x={10} y={86} w={168} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={7.2} weight={600} color={C.mutedFg}>
                        Formato del correo
                    </T>
                    <span style={{ display: 'flex', borderRadius: 6, border: `1px solid ${C.border}`, padding: 2, gap: 2 }}>
                        {['Diseño visual', 'Texto', 'HTML'].map((f, i) => (
                            <span key={f} style={{ flex: i === 0 ? 1.6 : 1, height: 17, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? primary() : 'transparent', color: i === 0 ? C.primaryFg : C.mutedFg, fontSize: 7.6, fontWeight: 600 }}>
                                {f}
                            </span>
                        ))}
                    </span>
                </At>
                <At x={10} y={128} w={168} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <T size={7.2} weight={600} color={C.mutedFg}>
                        Adjuntos
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, borderRadius: 6, background: tone('rose', 0.1), border: `1px solid ${tone('rose', 0.3)}`, padding: '0 7px' }}>
                        <FileText size={11} color={tone('rose')} />
                        <T size={7.8} weight={600}>
                            Cuenta de cobro.pdf
                        </T>
                    </span>
                </At>
                <At x={10} y={172} w={168} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 12, height: 12, borderRadius: 3, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                    <T size={7.8}>Agregar la firma al final del correo</T>
                </At>
                <At x={10} y={196} w={168} h={24} style={{ borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    <Send size={10} />
                    <T size={8} weight={600}>
                        Enviarme una prueba
                    </T>
                </At>
            </Win>

            {/* El correo que llega */}
            <Win x={214} y={22} w={252} h={256} title="Bandeja de entrada">
                <At x={0} y={0} w={252} h={30} style={{ padding: '4px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
                    <T size={8.6} weight={700}>
                        Tu factura FAC-1042
                    </T>
                    <T size={7} color={C.mutedFg}>
                        Café Aurora · para pagos@brisas.co
                    </T>
                </At>
                <div style={{ position: 'absolute', left: 14, top: 38, width: 224 }}>
                    <div data-a="" style={{ animationName: 'ac-b0', height: 22, borderRadius: '7px 7px 0 0', background: primary(), display: 'flex', alignItems: 'center', padding: '0 10px' }}>
                        <T size={9} weight={700} color={C.primaryFg}>
                            ☕ Café Aurora
                        </T>
                    </div>
                    <div style={{ border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 7px 7px', padding: '7px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span data-a="" style={{ animationName: 'ac-b1', display: 'block' }}>
                            <T size={10} weight={700}>
                                Hola, Hotel Brisas
                            </T>
                        </span>
                        <span data-a="" style={{ animationName: 'ac-b2', display: 'block', lineHeight: 1 }}>
                            <T size={7.8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4, display: 'block' }}>
                                Tu factura FAC-1042 venció el 26 de octubre de 2026. Te la dejamos adjunta.
                            </T>
                        </span>
                        <span data-a="" style={{ animationName: 'ac-b3', display: 'flex', flexDirection: 'column', gap: 2, borderRadius: 5, background: C.muted, padding: '5px 7px' }}>
                            {[
                                ['Monto', '$ 1.250.000'],
                                ['Vencimiento', '26/10/2026'],
                            ].map(([k, v]) => (
                                <span key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <T size={7.4} color={C.mutedFg}>
                                        {k}
                                    </T>
                                    <T size={7.6} weight={700}>
                                        {v}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <span data-a="" style={{ animationName: 'ac-b4', alignSelf: 'flex-start', height: 20, padding: '0 12px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                            Pagar ahora
                        </span>
                        <span data-a="" style={{ animationName: 'ac-b5', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 99, background: tone('violet', 0.2) }} />
                            <span style={{ display: 'flex', flexDirection: 'column' }}>
                                <T size={7.4} weight={700}>
                                    Laura Gómez
                                </T>
                                <T size={6.8} color={C.mutedFg}>
                                    Cartera · Café Aurora
                                </T>
                            </span>
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 6px', borderRadius: 4, background: tone('rose', 0.1), border: `1px solid ${tone('rose', 0.3)}` }}>
                                <FileText size={9} color={tone('rose')} />
                                <T size={6.8} weight={600}>
                                    PDF
                                </T>
                            </span>
                        </span>
                    </div>
                </div>
            </Win>
            <At x={24} y={280} a="ac-toast" style={{ opacity: 0, zIndex: 7, height: 18, padding: '0 9px', borderRadius: 7, background: C.fg, color: C.card, display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 8px 20px -8px rgba(0,0,0,.45)' }}>
                <T size={8} weight={600} color={C.card}>
                    ✓ Prueba enviada a tu correo
                </T>
            </At>
            <Cursor a="ac-cur" click="ac-ring" rest={[150, 286]} />
        </Stage>
    );
}
