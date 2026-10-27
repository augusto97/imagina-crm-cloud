import { At, C, Chip, Cursor, Keyframes, Stage, T, Win, primary } from '../kit';

/** La tabla como hoja de cálculo: un clic elige una celda, Mayús + clic elige el rango y abajo aparecen la suma y el promedio. */

const ROW_H = 28;
const COLS = [
    { h: 'Producto', w: 150 },
    { h: 'Stock', w: 80 },
    { h: 'Precio', w: 100 },
    { h: 'Categoría', w: 70 },
];
const ROWS: Array<[string, number, string, string, 'slate' | 'violet' | 'amber']> = [
    ['Café de origen', 34, '$ 34.000', 'Granos', 'amber'],
    ['Molino manual', 28, '$ 160.000', 'Equipos', 'slate'],
    ['Taza de cerámica', 9, '$ 22.000', 'Menaje', 'violet'],
    ['Filtros x100', 31, '$ 57.000', 'Insumos', 'slate'],
    ['Jarra para leche', 38, '$ 113.000', 'Menaje', 'violet'],
    ['Termo de acero', 4, '$ 107.000', 'Menaje', 'violet'],
];

const GX = 10;
const GY = 8;
const cellX = (c: number): number => GX + COLS.slice(0, c).reduce((s, x) => s + x.w, 0);
const cellY = (r: number): number => GY + 22 + r * ROW_H;
const SX = 30;
const SY = 46;

const CSS = `
@keyframes ls-active{0%,9%{opacity:0}11%,93%{opacity:1}98%,100%{opacity:0}}
@keyframes ls-range{0%,29%{height:${ROW_H}px;opacity:0}31%,93%{height:${ROW_H * 5}px;opacity:1}98%,100%{height:${ROW_H}px;opacity:0}}
@keyframes ls-bar{0%,33%{opacity:0;transform:translateY(10px)}38%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0;transform:translateY(10px)}}
@keyframes ls-shift{0%,24%{opacity:0;transform:translateY(4px)}27%,36%{opacity:1;transform:translateY(0)}40%,100%{opacity:0}}
@keyframes ls-cur{0%{transform:translate(380px,290px);opacity:0}5%{opacity:1}9%,12%{transform:translate(${SX + cellX(1) + 40}px,${SY + cellY(0) + 14}px)}26%,32%{transform:translate(${SX + cellX(1) + 40}px,${SY + cellY(4) + 14}px)}46%,88%{transform:translate(${SX + cellX(1) + 132}px,${SY + cellY(5) + 22}px);opacity:1}95%,100%{transform:translate(${SX + cellX(1) + 132}px,${SY + cellY(5) + 22}px);opacity:0}}
@keyframes ls-ring{0%,9%{opacity:0;transform:scale(.4)}10%{opacity:1;transform:scale(1)}13%,29%{opacity:0;transform:scale(1.6)}30%{opacity:1;transform:scale(1)}33%,100%{opacity:0;transform:scale(1.6)}}
`;

export default function LoteSeleccion(): JSX.Element {
    return (
        <Stage label="Una tabla de productos usada como hoja de cálculo: un clic elige la celda del stock, Mayús más clic elige cinco celdas hacia abajo, y una barra abajo muestra la suma 140 y el promedio 28." tint="amber">
            <Keyframes css={CSS} />
            <Win x={SX} y={20} w={420} h={262} title="Productos · Tabla">
                {/* Cabecera */}
                {COLS.map((c, i) => (
                    <At key={c.h} x={cellX(i)} y={GY} w={c.w} h={22} style={{ display: 'flex', alignItems: 'center', padding: '0 8px', background: C.muted, borderRight: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700} color={i === 1 ? primary() : C.mutedFg}>
                            {c.h}
                        </T>
                    </At>
                ))}
                {/* Filas */}
                {ROWS.map((r, ri) => (
                    <At key={r[0]} x={GX} y={cellY(ri)} w={400} h={ROW_H} style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: COLS[0]!.w, display: 'flex', alignItems: 'center', padding: '0 8px', borderRight: `1px solid ${C.border}` }}>
                            <T size={9.5} weight={600}>
                                {r[0]}
                            </T>
                        </span>
                        <span style={{ width: COLS[1]!.w, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', borderRight: `1px solid ${C.border}` }}>
                            <T size={9.5}>{r[1]}</T>
                        </span>
                        <span style={{ width: COLS[2]!.w, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px', borderRight: `1px solid ${C.border}` }}>
                            <T size={9.5}>{r[2]}</T>
                        </span>
                        <span style={{ width: COLS[3]!.w, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <Chip label={r[3]} t={r[4]} />
                        </span>
                    </At>
                ))}
                {/* Rango elegido */}
                <At x={cellX(1)} y={cellY(0)} w={COLS[1]!.w} h={ROW_H * 5} a="ls-range" style={{ background: primary(0.12), boxShadow: `inset 0 0 0 1.5px ${primary(0.7)}`, borderRadius: 2 }} />
                {/* Celda activa */}
                <At x={cellX(1)} y={cellY(0)} w={COLS[1]!.w} h={ROW_H} a="ls-active" style={{ boxShadow: `inset 0 0 0 2px ${primary()}`, borderRadius: 2 }}>
                    <span style={{ position: 'absolute', right: -3, bottom: -3, width: 6, height: 6, background: primary(), border: `1px solid ${C.card}` }} />
                </At>
                {/* Tecla Mayús */}
                <At x={cellX(1) + COLS[1]!.w + 6} y={cellY(4) + 2} a="ls-shift" style={{ opacity: 0, padding: '2px 7px', borderRadius: 5, border: `1px solid ${C.border}`, borderBottomWidth: 2, background: C.card, fontSize: 9, fontWeight: 700 }}>
                    Mayús ⇧
                </At>
                {/* Barra de la selección */}
                <At x={56} y={200} a="ls-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 12px', borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -12px rgba(15,23,42,.45)' }}>
                    <T size={9} weight={600} color={C.mutedFg}>
                        5 celdas
                    </T>
                    <T size={9.5} weight={700}>
                        Suma: 140
                    </T>
                    <T size={9.5} weight={700}>
                        Promedio: 28
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Ctrl+C copiar · Ctrl+V pegar
                    </T>
                </At>
            </Win>
            <Cursor a="ls-cur" click="ls-ring" rest={[SX + cellX(1) + 132, SY + cellY(5) + 22]} />
        </Stage>
    );
}
