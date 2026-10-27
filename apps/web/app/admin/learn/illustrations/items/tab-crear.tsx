import { Check, ChevronDown, ClipboardList, Filter, Package, PieChart, Receipt, Search, Star } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Crear un tablero desde una plantilla: se elige «Embudo de ventas», se elige
 * la lista y la app sugiere qué campo cumple cada papel (etapa, monto…).
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const CARDS: Array<{ name: string; cat: string; t: Tn; icon: JSX.Element }> = [
    { name: 'Resumen por estado', cat: 'Operaciones', t: 'cyan', icon: <PieChart size={12} /> },
    { name: 'Embudo de ventas', cat: 'Ventas', t: 'violet', icon: <Filter size={12} /> },
    { name: 'Cartera y cobros', cat: 'Finanzas', t: 'mint', icon: <Receipt size={12} /> },
    { name: 'Carga de trabajo', cat: 'Equipo', t: 'amber', icon: <ClipboardList size={12} /> },
    { name: 'Satisfacción', cat: 'Clientes', t: 'rose', icon: <Star size={12} /> },
    { name: 'Inventario', cat: 'Operaciones', t: 'blue', icon: <Package size={12} /> },
];

const ROLES: Array<[string, string]> = [
    ['Etapa', 'Etapa'],
    ['Monto', 'Monto'],
    ['Fecha de cierre', 'Cierre estimado'],
    ['Responsable', 'Responsable'],
];

const roleKeys = ROLES.map(
    (_, i) => `@keyframes tc-role${i}{0%,${38 + i * 5}%{opacity:0;transform:translateX(-6px)}${43 + i * 5}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`,
).join('\n');

const CSS = `
@keyframes tc-cursor{0%{transform:translate(420px,280px);opacity:0}6%{opacity:1}16%,22%{transform:translate(228px,122px);opacity:1}30%,36%{transform:translate(384px,104px);opacity:1}62%,72%{transform:translate(386px,274px);opacity:1}88%,100%{transform:translate(386px,274px);opacity:0}}
@keyframes tc-ring{0%,18%{opacity:0;transform:scale(.4)}20%{opacity:1;transform:scale(1)}24%{opacity:0;transform:scale(1.6)}32%{opacity:0;transform:scale(.4)}34%{opacity:1;transform:scale(1)}38%{opacity:0;transform:scale(1.6)}64%{opacity:0;transform:scale(.4)}67%{opacity:1;transform:scale(1)}71%,100%{opacity:0;transform:scale(1.6)}}
@keyframes tc-sel{0%,19%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}22%,92%{box-shadow:0 0 0 2px ${primary(0.55)};border-color:${primary()}}97%,100%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}}
@keyframes tc-empty{0%,20%{opacity:1}24%,96%{opacity:0}100%{opacity:1}}
@keyframes tc-panel{0%,20%{opacity:0}25%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tc-list-a{0%,34%{opacity:1}37%,100%{opacity:0}}
@keyframes tc-list-b{0%,34%{opacity:0}37%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tc-btn{0%,64%{transform:scale(1)}67%{transform:scale(.95)}70%,100%{transform:scale(1)}}
@keyframes tc-toast{0%,71%{opacity:0;transform:translateY(10px)}75%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
${roleKeys}
`;

function SelectBox({ children, w }: { children: JSX.Element | string; w: number }): JSX.Element {
    return (
        <span
            style={{
                width: w,
                height: 15,
                borderRadius: 5,
                border: `1px solid ${C.border}`,
                background: C.card,
                display: 'flex',
                alignItems: 'center',
                padding: '0 5px',
                gap: 3,
            }}
        >
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>{children}</span>
            <ChevronDown size={8} color={C.mutedFg} />
        </span>
    );
}

export default function TabCrear(): JSX.Element {
    return (
        <Stage label="Crear un tablero desde una plantilla: se elige «Embudo de ventas», después la lista Oportunidades, y la app sugiere sola qué campo es la etapa, el monto, la fecha de cierre y el responsable." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
            <Win x={14} y={12} w={452} h={276} title="Nuevo dashboard">
                {/* Pestañas */}
                <At x={12} y={6} style={{ display: 'flex', gap: 14 }}>
                    <span style={{ display: 'inline-flex', paddingBottom: 4, borderBottom: `2px solid ${primary()}` }}>
                        <T size={9} weight={700} color={primary()}>
                            Plantilla
                        </T>
                    </span>
                    <span style={{ display: 'inline-flex', paddingBottom: 4 }}>
                        <T size={9} weight={600} color={C.mutedFg}>
                            En blanco
                        </T>
                    </span>
                </At>
                <At
                    x={12}
                    y={30}
                    w={262}
                    h={18}
                    style={{ border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px' }}
                >
                    <Search size={9} color={C.mutedFg} />
                    <T size={8} color={C.mutedFg}>
                        Buscar plantillas
                    </T>
                </At>
                {CARDS.map((c, i) => (
                    <At
                        key={c.name}
                        x={12 + (i % 2) * 134}
                        y={56 + Math.floor(i / 2) * 58}
                        w={128}
                        h={50}
                        a={i === 1 ? 'tc-sel' : undefined}
                        style={{
                            border: `1px solid ${i === 1 ? primary() : C.border}`,
                            boxShadow: i === 1 ? `0 0 0 2px ${primary(0.55)}` : undefined,
                            borderRadius: 8,
                            background: C.card,
                            padding: '7px 8px',
                            display: 'flex',
                            gap: 7,
                            alignItems: 'flex-start',
                        }}
                    >
                        <IconSquare t={c.t} size={22}>
                            {c.icon}
                        </IconSquare>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <T size={8.5} weight={700} style={{ whiteSpace: 'normal' }}>
                                {c.name}
                            </T>
                            <T size={7} color={C.mutedFg}>
                                {c.cat}
                            </T>
                        </span>
                    </At>
                ))}

                {/* Panel derecho */}
                <At x={284} y={0} w={166} h={250} style={{ borderLeft: `1px solid ${C.border}`, background: C.muted }} />
                <At x={296} y={110} a="tc-empty" style={{ opacity: 0 }}>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', width: 140, display: 'block', textAlign: 'center' }}>
                        Elige una plantilla y después la lista sobre la que se arma.
                    </T>
                </At>
                <At x={294} y={8} w={148} a="tc-panel">
                    <T size={10} weight={700} style={{ display: 'block' }}>
                        Embudo de ventas
                    </T>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
                        {['KPI ×3', 'Embudo', 'Barras', 'Tabla'].map((w, i) => (
                            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', height: 12, padding: '0 4px', borderRadius: 3, background: C.card, border: `1px solid ${C.border}` }}>
                                <T size={6.5} color={C.mutedFg}>
                                    {w}
                                </T>
                            </span>
                        ))}
                    </div>
                    <div
                        style={{
                            marginTop: 8,
                            border: `1px solid ${C.border}`,
                            borderRadius: 7,
                            background: C.card,
                            padding: '6px 7px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                        }}
                    >
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            SOBRE QUÉ LISTA
                        </T>
                        <SelectBox w={134}>
                            <span style={{ display: 'inline-grid' }}>
                                <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'tc-list-a' }}>
                                    <T size={7.5} color={C.mutedFg}>
                                        Elige una lista…
                                    </T>
                                </span>
                                <span data-a="" style={{ gridArea: '1/1', animationName: 'tc-list-b' }}>
                                    <T size={7.5} weight={600}>
                                        Oportunidades
                                    </T>
                                </span>
                            </span>
                        </SelectBox>
                        {ROLES.map(([role, field], i) => (
                            <div key={role} data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 2, animationName: `tc-role${i}` }}>
                                <T size={7} weight={600}>
                                    {role}
                                </T>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <SelectBox w={118}>
                                        <T size={7.5}>{`«${field}»`}</T>
                                    </SelectBox>
                                    <span
                                        style={{
                                            width: 12,
                                            height: 12,
                                            borderRadius: 99,
                                            background: tone('mint'),
                                            color: '#fff',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Check size={8} strokeWidth={3} />
                                    </span>
                                </span>
                            </div>
                        ))}
                    </div>
                </At>
                <At x={294} y={224} w={148} h={20} a="tc-panel">
                    <span
                        data-a=""
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: 20,
                            borderRadius: 6,
                            background: primary(),
                            animationName: 'tc-btn',
                        }}
                    >
                        <T size={8.5} weight={700} color={C.primaryFg}>
                            Crear dashboard
                        </T>
                    </span>
                </At>
            </Win>
            <At
                x={44}
                y={262}
                a="tc-toast"
                style={{
                    background: C.fg,
                    color: C.card,
                    borderRadius: 8,
                    padding: '6px 10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 10px 24px -10px rgba(15,23,42,.5)',
                }}
            >
                <Check size={11} color={tone('mint')} strokeWidth={3} />
                <T size={8.5} weight={600} color={C.card}>
                    Dashboard creado desde la plantilla
                </T>
            </At>
            <Cursor a="tc-cursor" click="tc-ring" rest={[386, 274]} />
            </div>
        </Stage>
    );
}
