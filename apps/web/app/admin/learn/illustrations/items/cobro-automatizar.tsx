import { BadgeCheck, Link2, Mail, MessageCircle, PencilLine, PlusCircle } from 'lucide-react';

import { At, C, Flow, IconSquare, Keyframes, Stage, T, primary } from '../kit';

/**
 * Dos automatizaciones que cierran el ciclo de cobro: al crear la factura se
 * crea el link y se manda por WhatsApp; cuando el cliente paga, se marca la
 * factura y se le agradece con el monto y el medio.
 */

const CSS = `
@keyframes ca-a1{0%,4%{box-shadow:0 0 0 0 transparent}8%,14%{box-shadow:0 0 0 3px ${primary(0.35)}}18%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-a2{0%,16%{box-shadow:0 0 0 0 transparent}20%,26%{box-shadow:0 0 0 3px ${primary(0.35)}}30%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-a3{0%,28%{box-shadow:0 0 0 0 transparent}32%,38%{box-shadow:0 0 0 3px ${primary(0.35)}}42%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-b1{0%,48%{box-shadow:0 0 0 0 transparent}52%,58%{box-shadow:0 0 0 3px ${primary(0.35)}}62%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-b2{0%,60%{box-shadow:0 0 0 0 transparent}64%,70%{box-shadow:0 0 0 3px ${primary(0.35)}}74%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-b3{0%,72%{box-shadow:0 0 0 0 transparent}76%,82%{box-shadow:0 0 0 3px ${primary(0.35)}}86%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ca-right{0%,44%{opacity:.35}50%,100%{opacity:1}}
`;

type Tn = 'amber' | 'violet' | 'mint' | 'blue' | 'cyan' | 'rose';

function Step({ x, y, kicker, title, sub, icon, t, a }: { x: number; y: number; kicker: string; title: string; sub: string; icon: JSX.Element; t: Tn; a: string }): JSX.Element {
    return (
        <At x={x} y={y} w={210} h={54} a={a} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}>
            <IconSquare t={t} size={24}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={9} weight={600}>
                    {title}
                </T>
                <T size={7} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sub}
                </T>
            </span>
        </At>
    );
}

export default function CobroAutomatizar(): JSX.Element {
    return (
        <Stage label="Dos automatizaciones: al crear una factura se crea el link de pago y se manda por WhatsApp con {{pago.link}}; cuando se recibe el pago, la factura pasa a Pagada y sale un correo de agradecimiento con el monto y el medio de pago." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={14} y={12}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        COBRAR
                    </T>
                </At>
                <Flow x1={119} y1={86} x2={119} y2={106} />
                <Flow x1={119} y1={160} x2={119} y2={180} />
                <Step x={14} y={32} kicker="Cuando" title="Se crea un registro" sub="Lista Facturas" icon={<PlusCircle size={13} />} t="amber" a="ca-a1" />
                <Step x={14} y={106} kicker="Entonces" title="Crear link de pago" sub="Mercado Pago · {{monto}} COP" icon={<Link2 size={13} />} t="cyan" a="ca-a2" />
                <Step x={14} y={180} kicker="Después" title="Enviar WhatsApp" sub="Paga aquí: {{pago.link}}" icon={<MessageCircle size={13} />} t="mint" a="ca-a3" />

                <At x={256} y={0} w={224} h={300} a="ca-right">
                    <At x={0} y={12}>
                        <T size={8} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            AGRADECER
                        </T>
                    </At>
                    <Flow x1={105} y1={86} x2={105} y2={106} />
                    <Flow x1={105} y1={160} x2={105} y2={180} />
                    <Step x={0} y={32} kicker="Cuando" title="Se recibe un pago" sub="Confirmado con el proveedor" icon={<BadgeCheck size={13} />} t="violet" a="ca-b1" />
                    <Step x={0} y={106} kicker="Entonces" title="Actualizar un campo" sub="Estado = Pagada" icon={<PencilLine size={13} />} t="blue" a="ca-b2" />
                    <Step x={0} y={180} kicker="Después" title="Enviar email" sub="Gracias: {{pago.monto_pagado}} con {{pago.metodo}}" icon={<Mail size={13} />} t="rose" a="ca-b3" />
                </At>
                <At x={14} y={250} w={452} style={{ display: 'flex', justifyContent: 'center' }}>
                    <T size={7.5} color={C.mutedFg}>
                        Variables del pago: {'{{pago.link}} · {{pago.estado}} · {{pago.monto_pagado}} · {{pago.metodo}} · {{pago.fecha}}'}
                    </T>
                </At>
            </div>
        </Stage>
    );
}
