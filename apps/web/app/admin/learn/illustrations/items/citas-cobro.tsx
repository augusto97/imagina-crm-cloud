import { CalendarCheck, Check, Clock, CreditCard, Mail, MousePointer2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * v0.1.387 — Cobrar al agendar: el cliente elige el horario, la cita queda
 * «Esperando el pago» con el horario apartado unos minutos, paga el anticipo en
 * la pasarela de la empresa y la cita se confirma sola (con el correo y el
 * evento para el calendario).
 */

const CSS = `
@keyframes cp-slots{0%,26%{opacity:1}30%,100%{opacity:0}}
@keyframes cp-pick{0%,10%{opacity:0;transform:translate(14px,10px)}16%{opacity:1;transform:none}20%,23%{opacity:1;transform:scale(.88)}26%,100%{opacity:0}}
@keyframes cp-slot-on{0%,20%{background:transparent}22%,30%{background:var(--cp-on)}}
@keyframes cp-unpaid{0%,30%{opacity:0;transform:translateY(6px)}36%,58%{opacity:1;transform:none}62%,100%{opacity:0}}
@keyframes cp-timer{0%,36%{width:100%}58%,100%{width:62%}}
@keyframes cp-pay{0%,40%{opacity:0;transform:translateY(6px)}46%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes cp-hand{0%,48%{opacity:0;transform:translate(14px,10px)}53%{opacity:1;transform:none}57%,60%{opacity:1;transform:scale(.88)}64%,100%{opacity:0}}
@keyframes cp-btn{0%,59%{opacity:1}63%,100%{opacity:0}}
@keyframes cp-paid{0%,60%{opacity:0;transform:translateY(4px)}66%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes cp-ok{0%,62%{opacity:0;transform:translateY(6px)}68%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
@keyframes cp-mail{0%,72%{opacity:0;transform:scale(.6)}80%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
`;

const card = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)' } as const;
const SLOTS = ['09:00', '09:30', '10:00', '10:30'];

export default function CitasCobro(): JSX.Element {
    return (
        <Stage
            label="Cobrar al agendar: el cliente elige el horario, la cita queda «Esperando el pago» con el horario apartado unos minutos, paga el anticipo con la pasarela de la empresa y la cita se confirma sola con su correo de confirmación."
            tint="mint"
            cycle={10}
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2, ['--cp-on' as string]: tone('mint', 0.18) }}>
                {/* La página pública: elegir el horario y esperar el pago */}
                <At x={16} y={26} w={210} h={252} style={{ ...card, padding: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CalendarCheck size={11} color={tone('mint')} />
                        <T size={8.5} weight={800}>
                            Limpieza dental · $ 80.000
                        </T>
                    </span>
                    <At x={12} y={34} w={186} h={130} a="cp-slots" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={7} color={C.mutedFg}>
                            Jueves 12 · elige la hora
                        </T>
                        <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            {SLOTS.map((s, i) => (
                                <span
                                    key={s}
                                    data-a={i === 2 ? '' : undefined}
                                    style={{
                                        borderRadius: 6,
                                        border: `1px solid ${i === 2 ? tone('mint') : C.border}`,
                                        padding: '6px 0',
                                        textAlign: 'center',
                                        ...(i === 2 ? { animationName: 'cp-slot-on' } : {}),
                                    }}
                                >
                                    <T size={7.5} weight={700}>
                                        {s}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Para confirmar se paga un anticipo del 50 %.
                        </T>
                        <At x={130} y={62} a="cp-pick">
                            <MousePointer2 size={13} color={C.fg} fill={C.card} />
                        </At>
                    </At>
                    <At x={12} y={34} w={186} h={160} a="cp-unpaid" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 99, background: tone('amber', 0.16) }}>
                            <Clock size={15} color={tone('amber')} />
                        </span>
                        <T size={9} weight={800}>
                            Completa el pago
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Apartamos tu horario 30 minutos. Anticipo: $ 40.000 COP.
                        </T>
                        <span style={{ alignSelf: 'flex-start', borderRadius: 99, background: tone('amber', 0.16), padding: '2px 8px' }}>
                            <T size={6.5} weight={700} color={tone('amber')}>
                                Esperando el pago
                            </T>
                        </span>
                        <span style={{ height: 5, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'block', height: '100%', borderRadius: 99, background: tone('amber'), animationName: 'cp-timer' }} />
                        </span>
                    </At>
                    <At x={12} y={34} w={186} h={160} a="cp-ok" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 99, background: tone('mint', 0.16) }}>
                            <Check size={15} color={tone('mint')} />
                        </span>
                        <T size={9} weight={800}>
                            ¡Listo! Tu cita está confirmada
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Jueves 12 · 10:00. Recibimos tu pago de $ 40.000 COP.
                        </T>
                    </At>
                </At>

                {/* La pasarela de la empresa */}
                <At x={242} y={26} w={222} h={150} a="cp-pay" style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CreditCard size={11} color={tone('blue')} />
                        <T size={8.5} weight={800}>
                            Pago seguro
                        </T>
                        <T size={6.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                            Mercado Pago · Wompi · PayPal
                        </T>
                    </span>
                    <T size={7} color={C.mutedFg}>
                        Anticipo · Limpieza dental
                    </T>
                    <T size={13} weight={800}>
                        $ 40.000
                    </T>
                    <span style={{ position: 'relative', height: 24 }}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 6, background: tone('blue'), animationName: 'cp-btn' }}>
                            <T size={7.5} weight={700} color="#fff">
                                Pagar con PSE
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 5, animationName: 'cp-paid' }}>
                            <Check size={10} color={tone('mint')} />
                            <T size={7.5} weight={700}>
                                Pago aprobado
                            </T>
                        </span>
                    </span>
                    <At x={110} y={108} a="cp-hand">
                        <MousePointer2 size={13} color={C.fg} fill={C.card} />
                    </At>
                </At>
                <At x={242} y={190} w={222} h={64} a="cp-mail" style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: tone('mint', 0.16) }}>
                        <Mail size={13} color={tone('mint')} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={800}>
                            Tu cita está confirmada
                        </T>
                        <T size={6.5} color={C.mutedFg}>
                            La cita se confirmó sola al llegar el pago
                        </T>
                    </span>
                </At>
            </At>
        </Stage>
    );
}
