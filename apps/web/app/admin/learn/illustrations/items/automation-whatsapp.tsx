import { CalendarClock, CheckCheck, Filter, MessageCircle, Send } from 'lucide-react';

import { At, Bubble, C, Flow, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/** Una automatización: vence una factura → si sigue pendiente → sale un WhatsApp al cliente. */

const CSS = `
@keyframes aw-step1{0%,4%{box-shadow:0 0 0 0 transparent}8%,16%{box-shadow:0 0 0 3px ${primary(0.35)}}22%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aw-step2{0%,22%{box-shadow:0 0 0 0 transparent}27%,34%{box-shadow:0 0 0 3px ${primary(0.35)}}40%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aw-step3{0%,40%{box-shadow:0 0 0 0 transparent}45%,52%{box-shadow:0 0 0 3px ${primary(0.35)}}58%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aw-ok{0%,28%{opacity:0;transform:scale(.4)}33%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes aw-dot{0%,14%{opacity:0;transform:translate(0,0)}16%{opacity:1}26%{opacity:1;transform:translate(0,76px)}28%,34%{opacity:0;transform:translate(0,76px)}36%{opacity:1;transform:translate(0,76px)}46%{opacity:1;transform:translate(0,152px)}48%,100%{opacity:0;transform:translate(0,152px)}}
@keyframes aw-plane{0%,50%{opacity:0;transform:translate(0,0) scale(.6)}53%{opacity:1}62%{opacity:1;transform:translate(96px,-70px) scale(1)}65%,100%{opacity:0;transform:translate(96px,-70px)}}
@keyframes aw-msg{0%,62%{opacity:0;transform:translateY(8px) scale(.96)}67%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes aw-read{0%,76%{color:${C.mutedFg}}80%,100%{color:${tone('blue')}}}
@keyframes aw-badge{0%,66%{opacity:0;transform:scale(.6)}70%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Step({
    y,
    kicker,
    title,
    icon,
    t,
    a,
}: {
    y: number;
    kicker: string;
    title: string;
    icon: JSX.Element;
    t: 'amber' | 'violet' | 'mint';
    a: string;
}): JSX.Element {
    return (
        <At
            x={26}
            y={y}
            w={206}
            h={50}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 11,
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '0 11px',
                boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)',
            }}
        >
            <IconSquare t={t} size={26}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={10.5} weight={600}>
                    {title}
                </T>
            </span>
        </At>
    );
}

export default function AutomationWhatsapp(): JSX.Element {
    return (
        <Stage label="Una automatización de tres pasos: cuando vence una factura y sigue pendiente, la app le manda un WhatsApp al cliente con el enlace de pago." tint="mint">
            <Keyframes css={CSS} />
            <Flow x1={129} y1={86} x2={129} y2={112} />
            <Flow x1={129} y1={162} x2={129} y2={188} />
            <Step y={36} kicker="Cuando" title="Vence una factura" icon={<CalendarClock size={14} />} t="amber" a="aw-step1" />
            <Step y={112} kicker="Si" title="Estado es «Pendiente»" icon={<Filter size={14} />} t="violet" a="aw-step2" />
            <Step y={188} kicker="Entonces" title="Enviar WhatsApp al cliente" icon={<MessageCircle size={14} />} t="mint" a="aw-step3" />
            <At x={210} y={124} a="aw-ok" style={{ opacity: 1 }}>
                <span
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 99,
                        background: C.success,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                    }}
                >
                    ✓
                </span>
            </At>
            {/* El «pulso» que recorre el flujo */}
            <At x={125} y={84} a="aw-dot" style={{ opacity: 0 }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
            <At x={236} y={206} a="aw-plane" style={{ opacity: 0, color: primary() }}>
                <Send size={16} />
            </At>

            {/* El teléfono del cliente */}
            <At
                x={300}
                y={22}
                w={156}
                h={258}
                style={{
                    borderRadius: 22,
                    background: C.card,
                    border: `5px solid ${C.fg}`,
                    overflow: 'hidden',
                    boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)',
                }}
            >
                <div style={{ height: 34, background: '#128C7E', display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 99, background: 'rgba(255,255,255,.35)' }} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={9} weight={700} color="#fff">
                            Tu empresa
                        </T>
                        <T size={7.5} weight={500} color="rgba(255,255,255,.8)">
                            en línea
                        </T>
                    </span>
                </div>
                <div style={{ position: 'relative', height: 214, background: tone('mint', 0.08), padding: 8 }}>
                    <At x={8} y={14} a="aw-msg" style={{ opacity: 1 }}>
                        <Bubble side="left" style={{ maxWidth: 128 }}>
                            Hola Ana 👋 tu factura <b>FAC-0042</b> por <b style={{ whiteSpace: "nowrap" }}>$ 450.000</b> vence hoy. Puedes pagarla aquí:
                            <span style={{ display: 'block', marginTop: 3, color: tone('blue'), fontWeight: 600 }}>pagar.link/fac-0042</span>
                            <span data-a="" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, marginTop: 2, animationName: 'aw-read', color: tone('blue') }}>
                                <T size={7} color={C.mutedFg}>
                                    9:00
                                </T>
                                <CheckCheck size={11} />
                            </span>
                        </Bubble>
                    </At>
                </div>
            </At>
            <At x={430} y={14} a="aw-badge" style={{ opacity: 1 }}>
                <span
                    style={{
                        minWidth: 18,
                        height: 18,
                        borderRadius: 99,
                        background: C.destructive,
                        color: '#fff',
                        fontSize: 9,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 6px rgba(0,0,0,.25)',
                    }}
                >
                    1
                </span>
            </At>
        </Stage>
    );
}
