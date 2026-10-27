import { Check, KeyRound, Lock } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Conectar Mercado Pago o Wompi: se elige la app en Integraciones, se pega la
 * credencial, la app la comprueba y queda «Conectada» (con el aviso de modo
 * prueba si la credencial es de prueba).
 */

const MP = '#00B1EA';
const WOMPI = '#2C2A29';

const CSS = `
@keyframes cc-tile{0%,8%{box-shadow:0 0 0 0 transparent}12%,22%{box-shadow:0 0 0 3px ${primary(0.4)}}28%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes cc-dlg{0%,18%{opacity:0;transform:translateY(10px)}24%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cc-type{0%,30%{width:0}48%,100%{width:118px}}
@keyframes cc-check{0%,52%{opacity:0}56%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cc-done{0%,62%{opacity:0;transform:translateY(8px)}68%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
`;

function Tile({ x, y, name, color, sub, a }: { x: number; y: number; name: string; color: string; sub: string; a?: string }): JSX.Element {
    return (
        <At x={x} y={y} w={140} h={92} a={a} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>{name[0]}</span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={9} weight={700}>
                        {name}
                    </T>
                    <T size={7} color={C.mutedFg}>
                        Cobros y pagos
                    </T>
                </span>
            </span>
            <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                {sub}
            </T>
            <span style={{ marginTop: 'auto', height: 18, borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <T size={7.5} weight={700} color={C.primaryFg}>
                    Conectar
                </T>
            </span>
        </At>
    );
}

export default function CobroConectar(): JSX.Element {
    return (
        <Stage label="En Integraciones se toca «Conectar» en Mercado Pago, se pega el Access Token, la app lo comprueba con Mercado Pago y la conexión queda lista, en modo prueba si la credencial es de prueba." tint="blue">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={20} y={10}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        INTEGRACIONES · COBROS Y PAGOS
                    </T>
                </At>
                <Tile x={20} y={30} name="Mercado Pago" color={MP} sub="Links de pago con PSE, Nequi, tarjeta y efectivo." a="cc-tile" />
                <Tile x={20} y={134} name="Wompi" color={WOMPI} sub="Links de Bancolombia: PSE, Nequi y tarjeta." />

                {/* Diálogo de conexión */}
                <At x={176} y={22} w={290} h={176} a="cc-dlg" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={10} weight={700}>
                        Conectar Mercado Pago
                    </T>
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        En Mercado Pago → Tus integraciones → Credenciales, copia el Access Token y pégalo aquí.
                    </T>
                    <T size={7.5} weight={600} color={C.mutedFg}>
                        Access Token
                    </T>
                    <span style={{ height: 24, borderRadius: 6, border: `1px solid ${primary()}`, display: 'flex', alignItems: 'center', gap: 5, padding: '0 7px' }}>
                        <KeyRound size={10} color={C.mutedFg} />
                        <span data-a="" style={{ overflow: 'hidden', whiteSpace: 'nowrap', display: 'inline-block', width: 118, animationName: 'cc-type' }}>
                            <T size={8} style={{ fontFamily: 'ui-monospace, monospace' }}>
                                TEST-5583·········9921
                            </T>
                        </span>
                        <span data-a="" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, animationName: 'cc-check' }}>
                            <Check size={10} color={C.success} />
                            <T size={7} weight={600} color={C.success}>
                                Comprobada
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={9} color={C.mutedFg} />
                        <T size={7} color={C.mutedFg}>
                            Se guarda cifrada. El dinero va directo a tu cuenta.
                        </T>
                    </span>
                    <span style={{ marginTop: 'auto', alignSelf: 'flex-end', height: 22, padding: '0 10px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center' }}>
                        <T size={8} weight={700} color={C.primaryFg}>
                            Conectar
                        </T>
                    </span>
                </At>

                {/* Conectada */}
                <At x={176} y={212} w={290} a="cc-done" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px', boxShadow: '0 12px 26px -16px rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: MP, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>M</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <T size={8.5} weight={700}>
                                Mercado Pago
                            </T>
                            <span style={{ height: 14, padding: '0 5px', borderRadius: 4, background: tone('mint', 0.16), display: 'inline-flex', alignItems: 'center' }}>
                                <T size={6.5} weight={700} color={tone('mint')}>
                                    Conectada
                                </T>
                            </span>
                            <span style={{ height: 14, padding: '0 5px', borderRadius: 4, background: tone('amber', 0.18), display: 'inline-flex', alignItems: 'center' }}>
                                <T size={6.5} weight={700} color={tone('amber')}>
                                    Modo prueba
                                </T>
                            </span>
                        </span>
                        <T size={7} color={C.mutedFg}>
                            Café Aurora
                        </T>
                    </span>
                    <span style={{ marginLeft: 'auto', height: 20, padding: '0 8px', borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                        <T size={7.5} weight={600}>
                            Cobros
                        </T>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
