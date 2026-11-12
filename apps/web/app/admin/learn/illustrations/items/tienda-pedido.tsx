import { Check, CreditCard, RotateCcw } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, primary } from '../kit';

/**
 * v0.1.412 — El pedido en la ficha: «Marcar como pagado» lo pasa de Pendiente
 * a Pagado, y cancelarlo (estado «Cancelado») devuelve el stock al producto.
 */

const CSS = `
@keyframes tp-click{0%,22%{transform:scale(1)}26%{transform:scale(.93)}30%,100%{transform:scale(1)}}
@keyframes tp-pend{0%,28%{opacity:1}32%,100%{opacity:0}}
@keyframes tp-paid{0%,28%{opacity:0}32%,94%{opacity:1}100%{opacity:0}}
@keyframes tp-new{0%,56%{opacity:1}60%,100%{opacity:0}}
@keyframes tp-cancel{0%,56%{opacity:0}60%,94%{opacity:1}100%{opacity:0}}
@keyframes tp-back{0%,60%{opacity:0;transform:translateX(-12px)}68%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes tp-s1{0%,64%{opacity:1}68%,100%{opacity:0}}
@keyframes tp-s3{0%,64%{opacity:0}68%,94%{opacity:1}100%{opacity:0}}
`;

export default function TiendaPedido(): JSX.Element {
    return (
        <Stage label="En la ficha del pedido, Marcar como pagado lo pasa de Pendiente a Pagado; al cancelarlo, el stock de la taza vuelve de 1 a 3." cycle={8} tint="mint">
            <Keyframes css={CSS} />
            <At x={24} y={26} w={250} h={248} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, boxShadow: '0 14px 30px -18px rgba(15,23,42,.45)' }}>
                <T size={8} weight={700} color={C.mutedFg}>
                    Pedido de la tienda
                </T>
                <span style={{ display: 'block', marginTop: 2 }}>
                    <T size={13} weight={800}>
                        PED-0001 · Ana Gómez
                    </T>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 7, marginTop: 12 }}>
                    <T size={8} color={C.mutedFg}>
                        Total
                    </T>
                    <T size={9} weight={800}>
                        $ 50.000
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Pago
                    </T>
                    <T size={8.5} weight={600}>
                        Transferencia
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Estado del pago
                    </T>
                    <span style={{ display: 'grid', justifyItems: 'end' }}>
                        <span data-a="" style={{ gridArea: '1/1', animationName: 'tp-pend' }}>
                            <Chip label="Pendiente" t="amber" />
                        </span>
                        <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'tp-paid' }}>
                            <Chip label="Pagado" t="mint" />
                        </span>
                    </span>
                    <T size={8} color={C.mutedFg}>
                        Estado del pedido
                    </T>
                    <span style={{ display: 'grid', justifyItems: 'end' }}>
                        <span data-a="" style={{ gridArea: '1/1', animationName: 'tp-new' }}>
                            <Chip label="Nuevo" t="blue" />
                        </span>
                        <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'tp-cancel' }}>
                            <Chip label="Cancelado" t="rose" />
                        </span>
                    </span>
                </span>
                <span
                    data-a=""
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 5,
                        marginTop: 18,
                        background: primary(),
                        color: C.primaryFg,
                        borderRadius: 8,
                        padding: '7px 0',
                        fontSize: 9,
                        fontWeight: 800,
                        animationName: 'tp-click',
                    }}
                >
                    <CreditCard size={11} /> Marcar como pagado
                </span>
                <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10, opacity: 0, animationName: 'tp-paid' }}>
                    <Check size={10} color={C.success} />
                    <T size={7.5} color={C.mutedFg}>
                        Pagado hoy · lo marcó Laura
                    </T>
                </span>
            </At>

            <At x={296} y={92} w={160} h={116} a="tp-back" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -18px rgba(15,23,42,.45)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <RotateCcw size={10} color={C.success} />
                    <T size={8} weight={700} color={C.mutedFg}>
                        El stock vuelve
                    </T>
                </span>
                <span style={{ display: 'block', marginTop: 8 }}>
                    <T size={10} weight={800}>
                        Taza de cerámica
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                    <T size={8} color={C.mutedFg}>
                        Stock
                    </T>
                    <span style={{ display: 'grid' }}>
                        <span data-a="" style={{ gridArea: '1/1', animationName: 'tp-s1' }}>
                            <T size={14} weight={800} color={C.warning}>
                                1
                            </T>
                        </span>
                        <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'tp-s3' }}>
                            <T size={14} weight={800} color={C.success}>
                                3
                            </T>
                        </span>
                    </span>
                </span>
            </At>
        </Stage>
    );
}
