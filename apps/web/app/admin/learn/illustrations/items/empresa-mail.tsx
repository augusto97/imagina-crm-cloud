import { CheckCheck, Mail, Send, Server } from 'lucide-react';

import { At, Bubble, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Cómo salen los correos de la empresa: de las tres formas se elige «Tu
 * cuenta de Google o Microsoft»; el correo sale desde la casilla de la
 * empresa y el contador del día avanza.
 */

const CSS = `
@keyframes eml-u1{0%,24%{opacity:1}28%,92%{opacity:0}100%{opacity:1}}
@keyframes eml-u2{0%,24%{opacity:0;transform:scale(.7)}28%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes eml-c1{0%,24%{box-shadow:0 0 0 2px ${primary(0.6)}}28%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes eml-c2{0%,24%{box-shadow:0 0 0 0 transparent}28%,92%{box-shadow:0 0 0 2px ${primary(0.6)}}100%{box-shadow:0 0 0 0 transparent}}
@keyframes eml-cursor{0%{transform:translate(260px,290px);opacity:0}6%{opacity:1}20%,26%{transform:translate(240px,90px)}40%,86%{transform:translate(300px,118px);opacity:1}94%,100%{transform:translate(300px,118px);opacity:0}}
@keyframes eml-ring{0%,22%{opacity:0;transform:scale(.4)}24%{opacity:1;transform:scale(1)}29%,100%{opacity:0;transform:scale(1.6)}}
@keyframes eml-fly{0%,40%{opacity:0;transform:translate(-60px,0) scale(.8)}46%{opacity:1}56%,100%{opacity:0;transform:translate(60px,0) scale(1)}}
@keyframes eml-msg{0%,52%{opacity:0;transform:translateY(8px)}60%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes eml-bar{0%,56%{width:55%}64%,92%{width:58%}100%{width:55%}}
@keyframes eml-n1{0%,56%{opacity:1}62%,92%{opacity:0}100%{opacity:1}}
@keyframes eml-n2{0%,56%{opacity:0}62%,92%{opacity:1}100%{opacity:0}}
`;

function Option({
    x,
    title,
    desc,
    icon,
    t,
    a,
    badge,
}: {
    x: number;
    title: string;
    desc: string;
    icon: JSX.Element;
    t: 'slate' | 'blue' | 'violet';
    a?: string;
    badge?: string;
}): JSX.Element {
    return (
        <At
            x={x}
            y={32}
            w={142}
            h={94}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: 9,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                boxShadow: a === 'eml-c2' ? `0 0 0 2px ${primary(0.6)}` : undefined,
            }}
        >
            <span
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}
            >
                <span
                    style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        background: tone(t, 0.14),
                        color: tone(t),
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {icon}
                </span>
                {badge && (
                    <span
                        data-a=""
                        style={{
                            fontSize: 8,
                            fontWeight: 700,
                            color: C.success,
                            background: 'hsl(var(--imcrm-success) / .14)',
                            borderRadius: 99,
                            padding: '2px 6px',
                            animationName: badge,
                            opacity: badge === 'eml-u1' ? 0 : 1,
                        }}
                    >
                        En uso
                    </span>
                )}
            </span>
            <T size={9.5} weight={700} style={{ whiteSpace: 'normal' }}>
                {title}
            </T>
            <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                {desc}
            </T>
        </At>
    );
}

function GoogleMark(): JSX.Element {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z" />
            <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5h-4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1c.9-2.8 3.5-4.8 6.6-4.8z" />
        </svg>
    );
}

export default function EmpresaMail(): JSX.Element {
    return (
        <Stage
            label="De las tres formas de enviar correos se elige la cuenta de Google de la empresa: el aviso al cliente sale desde notificaciones@cafeaurora.co y el contador de enviados del día avanza."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At x={16} y={10}>
                <T size={11} weight={700}>
                    Cómo salen los correos de tu empresa
                </T>
            </At>
            <Option
                x={16}
                title="Correo de la plataforma"
                desc="Listo sin configurar. Usa la cuota de tu plan."
                icon={<Mail size={12} />}
                t="slate"
                a="eml-c1"
                badge="eml-u1"
            />
            <Option
                x={169}
                title="Tu cuenta de Google o Microsoft"
                desc="Sale desde tu Gmail u Outlook, sin contraseñas."
                icon={<GoogleMark />}
                t="blue"
                a="eml-c2"
                badge="eml-u2"
            />
            <Option x={322} title="Tu servidor SMTP" desc="Brevo, Amazon SES o el de tu hosting." icon={<Server size={12} />} t="violet" />

            {/* La cuenta elegida y el contador */}
            <At
                x={16}
                y={136}
                w={226}
                h={142}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <GoogleMark />
                    <T size={9.5} weight={700}>
                        notificaciones@cafeaurora.co
                    </T>
                </span>
                <T size={8} color={C.success} weight={700}>
                    Enviando desde esta cuenta
                </T>
                <T size={8.5} color={C.mutedFg} style={{ marginTop: 4 }}>
                    Enviados hoy desde la app
                </T>
                <span style={{ position: 'relative', height: 14 }}>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            opacity: 0,
                            animationName: 'eml-n1',
                        }}
                    >
                        <T size={11} weight={700}>
                            1.104 <span style={{ fontWeight: 500, color: C.mutedFg, fontSize: 9 }}>de ~2.000</span>
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            animationName: 'eml-n2',
                        }}
                    >
                        <T size={11} weight={700}>
                            1.105 <span style={{ fontWeight: 500, color: C.mutedFg, fontSize: 9 }}>de ~2.000</span>
                        </T>
                    </span>
                </span>
                <span
                    style={{
                        height: 6,
                        borderRadius: 99,
                        background: C.muted,
                        overflow: 'hidden',
                    }}
                >
                    <span
                        data-a=""
                        style={{
                            display: 'block',
                            height: '100%',
                            width: '58%',
                            background: primary(),
                            animationName: 'eml-bar',
                        }}
                    />
                </span>
                <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    Google Workspace: hasta 2.000 correos por día.
                </T>
            </At>

            <At x={238} y={190} a="eml-fly" style={{ opacity: 0, color: primary() }}>
                <Send size={18} />
            </At>

            {/* El correo que recibe el cliente */}
            <At
                x={262}
                y={136}
                w={202}
                h={142}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        padding: '8px 10px',
                        borderBottom: `1px solid ${C.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <T size={8} color={C.mutedFg}>
                        De: Café Aurora &lt;notificaciones@cafeaurora.co&gt;
                    </T>
                    <T size={9.5} weight={700}>
                        Tu pedido #1042 ya salió
                    </T>
                </div>
                <div data-a="" style={{ padding: 10, animationName: 'eml-msg' }}>
                    <Bubble style={{ maxWidth: 180 }}>
                        Hola Ana, tu pedido va en camino. Llega el 31/10/2026. ¡Gracias por tu compra!
                        <span
                            style={{
                                display: 'flex',
                                justifyContent: 'flex-end',
                                color: tone('blue'),
                                marginTop: 2,
                            }}
                        >
                            <CheckCheck size={11} />
                        </span>
                    </Bubble>
                </div>
            </At>
            <Cursor a="eml-cursor" click="eml-ring" rest={[300, 118]} />
        </Stage>
    );
}
