import { ChevronDown, Copy, CornerDownRight, MoveRight, Trash2, Wand2, X } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, Win, primary } from '../kit';

/** Mover en lote: tres tareas sueltas se eligen y pasan a ser subtareas de «Lanzamiento del sitio». */

const ROW_H = 30;
const ROWS: Array<{ n: string; s: string; t: 'blue' | 'amber' | 'slate'; sub?: boolean }> = [
    { n: 'Lanzamiento del sitio', s: 'En curso', t: 'blue' },
    { n: 'Diseñar la portada', s: 'Pendiente', t: 'amber', sub: true },
    { n: 'Escribir los textos', s: 'Pendiente', t: 'amber', sub: true },
    { n: 'Probar formularios', s: 'Pendiente', t: 'amber', sub: true },
    { n: 'Campaña de redes', s: 'Pendiente', t: 'slate' },
];
const GY = 10;

const CSS = `
${[1, 2, 3].map((r, i) => `@keyframes les-c${r}{0%,${4 + i * 4}%{background:transparent;border-color:${C.border}}${6 + i * 4}%,58%{background:${primary()};border-color:${primary()}}62%,100%{background:transparent;border-color:${C.border}}}`).join('\n')}
@keyframes les-tick{0%,5%{opacity:0}7%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes les-rowsel{0%,5%{background:transparent}8%,58%{background:${primary(0.08)}}62%,100%{background:transparent}}
@keyframes les-bar{0%,14%{opacity:0;transform:translateY(10px)}18%,56%{opacity:1;transform:translateY(0)}60%,100%{opacity:0;transform:translateY(10px)}}
@keyframes les-pop{0%,28%{opacity:0;transform:translateY(6px)}32%,52%{opacity:1;transform:translateY(0)}56%,100%{opacity:0}}
@keyframes les-indent{0%,56%{transform:translateX(0)}62%,95%{transform:translateX(22px)}100%{transform:translateX(0)}}
@keyframes les-sub{0%,57%{opacity:0;width:0}62%,95%{opacity:1;width:14px}100%{opacity:0;width:0}}
@keyframes les-chev{0%,58%{opacity:0;transform:scale(.4)}63%,95%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes les-toast{0%,62%{opacity:0;transform:translateY(8px)}66%,90%{opacity:1;transform:translateY(0)}94%,100%{opacity:0}}
@keyframes les-cur{0%{transform:translate(60px,290px);opacity:0}3%{opacity:1}5%{transform:translate(45px,${46 + GY + 22 + ROW_H + 15}px)}9%{transform:translate(45px,${46 + GY + 22 + ROW_H * 2 + 15}px)}13%,16%{transform:translate(45px,${46 + GY + 22 + ROW_H * 3 + 15}px)}26%,30%{transform:translate(272px,258px)}48%,52%{transform:translate(345px,234px)}66%,88%{transform:translate(420px,170px);opacity:1}94%,100%{transform:translate(420px,170px);opacity:0}}
@keyframes les-ring{0%,4%{opacity:0;transform:scale(.4)}5%{opacity:1;transform:scale(1)}7%,8%{opacity:0;transform:scale(1.6)}9%{opacity:1;transform:scale(1)}11%,12%{opacity:0;transform:scale(1.6)}13%{opacity:1;transform:scale(1)}15%,27%{opacity:0;transform:scale(1.6)}28%{opacity:1;transform:scale(1)}31%,49%{opacity:0;transform:scale(1.6)}50%{opacity:1;transform:scale(1)}53%,100%{opacity:0;transform:scale(1.6)}}
`;

export default function LoteEstructura(): JSX.Element {
    return (
        <Stage label="Mover en lote: se marcan tres tareas, en la barra de acciones se toca «Mover» y se elige «Lanzamiento del sitio»; las tres quedan como sus subtareas, con sangría debajo de él." tint="cyan">
            <Keyframes css={CSS} />
            <Win x={20} y={20} w={440} h={262} title="Tareas · Tabla">
                <At x={10} y={GY} w={420} h={22} style={{ display: 'flex', alignItems: 'center', background: C.muted, borderRadius: 6, padding: '0 8px 0 36px', gap: 0 }}>
                    <T size={8.5} weight={700} color={C.mutedFg} style={{ flex: 1 }}>
                        Tarea
                    </T>
                    <T size={8.5} weight={700} color={C.mutedFg} style={{ width: 90 }}>
                        Estado
                    </T>
                </At>
                {ROWS.map((r, i) => (
                    <At key={r.n} x={10} y={GY + 22 + i * ROW_H} w={420} h={ROW_H} a={r.sub ? 'les-rowsel' : undefined} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}`, padding: '0 8px' }}>
                        <span
                            data-a={r.sub ? '' : undefined}
                            style={{ position: 'relative', width: 12, height: 12, borderRadius: 3, border: `1px solid ${C.border}`, marginRight: 16, flexShrink: 0, animationName: r.sub ? `les-c${i}` : undefined }}
                        >
                            {r.sub && (
                                <span data-a="" style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 9, lineHeight: '11px', textAlign: 'center', opacity: 0, animationName: 'les-tick' }}>
                                    ✓
                                </span>
                            )}
                        </span>
                        <span data-a={r.sub ? '' : undefined} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, transform: r.sub ? 'translateX(22px)' : undefined, animationName: r.sub ? 'les-indent' : undefined }}>
                            {i === 0 && (
                                <span data-a="" style={{ display: 'flex', color: C.mutedFg, animationName: 'les-chev' }}>
                                    <ChevronDown size={11} />
                                </span>
                            )}
                            {r.sub && (
                                <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: 14, color: C.mutedFg, animationName: 'les-sub' }}>
                                    <CornerDownRight size={11} />
                                </span>
                            )}
                            <T size={9.5} weight={600}>
                                {r.n}
                            </T>
                            {i === 0 && (
                                <span data-a="" style={{ marginLeft: 6, animationName: 'les-chev' }}>
                                    <T size={8.5} weight={600} color={C.mutedFg}>
                                        3 subtareas
                                    </T>
                                </span>
                            )}
                        </span>
                        <span style={{ width: 90 }}>
                            <Chip label={r.s} t={r.t} />
                        </span>
                    </At>
                ))}

                {/* Barra de acciones */}
                <At x={40} y={200} a="les-bar" style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -12px rgba(15,23,42,.5)', zIndex: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, fontWeight: 700, color: primary(), background: primary(0.12), borderRadius: 6, padding: '2px 7px' }}>
                        3 seleccionados <X size={9} />
                    </span>
                    {[
                        [<Wand2 key="w" size={10} />, 'Editar en lote'],
                        [<MoveRight key="m" size={10} />, 'Mover'],
                        [<Copy key="c" size={10} />, 'Duplicar'],
                        [<Trash2 key="t" size={10} />, 'Eliminar'],
                    ].map(([ic, l]) => (
                        <span key={l as string} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 600, color: l === 'Eliminar' ? C.destructive : C.fg }}>
                            {ic}
                            {l}
                        </span>
                    ))}
                </At>

                {/* Mover como subtareas */}
                <At x={160} y={104} w={200} a="les-pop" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 18px 36px -14px rgba(15,23,42,.6)' }}>
                    <T size={10} weight={700}>
                        Mover como subtareas
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        ¿Debajo de qué registro?
                    </T>
                    <span style={{ height: 22, border: `1px solid ${primary()}`, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 7px', fontSize: 9.5, fontWeight: 600 }}>Lanzamiento del sitio</span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Btn label="Mover 3 registros" />
                    </span>
                </At>

                <At x={120} y={204} a="les-toast" style={{ opacity: 0, zIndex: 7, background: C.fg, borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 10 }}>
                    <T size={9} weight={600} color={C.card}>
                        Se movieron 3 registros.
                    </T>
                    <T size={9} weight={700} color={primary()}>
                        Deshacer
                    </T>
                </At>
            </Win>
            <Cursor a="les-cur" click="les-ring" rest={[420, 170]} />
        </Stage>
    );
}
