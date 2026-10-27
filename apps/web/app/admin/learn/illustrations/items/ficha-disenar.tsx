import { BarChart3, ChartLine, ChartPie, Gauge, KanbanSquare, Monitor, Search, Smartphone, Table2 } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** El editor de la ficha: un bloque «Dona» se arrastra desde la biblioteca y muestra las facturas reales del cliente. */

const LIB_Y = 92;

const CSS = `
@keyframes fds-ghost{0%,14%{opacity:0;transform:translate(0,0)}16%{opacity:1;transform:translate(0,0)}36%{opacity:1;transform:translate(222px,48px)}38%,100%{opacity:0;transform:translate(222px,48px)}}
@keyframes fds-drop{0%,22%{opacity:0}26%,37%{opacity:1}39%,100%{opacity:0}}
@keyframes fds-block{0%,37%{opacity:0;transform:scale(.94)}42%,94%{opacity:1;transform:scale(1)}99%,100%{opacity:0}}
@keyframes fds-arc1{0%,40%{stroke-dasharray:0 200}54%,94%{stroke-dasharray:62 200}99%,100%{stroke-dasharray:0 200}}
@keyframes fds-arc2{0%,44%{stroke-dasharray:0 200}58%,94%{stroke-dasharray:46 200}99%,100%{stroke-dasharray:0 200}}
@keyframes fds-arc3{0%,48%{stroke-dasharray:0 200}62%,94%{stroke-dasharray:22 200}99%,100%{stroke-dasharray:0 200}}
@keyframes fds-insp{0%,42%{opacity:0;transform:translateX(8px)}47%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes fds-src{0%,58%{opacity:0}61%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fds-save{0%,74%{background:${primary(0.55)}}76%,80%{background:${primary()}}84%,100%{background:${primary(0.55)}}}
@keyframes fds-saved{0%,78%{opacity:0}81%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fds-cur{0%{transform:translate(200px,290px);opacity:0}5%{opacity:1}11%,15%{transform:translate(50px,176px)}36%,40%{transform:translate(272px,${LIB_Y + 3 * 22 + 61}px)}60%,72%{transform:translate(440px,20px)}74%{transform:translate(440px,20px)}88%,92%{transform:translate(440px,20px);opacity:1}97%,100%{opacity:0}}
@keyframes fds-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}17%,74%{opacity:0;transform:scale(1.6)}75%{opacity:1;transform:scale(1)}78%,100%{opacity:0;transform:scale(1.6)}}
`;

const LIB = [
    { icon: <Gauge size={10} />, l: 'Indicador' },
    { icon: <BarChart3 size={10} />, l: 'Barras' },
    { icon: <ChartLine size={10} />, l: 'Líneas' },
    { icon: <ChartPie size={10} />, l: 'Dona' },
];

export default function FichaDisenar(): JSX.Element {
    const R = 20;
    const circ = 2 * Math.PI * R;
    return (
        <Stage label="El editor de la ficha de clientes: a la izquierda la biblioteca de bloques, al centro la ficha real de «Hotel Brisas». Se arrastra el bloque «Dona» a la ficha y aparece un gráfico de sus facturas por estado; a la derecha, sus ajustes, y al final se toca Guardar." tint="cyan">
            <Keyframes css={CSS} />
            <At x={8} y={8} w={464} h={284} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.45)' }}>
                {/* Barra del editor */}
                <At x={0} y={0} w={464} h={30} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10} weight={700}>
                        Diseño de la ficha
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        · Clientes
                    </T>
                    <span style={{ flex: 1 }} />
                    <span data-a="" style={{ opacity: 0, animationName: 'fds-saved', display: 'flex' }}>
                        <T size={8.5} color={tone('mint')} weight={600}>
                            Diseño guardado
                        </T>
                    </span>
                    <span style={{ display: 'flex', borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        <span style={{ display: 'flex', padding: '3px 6px', background: C.muted, color: C.fg }}>
                            <Monitor size={10} />
                        </span>
                        <span style={{ display: 'flex', padding: '3px 6px', color: C.mutedFg }}>
                            <Smartphone size={10} />
                        </span>
                    </span>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', height: 20, padding: '0 10px', borderRadius: 6, color: C.primaryFg, fontSize: 9, fontWeight: 600, background: primary(0.55), animationName: 'fds-save' }}>
                        Guardar
                    </span>
                </At>

                {/* Biblioteca */}
                <At x={0} y={30} w={112} h={254} style={{ borderRight: `1px solid ${C.border}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', gap: 8 }}>
                        <T size={8.5} weight={700}>
                            Bloques
                        </T>
                        <T size={8.5} color={C.mutedFg}>
                            Estructura
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, borderRadius: 6, border: `1px solid ${C.border}`, padding: '0 6px', color: C.mutedFg }}>
                        <Search size={9} />
                        <T size={8} color={C.mutedFg}>
                            Buscar bloque…
                        </T>
                    </span>
                </At>
                <At x={8} y={LIB_Y - 30 + 30 - 16} style={{ display: 'flex' }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        GRÁFICOS
                    </T>
                </At>
                {LIB.map((b, i) => (
                    <At key={b.l} x={8} y={LIB_Y - 30 + 30 + i * 22} w={96} h={20} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 6, border: `1px solid ${i === 3 ? primary(0.5) : C.border}`, background: i === 3 ? primary(0.08) : C.card, color: C.mutedFg }}>
                        {b.icon}
                        <T size={8.5} weight={600}>
                            {b.l}
                        </T>
                    </At>
                ))}
                <At x={8} y={LIB_Y + 4 * 22 + 8} style={{ display: 'flex' }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        REGISTROS VINCULADOS
                    </T>
                </At>
                {[
                    [<Table2 key="t" size={10} />, 'Tabla de vinculados'],
                    [<KanbanSquare key="k" size={10} />, 'Tablero por estado'],
                ].map(([ic, l], i) => (
                    <At key={l as string} x={8} y={LIB_Y + 4 * 22 + 24 + i * 22} w={98} h={20} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 5px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.mutedFg }}>
                        {ic}
                        <T size={7.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {l}
                        </T>
                    </At>
                ))}

                {/* La ficha (lienzo) */}
                <At x={112} y={30} w={238} h={254} style={{ background: C.canvas, padding: 10 }}>
                    <div style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        <div style={{ height: 26, background: `linear-gradient(120deg, ${primary(0.5)}, ${tone('violet', 0.4)})` }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px' }}>
                            <Avatar initials="HB" t="cyan" size={20} />
                            <T size={10.5} weight={800}>
                                Hotel Brisas
                            </T>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <div style={{ width: 92, borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, padding: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            <T size={8} weight={700}>
                                Propiedades
                            </T>
                            {['Ciudad', 'NIT', 'Teléfono', 'Asesor'].map((l) => (
                                <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <T size={7} color={C.mutedFg}>
                                        {l}
                                    </T>
                                    <span style={{ height: 5, width: 60, borderRadius: 99, background: C.muted }} />
                                </span>
                            ))}
                        </div>
                        <div style={{ position: 'relative', flex: 1, height: 150 }}>
                            <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 9, border: `2px dashed ${primary()}`, background: primary(0.06), opacity: 0, animationName: 'fds-drop' }} />
                            <div data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 9, background: C.card, border: `1.5px solid ${primary(0.6)}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, animationName: 'fds-block' }}>
                                <T size={8.5} weight={700}>
                                    Facturas por estado
                                </T>
                                <span style={{ display: 'flex', justifyContent: 'center' }}>
                                    <svg width={56} height={56} viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
                                        <circle cx={28} cy={28} r={R} fill="none" stroke={C.muted} strokeWidth={9} />
                                        <circle data-a="" cx={28} cy={28} r={R} fill="none" stroke={tone('mint')} strokeWidth={9} strokeDasharray={`62 ${circ}`} style={{ animationName: 'fds-arc1' }} />
                                        <circle data-a="" cx={28} cy={28} r={R} fill="none" stroke={tone('amber')} strokeWidth={9} strokeDasharray={`46 ${circ}`} strokeDashoffset={-64} style={{ animationName: 'fds-arc2' }} />
                                        <circle data-a="" cx={28} cy={28} r={R} fill="none" stroke={tone('rose')} strokeWidth={9} strokeDasharray={`22 ${circ}`} strokeDashoffset={-112} style={{ animationName: 'fds-arc3' }} />
                                    </svg>
                                </span>
                                {(
                                    [
                                        ['Pagada', '5', 'mint'],
                                        ['Pendiente', '4', 'amber'],
                                        ['Vencida', '2', 'rose'],
                                    ] as const
                                ).map(([l, n, t]) => (
                                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ width: 6, height: 6, borderRadius: 2, background: tone(t) }} />
                                        <T size={7.5} color={C.mutedFg} style={{ flex: 1 }}>
                                            {l}
                                        </T>
                                        <T size={7.5} weight={700}>
                                            {n}
                                        </T>
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </At>

                {/* Inspector */}
                <At x={350} y={30} w={114} h={254} style={{ borderLeft: `1px solid ${C.border}`, padding: 8 }}>
                    <div data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 7, animationName: 'fds-insp' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <ChartPie size={11} color={primary()} />
                            <T size={9.5} weight={700}>
                                Dona
                            </T>
                        </span>
                        <span style={{ display: 'flex', gap: 8 }}>
                            <T size={8} weight={700} color={primary()}>
                                Datos
                            </T>
                            <T size={8} color={C.mutedFg}>
                                Visualización
                            </T>
                        </span>
                        {(
                            [
                                ['Fuente de datos', 'Facturas del cliente'],
                                ['Métrica', 'Cantidad'],
                                ['Agrupar por', 'Estado'],
                            ] as const
                        ).map(([l, v], i) => (
                            <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={7.5} color={C.mutedFg}>
                                    {l}
                                </T>
                                <span style={{ position: 'relative', height: 20, borderRadius: 6, border: `1px solid ${i === 0 ? primary(0.6) : C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                                    <span data-a={i === 0 ? '' : undefined} style={{ display: 'flex', animationName: i === 0 ? 'fds-src' : undefined }}>
                                        <T size={8} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 92 }}>
                                            {v}
                                        </T>
                                    </span>
                                </span>
                            </span>
                        ))}
                    </div>
                </At>
            </At>

            {/* Lo que se arrastra */}
            <At x={16} y={LIB_Y + 3 * 22 + 8} w={96} h={20} a="fds-ghost" style={{ opacity: 0, zIndex: 9, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 6, border: `1px solid ${primary()}`, background: C.card, boxShadow: '0 12px 24px -10px rgba(15,23,42,.55)', color: primary() }}>
                <ChartPie size={10} />
                <T size={8.5} weight={700} color={primary()}>
                    Dona
                </T>
            </At>
            <Cursor a="fds-cur" click="fds-ring" rest={[440, 20]} />
        </Stage>
    );
}
