import type { ReactNode } from 'react';
import { Check, EyeOff } from 'lucide-react';

import { At, C, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Campos ocultos por rol: se marca «Costo» en «Campos que este rol NO debe
 * ver» y la columna desaparece de la pantalla del Agente.
 */

const CSS = `
@keyframes ehf-tick{0%,18%{opacity:0;transform:scale(.4)}24%,90%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ehf-box{0%,18%{background:transparent;border-color:${C.border}}24%,90%{background:${primary()};border-color:${primary()}}97%,100%{background:transparent;border-color:${C.border}}}
@keyframes ehf-col{0%,34%{opacity:1;width:74px}46%,90%{opacity:0;width:0}98%,100%{opacity:1;width:74px}}
@keyframes ehf-ghost{0%,40%{opacity:0}50%,88%{opacity:1}95%,100%{opacity:0}}
`;

const ROWS: Array<[string, string, string, string]> = [
    ['Café de origen 500 g', '$ 42.000', '$ 23.500', '24'],
    ['Prensa francesa', '$ 98.000', '$ 61.000', '12'],
    ['Molino manual', '$ 135.000', '$ 88.200', '7'],
    ['Termo de acero', '$ 56.000', '$ 31.800', '31'],
];

function Cell({ children, w, bold, color }: { children: ReactNode; w: number; bold?: boolean; color?: string }): JSX.Element {
    return (
        <span
            style={{
                width: w,
                flexShrink: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                padding: '0 8px',
            }}
        >
            <T size={9} weight={bold ? 700 : 500} color={color}>
                {children}
            </T>
        </span>
    );
}

export default function EquipoHiddenFields(): JSX.Element {
    return (
        <Stage
            label="En los permisos de la lista Productos se marca el campo Costo como oculto para el rol Agente: la columna Costo desaparece de su tabla y de la ficha; el resto sigue igual."
            tint="rose"
        >
            <Keyframes css={CSS} />
            {/* El ajuste */}
            <Win x={18} y={18} w={444} h={84} title="Productos · Permisos · Agente · Ajuste fino">
                <At x={12} y={8}>
                    <T size={9} weight={700}>
                        Campos que este rol NO debe ver
                    </T>
                </At>
                <At x={12} y={32} style={{ display: 'flex', gap: 14 }}>
                    {['Producto', 'Precio', 'Costo', 'Stock'].map((f) => {
                        const target = f === 'Costo';
                        return (
                            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                    data-a={target ? '' : undefined}
                                    style={{
                                        width: 13,
                                        height: 13,
                                        borderRadius: 3,
                                        border: `1.5px solid ${target ? primary() : C.border}`,
                                        background: target ? primary() : 'transparent',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        animationName: target ? 'ehf-box' : undefined,
                                    }}
                                >
                                    {target && (
                                        <span
                                            data-a=""
                                            style={{
                                                display: 'inline-flex',
                                                color: '#fff',
                                                animationName: 'ehf-tick',
                                            }}
                                        >
                                            <Check size={9} strokeWidth={3} />
                                        </span>
                                    )}
                                </span>
                                <T size={9.5} weight={target ? 700 : 500}>
                                    {f}
                                </T>
                            </span>
                        );
                    })}
                </At>
            </Win>

            {/* La tabla que ve el agente */}
            <At x={18} y={116} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <T size={9} weight={700} color={C.mutedFg}>
                    Lo que ve Luis (Agente)
                </T>
                <span data-a="" style={{ animationName: 'ehf-ghost', display: 'inline-flex' }}>
                    <Pill t="rose" label="Costo oculto" icon={<EyeOff size={9} />} />
                </span>
            </At>
            <Win x={18} y={136} w={444} h={144}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 26,
                        borderBottom: `1px solid ${C.border}`,
                        background: C.muted,
                    }}
                >
                    <Cell w={180} bold>
                        Producto
                    </Cell>
                    <Cell w={90} bold>
                        Precio
                    </Cell>
                    <span
                        data-a=""
                        style={{
                            display: 'inline-block',
                            width: 0,
                            opacity: 0,
                            overflow: 'hidden',
                            animationName: 'ehf-col',
                            background: tone('rose', 0.1),
                        }}
                    >
                        <Cell w={74} bold color={tone('rose')}>
                            Costo
                        </Cell>
                    </span>
                    <Cell w={70} bold>
                        Stock
                    </Cell>
                </div>
                {ROWS.map((r) => (
                    <div
                        key={r[0]}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: 28,
                            borderBottom: `1px solid ${C.border}`,
                        }}
                    >
                        <Cell w={180} bold>
                            {r[0]}
                        </Cell>
                        <Cell w={90}>{r[1]}</Cell>
                        <span
                            data-a=""
                            style={{
                                display: 'inline-block',
                                width: 0,
                                opacity: 0,
                                overflow: 'hidden',
                                animationName: 'ehf-col',
                                background: tone('rose', 0.1),
                            }}
                        >
                            <Cell w={74} color={tone('rose')}>
                                {r[2]}
                            </Cell>
                        </span>
                        <Cell w={70}>{r[3]}</Cell>
                    </div>
                ))}
            </Win>
        </Stage>
    );
}
