import { Coffee, CornerDownRight, ShoppingCart } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Chip, Flow, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * La tienda WooCommerce sincronizada: alguien compra en la tienda, el pedido
 * llega solo a la lista Pedidos, el stock de la variación vendida baja en
 * Productos y el tablero de ventas sube.
 */

const CSS = `
@keyframes th-buy{0%,8%{transform:scale(1)}11%{transform:scale(.93)}14%,100%{transform:scale(1)}}
@keyframes th-toast{0%,12%{opacity:0;transform:translateY(6px)}17%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes th-flow{0%,18%{opacity:0}24%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes th-row{0%,28%{opacity:0;transform:translateY(-6px);background:transparent}34%{opacity:1;transform:translateY(0);background:${tone('mint', 0.22)}}52%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes th-push{0%,28%{transform:translateY(-22px)}34%,92%{transform:translateY(0)}97%,100%{transform:translateY(-22px)}}
@keyframes th-old{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes th-new{0%,44%{opacity:0}48%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes th-stock{0%,42%{background:transparent}46%,58%{background:${tone('amber', 0.22)}}66%,100%{background:transparent}}
@keyframes th-kold{0%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes th-knew{0%,58%{opacity:0}62%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes th-cur{0%{transform:translate(70px,250px);opacity:0}4%{opacity:1}9%,12%{transform:translate(96px,172px)}22%,100%{transform:translate(110px,240px);opacity:0}}
`;

function Swap({ a, b, from, to, w }: { a: string; b: string; from: JSX.Element | string; to: JSX.Element | string; w: number }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'block', width: w, height: 14 }}>
            <span data-a="" style={{ animationName: a, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: 0 }}>
                {from}
            </span>
            <span data-a="" style={{ animationName: b, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                {to}
            </span>
        </span>
    );
}

export default function TiendaHero(): JSX.Element {
    return (
        <Stage label="Alguien compra en la tienda WooCommerce: el pedido llega solo a la lista Pedidos de la app, el stock de la variación vendida baja en Productos y el tablero de ventas sube." tint="violet">
            <Keyframes css={CSS} />

            {/* La tienda */}
            <Win x={14} y={26} w={168} h={212} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IntegrationLogo integrationKey="woocommerce" size={14} />cafeaurora.co</span>}>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ height: 70, borderRadius: 8, background: tone('amber', 0.16), display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone('amber') }}>
                        <Coffee size={30} />
                    </span>
                    <T size={10} weight={700}>
                        Taza Aurora
                    </T>
                    <span style={{ display: 'flex', gap: 4 }}>
                        {['Roja', 'Azul', 'Negra'].map((c, i) => (
                            <span key={c} style={{ height: 16, padding: '0 6px', borderRadius: 5, border: `1px solid ${i === 0 ? primary() : C.border}`, fontSize: 8, display: 'inline-flex', alignItems: 'center', fontWeight: i === 0 ? 700 : 500 }}>
                                {c}
                            </span>
                        ))}
                    </span>
                    <T size={10} weight={700} color={primary()}>
                        $35.000
                    </T>
                    <span data-a="" style={{ animationName: 'th-buy', height: 24, borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <ShoppingCart size={11} /> Comprar
                    </span>
                </div>
            </Win>
            <At x={22} y={246} w={152} a="th-toast" style={{ background: C.card, border: `1px solid ${tone('mint', 0.5)}`, borderRadius: 9, padding: '6px 8px', boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}>
                <T size={8.5} weight={700} color={C.success} style={{ display: 'block' }}>
                    Pedido nuevo #1043
                </T>
                <T size={8} color={C.mutedFg}>
                    2 tazas · $70.000
                </T>
            </At>

            <Flow x1={184} y1={110} x2={238} y2={74} a="th-flow" />
            <Flow x1={184} y1={140} x2={238} y2={176} a="th-flow" />

            {/* Pedidos */}
            <Win x={240} y={12} w={226} h={115} title="Pedidos">
                <div style={{ position: 'relative' }}>
                    <div data-a="" style={{ animationName: 'th-row', display: 'grid', gridTemplateColumns: '44px 1fr 66px', gap: 4, height: 22, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700}>#1043</T>
                        <T size={8.5}>Laura Gómez</T>
                        <Chip label="Procesando" t="blue" />
                    </div>
                    <div data-a="" style={{ animationName: 'th-push' }}>
                        {[
                            ['#1042', 'Hotel Brisas'],
                            ['#1041', 'Andrés Rojas'],
                            ['#1040', 'Óptica Visión'],
                        ].map(([n, c]) => (
                            <div key={n} style={{ display: 'grid', gridTemplateColumns: '44px 1fr 66px', gap: 4, height: 22, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                                <T size={8.5} weight={700}>{n}</T>
                                <T size={8.5}>{c}</T>
                                <Chip label="Completado" t="mint" />
                            </div>
                        ))}
                    </div>
                </div>
            </Win>

            {/* Productos con sus variaciones */}
            <Win x={240} y={136} w={226} h={93} title="Productos">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 54px', gap: 4, height: 22, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8.5} weight={700}>Taza Aurora</T>
                    <T size={8} color={C.mutedFg}>Stock</T>
                </div>
                <div data-a="" style={{ animationName: 'th-stock', display: 'grid', gridTemplateColumns: '1fr 54px', gap: 4, height: 21, alignItems: 'center', padding: '0 9px 0 14px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CornerDownRight size={9} color={C.mutedFg} />
                        <T size={8.5}>Roja</T>
                    </span>
                    <Swap a="th-old" b="th-new" from={<T size={8.5} weight={700}>12</T>} to={<T size={8.5} weight={700} color={tone('amber')}>10</T>} w={40} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 54px', gap: 4, height: 21, alignItems: 'center', padding: '0 9px 0 14px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CornerDownRight size={9} color={C.mutedFg} />
                        <T size={8.5}>Azul</T>
                    </span>
                    <T size={8.5} weight={700}>18</T>
                </div>
            </Win>

            {/* El tablero */}
            <At x={240} y={238} w={226} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {[
                    { l: 'Ventas del mes', from: '$4,20 M', to: '$4,27 M', anim: true },
                    { l: 'Pedidos', from: '127', to: '128', anim: true },
                    { l: 'Clientes', from: '64', to: '64', anim: false },
                ].map((k) => (
                    <span key={k.l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={7.5} color={C.mutedFg}>{k.l}</T>
                        {k.anim ? (
                            <Swap a="th-kold" b="th-knew" from={<T size={11} weight={700}>{k.from}</T>} to={<T size={11} weight={700} color={primary()}>{k.to}</T>} w={60} />
                        ) : (
                            <T size={11} weight={700}>{k.to}</T>
                        )}
                    </span>
                ))}
            </At>

            <At x={0} y={0} a="th-cur" style={{ zIndex: 50, pointerEvents: 'none', opacity: 0 }}>
                <svg width="16" height="18" viewBox="0 0 16 18" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' }}>
                    <path d="M1 1l5.4 15.2 2.3-6.4 6.4-2.3L1 1z" fill="#111827" stroke="#fff" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
            </At>
        </Stage>
    );
}
