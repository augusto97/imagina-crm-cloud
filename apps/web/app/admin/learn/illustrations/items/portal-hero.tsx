import { Check, Coffee, Package, Truck } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Portada del portal: el cliente ve, con la marca de la empresa, su saldo, sus facturas y el avance de su pedido. */

const CSS = `
@keyframes ph-k1{0%,4%{opacity:0;transform:translateY(8px)}10%,94%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes ph-k2{0%,8%{opacity:0;transform:translateY(8px)}14%,94%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes ph-k3{0%,12%{opacity:0;transform:translateY(8px)}18%,94%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes ph-r{0%,16%{opacity:0;transform:translateX(10px)}24%,94%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes ph-pend{0%,46%{opacity:1}50%,100%{opacity:0}}
@keyframes ph-paid{0%,46%{opacity:0;transform:scale(.7)}51%,94%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes ph-due{0%,46%{opacity:1}50%,100%{opacity:0}}
@keyframes ph-zero{0%,46%{opacity:0}50%,94%{opacity:1}100%{opacity:0}}
@keyframes ph-rowglow{0%,46%{background:transparent}50%,64%{background:${tone('mint', 0.14)}}80%,100%{background:transparent}}
@keyframes ph-prog{0%,20%{width:34%}32%,58%{width:34%}66%,94%{width:67%}100%{width:34%}}
@keyframes ph-st3{0%,60%{background:${C.muted};color:${C.mutedFg}}66%,94%{background:${primary()};color:${C.primaryFg}}100%{background:${C.muted};color:${C.mutedFg}}}
@keyframes ph-lbl3{0%,60%{color:${C.mutedFg};font-weight:500}66%,94%{color:${C.fg};font-weight:700}100%{color:${C.mutedFg}}}
`;

function Kpi({ label, value, zero, t, a }: { label: string; value: string; zero?: string; t: 'rose' | 'mint' | 'blue'; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ flex: 1, borderRadius: 8, border: `1px solid ${C.border}`, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3, animationName: a }}>
            <T size={6.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {label}
            </T>
            <span style={{ position: 'relative', height: 14 }}>
                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: zero ? 0 : 1, animationName: zero ? 'ph-due' : undefined }}>
                    <T size={11} weight={800} color={tone(t)}>
                        {value}
                    </T>
                </span>
                {zero && (
                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'ph-zero' }}>
                        <T size={11} weight={800} color={tone('mint')}>
                            {zero}
                        </T>
                    </span>
                )}
            </span>
        </span>
    );
}

export default function PortalHero(): JSX.Element {
    return (
        <Stage label="El portal de un cliente con la marca de la empresa: su saldo pendiente, sus facturas y, en el celular, el avance de su pedido. Al pagar, la factura pasa a Pagada y el saldo queda en cero." tint="cyan">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win x={176} y={24} w={288} h={250} title="clientes.cafeaurora.com">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 18, height: 18, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={11} />
                        </span>
                        <T size={8.5} weight={800}>
                            Café Aurora
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            · Portal de clientes
                        </T>
                        <span style={{ marginLeft: 'auto', width: 18, height: 18, borderRadius: 99, background: primary(0.18), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 7.5, fontWeight: 800 }}>
                            DL
                        </span>
                    </div>
                    <At x={12} y={40} w={262}>
                        <T size={12} weight={800}>
                            Hola, Distribuidora La 14
                        </T>
                        <span style={{ display: 'flex', gap: 7, marginTop: 9 }}>
                            <Kpi label="Saldo pendiente" value="$ 450.000" zero="$ 0" t="rose" a="ph-k1" />
                            <Kpi label="Pagado" value="$ 1.850.000" t="mint" a="ph-k2" />
                            <Kpi label="Pedidos" value="3" t="blue" a="ph-k3" />
                        </span>
                    </At>
                    <At x={12} y={112} w={262}>
                        <T size={8.5} weight={800}>
                            Tus facturas
                        </T>
                        <div style={{ marginTop: 6, borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                            {(
                                [
                                    ['FAC-0042', '15/10/2026', '$ 450.000', true],
                                    ['FAC-0039', '15/09/2026', '$ 620.000', false],
                                    ['FAC-0035', '15/08/2026', '$ 620.000', false],
                                ] as const
                            ).map(([n, d, v, pending], i) => (
                                <div
                                    key={n}
                                    data-a=""
                                    style={{
                                        position: 'relative',
                                        height: 26,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '0 9px',
                                        borderTop: i ? `1px solid ${C.border}` : undefined,
                                        animationName: pending ? 'ph-r, ph-rowglow' : 'ph-r',
                                    }}
                                >
                                    <T size={8} weight={700} style={{ width: 50 }}>
                                        {n}
                                    </T>
                                    <T size={7.5} color={C.mutedFg} style={{ width: 52 }}>
                                        {d}
                                    </T>
                                    <T size={8} weight={600} style={{ width: 56 }}>
                                        {v}
                                    </T>
                                    <span style={{ position: 'relative', width: 58, height: 16 }}>
                                        {pending ? (
                                            <>
                                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'ph-pend' }}>
                                                    <Chip label="Pendiente" t="amber" />
                                                </span>
                                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'ph-paid' }}>
                                                    <Chip label="Pagada" t="mint" />
                                                </span>
                                            </>
                                        ) : (
                                            <Chip label="Pagada" t="mint" />
                                        )}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </At>
                </Win>

                {/* El celular con el pedido */}
                <At
                    x={22}
                    y={44}
                    w={140}
                    h={236}
                    style={{ borderRadius: 22, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 20px 40px -18px rgba(15,23,42,.6)', zIndex: 4 }}
                >
                    <div style={{ position: 'absolute', left: 48, top: 5, width: 34, height: 5, borderRadius: 99, background: C.fg, opacity: 0.85 }} />
                    <At x={10} y={18} w={110} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 4, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={9} />
                        </span>
                        <T size={7.5} weight={800}>
                            Café Aurora
                        </T>
                    </At>
                    <At x={10} y={40} w={110}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Package size={11} color={primary()} />
                            <T size={9.5} weight={800}>
                                Tu pedido #318
                            </T>
                        </span>
                        <T size={7} color={C.mutedFg} style={{ display: 'block', marginTop: 3 }}>
                            40 kg de café de origen
                        </T>
                        <span style={{ display: 'block', position: 'relative', marginTop: 12, height: 4, borderRadius: 99, background: C.muted }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, height: 4, width: '67%', borderRadius: 99, background: primary(), animationName: 'ph-prog' }} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
                            {(
                                [
                                    ['Recibido', true],
                                    ['En preparación', true],
                                    ['En camino', false],
                                    ['Entregado', false],
                                ] as const
                            ).map(([l, done], i) => (
                                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span
                                        data-a={i === 2 ? '' : undefined}
                                        style={{
                                            width: 15,
                                            height: 15,
                                            borderRadius: 99,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: done || i === 2 ? primary() : C.muted,
                                            color: done || i === 2 ? C.primaryFg : C.mutedFg,
                                            animationName: i === 2 ? 'ph-st3' : undefined,
                                        }}
                                    >
                                        {i === 2 ? <Truck size={8} /> : done ? <Check size={9} strokeWidth={3} /> : <span style={{ width: 4, height: 4, borderRadius: 99, background: 'currentColor' }} />}
                                    </span>
                                    <span data-a={i === 2 ? '' : undefined} style={{ fontSize: 8, fontWeight: done || i === 2 ? 700 : 500, color: done || i === 2 ? C.fg : C.mutedFg, animationName: i === 2 ? 'ph-lbl3' : undefined }}>
                                        {l}
                                    </span>
                                </span>
                            ))}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12, padding: '6px 8px', borderRadius: 8, background: primary(0.08) }}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                Entrega estimada
                            </T>
                            <T size={10} weight={800} color={primary()}>
                                en 2 días
                            </T>
                        </span>
                    </At>
                </At>
            </At>
        </Stage>
    );
}
