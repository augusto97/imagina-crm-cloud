import { Mail, MessageSquare, Phone } from 'lucide-react';

import { At, Avatar, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/** La ficha de un cliente, diseñada: portada, etapas, cifras de lo vinculado, una dona por estado y la conversación. */

const CSS = `
@keyframes fh-stage{0%,30%{transform:translateX(0)}36%,94%{transform:translateX(86px)}100%{transform:translateX(0)}}
@keyframes fh-s2{0%,32%{color:${C.mutedFg}}36%,94%{color:${C.primaryFg}}100%{color:${C.mutedFg}}}
@keyframes fh-s1{0%,32%{color:${C.primaryFg}}36%,94%{color:${C.fg}}100%{color:${C.primaryFg}}}
@keyframes fh-arc1{0%,8%{stroke-dasharray:0 200}26%,94%{stroke-dasharray:70 200}100%{stroke-dasharray:0 200}}
@keyframes fh-arc2{0%,14%{stroke-dasharray:0 200}32%,94%{stroke-dasharray:28 200}100%{stroke-dasharray:0 200}}
@keyframes fh-arc3{0%,20%{stroke-dasharray:0 200}38%,94%{stroke-dasharray:15 200}100%{stroke-dasharray:0 200}}
@keyframes fh-kpi{0%,4%{opacity:0;transform:translateY(5px)}12%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes fh-msg{0%,50%{opacity:0;transform:translateY(6px)}56%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes fh-saved{0%,36%{opacity:0}40%,60%{opacity:1}66%,100%{opacity:0}}
`;

const STAGES = ['Prospecto', 'Propuesta', 'Cliente', 'Inactivo'];

function Kpi({ x, label, value, t }: { x: number; label: string; value: string; t: 'violet' | 'rose' | 'amber' }): JSX.Element {
    return (
        <At x={x} y={124} w={92} h={44} a="fh-kpi" style={{ borderRadius: 9, background: tone(t, 0.1), padding: '6px 9px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {label}
            </T>
            <T size={13} weight={800} color={tone(t)}>
                {value}
            </T>
        </At>
    );
}

export default function FichaHero(): JSX.Element {
    const R = 22;
    const circ = 2 * Math.PI * R; // ≈ 138
    return (
        <Stage label="La ficha diseñada de un cliente: portada con su nombre y datos de contacto, etapas clickeables que avanzan a «Cliente», cifras de sus facturas, una dona por estado y la conversación del equipo." tint="cyan">
            <Keyframes css={CSS} />
            <At x={16} y={14} w={448} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.45)' }}>
                {/* Portada */}
                <div style={{ height: 50, background: `linear-gradient(120deg, ${primary(0.55)}, ${tone('violet', 0.45)})` }} />
                <At x={16} y={30} style={{ borderRadius: 99, border: `3px solid ${C.card}` }}>
                    <Avatar initials="HB" t="cyan" size={40} />
                </At>
                <At x={66} y={54} w={260} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={14} weight={800}>
                        Hotel Brisas
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.mutedFg }}>
                        <Mail size={9} />
                        <T size={8.5} color={C.mutedFg}>
                            reservas@hotelbrisas.co
                        </T>
                        <Phone size={9} />
                        <T size={8.5} color={C.mutedFg}>
                            +57 300 112 2334
                        </T>
                    </span>
                </At>
                <At x={330} y={58} style={{ display: 'flex', gap: 4 }}>
                    <Chip label="VIP" t="violet" />
                    <Chip label="Cartagena" t="slate" />
                </At>
                <At x={360} y={34} a="fh-saved" style={{ opacity: 0, display: 'flex' }}>
                    <T size={8} weight={600} color={C.mutedFg}>
                        Se guarda solo ✓
                    </T>
                </At>

                {/* Etapas */}
                <At x={16} y={94} w={350} h={22} style={{ display: 'flex', borderRadius: 7, background: C.muted, overflow: 'hidden' }}>
                    <span data-a="" style={{ position: 'absolute', left: 86, top: 0, width: 86, height: 22, borderRadius: 7, background: primary(), transform: 'translateX(86px)', animationName: 'fh-stage' }} />
                    {STAGES.map((s, i) => (
                        <span
                            key={s}
                            data-a={i === 1 || i === 2 ? '' : undefined}
                            style={{
                                position: 'relative',
                                width: 86,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 9,
                                fontWeight: 700,
                                color: i === 2 ? C.primaryFg : i === 0 ? C.fg : C.mutedFg,
                                animationName: i === 1 ? 'fh-s1' : i === 2 ? 'fh-s2' : undefined,
                            }}
                        >
                            {s}
                        </span>
                    ))}
                </At>

                {/* Cifras de lo vinculado */}
                <Kpi x={16} label="Total facturado" value="$ 18,4 M" t="violet" />
                <Kpi x={114} label="Saldo pendiente" value="$ 3,6 M" t="rose" />
                <Kpi x={212} label="Facturas" value="11" t="amber" />

                {/* Dona por estado */}
                <At x={16} y={176} w={290} h={84} style={{ border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px' }}>
                    <svg width={60} height={60} viewBox="0 0 60 60" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
                        <circle cx={30} cy={30} r={R} fill="none" stroke={C.muted} strokeWidth={9} />
                        <circle data-a="" cx={30} cy={30} r={R} fill="none" stroke={tone('mint')} strokeWidth={9} strokeDasharray={`70 ${circ}`} style={{ animationName: 'fh-arc1' }} />
                        <circle data-a="" cx={30} cy={30} r={R} fill="none" stroke={tone('amber')} strokeWidth={9} strokeDasharray={`28 ${circ}`} strokeDashoffset={-72} style={{ animationName: 'fh-arc2' }} />
                        <circle data-a="" cx={30} cy={30} r={R} fill="none" stroke={tone('rose')} strokeWidth={9} strokeDasharray={`15 ${circ}`} strokeDashoffset={-102} style={{ animationName: 'fh-arc3' }} />
                    </svg>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <T size={9} weight={700}>
                            Facturas por estado
                        </T>
                        {(
                            [
                                ['Pagada', '7', 'mint'],
                                ['Pendiente', '3', 'amber'],
                                ['Vencida', '1', 'rose'],
                            ] as const
                        ).map(([l, n, t]) => (
                            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: tone(t) }} />
                                <T size={8.5} color={C.mutedFg}>
                                    {l} · {n}
                                </T>
                            </span>
                        ))}
                    </span>
                </At>

                {/* Conversación */}
                <At x={318} y={124} w={114} h={136} style={{ borderLeft: `1px solid ${C.border}`, paddingLeft: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.mutedFg }}>
                        <MessageSquare size={10} />
                        <T size={8.5} weight={700} color={C.mutedFg}>
                            Actividad
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 5 }}>
                        <Avatar initials="JP" t="amber" size={16} />
                        <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                            Juan cambió Etapa a <b style={{ color: C.fg }}>Cliente</b>
                        </T>
                    </span>
                    <span data-a="" style={{ display: 'flex', gap: 5, animationName: 'fh-msg' }}>
                        <Avatar initials="AM" t="violet" size={16} />
                        <span style={{ background: C.muted, borderRadius: 7, padding: '4px 6px', display: 'block', fontSize: 8, lineHeight: 1.3 }}>
                            <T size={8} style={{ whiteSpace: 'normal', display: 'block' }}>
                                <b style={{ color: primary() }}>@Juan</b> firmaron el contrato anual 🎉
                            </T>
                        </span>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
