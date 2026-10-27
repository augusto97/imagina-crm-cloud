import { CheckCheck } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Avatar, Bubble, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * Portada de «WhatsApp Business oficial»: sale una plantilla aprobada, Meta
 * avisa que se entregó y se leyó, el cliente contesta, y el registro del
 * contacto en la app muestra el último mensaje y el estado del envío.
 */

const CSS = `
@keyframes wh-out{0%,6%{opacity:0;transform:translateY(8px) scale(.96)}12%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes wh-tick{0%,24%{color:${C.mutedFg}}30%,100%{color:${tone('blue')}}}
@keyframes wh-in{0%,44%{opacity:0;transform:translateY(8px) scale(.96)}50%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes wh-st1{0%,12%{opacity:0}15%,22%{opacity:1}24%,100%{opacity:0}}
@keyframes wh-st2{0%,22%{opacity:0}24%,30%{opacity:1}32%,100%{opacity:0}}
@keyframes wh-st3{0%,30%{opacity:0}32%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes wh-m1{0%,50%{opacity:1}54%,100%{opacity:0}}
@keyframes wh-m2{0%,52%{opacity:0}56%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes wh-dir1{0%,50%{opacity:1}54%,100%{opacity:0}}
@keyframes wh-dir2{0%,52%{opacity:0}56%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes wh-row{0%,10%{background:transparent}14%{background:${tone('mint', 0.14)}}22%{background:transparent}50%{background:transparent}55%{background:${tone('mint', 0.14)}}66%,100%{background:transparent}}
`;

function Chip({ text, color }: { text: string; color: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', borderRadius: 5, background: color, color: '#fff', fontSize: 8.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {text}
        </span>
    );
}

export default function WabHero(): JSX.Element {
    return (
        <Stage label="Sale una plantilla de WhatsApp aprobada, Meta avisa que se entregó y se leyó, el cliente contesta y el registro del contacto muestra el último mensaje y el estado del envío." tint="mint">
            <Keyframes css={CSS} />

            {/* El registro del contacto en la app */}
            <At
                x={20}
                y={58}
                w={262}
                h={184}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)' }}
            >
                <div style={{ height: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <Avatar initials="AG" t="rose" size={24} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10.5} weight={700}>
                            Ana Gómez
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Clientes · +57 310 222 3344
                        </T>
                    </span>
                    <span style={{ marginLeft: 'auto' }}>
                        <IntegrationLogo integrationKey="whatsapp_cloud" size={22} />
                    </span>
                </div>
                <div data-a="" style={{ animationName: 'wh-row', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={8} weight={600} color={C.mutedFg}>
                            Último mensaje de WhatsApp
                        </T>
                        <span style={{ position: 'relative', height: 26 }}>
                            <span data-a="" style={{ animationName: 'wh-m1', position: 'absolute', inset: 0, opacity: 0 }}>
                                <T size={9.5} style={{ whiteSpace: 'normal', display: 'block' }}>
                                    Hola Ana, tu pedido #1042 salió hoy y llega mañana. 🚚
                                </T>
                            </span>
                            <span data-a="" style={{ animationName: 'wh-m2', position: 'absolute', inset: 0 }}>
                                <T size={9.5} style={{ whiteSpace: 'normal', display: 'block' }}>
                                    ¡Gracias! ¿Me lo pueden dejar en portería?
                                </T>
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <T size={8} weight={600} color={C.mutedFg}>
                                Dirección
                            </T>
                            <span style={{ position: 'relative', height: 16 }}>
                                <span data-a="" style={{ animationName: 'wh-dir1', position: 'absolute', left: 0, top: 0, opacity: 0 }}>
                                    <Chip text="Saliente" color="#22C55E" />
                                </span>
                                <span data-a="" style={{ animationName: 'wh-dir2', position: 'absolute', left: 0, top: 0 }}>
                                    <Chip text="Entrante" color="#0EA5E9" />
                                </span>
                            </span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <T size={8} weight={600} color={C.mutedFg}>
                                Estado del último envío
                            </T>
                            <span style={{ position: 'relative', height: 16 }}>
                                <span data-a="" style={{ animationName: 'wh-st1', position: 'absolute', left: 0, top: 0, opacity: 0 }}>
                                    <Chip text="Enviado" color="#64748B" />
                                </span>
                                <span data-a="" style={{ animationName: 'wh-st2', position: 'absolute', left: 0, top: 0, opacity: 0 }}>
                                    <Chip text="Entregado" color="#0EA5E9" />
                                </span>
                                <span data-a="" style={{ animationName: 'wh-st3', position: 'absolute', left: 0, top: 0 }}>
                                    <Chip text="Leído" color="#22C55E" />
                                </span>
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={8} weight={600} color={C.mutedFg}>
                            Fecha del último mensaje
                        </T>
                        <T size={9.5}>27/10/2026 10:42 a. m.</T>
                    </span>
                </div>
            </At>

            {/* El teléfono del cliente */}
            <At
                x={312}
                y={18}
                w={150}
                h={264}
                style={{ borderRadius: 22, background: C.card, border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)' }}
            >
                <div style={{ height: 32, background: '#128C7E', display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px' }}>
                    <span style={{ width: 17, height: 17, borderRadius: 99, background: 'rgba(255,255,255,.35)' }} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={8.5} weight={700} color="#fff">
                            Café Aurora ✓
                        </T>
                        <T size={7} color="rgba(255,255,255,.8)">
                            Cuenta de empresa
                        </T>
                    </span>
                </div>
                <div style={{ position: 'relative', height: 222, background: tone('mint', 0.08) }}>
                    <At x={7} y={10} a="wh-out" style={{ opacity: 1 }}>
                        <Bubble side="left" style={{ maxWidth: 122 }}>
                            Hola Ana, tu pedido <b>#1042</b> salió hoy y llega mañana. 🚚
                            <span data-a="" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, marginTop: 2, animationName: 'wh-tick', color: tone('blue') }}>
                                <T size={7} color={C.mutedFg}>
                                    10:30
                                </T>
                                <CheckCheck size={10} />
                            </span>
                        </Bubble>
                    </At>
                    <At x={25} y={104} a="wh-in" style={{ opacity: 1 }}>
                        <Bubble side="right" style={{ maxWidth: 108 }}>
                            ¡Gracias! ¿Me lo pueden dejar en portería?
                            <span style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 2 }}>
                                <T size={7} color={C.mutedFg}>
                                    10:42
                                </T>
                            </span>
                        </Bubble>
                    </At>
                </div>
            </At>
        </Stage>
    );
}
