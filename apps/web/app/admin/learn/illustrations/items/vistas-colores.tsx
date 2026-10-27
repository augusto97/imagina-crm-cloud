import { Paintbrush } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, tone } from '../kit';

/** Reglas de color: lo vencido se pinta en rojo (la fila entera) y lo pagado, sólo la celda del estado en verde. */

const CSS = `
@keyframes vc-r1{0%,8%{opacity:0;transform:translateX(10px)}14%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes vc-r2{0%,48%{opacity:0;transform:translateX(10px)}54%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes vc-row{0%,22%{background:transparent}30%,94%{background:${tone('rose', 0.14)}}100%{background:transparent}}
@keyframes vc-bar{0%,22%{opacity:0}30%,94%{opacity:1}100%{opacity:0}}
@keyframes vc-cell{0%,60%{background:transparent}68%,94%{background:${tone('mint', 0.22)}}100%{background:transparent}}
`;

const ROWS: Array<{ n: string; c: string; v: string; s: string; st: 'amber' | 'mint' | 'rose'; late?: boolean; paid?: boolean }> = [
    { n: 'FAC-0141', c: 'Hotel Brisas', v: '02/10/2026', s: 'Pendiente', st: 'amber', late: true },
    { n: 'FAC-0140', c: 'Óptica Visión', v: '05/10/2026', s: 'Pagada', st: 'mint', paid: true },
    { n: 'FAC-0139', c: 'Colegio Andino', v: '09/10/2026', s: 'Pendiente', st: 'amber', late: true },
    { n: 'FAC-0138', c: 'Clínica Norte', v: '30/11/2026', s: 'Pendiente', st: 'amber' },
    { n: 'FAC-0137', c: 'Ferretería Sol', v: '14/10/2026', s: 'Pendiente', st: 'amber', late: true },
    { n: 'FAC-0136', c: 'Café La 14', v: '18/10/2026', s: 'Pagada', st: 'mint', paid: true },
];

function Rule({ a, color, cond, what, n }: { a: string; color: 'rose' | 'mint'; cond: string; what: string; n: number }): JSX.Element {
    return (
        <At
            x={10}
            y={n === 1 ? 46 : 124}
            w={128}
            a={a}
            style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 5, background: C.card }}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 12, height: 12, borderRadius: 4, background: tone(color) }} />
                <T size={8.5} weight={700} color={C.mutedFg}>
                    Regla {n}
                </T>
            </span>
            <T size={9} weight={600} style={{ whiteSpace: 'normal' }}>
                {cond}
            </T>
            <span style={{ fontSize: 8.5, color: C.mutedFg, background: C.muted, borderRadius: 5, padding: '2px 6px', alignSelf: 'flex-start' }}>{what}</span>
        </At>
    );
}

export default function VistasColores(): JSX.Element {
    return (
        <Stage label="Reglas de color en una tabla de facturas: la regla «Vencimiento antes de hoy» pinta de rojo las filas atrasadas y la regla «Estado es Pagada» pinta de verde sólo la celda del estado." tint="rose">
            <Keyframes css={CSS} />
            <Win x={14} y={30} w={300} h={238} title="Facturas · Cartera">
                <At x={0} y={4} w={300}>
                    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 72px 66px', padding: '0 10px', height: 22, alignItems: 'center' }}>
                        {['Número', 'Cliente', 'Vence', 'Estado'].map((h) => (
                            <T key={h} size={8.5} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </div>
                    {ROWS.map((r) => (
                        <div
                            key={r.n}
                            data-a={r.late ? '' : undefined}
                            style={{
                                position: 'relative',
                                display: 'grid',
                                gridTemplateColumns: '64px 1fr 72px 66px',
                                padding: '0 10px',
                                height: 31,
                                alignItems: 'center',
                                borderTop: `1px solid ${C.border}`,
                                background: r.late ? tone('rose', 0.14) : undefined,
                                animationName: r.late ? 'vc-row' : undefined,
                            }}
                        >
                            {r.late && <span data-a="" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: tone('rose'), animationName: 'vc-bar' }} />}
                            <T size={9.5} weight={600}>
                                {r.n}
                            </T>
                            <T size={9.5}>{r.c}</T>
                            <T size={9} color={r.late ? tone('rose') : C.mutedFg} weight={r.late ? 600 : 500}>
                                {r.v}
                            </T>
                            <span
                                data-a={r.paid ? '' : undefined}
                                style={{ margin: '0 -6px', padding: '0 6px', height: 30, display: 'flex', alignItems: 'center', background: r.paid ? tone('mint', 0.22) : undefined, animationName: r.paid ? 'vc-cell' : undefined }}
                            >
                                <Chip label={r.s} t={r.st} />
                            </span>
                        </div>
                    ))}
                </At>
            </Win>
            <Win x={322} y={30} w={148} h={238} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Paintbrush size={10} />Colorear filas</span>}>
                <At x={10} y={6} w={128}>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Si chocan, gana la de arriba.
                    </T>
                </At>
                <Rule n={1} a="vc-r1" color="rose" cond="Vence antes de hoy" what="La fila entera" />
                <Rule n={2} a="vc-r2" color="mint" cond="Estado es Pagada" what="Una celda: Estado" />
            </Win>
        </Stage>
    );
}
