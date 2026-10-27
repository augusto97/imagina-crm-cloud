import { AlignLeft, AtSign, CheckSquare, CircleDot, Clock, DollarSign, Hash, Link2, ListChecks, Percent, Phone, Star, Type } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Los tipos de campo «de todos los días» en una ficha: cada uno guarda y
 * muestra el dato a su manera (chips, estrellas, barra de avance, bandera…).
 */

const ROWS: Array<{ icon: JSX.Element; name: string; value: JSX.Element }> = [
    { icon: <Type size={10} />, name: 'Texto', value: <T size={9} weight={600}>Café Bahía S.A.S.</T> },
    { icon: <AlignLeft size={10} />, name: 'Texto largo', value: <T size={8.5} color={C.mutedFg}>Prefiere que lo llamen en la…</T> },
    { icon: <Hash size={10} />, name: 'Número', value: <T size={9} weight={600}>42</T> },
    { icon: <DollarSign size={10} />, name: 'Moneda', value: <T size={9} weight={700}>$ 1.250.000</T> },
    {
        icon: <Percent size={10} />,
        name: 'Porcentaje',
        value: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 54, height: 6, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                    <span data-a="" style={{ display: 'block', height: '100%', width: '70%', background: primary(), borderRadius: 99, animationName: 'tp-bar' }} />
                </span>
                <T size={8.5} weight={600}>
                    70 %
                </T>
            </span>
        ),
    },
    { icon: <Clock size={10} />, name: 'Duración', value: <T size={9} weight={600}>1h 30m</T> },
    {
        icon: <Star size={10} />,
        name: 'Calificación',
        value: (
            <span style={{ display: 'flex', gap: 1.5, color: tone('amber') }}>
                {[0, 1, 2, 3, 4].map((i) => (
                    <Star key={i} size={10} fill={i < 4 ? 'currentColor' : 'none'} />
                ))}
            </span>
        ),
    },
    {
        icon: <CheckSquare size={10} />,
        name: 'Casilla',
        value: (
            <span style={{ width: 12, height: 12, borderRadius: 3, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
        ),
    },
    { icon: <CircleDot size={10} />, name: 'Selección', value: <Chip label="Cliente activo" t="mint" /> },
    {
        icon: <ListChecks size={10} />,
        name: 'Selección múltiple',
        value: (
            <span style={{ display: 'flex', gap: 3 }}>
                <Chip label="VIP" t="violet" />
                <Chip label="Mayorista" t="blue" />
            </span>
        ),
    },
    {
        icon: <Phone size={10} />,
        name: 'Teléfono',
        value: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ display: 'flex', flexDirection: 'column', width: 13, height: 9, borderRadius: 1.5, overflow: 'hidden' }}>
                    <span style={{ flex: 2, background: '#FCD116' }} />
                    <span style={{ flex: 1, background: '#003893' }} />
                    <span style={{ flex: 1, background: '#CE1126' }} />
                </span>
                <T size={8.5} weight={600}>
                    320 903 0795
                </T>
            </span>
        ),
    },
    { icon: <AtSign size={10} />, name: 'Email', value: <T size={8.5} color={tone('blue')}>pagos@cafebahia.co</T> },
    { icon: <Link2 size={10} />, name: 'URL', value: <T size={8.5} color={tone('blue')}>cafebahia.co</T> },
];

const CSS = `
@keyframes tp-bar{0%,30%{width:0}45%,100%{width:70%}}
${ROWS.map((_, i) => `@keyframes tp-r${i}{0%,${2 + i * 3}%{opacity:0;transform:translateY(6px)}${6 + i * 3}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`).join('\n')}
`;

export default function LcTipos(): JSX.Element {
    const half = Math.ceil(ROWS.length / 2);
    return (
        <Stage label="La ficha de un cliente muestra un campo de cada tipo: texto, número, moneda, porcentaje con barra, duración, estrellas, casilla, opciones en chips de color, teléfono con bandera, correo y enlace." tint="violet">
            <Keyframes css={CSS} />
            <At x={16} y={16} w={448} h={268} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -22px rgba(15,23,42,.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10.5} weight={700}>
                        Café Bahía
                    </T>
                    <T size={8} color={C.mutedFg}>
                        · un campo de cada tipo
                    </T>
                </div>
                {[ROWS.slice(0, half), ROWS.slice(half)].map((col, ci) => (
                    <div key={ci} style={{ position: 'absolute', left: 12 + ci * 218, top: 36, width: 206 }}>
                        {col.map((r, i) => {
                            const idx = ci * half + i;
                            return (
                                <div key={r.name} data-a="" style={{ display: 'flex', alignItems: 'center', height: 31, borderBottom: `1px solid ${C.border}`, animationName: `tp-r${idx}` }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, width: 96, color: C.mutedFg }}>
                                        {r.icon}
                                        <T size={8} color={C.mutedFg}>
                                            {r.name}
                                        </T>
                                    </span>
                                    <span style={{ display: 'flex', minWidth: 0 }}>{r.value}</span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </At>
        </Stage>
    );
}
