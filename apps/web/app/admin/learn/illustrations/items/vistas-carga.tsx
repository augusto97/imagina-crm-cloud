import { At, Avatar, C, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/** Carga de trabajo: Ana se pasa de su capacidad la semana 2; al arrastrar un plano a la fila de Juan, las dos celdas vuelven a estar bien. */

type Tn = 'mint' | 'amber' | 'rose' | 'slate';
const toneOf = (h: number, cap = 40): Tn => (h === 0 ? 'slate' : h > cap ? 'rose' : h / cap >= 0.8 ? 'amber' : 'mint');

const COL_W = 80;
const X0 = 108;
const Y0 = 34;
const ROW = 46;

const PEOPLE: Array<{ who: string; ini: string; t: 'violet' | 'amber' | 'cyan'; hours: number[] }> = [
    { who: 'Ana', ini: 'AM', t: 'violet', hours: [28, 36, 34, 12] },
    { who: 'Juan', ini: 'JP', t: 'amber', hours: [30, 26, 22, 26] },
    { who: 'Luis', ini: 'LG', t: 'cyan', hours: [10, 33, 38, 20] },
];
// Antes de reasignar: Ana 48 h y Juan 14 h en la semana 2.
const BEFORE: Record<string, number> = { 'Ana-1': 48, 'Juan-1': 14 };

const pct = (h: number): number => Math.min(h / 40, 1.15) * 100;

const CSS = `
@keyframes vw-ana-a{0%,44%{opacity:1}48%,95%{opacity:0}100%{opacity:1}}
@keyframes vw-ana-b{0%,44%{opacity:0}48%,95%{opacity:1}100%{opacity:0}}
@keyframes vw-chip{0%,10%{opacity:0;transform:translate(0,0) scale(.9)}16%{opacity:1;transform:translate(0,-4px) scale(1)}22%{transform:translate(0,-4px) rotate(-2deg)}40%{opacity:1;transform:translate(0,${ROW - 4}px) rotate(-2deg)}46%,100%{opacity:0;transform:translate(0,${ROW}px) scale(.8)}}
@keyframes vw-cur{0%{transform:translate(260px,290px);opacity:0}6%{opacity:1}12%,22%{transform:translate(${20 + X0 + COL_W + 46}px,${20 + 26 + Y0 + 26}px)}40%,46%{transform:translate(${20 + X0 + COL_W + 46}px,${20 + 26 + Y0 + ROW + 26}px);opacity:1}60%,100%{transform:translate(${20 + X0 + COL_W + 70}px,${20 + 26 + Y0 + ROW + 60}px);opacity:0}}
@keyframes vw-toast{0%,46%{opacity:0;transform:translateY(8px)}50%,82%{opacity:1;transform:translateY(0)}86%,100%{opacity:0;transform:translateY(8px)}}
@keyframes vw-ring{0%,44%{box-shadow:0 0 0 0 transparent}47%,56%{box-shadow:0 0 0 2px ${tone('mint', 0.6)}}62%,100%{box-shadow:0 0 0 0 transparent}}
`;

function CellView({ h }: { h: number }): JSX.Element {
    const t = toneOf(h);
    return (
        <span style={{ position: 'absolute', inset: 0, borderRadius: 7, background: tone(t, 0.12), display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, padding: '0 8px' }}>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                <T size={10.5} weight={700} color={t === 'slate' ? C.mutedFg : C.fg}>
                    {h} h
                </T>
                <T size={8} color={C.mutedFg}>
                    de 40
                </T>
            </span>
            <span style={{ position: 'relative', height: 5, borderRadius: 3, background: C.muted }}>
                <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct(h)}%`, maxWidth: '100%', borderRadius: 3, background: tone(t) }} />
            </span>
        </span>
    );
}

export default function VistasCarga(): JSX.Element {
    return (
        <Stage label="La carga de trabajo por semana de tres personas frente a 40 horas de capacidad. Ana tiene 48 horas en la semana 2 (en rojo); al arrastrar un plano de 12 horas a la fila de Juan, Ana baja a 36 y Juan sube a 26." tint="amber">
            <Keyframes css={CSS} />
            <Win x={20} y={20} w={440} h={262} title="Entregables · Carga de trabajo">
                {/* Cabecera */}
                <At x={10} y={8} w={90} h={20} style={{ display: 'flex', alignItems: 'center' }}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Persona
                    </T>
                </At>
                {['Sem. 26 oct', 'Sem. 2 nov', 'Sem. 9 nov', 'Sem. 16 nov'].map((w, i) => (
                    <At key={w} x={X0 + i * COL_W} y={8} w={COL_W} h={20} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8.5} weight={700} color={C.mutedFg}>
                            {w}
                        </T>
                    </At>
                ))}
                {PEOPLE.map((p, r) => (
                    <At key={p.who} x={10} y={Y0 + r * ROW} w={420} h={ROW} style={{ borderTop: `1px solid ${C.border}` }}>
                        <span style={{ position: 'absolute', left: 0, top: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Avatar initials={p.ini} t={p.t} size={22} />
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <T size={9.5} weight={600}>
                                    {p.who}
                                </T>
                                <T size={7.5} color={C.mutedFg}>
                                    8 h × 5 días
                                </T>
                            </span>
                        </span>
                    </At>
                ))}
                {/* Celdas */}
                {PEOPLE.map((p, r) =>
                    p.hours.map((h, c) => {
                        const key = `${p.who}-${c}`;
                        const before = BEFORE[key];
                        return (
                            <At key={key} x={X0 + c * COL_W + 3} y={Y0 + r * ROW + 5} w={COL_W - 6} h={ROW - 10} a={before !== undefined ? 'vw-ring' : undefined} style={{ borderRadius: 7 }}>
                                {before === undefined ? (
                                    <CellView h={h} />
                                ) : (
                                    <>
                                        <span data-a="" style={{ position: 'absolute', inset: 0, opacity: 0, animationName: 'vw-ana-a' }}>
                                            <CellView h={before} />
                                        </span>
                                        <span data-a="" style={{ position: 'absolute', inset: 0, animationName: 'vw-ana-b' }}>
                                            <CellView h={h} />
                                        </span>
                                    </>
                                )}
                            </At>
                        );
                    }),
                )}

                {/* El registro que se reasigna */}
                <At x={X0 + COL_W + 6} y={Y0 + 8} a="vw-chip" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${tone('violet')}`, borderRadius: 6, padding: '5px 7px', display: 'flex', flexDirection: 'column', gap: 1, boxShadow: '0 12px 22px -10px rgba(15,23,42,.5)' }}>
                    <T size={9} weight={700}>
                        Plano de fachada
                    </T>
                    <T size={8} color={C.mutedFg}>
                        12 h · vence 6 nov
                    </T>
                </At>

                {/* Leyenda */}
                <At x={10} y={Y0 + 3 * ROW + 10} w={420} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {(
                        [
                            ['Libre', 'slate'],
                            ['Con espacio', 'mint'],
                            ['Cerca del límite', 'amber'],
                            ['Por encima de la capacidad', 'rose'],
                        ] as const
                    ).map(([l, t]) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 3, background: tone(t) }} />
                            <T size={8} color={C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                </At>

                <At x={120} y={204} a="vw-toast" style={{ opacity: 0, zIndex: 8, background: C.fg, borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 10, alignItems: 'center', boxShadow: '0 10px 24px -10px rgba(15,23,42,.6)' }}>
                    <T size={9} weight={600} color={C.card}>
                        «Plano de fachada» → Juan
                    </T>
                    <T size={9} weight={700} color={tone('cyan')}>
                        Deshacer
                    </T>
                </At>
            </Win>
            <Cursor a="vw-cur" rest={[20 + X0 + COL_W + 70, 20 + 26 + Y0 + ROW + 60]} />
        </Stage>
    );
}
