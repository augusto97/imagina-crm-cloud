import { ChevronDown, Group } from 'lucide-react';

import { At, C, Chip, Keyframes, Pill, Stage, T, Win } from '../kit';

/** Agrupar por Estado: las filas mezcladas se ordenan en grupos y cada grupo suma su monto al pie. */

type R = { n: string; c: string; m: string; s: 'Pendiente' | 'Pagada'; flat: number; grp: number };
const ROWS: R[] = [
    { n: 'FAC-0141', c: 'Hotel Brisas', m: '$ 3.600.000', s: 'Pendiente', flat: 0, grp: 0 },
    { n: 'FAC-0140', c: 'Óptica Visión', m: '$ 2.600.000', s: 'Pagada', flat: 1, grp: 4 },
    { n: 'FAC-0139', c: 'Colegio Andino', m: '$ 4.100.000', s: 'Pendiente', flat: 2, grp: 1 },
    { n: 'FAC-0138', c: 'Clínica Norte', m: '$ 7.900.000', s: 'Pagada', flat: 3, grp: 5 },
    { n: 'FAC-0137', c: 'Ferretería Sol', m: '$ 780.000', s: 'Pendiente', flat: 4, grp: 2 },
];

const ROW_H = 22;
const flatY = (i: number): number => 28 + i * ROW_H;
// Grupo A: cabecera en 30, filas desde 52; pie en 124. Grupo B: cabecera en 150, filas desde 172; pie en 220.
const groupY = (g: number): number => (g < 3 ? 48 + g * ROW_H : 162 + (g - 4) * ROW_H);

const CSS =
    ROWS.map(
        (r, i) =>
            `@keyframes va-r${i}{0%,22%{transform:translateY(${flatY(r.flat) - groupY(r.grp)}px)}40%,93%{transform:translateY(0)}99%,100%{transform:translateY(${flatY(r.flat) - groupY(r.grp)}px)}}`,
    ).join('\n') +
    `
@keyframes va-head{0%,36%{opacity:0;transform:translateY(-4px)}44%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes va-foot{0%,46%{opacity:0;transform:translateY(4px)}54%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes va-pill{0%,10%{opacity:0;transform:scale(.9)}16%,93%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes va-sum{0%,54%{opacity:.0}60%,93%{opacity:1}98%,100%{opacity:0}}
`;

const GRID = '78px 1fr 92px 74px';

function GroupHead({ y, label, t, n }: { y: number; label: string; t: 'amber' | 'mint'; n: number }): JSX.Element {
    return (
        <At x={10} y={y} w={412} h={22} a="va-head" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px', borderRadius: 6, background: C.muted }}>
            <ChevronDown size={11} color={C.mutedFg} />
            <Chip label={label} t={t} />
            <T size={9} weight={700} color={C.mutedFg}>
                {n}
            </T>
        </At>
    );
}

function Foot({ y, sum }: { y: number; sum: string }): JSX.Element {
    return (
        <At x={10} y={y} w={412} h={24} a="va-foot" style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 8px', alignItems: 'center', borderTop: `1px dashed ${C.border}` }}>
            <span />
            <span />
            <span style={{ display: 'flex', flexDirection: 'column' }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                    Suma
                </T>
                <T size={9.5} weight={700}>
                    {sum}
                </T>
            </span>
            <span />
        </At>
    );
}

export default function VistasAgrupar(): JSX.Element {
    return (
        <Stage label="Una tabla de facturas agrupada por estado: las filas se reúnen bajo Pendiente y Pagada, y al pie de cada grupo aparece la suma de sus montos." tint="amber">
            <Keyframes css={CSS} />
            <Win x={24} y={14} w={432} h={274} title="Facturas · Por estado">
                <At x={10} y={6} w={412} h={20} style={{ display: 'grid', gridTemplateColumns: GRID, padding: '0 8px', alignItems: 'center' }}>
                    {['Número', 'Cliente', 'Monto', 'Estado'].map((h) => (
                        <T key={h} size={8.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    ))}
                </At>
                <At x={300} y={-22} a="va-pill">
                    <Pill t="violet" icon={<Group size={10} />} label="Agrupar por: Estado" />
                </At>
                <GroupHead y={25} label="Pendiente" t="amber" n={3} />
                <GroupHead y={139} label="Pagada" t="mint" n={2} />
                {ROWS.map((r, i) => (
                    <At
                        key={r.n}
                        x={10}
                        y={groupY(r.grp)}
                        w={412}
                        h={ROW_H}
                        a={`va-r${i}`}
                        style={{ display: 'grid', gridTemplateColumns: GRID, alignItems: 'center', padding: '0 8px', borderBottom: `1px solid ${C.border}`, background: C.card }}
                    >
                        <T size={9.5} weight={600}>
                            {r.n}
                        </T>
                        <T size={9.5}>{r.c}</T>
                        <T size={9.5}>{r.m}</T>
                        <span>
                            <Chip label={r.s} t={r.s === 'Pagada' ? 'mint' : 'amber'} />
                        </span>
                    </At>
                ))}
                <Foot y={115} sum="$ 8.480.000" />
                <Foot y={207} sum="$ 10.500.000" />
            </Win>
        </Stage>
    );
}
