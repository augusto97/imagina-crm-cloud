import { Bold, Coffee, Italic, Link2, PenLine } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La firma de email: se escribe una vez en Ajustes → Firma de email y las
 * automatizaciones con «Agregar la firma al final del correo» la pegan sola.
 */

const CSS = `
@keyframes cfi-sig{0%,40%{opacity:0;transform:translateY(-34px) scale(.95)}52%,92%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0}}
@keyframes cfi-check{0%,32%{opacity:0;transform:scale(.4)}38%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
`;

function Signature(): JSX.Element {
    return (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span
                style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: tone('amber', 0.16),
                    color: tone('amber'),
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Coffee size={15} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <T size={9.5} weight={700}>
                    Ana Gómez
                </T>
                <T size={8} color={C.mutedFg}>
                    Gerente comercial · Café Aurora
                </T>
                <T size={8} color={primary()} weight={600}>
                    cafeaurora.co · +57 601 555 0000
                </T>
            </span>
        </span>
    );
}

export default function CuentaFirma(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Firma de email, se escribe la firma con logo, nombre, cargo y enlaces. Las automatizaciones que tienen marcada «Agregar la firma al final del correo» la agregan sola al final de cada correo."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={20}
                w={204}
                h={258}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PenLine size={12} color={primary()} />
                    <T size={11} weight={700}>
                        Firma de email
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                    <span
                        style={{
                            height: 20,
                            padding: '0 8px',
                            borderRadius: 5,
                            background: C.muted,
                            fontSize: 8.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Visual
                    </span>
                    <span
                        style={{
                            height: 20,
                            padding: '0 8px',
                            borderRadius: 5,
                            fontSize: 8.5,
                            fontWeight: 600,
                            color: C.mutedFg,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        HTML
                    </span>
                </span>
                <span
                    style={{
                        display: 'flex',
                        gap: 8,
                        color: C.mutedFg,
                        borderBottom: `1px solid ${C.border}`,
                        paddingBottom: 6,
                    }}
                >
                    <Bold size={11} />
                    <Italic size={11} />
                    <Link2 size={11} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={9}>Saludos,</T>
                    <Signature />
                </span>
                <span style={{ flex: 1 }} />
                <span
                    style={{
                        alignSelf: 'flex-end',
                        height: 22,
                        padding: '0 10px',
                        borderRadius: 6,
                        background: primary(),
                        color: C.primaryFg,
                        fontSize: 9,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                    }}
                >
                    Guardar firma
                </span>
            </At>

            {/* Acción de la automatización */}
            <At
                x={234}
                y={20}
                w={230}
                h={58}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '8px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                }}
            >
                <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Acción · Enviar email
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                        style={{
                            width: 13,
                            height: 13,
                            borderRadius: 3,
                            background: primary(),
                            color: '#fff',
                            fontSize: 9,
                            fontWeight: 800,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <span data-a="" style={{ animationName: 'cfi-check' }}>
                            ✓
                        </span>
                    </span>
                    <T size={9}>Agregar la firma al final del correo</T>
                </span>
            </At>

            {/* El correo */}
            <At
                x={234}
                y={90}
                w={230}
                h={188}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <div
                    style={{
                        padding: '8px 11px',
                        borderBottom: `1px solid ${C.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <T size={8} color={C.mutedFg}>
                        Para: compras@hotelbrisas.co
                    </T>
                    <T size={9.5} weight={700}>
                        Tu cotización COT-0018
                    </T>
                </div>
                <div
                    style={{
                        padding: '10px 11px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                    }}
                >
                    <T size={9} style={{ whiteSpace: 'normal', lineHeight: 1.45, display: 'block' }}>
                        Hola Marcela, te adjunto la cotización por $ 3.600.000. Quedo atenta a tus comentarios.
                    </T>
                    <div
                        data-a=""
                        style={{
                            borderTop: `1px dashed ${C.border}`,
                            paddingTop: 8,
                            marginTop: 4,
                            animationName: 'cfi-sig',
                        }}
                    >
                        <T size={9} style={{ display: 'block', marginBottom: 5 }}>
                            Saludos,
                        </T>
                        <Signature />
                    </div>
                </div>
            </At>
        </Stage>
    );
}
