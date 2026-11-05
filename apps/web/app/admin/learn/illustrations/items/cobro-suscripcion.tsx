import { Check, RefreshCw, Repeat, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Una suscripción de débito automático en la ficha de un cliente: el plan, el
 * estado que cambia solo (por autorizar → al día → reintentando → al
 * día) y la fila de cobros de cada mes, con el rechazo y el reintento que
 * Mercado Pago hace solo.
 */

const ST = [
    { label: 'Por autorizar', color: '#F59E0B' },
    { label: 'Al día', color: '#10B981' },
    { label: 'Reintentando', color: '#F97316' },
    { label: 'Al día', color: '#10B981' },
];

// Cada estado ocupa un tramo del ciclo (en %).
const SPANS: [number, number][] = [
    [0, 22],
    [22, 52],
    [52, 74],
    [74, 100],
];

const chipKeys = SPANS.map(([a, b], i) => {
    if (i === 0) return `@keyframes cs-s${i}{0%,${b - 0.5}%{opacity:1}${b}%,100%{opacity:0}}`;
    if (i === SPANS.length - 1) return `@keyframes cs-s${i}{0%,${a}%{opacity:0}${a + 0.5}%,100%{opacity:1}}`;
    return `@keyframes cs-s${i}{0%,${a}%{opacity:0}${a + 0.5}%,${b - 0.5}%{opacity:1}${b}%,100%{opacity:0}}`;
}).join('\n');

const MONTHS = [
    { m: 'Ago', at: 26, kind: 'ok' as const },
    { m: 'Sep', at: 36, kind: 'ok' as const },
    { m: 'Oct', at: 46, kind: 'ok' as const },
    { m: 'Nov', at: 56, kind: 'fail' as const },
    { m: 'Nov', at: 76, kind: 'retry' as const },
];

const CSS = `
${chipKeys}
${MONTHS.map((x, i) => `@keyframes cs-m${i}{0%,${x.at}%{opacity:0;transform:translateY(6px)}${x.at + 4}%,95%{opacity:1;transform:translateY(0)}100%{opacity:0}}`).join('\n')}
@keyframes cs-spin{0%,74%{transform:rotate(0)}82%,100%{transform:rotate(360deg)}}
`;

export default function CobroSuscripcion(): JSX.Element {
    return (
        <Stage label="La ficha de un cliente con su suscripción de débito automático: el estado pasa de «Por autorizar» a «Al día»; en noviembre el cobro se rechaza por fondos insuficientes, queda «Reintentando» y vuelve a «Al día» cuando Mercado Pago lo cobra en el reintento." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                <At x={40} y={22} w={400} h={256} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Repeat size={14} color={C.mutedFg} />
                        <T size={11} weight={700}>
                            Suscripción
                        </T>
                        <span style={{ display: 'inline-grid' }}>
                            {ST.map((s, i) => (
                                <span
                                    key={i}
                                    data-a=""
                                    style={{ gridArea: '1/1', justifySelf: 'start', display: 'inline-flex', alignItems: 'center', height: 17, padding: '0 8px', borderRadius: 99, background: s.color, color: '#fff', fontSize: 8, fontWeight: 700, whiteSpace: 'nowrap', opacity: i === ST.length - 1 ? 1 : 0, animationName: `cs-s${i}` }}
                                >
                                    {s.label}
                                </span>
                            ))}
                        </span>
                    </span>
                    <span style={{ display: 'block', marginTop: 12 }}>
                        <T size={13} weight={800}>
                            $ 150.000
                        </T>{' '}
                        <T size={9} color={C.mutedFg}>
                            cada mes · Mantenimiento mensual
                        </T>
                    </span>
                    <span style={{ display: 'block', marginTop: 2 }}>
                        <T size={8} color={C.mutedFg}>
                            próximo cobro 05/12 · pagado hasta 05/12 · ana@cliente.co
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                        {['Verificar', 'Pausar', 'Cambiar el valor', 'Cancelar'].map((a) => (
                            <T key={a} size={8} color={a === 'Cancelar' ? '#DC2626' : C.mutedFg} weight={600}>
                                {a}
                            </T>
                        ))}
                    </span>
                    <span style={{ display: 'block', marginTop: 14 }}>
                        <T size={8} weight={700} color={C.mutedFg}>
                            Cobros
                        </T>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {MONTHS.map((x, i) => {
                            const ok = x.kind !== 'fail';
                            return (
                                <span
                                    key={i}
                                    data-a=""
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: x.kind === 'fail' ? 'rgba(220,38,38,.06)' : 'transparent', animationName: `cs-m${i}` }}
                                >
                                    {x.kind === 'retry' ? (
                                        <span data-a="" style={{ display: 'inline-flex', animationName: 'cs-spin' }}>
                                            <RefreshCw size={10} color={primary()} />
                                        </span>
                                    ) : ok ? (
                                        <Check size={10} color="#10B981" />
                                    ) : (
                                        <X size={10} color="#DC2626" />
                                    )}
                                    <T size={8} weight={700} color={ok ? '#059669' : '#DC2626'}>
                                        {ok ? 'Pagado' : 'Rechazado'}
                                    </T>
                                    <T size={8}>$ 150.000</T>
                                    <T size={8} color={C.mutedFg}>
                                        {x.m}
                                        {x.kind === 'retry' ? ' · reintento 1' : ''}
                                    </T>
                                    <T size={8} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                                        {ok ? 'Tarjeta de crédito' : 'fondos insuficientes'}
                                    </T>
                                </span>
                            );
                        })}
                    </span>
                </At>
            </div>
        </Stage>
    );
}
