import { AtSign, Bell, Star, Users } from 'lucide-react';

import { At, Avatar, Bubble, C, Flow, IconSquare, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Un equipo «Ventas»: el registro queda asignado al equipo y una mención
 * @Ventas en un comentario le llega a cada persona del equipo.
 */

const CSS = `
@keyframes et-chip{0%,10%{opacity:0;transform:scale(.6)}18%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes et-msg{0%,26%{opacity:0;transform:translateY(8px)}34%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes et-at{0%,34%{background:transparent}38%,48%{background:${primary(0.22)}}56%,100%{background:transparent}}
@keyframes et-n1{0%,46%{opacity:0;transform:translateX(-12px) scale(.9)}52%,92%{opacity:1;transform:translateX(0) scale(1)}100%{opacity:0}}
@keyframes et-n2{0%,52%{opacity:0;transform:translateX(-12px) scale(.9)}58%,92%{opacity:1;transform:translateX(0) scale(1)}100%{opacity:0}}
@keyframes et-n3{0%,58%{opacity:0;transform:translateX(-12px) scale(.9)}64%,92%{opacity:1;transform:translateX(0) scale(1)}100%{opacity:0}}
@keyframes et-flow{0%,44%{opacity:0}50%,92%{opacity:1}100%{opacity:0}}
`;

function Person({
    y,
    initials,
    name,
    t,
    lead,
    a,
}: {
    y: number;
    initials: string;
    name: string;
    t: 'violet' | 'cyan' | 'amber';
    lead?: boolean;
    a: string;
}): JSX.Element {
    return (
        <At
            x={330}
            y={y}
            w={136}
            h={46}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: '0 9px',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
            }}
        >
            <Avatar initials={initials} t={t} size={22} />
            <span
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <T size={9.5} weight={600}>
                    {name}
                </T>
                {lead ? (
                    <T size={7.5} color={tone('amber')} weight={700} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Star size={8} /> Líder
                    </T>
                ) : (
                    <T size={7.5} color={C.mutedFg}>
                        Ventas
                    </T>
                )}
            </span>
            <span
                data-a=""
                style={{
                    animationName: a,
                    position: 'relative',
                    display: 'inline-flex',
                    color: primary(),
                }}
            >
                <Bell size={14} />
                <span
                    style={{
                        position: 'absolute',
                        right: -3,
                        top: -3,
                        width: 8,
                        height: 8,
                        borderRadius: 99,
                        background: C.destructive,
                        border: `1.5px solid ${C.card}`,
                    }}
                />
            </span>
        </At>
    );
}

export default function EquipoTeams(): JSX.Element {
    return (
        <Stage
            label="Un equipo «Ventas» con tres personas: el registro queda asignado al equipo y una mención @Ventas en un comentario le avisa a cada una de ellas."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At x={16} y={16} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <IconSquare t="amber" size={24}>
                    <Users size={13} />
                </IconSquare>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={11} weight={700}>
                        Equipo Ventas
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        3 personas · Ana es la líder
                    </T>
                </span>
            </At>

            <Win x={16} y={60} w={272} h={206} title="Hotel Brisas · Oportunidades">
                <At x={12} y={10} w={248}>
                    {[
                        ['Etapa', <Pill key="e" t="blue" label="Propuesta" />],
                        [
                            'Monto',
                            <T key="m" size={9.5} weight={600}>
                                $ 3.600.000
                            </T>,
                        ],
                    ].map(([k, v]) => (
                        <div
                            key={k as string}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                height: 24,
                                borderBottom: `1px solid ${C.border}`,
                            }}
                        >
                            <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                                {k}
                            </T>
                            {v}
                        </div>
                    ))}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: 24,
                            borderBottom: `1px solid ${C.border}`,
                        }}
                    >
                        <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                            Equipo
                        </T>
                        <span data-a="" style={{ animationName: 'et-chip', display: 'inline-flex' }}>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    height: 18,
                                    padding: '0 7px',
                                    borderRadius: 5,
                                    background: tone('amber'),
                                    color: '#fff',
                                    fontSize: 9,
                                    fontWeight: 700,
                                }}
                            >
                                <Users size={9} /> Ventas
                            </span>
                        </span>
                    </div>
                </At>
                <At x={12} y={84}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Comentarios
                    </T>
                </At>
                <At x={12} y={104} a="et-msg" style={{ display: 'flex', gap: 6 }}>
                    <Avatar initials="LM" t="cyan" size={20} />
                    <Bubble style={{ maxWidth: 210 }}>
                        <span
                            data-a=""
                            style={{
                                animationName: 'et-at',
                                borderRadius: 4,
                                padding: '0 2px',
                                color: primary(),
                                fontWeight: 700,
                            }}
                        >
                            <AtSign size={8} style={{ display: 'inline', verticalAlign: '-1px' }} />
                            Ventas
                        </span>{' '}
                        el cliente pidió la propuesta firmada para el viernes, ¿quién la lleva?
                    </Bubble>
                </At>
            </Win>

            <At x={288} y={170} a="et-flow">
                <Flow x1={0} y1={0} x2={42} y2={-76} />
                <Flow x1={0} y1={0} x2={42} y2={-18} />
                <Flow x1={0} y1={0} x2={42} y2={40} />
            </At>
            <Person y={70} initials="AG" name="Ana Gómez" t="violet" lead a="et-n1" />
            <Person y={128} initials="JP" name="Jorge Pérez" t="amber" a="et-n2" />
            <Person y={186} initials="SC" name="Sofía Cárdenas" t="cyan" a="et-n3" />
        </Stage>
    );
}
