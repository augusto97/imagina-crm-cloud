import { Check, KeyRound, Link2, Phone, ShieldCheck, Webhook } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Conectar WhatsApp Business oficial: cuatro datos que salen de Meta (el
 * token, el identificador del número, el de la cuenta y la clave secreta) y
 * dos pasos en Meta (la dirección de avisos y suscribir la cuenta). Al final,
 * la conexión queda con el número verificado y su calidad.
 */

const STEPS = [
    { icon: <KeyRound size={12} />, title: 'Token de acceso permanente', where: 'Usuario del sistema, sin vencimiento' },
    { icon: <Phone size={12} />, title: 'Identificador del número', where: 'Tu app de Meta → WhatsApp' },
    { icon: <Link2 size={12} />, title: 'Identificador de la cuenta', where: 'El mismo lugar, para leer plantillas' },
    { icon: <ShieldCheck size={12} />, title: 'Clave secreta de la app', where: 'Configuración → Básica' },
    { icon: <Webhook size={12} />, title: 'Dirección de avisos y suscribir', where: 'Se pega en Meta una sola vez' },
];

const CSS = `
${STEPS.map(
    (_, i) => `
@keyframes wsu-s${i}{0%,${4 + i * 12}%{border-color:${C.border};background:${C.card}}${8 + i * 12}%,92%{border-color:${tone('mint', 0.55)};background:${tone('mint', 0.07)}}97%,100%{border-color:${C.border};background:${C.card}}}
@keyframes wsu-c${i}{0%,${6 + i * 12}%{opacity:0;transform:scale(.4)}${10 + i * 12}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}`,
).join('')}
@keyframes wsu-done{0%,68%{opacity:0;transform:translateY(8px) scale(.97)}74%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
`;

export default function WabSetup(): JSX.Element {
    return (
        <Stage label="Conectar WhatsApp Business oficial: el token permanente, el identificador del número, el de la cuenta, la clave secreta de la app y la dirección de avisos; al final la conexión queda verificada." tint="mint">
            <Keyframes css={CSS} />
            {STEPS.map((s, i) => (
                <At
                    key={s.title}
                    x={20}
                    y={22 + i * 52}
                    w={250}
                    h={44}
                    a={`wsu-s${i}`}
                    style={{ border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 9, padding: '0 10px', boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)' }}
                >
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: primary(0.12), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{s.icon}</span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
                        <T size={9.5} weight={700}>
                            {s.title}
                        </T>
                        <T size={8} color={C.mutedFg}>
                            {s.where}
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{ animationName: `wsu-c${i}`, width: 17, height: 17, borderRadius: 99, background: C.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                    >
                        <Check size={11} strokeWidth={3} />
                    </span>
                </At>
            ))}

            {/* La conexión lista */}
            <At
                x={292}
                y={74}
                w={170}
                h={150}
                a="wsu-done"
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 13, boxShadow: '0 16px 36px -16px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                <IntegrationLogo integrationKey="whatsapp_cloud" size={36} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={10.5} weight={700}>
                        WhatsApp Business (oficial)
                    </T>
                    <T size={9} color={C.mutedFg}>
                        Café Aurora · +57 601 555 0101
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ height: 17, padding: '0 7px', borderRadius: 99, background: 'hsl(var(--imcrm-success) / .14)', color: C.success, fontSize: 8.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Conectada</span>
                    <span style={{ height: 17, padding: '0 7px', borderRadius: 99, background: tone('mint', 0.14), color: tone('mint'), fontSize: 8.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Calidad alta</span>
                </span>
                <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Cuenta suscrita · 6 plantillas aprobadas
                </T>
            </At>
        </Stage>
    );
}
