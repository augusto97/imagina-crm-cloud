import { Check, ReceiptText, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * El registro de cobros de las suscripciones: cada cobro que hace Mercado
 * Pago (pagado o rechazado) cae como una fila nueva en la lista «Cobros de
 * suscripciones», vinculada al cliente, y el tablero suma solo lo cobrado.
 */

const ROWS = [
    { who: 'Panadería Sol', period: 'noviembre de 2026', ok: true, at: 8 },
    { who: 'Gimnasio Norte', period: 'noviembre de 2026', ok: true, at: 26 },
    { who: 'Café Aurora', period: 'noviembre de 2026', ok: false, at: 44 },
    { who: 'Estudio Lumen', period: 'noviembre de 2026', ok: true, at: 62 },
];

// Lo cobrado del mes sube con cada fila pagada.
const TOTALS = ['$ 0', '$ 150.000', '$ 300.000', '$ 300.000', '$ 450.000'];
const TOTAL_AT = [0, 10, 28, 46, 64];

const CSS = `
${ROWS.map((r, i) => `@keyframes cr-r${i}{0%,${r.at}%{opacity:0;transform:translateX(-14px)}${r.at + 5}%,94%{opacity:1;transform:translateX(0)}100%{opacity:0}}`).join('\n')}
${TOTALS.map((_, i) => {
    const a = TOTAL_AT[i]!;
    const b = TOTAL_AT[i + 1] ?? 100;
    if (i === TOTALS.length - 1) return `@keyframes cr-t${i}{0%,${a}%{opacity:0}${a + 1}%,96%{opacity:1}100%{opacity:0}}`;
    return `@keyframes cr-t${i}{0%,${a}%{opacity:${i === 0 ? 1 : 0}}${a + 1}%,${b}%{opacity:1}${b + 1}%,100%{opacity:0}}`;
}).join('\n')}
@keyframes cr-bar{0%,10%{transform:scaleY(.15)}28%{transform:scaleY(.45)}64%,94%{transform:scaleY(.8)}100%{transform:scaleY(.15)}}
`;

export default function CobroRegistro(): JSX.Element {
    return (
        <Stage
            label="La lista «Cobros de suscripciones» recibe una fila nueva por cada cobro de Mercado Pago, con el cliente, el período y si se pagó o se rechazó; al lado, el tablero suma lo cobrado este mes."
            tint="mint"
        >
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                <At
                    x={24}
                    y={26}
                    w={292}
                    h={248}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ReceiptText size={13} color={C.mutedFg} />
                        <T size={11} weight={700}>
                            Cobros de suscripciones
                        </T>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr .9fr', gap: 4, marginTop: 10, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                        {['Suscriptor', 'Período', 'Estado'].map((h) => (
                            <T key={h} size={7} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {ROWS.map((r, i) => (
                            <span
                                key={i}
                                data-a=""
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1.3fr 1fr .9fr',
                                    gap: 4,
                                    alignItems: 'center',
                                    padding: '5px 6px',
                                    borderRadius: 6,
                                    border: `1px solid ${C.border}`,
                                    background: r.ok ? 'transparent' : 'rgba(220,38,38,.06)',
                                    animationName: `cr-r${i}`,
                                }}
                            >
                                <T size={8} weight={600} color={primary()}>
                                    {r.who}
                                </T>
                                <T size={7} color={C.mutedFg}>
                                    {r.period}
                                </T>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                    {r.ok ? <Check size={9} color="#10B981" /> : <X size={9} color="#DC2626" />}
                                    <T size={7} weight={700} color={r.ok ? '#059669' : '#DC2626'}>
                                        {r.ok ? 'Pagado' : 'Rechazado'}
                                    </T>
                                </span>
                            </span>
                        ))}
                    </span>
                </At>
                <At
                    x={330}
                    y={26}
                    w={126}
                    h={248}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <T size={8} weight={700} color={C.mutedFg}>
                        Cobrado este mes
                    </T>
                    <span style={{ display: 'grid', marginTop: 4 }}>
                        {TOTALS.map((t, i) => (
                            <span key={i} data-a="" style={{ gridArea: '1/1', opacity: i === 0 ? 1 : 0, animationName: `cr-t${i}` }}>
                                <T size={13} weight={800}>
                                    {t}
                                </T>
                            </span>
                        ))}
                    </span>
                    <span style={{ display: 'block', marginTop: 14 }}>
                        <T size={7} weight={700} color={C.mutedFg}>
                            Por mes
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, marginTop: 6 }}>
                        {[0.55, 0.7, 0.62].map((h, i) => (
                            <span key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: 3, background: primary(0.35) }} />
                        ))}
                        <span data-a="" style={{ flex: 1, height: '100%', borderRadius: 3, background: primary(), transformOrigin: 'bottom', animationName: 'cr-bar' }} />
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                        {['Ago', 'Sep', 'Oct', 'Nov'].map((m) => (
                            <T key={m} size={6} color={C.mutedFg}>
                                {m}
                            </T>
                        ))}
                    </span>
                </At>
            </div>
        </Stage>
    );
}
