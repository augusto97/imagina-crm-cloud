import { Building2, Check, CreditCard, Loader2, Receipt, Smartphone, Wallet } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Pagar desde el portal: «Pagar mi saldo» abre la pasarela, el cliente paga y el portal confirma el pago con su comprobante. */

const CSS = `
@keyframes pp-cursor{0%{transform:translate(170px,290px);opacity:0}5%{opacity:1}14%,19%{transform:translate(118px,129px)}30%{transform:translate(300px,140px)}36%,41%{transform:translate(335px,115px)}46%,50%{transform:translate(335px,204px);opacity:1}58%,100%{transform:translate(335px,204px);opacity:0}}
@keyframes pp-ring{0%,15%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}20%{opacity:0;transform:scale(1.6)}37%{opacity:0;transform:scale(.4)}39%{opacity:1;transform:scale(1)}42%{opacity:0;transform:scale(1.6)}47%{opacity:0;transform:scale(.4)}49%{opacity:1;transform:scale(1)}52%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pp-gw{0%,20%{opacity:0;transform:translateX(16px) scale(.97)}26%,66%{opacity:1;transform:translateX(0) scale(1)}72%,100%{opacity:0;transform:translateX(16px) scale(.97)}}
@keyframes pp-opt{0%,38%{box-shadow:0 0 0 1px ${C.border};background:${C.card}}40%,100%{box-shadow:0 0 0 1.5px ${tone('blue')};background:${tone('blue', 0.08)}}}
@keyframes pp-gwok{0%,51%{opacity:0;transform:scale(.6)}55%,100%{opacity:1;transform:scale(1)}}
@keyframes pp-gwform{0%,51%{opacity:1}54%,100%{opacity:0}}
@keyframes pp-wait{0%,20%{opacity:0}24%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes pp-done{0%,64%{opacity:0;transform:translateY(5px)}69%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes pp-bal1{0%,64%{opacity:1}68%,96%{opacity:0}100%{opacity:1}}
@keyframes pp-bal0{0%,64%{opacity:0}68%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pp-st1{0%,64%{opacity:1}68%,96%{opacity:0}100%{opacity:1}}
@keyframes pp-st2{0%,64%{opacity:0;transform:scale(.7)}69%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

export default function PortalPay(): JSX.Element {
    return (
        <Stage label="En su portal, el cliente toca Pagar mi saldo, paga en la pasarela con PSE y el portal le confirma el pago: el saldo queda en cero y el link pasa a Pagado con su comprobante." tint="mint">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Portal */}
                <At
                    x={40}
                    y={18}
                    w={156}
                    h={266}
                    style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)' }}
                >
                    <div style={{ position: 'absolute', left: 56, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={10} y={20} w={126}>
                        <T size={10} weight={800}>
                            Tus pagos
                        </T>
                    </At>
                    {/* Tarjeta de pago */}
                    <At x={8} y={40} w={130} style={{ borderRadius: 10, border: `1px solid ${primary(0.35)}`, background: primary(0.06), padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 20, height: 20, borderRadius: 99, background: primary(0.16), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Wallet size={10} />
                            </span>
                            <T size={7.5} weight={600}>
                                Saldo pendiente
                            </T>
                        </span>
                        <span style={{ position: 'relative', height: 16 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'pp-bal1' }}>
                                <T size={13} weight={800}>
                                    $ 450.000
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'pp-bal0' }}>
                                <T size={13} weight={800} color={tone('mint')}>
                                    $ 0
                                </T>
                            </span>
                        </span>
                        <span data-a="" style={{ height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, animationName: 'pp-bal1' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Pagar mi saldo
                            </T>
                        </span>
                    </At>
                    {/* Estado */}
                    <At x={8} y={136} w={130} h={26}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 5, opacity: 0, animationName: 'pp-wait' }}>
                            <Loader2 size={10} color={C.mutedFg} />
                            <T size={7} color={C.mutedFg}>
                                Esperando la confirmación del pago…
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 6px', borderRadius: 6, background: tone('mint', 0.14), animationName: 'pp-done' }}>
                            <T size={7} weight={700} color={tone('mint')} style={{ whiteSpace: 'normal' }}>
                                ¡Listo! Recibimos tu pago de $ 450.000.
                            </T>
                        </span>
                    </At>
                    {/* Links */}
                    <At x={8} y={170} w={130} style={{ borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 7px', borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <T size={7.5} weight={700}>
                                    Cuota octubre
                                </T>
                                <T size={6.5} color={C.mutedFg}>
                                    $ 450.000
                                </T>
                            </span>
                            <span style={{ position: 'relative', width: 46, height: 30, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                                <span data-a="" style={{ position: 'absolute', right: 0, top: 7, opacity: 0, animationName: 'pp-st1' }}>
                                    <Chip label="Pendiente" t="amber" style={{ height: 14, fontSize: 7, padding: '0 5px' }} />
                                </span>
                                <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, animationName: 'pp-st2' }}>
                                    <Chip label="Pagado" t="mint" style={{ height: 14, fontSize: 7, padding: '0 5px' }} />
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                        <Receipt size={7} color={C.mutedFg} />
                                        <T size={6} color={C.mutedFg}>
                                            Comprobante
                                        </T>
                                    </span>
                                </span>
                            </span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 7px' }}>
                            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <T size={7.5} weight={700}>
                                    Cuota septiembre
                                </T>
                                <T size={6.5} color={C.mutedFg}>
                                    $ 450.000
                                </T>
                            </span>
                            <Chip label="Pagado" t="mint" style={{ height: 14, fontSize: 7, padding: '0 5px' }} />
                        </span>
                    </At>
                </At>

                {/* La pasarela */}
                <At
                    x={226}
                    y={46}
                    w={218}
                    h={204}
                    a="pp-gw"
                    style={{ opacity: 0, background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -16px rgba(15,23,42,.55)', overflow: 'hidden' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: tone('blue', 0.1), borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 18, height: 18, borderRadius: 99, background: tone('blue'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CreditCard size={10} />
                        </span>
                        <T size={8.5} weight={800}>
                            Pasarela de pago
                        </T>
                        <T size={8.5} weight={800} style={{ marginLeft: 'auto' }}>
                            $ 450.000
                        </T>
                    </div>
                    <At x={12} y={42} w={194} a="pp-gwform" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={7.5} color={C.mutedFg}>
                            Elige cómo pagar
                        </T>
                        {(
                            [
                                ['PSE · débito bancario', <Building2 key="b" size={10} />],
                                ['Tarjeta', <CreditCard key="c" size={10} />],
                                ['Nequi', <Smartphone key="n" size={10} />],
                            ] as const
                        ).map(([l, icon], i) => (
                            <span
                                key={l}
                                data-a={i === 0 ? '' : undefined}
                                style={{ height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', boxShadow: `0 0 0 1px ${C.border}`, animationName: i === 0 ? 'pp-opt' : undefined }}
                            >
                                <span style={{ color: C.mutedFg, display: 'flex' }}>{icon}</span>
                                <T size={8}>{l}</T>
                            </span>
                        ))}
                        <span style={{ marginTop: 4, height: 24, borderRadius: 6, background: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8.5} weight={700} color="#fff">
                                Pagar $ 450.000
                            </T>
                        </span>
                    </At>
                    <At x={0} y={58} w={218} a="pp-gwok" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                        <span style={{ width: 40, height: 40, borderRadius: 99, background: tone('mint'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={22} strokeWidth={3} />
                        </span>
                        <T size={10.5} weight={800}>
                            Pago aprobado
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Puedes volver al portal.
                        </T>
                    </At>
                </At>
                <Cursor a="pp-cursor" click="pp-ring" rest={[335, 204]} />
            </At>
        </Stage>
    );
}
