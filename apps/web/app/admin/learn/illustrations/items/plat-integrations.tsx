import { Check, Plug } from 'lucide-react';

import { At, C, Flow, Keyframes, Stage, T, primary } from '../kit';

/**
 * Integraciones de la plataforma: el operador registra UNA vez la app de
 * Google (Client ID y Client Secret) y todas las empresas pueden conectar su
 * Gmail con un botón, cada una con su propia cuenta.
 */

const CSS = `
@keyframes pin-id{0%,8%{width:0}20%,100%{width:124px}}
@keyframes pin-sec{0%,22%{width:0}32%,100%{width:80px}}
@keyframes pin-s1{0%,36%{opacity:1}40%,92%{opacity:0}100%{opacity:1}}
@keyframes pin-s2{0%,36%{opacity:0;transform:scale(.7)}40%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pin-flow{0%,42%{opacity:0}48%,92%{opacity:1}100%{opacity:0}}
@keyframes pin-c1{0%,48%{opacity:.45;filter:grayscale(1)}54%,92%{opacity:1;filter:none}100%{opacity:.45;filter:grayscale(1)}}
@keyframes pin-c2{0%,56%{opacity:.45;filter:grayscale(1)}62%,92%{opacity:1;filter:none}100%{opacity:.45;filter:grayscale(1)}}
@keyframes pin-c3{0%,64%{opacity:.45;filter:grayscale(1)}70%,92%{opacity:1;filter:none}100%{opacity:.45;filter:grayscale(1)}}
`;

function GoogleMark({ size = 14 }: { size?: number }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z" />
            <path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5h-4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1c.9-2.8 3.5-4.8 6.6-4.8z" />
        </svg>
    );
}

function Company({ y, name, account, a }: { y: number; name: string; account: string; a: string }): JSX.Element {
    return (
        <At x={316} y={y} w={150} a={a}>
            <div
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
                }}
            >
                <T size={9} weight={700}>
                    {name}
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <GoogleMark size={11} />
                    <T size={8} color={C.mutedFg}>
                        Gmail · {account}
                    </T>
                </span>
            </div>
        </At>
    );
}

export default function PlatIntegrations(): JSX.Element {
    return (
        <Stage
            label="En Plataforma, Integraciones, el operador registra una sola vez la app de Google con su Client ID y Client Secret. Desde ese momento cada empresa conecta su propio Gmail con un botón."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={30}
                w={270}
                h={240}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plug size={13} color={primary()} />
                    <T size={11} weight={700}>
                        Integraciones
                    </T>
                </span>
                <div
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <GoogleMark />
                        <T size={10} weight={700} style={{ flex: 1 }}>
                            Google
                        </T>
                        <span style={{ position: 'relative', width: 80, height: 17 }}>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    opacity: 0,
                                    animationName: 'pin-s1',
                                }}
                            >
                                <span
                                    style={{
                                        height: 17,
                                        padding: '0 7px',
                                        borderRadius: 99,
                                        background: C.muted,
                                        color: C.mutedFg,
                                        fontSize: 8,
                                        fontWeight: 700,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    Sin configurar
                                </span>
                            </span>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    animationName: 'pin-s2',
                                }}
                            >
                                <span
                                    style={{
                                        height: 17,
                                        padding: '0 7px',
                                        borderRadius: 99,
                                        background: 'hsl(var(--imcrm-success) / .14)',
                                        color: C.success,
                                        fontSize: 8,
                                        fontWeight: 700,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 3,
                                    }}
                                >
                                    <Check size={9} /> Configurada
                                </span>
                            </span>
                        </span>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Habilita Gmail, Google Calendar, Sheets y Drive
                    </T>
                    {[
                        ['Client ID', 'pin-id', '1234-abc.apps.googleusercontent.com', 124],
                        ['Client Secret', 'pin-sec', '••••••••••••', 80],
                    ].map(([l, a, v, w]) => (
                        <span key={l as string} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={8} weight={600}>
                                {l}
                            </T>
                            <span
                                style={{
                                    height: 22,
                                    border: `1px solid ${C.border}`,
                                    borderRadius: 5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 7px',
                                }}
                            >
                                <span
                                    data-a=""
                                    style={{
                                        display: 'inline-block',
                                        overflow: 'hidden',
                                        whiteSpace: 'nowrap',
                                        width: w as number,
                                        animationName: a as string,
                                    }}
                                >
                                    <T size={8.5}>{v}</T>
                                </span>
                            </span>
                        </span>
                    ))}
                    <span
                        style={{
                            alignSelf: 'flex-end',
                            height: 20,
                            padding: '0 10px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Guardar
                    </span>
                </div>
                <span style={{ display: 'flex', gap: 6 }}>
                    {['Microsoft', 'Slack'].map((p) => (
                        <span
                            key={p}
                            style={{
                                flex: 1,
                                height: 26,
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0 8px',
                            }}
                        >
                            <T size={8.5} weight={600}>
                                {p}
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                Sin configurar
                            </T>
                        </span>
                    ))}
                </span>
            </At>

            <At x={284} y={150} a="pin-flow">
                <Flow x1={0} y1={0} x2={32} y2={-82} />
                <Flow x1={0} y1={0} x2={32} y2={-4} />
                <Flow x1={0} y1={0} x2={32} y2={74} />
            </At>
            <T size={8} weight={700} color={C.mutedFg} style={{ position: 'absolute', left: 316, top: 30 }}>
                Cada empresa, su propia cuenta
            </T>
            <Company y={46} name="Café Aurora" account="ventas@cafeaurora.co" a="pin-c1" />
            <Company y={124} name="Clínica Norte" account="citas@clinicanorte.co" a="pin-c2" />
            <Company y={202} name="Agencia Rumbo" account="hola@rumbo.travel" a="pin-c3" />
        </Stage>
    );
}
