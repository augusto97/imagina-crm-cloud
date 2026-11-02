import { ChevronDown, Mail, MailPlus, RotateCw } from 'lucide-react';

import { At, Avatar, Btn, C, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Invitar a alguien por email: se escribe el correo, se elige el rol, se
 * toca «Invitar» y la persona aparece con «Invitación pendiente» mientras le
 * llega el correo para definir su contraseña.
 */

const CSS = `
@keyframes ei-type{0%,10%{width:0}34%,100%{width:118px}}
@keyframes ei-caret{0%,8%{opacity:0}10%,34%{opacity:1}36%,100%{opacity:0}}
@keyframes ei-cursor{0%{transform:translate(300px,250px);opacity:0}6%{opacity:1}36%,42%{transform:translate(270px,102px)}58%,86%{transform:translate(236px,226px);opacity:1}94%,100%{transform:translate(236px,226px);opacity:0}}
@keyframes ei-ring{0%,40%{opacity:0;transform:scale(.4)}42%{opacity:1;transform:scale(1)}47%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ei-btn{0%,40%{transform:scale(1)}42%{transform:scale(.94)}45%,100%{transform:scale(1)}}
@keyframes ei-row{0%,46%{opacity:0;transform:translateY(-8px)}54%,90%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ei-mail{0%,50%{opacity:0;transform:translate(-40px,20px) scale(.85)}62%,90%{opacity:1;transform:translate(0,0) scale(1)}97%,100%{opacity:0}}
@keyframes ei-count{0%,50%{opacity:1}54%,92%{opacity:0}100%{opacity:1}}
@keyframes ei-count2{0%,50%{opacity:0}54%,92%{opacity:1}100%{opacity:0}}
`;

function Member({
    initials,
    name,
    email,
    role,
    t,
}: {
    initials: string;
    name: string;
    email: string;
    role: string;
    t: 'violet' | 'cyan' | 'amber';
}): JSX.Element {
    return (
        <div
            style={{
                height: 34,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderBottom: `1px solid ${C.border}`,
            }}
        >
            <Avatar initials={initials} t={t} size={20} />
            <span
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <T size={9.5} weight={600}>
                    {name}
                </T>
                <T size={8} color={C.mutedFg}>
                    {email}
                </T>
            </span>
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    height: 18,
                    padding: '0 6px',
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    fontSize: 8.5,
                    fontWeight: 600,
                }}
            >
                {role}
                <ChevronDown size={9} />
            </span>
        </div>
    );
}

export default function EquipoInvite(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Miembros, se escribe el correo de una persona, se elige el rol Agente y se toca Invitar: la persona aparece con la etiqueta «Invitación pendiente» y le llega un correo para definir su contraseña."
            tint="cyan"
        >
            <Keyframes css={CSS} />
            <Win x={16} y={34} w={300} h={234} title="Ajustes · Miembros">
                <At x={12} y={10}>
                    <T size={11} weight={700}>
                        Miembros de la empresa
                    </T>
                </At>
                {/* Formulario */}
                <At x={12} y={32} w={276} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                        style={{
                            flex: 1,
                            height: 24,
                            border: `1px solid ${primary(0.6)}`,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 7px',
                            gap: 2,
                            boxShadow: `0 0 0 3px ${primary(0.12)}`,
                        }}
                    >
                        <span
                            data-a=""
                            style={{
                                animationName: 'ei-type',
                                width: 118,
                                overflow: 'hidden',
                                display: 'inline-block',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            <T size={9.5}>mateo@cafeaurora.co</T>
                        </span>
                        <span
                            data-a=""
                            style={{
                                animationName: 'ei-caret',
                                width: 1,
                                height: 11,
                                background: C.fg,
                                opacity: 0,
                            }}
                        />
                    </span>
                    <span
                        style={{
                            height: 24,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0 7px',
                            border: `1px solid ${C.border}`,
                            borderRadius: 6,
                            fontSize: 9.5,
                            fontWeight: 600,
                        }}
                    >
                        Agente <ChevronDown size={10} />
                    </span>
                    <span data-a="" style={{ animationName: 'ei-btn', display: 'inline-flex' }}>
                        <Btn label={<>{<MailPlus size={11} />} Invitar</>} style={{ height: 24 }} />
                    </span>
                </At>
                {/* Lista */}
                <At x={12} y={68} w={276} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
                    <div style={{ position: 'relative', height: 14 }}>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                animationName: 'ei-count',
                                opacity: 0,
                            }}
                        >
                            <T size={8.5} color={C.mutedFg}>
                                2 personas
                            </T>
                        </span>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                animationName: 'ei-count2',
                            }}
                        >
                            <T size={8.5} color={C.mutedFg}>
                                3 personas · 1 con invitación pendiente
                            </T>
                        </span>
                    </div>
                    <Member initials="AG" name="Ana Gómez" email="ana@cafeaurora.co" role="Admin" t="violet" />
                    <Member initials="LM" name="Luis Mejía" email="luis@cafeaurora.co" role="Agente" t="cyan" />
                    <div
                        data-a=""
                        style={{
                            animationName: 'ei-row',
                            height: 34,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: tone('amber', 0.07),
                            margin: '0 -6px',
                            padding: '0 6px',
                            borderRadius: 6,
                        }}
                    >
                        <Avatar initials="MC" t="amber" size={20} />
                        <span
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                flex: 1,
                            }}
                        >
                            <T size={9.5} weight={600}>
                                mateo@cafeaurora.co
                            </T>
                            <Pill
                                t="amber"
                                label="Invitación pendiente"
                                style={{
                                    height: 14,
                                    fontSize: 8,
                                    padding: '0 6px',
                                    alignSelf: 'flex-start',
                                }}
                            />
                        </span>
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 8.5,
                                fontWeight: 600,
                                color: primary(),
                            }}
                        >
                            <RotateCw size={9} /> Reenviar
                        </span>
                    </div>
                </At>
            </Win>

            {/* El correo que le llega */}
            <At x={330} y={84} w={136} a="ei-mail">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: '0 14px 30px -14px rgba(15,23,42,.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span
                            style={{
                                width: 20,
                                height: 20,
                                borderRadius: 6,
                                background: primary(0.14),
                                color: primary(),
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Mail size={11} />
                        </span>
                        <T size={8} color={C.mutedFg}>
                            Correo nuevo
                        </T>
                    </span>
                    <T size={9.5} weight={700} style={{ whiteSpace: 'normal' }}>
                        Te invitaron a «Café Aurora»
                    </T>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Define tu contraseña para entrar. El enlace vence en 7 días.
                    </T>
                    <Btn label="Definir contraseña" style={{ alignSelf: 'flex-start' }} />
                </div>
            </At>
            <Cursor a="ei-cursor" click="ei-ring" rest={[236, 226]} />
        </Stage>
    );
}
