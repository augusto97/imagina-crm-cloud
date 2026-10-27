import { Ban, Building2, KeyRound, MailPlus, RotateCw } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Pill, Stage, T, primary } from '../kit';

/**
 * Usuarios de la plataforma: en el menú de una cuenta están reenviar la
 * invitación, mandar el reset de contraseña, desactivar (cierra sus sesiones
 * al instante) y sumarla a una empresa.
 */

const CSS = `
@keyframes pus-menu{0%,18%{opacity:0;transform:translateY(-6px)}24%,50%{opacity:1;transform:translateY(0)}56%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes pus-cursor{0%{transform:translate(240px,290px);opacity:0}6%{opacity:1}14%,20%{transform:translate(438px,113px)}40%,48%{transform:translate(380px,206px)}64%,88%{transform:translate(446px,284px);opacity:1}95%,100%{opacity:0;transform:translate(446px,284px)}}
@keyframes pus-ring{0%,16%{opacity:0;transform:scale(.4)}18%{opacity:1;transform:scale(1)}22%{opacity:0;transform:scale(1.6)}44%{opacity:0;transform:scale(.4)}46%{opacity:1;transform:scale(1)}50%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pus-hov{0%,40%{background:transparent}44%,50%{background:hsl(var(--imcrm-destructive) / .1)}56%,100%{background:transparent}}
@keyframes pus-a{0%,50%{opacity:1}56%,92%{opacity:0}100%{opacity:1}}
@keyframes pus-b{0%,50%{opacity:0;transform:scale(.7)}56%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pus-dim{0%,50%{opacity:1}56%,92%{opacity:.5}100%{opacity:1}}
@keyframes pus-note{0%,56%{opacity:0;transform:translateY(6px)}62%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
`;

function UserRow({ i, n, e, ws, state, a }: { i: string; n: string; e: string; ws: string; state: JSX.Element; a?: boolean }): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 38,
                padding: '0 11px',
                borderTop: `1px solid ${C.border}`,
                animationName: a ? 'pus-dim' : undefined,
            }}
        >
            <Avatar initials={i} t="violet" size={20} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, width: 150 }}>
                <T size={9} weight={600}>
                    {n}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {e}
                </T>
            </span>
            <T size={8.5} color={C.mutedFg} style={{ width: 90 }}>
                {ws}
            </T>
            <span
                style={{
                    flex: 1,
                    position: 'relative',
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                {state}
            </span>
            <T size={10} weight={700} color={C.mutedFg}>
                ⋯
            </T>
        </div>
    );
}

export default function PlatUsers(): JSX.Element {
    return (
        <Stage
            label="En Usuarios, el menú de una cuenta tiene reenviar la invitación, enviar el reset de contraseña, desactivar la cuenta y editar sus empresas. Al desactivarla, la persona ya no puede entrar y sus sesiones se cierran al instante."
            tint="slate"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={20}
                w={452}
                h={196}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <div
                    style={{
                        padding: '9px 11px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                    }}
                >
                    <T size={10.5} weight={700} style={{ flex: 1 }}>
                        Usuarios
                    </T>
                    <span
                        style={{
                            height: 20,
                            width: 120,
                            borderRadius: 5,
                            border: `1px solid ${C.border}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '0 6px',
                        }}
                    >
                        <T size={8} color={C.mutedFg}>
                            persona@empresa.com
                        </T>
                    </span>
                    <span
                        style={{
                            height: 20,
                            padding: '0 8px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                        }}
                    >
                        <MailPlus size={10} /> Crear e invitar
                    </span>
                </div>
                <UserRow i="AG" n="Ana Gómez" e="ana@cafeaurora.co" ws="Café Aurora" state={<Pill t="mint" label="Activa" />} />
                <UserRow
                    i="JR"
                    n="Jorge Ruiz"
                    e="jorge@ferreteriaelsol.co"
                    ws="Ferretería El Sol"
                    a
                    state={
                        <>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    height: 18,
                                    display: 'flex',
                                    alignItems: 'center',
                                    opacity: 0,
                                    animationName: 'pus-a',
                                }}
                            >
                                <Pill t="mint" label="Activa" />
                            </span>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    height: 18,
                                    display: 'flex',
                                    alignItems: 'center',
                                    animationName: 'pus-b',
                                }}
                            >
                                <Pill t="rose" label="Desactivada" icon={<Ban size={9} />} />
                            </span>
                        </>
                    }
                />
                <UserRow i="VR" n="Valentina Ríos" e="valentina@agenciarumbo.co" ws="Agencia Rumbo" state={<Pill t="amber" label="Invitación pendiente" />} />
                <UserRow i="OP" n="Operador" e="soporte@plataforma.com" ws="—" state={<Pill t="violet" label="Superadmin" />} />
            </At>

            {/* Menú de acciones */}
            <At x={318} y={124} w={146} a="pus-menu">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 9,
                        padding: 4,
                        boxShadow: '0 16px 30px -14px rgba(15,23,42,.55)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1,
                    }}
                >
                    {[
                        [<Building2 key="e" size={10} />, 'Editar'],
                        [<RotateCw key="r" size={10} />, 'Reenviar invitación'],
                        [<KeyRound key="k" size={10} />, 'Enviar reset de contraseña'],
                    ].map(([icon, l]) => (
                        <span
                            key={l as string}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                height: 20,
                                padding: '0 7px',
                                borderRadius: 5,
                            }}
                        >
                            <span style={{ color: C.mutedFg, display: 'inline-flex' }}>{icon}</span>
                            <T size={8.5}>{l}</T>
                        </span>
                    ))}
                    <span
                        data-a=""
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            height: 20,
                            padding: '0 7px',
                            borderRadius: 5,
                            animationName: 'pus-hov',
                        }}
                    >
                        <Ban size={10} color={C.destructive} />
                        <T size={8.5} color={C.destructive}>
                            Desactivar cuenta
                        </T>
                    </span>
                </div>
            </At>

            <At x={14} y={228} w={452} a="pus-note">
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '9px 12px',
                        borderRadius: 10,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                    }}
                >
                    <Ban size={13} color={C.destructive} />
                    <T size={9} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Jorge ya no puede entrar y sus sesiones abiertas se cerraron al instante. Se puede reactivar cuando quieras.
                    </T>
                </div>
            </At>
            <Cursor a="pus-cursor" click="pus-ring" rest={[446, 284]} />
        </Stage>
    );
}
