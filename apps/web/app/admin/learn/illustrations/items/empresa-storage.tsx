import { FileImage, FileText, HardDrive, Server } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Almacenamiento propio: los archivos pasan del servidor de la plataforma al
 * Google Drive de la empresa y la barra de espacio del plan se libera.
 */

const CSS = `
@keyframes est-f1{0%,14%{opacity:1;transform:translate(0,0)}28%{opacity:1;transform:translate(252px,22px)}32%,90%{opacity:0;transform:translate(252px,22px)}96%,100%{opacity:1;transform:translate(0,0)}}
@keyframes est-f2{0%,26%{opacity:1;transform:translate(0,0)}40%{opacity:1;transform:translate(252px,-40px)}44%,90%{opacity:0;transform:translate(252px,-40px)}96%,100%{opacity:1;transform:translate(0,0)}}
@keyframes est-f3{0%,38%{opacity:1;transform:translate(0,0)}52%{opacity:1;transform:translate(252px,-102px)}56%,90%{opacity:0;transform:translate(252px,-102px)}96%,100%{opacity:1;transform:translate(0,0)}}
@keyframes est-bar{0%,16%{width:84%;background:${tone('amber')}}56%,90%{width:22%;background:${primary()}}98%,100%{width:84%;background:${tone('amber')}}}
@keyframes est-n1{0%,40%{opacity:1}50%,90%{opacity:0}98%,100%{opacity:1}}
@keyframes est-n2{0%,40%{opacity:0}50%,90%{opacity:1}98%,100%{opacity:0}}
@keyframes est-hint{0%,56%{opacity:0;transform:translateY(6px)}64%,90%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes est-d1{0%,28%{opacity:0;transform:scale(.6)}32%,90%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes est-d2{0%,40%{opacity:0;transform:scale(.6)}44%,90%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes est-d3{0%,52%{opacity:0;transform:scale(.6)}56%,90%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function DriveMark({ size = 18 }: { size?: number }): JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24">
            <path fill="#0066DA" d="M1.8 19.6l1.1 1.9c.2.4.5.7.9.9l3.9-6.7H0c0 .4.1.8.3 1.2l1.5 2.7z" />
            <path fill="#00AC47" d="M12 8.1L8.1 1.4c-.4.2-.7.5-.9.9L.3 14.5c-.2.4-.3.8-.3 1.2h7.7L12 8.1z" />
            <path fill="#EA4335" d="M20.4 22.4c.4-.2.7-.5.9-.9l.4-.8 2-3.4c.2-.4.3-.8.3-1.2h-7.7l1.6 3.2 2.5 3.1z" />
            <path fill="#00832D" d="M12 8.1l3.9-6.7c-.4-.2-.8-.3-1.2-.3H9.3c-.4 0-.8.1-1.2.3L12 8.1z" />
            <path fill="#2684FC" d="M16.3 15.7H7.7l-3.9 6.7c.4.2.8.3 1.2.3h14.2c.4 0 .8-.1 1.2-.3l-4.1-6.7z" />
            <path fill="#FFBA00" d="M20.4 8.6l-3.6-6.2c-.2-.4-.5-.7-.9-.9L12 8.1l4.3 7.6H24c0-.4-.1-.8-.3-1.2l-3.3-5.9z" />
        </svg>
    );
}

function File({ icon, name, t }: { icon: JSX.Element; name: string; t: 'rose' | 'blue' | 'violet' }): JSX.Element {
    return (
        <span
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 24,
                padding: '0 8px',
                borderRadius: 7,
                background: C.card,
                border: `1px solid ${C.border}`,
                boxShadow: '0 6px 14px -10px rgba(15,23,42,.5)',
                width: 150,
            }}
        >
            <span style={{ color: tone(t), display: 'inline-flex' }}>{icon}</span>
            <T size={8.5} weight={600}>
                {name}
            </T>
        </span>
    );
}

export default function EmpresaStorage(): JSX.Element {
    return (
        <Stage
            label="Los archivos de la empresa se mudan del servidor de la plataforma a su Google Drive con «Mover los archivos»: la barra de espacio del plan baja del 84 % al 22 %."
            tint="mint"
        >
            <Keyframes css={CSS} />
            {/* Servidor */}
            <At
                x={16}
                y={22}
                w={196}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: C.muted,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Server size={15} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={10} weight={700}>
                            Servidor de la plataforma
                        </T>
                        <T size={8} color={C.mutedFg}>
                            Cuenta para el espacio de tu plan
                        </T>
                    </span>
                </span>
                <span
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: 6,
                    }}
                >
                    <T size={8.5} weight={600}>
                        Almacenamiento
                    </T>
                    <span style={{ position: 'relative', width: 90, height: 12 }}>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                opacity: 0,
                                animationName: 'est-n1',
                            }}
                        >
                            <T size={8.5} weight={700} color={tone('amber')}>
                                840 de 1.000 MB
                            </T>
                        </span>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                animationName: 'est-n2',
                            }}
                        >
                            <T size={8.5} weight={700}>
                                220 de 1.000 MB
                            </T>
                        </span>
                    </span>
                </span>
                <span
                    style={{
                        height: 7,
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
                            width: '22%',
                            background: primary(),
                            animationName: 'est-bar',
                        }}
                    />
                </span>
                <span style={{ height: 120 }} />
            </At>
            <At x={28} y={128} a="est-f1" style={{ opacity: 0, zIndex: 3 }}>
                <File icon={<FileText size={12} />} name="Factura FAC-1042.pdf" t="rose" />
            </At>
            <At x={28} y={160} a="est-f2" style={{ opacity: 0, zIndex: 3 }}>
                <File icon={<FileImage size={12} />} name="Foto local.jpg" t="blue" />
            </At>
            <At x={28} y={192} a="est-f3" style={{ opacity: 0, zIndex: 3 }}>
                <File icon={<FileText size={12} />} name="Contrato firmado.pdf" t="violet" />
            </At>

            <At
                x={28}
                y={140}
                w={172}
                a="est-hint"
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'center',
                    textAlign: 'center',
                }}
            >
                <T size={9} weight={700} color={C.success}>
                    Archivos movidos
                </T>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    Los enlaces que ya compartiste siguen funcionando.
                </T>
            </At>
            <At
                x={28}
                y={240}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 4,
                }}
            >
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
                        gap: 4,
                    }}
                >
                    <HardDrive size={10} /> Mover los archivos
                </span>
            </At>

            {/* Drive */}
            <At
                x={268}
                y={22}
                w={196}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span
                        style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: C.muted,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <DriveMark />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={10} weight={700}>
                            Google Drive · Café Aurora
                        </T>
                        <T size={8} color={C.success} weight={700}>
                            En uso · sin límite del plan
                        </T>
                    </span>
                </span>
                <T size={8} color={C.mutedFg} style={{ marginTop: 4 }}>
                    Carpeta de la app
                </T>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span data-a="" style={{ animationName: 'est-d3' }}>
                        <File icon={<FileText size={12} />} name="Contrato firmado.pdf" t="violet" />
                    </span>
                    <span data-a="" style={{ animationName: 'est-d2' }}>
                        <File icon={<FileImage size={12} />} name="Foto local.jpg" t="blue" />
                    </span>
                    <span data-a="" style={{ animationName: 'est-d1' }}>
                        <File icon={<FileText size={12} />} name="Factura FAC-1042.pdf" t="rose" />
                    </span>
                </span>
            </At>
        </Stage>
    );
}
