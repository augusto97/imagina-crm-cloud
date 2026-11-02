import { BarChart3, Bell, ChevronRight, List, ListChecks, Menu, Pin, Search, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.342 — En el celular (y en la app instalada) la navegación es una barra
 * de pestañas abajo: Listas, Mi trabajo, Buscar, Avisos (con el número sin
 * leer) y Más. Se toca «Más» y aparece todo lo demás (Favoritos, Tableros,
 * Ajustes…); después se vuelve a «Listas».
 */

// El teléfono: marco en (150, 10), pantalla interior de 140 × 270.
const PX = 150;
const PY = 10;
const TAB_Y = 232; // la barra de abajo, dentro de la pantalla
const TAB_W = 28;

const CSS = `
@keyframes cp-lists{0%,40%{opacity:1}44%,84%{opacity:0}88%,100%{opacity:1}}
@keyframes cp-more{0%,40%{opacity:0;transform:translateY(10px)}44%,84%{opacity:1;transform:translateY(0)}88%,100%{opacity:0;transform:translateY(6px)}}
@keyframes cp-on-lists{0%,40%{opacity:1}44%,84%{opacity:0}88%,100%{opacity:1}}
@keyframes cp-on-more{0%,40%{opacity:0}44%,84%{opacity:1}88%,100%{opacity:0}}
@keyframes cp-badge{0%,10%{transform:scale(.4);opacity:0}16%{transform:scale(1.15);opacity:1}20%,100%{transform:scale(1);opacity:1}}
@keyframes cp-cur{0%{transform:translate(330px,250px);opacity:0}8%{opacity:1}30%,38%{transform:translate(${PX + 5 + 4 * TAB_W + 12}px,${PY + 5 + TAB_Y + 14}px)}70%,78%{transform:translate(${PX + 5 + 12}px,${PY + 5 + TAB_Y + 14}px)}92%{opacity:1}100%{opacity:0;transform:translate(${PX + 5 + 12}px,${PY + 5 + TAB_Y + 14}px)}}
@keyframes cp-ring{0%,37%{opacity:0;transform:scale(.4)}38%{opacity:1;transform:scale(1)}43%{opacity:0;transform:scale(1.7)}77%{opacity:0;transform:scale(.4)}78%{opacity:1;transform:scale(1)}83%,100%{opacity:0;transform:scale(1.7)}}
`;

const TABS: Array<{ icon: LucideIcon; label: string }> = [
    { icon: List, label: 'Listas' },
    { icon: ListChecks, label: 'Trabajo' },
    { icon: Search, label: 'Buscar' },
    { icon: Bell, label: 'Avisos' },
    { icon: Menu, label: 'Más' },
];

function Row({ y, w, t }: { y: number; w: number; t: 'violet' | 'blue' | 'mint' | 'amber' }): JSX.Element {
    return (
        <At x={8} y={y} w={124} h={24} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}` }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: tone(t, 0.85) }} />
            <Bar w={w} h={5} />
        </At>
    );
}

function MoreRow({ y, icon: Icon, label }: { y: number; icon: LucideIcon; label: string }): JSX.Element {
    return (
        <At x={8} y={y} w={124} h={24} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 7, background: C.card, border: `1px solid ${C.border}` }}>
            <span style={{ width: 14, height: 14, borderRadius: 4, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={8} color={C.fg} />
            </span>
            <T size={7.4} style={{ flex: 1 }}>
                {label}
            </T>
            <ChevronRight size={8} color={C.mutedFg} />
        </At>
    );
}

export default function CelularPestanas(): JSX.Element {
    return (
        <Stage
            label="Un teléfono con la barra de pestañas abajo: Listas, Mi trabajo, Buscar, Avisos con un 3 sin leer y Más. Se toca «Más» y aparecen Favoritos, Tableros y Ajustes; después se toca «Listas» y se vuelve a las listas."
            tint="cyan"
            cycle={9}
        >
            <Keyframes css={CSS} />
            <At x={PX} y={PY} w={150} h={280} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                {/* Barra de arriba: la empresa */}
                <At x={0} y={0} w={140} h={26} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ width: 12, height: 12, borderRadius: 4, background: primary() }} />
                    <T size={7.6} weight={700}>
                        Café Aurora
                    </T>
                </At>

                {/* Listas */}
                <At x={0} y={30} w={140} h={200} a="cp-lists">
                    <At x={9} y={4}>
                        <T size={9} weight={700}>
                            Listas
                        </T>
                    </At>
                    <At x={9} y={22}>
                        <T size={5.8} weight={700} color={C.mutedFg} style={{ letterSpacing: 0.5 }}>
                            RECIENTES
                        </T>
                    </At>
                    <Row y={32} w={64} t="violet" />
                    <At x={9} y={64}>
                        <T size={5.8} weight={700} color={C.mutedFg} style={{ letterSpacing: 0.5 }}>
                            VENTAS
                        </T>
                    </At>
                    <Row y={74} w={56} t="blue" />
                    <Row y={102} w={72} t="mint" />
                    <Row y={130} w={48} t="amber" />
                </At>

                {/* Más */}
                <At x={0} y={30} w={140} h={200} a="cp-more" style={{ opacity: 0 }}>
                    <At x={8} y={2} w={124} h={30} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}` }}>
                        <span style={{ width: 18, height: 18, borderRadius: 99, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6.5, fontWeight: 700 }}>
                            LG
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={7.4} weight={700}>
                                Laura Gómez
                            </T>
                            <T size={5.8} color={primary()}>
                                Tu cuenta
                            </T>
                        </span>
                    </At>
                    <MoreRow y={40} icon={Pin} label="Favoritos" />
                    <MoreRow y={68} icon={BarChart3} label="Tableros" />
                    <MoreRow y={96} icon={Settings} label="Ajustes" />
                </At>

                {/* La barra de pestañas */}
                <At x={0} y={TAB_Y} w={140} h={38} style={{ display: 'flex', borderTop: `1px solid ${C.border}`, background: C.card }}>
                    {TABS.map((tab, i) => {
                        const Icon = tab.icon;
                        const isLists = i === 0;
                        const isMore = i === 4;
                        return (
                            <span key={tab.label} style={{ position: 'relative', width: TAB_W, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                                {/* pastilla de la pestaña activa */}
                                {(isLists || isMore) && (
                                    <span
                                        data-a=""
                                        style={{ position: 'absolute', top: 5, width: 22, height: 13, borderRadius: 99, background: primary(0.14), animationName: isLists ? 'cp-on-lists' : 'cp-on-more', opacity: isLists ? 1 : 0 }}
                                    />
                                )}
                                <span style={{ position: 'relative', display: 'flex' }}>
                                    <Icon size={10} color={isLists || isMore ? primary() : C.mutedFg} />
                                    {i === 3 && (
                                        <span
                                            data-a=""
                                            style={{ position: 'absolute', top: -5, left: 6, minWidth: 9, height: 9, borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 5.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'cp-badge' }}
                                        >
                                            3
                                        </span>
                                    )}
                                </span>
                                <T size={5.2} weight={600} color={C.mutedFg}>
                                    {tab.label}
                                </T>
                            </span>
                        );
                    })}
                </At>
            </At>
            <Cursor a="cp-cur" click="cp-ring" rest={[PX + 5 + 12, PY + 5 + TAB_Y + 14]} />
        </Stage>
    );
}
