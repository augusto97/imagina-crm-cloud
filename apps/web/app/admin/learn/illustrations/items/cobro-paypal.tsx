import { Check, Link2, Wallet } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * v0.1.372 — Cobrar con PayPal: el link sale del pedido (en dólares), el
 * cliente aprueba en PayPal, la app COBRA la orden al volver (aprobar no es
 * pagar) y el pedido pasa solo de «Pendiente» a «Pagado».
 */

const PAYPAL = '#003087';
const PAYPAL_LIGHT = '#0070BA';

const CSS = `
@keyframes pp-link{0%,8%{opacity:0;transform:translateY(6px)}14%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pp-card{0%,22%{opacity:0;transform:translateX(18px)}30%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes pp-btn{0%,40%{transform:scale(1)}44%{transform:scale(.94)}48%,100%{transform:scale(1)}}
@keyframes pp-approved{0%,46%{opacity:0}50%,92%{opacity:1}100%{opacity:0}}
@keyframes pp-capture{0%,56%{opacity:0;transform:translateY(6px)}62%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pp-pending{0%,66%{opacity:1}70%,100%{opacity:0}}
@keyframes pp-paid{0%,66%{opacity:0}70%,94%{opacity:1}100%{opacity:0}}
`;

export default function CobroPaypal(): JSX.Element {
    return (
        <Stage
            label="Desde un pedido se crea un link de PayPal por 150,00 USD; el cliente aprueba el pago en PayPal, la app lo cobra al volver y el pedido pasa solo de Pendiente a Pagado."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                {/* El pedido */}
                <At
                    x={24}
                    y={34}
                    w={200}
                    h={232}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <T size={8} weight={700} color={C.mutedFg}>
                        Pedido
                    </T>
                    <T size={14} weight={800}>
                        #1042 · Studio Lumen
                    </T>
                    <span style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6, marginTop: 12 }}>
                        <T size={8} color={C.mutedFg}>
                            Total
                        </T>
                        <T size={9} weight={700}>
                            150,00 USD
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Estado del pago
                        </T>
                        <span style={{ display: 'grid', justifyItems: 'end' }}>
                            <span data-a="" style={{ gridArea: '1/1', animationName: 'pp-pending' }}>
                                <span style={{ background: 'rgba(245,158,11,.16)', color: '#B45309', borderRadius: 999, padding: '2px 8px', fontSize: 8, fontWeight: 700 }}>Pendiente</span>
                            </span>
                            <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'pp-paid' }}>
                                <span style={{ background: 'rgba(16,185,129,.16)', color: '#047857', borderRadius: 999, padding: '2px 8px', fontSize: 8, fontWeight: 700 }}>Pagado</span>
                            </span>
                        </span>
                    </span>
                    <span
                        data-a=""
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            marginTop: 16,
                            padding: '7px 8px',
                            borderRadius: 8,
                            border: `1px dashed ${C.border}`,
                            animationName: 'pp-link',
                        }}
                    >
                        <Link2 size={11} color={primary()} />
                        <T size={7} color={primary()} weight={600}>
                            …/public/pay/ib_7Kq2
                        </T>
                    </span>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, opacity: 0, animationName: 'pp-capture' }}>
                        <Wallet size={11} color={C.mutedFg} />
                        <T size={7} color={C.mutedFg}>
                            Cobrado con Cuenta PayPal
                        </T>
                    </span>
                </At>

                {/* PayPal */}
                <At
                    x={252}
                    y={56}
                    w={204}
                    h={188}
                    style={{ background: '#fff', border: '1px solid #dbe3ef', borderRadius: 14, padding: 16, boxShadow: '0 18px 36px -18px rgba(0,48,135,.55)' }}
                >
                    <span data-a="" style={{ display: 'block', opacity: 0, animationName: 'pp-card' }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                            <span style={{ fontWeight: 900, fontSize: 16, color: PAYPAL, fontStyle: 'italic' }}>Pay</span>
                            <span style={{ fontWeight: 900, fontSize: 16, color: PAYPAL_LIGHT, fontStyle: 'italic' }}>Pal</span>
                        </span>
                        <span style={{ display: 'block', marginTop: 10, color: '#475569', fontSize: 8 }}>Studio Lumen te cobra</span>
                        <span style={{ display: 'block', marginTop: 2, color: '#0f172a', fontSize: 18, fontWeight: 800 }}>150,00 USD</span>
                        <span
                            data-a=""
                            style={{
                                display: 'block',
                                marginTop: 14,
                                textAlign: 'center',
                                background: '#FFC439',
                                color: '#111827',
                                borderRadius: 999,
                                padding: '8px 0',
                                fontWeight: 800,
                                fontSize: 10,
                                animationName: 'pp-btn',
                            }}
                        >
                            Pagar ahora
                        </span>
                        <span
                            data-a=""
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 12, opacity: 0, color: '#047857', fontSize: 8, fontWeight: 700, animationName: 'pp-approved' }}
                        >
                            <Check size={10} color="#10B981" /> Aprobado · la app confirma el cobro
                        </span>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
