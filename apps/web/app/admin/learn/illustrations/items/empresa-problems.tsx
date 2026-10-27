import { Bell, CheckCircle2, Mail, TriangleAlert, Workflow, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Problemas»: una automatización falla, aparece la pastilla «1 problema» y
 * el aviso en la campana; en Ajustes → Problemas se ve qué falló y cuántas
 * veces, y cuando vuelve a funcionar se cierra solo.
 */

const CSS = `
@keyframes epb-fail{0%,8%{opacity:0;transform:scale(.5)}14%,62%{opacity:1;transform:scale(1)}68%,100%{opacity:0;transform:scale(.6)}}
@keyframes epb-okk{0%,64%{opacity:0;transform:scale(.5)}70%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes epb-pill{0%,16%{opacity:0;transform:translateY(-6px)}22%,62%{opacity:1;transform:translateY(0)}68%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes epb-badge{0%,18%{opacity:0;transform:scale(.4)}24%,62%{opacity:1;transform:scale(1)}68%,100%{opacity:0}}
@keyframes epb-card{0%,26%{opacity:0;transform:translateY(10px)}34%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes epb-open{0%,64%{opacity:1}70%,92%{opacity:0}100%{opacity:1}}
@keyframes epb-closed{0%,64%{opacity:0}70%,92%{opacity:1}100%{opacity:0}}
@keyframes epb-n{0%,40%{opacity:1}44%,100%{opacity:0}}
@keyframes epb-n2{0%,40%{opacity:0}44%,92%{opacity:1}100%{opacity:0}}
@keyframes epb-mail{0%,22%{opacity:0;transform:translate(-10px,6px)}30%,62%{opacity:1;transform:translate(0,0)}68%,100%{opacity:0}}
`;

export default function EmpresaProblems(): JSX.Element {
    return (
        <Stage
            label="Una automatización deja de funcionar: aparece la pastilla «1 problema» en la barra superior, un aviso en la campana y un correo. En Problemas se ve qué falló y cuántas veces; cuando vuelve a funcionar, se cierra solo."
            tint="rose"
        >
            <Keyframes css={CSS} />
            {/* Barra superior */}
            <At
                x={16}
                y={14}
                w={448}
                h={36}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 12px',
                    gap: 10,
                }}
            >
                <T size={10.5} weight={700}>
                    Café Aurora
                </T>
                <span style={{ flex: 1 }} />
                <span
                    data-a=""
                    style={{
                        animationName: 'epb-pill',
                        height: 20,
                        padding: '0 8px',
                        borderRadius: 99,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        background: 'hsl(var(--imcrm-destructive) / .12)',
                        color: C.destructive,
                        fontSize: 9,
                        fontWeight: 700,
                    }}
                >
                    <TriangleAlert size={10} /> 1 problema
                </span>
                <span
                    style={{
                        position: 'relative',
                        display: 'inline-flex',
                        color: C.mutedFg,
                    }}
                >
                    <Bell size={15} />
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            right: -5,
                            top: -5,
                            minWidth: 13,
                            height: 13,
                            borderRadius: 99,
                            background: C.destructive,
                            color: '#fff',
                            fontSize: 7.5,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animationName: 'epb-badge',
                        }}
                    >
                        1
                    </span>
                </span>
            </At>

            {/* La automatización */}
            <At
                x={16}
                y={66}
                w={170}
                h={92}
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
                    <span
                        style={{
                            width: 24,
                            height: 24,
                            borderRadius: 7,
                            background: tone('violet'),
                            color: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Workflow size={13} />
                    </span>
                    <T size={9.5} weight={700}>
                        Recordatorio de pago
                    </T>
                </span>
                <span style={{ position: 'relative', height: 30 }}>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            animationName: 'epb-fail',
                        }}
                    >
                        <span
                            style={{
                                width: 16,
                                height: 16,
                                borderRadius: 99,
                                background: C.destructive,
                                color: '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <X size={10} strokeWidth={3} />
                        </span>
                        <T size={8.5} weight={700} color={C.destructive} style={{ whiteSpace: 'normal' }}>
                            Falló la última vez
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            opacity: 0,
                            animationName: 'epb-okk',
                        }}
                    >
                        <CheckCircle2 size={16} color={C.success} />
                        <T size={8.5} weight={700} color={C.success}>
                            Funcionando otra vez
                        </T>
                    </span>
                </span>
            </At>
            <At x={16} y={170} w={170} a="epb-mail">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 9,
                        display: 'flex',
                        gap: 7,
                        alignItems: 'flex-start',
                    }}
                >
                    <Mail size={13} color={primary()} />
                    <T size={8.5} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        <b>Correo para los admins:</b> «Recordatorio de pago» dejó de funcionar.
                    </T>
                </div>
            </At>

            {/* Ajustes · Problemas */}
            <At x={200} y={66} w={264} a="epb-card">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 12,
                        boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}
                >
                    <T size={11} weight={700}>
                        Problemas
                    </T>
                    <span style={{ display: 'flex', gap: 6 }}>
                        <span
                            style={{
                                height: 20,
                                padding: '0 8px',
                                borderRadius: 6,
                                background: C.muted,
                                fontSize: 8.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            Abiertos
                        </span>
                        <span
                            style={{
                                height: 20,
                                padding: '0 8px',
                                borderRadius: 6,
                                fontSize: 8.5,
                                fontWeight: 600,
                                color: C.mutedFg,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            Resueltos
                        </span>
                    </span>
                    <div
                        style={{
                            position: 'relative',
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            padding: 10,
                            height: 128,
                        }}
                    >
                        <div
                            data-a=""
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                animationName: 'epb-open',
                            }}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <TriangleAlert size={12} color={C.destructive} />
                                <T size={9.5} weight={700} style={{ whiteSpace: 'normal' }}>
                                    La automatización «Recordatorio de pago» falló
                                </T>
                            </span>
                            <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                                Paso «Enviar email»: el servidor de correo rechazó la contraseña.
                            </T>
                            <span style={{ position: 'relative', height: 12 }}>
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        opacity: 0,
                                        animationName: 'epb-n',
                                    }}
                                >
                                    <T size={8} color={C.mutedFg}>
                                        Falló hace un momento
                                    </T>
                                </span>
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        animationName: 'epb-n2',
                                    }}
                                >
                                    <T size={8} color={C.mutedFg}>
                                        Falló 3 veces · la primera hace 2 horas
                                    </T>
                                </span>
                            </span>
                            <span style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                                <span
                                    style={{
                                        height: 22,
                                        padding: '0 9px',
                                        borderRadius: 6,
                                        background: primary(),
                                        color: C.primaryFg,
                                        fontSize: 9,
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    Ir a arreglarlo
                                </span>
                                <span
                                    style={{
                                        height: 22,
                                        padding: '0 9px',
                                        borderRadius: 6,
                                        border: `1px solid ${C.border}`,
                                        fontSize: 9,
                                        fontWeight: 600,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    Ya lo arreglé
                                </span>
                            </span>
                        </div>
                        <div
                            data-a=""
                            style={{
                                position: 'absolute',
                                inset: 10,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                opacity: 0,
                                animationName: 'epb-closed',
                            }}
                        >
                            <CheckCircle2 size={22} color={C.success} />
                            <T size={9.5} weight={700}>
                                Todo está funcionando
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                El problema se resolvió solo
                            </T>
                        </div>
                    </div>
                </div>
            </At>
        </Stage>
    );
}
