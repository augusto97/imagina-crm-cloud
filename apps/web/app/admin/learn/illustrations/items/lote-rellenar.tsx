import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Rellenar hacia abajo: con «Cuota 1» y «Cuota 2» elegidas, el asa de la esquina continúa la serie y las fechas mes a mes. */

const ROW_H = 30;
const GX = 12;
const GY = 34;
const W = [140, 120, 140];
const DATA: Array<[string, string, string]> = [
    ['Cuota 1', '05/11/2026', '$ 250.000'],
    ['Cuota 2', '05/12/2026', '$ 250.000'],
    ['Cuota 3', '05/01/2027', '$ 250.000'],
    ['Cuota 4', '05/02/2027', '$ 250.000'],
    ['Cuota 5', '05/03/2027', '$ 250.000'],
];
const SX = 30;
const SY = 46;
const handleX = GX + W[0]! + W[1]! + W[2]!;
const rowY = (r: number): number => GY + r * ROW_H;

const CSS = `
@keyframes lr-sel{0%,8%{opacity:0}11%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes lr-prev{0%,22%{height:0;opacity:0}24%{opacity:1}44%,52%{height:${ROW_H * 3}px;opacity:1}56%,100%{height:${ROW_H * 3}px;opacity:0}}
@keyframes lr-ext{0%,53%{height:${ROW_H * 2}px}56%,94%{height:${ROW_H * 5}px}99%,100%{height:${ROW_H * 2}px}}
${[2, 3, 4].map((r, i) => `@keyframes lr-r${r}{0%,${54 + i * 3}%{opacity:0;transform:translateY(-4px)}${58 + i * 3}%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}`).join('\n')}
@keyframes lr-cur{0%{transform:translate(380px,290px);opacity:0}6%{opacity:1}14%,22%{transform:translate(${SX + handleX}px,${SY + rowY(2)}px)}44%,54%{transform:translate(${SX + handleX}px,${SY + rowY(5)}px);opacity:1}70%,90%{transform:translate(${SX + handleX + 14}px,${SY + rowY(5) + 18}px);opacity:1}96%,100%{transform:translate(${SX + handleX + 14}px,${SY + rowY(5) + 18}px);opacity:0}}
@keyframes lr-tip{0%,26%{opacity:0}30%,52%{opacity:1}56%,100%{opacity:0}}
`;

export default function LoteRellenar(): JSX.Element {
    return (
        <Stage label="Rellenar una serie: con las filas «Cuota 1» y «Cuota 2» elegidas, se arrastra el asa de la esquina tres filas hacia abajo y aparecen «Cuota 3», «Cuota 4» y «Cuota 5» con sus fechas mes a mes." tint="amber">
            <Keyframes css={CSS} />
            <Win x={SX} y={20} w={440} h={262} title="Pensiones · Estudiante Sofía Ríos">
                {['Concepto', 'Vence', 'Monto'].map((h, i) => (
                    <At key={h} x={GX + W.slice(0, i).reduce((s, x) => s + x, 0)} y={10} w={W[i]} h={22} style={{ display: 'flex', alignItems: 'center', padding: '0 9px', background: C.muted, borderRight: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    </At>
                ))}
                {DATA.map((d, r) => (
                    <At key={d[0]} x={GX} y={rowY(r)} w={W[0]! + W[1]! + W[2]!} h={ROW_H} style={{ display: 'flex', borderBottom: `1px solid ${C.border}` }}>
                        <span data-a={r >= 2 ? '' : undefined} style={{ display: 'flex', width: '100%', animationName: r >= 2 ? `lr-r${r}` : undefined }}>
                            {d.map((v, c) => (
                                <span key={c} style={{ width: W[c], display: 'flex', alignItems: 'center', padding: '0 9px', borderRight: `1px solid ${C.border}`, background: r >= 2 ? tone('amber', 0.1) : undefined }}>
                                    <T size={9.5} weight={c === 0 ? 600 : 500}>
                                        {v}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </At>
                ))}
                {/* Vista previa del relleno */}
                <At x={GX} y={rowY(2)} w={W[0]! + W[1]! + W[2]!} h={ROW_H * 3} a="lr-prev" style={{ opacity: 0, border: `1.5px dashed ${primary()}`, borderTop: 'none', borderRadius: '0 0 3px 3px' }} />
                {/* Selección */}
                <At x={GX} y={rowY(0)} w={W[0]! + W[1]! + W[2]!} h={ROW_H * 5} a="lr-sel" style={{ pointerEvents: 'none' }}>
                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, right: 0, height: ROW_H * 5, background: primary(0.08), boxShadow: `inset 0 0 0 2px ${primary()}`, borderRadius: 2, animationName: 'lr-ext' }}>
                        <span style={{ position: 'absolute', right: -4, bottom: -4, width: 8, height: 8, background: primary(), border: `1.5px solid ${C.card}`, borderRadius: 1 }} />
                    </span>
                </At>
                <At x={GX + 218} y={rowY(5) + 10} a="lr-tip" style={{ opacity: 0, padding: '4px 8px', borderRadius: 6, background: C.fg }}>
                    <T size={8.5} weight={600} color={C.card}>
                        Arrastra para rellenar hacia abajo
                    </T>
                </At>
                <At x={GX} y={rowY(5) + 12} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 7px', borderRadius: 5, border: `1px solid ${C.border}`, borderBottomWidth: 2, fontSize: 9, fontWeight: 700, background: C.card }}>Ctrl + D</span>
                    <T size={9} color={C.mutedFg}>
                        hace lo mismo con el teclado
                    </T>
                </At>
            </Win>
            <Cursor a="lr-cur" rest={[SX + handleX + 14, SY + rowY(5) + 18]} />
        </Stage>
    );
}
