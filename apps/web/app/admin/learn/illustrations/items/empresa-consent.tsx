import { Check, Fingerprint, Scale } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Autorización de datos personales (Ley 1581): quien llena el formulario
 * marca la casilla obligatoria y la app guarda la prueba (versión del
 * texto, fecha, IP y navegador).
 */

const CSS = `
@keyframes ecs-box{0%,24%{background:transparent;border-color:${C.border}}28%,90%{background:${primary()};border-color:${primary()}}97%,100%{background:transparent;border-color:${C.border}}}
@keyframes ecs-tick{0%,24%{opacity:0}28%,90%{opacity:1}97%,100%{opacity:0}}
@keyframes ecs-cursor{0%{transform:translate(250px,290px);opacity:0}6%{opacity:1}20%,26%{transform:translate(40px,206px)}40%,46%{transform:translate(206px,258px)}60%,88%{transform:translate(210px,272px);opacity:1}95%,100%{transform:translate(210px,272px);opacity:0}}
@keyframes ecs-ring{0%,22%{opacity:0;transform:scale(.4)}24%{opacity:1;transform:scale(1)}28%{opacity:0;transform:scale(1.6)}42%{opacity:0;transform:scale(.4)}44%{opacity:1;transform:scale(1)}48%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ecs-ev{0%,48%{opacity:0;transform:translateX(-14px)}58%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes ecs-line{0%,52%{opacity:0}60%,92%{opacity:1}100%{opacity:0}}
`;

function Input({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <T size={8.5} weight={600}>
                {label}
            </T>
            <span
                style={{
                    height: 22,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 7px',
                }}
            >
                <T size={9}>{value}</T>
            </span>
        </span>
    );
}

export default function EmpresaConsent(): JSX.Element {
    return (
        <Stage
            label="En un formulario público, quien responde marca la casilla de autorización de tratamiento de datos personales y envía: la app guarda la prueba con la versión del texto, la fecha, la IP y el navegador."
            tint="violet"
        >
            <Keyframes css={CSS} />
            {/* El formulario público */}
            <At
                x={16}
                y={16}
                w={232}
                h={268}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 13,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 12px 28px -14px rgba(15,23,42,.4)',
                }}
            >
                <T size={12} weight={700}>
                    Inscríbete al taller de barismo
                </T>
                <T size={8.5} color={C.mutedFg}>
                    Café Aurora · Sábado 15 de noviembre
                </T>
                <Input label="Nombre" value="Valentina Ríos" />
                <Input label="Correo" value="valentina@correo.co" />
                <Input label="Celular" value="+57 300 555 1234" />
                <span
                    style={{
                        display: 'flex',
                        gap: 7,
                        alignItems: 'flex-start',
                        marginTop: 2,
                    }}
                >
                    <span
                        data-a=""
                        style={{
                            width: 13,
                            height: 13,
                            borderRadius: 3,
                            border: `1.5px solid ${primary()}`,
                            background: primary(),
                            flexShrink: 0,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: 1,
                            animationName: 'ecs-box',
                        }}
                    >
                        <span
                            data-a=""
                            style={{
                                display: 'inline-flex',
                                color: '#fff',
                                animationName: 'ecs-tick',
                            }}
                        >
                            <Check size={9} strokeWidth={3} />
                        </span>
                    </span>
                    <T size={8} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Autorizo el tratamiento de mis datos personales. <span style={{ color: primary(), fontWeight: 600 }}>Ver la autorización completa</span>
                    </T>
                </span>
                <Btn label="Enviar" style={{ alignSelf: 'flex-end', marginTop: 'auto' }} />
            </At>

            {/* La evidencia */}
            <At x={258} y={150} a="ecs-line" style={{ opacity: 1 }}>
                <svg width="24" height="12">
                    <path d="M0 6 H24" stroke={primary(0.5)} strokeWidth="1.6" strokeDasharray="4 4" />
                </svg>
            </At>
            <At x={284} y={30} w={180} a="ecs-ev">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 11,
                        boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                background: tone('violet', 0.14),
                                color: tone('violet'),
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Scale size={12} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={9.5} weight={700}>
                                Autorización registrada
                            </T>
                            <T size={8} color={C.success} weight={700}>
                                Vigente
                            </T>
                        </span>
                    </span>
                    {[
                        ['Titular', 'Valentina Ríos'],
                        ['Origen', 'Formulario «Taller»'],
                        ['Versión', '2 del texto'],
                        ['Aceptada el', '15/10/2026 9:42 a. m.'],
                        ['IP', '181.52.104.17'],
                        ['Navegador', 'Chrome · Android'],
                    ].map(([k, v]) => (
                        <span
                            key={k}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 8,
                                borderBottom: `1px solid ${C.border}`,
                                paddingBottom: 4,
                            }}
                        >
                            <T size={8} color={C.mutedFg}>
                                {k}
                            </T>
                            <T size={8.5} weight={600}>
                                {v}
                            </T>
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Fingerprint size={11} color={C.mutedFg} />
                        <T size={7.5} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, monospace' }}>
                            Huella: 3f9a…c21e
                        </T>
                    </span>
                </div>
            </At>
            <Cursor a="ecs-cursor" click="ecs-ring" rest={[210, 272]} />
        </Stage>
    );
}
