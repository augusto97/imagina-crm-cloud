import { CalendarDays, FileText, MessageCircle, X } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * Widget de contacto (v0.1.394): el botón redondo del sitio abre un panel con
 * WhatsApp, un formulario y la agenda; «WhatsApp con datos primero» pide nombre
 * y celular, y después sigue en WhatsApp con el mensaje armado.
 */

const WA = '#25D366';

const CSS = `
@keyframes wc-cur{
0%{transform:translate(250px,270px)}
10%,13%{transform:translate(429px,257px)}
30%,34%{transform:translate(352px,104px)}
52%,56%{transform:translate(352px,214px)}
70%,100%{transform:translate(250px,270px)}}
@keyframes wc-ring1{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}17%,100%{opacity:0;transform:scale(1.6)}}
@keyframes wc-panel{0%,13%{opacity:0;transform:translateY(14px)}18%,92%{opacity:1;transform:none}97%,100%{opacity:0;transform:translateY(14px)}}
@keyframes wc-home{0%,34%{opacity:1}38%,100%{opacity:0}}
@keyframes wc-form{0%,35%{opacity:0}40%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes wc-type1{0%,41%{width:0}46%,100%{width:56px}}
@keyframes wc-type2{0%,46%{width:0}51%,100%{width:62px}}
@keyframes wc-wa{0%,56%{opacity:0;transform:scale(.8)}60%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
`;

function Option({ y, color, icon, label, sub }: { y: number; color: string; icon: JSX.Element; label: string; sub?: string }): JSX.Element {
    return (
        <At x={10} y={y} w={156} h={30} style={{ borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 2px 6px rgba(15,23,42,.08)' }}>
            <At x={6} y={5} w={20} h={20} style={{ borderRadius: 6, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {icon}
            </At>
            <At x={32} y={sub ? 5 : 10}>
                <T size={7.5} weight={700}>
                    {label}
                </T>
            </At>
            {sub && (
                <At x={32} y={17}>
                    <T size={6} color={C.mutedFg}>
                        {sub}
                    </T>
                </At>
            )}
        </At>
    );
}

export default function WidgetContacto(): JSX.Element {
    return (
        <Stage
            label="Widget de contacto: en el sitio de la empresa, el botón redondo abre un panel con WhatsApp, un formulario y la agenda. Al tocar WhatsApp pide nombre y celular, guarda el registro y sigue en WhatsApp con el mensaje armado."
            cycle={9}
            tint="mint"
        >
            <Keyframes css={CSS} />
            <At x={20} y={18} w={440} h={264} style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden' }}>
                {/* El sitio de la empresa */}
                <At x={0} y={0} w={440} h={26} style={{ borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 12px' }}>
                    <T size={8} weight={800}>
                        Clínica Sonrisas
                    </T>
                </At>
                <At x={18} y={44}>
                    <T size={13} weight={800}>
                        Tu sonrisa, en buenas manos
                    </T>
                </At>
                <At x={18} y={66} w={220}>
                    <Bar w={200} />
                    <Bar w={170} style={{ marginTop: 6 }} />
                    <Bar w={186} style={{ marginTop: 6 }} />
                </At>
                <At x={18} y={120} w={110} h={60} style={{ borderRadius: 8, background: C.muted }} />
                <At x={136} y={120} w={110} h={60} style={{ borderRadius: 8, background: C.muted }} />

                {/* El panel del widget */}
                <At x={250} y={20} w={176} h={196} a="wc-panel" style={{ opacity: 0, borderRadius: 12, background: C.muted, overflow: 'hidden', boxShadow: '0 10px 26px rgba(15,23,42,.22)' }}>
                    <At x={0} y={0} w={176} h={196} a="wc-home">
                        <At x={0} y={0} w={176} h={62} style={{ background: primary() }}>
                            <At x={12} y={10}>
                                <T size={6} color="#fff" weight={700}>
                                    Clínica Sonrisas
                                </T>
                            </At>
                            <At x={12} y={22}>
                                <T size={9} color="#fff" weight={800}>
                                    ¡Hola! ¿En qué te ayudamos?
                                </T>
                            </At>
                            <At x={152} y={8} w={16} h={16} style={{ borderRadius: 99, background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={9} color="#fff" />
                            </At>
                        </At>
                        <Option y={48} color={WA} icon={<MessageCircle size={11} color="#fff" />} label="WhatsApp" sub="Respondemos en minutos" />
                        <Option y={84} color={primary()} icon={<FileText size={11} color="#fff" />} label="Escríbenos" />
                        <Option y={120} color={primary()} icon={<CalendarDays size={11} color="#fff" />} label="Agendar una cita" />
                    </At>
                    <At x={0} y={0} w={176} h={196} a="wc-form" style={{ opacity: 0, background: C.card }}>
                        <At x={0} y={0} w={176} h={26} style={{ background: primary(), display: 'flex', alignItems: 'center', padding: '0 10px' }}>
                            <T size={7} color="#fff" weight={700}>
                                WhatsApp
                            </T>
                        </At>
                        <At x={12} y={36}>
                            <T size={7} weight={600}>
                                Tu nombre
                            </T>
                        </At>
                        <At x={12} y={47} w={152} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                            <At x={6} y={5} a="wc-type1" style={{ width: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                <T size={7}>Ana Gómez</T>
                            </At>
                        </At>
                        <At x={12} y={76}>
                            <T size={7} weight={600}>
                                Tu celular
                            </T>
                        </At>
                        <At x={12} y={87} w={152} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                            <At x={6} y={5} a="wc-type2" style={{ width: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                <T size={7}>310 555 1234</T>
                            </At>
                        </At>
                        <At x={12} y={118} w={152} h={22} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={7.5} weight={700} color="#fff">
                                Enviar
                            </T>
                        </At>
                        <At x={12} y={150} w={152} h={26} a="wc-wa" style={{ opacity: 0, borderRadius: 6, background: WA, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                            <MessageCircle size={10} color="#fff" />
                            <T size={7.5} weight={700} color="#fff">
                                Continuar en WhatsApp
                            </T>
                        </At>
                    </At>
                </At>

                {/* El botón redondo */}
                <At x={392} y={222} w={34} h={34} style={{ borderRadius: 99, background: primary(), boxShadow: '0 6px 14px rgba(15,23,42,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MessageCircle size={16} color="#fff" />
                </At>
            </At>
            <Cursor a="wc-cur" click="wc-ring1" rest={[250, 270]} />
        </Stage>
    );
}
