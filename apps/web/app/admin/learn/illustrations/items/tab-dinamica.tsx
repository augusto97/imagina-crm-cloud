import { At, C, Keyframes, Stage, T, Win, tone } from '../kit';

/**
 * Tabla dinámica: filas por ciudad, columnas por mes, la suma vendida en cada
 * cruce, totales por fila y columna, y un mapa de calor que resalta solo dónde
 * se vende más.
 */

const COLS = ['Jul', 'Ago', 'Sep', 'Oct'];
const ROWS: Array<{ city: string; v: number[] }> = [
    { city: 'Bogotá', v: [8.2, 9.1, 7.4, 11.3] },
    { city: 'Medellín', v: [5.6, 6.8, 8.9, 7.2] },
    { city: 'Cali', v: [3.1, 2.4, 4.6, 5.0] },
    { city: 'Barranquilla', v: [1.8, 3.3, 2.2, 3.9] },
];
const MAX = 11.3;
const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

const rowKeys = ROWS.map(
    (_, i) => `@keyframes td-row${i}{0%,${6 + i * 7}%{opacity:0;transform:translateX(-6px)}${14 + i * 7}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`,
).join('\n');

const CSS = `
${rowKeys}
@keyframes td-heat{0%,46%{opacity:0}58%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes td-tot{0%,40%{opacity:0;transform:scale(.9)}46%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes td-best{0%,62%{box-shadow:inset 0 0 0 0 transparent}66%,86%{box-shadow:inset 0 0 0 2px ${tone('blue')}}92%,100%{box-shadow:inset 0 0 0 0 transparent}}
`;

const CW = 62; // ancho de columna de valores
const LW = 80; // ancho de la columna de nombres
const RH = 26;

export default function TabDinamica(): JSX.Element {
    const totals = COLS.map((_, k) => ROWS.reduce((a, r) => a + r.v[k]!, 0));
    const grand = totals.reduce((a, b) => a + b, 0);
    return (
        <Stage label="Una tabla dinámica con las ventas por ciudad y por mes: totales por fila, por columna y general, y un mapa de calor que pinta más intenso donde más se vende." tint="blue">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={24} y={16} w={432} h={268} title="Ventas por ciudad y mes">
                    <At x={14} y={9} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <T size={9.5} weight={700}>
                            Tabla dinámica
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Filas: Ciudad · Columnas: Mes · Suma de Valor (millones)
                        </T>
                    </At>
                    <At x={14} y={32} w={LW + CW * 5} h={RH * 6}>
                        {/* Encabezado */}
                        <div style={{ display: 'flex', height: RH, alignItems: 'center', borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ width: LW }} />
                            {[...COLS, 'Total'].map((c) => (
                                <span key={c} style={{ width: CW, textAlign: 'right', paddingRight: 8 }}>
                                    <T size={8} weight={700} color={C.mutedFg}>
                                        {c}
                                    </T>
                                </span>
                            ))}
                        </div>
                        {ROWS.map((r, i) => (
                            <div
                                key={r.city}
                                data-a=""
                                style={{ display: 'flex', height: RH, alignItems: 'center', borderBottom: `1px solid ${C.border}`, animationName: `td-row${i}` }}
                            >
                                <span style={{ width: LW }}>
                                    <T size={8.5} weight={600}>
                                        {r.city}
                                    </T>
                                </span>
                                {r.v.map((v, k) => (
                                    <span key={k} style={{ position: 'relative', width: CW, height: RH - 6, margin: '0 1px' }}>
                                        <span
                                            data-a=""
                                            style={{
                                                position: 'absolute',
                                                inset: 0,
                                                borderRadius: 4,
                                                background: tone('blue', 0.12 + (v / MAX) * 0.68),
                                                animationName: v === MAX ? 'td-heat, td-best' : 'td-heat',
                                            }}
                                        />
                                        <span style={{ position: 'absolute', right: 7, top: 4 }}>
                                            <T size={8.5} weight={600} color={v / MAX > 0.6 ? '#fff' : C.fg}>
                                                {fmt(v)}
                                            </T>
                                        </span>
                                    </span>
                                ))}
                                <span data-a="" style={{ width: CW, textAlign: 'right', paddingRight: 8, animationName: 'td-tot' }}>
                                    <T size={8.5} weight={800}>
                                        {fmt(r.v.reduce((a, b) => a + b, 0))}
                                    </T>
                                </span>
                            </div>
                        ))}
                        <div data-a="" style={{ display: 'flex', height: RH, alignItems: 'center', background: C.muted, borderRadius: 5, animationName: 'td-tot' }}>
                            <span style={{ width: LW, paddingLeft: 6 }}>
                                <T size={8.5} weight={800}>
                                    Total
                                </T>
                            </span>
                            {totals.map((t, k) => (
                                <span key={k} style={{ width: CW, textAlign: 'right', paddingRight: 8 }}>
                                    <T size={8.5} weight={800}>
                                        {fmt(t)}
                                    </T>
                                </span>
                            ))}
                            <span style={{ width: CW, textAlign: 'right', paddingRight: 8 }}>
                                <T size={9} weight={800} color={tone('blue')}>
                                    {fmt(grand)}
                                </T>
                            </span>
                        </div>
                    </At>
                    <At x={14} y={202} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <T size={7.5} color={C.mutedFg}>
                            Menos
                        </T>
                        {[0.15, 0.3, 0.45, 0.6, 0.8].map((o) => (
                            <span key={o} style={{ width: 16, height: 8, borderRadius: 2, background: tone('blue', o) }} />
                        ))}
                        <T size={7.5} color={C.mutedFg}>
                            Más
                        </T>
                    </At>
                </Win>
            </div>
        </Stage>
    );
}
