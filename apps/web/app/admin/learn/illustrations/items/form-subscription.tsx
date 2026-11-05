import { Check, CreditCard, Repeat } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Suscribir al enviar un formulario (v0.1.368): la persona elige el plan
 * anual, toca «Enviar y suscribirme», autoriza su tarjeta en Mercado Pago
 * una sola vez y en su portal la suscripción aparece «Al día» con el
 * próximo cobro.
 */

const CSS = `
@keyframes fsub-cur{
0%{transform:translate(130px,288px)}
10%,14%{transform:translate(176px,146px)}
32%,36%{transform:translate(122px,236px)}
54%,58%{transform:translate(358px,170px)}
78%,100%{transform:translate(130px,288px)}}
@keyframes fsub-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}17%,33%{opacity:0;transform:scale(1.6)}34%{opacity:1;transform:scale(1)}39%,55%{opacity:0;transform:scale(1.6)}56%{opacity:1;transform:scale(1)}61%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fsub-pick{0%,12%{opacity:0}14%,96%{opacity:1}100%{opacity:0}}
@keyframes fsub-dot{0%,12%{transform:scale(0)}15%,96%{transform:scale(1)}100%{transform:scale(0)}}
@keyframes fsub-mp{0%,35%{opacity:0;transform:translateX(16px) scale(.97)}40%,82%{opacity:1;transform:none}88%,100%{opacity:0;transform:translateX(16px) scale(.97)}}
@keyframes fsub-mpform{0%,56%{opacity:1}59%,100%{opacity:0}}
@keyframes fsub-mpok{0%,57%{opacity:0;transform:scale(.6)}61%,100%{opacity:1;transform:none}}
@keyframes fsub-portal{0%,60%{opacity:0;transform:translateY(6px)}65%,96%{opacity:1;transform:none}100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)' } as const;

function Plan({ name, price, extra, a }: { name: string; price: string; extra?: string; a?: string }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'block', height: 34 }}>
            <span style={{ position: 'absolute', inset: 0, borderRadius: 6, border: `1px solid ${C.border}`, background: C.card }} />
            {a && (
                <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 6, border: `1.5px solid ${primary()}`, background: primary(0.08), opacity: 0, animationName: a }} />
            )}
            {/* El círculo de la opción. */}
            <span style={{ position: 'absolute', left: 8, top: 9, width: 11, height: 11, borderRadius: 99, border: `1.3px solid ${a ? primary() : C.mutedFg}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {a && <span data-a="" style={{ width: 5, height: 5, borderRadius: 99, background: primary(), transform: 'scale(0)', animationName: 'fsub-dot' }} />}
            </span>
            <span style={{ position: 'absolute', left: 25, top: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <T size={7.5} weight={700}>
                    {name}
                </T>
                {extra && (
                    <T size={6.3} weight={600} color={primary()}>
                        {extra}
                    </T>
                )}
            </span>
            <span style={{ position: 'absolute', right: 8, top: 7 }}>
                <T size={7.5} weight={800}>
                    {price}
                </T>
            </span>
        </span>
    );
}

export default function FormSubscription(): JSX.Element {
    return (
        <Stage
            label="Suscribir al enviar: la persona elige el plan anual, toca Enviar y suscribirme, autoriza su tarjeta una sola vez en Mercado Pago y en su portal la suscripción queda Al día con el próximo cobro."
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
                            Únete al gimnasio
                        </T>
                    </At>
                    <At x={14} y={44}>
                        <T size={7} weight={600}>
                            Correo
                        </T>
                        <At x={0} y={11} w={194} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7}>ana@correo.co</T>
                        </At>
                    </At>
                    <At x={14} y={84} w={194}>
                        <T size={7} weight={600}>
                            Elige tu plan
                        </T>
                        <At x={0} y={11} w={194} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Plan name="Mensual" price="150.000 / mes" />
                            <Plan name="Anual" price="1.500.000 / año" extra="7 días gratis" a="fsub-pick" />
                        </At>
                    </At>
                    <At x={14} y={176} w={194}>
                        <T size={6.3} color={C.mutedFg}>
                            Al enviar, autorizas el débito automático.
                        </T>
                    </At>
                    <At x={14} y={198} w={194} h={26} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8} weight={700} color={C.primaryFg}>
                            Enviar y suscribirme
                        </T>
                    </At>
                </At>

                {/* Mercado Pago: autorizar la tarjeta una vez */}
                <At x={258} y={26} w={204} h={176} a="fsub-mp" style={{ ...CARD, opacity: 0, overflow: 'hidden', borderRadius: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px', background: tone('blue', 0.1), borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 99, background: tone('blue'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Repeat size={9} />
                        </span>
                        <T size={8} weight={800}>
                            Débito automático
                        </T>
                    </div>
                    <At x={11} y={36} w={182} a="fsub-mpform" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={7.5} weight={700}>
                            Anual · 1.500.000 COP cada año
                        </T>
                        <T size={6.8} color={C.mutedFg}>
                            Se cobra solo cada período. Puedes cancelarlo cuando quieras.
                        </T>
                        <span style={{ height: 21, borderRadius: 5, display: 'flex', alignItems: 'center', gap: 6, padding: '0 7px', boxShadow: `0 0 0 1px ${C.border}` }}>
                            <span style={{ color: C.mutedFg, display: 'flex' }}>
                                <CreditCard size={9} />
                            </span>
                            <T size={7.3}>Tarjeta •••• 4242</T>
                        </span>
                        <span style={{ marginTop: 2, height: 22, borderRadius: 6, background: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8} weight={700} color="#fff">
                                Autorizar
                            </T>
                        </span>
                    </At>
                    <At x={0} y={50} w={204} a="fsub-mpok" style={{ opacity: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 36, height: 36, borderRadius: 99, background: tone('mint'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={20} strokeWidth={3} />
                        </span>
                        <T size={10} weight={800}>
                            Suscripción activa
                        </T>
                        <T size={7} color={C.mutedFg}>
                            ¡Gracias, Ana!
                        </T>
                    </At>
                </At>

                {/* Lo que ve en su portal */}
                <At x={258} y={210} w={204} h={66} a="fsub-portal" style={{ ...CARD, opacity: 0 }}>
                    <At x={10} y={9}>
                        <T size={6.3} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            EN SU PORTAL · PAGOS
                        </T>
                    </At>
                    <At x={10} y={25}>
                        <T size={8} weight={700}>
                            Anual
                        </T>
                    </At>
                    <At x={10} y={41}>
                        <T size={7} color={C.mutedFg}>
                            Próximo cobro: 5 de dic.
                        </T>
                    </At>
                    <span style={{ position: 'absolute', right: 10, top: 25 }}>
                        <Chip label="Al día" t="mint" style={{ height: 15, fontSize: 7, padding: '0 6px' }} />
                    </span>
                </At>

                <Cursor a="fsub-cur" click="fsub-ring" rest={[130, 288]} />
            </At>
        </Stage>
    );
}
