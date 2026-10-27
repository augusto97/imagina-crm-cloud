import { DatabaseZap, Download, FileText, MessageSquare, UserX } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Tus datos: descargas un archivo con tu cuenta y lo que escribiste; si
 * borras la cuenta, tus comentarios quedan en la empresa a nombre de
 * «Usuario eliminado».
 */

const CSS = `
@keyframes cdt-file{0%,8%{opacity:0;transform:translateY(-14px)}18%,40%{opacity:1;transform:translateY(0)}48%,100%{opacity:0;transform:translateY(10px)}}
@keyframes cdt-name1{0%,58%{opacity:1}64%,92%{opacity:0}100%{opacity:1}}
@keyframes cdt-name2{0%,58%{opacity:0}64%,92%{opacity:1}100%{opacity:0}}
@keyframes cdt-av1{0%,58%{opacity:1}64%,92%{opacity:0}100%{opacity:1}}
@keyframes cdt-av2{0%,58%{opacity:0}64%,92%{opacity:1}100%{opacity:0}}
@keyframes cdt-del{0%,48%{box-shadow:0 0 0 0 transparent}52%,58%{box-shadow:0 0 0 4px hsl(var(--imcrm-destructive) / .25)}64%,100%{box-shadow:0 0 0 0 transparent}}
`;

export default function CuentaDatos(): JSX.Element {
    return (
        <Stage
            label="En Tus datos se descarga un archivo con tu cuenta y lo que escribiste. Si borras tu cuenta, tus comentarios quedan en la empresa, firmados como «Usuario eliminado»."
            tint="rose"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={32}
                w={220}
                h={236}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DatabaseZap size={13} color={primary()} />
                    <T size={11} weight={700}>
                        Tus datos
                    </T>
                </span>
                <div
                    style={{
                        border: `1px solid ${C.border}`,
                        borderRadius: 9,
                        padding: 9,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                    }}
                >
                    <T size={9.5} weight={700}>
                        Descargar tus datos
                    </T>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Tu cuenta, tus empresas y lo que escribiste: comentarios, actividad, menciones y archivos.
                    </T>
                    <span
                        style={{
                            alignSelf: 'flex-start',
                            height: 20,
                            padding: '0 9px',
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                    >
                        <Download size={10} /> Descargar
                    </span>
                </div>
                <div
                    style={{
                        border: `1px solid hsl(var(--imcrm-destructive) / .35)`,
                        borderRadius: 9,
                        padding: 9,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                    }}
                >
                    <T size={9.5} weight={700} color={C.destructive}>
                        Borrar tu cuenta
                    </T>
                    <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Se borran tu email, tu nombre, tu contraseña y tu acceso. Es irreversible.
                    </T>
                    <span
                        data-a=""
                        style={{
                            alignSelf: 'flex-start',
                            height: 20,
                            padding: '0 9px',
                            borderRadius: 6,
                            background: C.destructive,
                            color: '#fff',
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            animationName: 'cdt-del',
                        }}
                    >
                        <UserX size={10} /> Borrar mi cuenta
                    </span>
                </div>
            </At>

            {/* El archivo descargado */}
            <At x={252} y={30} w={140} a="cdt-file" style={{ opacity: 0 }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '8px 10px',
                        borderRadius: 9,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        boxShadow: '0 10px 24px -14px rgba(15,23,42,.5)',
                    }}
                >
                    <FileText size={16} color={tone('blue')} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={8.5} weight={700}>
                            mis-datos-2026-10-27
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Descargado
                        </T>
                    </span>
                </div>
            </At>

            {/* Un comentario en la empresa */}
            <At
                x={252}
                y={100}
                w={212}
                h={168}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MessageSquare size={11} color={C.mutedFg} />
                    <T size={9} weight={700}>
                        Hotel Brisas · Comentarios
                    </T>
                </span>
                {[0, 1].map((i) => (
                    <div key={i} style={{ display: 'flex', gap: 7 }}>
                        <span style={{ position: 'relative', width: 20, height: 20 }}>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    opacity: 0,
                                    animationName: 'cdt-av1',
                                }}
                            >
                                <Avatar initials="LM" t="cyan" size={20} />
                            </span>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    animationName: 'cdt-av2',
                                }}
                            >
                                <span
                                    style={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: 99,
                                        background: C.muted,
                                        color: C.mutedFg,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <UserX size={10} />
                                </span>
                            </span>
                        </span>
                        <span
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                flex: 1,
                            }}
                        >
                            <span style={{ position: 'relative', height: 12, display: 'block' }}>
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        opacity: 0,
                                        animationName: 'cdt-name1',
                                    }}
                                >
                                    <T size={8.5} weight={700}>
                                        Luis Mejía
                                    </T>
                                </span>
                                <span
                                    data-a=""
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        animationName: 'cdt-name2',
                                    }}
                                >
                                    <T size={8.5} weight={700} color={C.mutedFg}>
                                        Usuario eliminado
                                    </T>
                                </span>
                            </span>
                            <T size={8.5} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                                {i === 0 ? 'Les envié la propuesta firmada.' : 'Confirmaron el pago del anticipo.'}
                            </T>
                        </span>
                    </div>
                ))}
                <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    Lo que escribiste dentro de una empresa es de la empresa: se conserva.
                </T>
            </At>
        </Stage>
    );
}
