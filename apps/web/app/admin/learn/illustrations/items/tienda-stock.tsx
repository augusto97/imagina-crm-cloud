import { ShoppingCart } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * El inventario de la tienda: se vende un termo en WooCommerce, su stock baja
 * de 4 a 3 y, como la alerta de stock bajo es 3, pasa a «Stock bajo». La vista
 * «Para reponer» junta lo agotado y lo que está por agotarse.
 */

const CSS = `
@keyframes tk-sale{0%,6%{opacity:0;transform:translateY(-6px)}10%,30%{opacity:1;transform:translateY(0)}34%,100%{opacity:0}}
@keyframes tk-row{0%,18%{background:transparent}22%,34%{background:${tone('amber', 0.18)}}42%,100%{background:transparent}}
@keyframes tk-o{0%,22%{opacity:1}25%,100%{opacity:0}}
@keyframes tk-n{0%,22%{opacity:0}25%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tk-all{0%,48%{opacity:1}52%,100%{opacity:0}}
@keyframes tk-rep{0%,48%{opacity:0;transform:translateY(4px)}52%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes tk-tab1{0%,48%{color:${C.fg};border-color:${primary()}}52%,100%{color:${C.mutedFg};border-color:transparent}}
@keyframes tk-tab2{0%,48%{color:${C.mutedFg};border-color:transparent}52%,100%{color:${C.fg};border-color:${primary()}}}
`;

type Tone = 'rose' | 'amber' | 'mint' | 'blue';
const COLS = '1.4fr 34px 96px 52px 52px';

function Swap({ a, b, from, to, h = 16 }: { a: string; b: string; from: JSX.Element; to: JSX.Element; h?: number }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'block', height: h }}>
            <span data-a="" style={{ animationName: a, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: 0 }}>
                {from}
            </span>
            <span data-a="" style={{ animationName: b, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                {to}
            </span>
        </span>
    );
}

function Row({ name, stock, state, t, sold, months, a }: { name: string; stock: JSX.Element | string; state: JSX.Element; t?: Tone; sold: string; months: string; a?: string }): JSX.Element {
    return (
        <div data-a={a ? '' : undefined} style={{ animationName: a, display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            <T size={8.5} weight={600}>
                {name}
            </T>
            {typeof stock === 'string' ? (
                <T size={8.5} weight={700} color={t === 'rose' ? C.destructive : C.fg}>
                    {stock}
                </T>
            ) : (
                stock
            )}
            <span style={{ display: 'flex' }}>{state}</span>
            <T size={8.5}>{sold}</T>
            <T size={8.5} color={C.mutedFg}>
                {months}
            </T>
        </div>
    );
}

function Head(): JSX.Element {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 24, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            {['Producto', 'Stock', 'Inventario', 'Vendidas (30 días)', 'Meses de cobertura'].map((h) => (
                <T key={h} size={7.5} weight={700} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.1 }}>
                    {h}
                </T>
            ))}
        </div>
    );
}

export default function TiendaStock(): JSX.Element {
    const termo = (
        <Row
            a="tk-row"
            name="Termo Andes"
            stock={<Swap a="tk-o" b="tk-n" from={<T size={8.5} weight={700}>4</T>} to={<T size={8.5} weight={700} color={tone('amber')}>3</T>} />}
            state={<Swap a="tk-o" b="tk-n" from={<Chip label="En stock" t="mint" />} to={<Chip label="Stock bajo" t="amber" />} />}
            sold="7"
            months="0,4"
        />
    );
    const cafe = <Row name="Café de origen 500 g" stock="0" t="rose" state={<Chip label="Agotado" t="rose" />} sold="25" months="0" />;
    return (
        <Stage label="Se vende un termo en la tienda: su stock baja de 4 a 3 y, como la alerta de stock bajo es 3, pasa a Stock bajo. La vista Para reponer junta lo agotado y lo que está por agotarse." tint="amber">
            <Keyframes css={CSS} />

            <Win x={16} y={22} w={448} h={207} title="Productos">
                {/* Pestañas de vistas */}
                <div style={{ display: 'flex', gap: 14, height: 26, alignItems: 'flex-end', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <span data-a="" style={{ animationName: 'tk-tab1', fontSize: 8.5, fontWeight: 700, paddingBottom: 5, borderBottom: '2px solid transparent', color: C.mutedFg }}>
                        Todos
                    </span>
                    <span data-a="" style={{ animationName: 'tk-tab2', fontSize: 8.5, fontWeight: 700, paddingBottom: 5, borderBottom: `2px solid ${primary()}`, color: C.fg }}>
                        Para reponer
                    </span>
                    <span style={{ fontSize: 8.5, fontWeight: 600, paddingBottom: 5, color: C.mutedFg }}>Por inventario</span>
                </div>
                <Head />
                <div style={{ position: 'relative' }}>
                    {/* Todos */}
                    <div data-a="" style={{ animationName: 'tk-all', position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }}>
                        <Row name="Libreta Kraft" stock="40" state={<Chip label="En stock" t="mint" />} sold="12" months="3,3" />
                        {termo}
                        {cafe}
                        <Row name="Molino manual" stock="0" state={<Chip label="Por encargo" t="blue" />} sold="2" months="0" />
                        <Row name="Filtros de papel ×100" stock="—" state={<Chip label="Sin control de stock" t="slate" />} sold="31" months="—" />
                    </div>
                    {/* Para reponer */}
                    <div data-a="" style={{ animationName: 'tk-rep', position: 'absolute', left: 0, right: 0, top: 0 }}>
                        {cafe}
                        <Row name="Taza Aurora · Negra" stock={<T size={8.5} weight={700} color={tone('amber')}>2</T>} state={<Chip label="Stock bajo" t="amber" />} sold="9" months="0,2" />
                        <Row name="Termo Andes" stock={<T size={8.5} weight={700} color={tone('amber')}>3</T>} state={<Chip label="Stock bajo" t="amber" />} sold="7" months="0,4" />
                    </div>
                </div>
            </Win>

            {/* La venta */}
            <At x={286} y={6} w={176} a="tk-sale" style={{ opacity: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 7, boxShadow: '0 12px 26px -14px rgba(15,23,42,.55)', zIndex: 5 }}>
                <IntegrationLogo integrationKey="woocommerce" size={18} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ShoppingCart size={9} color={primary()} />
                        <T size={8.5} weight={700}>
                            Venta en la tienda
                        </T>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Termo Andes ×1 · pedido #1046
                    </T>
                </span>
            </At>

            {/* Indicadores del tablero de inventario */}
            <At x={16} y={240} w={448} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {[
                    ['Agotados', '1', C.destructive],
                    ['Con stock bajo', '2', tone('amber')],
                    ['Valor en stock', '$18,4 M', C.fg],
                    ['Unidades en stock', '412', C.fg],
                ].map(([l, v, c]) => (
                    <span key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '4px 7px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4 }}>
                        <T size={7.5} color={C.mutedFg}>
                            {l}
                        </T>
                        <T size={10} weight={700} color={c}>
                            {v}
                        </T>
                    </span>
                ))}
            </At>
        </Stage>
    );
}
