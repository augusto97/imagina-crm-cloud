import { CalendarClock, FileText, Mail } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** Envío programado de un tablero: cada lunes a las 7:00 llega el resumen al correo de los socios, con indicadores y el PDF. */

const BARS: Array<{ l: string; v: number; txt: string }> = [
    { l: 'Bogotá', v: 0.92, txt: '$ 18,4 M' },
    { l: 'Medellín', v: 0.7, txt: '$ 14,1 M' },
    { l: 'Cali', v: 0.52, txt: '$ 10,3 M' },
    { l: 'Barranquilla', v: 0.28, txt: '$ 5,4 M' },
];

const CSS = `
@keyframes cd-clock{0%,16%{opacity:1}20%,92%{opacity:0}100%{opacity:1}}
@keyframes cd-clock2{0%,16%{opacity:0}20%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cd-fly{0%,20%{opacity:0;transform:translate(0,0) scale(.7)}23%{opacity:1;transform:translate(0,0) scale(1)}34%{opacity:1;transform:translate(150px,-30px) scale(1)}37%,100%{opacity:0;transform:translate(150px,-30px) scale(.7)}}
@keyframes cd-mail{0%,33%{opacity:0;transform:translateY(12px)}40%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(12px)}}
${BARS.map((_, i) => `@keyframes cd-b${i}{0%,${40 + i * 4}%{transform:scaleX(0)}${48 + i * 4}%,92%{transform:scaleX(1)}97%,100%{transform:scaleX(0)}}`).join('\n')}
@keyframes cd-pdf{0%,58%{opacity:0;transform:translateY(5px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;

export default function CompDashboard(): JSX.Element {
    return (
        <Stage label="Un envío programado del tablero Ventas: cada semana, el lunes a las 7:00, a los socios, con el PDF. A esa hora les llega el resumen con los indicadores, las barras por ciudad, el botón Ver el tablero y el PDF adjunto." tint="amber">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El envío programado */}
                <At x={16} y={50} w={164} h={190} style={{ ...card, padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarClock size={11} color={tone('amber')} />
                        <T size={8.5} weight={800}>
                            Envío programado
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 5 }}>
                        {(
                            [
                                ['Frecuencia', 'Cada semana'],
                                ['Hora', '07:00'],
                            ] as const
                        ).map(([l, v]) => (
                            <span key={l} style={{ flex: l === 'Hora' ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <T size={6.5} weight={700} color={C.mutedFg}>
                                    {l}
                                </T>
                                <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                                    <T size={7}>{v}</T>
                                </span>
                            </span>
                        ))}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={6.5} weight={700} color={C.mutedFg}>
                            Días de la semana
                        </T>
                        <span style={{ display: 'flex', gap: 3 }}>
                            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                                <span key={i} style={{ width: 17, height: 17, borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? primary() : C.muted }}>
                                    <T size={6.5} weight={700} color={i === 0 ? C.primaryFg : C.mutedFg}>
                                        {d}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={6.5} weight={700} color={C.mutedFg}>
                            Personas del equipo
                        </T>
                        <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {(
                                [
                                    ['AR', 'Andrés'],
                                    ['CV', 'Camila'],
                                ] as const
                            ).map(([ini, n]) => (
                                <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 5px 2px 2px', borderRadius: 99, background: C.muted }}>
                                    <Avatar initials={ini} t="blue" size={12} />
                                    <T size={6.5}>{n}</T>
                                </span>
                            ))}
                        </span>
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ marginTop: 2 }}>
                            Correos externos (opcional)
                        </T>
                        <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                            <T size={6.5}>socio@inversionesrio.co</T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 11, height: 11, borderRadius: 3, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="7" height="7" viewBox="0 0 10 10">
                                <path d="M2 5.2l2 2L8 3" fill="none" stroke={C.primaryFg} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </span>
                        <T size={7}>Adjuntar el tablero en PDF</T>
                    </span>
                </At>

                {/* El sobre que sale */}
                <At x={170} y={150} a="cd-fly" style={{ opacity: 0, zIndex: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 22, borderRadius: 6, background: tone('amber'), color: '#fff', boxShadow: `0 8px 18px -6px ${tone('amber', 0.6)}` }}>
                        <Mail size={13} />
                    </span>
                </At>

                {/* Reloj */}
                <At x={196} y={26} w={80} h={22} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ position: 'relative', width: 64, height: 16 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'cd-clock' }}>
                            <T size={8} weight={700} color={C.mutedFg}>
                                lun 6:59
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'cd-clock2' }}>
                            <T size={8} weight={800} color={tone('amber')}>
                                lun 7:00
                            </T>
                        </span>
                    </span>
                </At>

                {/* El correo de los socios */}
                <At x={196} y={50} w={268} h={212} a="cd-mail" style={{ ...card, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 11px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8.5} weight={800}>
                            Resumen de «Ventas»
                        </T>
                        <T size={6.5} color={C.mutedFg}>
                            Para socio@inversionesrio.co · lunes 7:00
                        </T>
                    </div>
                    <div style={{ padding: '8px 11px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ display: 'flex', gap: 6 }}>
                            {(
                                [
                                    ['VENTAS DEL MES', '$ 48,2 M'],
                                    ['PEDIDOS', '132'],
                                    ['TICKET PROMEDIO', '$ 365.000'],
                                ] as const
                            ).map(([k, v]) => (
                                <span key={k} style={{ flex: 1, borderRadius: 7, border: `1px solid ${C.border}`, padding: '5px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <T size={5.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.04em' }}>
                                        {k}
                                    </T>
                                    <T size={9.5} weight={800}>
                                        {v}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <T size={7} weight={700}>
                            Ventas por ciudad
                        </T>
                        {BARS.map((b, i) => (
                            <span key={b.l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <T size={6.5} color={C.mutedFg} style={{ width: 52 }}>
                                    {b.l}
                                </T>
                                <span style={{ flex: 1, height: 9, borderRadius: 3, background: C.muted, overflow: 'hidden' }}>
                                    <span data-a="" style={{ display: 'block', height: '100%', width: `${b.v * 100}%`, background: tone('amber'), transformOrigin: 'left', animationName: `cd-b${i}` }} />
                                </span>
                                <T size={6.5} weight={700} style={{ width: 42, textAlign: 'right' }}>
                                    {b.txt}
                                </T>
                            </span>
                        ))}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                            <span style={{ height: 21, padding: '0 10px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center' }}>
                                <T size={7.5} weight={700} color={C.primaryFg}>
                                    Ver el tablero
                                </T>
                            </span>
                            <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.muted, animationName: 'cd-pdf' }}>
                                <FileText size={9} color={tone('rose')} />
                                <T size={7} weight={600}>
                                    Ventas.pdf
                                </T>
                            </span>
                        </span>
                    </div>
                </At>
            </At>
        </Stage>
    );
}
