import type { CSSProperties } from 'react';
import { Eye, Lock } from 'lucide-react';

import { At, Avatar, C, Chip, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * La misma lista vista por dos personas: la admin ve las seis oportunidades;
 * el agente, con el nivel «Solo lo suyo», ve sólo las dos que creó.
 */

const CSS = `
@keyframes eos-hide{0%,16%{opacity:1;transform:translateX(0)}28%,90%{opacity:0;transform:translateX(10px)}97%,100%{opacity:1;transform:translateX(0)}}
@keyframes eos-up{0%,30%{transform:translateY(56px)}40%,90%{transform:translateY(0)}98%,100%{transform:translateY(56px)}}
@keyframes eos-own{0%,38%{box-shadow:inset 0 0 0 0 transparent;background:transparent}46%,88%{box-shadow:inset 3px 0 0 0 ${primary()};background:${primary(0.07)}}96%,100%{box-shadow:inset 0 0 0 0 transparent;background:transparent}}
@keyframes eos-count{0%,40%{opacity:0;transform:translateY(5px)}48%,90%{opacity:1;transform:translateY(0)}96%,100%{opacity:0}}
@keyframes eos-lvl{0%,10%{transform:scale(1);box-shadow:0 0 0 0 transparent}15%,22%{transform:scale(1.08);box-shadow:0 0 0 4px ${tone('amber', 0.25)}}30%,100%{transform:scale(1);box-shadow:0 0 0 0 transparent}}
`;

type Row = {
    title: string;
    who: string;
    t: 'violet' | 'amber' | 'cyan';
    stage: string;
    st: 'slate' | 'blue' | 'mint';
    own: boolean;
};

const ROWS: Row[] = [
    {
        title: 'Hotel Brisas',
        who: 'LM',
        t: 'cyan',
        stage: 'Propuesta',
        st: 'blue',
        own: true,
    },
    {
        title: 'Café Bahía',
        who: 'AG',
        t: 'violet',
        stage: 'Nuevo',
        st: 'slate',
        own: false,
    },
    {
        title: 'Clínica Norte',
        who: 'JP',
        t: 'amber',
        stage: 'Ganado',
        st: 'mint',
        own: false,
    },
    {
        title: 'Óptica Visión',
        who: 'LM',
        t: 'cyan',
        stage: 'Nuevo',
        st: 'slate',
        own: true,
    },
    {
        title: 'Colegio Andino',
        who: 'AG',
        t: 'violet',
        stage: 'Propuesta',
        st: 'blue',
        own: false,
    },
    {
        title: 'Ferretería Sol',
        who: 'JP',
        t: 'amber',
        stage: 'Ganado',
        st: 'mint',
        own: false,
    },
];

const ROW_H = 28;

function RowView({ r, style, a }: { r: Row; style?: CSSProperties; a?: string }): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{
                height: ROW_H,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 9px',
                borderBottom: `1px solid ${C.border}`,
                animationName: a,
                ...style,
            }}
        >
            <Avatar initials={r.who} t={r.t} size={16} />
            <T size={9.5} weight={600} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.title}
            </T>
            <Chip label={r.stage} t={r.st} />
        </div>
    );
}

function Header({
    x,
    initials,
    name,
    role,
    t,
    pill,
}: {
    x: number;
    initials: string;
    name: string;
    role: string;
    t: 'violet' | 'cyan';
    pill: JSX.Element;
}): JSX.Element {
    return (
        <At x={x} y={14} w={214} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Avatar initials={initials} t={t} size={24} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                <T size={10.5} weight={700}>
                    {name}
                </T>
                <T size={8.5} color={C.mutedFg}>
                    {role}
                </T>
            </span>
            {pill}
        </At>
    );
}

export default function EquipoOwnScope(): JSX.Element {
    return (
        <Stage
            label="La misma lista de oportunidades vista por dos personas: la administradora ve las seis; el agente, con el nivel «Solo lo suyo», ve sólo las dos que creó él."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <Header x={18} initials="AG" name="Ana Gómez" role="Admin" t="violet" pill={<Pill t="mint" label="Ve todo" icon={<Eye size={10} />} />} />
            <Header
                x={248}
                initials="LM"
                name="Luis Mejía"
                role="Agente"
                t="cyan"
                pill={
                    <span
                        data-a=""
                        style={{
                            animationName: 'eos-lvl',
                            borderRadius: 99,
                            display: 'inline-flex',
                        }}
                    >
                        <Pill t="amber" label="Solo lo suyo" icon={<Lock size={9} />} />
                    </span>
                }
            />

            <Win x={18} y={52} w={214} h={226} title="Oportunidades">
                {ROWS.map((r) => (
                    <RowView key={r.title} r={r} />
                ))}
                <At x={10} y={176}>
                    <T size={8.5} weight={600} color={C.mutedFg}>
                        6 registros
                    </T>
                </At>
            </Win>

            <Win x={248} y={52} w={214} h={226} title="Oportunidades">
                {ROWS.map((r, i) => {
                    if (r.own) return null;
                    return (
                        <At key={r.title} x={0} y={i * ROW_H} w={212} a="eos-hide" style={{ opacity: 0 }}>
                            <RowView r={r} />
                        </At>
                    );
                })}
                <At x={0} y={0} w={212}>
                    <RowView r={ROWS[0]!} a="eos-own" />
                </At>
                <At x={0} y={ROW_H} w={212} a="eos-up">
                    <RowView r={ROWS[3]!} a="eos-own" />
                </At>
                <At
                    x={0}
                    y={84}
                    w={212}
                    a="eos-count"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 5,
                    }}
                >
                    <span
                        style={{
                            width: 26,
                            height: 26,
                            borderRadius: 99,
                            background: tone('amber', 0.14),
                            color: tone('amber'),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Lock size={13} />
                    </span>
                    <T size={9} weight={600} color={C.mutedFg}>
                        Los demás registros no le aparecen
                    </T>
                </At>
                <At x={10} y={176} a="eos-count">
                    <T size={8.5} weight={600} color={C.mutedFg}>
                        2 de 6 registros · los que creó él
                    </T>
                </At>
            </Win>
        </Stage>
    );
}
