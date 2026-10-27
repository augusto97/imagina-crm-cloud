import { Check, KeyRound, Lock } from 'lucide-react';

import { At, C, Cursor, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Un rol propio: «Supervisor», basado en Agente, al que se le prenden dos
 * capacidades más (ver todos los registros y crear tableros). Aparece en la
 * lista de roles junto a los cuatro fijos.
 */

const CSS = `
@keyframes erc-cursor{0%{transform:translate(440px,280px);opacity:0}6%{opacity:1}20%,26%{transform:translate(244px,152px)}44%,50%{transform:translate(244px,245px)}64%,88%{transform:translate(426px,280px);opacity:1}94%,100%{transform:translate(426px,280px);opacity:0}}
@keyframes erc-ring{0%,22%{opacity:0;transform:scale(.4)}24%{opacity:1;transform:scale(1)}28%{opacity:0;transform:scale(1.6)}46%{opacity:0;transform:scale(.4)}48%{opacity:1;transform:scale(1)}52%,100%{opacity:0;transform:scale(1.6)}}
@keyframes erc-on1{0%,23%{background:transparent;border-color:${C.border}}25%,92%{background:${primary()};border-color:${primary()}}100%{background:transparent;border-color:${C.border}}}
@keyframes erc-on2{0%,47%{background:transparent;border-color:${C.border}}49%,92%{background:${primary()};border-color:${primary()}}100%{background:transparent;border-color:${C.border}}}
@keyframes erc-tick1{0%,23%{opacity:0}25%,92%{opacity:1}100%{opacity:0}}
@keyframes erc-tick2{0%,47%{opacity:0}49%,92%{opacity:1}100%{opacity:0}}
@keyframes erc-new{0%,58%{opacity:0;transform:translateX(-10px)}66%,90%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
`;

function Box({ on, a2 }: { on: boolean; a2?: 'erc-on1' | 'erc-on2' }): JSX.Element {
    const anim = a2;
    const fin = on || Boolean(a2);
    return (
        <span
            data-a={anim ? '' : undefined}
            style={{
                position: 'relative',
                width: 12,
                height: 12,
                borderRadius: 3,
                border: `1.5px solid ${fin ? primary() : C.border}`,
                background: fin ? primary() : 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                animationName: anim,
            }}
        >
            <span
                data-a={anim ? '' : undefined}
                style={{
                    display: 'inline-flex',
                    color: '#fff',
                    opacity: fin ? 1 : 0,
                    animationName: anim === 'erc-on1' ? 'erc-tick1' : anim === 'erc-on2' ? 'erc-tick2' : undefined,
                }}
            >
                <Check size={9} strokeWidth={3} />
            </span>
        </span>
    );
}

function Cap({ label, on, a2 }: { label: string; on: boolean; a2?: 'erc-on1' | 'erc-on2' }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 19 }}>
            <Box on={on} a2={a2} />
            <T size={9}>{label}</T>
        </div>
    );
}

function Group({ title }: { title: string }): JSX.Element {
    return (
        <T
            size={8}
            weight={700}
            color={C.mutedFg}
            style={{
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '.05em',
                marginTop: 6,
                marginBottom: 2,
            }}
        >
            {title}
        </T>
    );
}

function RoleRow({ name, hint, fixed, t }: { name: string; hint: string; fixed?: boolean; t: 'violet' | 'blue' | 'cyan' | 'slate' | 'amber' }): JSX.Element {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                height: 30,
                borderBottom: `1px solid ${C.border}`,
            }}
        >
            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: 99,
                    background: tone(t),
                    flexShrink: 0,
                }}
            />
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
                <T size={7.5} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {hint}
                </T>
            </span>
            {fixed && <Pill t="slate" label="Fijo" icon={<Lock size={8} />} style={{ height: 15, fontSize: 8 }} />}
        </div>
    );
}

export default function EquipoRolesCustom(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Roles, se crea el rol propio «Supervisor» basado en Agente y se le prenden dos capacidades: ver todos los registros y crear tableros. Aparece en la lista junto a los roles fijos."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <Win x={16} y={22} w={196} h={256} title="Ajustes · Roles">
                <At x={10} y={6} w={176}>
                    <Group title="Roles fijos" />
                    <RoleRow name="Admin" hint="Todo, incluidos miembros y plan" fixed t="violet" />
                    <RoleRow name="Manager" hint="Todos los registros, vistas…" fixed t="blue" />
                    <RoleRow name="Agente" hint="Sus registros, según cada lista" fixed t="cyan" />
                    <RoleRow name="Lector" hint="Mira, sin cambiar nada" fixed t="slate" />
                    <Group title="Roles propios" />
                    <div data-a="" style={{ animationName: 'erc-new' }}>
                        <RoleRow name="Supervisor" hint="Basado en Agente" t="amber" />
                    </div>
                </At>
            </Win>

            <Win x={226} y={22} w={238} h={256} title="Nuevo rol">
                <At x={12} y={8} w={214} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ flex: 1 }}>
                        <T size={8} color={C.mutedFg}>
                            Nombre
                        </T>
                        <span
                            style={{
                                display: 'flex',
                                height: 20,
                                alignItems: 'center',
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                padding: '0 6px',
                                marginTop: 2,
                            }}
                        >
                            <T size={9.5} weight={600}>
                                Supervisor
                            </T>
                        </span>
                    </span>
                    <span style={{ flex: 1 }}>
                        <T size={8} color={C.mutedFg}>
                            Basado en
                        </T>
                        <span
                            style={{
                                display: 'flex',
                                height: 20,
                                alignItems: 'center',
                                gap: 4,
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                padding: '0 6px',
                                marginTop: 2,
                            }}
                        >
                            <KeyRound size={9} color={tone('cyan')} />
                            <T size={9.5} weight={600}>
                                Agente
                            </T>
                        </span>
                    </span>
                </At>
                <At x={12} y={52} w={214}>
                    <T size={9} weight={700}>
                        Qué puede hacer
                    </T>
                    <Group title="Registros" />
                    <Cap label="Ver todos los registros" on={false} a2="erc-on1" />
                    <Cap label="Ver sus registros" on />
                    <Cap label="Crear registros" on />
                    <Group title="Tableros" />
                    <Cap label="Ver tableros" on />
                    <Cap label="Crear y editar tableros" on={false} a2="erc-on2" />
                </At>
                <At x={150} y={204}>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: 20,
                            padding: '0 10px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 9.5,
                            fontWeight: 600,
                        }}
                    >
                        Crear rol
                    </span>
                </At>
            </Win>
            <Cursor a="erc-cursor" click="erc-ring" rest={[426, 280]} />
        </Stage>
    );
}
