import { BarChart3, ChevronRight, CornerDownRight, Folder, List, PackageOpen } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Lo que arma la sincronización: una carpeta con tres listas (Productos,
 * Pedidos, Clientes) y dos tableros. En Pedidos, cada pedido se despliega y
 * muestra sus líneas como subtareas; en Clientes, cuánto compró cada uno se
 * calcula solo.
 */

const CSS = `
@keyframes tli-chev{0%,14%{transform:rotate(0)}18%,92%{transform:rotate(90deg)}97%,100%{transform:rotate(0)}}
@keyframes tli-sub{0%,16%{max-height:0;opacity:0}24%,92%{max-height:60px;opacity:1}97%,100%{max-height:0;opacity:0}}
@keyframes tli-side{0%,8%{background:transparent}12%,92%{background:${primary(0.12)}}97%,100%{background:transparent}}
@keyframes tli-cli{0%,46%{opacity:0;transform:translateY(8px)}52%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes tli-k1{0%,54%{opacity:0}58%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tli-k2{0%,60%{opacity:0}64%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tli-k3{0%,66%{opacity:0}70%,92%{opacity:1}97%,100%{opacity:0}}
`;

function SideItem({ icon, label, a }: { icon: JSX.Element; label: string; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ animationName: a, display: 'flex', alignItems: 'center', gap: 6, height: 22, borderRadius: 6, padding: '0 6px 0 16px', fontSize: 8.5, fontWeight: 600 }}>
            {icon}
            {label}
        </span>
    );
}

const COLS = '14px 1.2fr 1fr 70px 58px';

export default function TiendaListas(): JSX.Element {
    return (
        <Stage label="La sincronización arma una carpeta con tres listas, Productos, Pedidos y Clientes, y dos tableros. Cada pedido se despliega y muestra sus líneas como subtareas, y en Clientes cuánto compró cada uno se calcula solo." tint="violet">
            <Keyframes css={CSS} />

            {/* El menú: la carpeta de la tienda */}
            <At x={14} y={20} w={128} h={196} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 22, padding: '0 6px' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: tone('violet'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        <Folder size={10} />
                    </span>
                    <T size={9} weight={700}>
                        Tienda Café Aurora
                    </T>
                </span>
                <SideItem icon={<PackageOpen size={11} color={tone('amber')} />} label="Productos" />
                <SideItem icon={<List size={11} color={tone('blue')} />} label="Pedidos" a="tli-side" />
                <SideItem icon={<List size={11} color={tone('mint')} />} label="Clientes" />
                <span style={{ height: 1, background: C.border, margin: '6px 6px' }} />
                <SideItem icon={<BarChart3 size={11} color={primary()} />} label="Ventas" />
                <SideItem icon={<BarChart3 size={11} color={primary()} />} label="Inventario" />
            </At>

            {/* Pedidos con sus líneas */}
            <Win x={154} y={12} w={312} h={166} title="Pedidos">
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 5, height: 22, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <span />
                    {['Pedido', 'Cliente', 'Estado', 'Total'].map((h) => (
                        <T key={h} size={7.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 5, height: 24, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <span data-a="" style={{ animationName: 'tli-chev', display: 'flex', transform: 'rotate(90deg)' }}>
                        <ChevronRight size={10} color={C.mutedFg} />
                    </span>
                    <T size={8.5} weight={700}>#1043</T>
                    <T size={8.5}>Laura Gómez</T>
                    <span style={{ display: 'flex' }}>
                        <Chip label="Procesando" t="blue" />
                    </span>
                    <T size={8.5} weight={600}>$82.000</T>
                </div>
                <div data-a="" style={{ animationName: 'tli-sub', overflow: 'hidden', maxHeight: 60, background: C.muted }}>
                    {[
                        ['Taza Aurora · Roja ×2', '$70.000'],
                        ['Filtros de papel ×100 ×1', '$12.000'],
                    ].map(([n, v]) => (
                        <div key={n} style={{ display: 'grid', gridTemplateColumns: '14px 1fr 58px', gap: 5, height: 22, alignItems: 'center', padding: '0 9px 0 22px', borderBottom: `1px solid ${C.border}` }}>
                            <CornerDownRight size={9} color={C.mutedFg} />
                            <T size={8}>{n}</T>
                            <T size={8}>{v}</T>
                        </div>
                    ))}
                </div>
                {[
                    ['#1042', 'Hotel Brisas', '$215.000'],
                    ['#1041', 'Andrés Rojas', '$35.000'],
                ].map(([n, c, v]) => (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 5, height: 24, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <ChevronRight size={10} color={C.mutedFg} />
                        <T size={8.5} weight={700}>{n}</T>
                        <T size={8.5}>{c}</T>
                        <span style={{ display: 'flex' }}>
                            <Chip label="Completado" t="mint" />
                        </span>
                        <T size={8.5} weight={600}>{v}</T>
                    </div>
                ))}
            </Win>

            {/* Clientes: lo calculado */}
            <At x={154} y={188} w={312} a="tli-cli" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 12px 28px -16px rgba(15,23,42,.5)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 99, background: tone('rose', 0.18), color: tone('rose'), fontSize: 8.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>LG</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={9.5} weight={700}>
                            Laura Gómez
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Clientes · Medellín · cliente desde 2024
                        </T>
                    </span>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {[
                        ['Pedidos', '6', 'tli-k1'],
                        ['Total comprado', '$412.000', 'tli-k2'],
                        ['Ticket promedio', '$68.700', 'tli-k3'],
                    ].map(([l, v, a]) => (
                        <span key={l} style={{ borderRadius: 7, background: C.muted, padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={7.5} color={C.mutedFg}>
                                {l}
                            </T>
                            <span data-a="" style={{ animationName: a, display: 'flex' }}>
                                <T size={10.5} weight={700} color={primary()}>
                                    {v}
                                </T>
                            </span>
                        </span>
                    ))}
                </span>
            </At>
            <At x={14} y={226} w={128}>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.35 }}>
                    Todo es un registro común: se filtra, se agrupa y dispara automatizaciones.
                </T>
            </At>
        </Stage>
    );
}
