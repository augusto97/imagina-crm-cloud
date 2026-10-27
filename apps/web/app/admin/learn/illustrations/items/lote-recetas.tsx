import { ArrowRight, Calculator, Ruler } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Una receta de edición masiva: Precio = Costo × 1,35 y después «Terminar en 900». */

const ROWS: Array<[string, string, string, string]> = [
    ['Café de origen 500 g', '$ 18.000', '$ 24.300', '$ 24.900'],
    ['Molino manual', '$ 41.000', '$ 55.350', '$ 55.900'],
    ['Taza de cerámica', '$ 9.800', '$ 13.230', '$ 13.900'],
    ['Prensa francesa', '$ 26.500', '$ 35.775', '$ 35.900'],
    ['Filtros x100', '$ 12.400', '$ 16.740', '$ 16.900'],
];

const CSS = `
@keyframes lrc-s1{0%,10%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}14%,36%{box-shadow:0 0 0 3px ${primary(0.18)};border-color:${primary()}}42%,100%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}}
@keyframes lrc-s2{0%,44%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}48%,70%{box-shadow:0 0 0 3px ${primary(0.18)};border-color:${primary()}}76%,100%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}}
@keyframes lrc-old{0%,16%{opacity:1}20%,96%{opacity:0}100%{opacity:1}}
${ROWS.map((_, i) => `@keyframes lrc-m${i}{0%,${18 + i * 3}%{opacity:0;transform:translateY(4px)}${22 + i * 3}%,${48 + i * 3}%{opacity:1;transform:translateY(0)}${52 + i * 3}%,100%{opacity:0}}
@keyframes lrc-f${i}{0%,${50 + i * 3}%{opacity:0;transform:translateY(4px)}${54 + i * 3}%,95%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}`).join('\n')}
`;

function Step({ y, n, icon, title, detail, a }: { y: number; n: number; icon: JSX.Element; title: string; detail: string; a: string }): JSX.Element {
    return (
        <At x={12} y={y} w={176} a={a} style={{ border: `1.5px solid ${C.border}`, borderRadius: 9, padding: '8px 9px', display: 'flex', gap: 7, background: C.card }}>
            <span style={{ width: 22, height: 22, borderRadius: 7, background: primary(0.14), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <T size={8} weight={700} color={C.mutedFg}>
                    CAMBIO {n}
                </T>
                <T size={9.5} weight={700}>
                    {title}
                </T>
                <T size={9} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    {detail}
                </T>
            </span>
        </At>
    );
}

export default function LoteRecetas(): JSX.Element {
    return (
        <Stage label="Una receta de edición masiva en dos cambios: primero el precio se calcula como el costo por 1,35 y después se redondea hacia arriba para terminar en 900; cada producto muestra el valor intermedio y el final." tint="violet">
            <Keyframes css={CSS} />
            <Win x={14} y={20} w={452} h={262} title="Edición masiva · Precio desde el costo">
                <Step y={12} n={1} icon={<Calculator size={12} />} title="Calcular con otras columnas" detail="Precio = Costo × 1,35" a="lrc-s1" />
                <At x={92} y={84} style={{ color: C.mutedFg, transform: 'rotate(90deg)' }}>
                    <ArrowRight size={14} />
                </At>
                <Step y={104} n={2} icon={<Ruler size={12} />} title="Redondear · Hacia arriba" detail="a múltiplos de 1.000, más −100: termina en 900" a="lrc-s2" />

                <At x={198} y={12} w={244} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 66px', padding: '5px 8px', background: C.muted }}>
                        {['Producto', 'Costo', 'Precio'].map((h) => (
                            <T key={h} size={8} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </div>
                    {ROWS.map((r, i) => (
                        <div key={r[0]} style={{ display: 'grid', gridTemplateColumns: '1fr 62px 66px', alignItems: 'center', padding: '0 8px', height: 36, borderTop: `1px solid ${C.border}` }}>
                            <T size={9} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r[0]}
                            </T>
                            <T size={9} color={C.mutedFg}>
                                {r[1]}
                            </T>
                            <span style={{ position: 'relative', height: 14 }}>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, height: 14, display: 'flex', alignItems: 'center', opacity: 0, animationName: 'lrc-old' }}>
                                    <T size={9} color={C.mutedFg}>
                                        —
                                    </T>
                                </span>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, height: 14, display: 'flex', alignItems: 'center', opacity: 0, animationName: `lrc-m${i}` }}>
                                    <T size={9} weight={600} color={tone('amber')}>
                                        {r[2]}
                                    </T>
                                </span>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, height: 14, display: 'flex', alignItems: 'center', animationName: `lrc-f${i}` }}>
                                    <T size={9.5} weight={800} color={tone('mint')}>
                                        {r[3]}
                                    </T>
                                </span>
                            </span>
                        </div>
                    ))}
                </At>
                <At x={12} y={192} w={176} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Idea
                    </T>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Cambia el costo y repite la receta: precios al día en un minuto.
                    </T>
                </At>
            </Win>
        </Stage>
    );
}
