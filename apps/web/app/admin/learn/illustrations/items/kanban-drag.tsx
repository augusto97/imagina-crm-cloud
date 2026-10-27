import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/** Tablero por etapas: se arrastra una oportunidad a la etapa siguiente y los totales se actualizan. */

const CSS = `
@keyframes kd-card{0%,16%{transform:translate(0,0) rotate(0);box-shadow:0 1px 2px rgba(15,23,42,.08)}22%{transform:translate(0,-4px) rotate(2deg) scale(1.04);box-shadow:0 14px 28px -10px rgba(15,23,42,.45)}45%{transform:translate(140px,-58px) rotate(2deg) scale(1.04);box-shadow:0 14px 28px -10px rgba(15,23,42,.45)}50%,88%{transform:translate(140px,-54px) rotate(0) scale(1);box-shadow:0 1px 2px rgba(15,23,42,.08);opacity:1}94%{transform:translate(140px,-54px);opacity:0}96%{transform:translate(0,0);opacity:0}100%{transform:translate(0,0);opacity:1}}
@keyframes kd-cursor{0%{transform:translate(330px,250px);opacity:0}6%{opacity:1}14%,20%{transform:translate(74px,222px)}45%,50%{transform:translate(214px,168px)}62%,86%{transform:translate(318px,226px);opacity:1}94%,100%{transform:translate(318px,226px);opacity:0}}
@keyframes kd-ring{0%,15%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}21%{opacity:0;transform:scale(1.6)}48%{opacity:0;transform:scale(.4)}50%{opacity:1;transform:scale(1)}54%,100%{opacity:0;transform:scale(1.6)}}
@keyframes kd-before{0%,47%{opacity:1}51%,96%{opacity:0}100%{opacity:1}}
@keyframes kd-after{0%,47%{opacity:0}51%,96%{opacity:1}100%{opacity:0}}
@keyframes kd-glow{0%,40%{box-shadow:inset 0 0 0 0 transparent}46%,52%{box-shadow:inset 0 0 0 2px var(--kd-c)}60%,100%{box-shadow:inset 0 0 0 0 transparent}}
`;

type Col = { title: string; t: 'slate' | 'blue' | 'mint'; before: [string, string]; after: [string, string] };
const COLS: Col[] = [
    { title: 'Nuevo', t: 'slate', before: ['3', '$ 9,8 M'], after: ['2', '$ 6,2 M'] },
    { title: 'Propuesta', t: 'blue', before: ['1', '$ 4,1 M'], after: ['2', '$ 7,7 M'] },
    { title: 'Ganado', t: 'mint', before: ['2', '$ 12,5 M'], after: ['2', '$ 12,5 M'] },
];

function Card({ title, who, amount, t }: { title: string; who: string; amount: string; t: 'violet' | 'amber' | 'cyan' | 'rose' }): JSX.Element {
    return (
        <div
            style={{
                height: 46,
                borderRadius: 8,
                background: C.card,
                border: `1px solid ${C.border}`,
                padding: '7px 8px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
            }}
        >
            <T size={9.5} weight={600}>
                {title}
            </T>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Avatar initials={who} t={t} size={15} />
                <T size={9} weight={700} color={C.mutedFg}>
                    {amount}
                </T>
            </span>
        </div>
    );
}

export default function KanbanDrag(): JSX.Element {
    return (
        <Stage label="Un tablero de ventas por etapas: una oportunidad se arrastra de Nuevo a Propuesta y los totales de cada columna se actualizan solos." tint="blue">
            <Keyframes css={CSS} />
            <Win x={24} y={26} w={432} h={252} title="Oportunidades · Por etapa">
                {COLS.map((col, i) => (
                    <At
                        key={col.title}
                        x={10 + i * 140}
                        y={8}
                        w={130}
                        h={210}
                        a={i === 1 ? 'kd-glow' : undefined}
                        style={{ borderRadius: 9, background: tone(col.t, 0.07), borderTop: `3px solid ${tone(col.t)}`, ['--kd-c' as string]: tone(col.t, 0.6) }}
                    >
                        <div style={{ padding: '7px 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Chip label={col.title} t={col.t} />
                            <span style={{ position: 'relative', width: 66, height: 12 }}>
                                {(['before', 'after'] as const).map((k) => (
                                    <span
                                        key={k}
                                        data-a={i < 2 ? '' : undefined}
                                        style={{
                                            position: 'absolute',
                                            right: 0,
                                            top: 0,
                                            opacity: k === 'after' ? 1 : 0,
                                            animationName: i < 2 ? (k === 'after' ? 'kd-after' : 'kd-before') : undefined,
                                        }}
                                    >
                                        <T size={8.5} weight={700} color={C.mutedFg}>
                                            {col[k][0]} · {col[k][1]}
                                        </T>
                                    </span>
                                ))}
                            </span>
                        </div>
                    </At>
                ))}
                {/* Nuevo */}
                <At x={20} y={40} w={110}>
                    <Card title="Cafetería La 14" who="AM" amount="$ 3,6 M" t="violet" />
                </At>
                <At x={20} y={94} w={110}>
                    <Card title="Óptica Visión" who="JP" amount="$ 2,6 M" t="amber" />
                </At>
                {/* La que se mueve: termina en Propuesta */}
                <At x={20} y={148} w={110} a="kd-card" style={{ transform: 'translate(140px,-54px)', zIndex: 5, borderRadius: 8 }}>
                    <Card title="Hotel Brisas" who="LG" amount="$ 3,6 M" t="cyan" />
                </At>
                {/* Propuesta */}
                <At x={160} y={40} w={110}>
                    <Card title="Colegio Andino" who="JP" amount="$ 4,1 M" t="amber" />
                </At>
                {/* Ganado */}
                <At x={300} y={40} w={110}>
                    <Card title="Clínica Norte" who="AM" amount="$ 7,9 M" t="violet" />
                </At>
                <At x={300} y={94} w={110}>
                    <Card title="Ferretería Sol" who="LG" amount="$ 4,6 M" t="rose" />
                </At>
            </Win>
            <Cursor a="kd-cursor" click="kd-ring" rest={[318, 226]} />
        </Stage>
    );
}
