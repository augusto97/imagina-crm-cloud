import { Check, ShoppingBag, ShoppingCart } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.412 — La tienda: la lista de productos se ve como una vitrina, el
 * cliente agrega al carrito, hace el pedido y el pedido cae como un registro
 * de «Pedidos» mientras el stock de la taza baja de 3 a 1.
 */

const CSS = `
@keyframes th-add{0%,14%{transform:scale(1)}18%{transform:scale(.92)}22%,100%{transform:scale(1)}}
@keyframes th-badge{0%,18%{opacity:0;transform:scale(.6)}24%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes th-cart{0%,30%{opacity:0;transform:translateX(16px)}38%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes th-btn{0%,50%{transform:scale(1)}54%{transform:scale(.94)}58%,100%{transform:scale(1)}}
@keyframes th-order{0%,60%{opacity:0;transform:translateY(10px)}68%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes th-stock3{0%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes th-stock1{0%,62%{opacity:0}66%,94%{opacity:1}100%{opacity:0}}
`;

const products = [
    { name: 'Taza de cerámica', price: '$ 25.000', hue: 'amber' as const },
    { name: 'Camiseta', price: '$ 50.000', hue: 'blue' as const },
    { name: 'Vela aromática', price: '$ 12.000', hue: 'rose' as const },
    { name: 'Delantal', price: '$ 18.000', hue: 'mint' as const },
];

export default function TiendaVitrina(): JSX.Element {
    return (
        <Stage label="La lista de productos se ve como una tienda: el cliente agrega una taza al carrito, hace el pedido y el pedido llega como un registro mientras el stock baja de 3 a 1." cycle={8} tint="amber">
            <Keyframes css={CSS} />
            {/* La vitrina */}
            <At x={20} y={22} w={252} h={256} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 12, boxShadow: '0 14px 30px -18px rgba(15,23,42,.45)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: primary(0.14), color: primary(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ShoppingBag size={11} />
                    </span>
                    <T size={11} weight={800}>
                        Café Aurora
                    </T>
                    <span style={{ marginLeft: 'auto', position: 'relative', display: 'inline-flex' }}>
                        <ShoppingCart size={13} color={C.mutedFg} />
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                top: -6,
                                right: -7,
                                minWidth: 12,
                                height: 12,
                                borderRadius: 99,
                                background: primary(),
                                color: C.primaryFg,
                                fontSize: 7,
                                fontWeight: 800,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: 0,
                                animationName: 'th-badge',
                            }}
                        >
                            2
                        </span>
                    </span>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                    {products.map((p, i) => (
                        <span key={p.name} style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', display: 'block' }}>
                            <span style={{ display: 'block', height: 52, background: `linear-gradient(135deg, ${tone(p.hue, 0.35)}, ${tone(p.hue, 0.12)})` }} />
                            <span style={{ display: 'block', padding: '5px 6px 6px' }}>
                                <T size={7.5} weight={600}>
                                    {p.name}
                                </T>
                                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 3 }}>
                                    <T size={8} weight={800}>
                                        {p.price}
                                    </T>
                                    <span
                                        data-a={i === 0 ? '' : undefined}
                                        style={{
                                            fontSize: 6.5,
                                            fontWeight: 700,
                                            padding: '2px 5px',
                                            borderRadius: 5,
                                            background: primary(),
                                            color: C.primaryFg,
                                            ...(i === 0 ? { animationName: 'th-add' } : null),
                                        }}
                                    >
                                        Agregar
                                    </span>
                                </span>
                            </span>
                        </span>
                    ))}
                </span>
            </At>

            {/* El carrito */}
            <At x={288} y={22} w={172} h={124} a="th-cart" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, boxShadow: '0 14px 30px -18px rgba(15,23,42,.45)' }}>
                <T size={9} weight={800}>
                    Tu carrito
                </T>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 4, marginTop: 6 }}>
                    <T size={7.5}>2 × Taza de cerámica</T>
                    <T size={7.5} weight={700}>
                        $ 50.000
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        Envío a domicilio
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        $ 0
                    </T>
                    <T size={8.5} weight={800}>
                        Total
                    </T>
                    <T size={8.5} weight={800}>
                        $ 50.000
                    </T>
                </span>
                <span
                    data-a=""
                    style={{
                        display: 'block',
                        marginTop: 8,
                        textAlign: 'center',
                        background: primary(),
                        color: C.primaryFg,
                        borderRadius: 7,
                        padding: '5px 0',
                        fontSize: 8,
                        fontWeight: 800,
                        animationName: 'th-btn',
                    }}
                >
                    Hacer el pedido
                </span>
            </At>

            {/* El pedido en la lista */}
            <At x={288} y={160} w={172} h={118} a="th-order" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, boxShadow: '0 14px 30px -18px rgba(15,23,42,.45)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Check size={10} color={C.success} />
                    <T size={8} weight={700} color={C.mutedFg}>
                        Pedidos · nuevo registro
                    </T>
                </span>
                <span style={{ display: 'block', marginTop: 5 }}>
                    <T size={10} weight={800}>
                        PED-0001 · Ana Gómez
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    <Chip label="Nuevo" t="blue" />
                    <Chip label="Pendiente" t="amber" />
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
                    <T size={7.5} color={C.mutedFg}>
                        Stock de la taza
                    </T>
                    <span style={{ display: 'grid' }}>
                        <span data-a="" style={{ gridArea: '1/1', animationName: 'th-stock3' }}>
                            <T size={8.5} weight={800}>
                                3
                            </T>
                        </span>
                        <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'th-stock1' }}>
                            <T size={8.5} weight={800} color={C.warning}>
                                1
                            </T>
                        </span>
                    </span>
                </span>
            </At>
        </Stage>
    );
}
