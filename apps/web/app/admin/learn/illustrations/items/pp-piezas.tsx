import { Building2, Columns3, Rows3, Table } from 'lucide-react';

import { At, C, Chip, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Las tres piezas: la LISTA (la tabla entera), el CAMPO (una columna) y el
 * REGISTRO (una fila). Se iluminan en orden y la leyenda de la derecha dice
 * qué es cada una.
 */

const CSS = `
@keyframes pz-list{0%,4%{box-shadow:0 0 0 0 transparent}8%,28%{box-shadow:0 0 0 3px ${primary(0.5)}}33%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pz-col{0%,33%{opacity:0}37%,58%{opacity:1}63%,100%{opacity:0}}
@keyframes pz-row{0%,63%{opacity:0}67%,90%{opacity:1}95%,100%{opacity:0}}
@keyframes pz-l1{0%,4%{opacity:.45;transform:translateX(0)}8%,28%{opacity:1;transform:translateX(-4px)}33%,100%{opacity:.45;transform:translateX(0)}}
@keyframes pz-l2{0%,33%{opacity:.45;transform:translateX(0)}37%,58%{opacity:1;transform:translateX(-4px)}63%,100%{opacity:.45;transform:translateX(0)}}
@keyframes pz-l3{0%,63%{opacity:.45;transform:translateX(0)}67%,90%{opacity:1;transform:translateX(-4px)}95%,100%{opacity:.45;transform:translateX(0)}}
`;

const COLS = [
    { label: 'Cliente', w: 100 },
    { label: 'Ciudad', w: 66 },
    { label: 'Estado', w: 66 },
    { label: 'Valor', w: 58 },
];
const ROWS: Array<[string, string, string, 'mint' | 'blue' | 'amber' | 'violet', string]> = [
    ['Café Bahía', 'Cali', 'Activo', 'mint', '$ 1,2 M'],
    ['Clínica Norte', 'Bogotá', 'Nuevo', 'blue', '$ 3,4 M'],
    ['Hotel Brisas', 'Cartagena', 'VIP', 'violet', '$ 7,9 M'],
    ['Óptica Visión', 'Medellín', 'Activo', 'mint', '$ 2,1 M'],
    ['Ferretería Sol', 'Pereira', 'En pausa', 'amber', '$ 0,9 M'],
];
const X0 = 8;
const colX = (i: number): number => X0 + COLS.slice(0, i).reduce((a, c) => a + c.w, 0);

function Legend({ y, n, title, text, icon, t, a }: { y: number; n: number; title: string; text: string; icon: JSX.Element; t: 'blue' | 'violet' | 'mint'; a: string }): JSX.Element {
    return (
        <At
            x={338}
            y={y}
            w={128}
            h={62}
            a={a}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 4, boxShadow: '0 8px 20px -14px rgba(15,23,42,.5)' }}
        >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconSquare t={t} size={18}>
                    {icon}
                </IconSquare>
                <T size={10} weight={700}>
                    {n} · {title}
                </T>
            </span>
            <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                {text}
            </T>
        </At>
    );
}

export default function PpPiezas(): JSX.Element {
    return (
        <Stage label="La lista de clientes se ilumina entera, después una de sus columnas (un campo) y después una de sus filas (un registro); a la derecha, una leyenda explica cada pieza." tint="blue">
            <Keyframes css={CSS} />
            <Win
                x={16}
                y={38}
                w={308}
                h={226}
                a="pz-list"
                title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <Building2 size={11} color={tone('blue')} /> Clientes
                    </span>
                }
            >
                {/* encabezado */}
                <div style={{ display: 'flex', alignItems: 'center', height: 26, paddingLeft: X0, borderBottom: `1px solid ${C.border}` }}>
                    {COLS.map((c) => (
                        <span key={c.label} style={{ width: c.w, paddingLeft: 6, display: 'flex' }}>
                            <T size={8.5} weight={600} color={C.mutedFg}>
                                {c.label}
                            </T>
                        </span>
                    ))}
                </div>
                {ROWS.map((r, i) => (
                    <div key={r[0]} style={{ display: 'flex', alignItems: 'center', height: 34, paddingLeft: X0, borderBottom: i < ROWS.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <span style={{ width: COLS[0]!.w, paddingLeft: 6, display: 'flex' }}>
                            <T size={9.5} weight={600}>
                                {r[0]}
                            </T>
                        </span>
                        <span style={{ width: COLS[1]!.w, paddingLeft: 6, display: 'flex' }}>
                            <T size={9} color={C.mutedFg}>
                                {r[1]}
                            </T>
                        </span>
                        <span style={{ width: COLS[2]!.w, paddingLeft: 6, display: 'flex' }}>
                            <Chip label={r[2]} t={r[3]} />
                        </span>
                        <span style={{ width: COLS[3]!.w, paddingLeft: 6, display: 'flex' }}>
                            <T size={9} weight={600}>
                                {r[4]}
                            </T>
                        </span>
                    </div>
                ))}
                {/* campo resaltado (columna Estado) */}
                <At x={colX(2)} y={1} w={COLS[2]!.w} h={26 + ROWS.length * 34 - 4} a="pz-col" style={{ background: primary(0.1), border: `2px solid ${primary()}`, borderRadius: 6, opacity: 0 }} />
                {/* registro resaltado (fila 2) */}
                <At x={4} y={26 + 34 + 2} w={292} h={30} a="pz-row" style={{ background: primary(0.1), border: `2px solid ${primary()}`, borderRadius: 6, opacity: 0 }} />
            </Win>
            <Legend y={34} n={1} title="Lista" text="Guarda un tipo de cosa: clientes, pedidos, tareas." icon={<Table size={11} />} t="blue" a="pz-l1" />
            <Legend y={110} n={2} title="Campo" text="Una columna: un dato que tiene cada registro." icon={<Columns3 size={11} />} t="violet" a="pz-l2" />
            <Legend y={186} n={3} title="Registro" text="Una fila: un cliente, con todos sus datos." icon={<Rows3 size={11} />} t="mint" a="pz-l3" />
        </Stage>
    );
}
