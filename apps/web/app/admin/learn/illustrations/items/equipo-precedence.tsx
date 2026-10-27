import { KeyRound, User, Users } from 'lucide-react';

import { At, Avatar, C, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Qué acceso manda en una lista: el del rol es la base, el del equipo lo pisa
 * y el que se le da a la persona puntual pisa a los dos.
 */

const CSS = `
@keyframes epr-l1{0%,4%{opacity:0;transform:translateY(-14px)}10%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes epr-l2{0%,28%{opacity:0;transform:translateY(-18px)}36%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes epr-l3{0%,54%{opacity:0;transform:translateY(-18px)}62%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes epr-r1{0%,10%{opacity:0}14%,32%{opacity:1}36%,100%{opacity:0}}
@keyframes epr-r2{0%,36%{opacity:0}40%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes epr-r3{0%,62%{opacity:0}66%,92%{opacity:1}100%{opacity:0}}
@keyframes epr-dim1{0%,34%{opacity:1}40%,92%{opacity:.45}100%{opacity:1}}
@keyframes epr-dim2{0%,60%{opacity:1}66%,92%{opacity:.45}100%{opacity:1}}
@keyframes epr-pulse{0%,12%,38%,64%,100%{box-shadow:0 0 0 0 transparent}16%,42%,68%{box-shadow:0 0 0 5px ${primary(0.18)}}24%,50%,76%{box-shadow:0 0 0 0 transparent}}
`;

function Layer({
    y,
    a,
    dim,
    icon,
    t,
    kicker,
    title,
    level,
}: {
    y: number;
    a: string;
    dim?: string;
    icon: JSX.Element;
    t: 'slate' | 'amber' | 'violet';
    kicker: string;
    title: string;
    level: string;
}): JSX.Element {
    return (
        <At x={24} y={y} w={250} h={52} a={a}>
            <div
                data-a={dim ? '' : undefined}
                style={{
                    height: 52,
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderLeft: `4px solid ${tone(t)}`,
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '0 11px',
                    boxShadow: '0 10px 24px -16px rgba(15,23,42,.5)',
                    animationName: dim,
                    opacity: dim ? 0.45 : 1,
                }}
            >
                <IconSquare t={t} size={26}>
                    {icon}
                </IconSquare>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {kicker}
                    </T>
                    <T size={10.5} weight={600}>
                        {title}
                    </T>
                </span>
                <span
                    style={{
                        height: 18,
                        padding: '0 7px',
                        borderRadius: 5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        fontSize: 8.5,
                        fontWeight: 700,
                        background: tone(t, 0.14),
                        color: tone(t),
                    }}
                >
                    {level}
                </span>
            </div>
        </At>
    );
}

export default function EquipoPrecedence(): JSX.Element {
    return (
        <Stage
            label="Tres capas de acceso a una lista: el rol Agente da «Solo lo suyo», el equipo Ventas lo sube a «Colaborar» y el acceso dado a Luis en persona lo deja en «Control total». Manda el más específico."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At x={24} y={22}>
                <T size={11} weight={700}>
                    ¿Qué puede hacer Luis en «Oportunidades»?
                </T>
            </At>
            <At x={24} y={40}>
                <T size={8.5} color={C.mutedFg}>
                    Manda la capa de más arriba: persona › equipo › rol
                </T>
            </At>

            <Layer y={212} a="epr-l1" dim="epr-dim1" icon={<KeyRound size={13} />} t="slate" kicker="Su rol" title="Agente" level="Solo lo suyo" />
            <Layer y={152} a="epr-l2" dim="epr-dim2" icon={<Users size={13} />} t="amber" kicker="Su equipo" title="Ventas" level="Colaborar" />
            <Layer y={92} a="epr-l3" icon={<User size={13} />} t="violet" kicker="Él, en persona" title="Luis Mejía" level="Control total" />

            {/* Resultado */}
            <At
                x={296}
                y={128}
                w={164}
                h={110}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    boxShadow: '0 14px 30px -18px rgba(15,23,42,.55)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Avatar initials="LM" t="cyan" size={24} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={10} weight={700}>
                            Luis Mejía
                        </T>
                        <T size={8} color={C.mutedFg}>
                            en esta lista tiene
                        </T>
                    </span>
                </span>
                <span
                    data-a=""
                    style={{
                        position: 'relative',
                        height: 28,
                        borderRadius: 8,
                        animationName: 'epr-pulse',
                    }}
                >
                    {(
                        [
                            ['epr-r1', 'Solo lo suyo', 'slate'],
                            ['epr-r2', 'Colaborar', 'amber'],
                            ['epr-r3', 'Control total', 'violet'],
                        ] as const
                    ).map(([a, l, t]) => (
                        <span
                            key={l}
                            data-a=""
                            style={{
                                position: 'absolute',
                                inset: 0,
                                borderRadius: 8,
                                background: tone(t, 0.14),
                                color: tone(t),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 11,
                                fontWeight: 700,
                                opacity: a === 'epr-r3' ? 1 : 0,
                                animationName: a,
                            }}
                        >
                            {l}
                        </span>
                    ))}
                </span>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    Sólo en esta lista. Su rol no cambia en el resto de la app.
                </T>
            </At>
        </Stage>
    );
}
