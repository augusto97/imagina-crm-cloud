import { CalendarDays, ChevronDown, MoreHorizontal, Users } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Mirar el tablero desde otro ángulo sin editarlo: el período global cambia a
 * «Este trimestre» y después el filtro «Responsable: yo» deja sólo lo propio.
 * Todos los widgets se recalculan juntos.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const BARS: Array<{ label: string; t: Tn; w: [number, number, number] }> = [
    { label: 'Nuevo', t: 'cyan', w: [70, 120, 52] },
    { label: 'Propuesta', t: 'violet', w: [96, 140, 66] },
    { label: 'Ganado', t: 'mint', w: [52, 108, 38] },
];

const barKeys = BARS.map(
    (b, i) =>
        `@keyframes tx-bar${i}{0%,34%{width:${b.w[0]}px;opacity:1}40%,64%{width:${b.w[1]}px;opacity:1}70%,92%{width:${b.w[2]}px;opacity:1}97%,100%{width:${b.w[2]}px;opacity:0}}`,
).join('\n');

const CSS = `
${barKeys}
@keyframes tx-s1{0%,34%{opacity:1}38%,100%{opacity:0}}
@keyframes tx-s2{0%,34%{opacity:0}38%,64%{opacity:1}68%,100%{opacity:0}}
@keyframes tx-s3{0%,64%{opacity:0}68%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tx-menu{0%,16%{opacity:0;transform:translateY(-4px)}19%,32%{opacity:1;transform:translateY(0)}35%,100%{opacity:0;transform:translateY(0)}}
@keyframes tx-menu2{0%,54%{opacity:0;transform:translateY(-4px)}57%,64%{opacity:1;transform:translateY(0)}67%,100%{opacity:0;transform:translateY(0)}}
@keyframes tx-hl{0%,27%{background:transparent}29%,32%{background:${primary(0.14)}}35%,100%{background:transparent}}
@keyframes tx-hl2{0%,60%{background:transparent}62%,64%{background:${primary(0.14)}}67%,100%{background:transparent}}
@keyframes tx-chip{0%,64%{border-color:${C.border};background:${C.card}}68%,92%{border-color:${primary()};background:${primary(0.08)}}97%,100%{border-color:${C.border};background:${C.card}}}
@keyframes tx-cursor{0%,6%{transform:translate(380px,280px);opacity:0}10%{opacity:1}15%,17%{transform:translate(215px,56px);opacity:1}29%,32%{transform:translate(205px,140px);opacity:1}50%,54%{transform:translate(342px,56px);opacity:1}61%,64%{transform:translate(305px,95px);opacity:1}80%,88%{transform:translate(360px,190px);opacity:1}94%,100%{transform:translate(360px,190px);opacity:0}}
@keyframes tx-ring{0%,15%{opacity:0;transform:scale(.4)}16%{opacity:1;transform:scale(1)}20%{opacity:0;transform:scale(1.6)}30%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}35%{opacity:0;transform:scale(1.6)}51%{opacity:0;transform:scale(.4)}52%{opacity:1;transform:scale(1)}56%{opacity:0;transform:scale(1.6)}62%{opacity:0;transform:scale(.4)}63%{opacity:1;transform:scale(1)}67%,100%{opacity:0;transform:scale(1.6)}}
`;

/** Tres valores que se van reemplazando (antes, con el período, con el filtro). */
function Three({ v, size, weight = 800, color }: { v: [string, string, string]; size: number; weight?: number; color?: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-grid' }}>
            {v.map((x, k) => (
                <span key={k} data-a="" style={{ gridArea: '1/1', opacity: k === 2 ? 1 : 0, animationName: `tx-s${k + 1}` }}>
                    <T size={size} weight={weight} color={color}>
                        {x}
                    </T>
                </span>
            ))}
        </span>
    );
}

function Tile({ x, title, v }: { x: number; title: string; v: [string, string, string] }): JSX.Element {
    return (
        <At x={x} y={44} w={132} h={56} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '7px 9px' }}>
            <T size={8} weight={700} style={{ display: 'block' }}>
                {title}
            </T>
            <div style={{ marginTop: 8 }}>
                <Three v={v} size={16} />
            </div>
        </At>
    );
}

export default function TabExplorar(): JSX.Element {
    return (
        <Stage label="En la cabecera del tablero se elige el período «Este trimestre» y después el filtro «Responsable: yo»; todos los indicadores y gráficos se recalculan juntos." tint="cyan">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={14} y={12} w={452} h={276} title="Tableros · Ventas">
                    <At x={12} y={8}>
                        <T size={12} weight={700}>
                            Ventas
                        </T>
                    </At>
                    {/* Período global */}
                    <At
                        x={150}
                        y={7}
                        w={110}
                        h={20}
                        style={{ border: `1px solid ${C.border}`, borderRadius: 6, background: C.card, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}
                    >
                        <CalendarDays size={10} color={C.mutedFg} />
                        <Three v={['Este mes', 'Este trimestre', 'Este trimestre']} size={8.5} weight={600} />
                        <ChevronDown size={9} color={C.mutedFg} style={{ marginLeft: 'auto' }} />
                    </At>
                    {/* Filtro del tablero */}
                    <At
                        x={268}
                        y={7}
                        w={118}
                        h={20}
                        a="tx-chip"
                        style={{ border: `1px solid ${primary()}`, background: primary(0.08), borderRadius: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}
                    >
                        <Users size={10} color={C.mutedFg} />
                        <T size={8.5} color={C.mutedFg}>
                            Responsable:
                        </T>
                        <Three v={['todos', 'todos', 'yo']} size={8.5} weight={700} />
                        <ChevronDown size={9} color={C.mutedFg} style={{ marginLeft: 'auto' }} />
                    </At>
                    <At x={392} y={7} w={24} h={20} style={{ border: `1px solid ${C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <MoreHorizontal size={11} color={C.mutedFg} />
                    </At>

                    <Tile x={12} title="Oportunidades" v={['16', '41', '12']} />
                    <Tile x={152} title="Monto en pipeline" v={['$ 39,4 M', '$ 96,2 M', '$ 28,7 M']} />
                    <Tile x={292} title="Ganadas" v={['7', '19', '6']} />

                    <At x={12} y={110} w={412} h={130} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px' }}>
                        <T size={8.5} weight={700} style={{ display: 'block' }}>
                            Monto por etapa
                        </T>
                        <T size={7} color={C.mutedFg} style={{ display: 'block', marginTop: 1 }}>
                            Suma · Oportunidades
                        </T>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 14 }}>
                            {BARS.map((b, i) => (
                                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ width: 54, textAlign: 'right' }}>
                                        <T size={8} color={C.mutedFg}>
                                            {b.label}
                                        </T>
                                    </span>
                                    <span style={{ position: 'relative', width: 280, height: 12, borderRadius: 3, background: C.muted }}>
                                        <span
                                            data-a=""
                                            style={{ position: 'absolute', left: 0, top: 0, height: 12, width: b.w[2], borderRadius: 3, background: tone(b.t), animationName: `tx-bar${i}` }}
                                        />
                                    </span>
                                </div>
                            ))}
                        </div>
                    </At>

                    {/* Menú del período */}
                    <At
                        x={150}
                        y={30}
                        w={124}
                        a="tx-menu"
                        style={{
                            opacity: 0,
                            zIndex: 5,
                            background: C.card,
                            border: `1px solid ${C.border}`,
                            borderRadius: 7,
                            padding: 4,
                            boxShadow: '0 14px 30px -12px rgba(15,23,42,.45)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        {['Cada widget con su período', 'Hoy', 'Esta semana', 'Este mes', 'Este trimestre', 'Este año', 'Personalizado…'].map((o) => (
                            <span
                                key={o}
                                data-a={o === 'Este trimestre' ? '' : undefined}
                                style={{ padding: '2.5px 6px', borderRadius: 4, animationName: o === 'Este trimestre' ? 'tx-hl' : undefined }}
                            >
                                <T size={8}>{o}</T>
                            </span>
                        ))}
                    </At>
                    {/* Menú del filtro */}
                    <At
                        x={268}
                        y={30}
                        w={118}
                        a="tx-menu2"
                        style={{
                            opacity: 0,
                            zIndex: 5,
                            background: C.card,
                            border: `1px solid ${C.border}`,
                            borderRadius: 7,
                            padding: 4,
                            boxShadow: '0 14px 30px -12px rgba(15,23,42,.45)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        {['todos', 'yo', 'otra persona…'].map((o) => (
                            <span key={o} data-a={o === 'yo' ? '' : undefined} style={{ padding: '2.5px 6px', borderRadius: 4, animationName: o === 'yo' ? 'tx-hl2' : undefined }}>
                                <T size={8}>{o}</T>
                            </span>
                        ))}
                    </At>
                </Win>
                <Cursor a="tx-cursor" click="tx-ring" rest={[360, 190]} />
            </div>
        </Stage>
    );
}
