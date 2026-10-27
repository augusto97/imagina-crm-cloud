import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Gantt de una obra con dependencias: al estirar la primera actividad dos días,
 * las que dependen de ella se corren solas (reprogramar en cadena) y la línea base muestra dónde estaban.
 */

const DAY = 20;
const X0 = 124;
const ROW = 38;
const Y0 = 34;
const dx = (d: number): number => X0 + d * DAY;
const rowY = (r: number): number => Y0 + r * ROW;

type Bar = { name: string; start: number; len: number; t: 'violet' | 'amber' | 'cyan' | 'mint'; milestone?: boolean };
const BARS: Bar[] = [
    { name: 'Fundición de placa', start: 0, len: 3, t: 'violet' },
    { name: 'Muros piso 2', start: 4, len: 3, t: 'amber' },
    { name: 'Instalación eléctrica', start: 8, len: 3, t: 'cyan' },
    { name: 'Entrega al cliente', start: 12, len: 0, t: 'mint', milestone: true },
];
const SHIFT = 2 * DAY;

const CSS = `
@keyframes vg-a{0%,16%{width:${3 * DAY - 4}px}36%,95%{width:${5 * DAY - 4}px}100%{width:${3 * DAY - 4}px}}
@keyframes vg-s1{0%,42%{transform:translateX(-${SHIFT}px)}50%,95%{transform:translateX(0)}100%{transform:translateX(-${SHIFT}px)}}
@keyframes vg-s2{0%,46%{transform:translateX(-${SHIFT}px)}54%,95%{transform:translateX(0)}100%{transform:translateX(-${SHIFT}px)}}
@keyframes vg-s3{0%,50%{transform:translateX(-${SHIFT}px)}58%,95%{transform:translateX(0)}100%{transform:translateX(-${SHIFT}px)}}
@keyframes vg-base{0%,60%{opacity:0}68%,93%{opacity:1}98%,100%{opacity:0}}
@keyframes vg-toast{0%,52%{opacity:0;transform:translateY(8px)}56%,84%{opacity:1;transform:translateY(0)}88%,100%{opacity:0;transform:translateY(8px)}}
@keyframes vg-cur{0%{transform:translate(300px,290px);opacity:0}6%{opacity:1}12%,16%{transform:translate(${20 + dx(3) - 2}px,${20 + 26 + rowY(0) + 16}px)}36%,44%{transform:translate(${20 + dx(5) - 2}px,${20 + 26 + rowY(0) + 16}px);opacity:1}54%,100%{transform:translate(${20 + dx(5) + 30}px,${20 + 26 + rowY(0) + 40}px);opacity:0}}
`;

/** Conector «A bloquea a B»: sale del fin del anterior y entra al inicio de esta barra (viaja con ella). */
function Arrow({ fromRow }: { fromRow: number }): JSX.Element {
    const h = ROW;
    return (
        <svg width={18} height={h + 4} style={{ position: 'absolute', left: -16, top: -h + 2, overflow: 'visible' }}>
            <path d={`M 2 ${8} L 8 ${8} L 8 ${h + 5} L 14 ${h + 5}`} fill="none" stroke={C.mutedFg} strokeWidth="1.3" strokeLinejoin="round" />
            <path d={`M 11 ${h + 2} L 15 ${h + 5} L 11 ${h + 8}`} fill="none" stroke={C.mutedFg} strokeWidth="1.3" strokeLinejoin="round" data-row={fromRow} />
        </svg>
    );
}

export default function VistasGantt(): JSX.Element {
    return (
        <Stage label="Un Gantt de obra con cuatro actividades conectadas por flechas: al estirar «Fundición de placa» dos días, las tres que dependen de ella se corren solas y debajo de cada barra queda en gris la línea base con las fechas originales." tint="violet">
            <Keyframes css={CSS} />
            <Win x={20} y={20} w={440} h={262} title="Actividades de obra · Gantt">
                {/* Cabecera de días */}
                <At x={10} y={6} w={110} h={20} style={{ display: 'flex', alignItems: 'center' }}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Actividad
                    </T>
                </At>
                {Array.from({ length: 15 }, (_, d) => (
                    <At key={d} x={dx(d)} y={6} w={DAY} h={20} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: d === 3 ? primary(0.14) : undefined, borderRadius: 4 }}>
                        <T size={7.5} weight={700} color={d === 3 ? primary() : C.mutedFg}>
                            {((26 + d - 1) % 31) + 1}
                        </T>
                    </At>
                ))}
                {/* Filas */}
                {BARS.map((b, r) => (
                    <At key={b.name} x={10} y={rowY(r)} w={418} h={ROW} style={{ borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                        <T size={9.5} weight={600}>
                            {b.name}
                        </T>
                    </At>
                ))}
                {/* Fin de semana y hoy */}
                {[5, 6, 12, 13].map((d) => (
                    <At key={d} x={dx(d)} y={Y0} w={DAY} h={ROW * 4} style={{ background: C.muted, opacity: 0.55 }} />
                ))}
                <At x={dx(3) + DAY / 2} y={Y0 - 4} w={1.5} h={ROW * 4 + 4} style={{ background: primary(0.7) }} />

                {/* Línea base (las fechas guardadas) */}
                {BARS.map((b, r) =>
                    b.milestone ? (
                        <At key={b.name} x={dx(b.start) + 5} y={rowY(r) + 26} w={9} h={9} a="vg-base" style={{ transform: 'rotate(45deg)', background: C.mutedFg, opacity: 1, borderRadius: 2 }} />
                    ) : (
                        <At key={b.name} x={dx(b.start) + 2} y={rowY(r) + 27} w={b.len * DAY - 4} h={5} a="vg-base" style={{ background: C.mutedFg, opacity: 1, borderRadius: 3 }} />
                    ),
                )}

                {/* Barras */}
                <At x={dx(0) + 2} y={rowY(0) + 9} w={5 * DAY - 4} h={15} a="vg-a" style={{ borderRadius: 5, background: tone('violet'), boxShadow: '0 2px 6px -3px rgba(15,23,42,.5)' }}>
                    <span style={{ position: 'absolute', right: 2, top: 3, width: 3, height: 9, borderRadius: 2, background: 'rgba(255,255,255,.75)' }} />
                </At>
                {BARS.slice(1).map((b, i) => {
                    const r = i + 1;
                    return (
                        <At key={b.name} x={dx(b.start + 2) + 2} y={rowY(r) + 9} w={b.milestone ? 15 : b.len * DAY - 4} h={15} a={`vg-s${r}`}>
                            <Arrow fromRow={r - 1} />
                            {b.milestone ? (
                                <span style={{ position: 'absolute', left: 1, top: 1, width: 12, height: 12, transform: 'rotate(45deg)', background: tone(b.t), borderRadius: 2 }} />
                            ) : (
                                <span style={{ position: 'absolute', inset: 0, borderRadius: 5, background: tone(b.t), boxShadow: '0 2px 6px -3px rgba(15,23,42,.5)' }} />
                            )}
                        </At>
                    );
                })}

                {/* Aviso */}
                <At x={110} y={196} a="vg-toast" style={{ opacity: 0, zIndex: 8, background: C.fg, borderRadius: 8, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 1, boxShadow: '0 10px 24px -10px rgba(15,23,42,.6)' }}>
                    <T size={9} weight={700} color={C.card}>
                        Fechas guardadas
                    </T>
                    <T size={8.5} color={C.card}>
                        También se corrieron 3 registros que dependen de este.
                    </T>
                </At>
            </Win>
            <Cursor a="vg-cur" rest={[20 + dx(5) + 30, 20 + 26 + rowY(0) + 40]} />
        </Stage>
    );
}
