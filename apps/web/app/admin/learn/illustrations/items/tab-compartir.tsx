import { CalendarClock, FileText, Globe, Lock, Mail, Share2 } from 'lucide-react';

import { At, C, Flow, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Compartir un tablero hacia afuera: un enlace público de sólo lectura (para
 * verlo sin iniciar sesión o insertarlo en otra página) y un resumen que llega
 * por correo cada lunes, con el PDF adjunto.
 */

const CSS = `
@keyframes ts-btn{0%,8%{box-shadow:0 0 0 0 transparent}12%,20%{box-shadow:0 0 0 4px ${primary(0.3)}}26%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ts-left{0%,22%{opacity:0;transform:translate(20px,6px) scale(.95)}34%,92%{opacity:1;transform:translate(0,0) scale(1)}97%,100%{opacity:0;transform:translate(0,0) scale(1)}}
@keyframes ts-right{0%,40%{opacity:0;transform:translate(-20px,6px) scale(.95)}52%,92%{opacity:1;transform:translate(0,0) scale(1)}97%,100%{opacity:0;transform:translate(0,0) scale(1)}}
@keyframes ts-flowl{0%,18%{opacity:0}24%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ts-flowr{0%,36%{opacity:0}42%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes ts-pdf{0%,58%{opacity:0;transform:scale(.6)}64%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
`;

function MiniBars(): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 26 }}>
            {([14, 22, 10, 26, 18] as number[]).map((h, i) => (
                <span key={i} style={{ width: 7, height: h, borderRadius: '2px 2px 0 0', background: tone((['cyan', 'blue', 'violet', 'mint', 'amber'] as const)[i]!) }} />
            ))}
        </span>
    );
}

export default function TabCompartir(): JSX.Element {
    return (
        <Stage label="Desde «Compartir», el tablero sale de dos formas: un enlace público de sólo lectura que se abre sin iniciar sesión, y un resumen por correo cada lunes a las 8:00 con el PDF adjunto." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                {/* El tablero (centro) */}
                <At
                    x={180}
                    y={86}
                    w={120}
                    h={130}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: 9, boxShadow: '0 12px 28px -14px rgba(15,23,42,.45)' }}
                >
                    <T size={9.5} weight={700} style={{ display: 'block' }}>
                        Ventas
                    </T>
                    <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                        <span style={{ flex: 1, borderRadius: 5, background: C.muted, padding: '4px 5px' }}>
                            <T size={6.5} color={C.mutedFg} style={{ display: 'block' }}>
                                Pipeline
                            </T>
                            <T size={9} weight={800}>
                                $ 39 M
                            </T>
                        </span>
                        <span style={{ flex: 1, borderRadius: 5, background: C.muted, padding: '4px 5px' }}>
                            <T size={6.5} color={C.mutedFg} style={{ display: 'block' }}>
                                Ganadas
                            </T>
                            <T size={9} weight={800}>
                                7
                            </T>
                        </span>
                    </div>
                    <div style={{ marginTop: 7 }}>
                        <MiniBars />
                    </div>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 9,
                            right: 9,
                            bottom: 8,
                            height: 18,
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                            animationName: 'ts-btn',
                        }}
                    >
                        <Share2 size={9} color={C.mutedFg} />
                        <T size={8} weight={700}>
                            Compartir
                        </T>
                    </span>
                </At>

                <At x={0} y={0} a="ts-flowl">
                    <Flow x1={180} y1={150} x2={160} y2={150} />
                </At>
                <At x={0} y={0} a="ts-flowr">
                    <Flow x1={300} y1={150} x2={320} y2={150} />
                </At>

                {/* Enlace público */}
                <At x={12} y={46} w={150} h={208} a="ts-left">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('blue', 0.16), color: tone('blue'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Globe size={11} />
                        </span>
                        <T size={9.5} weight={700}>
                            Enlace público
                        </T>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 24px -14px rgba(15,23,42,.45)' }}>
                        <div style={{ height: 20, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', background: C.muted }}>
                            <Lock size={8} color={C.mutedFg} />
                            <T size={7} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                tuempresa.com/…/d/x7k2q
                            </T>
                        </div>
                        <div style={{ padding: 8 }}>
                            <T size={8.5} weight={700} style={{ display: 'block' }}>
                                Ventas
                            </T>
                            <div style={{ marginTop: 6 }}>
                                <MiniBars />
                            </div>
                            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={7} color={C.mutedFg}>
                                    Sólo lectura · sin iniciar sesión
                                </T>
                                <T size={7} color={C.mutedFg}>
                                    Vence el 31/12/2026
                                </T>
                            </div>
                        </div>
                    </div>
                    <T size={7.5} color={C.mutedFg} style={{ display: 'block', marginTop: 6, whiteSpace: 'normal' }}>
                        Para tu socio, un cliente o una pantalla de la oficina.
                    </T>
                </At>

                {/* Envío por correo */}
                <At x={318} y={46} w={152} h={208} a="ts-right">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('mint', 0.16), color: tone('mint'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={11} />
                        </span>
                        <T size={9.5} weight={700}>
                            Envío por correo
                        </T>
                    </div>
                    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, boxShadow: '0 10px 24px -14px rgba(15,23,42,.45)' }}>
                        <T size={8} weight={700} style={{ display: 'block' }}>
                            Resumen de «Ventas»
                        </T>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                marginTop: 4,
                                height: 15,
                                padding: '0 6px',
                                borderRadius: 99,
                                background: tone('violet', 0.14),
                                color: tone('violet'),
                            }}
                        >
                            <CalendarClock size={8} />
                            <T size={7} weight={700} color={tone('violet')}>
                                Cada lunes · 8:00
                            </T>
                        </span>
                        <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {[
                                ['Pipeline', '$ 39,4 M'],
                                ['Ganadas', '7'],
                                ['Nuevas', '16'],
                            ].map(([k, v]) => (
                                <span key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, paddingBottom: 2 }}>
                                    <T size={7.5} color={C.mutedFg}>
                                        {k}
                                    </T>
                                    <T size={7.5} weight={700}>
                                        {v}
                                    </T>
                                </span>
                            ))}
                        </div>
                        <span
                            data-a=""
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                marginTop: 7,
                                height: 18,
                                padding: '0 7px',
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                                background: C.muted,
                                animationName: 'ts-pdf',
                            }}
                        >
                            <FileText size={9} color={tone('rose')} />
                            <T size={7.5} weight={600}>
                                Ventas.pdf
                            </T>
                        </span>
                    </div>
                    <T size={7.5} color={C.mutedFg} style={{ display: 'block', marginTop: 6, whiteSpace: 'normal' }}>
                        Para el equipo y correos de afuera, con su PDF.
                    </T>
                </At>
            </div>
        </Stage>
    );
}
