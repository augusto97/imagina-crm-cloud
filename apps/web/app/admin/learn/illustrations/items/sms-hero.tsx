import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Avatar, Bubble, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * Portada de «SMS»: desde el registro sale un SMS, llega al teléfono del
 * cliente y el estado del registro pasa de «En cola» a «Enviado» y a
 * «Entregado» con el aviso del proveedor.
 */

const CSS = `
@keyframes sm-out{0%,10%{opacity:0;transform:translateY(8px) scale(.96)}16%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes sm-st1{0%,8%{opacity:1}12%,100%{opacity:0}}
@keyframes sm-st2{0%,10%{opacity:0}13%,42%{opacity:1}45%,100%{opacity:0}}
@keyframes sm-st3{0%,43%{opacity:0}46%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sm-row{0%,40%{background:transparent}46%{background:${tone('mint', 0.16)}}60%,100%{background:transparent}}
@keyframes sm-date{0%,12%{opacity:0}16%,92%{opacity:1}97%,100%{opacity:0}}
`;

function Status({ text, color, a }: { text: string; color: string; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ animationName: a, position: 'absolute', left: 0, top: 0, opacity: 0 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', borderRadius: 5, background: color, color: '#fff', fontSize: 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {text}
            </span>
        </span>
    );
}

export default function SmsHero(): JSX.Element {
    return (
        <Stage label="Desde el registro sale un SMS, llega al teléfono del cliente y el estado del registro pasa de En cola a Enviado y a Entregado." tint="cyan">
            <Keyframes css={CSS} />

            <At
                x={20}
                y={62}
                w={262}
                h={176}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)' }}
            >
                <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <Avatar initials="LP" t="amber" size={24} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10.5} weight={700}>
                            Luis Pérez
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Pedidos · +57 300 111 2233
                        </T>
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                        <IntegrationLogo integrationKey="sms_twilio" size={22} />
                    </span>
                </div>
                <div data-a="" style={{ animationName: 'sm-row', padding: '12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <T size={8} weight={600} color={C.mutedFg}>
                                Estado del último SMS
                            </T>
                            <span style={{ position: 'relative', height: 16 }}>
                                <Status text="En cola" color="#94A3B8" a="sm-st1" />
                                <Status text="Enviado" color="#64748B" a="sm-st2" />
                                <Status text="Entregado" color="#22C55E" a="sm-st3" />
                            </span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <T size={8} weight={600} color={C.mutedFg}>
                                Último SMS
                            </T>
                            <span data-a="" style={{ animationName: 'sm-date', opacity: 0 }}>
                                <T size={9.5}>29/10/2026 10:30 a. m.</T>
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={8} weight={600} color={C.mutedFg}>
                            Actividad
                        </T>
                        <T size={9} style={{ whiteSpace: 'normal' }}>
                            Se envió un SMS a +57 300…, 1 segmento
                        </T>
                    </span>
                </div>
            </At>

            <At
                x={312}
                y={18}
                w={150}
                h={264}
                style={{ borderRadius: 22, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)' }}
            >
                <div style={{ height: 32, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8.5} weight={700}>
                        CafeAurora
                    </T>
                </div>
                <div style={{ position: 'relative', height: 222, background: tone('cyan', 0.06) }}>
                    <At x={7} y={12} a="sm-out" style={{ opacity: 1 }}>
                        <Bubble side="left" color={C.muted} style={{ maxWidth: 124 }}>
                            Hola Luis, tu pedido #1042 ya está listo para recoger. Te esperamos.
                        </Bubble>
                    </At>
                </div>
            </At>
        </Stage>
    );
}
