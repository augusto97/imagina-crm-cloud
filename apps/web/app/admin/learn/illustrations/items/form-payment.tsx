import { Building2, Check, CreditCard, Smartphone } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Cobrar al enviar un formulario (v0.1.361): la persona elige el plan, ve el
 * total cambiar, toca «Enviar y pagar», paga en la pasarela de la empresa y
 * su registro de la lista queda «Pagado».
 */

const CSS = `
@keyframes fpay-cur{
0%{transform:translate(130px,288px)}
10%,14%{transform:translate(170px,140px)}
32%,36%{transform:translate(122px,234px)}
54%,58%{transform:translate(360px,166px)}
78%,100%{transform:translate(130px,288px)}}
@keyframes fpay-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}17%,33%{opacity:0;transform:scale(1.6)}34%{opacity:1;transform:scale(1)}39%,55%{opacity:0;transform:scale(1.6)}56%{opacity:1;transform:scale(1)}61%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fpay-basic{0%,12%{opacity:1}14%,96%{opacity:0}100%{opacity:1}}
@keyframes fpay-prem{0%,12%{opacity:0}14%,96%{opacity:1}100%{opacity:0}}
@keyframes fpay-old{0%,12%{opacity:1}14%,96%{opacity:0}100%{opacity:1}}
@keyframes fpay-new{0%,12%{opacity:0;transform:translateY(4px)}16%,96%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fpay-gw{0%,35%{opacity:0;transform:translateX(16px) scale(.97)}40%,82%{opacity:1;transform:none}88%,100%{opacity:0;transform:translateX(16px) scale(.97)}}
@keyframes fpay-gwform{0%,56%{opacity:1}59%,100%{opacity:0}}
@keyframes fpay-gwok{0%,57%{opacity:0;transform:scale(.6)}61%,100%{opacity:1;transform:none}}
@keyframes fpay-opt{0%,46%{box-shadow:0 0 0 1px ${C.border};background:${C.card}}48%,100%{box-shadow:0 0 0 1.5px ${tone('blue')};background:${tone('blue', 0.08)}}}
@keyframes fpay-rec{0%,36%{opacity:0;transform:translateY(6px)}41%,96%{opacity:1;transform:none}100%{opacity:0}}
@keyframes fpay-pend{0%,62%{opacity:1}65%,100%{opacity:0}}
@keyframes fpay-paid{0%,62%{opacity:0;transform:scale(.7)}67%,96%{opacity:1;transform:none}100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)' } as const;

function Option({ label, price, active, a }: { label: string; price: string; active: boolean; a: string }): JSX.Element {
    return (
        <span style={{ position: 'relative', flex: 1, height: 38, display: 'block' }}>
            {/* Base sin elegir. */}
            <span style={{ position: 'absolute', inset: 0, borderRadius: 6, border: `1px solid ${C.border}`, background: C.card }} />
            {/* Elegida (aparece con su animación). */}
            <span
                data-a=""
                style={{ position: 'absolute', inset: 0, borderRadius: 6, border: `1.5px solid ${primary()}`, background: primary(0.1), opacity: active ? 1 : 0, animationName: a }}
            />
            <span style={{ position: 'absolute', left: 8, top: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <T size={7.5} weight={700}>
                    {label}
                </T>
                <T size={6.8} color={C.mutedFg}>
                    {price}
                </T>
            </span>
        </span>
    );
}

export default function FormPayment(): JSX.Element {
    return (
        <Stage
            label="Cobrar al enviar: la persona elige el plan Premium, el total pasa de 30.000 a 80.000, toca Enviar y pagar, paga en la pasarela de la empresa y su registro queda Pagado."
            cycle={10}
            tint="mint"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El formulario */}
                <At x={18} y={24} w={222} h={252} style={CARD}>
                    <At x={14} y={12} w={194} h={4} style={{ borderRadius: 99, background: primary() }} />
                    <At x={14} y={24}>
                        <T size={9} weight={800}>
                            Inscripción al taller
                        </T>
                    </At>
                    <At x={14} y={44}>
                        <T size={7} weight={600}>
                            Nombre
                        </T>
                        <At x={0} y={11} w={194} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7}>Ana Gómez</T>
                        </At>
                    </At>
                    <At x={14} y={84}>
                        <T size={7} weight={600}>
                            Plan
                        </T>
                        <At x={0} y={11} w={194} style={{ display: 'flex', gap: 6 }}>
                            <Option label="Básico" price="30.000" active={false} a="fpay-basic" />
                            <Option label="Premium" price="80.000" active a="fpay-prem" />
                        </At>
                    </At>
                    {/* Total a pagar en vivo */}
                    <At x={14} y={148} w={194} h={34} style={{ borderRadius: 6, background: C.muted, display: 'flex', alignItems: 'center', padding: '0 9px' }}>
                        <T size={7.5} color={C.mutedFg}>
                            Total a pagar
                        </T>
                        <span style={{ position: 'relative', marginLeft: 'auto', width: 84, height: 16 }}>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, opacity: 0, animationName: 'fpay-old' }}>
                                <T size={11} weight={800}>
                                    30.000 COP
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, animationName: 'fpay-new' }}>
                                <T size={11} weight={800}>
                                    80.000 COP
                                </T>
                            </span>
                        </span>
                    </At>
                    <At x={14} y={196} w={194} h={26} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8} weight={700} color={C.primaryFg}>
                            Enviar y pagar
                        </T>
                    </At>
                    <At x={14} y={230} w={194} style={{ display: 'flex', justifyContent: 'center' }}>
                        <T size={6.3} color={C.mutedFg}>
                            El pago va a la cuenta de la empresa
                        </T>
                    </At>
                </At>

                {/* La pasarela de la empresa */}
                <At x={258} y={26} w={204} h={176} a="fpay-gw" style={{ ...CARD, opacity: 0, overflow: 'hidden', borderRadius: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px', background: tone('blue', 0.1), borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 99, background: tone('blue'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <CreditCard size={9} />
                        </span>
                        <T size={8} weight={800}>
                            Pago seguro
                        </T>
                        <T size={8} weight={800} style={{ marginLeft: 'auto' }}>
                            80.000 COP
                        </T>
                    </div>
                    <At x={11} y={36} w={182} a="fpay-gwform" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <T size={6.8} color={C.mutedFg}>
                            Inscripción de Ana Gómez
                        </T>
                        {(
                            [
                                ['PSE · débito bancario', <Building2 key="b" size={9} />],
                                ['Tarjeta', <CreditCard key="c" size={9} />],
                                ['Nequi', <Smartphone key="n" size={9} />],
                            ] as const
                        ).map(([l, icon], i) => (
                            <span
                                key={l}
                                data-a={i === 0 ? '' : undefined}
                                style={{ height: 19, borderRadius: 5, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', boxShadow: `0 0 0 1px ${C.border}`, animationName: i === 0 ? 'fpay-opt' : undefined }}
                            >
                                <span style={{ color: C.mutedFg, display: 'flex' }}>{icon}</span>
                                <T size={7.3}>{l}</T>
                            </span>
                        ))}
                        <span style={{ marginTop: 3, height: 22, borderRadius: 6, background: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8} weight={700} color="#fff">
                                Pagar 80.000 COP
                            </T>
                        </span>
                    </At>
                    <At x={0} y={52} w={204} a="fpay-gwok" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 99, background: tone('mint'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={20} strokeWidth={3} />
                        </span>
                        <T size={10} weight={800}>
                            Pago aprobado
                        </T>
                        <T size={7} color={C.mutedFg}>
                            Recibimos tu pago.
                        </T>
                    </At>
                </At>

                {/* El registro en la lista */}
                <At x={258} y={210} w={204} h={66} a="fpay-rec" style={CARD}>
                    <At x={10} y={9}>
                        <T size={6.3} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            EN TU LISTA DE INSCRIPCIONES
                        </T>
                    </At>
                    <At x={10} y={25}>
                        <T size={8} weight={700}>
                            Ana Gómez
                        </T>
                    </At>
                    <At x={10} y={41}>
                        <T size={7} color={C.mutedFg}>
                            Premium · 80.000 COP
                        </T>
                    </At>
                    <span style={{ position: 'absolute', right: 10, top: 25, width: 70, height: 16 }}>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, opacity: 0, animationName: 'fpay-pend' }}>
                            <Chip label="Pendiente" t="amber" style={{ height: 15, fontSize: 7, padding: '0 6px' }} />
                        </span>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, animationName: 'fpay-paid' }}>
                            <Chip label="Pagado" t="mint" style={{ height: 15, fontSize: 7, padding: '0 6px' }} />
                        </span>
                    </span>
                </At>

                <Cursor a="fpay-cur" click="fpay-ring" rest={[130, 288]} />
            </At>
        </Stage>
    );
}
