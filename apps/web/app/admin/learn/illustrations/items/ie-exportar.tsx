import { Download, FileSpreadsheet } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Exportar a Excel: el diálogo elige formato y columnas, se descarga el
 * archivo y se abre con montos, fechas y opciones legibles.
 */

const CSS = `
@keyframes ex-dlg{0%,42%{opacity:1;transform:scale(1)}47%,92%{opacity:0;transform:scale(.96)}97%,100%{opacity:1;transform:scale(1)}}
@keyframes ex-ck{0%,18%{background:transparent;border-color:${C.mutedFg}}21%,100%{background:${primary()};border-color:${primary()}}}
@keyframes ex-ckm{0%,18%{opacity:0}21%,100%{opacity:1}}
@keyframes ex-press{0%,36%{transform:scale(1)}38%{transform:scale(.93)}41%,100%{transform:scale(1)}}
@keyframes ex-chip{0%,38%{opacity:0;transform:translate(0,0)}40%{opacity:1;transform:translate(0,0)}45%{opacity:1;transform:translate(0,-30px)}48%,100%{opacity:0;transform:translate(0,-34px)}}
@keyframes ex-sheet{0%,47%{opacity:0;transform:translateY(10px) scale(.97)}52%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes ex-cur{0%{transform:translate(300px,290px);opacity:0}5%{opacity:1}14%,20%{transform:translate(114px,201px)}33%,38%{transform:translate(333px,262px)}48%,56%{transform:translate(330px,282px);opacity:1}62%,100%{opacity:0;transform:translate(330px,282px)}}
@keyframes ex-ring{0%,17%{opacity:0;transform:scale(.4)}19%{opacity:1;transform:scale(1)}23%{opacity:0;transform:scale(1.6)}35%{opacity:0;transform:scale(.4)}37%{opacity:1;transform:scale(1)}41%,100%{opacity:0;transform:scale(1.6)}}
`;

function Check({ on, a }: { on?: boolean; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ width: 11, height: 11, borderRadius: 3, border: `1.5px solid ${on ? primary() : C.mutedFg}`, background: on ? primary() : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: a ? 'ex-ck' : undefined, flexShrink: 0 }}>
            <span data-a={a ? '' : undefined} style={{ color: C.primaryFg, fontSize: 7, fontWeight: 800, lineHeight: 1, animationName: a ? 'ex-ckm' : undefined, opacity: on || a ? undefined : 0 }}>
                ✓
            </span>
        </span>
    );
}

const COLS: Array<[string, boolean]> = [
    ['Razón social', true],
    ['NIT / RUT', true],
    ['Ciudad', true],
    ['Monto mensual', true],
    ['Próximo cobro', true],
    ['Notas internas', false],
];

const XL = [
    ['ID', 'Razón social', 'Ciudad', 'Monto mensual', 'Próximo cobro'],
    ['101', 'Clínica Norte', 'Bogotá', '$ 450.000', '05/11/2026'],
    ['102', 'Ferretería El Sol', 'Pereira', '$ 380.000', '10/11/2026'],
    ['103', 'Colegio Andino', 'Bogotá', '$ 520.000', '15/11/2026'],
    ['104', 'Óptica Visión', 'Medellín', '$ 290.000', '20/11/2026'],
    ['105', 'Gimnasio Fénix', 'Cali', '$ 610.000', '25/11/2026'],
];

export default function IeExportar(): JSX.Element {
    return (
        <Stage label="En el diálogo de exportar se elige Excel, se marca incluir el ID de cada registro y se descarga; el archivo se abre con los montos y las fechas como números y fechas reales." tint="mint">
            <Keyframes css={CSS} />
            {/* Diálogo */}
            <At x={96} y={16} w={288} h={268} a="ex-dlg" style={{ zIndex: 3, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -18px rgba(15,23,42,.6)', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <T size={10.5} weight={700}>
                    Exportar «Clientes al día»
                </T>
                <T size={7.5} color={C.mutedFg}>
                    Se exportan los registros de la vista, con su búsqueda y su orden.
                </T>
                <T size={7.5} weight={700}>
                    Formato
                </T>
                <span style={{ display: 'flex', gap: 6 }}>
                    <span style={{ flex: 1, height: 22, borderRadius: 6, border: `1.5px solid ${primary()}`, background: primary(0.08), display: 'flex', alignItems: 'center', gap: 4, padding: '0 7px' }}>
                        <FileSpreadsheet size={10} color={tone('mint')} />
                        <T size={8} weight={700}>
                            Excel (.xlsx)
                        </T>
                    </span>
                    <span style={{ flex: 1, height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                        <T size={8}>CSV</T>
                    </span>
                </span>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <T size={7.5} weight={700}>
                        Columnas
                    </T>
                    <T size={7} color={primary()}>
                        Todas · Ninguna
                    </T>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {COLS.map(([c, on]) => (
                        <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Check on={on} />
                            <T size={7.5} color={on ? C.fg : C.mutedFg}>
                                {c}
                            </T>
                        </span>
                    ))}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <Check />
                    <T size={7.5}>Incluir subtareas</T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Check a="ex-ck" />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={7.5}>Incluir el ID de cada registro</T>
                        <T size={6.5} color={C.mutedFg}>
                            Para editarlo y cargarlo con «Actualizar desde un archivo».
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 'auto' }}>
                    <Btn kind="outline" label="Cancelar" style={{ height: 20, fontSize: 8 }} />
                    <span data-a="" style={{ display: 'flex', animationName: 'ex-press' }}>
                        <Btn label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Download size={9} />Descargar Excel</span>} style={{ height: 20, fontSize: 8 }} />
                    </span>
                </span>
            </At>
            {/* Archivo descargado */}
            <At x={282} y={256} a="ex-chip" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 24px -10px rgba(15,23,42,.6)' }}>
                    <FileSpreadsheet size={11} color={tone('mint')} />
                    <T size={7.5} weight={700}>
                        Clientes al día.xlsx
                    </T>
                </span>
            </At>
            {/* La planilla abierta */}
            <At x={30} y={36} w={420} h={228} a="ex-sheet" style={{ opacity: 0, zIndex: 4, background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 10px', background: tone('mint'), color: '#fff' }}>
                    <FileSpreadsheet size={11} />
                    <T size={8.5} weight={700} color="#fff">
                        Clientes al día.xlsx
                    </T>
                </span>
                {XL.map((r, i) => (
                    <span key={i} style={{ display: 'flex', height: 30, borderBottom: `1px solid ${C.border}`, background: i === 0 ? C.muted : 'transparent' }}>
                        <span style={{ width: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: `1px solid ${C.border}`, background: C.muted }}>
                            <T size={7} color={C.mutedFg}>
                                {i + 1}
                            </T>
                        </span>
                        {r.map((c, j) => (
                            <span key={j} style={{ width: [40, 110, 72, 90, 86][j], display: 'flex', alignItems: 'center', justifyContent: j >= 3 && i > 0 ? 'flex-end' : 'flex-start', padding: '0 8px', borderRight: `1px solid ${C.border}` }}>
                                <T size={8} weight={i === 0 ? 700 : 500}>
                                    {c}
                                </T>
                            </span>
                        ))}
                    </span>
                ))}
            </At>
            <Cursor a="ex-cur" click="ex-ring" rest={[330, 282]} />
        </Stage>
    );
}
