import { Archive, Database, FolderOpen, KeyRound, Lock, Server, Settings2 } from 'lucide-react';

import { At, C, Flow, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Copias de seguridad: una copia completa (base de datos, archivos, ajustes y
 * secretos) se cifra con la contraseña de recuperación y sube a Google Drive.
 * Si el servidor se pierde, uno nuevo la baja y queda igual.
 */

const CSS = `
@keyframes pbk-p1{0%,4%{opacity:0;transform:translate(0,0) scale(.8)}10%,22%{opacity:1;transform:translate(0,0) scale(1)}32%,100%{opacity:0;transform:translate(110px,30px) scale(.6)}}
@keyframes pbk-p2{0%,8%{opacity:0;transform:translate(0,0) scale(.8)}14%,22%{opacity:1;transform:translate(0,0) scale(1)}32%,100%{opacity:0;transform:translate(110px,4px) scale(.6)}}
@keyframes pbk-p3{0%,12%{opacity:0;transform:translate(0,0) scale(.8)}18%,22%{opacity:1;transform:translate(0,0) scale(1)}32%,100%{opacity:0;transform:translate(110px,-22px) scale(.6)}}
@keyframes pbk-arc{0%,26%{opacity:0;transform:scale(.6)}34%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pbk-lock{0%,38%{opacity:0;transform:scale(.4) rotate(-20deg)}44%,92%{opacity:1;transform:scale(1) rotate(0)}100%{opacity:0}}
@keyframes pbk-fly{0%,46%{opacity:0;transform:translate(0,0)}50%{opacity:1}62%,100%{opacity:0;transform:translate(118px,0)}}
@keyframes pbk-file{0%,58%{opacity:0;transform:translateY(-6px)}64%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pbk-new{0%,68%{opacity:0;transform:translateY(10px)}76%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes pbk-flow2{0%,70%{opacity:0}76%,92%{opacity:1}100%{opacity:0}}
`;

function DriveMark({ size = 16 }: { size?: number }): JSX.Element {
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

function Piece({ y, icon, label, a }: { y: number; icon: JSX.Element; label: string; a: string }): JSX.Element {
    return (
        <At x={26} y={y} a={a} style={{ opacity: 0 }}>
            <span
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    height: 22,
                    padding: '0 8px',
                    borderRadius: 7,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    boxShadow: '0 6px 14px -10px rgba(15,23,42,.5)',
                }}
            >
                <span style={{ color: primary(), display: 'inline-flex' }}>{icon}</span>
                <T size={8.5} weight={600}>
                    {label}
                </T>
            </span>
        </At>
    );
}

export default function PlatBackups(): JSX.Element {
    return (
        <Stage
            label="Una copia completa junta la base de datos, los archivos subidos, los ajustes de la plataforma y los secretos del servidor; se cifra con la contraseña de recuperación y sube a Google Drive. Si el servidor se pierde, uno nuevo la baja y queda igual."
            tint="mint"
        >
            <Keyframes css={CSS} />
            {/* Servidor actual */}
            <At
                x={14}
                y={36}
                w={130}
                h={156}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    boxShadow: '0 10px 26px -14px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Server size={14} />
                    <T size={9.5} weight={700}>
                        Servidor
                    </T>
                </span>
                <T size={7.5} color={C.mutedFg}>
                    Todos los días a las 03:00
                </T>
                {[
                    [<Database key="d" size={10} />, 'Base de datos'],
                    [<Archive key="a" size={10} />, 'Archivos'],
                    [<Settings2 key="s" size={10} />, 'Ajustes y secretos'],
                ].map(([icon, l]) => (
                    <span
                        key={l as string}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            height: 22,
                            padding: '0 7px',
                            borderRadius: 7,
                            border: `1px dashed ${C.border}`,
                            color: C.mutedFg,
                            marginTop: 4,
                        }}
                    >
                        {icon}
                        <T size={8} color={C.mutedFg}>
                            {l}
                        </T>
                    </span>
                ))}
            </At>
            <Piece y={88} icon={<Database size={11} />} label="Base de datos" a="pbk-p1" />
            <Piece y={120} icon={<Archive size={11} />} label="Archivos" a="pbk-p2" />
            <Piece y={152} icon={<Settings2 size={11} />} label="Ajustes y secretos" a="pbk-p3" />

            {/* La copia cifrada */}
            <At x={160} y={86} w={112} a="pbk-arc">
                <div
                    style={{
                        position: 'relative',
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 11,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        boxShadow: '0 12px 26px -14px rgba(15,23,42,.5)',
                    }}
                >
                    <span
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: 9,
                            background: tone('mint', 0.16),
                            color: tone('mint'),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Archive size={17} />
                    </span>
                    <T size={8.5} weight={700}>
                        Copia completa
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        v0.1.322 · 412 MB
                    </T>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            right: -8,
                            top: -8,
                            width: 22,
                            height: 22,
                            borderRadius: 99,
                            background: C.fg,
                            color: C.card,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animationName: 'pbk-lock',
                        }}
                    >
                        <Lock size={11} />
                    </span>
                </div>
            </At>
            <At x={272} y={128} a="pbk-fly" style={{ opacity: 0, color: primary() }}>
                <Archive size={16} />
            </At>

            {/* Google Drive */}
            <At
                x={318}
                y={36}
                w={148}
                h={156}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                    boxShadow: '0 10px 26px -14px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DriveMark />
                    <T size={9.5} weight={700}>
                        Google Drive
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <FolderOpen size={11} color={C.mutedFg} />
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Copias del servidor / produccion
                    </T>
                </span>
                {['27/10 · 03:00', '26/10 · 03:00', '25/10 · 03:00'].map((d, i) => (
                    <span
                        key={d}
                        data-a={i === 0 ? '' : undefined}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            height: 20,
                            padding: '0 6px',
                            borderRadius: 6,
                            border: `1px solid ${i === 0 ? primary(0.5) : C.border}`,
                            animationName: i === 0 ? 'pbk-file' : undefined,
                        }}
                    >
                        <Lock size={9} color={C.mutedFg} />
                        <T size={8} weight={i === 0 ? 700 : 500}>
                            {d}
                        </T>
                    </span>
                ))}
            </At>

            {/* Servidor nuevo */}
            <At x={318} y={214} w={148} a="pbk-new">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 9,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        boxShadow: '0 10px 26px -14px rgba(15,23,42,.45)',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Server size={13} color={tone('blue')} />
                        <T size={9} weight={700}>
                            Servidor nuevo
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <KeyRound size={9} color={C.mutedFg} />
                        <T size={7.5} color={C.mutedFg}>
                            La baja y la restaura
                        </T>
                    </span>
                </div>
            </At>
            <At x={392} y={192} a="pbk-flow2">
                <Flow x1={0} y1={0} x2={1} y2={22} />
            </At>
            <At x={14} y={214} w={290} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={9} weight={700}>
                    Qué guarda cada copia
                </T>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                    Base de datos + archivos subidos + ajustes de la plataforma + secretos del servidor. Con ella vuelves a un estado anterior o levantas la app
                    en otro servidor.
                </T>
            </At>
        </Stage>
    );
}
