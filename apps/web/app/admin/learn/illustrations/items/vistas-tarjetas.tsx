import { Coffee, CupSoda, Package, Scale, Sparkles, Thermometer } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/** Vista de tarjetas: un catálogo de productos con foto de portada, precio y stock. */

type Tn = 'amber' | 'violet' | 'cyan' | 'mint' | 'rose' | 'blue';
const CARDS: Array<{ name: string; price: string; stock: string; low?: boolean; t: Tn; icon: JSX.Element }> = [
    { name: 'Café de origen', price: '$ 34.000', stock: '34 und.', t: 'amber', icon: <Coffee size={26} /> },
    { name: 'Taza de cerámica', price: '$ 22.000', stock: '9 und.', low: true, t: 'violet', icon: <CupSoda size={26} /> },
    { name: 'Termo de acero', price: '$ 107.000', stock: '4 und.', low: true, t: 'cyan', icon: <Thermometer size={26} /> },
    { name: 'Báscula digital', price: '$ 91.000', stock: '59 und.', t: 'mint', icon: <Scale size={26} /> },
    { name: 'Kit de barista', price: '$ 122.000', stock: '44 und.', t: 'rose', icon: <Sparkles size={26} /> },
    { name: 'Filtros x100', price: '$ 57.000', stock: '31 und.', t: 'blue', icon: <Package size={26} /> },
];

const CSS =
    CARDS.map((_, i) => `@keyframes vtj-c${i}{0%,${4 + i * 5}%{opacity:0;transform:translateY(10px) scale(.96)}${12 + i * 5}%,93%{opacity:1;transform:translateY(0) scale(1)}98%,100%{opacity:0;transform:translateY(0) scale(1)}}`).join('\n') +
    `
@keyframes vtj-lift{0%,58%{transform:translateY(0);box-shadow:0 1px 2px rgba(15,23,42,.08)}64%,84%{transform:translateY(-4px);box-shadow:0 16px 26px -14px rgba(15,23,42,.55)}90%,100%{transform:translateY(0);box-shadow:0 1px 2px rgba(15,23,42,.08)}}
@keyframes vtj-cur{0%,46%{transform:translate(430px,290px);opacity:0}52%{opacity:1}62%,86%{transform:translate(262px,96px);opacity:1}94%,100%{transform:translate(262px,96px);opacity:0}}
`;

export default function VistasTarjetas(): JSX.Element {
    return (
        <Stage label="Una vista de tarjetas con el catálogo de una tienda: cada producto tiene su foto de portada, el precio y el stock, y los que tienen poco stock se marcan." tint="amber">
            <Keyframes css={CSS} />
            <Win x={20} y={18} w={440} h={266} title="Productos · Catálogo">
                {CARDS.map((c, i) => {
                    const col = i % 3;
                    const row = Math.floor(i / 3);
                    return (
                        <At key={c.name} x={12 + col * 140} y={10 + row * 116} w={132} h={108} a={`vtj-c${i}`}>
                            <div
                                data-a={i === 1 ? '' : undefined}
                                style={{ height: '100%', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, overflow: 'hidden', animationName: i === 1 ? 'vtj-lift' : undefined }}
                            >
                                <div style={{ height: 56, background: `linear-gradient(135deg, ${tone(c.t, 0.55)}, ${tone(c.t, 0.22)})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.icon}</div>
                                <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <T size={9.5} weight={700}>
                                        {c.name}
                                    </T>
                                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <T size={9} weight={600} color={C.mutedFg}>
                                            {c.price}
                                        </T>
                                        <Chip label={c.stock} t={c.low ? 'rose' : 'slate'} />
                                    </span>
                                </div>
                            </div>
                        </At>
                    );
                })}
            </Win>
            <Cursor a="vtj-cur" rest={[262, 96]} />
        </Stage>
    );
}
