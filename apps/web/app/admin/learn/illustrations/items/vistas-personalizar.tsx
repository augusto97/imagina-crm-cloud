import { SlidersHorizontal, X } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, Win, primary } from '../kit';

/** «Personalizar vista»: el panel se abre al costado; densidad Compacta y «Hoja de cálculo» se aplican en vivo a la tabla. */

const CSS = `
@keyframes vz-panel{0%,8%{transform:translateX(200px)}18%,93%{transform:translateX(0)}99%,100%{transform:translateX(200px)}}
@keyframes vz-seg{0%,33%{transform:translateX(52px)}37%,95%{transform:translateX(0)}100%{transform:translateX(52px)}}
@keyframes vz-row{0%,34%{height:27px}42%,95%{height:21px}100%{height:27px}}
@keyframes vz-num{0%,58%{width:0;opacity:0}66%,95%{width:20px;opacity:1}100%{width:0;opacity:0}}
@keyframes vz-grid{0%,58%{opacity:0}66%,95%{opacity:1}100%{opacity:0}}
@keyframes vz-chk{0%,59%{background:transparent;border-color:${C.border}}61%,95%{background:${primary()};border-color:${primary()}}100%{background:transparent;border-color:${C.border}}}
@keyframes vz-tick{0%,59%{opacity:0}61%,95%{opacity:1}100%{opacity:0}}
@keyframes vz-cur{0%{transform:translate(400px,280px);opacity:0}6%{opacity:1}12%,15%{transform:translate(440px,33px)}28%,34%{transform:translate(318px,80px)}52%,62%{transform:translate(445px,176px)}86%,90%{transform:translate(445px,176px);opacity:1}96%,100%{transform:translate(445px,176px);opacity:0}}
@keyframes vz-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}17%,32%{opacity:0;transform:scale(1.6)}33%{opacity:1;transform:scale(1)}36%,58%{opacity:0;transform:scale(1.6)}59%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.6)}}
`;

const ROWS: Array<[string, string, 'amber' | 'blue' | 'mint', string]> = [
    ['Llamar a Hotel Brisas', 'Pendiente', 'amber', 'Ana'],
    ['Enviar cotización', 'En curso', 'blue', 'Juan'],
    ['Pedir el RUT', 'Pendiente', 'amber', 'Luis'],
    ['Diseñar volante', 'Hecha', 'mint', 'Ana'],
    ['Visita a la sede', 'Pendiente', 'amber', 'Juan'],
    ['Pagar proveedor', 'En curso', 'blue', 'Luis'],
    ['Renovar dominio', 'Pendiente', 'amber', 'Ana'],
    ['Cierre del mes', 'En curso', 'blue', 'Juan'],
];

function Seg({ y, items, a }: { y: number; items: string[]; a?: string }): JSX.Element {
    return (
        <At x={10} y={y} w={158} h={20} style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <span data-a={a ? '' : undefined} style={{ position: 'absolute', left: a ? 0 : 52, top: 0, width: 52, height: 18, background: primary(0.14), boxShadow: `inset 0 0 0 1px ${primary(0.6)}`, borderRadius: 5, animationName: a }} />
            {items.map((it) => (
                <span key={it} style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8.5, fontWeight: 600, color: C.fg }}>
                    {it}
                </span>
            ))}
        </At>
    );
}

function Check({ y, label, hint, a }: { y: number; label: string; hint: string; a?: boolean }): JSX.Element {
    return (
        <At x={10} y={y} w={158} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 1 }}>
                <T size={9.5} weight={600}>
                    {label}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {hint}
                </T>
            </span>
            <span
                data-a={a ? '' : undefined}
                style={{ position: 'relative', width: 11, height: 11, borderRadius: 3, border: `1px solid ${a ? primary() : C.border}`, background: a ? primary() : 'transparent', marginTop: 2, animationName: a ? 'vz-chk' : undefined }}
            >
                {a && (
                    <span data-a="" style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 8, lineHeight: '10px', textAlign: 'center', animationName: 'vz-tick' }}>
                        ✓
                    </span>
                )}
            </span>
        </At>
    );
}

export default function VistasPersonalizar(): JSX.Element {
    return (
        <Stage label="El panel «Personalizar vista» se abre al costado de una tabla: al elegir densidad Compacta las filas se achican, y al encender «Hoja de cálculo» aparecen los números de fila y la cuadrícula." tint="cyan">
            <Keyframes css={CSS} />
            <Win x={16} y={20} w={448} h={260} title="Tareas · Tabla">
                <At x={418} y={-21} style={{ color: primary() }}>
                    <SlidersHorizontal size={13} />
                </At>
                <At x={10} y={8} w={252} h={222} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', height: 22, background: C.muted, alignItems: 'center' }}>
                        <span data-a="" style={{ width: 20, opacity: 1, animationName: 'vz-num', flexShrink: 0 }} />
                        <T size={8.5} weight={700} color={C.mutedFg} style={{ width: 128, paddingLeft: 8 }}>
                            Tarea
                        </T>
                        <T size={8.5} weight={700} color={C.mutedFg} style={{ width: 66 }}>
                            Estado
                        </T>
                        <T size={8.5} weight={700} color={C.mutedFg}>
                            Resp.
                        </T>
                    </div>
                    {ROWS.map((r, i) => (
                        <div key={r[0]} data-a="" style={{ display: 'flex', alignItems: 'center', height: 21, borderTop: `1px solid ${C.border}`, animationName: 'vz-row', overflow: 'hidden' }}>
                            <span data-a="" style={{ width: 20, flexShrink: 0, overflow: 'hidden', textAlign: 'center', fontSize: 8, color: C.mutedFg, animationName: 'vz-num' }}>
                                {i + 1}
                            </span>
                            <T size={9.5} weight={600} style={{ width: 128, paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r[0]}
                            </T>
                            <span style={{ width: 66 }}>
                                <Chip label={r[1]} t={r[2]} />
                            </span>
                            <T size={9} color={C.mutedFg}>
                                {r[3]}
                            </T>
                        </div>
                    ))}
                    {/* Cuadrícula de la hoja de cálculo */}
                    {[20, 148, 214].map((x) => (
                        <span key={x} data-a="" style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1, background: C.border, animationName: 'vz-grid' }} />
                    ))}
                </At>

                {/* El panel */}
                <At x={268} y={-26} w={180} h={260} a="vz-panel" style={{ background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-12px 0 24px -16px rgba(15,23,42,.5)', zIndex: 5 }}>
                    <At x={10} y={9} w={160} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <T size={10.5} weight={700}>
                            Personalizar vista
                        </T>
                        <X size={11} color={C.mutedFg} />
                    </At>
                    <At x={10} y={36} style={{ display: 'flex' }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            DENSIDAD Y LETRA
                        </T>
                    </At>
                    <Seg y={50} items={['Compacta', 'Normal', 'Cómoda']} a="vz-seg" />
                    <Seg y={76} items={['Chica', 'Normal', 'Grande']} />
                    <At x={10} y={110} style={{ display: 'flex' }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            MOSTRAR
                        </T>
                    </At>
                    <Check y={122} label="Ajustar texto" hint="El contenido completo, en varias líneas" />
                    <Check y={150} label="Hoja de cálculo" hint="Numera las filas y dibuja la cuadrícula" a />
                    <Check y={178} label="Editar con un click" hint="Un click abre el editor de la celda" />
                    <At x={10} y={210} w={158} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <T size={9.5} weight={600}>
                            Columnas fijas
                        </T>
                        <span style={{ fontSize: 8.5, border: `1px solid ${C.border}`, borderRadius: 5, padding: '2px 6px' }}>Sólo la primera</span>
                    </At>
                </At>
            </Win>
            <Cursor a="vz-cur" click="vz-ring" rest={[445, 176]} />
        </Stage>
    );
}
