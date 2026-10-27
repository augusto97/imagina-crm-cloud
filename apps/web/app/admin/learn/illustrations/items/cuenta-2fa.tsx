import { KeyRound, Lock, ShieldCheck, Smartphone } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Verificación en dos pasos: después de la contraseña, la app pide el código
 * de 6 dígitos que muestra la app de autenticación del teléfono.
 */

const CSS = `
@keyframes c2f-pass{0%,4%{width:0}18%,100%{width:84px}}
@keyframes c2f-step2{0%,22%{opacity:0;transform:translateY(10px)}30%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes c2f-ring{0%,100%{stroke-dashoffset:0}}
@keyframes c2f-timer{0%{stroke-dashoffset:0}100%{stroke-dashoffset:44}}
@keyframes c2f-d{0%,34%{opacity:0;transform:translateY(-4px)}38%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes c2f-ok{0%,66%{opacity:0;transform:scale(.6)}72%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes c2f-glow{0%,30%{box-shadow:0 0 0 0 transparent}34%,60%{box-shadow:0 0 0 4px ${primary(0.18)}}66%,100%{box-shadow:0 0 0 0 transparent}}
`;

const CODE = ['4', '8', '2', '9', '1', '3'];

export default function Cuenta2fa(): JSX.Element {
    return (
        <Stage
            label="Al entrar, después de la contraseña, la app pide el código de 6 dígitos que muestra la app de autenticación del teléfono. Con el código correcto se entra; sin el teléfono, sirve un código de respaldo."
            tint="mint"
        >
            <Keyframes css={CSS} />
            {/* Teléfono con la app autenticadora */}
            <At
                x={28}
                y={22}
                w={142}
                h={258}
                style={{
                    borderRadius: 24,
                    background: C.card,
                    border: `5px solid ${C.fg}`,
                    overflow: 'hidden',
                    boxShadow: '0 18px 40px -18px rgba(15,23,42,.55)',
                }}
            >
                <div
                    style={{
                        padding: '14px 11px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Smartphone size={11} color={C.mutedFg} />
                        <T size={8.5} weight={700} color={C.mutedFg}>
                            Autenticador
                        </T>
                    </span>
                    <div
                        style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 10,
                            padding: 9,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                            background: tone('mint', 0.06),
                        }}
                    >
                        <T size={8.5} weight={600}>
                            Café Aurora
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            ana@cafeaurora.co
                        </T>
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <T size={17} weight={700} color={primary()} style={{ letterSpacing: '.04em' }}>
                                482 913
                            </T>
                            <svg width="18" height="18" viewBox="0 0 18 18">
                                <circle cx="9" cy="9" r="7" fill="none" stroke={C.border} strokeWidth="2.4" />
                                <circle
                                    data-a=""
                                    cx="9"
                                    cy="9"
                                    r="7"
                                    fill="none"
                                    stroke={primary()}
                                    strokeWidth="2.4"
                                    strokeDasharray="44"
                                    style={{
                                        animationName: 'c2f-timer',
                                        animationTimingFunction: 'linear',
                                        transform: 'rotate(-90deg)',
                                        transformOrigin: '9px 9px',
                                    }}
                                />
                            </svg>
                        </span>
                    </div>
                    {['Banco', 'Correo'].map((n) => (
                        <div
                            key={n}
                            style={{
                                border: `1px solid ${C.border}`,
                                borderRadius: 10,
                                padding: 9,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                                opacity: 0.55,
                            }}
                        >
                            <T size={8} weight={600}>
                                {n}
                            </T>
                            <T size={13} weight={700} color={C.mutedFg}>
                                ••• •••
                            </T>
                        </div>
                    ))}
                </div>
            </At>

            {/* Pantalla de entrar */}
            <At
                x={196}
                y={34}
                w={268}
                h={232}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    boxShadow: '0 14px 32px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 7,
                            background: primary(0.14),
                            color: primary(),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Lock size={13} />
                    </span>
                    <T size={12} weight={700}>
                        Entrar
                    </T>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.5} weight={600}>
                        Contraseña
                    </T>
                    <span
                        style={{
                            height: 24,
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 8px',
                        }}
                    >
                        <span
                            data-a=""
                            style={{
                                display: 'inline-block',
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                width: 84,
                                animationName: 'c2f-pass',
                            }}
                        >
                            <T size={11} weight={700}>
                                ••••••••••
                            </T>
                        </span>
                    </span>
                </span>
                <div
                    data-a=""
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                        animationName: 'c2f-step2',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={12} color={primary()} />
                        <T size={9.5} weight={700}>
                            Verificación en dos pasos
                        </T>
                    </span>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Ingresa el código de 6 dígitos de tu app de autenticación.
                    </T>
                    <span
                        data-a=""
                        style={{
                            display: 'inline-flex',
                            alignSelf: 'flex-start',
                            gap: 5,
                            borderRadius: 8,
                            animationName: 'c2f-glow',
                        }}
                    >
                        {CODE.map((d, i) => (
                            <span
                                key={i}
                                style={{
                                    width: 30,
                                    height: 34,
                                    borderRadius: 7,
                                    border: `1.5px solid ${primary(0.55)}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <span
                                    data-a=""
                                    style={{
                                        animationName: 'c2f-d',
                                        animationDelay: `${i * 0.18}s`,
                                    }}
                                >
                                    <T size={15} weight={700}>
                                        {d}
                                    </T>
                                </span>
                            </span>
                        ))}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <KeyRound size={10} color={C.mutedFg} />
                        <T size={8} color={C.mutedFg}>
                            ¿Perdiste el teléfono? Usa un código de respaldo.
                        </T>
                    </span>
                </div>
                <span
                    data-a=""
                    style={{
                        position: 'absolute',
                        right: 14,
                        top: 14,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        height: 22,
                        padding: '0 9px',
                        borderRadius: 99,
                        background: 'hsl(var(--imcrm-success) / .14)',
                        color: C.success,
                        fontSize: 9,
                        fontWeight: 700,
                        animationName: 'c2f-ok',
                    }}
                >
                    <ShieldCheck size={11} /> Adentro
                </span>
            </At>
        </Stage>
    );
}
