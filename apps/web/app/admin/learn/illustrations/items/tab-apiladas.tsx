import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Barras apiladas: las ventas de cada mes partidas por vendedor. Primero en
 * pesos (cuánto aportó cada uno) y después «Al 100 %» (qué parte del mes
 * vendió cada uno).
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const SERIES: Array<{ name: string; t: Tn }> = [
    { name: 'Ana', t: 'mint' },
    { name: 'Luis', t: 'blue' },
    { name: 'Sara', t: 'amber' },
];
const MONTHS: Array<{ m: string; v: [number, number, number] }> = [
    { m: 'Jun', v: [3, 2, 1.5] },
    { m: 'Jul', v: [4, 2.5, 2] },
    { m: 'Ago', v: [2.5, 3, 3] },
    { m: 'Sep', v: [5, 3, 2] },
    { m: 'Oct', v: [6, 4, 3] },
];
const CH = 140; // alto del área de barras
const UNIT = CH / 13;

const segKeys = MONTHS.flatMap((mo, i) =>
    mo.v.map((v, k) => {
        const total = mo.v[0] + mo.v[1] + mo.v[2];
        const abs = Math.round(v * UNIT);
        const pct = Math.round((v / total) * CH);
        const s = 6 + i * 3;
        return `@keyframes ta-s${i}${k}{0%,${s}%{height:0;opacity:1}${s + 14}%,52%{height:${abs}px;opacity:1}60%,92%{height:${pct}px;opacity:1}97%,100%{height:${pct}px;opacity:0}}`;
    }),
).join('\n');

const CSS = `
${segKeys}
@keyframes ta-check{0%,54%{background:${C.card};border-color:${C.border}}57%,92%{background:${primary()};border-color:${primary()}}97%,100%{background:${C.card};border-color:${C.border}}}
@keyframes ta-tick{0%,54%{opacity:0}57%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ta-axA{0%,54%{opacity:1}58%,100%{opacity:0}}
@keyframes ta-axB{0%,54%{opacity:0}58%,92%{opacity:1}97%,100%{opacity:0}}
`;

export default function TabApiladas(): JSX.Element {
    return (
        <Stage label="Un gráfico de columnas con las ventas de cada mes desglosadas por vendedor: primero apiladas en pesos y después al 100 %, para ver qué parte vendió cada uno." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={36} y={14} w={408} h={272} title="Ventas por mes">
                    <At x={14} y={10}>
                        <T size={10} weight={700} style={{ display: 'block' }}>
                            Ventas por mes · por vendedor
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ display: 'block', marginTop: 2 }}>
                            Suma de Valor · Oportunidades
                        </T>
                    </At>
                    {/* Opciones del desglose */}
                    <At x={258} y={10} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span
                            data-a=""
                            style={{
                                width: 12,
                                height: 12,
                                borderRadius: 3,
                                border: `1px solid ${primary()}`,
                                background: primary(),
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                animationName: 'ta-check',
                            }}
                        >
                            <span data-a="" style={{ animationName: 'ta-tick', color: C.primaryFg, fontSize: 9, fontWeight: 800, lineHeight: 1 }}>
                                ✓
                            </span>
                        </span>
                        <T size={8.5} weight={600}>
                            Al 100 %
                        </T>
                    </At>
                    {/* Leyenda */}
                    <At x={258} y={28} style={{ display: 'flex', gap: 9 }}>
                        {SERIES.map((s) => (
                            <span key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: tone(s.t) }} />
                                <T size={8} color={C.mutedFg}>
                                    {s.name}
                                </T>
                            </span>
                        ))}
                    </At>
                    {/* Eje */}
                    <At x={14} y={54} w={36} h={CH}>
                        {[0, 1, 2].map((k) => (
                            <span key={k} style={{ position: 'absolute', right: 4, top: k * (CH / 2) - 5 }}>
                                <span style={{ display: 'inline-grid' }}>
                                    <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'ta-axA' }}>
                                        <T size={7} color={C.mutedFg}>
                                            {['13 M', '6,5 M', '0'][k]}
                                        </T>
                                    </span>
                                    <span data-a="" style={{ gridArea: '1/1', animationName: 'ta-axB' }}>
                                        <T size={7} color={C.mutedFg}>
                                            {['100 %', '50 %', '0 %'][k]}
                                        </T>
                                    </span>
                                </span>
                            </span>
                        ))}
                    </At>
                    <At x={54} y={54} w={330} h={CH} style={{ borderBottom: `1px solid ${C.border}` }}>
                        {[0, 1].map((k) => (
                            <span key={k} style={{ position: 'absolute', left: 0, right: 0, top: k * (CH / 2), borderTop: `1px dashed ${C.border}` }} />
                        ))}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around' }}>
                            {MONTHS.map((mo, i) => {
                                const total = mo.v[0] + mo.v[1] + mo.v[2];
                                return (
                                    <span key={mo.m} style={{ width: 34, display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
                                        {mo.v.map((v, k) => (
                                            <span
                                                key={k}
                                                data-a=""
                                                style={{
                                                    height: Math.round((v / total) * CH),
                                                    background: tone(SERIES[k]!.t),
                                                    borderRadius: k === 2 ? '4px 4px 0 0' : 0,
                                                    animationName: `ta-s${i}${k}`,
                                                }}
                                            />
                                        ))}
                                    </span>
                                );
                            })}
                        </div>
                    </At>
                    <At x={54} y={58 + CH} w={330} style={{ display: 'flex', justifyContent: 'space-around' }}>
                        {MONTHS.map((mo) => (
                            <span key={mo.m} style={{ width: 34, textAlign: 'center' }}>
                                <T size={8} color={C.mutedFg}>
                                    {mo.m}
                                </T>
                            </span>
                        ))}
                    </At>
                </Win>
            </div>
        </Stage>
    );
}
