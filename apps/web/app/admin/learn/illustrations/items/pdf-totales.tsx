import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Tabla de ítems y totales de una cotización: cada línea calcula su total
 * (cantidad × precio − descuento), y las filas de totales se encadenan solas:
 * subtotal, descuentos, base, IVA 19 % y total, con el monto en letras.
 */

const PAPER = '#ffffff';
const INK = '#1f2937';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';

const ITEMS: Array<[string, string, string, string, string]> = [
    ['Mantenimiento de equipos', '2', '$ 180.000', '0 %', '$ 360.000'],
    ['Repuesto · válvula', '4', '$ 45.000', '10 %', '$ 162.000'],
    ['Visita técnica', '1', '$ 90.000', '0 %', '$ 90.000'],
];
const TOTALS: Array<[string, string, boolean?]> = [
    ['Subtotal', '$ 630.000'],
    ['Descuentos', '− $ 18.000'],
    ['Base gravable', '$ 612.000'],
    ['IVA 19 %', '$ 116.280'],
    ['TOTAL', '$ 728.280', true],
];

const lineKeys = ITEMS.map(
    (_, i) => `@keyframes pt-l${i}{0%,${12 + i * 7}%{opacity:0;transform:translateX(8px)}${18 + i * 7}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`,
).join('\n');
const totKeys = TOTALS.map(
    (_, i) => `@keyframes pt-t${i}{0%,${42 + i * 5}%{opacity:0;transform:translateY(5px)}${47 + i * 5}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}`,
).join('\n');

const CSS = `
${lineKeys}
${totKeys}
@keyframes pt-calc{0%,8%{opacity:0;transform:translateY(-4px)}12%,38%{opacity:1;transform:translateY(0)}42%,100%{opacity:0;transform:translateY(0)}}
@keyframes pt-col{0%,8%{background:transparent}12%,38%{background:${primary(0.1)}}42%,100%{background:transparent}}
@keyframes pt-words{0%,72%{opacity:0}78%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pt-rowc{0%,64%{background:transparent}68%,86%{background:${primary(0.12)}}92%,100%{background:transparent}}
`;

const COLS = [150, 30, 62, 36, 62];

export default function PdfTotales(): JSX.Element {
    return (
        <Stage label="La tabla de ítems de una cotización calcula el total de cada línea (cantidad por precio menos el descuento) y debajo se encadenan solas las filas de subtotal, base gravable, IVA 19 % y total, con el monto en letras." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At
                    x={50}
                    y={18}
                    w={380}
                    h={266}
                    style={{ background: PAPER, borderRadius: 4, boxShadow: '0 18px 40px -16px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.06)', padding: '14px 18px' }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <T size={10} weight={800} color={primary()}>
                            COTIZACIÓN COT-0017
                        </T>
                        <T size={6.5} color={SOFT}>
                            Válida hasta el 22/10/2026
                        </T>
                    </div>
                    {/* Encabezado de la tabla */}
                    <div style={{ display: 'flex', marginTop: 12, height: 16, alignItems: 'center', background: primary(0.12), borderRadius: 2, padding: '0 4px' }}>
                        {['Descripción', 'Cant.', 'Precio', 'Desc.', 'Total'].map((h, i) => (
                            <span
                                key={h}
                                data-a={i === 4 ? '' : undefined}
                                style={{ width: COLS[i], textAlign: i === 0 ? 'left' : 'right', animationName: i === 4 ? 'pt-col' : undefined }}
                            >
                                <T size={6.5} weight={800} color={INK}>
                                    {h}
                                </T>
                            </span>
                        ))}
                    </div>
                    {ITEMS.map((row, r) => (
                        <div
                            key={row[0]}
                            data-a=""
                            style={{ display: 'flex', height: 17, alignItems: 'center', borderBottom: `1px solid ${LINE}`, padding: '0 4px', animationName: `pt-l${r}` }}
                        >
                            {row.map((c, i) => (
                                <span key={i} style={{ width: COLS[i], textAlign: i === 0 ? 'left' : 'right' }}>
                                    <T size={7} weight={i === 4 ? 700 : 500} color={INK}>
                                        {c}
                                    </T>
                                </span>
                            ))}
                        </div>
                    ))}
                    {/* Fórmula de la columna calculada */}
                    <At
                        x={246}
                        y={102}
                        a="pt-calc"
                        style={{ opacity: 0, background: C.fg, borderRadius: 6, padding: '4px 7px', boxShadow: '0 8px 20px -10px rgba(15,23,42,.6)' }}
                    >
                        <T size={7} weight={700} color={C.card}>
                            Total = Cant. × Precio − Desc. %
                        </T>
                    </At>
                    {/* Totales */}
                    <div style={{ marginTop: 9, marginLeft: 'auto', width: 190, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {TOTALS.map(([k, v, emph], i) => (
                            <div
                                key={k}
                                data-a=""
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    height: emph ? 19 : 14,
                                    padding: '0 6px',
                                    borderRadius: 3,
                                    background: emph ? primary(0.14) : 'transparent',
                                    borderBottom: emph ? 'none' : `1px solid ${LINE}`,
                                    animationName: k === 'IVA 19 %' ? `pt-t${i}, pt-rowc` : `pt-t${i}`,
                                }}
                            >
                                <T size={emph ? 8 : 7} weight={emph ? 800 : 600} color={emph ? INK : SOFT}>
                                    {k}
                                </T>
                                <T size={emph ? 9.5 : 7.5} weight={emph ? 800 : 600} color={INK}>
                                    {v}
                                </T>
                            </div>
                        ))}
                    </div>
                    <div data-a="" style={{ marginTop: 7, animationName: 'pt-words' }}>
                        <T size={7} weight={600} color={INK} style={{ display: 'block', whiteSpace: 'normal' }}>
                            Son: setecientos veintiocho mil doscientos ochenta pesos M/CTE.
                        </T>
                        <span
                            style={{
                                display: 'inline-flex',
                                marginTop: 5,
                                height: 15,
                                alignItems: 'center',
                                padding: '0 6px',
                                borderRadius: 4,
                                background: tone('violet', 0.12),
                                border: `1px dashed ${tone('violet', 0.5)}`,
                            }}
                        >
                            <T size={6.5} weight={700} color={tone('violet')}>
                                {'{{totales.total|pesos}}'}
                            </T>
                        </span>
                    </div>
                </At>
            </div>
        </Stage>
    );
}
