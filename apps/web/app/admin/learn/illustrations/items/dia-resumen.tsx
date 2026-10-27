import { Mail, Send } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Preferencias de avisos: se enciende el «Resumen diario por correo» y a la
 * hora elegida llega un solo correo con lo vencido, lo de hoy y los avisos
 * sin leer.
 */

const CSS = `
@keyframes rs-knob{0%,14%{transform:translateX(0)}18%,92%{transform:translateX(12px)}97%,100%{transform:translateX(0)}}
@keyframes rs-track{0%,14%{background:${C.border}}18%,92%{background:${primary()}}97%,100%{background:${C.border}}}
@keyframes rs-opts{0%,16%{opacity:.35}20%,92%{opacity:1}97%,100%{opacity:.35}}
@keyframes rs-env{0%,28%{opacity:0;transform:translate(0,0) scale(.6)}32%{opacity:1;transform:translate(0,0) scale(1)}44%{opacity:1;transform:translate(110px,-10px) scale(1)}48%,100%{opacity:0;transform:translate(118px,-10px) scale(.7)}}
@keyframes rs-mail{0%,44%{opacity:0;transform:translateY(10px) scale(.97)}50%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes rs-l1{0%,52%{opacity:0;transform:translateX(-6px)}56%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes rs-l2{0%,58%{opacity:0;transform:translateX(-6px)}62%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes rs-l3{0%,64%{opacity:0;transform:translateX(-6px)}68%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes rs-cell{0%,6%{background:transparent}8%,92%{background:${primary()}}}
`;

const KINDS: Array<[string, boolean, boolean, boolean]> = [
    ['Te mencionan', true, true, false],
    ['Te asignan un registro', true, true, false],
    ['Cambia un registro que sigues', false, false, true],
    ['Tus recordatorios', true, true, false],
];

function Box({ on, a }: { on: boolean; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${on ? primary() : C.mutedFg}`, background: on ? primary() : 'transparent', color: C.primaryFg, fontSize: 8, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: a }}>
            {on || a ? '✓' : ''}
        </span>
    );
}

export default function DiaResumen(): JSX.Element {
    return (
        <Stage label="En Ajustes, Avisos, se eligen qué avisos llegan por correo y por push y se enciende el resumen diario; a las 7:00 llega un solo correo con lo vencido, lo de hoy y los avisos sin leer." tint="mint">
            <Keyframes css={CSS} />
            {/* Preferencias */}
            <At x={16} y={18} w={232} h={264} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -22px rgba(15,23,42,.5)', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <T size={11} weight={700}>
                    Avisos
                </T>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ flex: 1 }}>
                        Qué te llega, y por dónde
                    </T>
                    <T size={7} color={C.mutedFg} style={{ width: 28, textAlign: 'center' }}>
                        Correo
                    </T>
                    <T size={7} color={C.mutedFg} style={{ width: 24, textAlign: 'center' }}>
                        Push
                    </T>
                </div>
                {KINDS.map(([k, mail, push, anim]) => (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18 }}>
                        <T size={8.5} style={{ flex: 1 }}>
                            {k}
                        </T>
                        <span style={{ width: 28, display: 'flex', justifyContent: 'center' }}>
                            <Box on={mail} a={anim ? 'rs-cell' : undefined} />
                        </span>
                        <span style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                            <Box on={push} />
                        </span>
                    </div>
                ))}
                <div style={{ height: 1, background: C.border, margin: '3px 0' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span data-a="" style={{ position: 'relative', width: 24, height: 12, borderRadius: 99, background: primary(), animationName: 'rs-track', flexShrink: 0 }}>
                        <span data-a="" style={{ position: 'absolute', left: 2, top: 2, width: 8, height: 8, borderRadius: 99, background: '#fff', transform: 'translateX(12px)', animationName: 'rs-knob' }} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={9} weight={700}>
                            Resumen diario por correo
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Si no hay nada, no llega.
                        </T>
                    </span>
                </div>
                <div data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 6, animationName: 'rs-opts' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <T size={8} color={C.mutedFg}>
                            A las
                        </T>
                        <span style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, border: `1px solid ${C.border}` }}>7:00</span>
                    </span>
                    <span style={{ display: 'flex', gap: 3 }}>
                        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
                            <span key={i} style={{ width: 18, height: 18, borderRadius: 5, fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i < 5 ? primary(0.14) : 'transparent', color: i < 5 ? primary() : C.mutedFg, border: `1px solid ${i < 5 ? primary(0.4) : C.border}` }}>
                                {d}
                            </span>
                        ))}
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Hora de la empresa (America/Bogota)
                    </T>
                </div>
            </At>

            {/* Sobre volando */}
            <At x={208} y={170} a="rs-env" style={{ opacity: 0, zIndex: 5, color: primary() }}>
                <span style={{ width: 30, height: 30, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 22px -10px rgba(15,23,42,.6)' }}>
                    <Send size={14} />
                </span>
            </At>

            {/* El correo */}
            <At x={262} y={30} w={204} h={242} a="rs-mail" style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 20px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 11px', borderBottom: `1px solid ${C.border}` }}>
                    <Mail size={11} color={C.mutedFg} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={8.5} weight={700}>
                            Tu resumen de hoy
                        </T>
                        <T size={7} color={C.mutedFg}>
                            Café Aurora · 7:00 a. m.
                        </T>
                    </span>
                </div>
                <div style={{ height: 6, background: primary() }} />
                <div style={{ padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {[
                        { a: 'rs-l1', t: 'rose' as const, title: 'Vencido (2)', items: ['Llamar a Clínica Norte', 'Factura FAC-1040'] },
                        { a: 'rs-l2', t: 'amber' as const, title: 'Vence hoy (3)', items: ['Enviar cotización', 'Revisar contrato'] },
                        { a: 'rs-l3', t: 'violet' as const, title: 'Avisos sin leer (4)', items: ['Ana te mencionó en «Hotel Brisas»'] },
                    ].map((g) => (
                        <div key={g.title} data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 3, animationName: g.a }}>
                            <T size={8.5} weight={700} color={tone(g.t)}>
                                {g.title}
                            </T>
                            {g.items.map((it) => (
                                <span key={it} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: 99, background: tone(g.t) }} />
                                    <T size={8}>{it}</T>
                                </span>
                            ))}
                        </div>
                    ))}
                    <span style={{ alignSelf: 'flex-start', marginTop: 2, fontSize: 8, fontWeight: 700, color: C.primaryFg, background: primary(), borderRadius: 6, padding: '4px 9px' }}>Abrir Mi trabajo</span>
                </div>
            </At>
        </Stage>
    );
}
