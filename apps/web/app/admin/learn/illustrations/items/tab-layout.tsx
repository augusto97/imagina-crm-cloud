import { GripHorizontal, Smartphone } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Acomodar el tablero: un widget se arrastra por su cabecera a otro lugar, otro
 * se agranda desde la esquina, y en el celular los mismos widgets quedan uno
 * debajo del otro, solos.
 */

const CSS = `
@keyframes tl-move{0%,12%{transform:translate(0,0);box-shadow:0 1px 2px rgba(15,23,42,.08);opacity:1}16%{transform:translate(0,-3px) scale(1.03);box-shadow:0 16px 30px -12px rgba(15,23,42,.45);opacity:1}34%{transform:translate(-138px,-3px) scale(1.03);box-shadow:0 16px 30px -12px rgba(15,23,42,.45);opacity:1}38%,92%{transform:translate(-138px,0) scale(1);box-shadow:0 1px 2px rgba(15,23,42,.08);opacity:1}97%,100%{transform:translate(-138px,0);opacity:0}}
@keyframes tl-shift{0%,24%{transform:translate(0,0);opacity:1}36%,92%{transform:translate(138px,0);opacity:1}97%,100%{transform:translate(138px,0);opacity:0}}
@keyframes tl-grow{0%,48%{height:96px;opacity:1}64%,92%{height:124px;opacity:1}97%,100%{height:124px;opacity:0}}
@keyframes tl-ghost{0%,14%{opacity:0}18%,34%{opacity:1}38%,100%{opacity:0}}
@keyframes tl-cursor{0%{transform:translate(300px,270px);opacity:0}6%{opacity:1}12%,16%{transform:translate(190px,60px);opacity:1}34%{transform:translate(52px,57px);opacity:1}40%{transform:translate(52px,57px);opacity:1}48%,50%{transform:translate(286px,214px);opacity:1}64%{transform:translate(286px,242px);opacity:1}72%,88%{transform:translate(286px,242px);opacity:1}94%,100%{transform:translate(286px,242px);opacity:0}}
@keyframes tl-ring{0%,12%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}48%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}54%,100%{opacity:0;transform:scale(1.6)}}
@keyframes tl-phone{0%,64%{opacity:0;transform:translateX(16px)}72%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
`;

function Kpi({ title, value, t }: { title: string; value: string; t: 'mint' | 'violet' | 'amber' }): JSX.Element {
    return (
        <div style={{ height: '100%', background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden' }}>
            <div style={{ height: 18, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', cursor: 'grab' }}>
                <GripHorizontal size={9} color={C.mutedFg} />
                <T size={8} weight={700}>
                    {title}
                </T>
            </div>
            <div style={{ padding: '2px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 4, height: 18, borderRadius: 2, background: tone(t) }} />
                <T size={16} weight={800}>
                    {value}
                </T>
            </div>
        </div>
    );
}

export default function TabLayout(): JSX.Element {
    return (
        <Stage label="Un widget se arrastra por su cabecera al lugar de otro, el gráfico de abajo se agranda desde su esquina, y en el celular los widgets quedan uno debajo del otro." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={14} y={14} w={300} h={272} title="Ventas · escritorio">
                    {/* Hueco destino mientras se arrastra */}
                    <At
                        x={12}
                        y={10}
                        w={130}
                        h={62}
                        a="tl-ghost"
                        style={{ opacity: 0, border: `2px dashed ${primary(0.6)}`, borderRadius: 9, background: primary(0.06) }}
                    />
                    <At x={12} y={10} w={130} h={62} a="tl-shift" style={{ transform: 'translate(138px,0)' }}>
                        <Kpi title="Clientes nuevos" value="42" t="violet" />
                    </At>
                    <At x={150} y={10} w={130} h={62} a="tl-move" style={{ transform: 'translate(-138px,0)', zIndex: 3 }}>
                        <Kpi title="Ventas del mes" value="$ 18,6 M" t="mint" />
                    </At>
                    <At
                        x={12}
                        y={82}
                        w={268}
                        h={124}
                        a="tl-grow"
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden' }}
                    >
                        <div style={{ height: 18, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px' }}>
                            <GripHorizontal size={9} color={C.mutedFg} />
                            <T size={8} weight={700}>
                                Ventas por semana
                            </T>
                        </div>
                        <svg width="250" height="90" viewBox="0 0 250 90" style={{ position: 'absolute', left: 9, bottom: 8 }} preserveAspectRatio="none">
                            <path d="M0 70 L35 58 L70 62 L105 40 L140 46 L175 26 L210 30 L250 10 L250 90 L0 90 Z" fill={tone('blue', 0.14)} />
                            <path d="M0 70 L35 58 L70 62 L105 40 L140 46 L175 26 L210 30 L250 10" fill="none" stroke={tone('blue')} strokeWidth="2" />
                        </svg>
                        {/* Asa para cambiar el tamaño */}
                        <span style={{ position: 'absolute', right: 4, bottom: 4, width: 9, height: 9, borderRight: `2px solid ${C.mutedFg}`, borderBottom: `2px solid ${C.mutedFg}`, borderRadius: 2 }} />
                    </At>
                </Win>

                {/* El celular */}
                <At x={340} y={22} w={124} h={258} a="tl-phone">
                    <div
                        style={{
                            width: 124,
                            height: 238,
                            borderRadius: 20,
                            border: `5px solid ${C.fg}`,
                            background: C.canvas,
                            overflow: 'hidden',
                            padding: 7,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            boxShadow: '0 18px 36px -18px rgba(15,23,42,.55)',
                        }}
                    >
                        <T size={7.5} weight={700}>
                            Ventas
                        </T>
                        <div style={{ height: 48 }}>
                            <Kpi title="Ventas del mes" value="$ 18,6 M" t="mint" />
                        </div>
                        <div style={{ height: 48 }}>
                            <Kpi title="Clientes nuevos" value="42" t="violet" />
                        </div>
                        <div style={{ height: 70, background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, position: 'relative', overflow: 'hidden' }}>
                            <svg width="98" height="44" viewBox="0 0 250 90" style={{ position: 'absolute', left: 4, bottom: 4 }} preserveAspectRatio="none">
                                <path d="M0 70 L35 58 L70 62 L105 40 L140 46 L175 26 L210 30 L250 10 L250 90 L0 90 Z" fill={tone('blue', 0.14)} />
                                <path d="M0 70 L35 58 L70 62 L105 40 L140 46 L175 26 L210 30 L250 10" fill="none" stroke={tone('blue')} strokeWidth="5" />
                            </svg>
                            <span style={{ position: 'absolute', left: 7, top: 5 }}>
                                <T size={7} weight={700}>
                                    Ventas por semana
                                </T>
                            </span>
                        </div>
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 4 }}>
                        <Smartphone size={9} color={C.mutedFg} />
                        <T size={7.5} weight={600} color={C.mutedFg}>
                            En el celular, uno debajo del otro
                        </T>
                    </span>
                </At>
                <Cursor a="tl-cursor" click="tl-ring" rest={[286, 242]} />
            </div>
        </Stage>
    );
}
