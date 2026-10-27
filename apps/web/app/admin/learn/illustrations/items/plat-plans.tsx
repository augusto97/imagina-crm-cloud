import { Check, CreditCard } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Planes: la tabla de límites y precios. Se crea el plan «Growth» con su
 * precio en COP y aparece solo en el checkout de las empresas.
 */

const CSS = `
@keyframes ppl-new{0%,14%{opacity:0;transform:translateY(-8px);background:transparent}22%,40%{opacity:1;transform:translateY(0);background:${primary(0.1)}}52%,92%{opacity:1;background:transparent}100%{opacity:0}}
@keyframes ppl-price{0%,24%{width:0}36%,100%{width:58px}}
@keyframes ppl-card{0%,44%{opacity:0;transform:translateY(10px) scale(.96)}54%,92%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0}}
@keyframes ppl-glow{0%,54%{box-shadow:0 0 0 0 transparent}60%,72%{box-shadow:0 0 0 4px ${primary(0.2)}}82%,100%{box-shadow:0 0 0 0 transparent}}
`;

const COLS = ['Plan', 'Registros', 'Usuarios', 'Correos/mes', 'IA/mes', 'COP/mes'];
const W = [70, 62, 52, 66, 50, 72];

function Row({ cells, a, bold }: { cells: Array<string | JSX.Element>; a?: string; bold?: boolean }): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                height: 27,
                padding: '0 10px',
                borderTop: `1px solid ${C.border}`,
                animationName: a,
            }}
        >
            {cells.map((c, i) => (
                <span key={i} style={{ width: W[i], flexShrink: 0 }}>
                    {typeof c === 'string' ? (
                        <T size={8.5} weight={i === 0 || bold ? 700 : 500} color={i === 0 ? C.fg : C.mutedFg}>
                            {c}
                        </T>
                    ) : (
                        c
                    )}
                </span>
            ))}
        </div>
    );
}

export default function PlatPlans(): JSX.Element {
    return (
        <Stage
            label="En Planes cada plan tiene sus límites (registros, usuarios, correos, pedidos al asistente) y su precio. Se crea el plan Growth con precio en pesos y aparece solo en la pantalla de pago de las empresas."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={16}
                w={452}
                h={186}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <div
                    style={{
                        padding: '9px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={10.5} weight={700}>
                            Planes
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Vacío = ilimitado. Sin precio = no se vende.
                        </T>
                    </span>
                    <span
                        style={{
                            height: 20,
                            padding: '0 8px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Nuevo plan
                    </span>
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 22,
                        padding: '0 10px',
                        background: C.muted,
                    }}
                >
                    {COLS.map((c, i) => (
                        <T key={c} size={8} weight={700} color={C.mutedFg} style={{ width: W[i] }}>
                            {c}
                        </T>
                    ))}
                </div>
                <Row cells={['Trial', '500', '3', '100', '20', '—']} />
                <Row cells={['Starter', '5.000', '5', '1.000', '100', '$ 89.000']} />
                <Row cells={['Pro', '25.000', '10', '10.000', '500', '$ 249.000']} />
                <Row
                    a="ppl-new"
                    bold
                    cells={[
                        'Growth',
                        '50.000',
                        '20',
                        '20.000',
                        '1.000',
                        <span
                            key="p"
                            data-a=""
                            style={{
                                display: 'inline-block',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                width: 58,
                                animationName: 'ppl-price',
                                borderBottom: `1.5px solid ${primary()}`,
                            }}
                        >
                            <T size={8.5} weight={700}>
                                $ 389.000
                            </T>
                        </span>,
                    ]}
                />
            </At>

            {/* El checkout de una empresa */}
            <At x={96} y={210} w={288} a="ppl-card">
                <div
                    data-a=""
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        animationName: 'ppl-glow',
                    }}
                >
                    <span
                        style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            background: tone('blue', 0.14),
                            color: tone('blue'),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <CreditCard size={15} />
                    </span>
                    <span
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            flex: 1,
                        }}
                    >
                        <T size={8} color={C.mutedFg}>
                            Ajustes → Suscripción de cada empresa
                        </T>
                        <T size={10} weight={700}>
                            Growth · $ 389.000 / mes
                        </T>
                    </span>
                    <span
                        style={{
                            height: 22,
                            padding: '0 9px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                        }}
                    >
                        <Check size={10} /> Elegir
                    </span>
                </div>
            </At>
        </Stage>
    );
}
