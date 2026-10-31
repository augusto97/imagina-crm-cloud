import { CheckCircle2, Copy, ExternalLink, Link2, Trash2 } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * v0.1.340 — Duplicar en un clic: clic derecho sobre la fila → «Duplicar» →
 * la copia aparece en la tabla y un aviso con «Deshacer» se cierra solo.
 */

const ROW_H = 26;
const COLS = [
    { h: 'Nombre', w: 170 },
    { h: 'Estado', w: 100 },
    { h: 'Monto', w: 140 },
];
const ROWS: Array<[string, string, 'mint' | 'blue', string]> = [
    ['Café Aurora', 'Activo', 'mint', '$ 1.250.000'],
    ['Óptica Sol', 'Activo', 'mint', '$ 890.000'],
    ['Panadería Luna', 'Nuevo', 'blue', '$ 430.000'],
];
const WX = 24;
const WY = 16;
/** Origen del contenido de la ventana (debajo de su barra de título). */
const IX = WX;
const IY = WY + 26;
const rowY = (i: number): number => 28 + i * ROW_H;

const MX = 176;
const MY = IY + rowY(1) + 16;

const CSS = `
@keyframes dr-menu{0%,15%{opacity:0;transform:scale(.94)}18%,36%{opacity:1;transform:scale(1)}39%,100%{opacity:0;transform:scale(.97)}}
@keyframes dr-hover{0%,28%{background:transparent}31%,37%{background:${primary(0.12)}}39%,100%{background:transparent}}
@keyframes dr-row{0%,40%{opacity:0;transform:translateY(-6px)}44%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes dr-flash{0%,42%{background:${primary(0.16)}}70%,100%{background:transparent}}
@keyframes dr-toast{0%,42%{opacity:0;transform:translateY(10px)}46%,84%{opacity:1;transform:translateY(0)}89%,100%{opacity:0;transform:translateY(6px)}}
@keyframes dr-timer{0%,46%{transform:scaleX(1)}84%,100%{transform:scaleX(0)}}
@keyframes dr-cur{0%{transform:translate(420px,280px);opacity:0}5%{opacity:1}12%,17%{transform:translate(${IX + 120}px,${IY + rowY(1) + 12}px)}30%,36%{transform:translate(${MX + 60}px,${MY + 52}px)}60%,90%{transform:translate(${MX + 60}px,${MY + 52}px);opacity:1}96%,100%{opacity:0}}
@keyframes dr-ring{0%,14%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}19%,33%{opacity:0;transform:scale(1.6)}34%{opacity:1;transform:scale(1)}38%,100%{opacity:0;transform:scale(1.6)}}
`;

function Row({ y, r, a, flash }: { y: number; r: (typeof ROWS)[number]; a?: string; flash?: boolean }): JSX.Element {
    return (
        <At x={0} y={y} w={432} h={ROW_H} a={a} style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${C.border}`, ...(a && flash ? { animationName: `${a}, dr-flash` } : null) }}>
            <span style={{ width: COLS[0]!.w, padding: '0 10px', display: 'flex' }}>
                <T size={9.5} weight={600}>
                    {r[0]}
                </T>
            </span>
            <span style={{ width: COLS[1]!.w, padding: '0 8px', display: 'flex' }}>
                <Chip label={r[1]} t={r[2]} style={{ height: 15, fontSize: 7.5, padding: '0 6px' }} />
            </span>
            <span style={{ width: COLS[2]!.w, padding: '0 10px', display: 'flex', justifyContent: 'flex-end' }}>
                <T size={9.5}>{r[3]}</T>
            </span>
        </At>
    );
}

function Item({ icon, label, a, danger }: { icon: JSX.Element; label: string; a?: string; danger?: boolean }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 8px', borderRadius: 4, ...(a ? { animationName: a } : null) }}>
            <span style={{ display: 'flex', color: danger ? tone('rose') : C.mutedFg }}>{icon}</span>
            <T size={8.5} weight={a ? 700 : 500} color={danger ? tone('rose') : undefined}>
                {label}
            </T>
        </span>
    );
}

export default function DuplicarRapido(): JSX.Element {
    return (
        <Stage
            label="En la tabla, clic derecho sobre «Óptica Sol» y «Duplicar»: la copia aparece abajo y un aviso «Registro duplicado» con el botón Deshacer se cierra solo, sin diálogos ni pasos."
            tint="blue"
            cycle={8}
        >
            <Keyframes css={CSS} />
            <Win x={WX} y={WY} w={432} h={178} title="Clientes · Tabla">
                <At x={0} y={6} w={432} h={22} style={{ display: 'flex', alignItems: 'center', background: C.muted }}>
                    {COLS.map((c, i) => (
                        <span key={c.h} style={{ width: c.w, padding: '0 10px', display: 'flex', justifyContent: i === 2 ? 'flex-end' : 'flex-start' }}>
                            <T size={8} weight={700} color={C.mutedFg}>
                                {c.h}
                            </T>
                        </span>
                    ))}
                </At>
                {ROWS.map((r, i) => (
                    <Row key={r[0]} y={rowY(i)} r={r} />
                ))}
                <Row y={rowY(3)} r={ROWS[1]!} a="dr-row" flash />
            </Win>

            {/* El menú de la fila */}
            <At
                x={MX}
                y={MY}
                w={150}
                a="dr-menu"
                style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: 4, borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 16px 32px -14px rgba(15,23,42,.55)', transformOrigin: 'top left' }}
            >
                <Item icon={<ExternalLink size={9} />} label="Abrir" />
                <Item icon={<Link2 size={9} />} label="Copiar enlace" />
                <Item icon={<Copy size={9} />} label="Duplicar" a="dr-hover" />
                <Item icon={<Trash2 size={9} />} label="Eliminar" danger />
            </At>

            {/* El aviso, que se cierra solo */}
            <At
                x={244}
                y={226}
                w={220}
                h={50}
                a="dr-toast"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderRadius: 10, background: C.card, border: `1px solid ${tone('mint', 0.45)}`, boxShadow: '0 16px 32px -16px rgba(15,23,42,.55)', overflow: 'hidden' }}
            >
                <CheckCircle2 size={13} color={tone('mint')} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                    <T size={9} weight={700}>
                        Registro duplicado
                    </T>
                    <T size={7} color={C.mutedFg}>
                        Se cierra solo
                    </T>
                </span>
                <Btn kind="outline" label="Deshacer" style={{ height: 18, fontSize: 7.5 }} />
                <span data-a="" style={{ position: 'absolute', left: 0, bottom: 0, height: 2, width: '100%', background: tone('mint', 0.7), transformOrigin: 'left', animationName: 'dr-timer' }} />
            </At>

            <Cursor a="dr-cur" click="dr-ring" rest={[MX + 60, MY + 52]} />
        </Stage>
    );
}
