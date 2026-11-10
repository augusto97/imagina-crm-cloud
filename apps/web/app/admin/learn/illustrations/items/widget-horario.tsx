import { Clock, FileText, MessageCircle, Phone } from 'lucide-react';

import { At, Bar, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Widget de contacto con horario (v0.1.395): en horario dice «En línea» y
 * muestra WhatsApp y Llamar; al llegar la hora de cierre cambia solo a
 * «Fuera de horario», con cuándo vuelven a atender y el formulario.
 */

const WA = '#25D366';

const CSS = `
@keyframes wh-open{0%,42%{opacity:1}48%,94%{opacity:0}100%{opacity:1}}
@keyframes wh-closed{0%,42%{opacity:0}48%,94%{opacity:1}100%{opacity:0}}
@keyframes wh-tick{0%,40%{transform:rotate(0deg)}46%,100%{transform:rotate(90deg)}}
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

function Head({ online }: { online: boolean }): JSX.Element {
    return (
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
            <At x={12} y={40} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 99, background: online ? '#22c55e' : '#cbd5e1', display: 'inline-block' }} />
                <T size={6} color="#fff" weight={700}>
                    {online ? 'En línea' : 'Fuera de horario'}
                </T>
            </At>
        </At>
    );
}

export default function WidgetHorario(): JSX.Element {
    return (
        <Stage
            label="Horario del widget de contacto: en horario el panel dice «En línea» y muestra WhatsApp y Llamar; al cerrar cambia solo a «Fuera de horario», con cuándo vuelven a atender y un formulario para dejar un mensaje."
            cycle={8}
            tint="mint"
        >
            <Keyframes css={CSS} />
            <At x={20} y={18} w={440} h={264} style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden' }}>
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
                </At>
                {/* El reloj: la hora de cierre llega. */}
                <At x={60} y={130} w={120} h={70} style={{ borderRadius: 12, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-flex', animation: 'wh-tick 8s ease-in-out infinite' }}>
                        <Clock size={26} color={primary()} />
                    </span>
                    <span style={{ position: 'relative', width: 44, height: 16 }}>
                        <span style={{ position: 'absolute', inset: 0, animation: 'wh-open 8s ease-in-out infinite' }}>
                            <T size={12} weight={800}>
                                17:59
                            </T>
                        </span>
                        <span style={{ position: 'absolute', inset: 0, opacity: 0, animation: 'wh-closed 8s ease-in-out infinite' }}>
                            <T size={12} weight={800}>
                                18:00
                            </T>
                        </span>
                    </span>
                </At>

                <At x={250} y={20} w={176} h={196} style={{ borderRadius: 12, background: C.muted, overflow: 'hidden', boxShadow: '0 10px 26px rgba(15,23,42,.22)' }}>
                    <At x={0} y={0} w={176} h={196} style={{ animation: 'wh-open 8s ease-in-out infinite' }}>
                        <Head online />
                        <Option y={72} color={WA} icon={<MessageCircle size={11} color="#fff" />} label="WhatsApp" sub="Respondemos en minutos" />
                        <Option y={108} color={primary()} icon={<Phone size={11} color="#fff" />} label="Llamar" />
                    </At>
                    <At x={0} y={0} w={176} h={196} style={{ opacity: 0, animation: 'wh-closed 8s ease-in-out infinite' }}>
                        <Head online={false} />
                        <At x={10} y={70} w={156} h={36} style={{ borderRadius: 8, background: '#fff8e6', border: '1px solid #f6e3b4', padding: '5px 7px' }}>
                            <T size={6} color="#5b4512">
                                Estamos fuera de horario.
                            </T>
                            <div style={{ marginTop: 3 }}>
                                <T size={6.5} weight={800} color="#5b4512">
                                    Abrimos mañana a las 8:00 a. m.
                                </T>
                            </div>
                        </At>
                        <Option y={114} color={WA} icon={<MessageCircle size={11} color="#fff" />} label="WhatsApp" />
                        <Option y={150} color={primary()} icon={<FileText size={11} color="#fff" />} label="Déjanos un mensaje" />
                    </At>
                </At>

                <At x={392} y={222} w={34} h={34} style={{ borderRadius: 99, background: primary(), boxShadow: '0 6px 14px rgba(15,23,42,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MessageCircle size={16} color="#fff" />
                </At>
            </At>
        </Stage>
    );
}
