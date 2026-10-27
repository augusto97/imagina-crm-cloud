import type { CSSProperties } from 'react';
import { At, Avatar, Btn, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Kanban de ventas con carriles por vendedor, total por columna y un límite:
 * al pasar una tarjeta a «Perdido» se pide el motivo, y la columna que se pasaba del límite vuelve a estar bien.
 */

const COL_X = [58, 186, 314];
const LANE_Y = [42, 136];
const slotY = (lane: number, k: number): number => LANE_Y[lane]! + 20 + k * 34;

const CSS = `
@keyframes vk-card{0%,12%{transform:translate(-128px,34px) rotate(0);opacity:1;box-shadow:none}18%{transform:translate(-124px,30px) rotate(2deg);box-shadow:0 12px 22px -10px rgba(15,23,42,.5)}32%{transform:translate(0,0) rotate(2deg);box-shadow:0 12px 22px -10px rgba(15,23,42,.5)}36%,60%{transform:translate(0,0) rotate(0);opacity:.55;box-shadow:none}64%,93%{transform:translate(0,0);opacity:1}97%{opacity:0;transform:translate(0,0)}98%{opacity:0;transform:translate(-128px,34px)}100%{opacity:1;transform:translate(-128px,34px)}}
@keyframes vk-cur{0%{transform:translate(300px,290px);opacity:0}6%{opacity:1}12%,16%{transform:translate(258px,254px)}32%,36%{transform:translate(386px,220px)}50%{transform:translate(286px,176px)}58%,62%{transform:translate(314px,205px)}80%,92%{transform:translate(314px,205px);opacity:1}97%,100%{transform:translate(314px,205px);opacity:0}}
@keyframes vk-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}17%,58%{opacity:0;transform:scale(1.6)}59%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.6)}}
@keyframes vk-dlg{0%,34%{opacity:0;transform:translateY(8px) scale(.97)}38%,60%{opacity:1;transform:translateY(0) scale(1)}63%,100%{opacity:0;transform:translateY(0) scale(.98)}}
@keyframes vk-veil{0%,34%{opacity:0}38%,60%{opacity:1}63%,100%{opacity:0}}
@keyframes vk-type{0%,42%{width:0}52%,100%{width:62px}}
@keyframes vk-over{0%,62%{opacity:1}65%,96%{opacity:0}99%,100%{opacity:1}}
@keyframes vk-ok{0%,62%{opacity:0}65%,96%{opacity:1}99%,100%{opacity:0}}
@keyframes vk-colred{0%,62%{box-shadow:inset 0 0 0 1.5px ${tone('rose', 0.7)}}65%,96%{box-shadow:inset 0 0 0 0 transparent}99%,100%{box-shadow:inset 0 0 0 1.5px ${tone('rose', 0.7)}}}
`;

function Card({ x, y, title, amount, t, a, style }: { x: number; y: number; title: string; amount: string; t: 'violet' | 'amber' | 'cyan' | 'blue'; a?: string; style?: CSSProperties }): JSX.Element {
    return (
        <At
            x={x + 6}
            y={y}
            w={116}
            h={30}
            a={a}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${tone(t)}`, borderRadius: 7, padding: '0 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: a ? 6 : 1, ...style }}
        >
            <T size={9} weight={600}>
                {title}
            </T>
            <T size={8.5} weight={700} color={C.mutedFg}>
                {amount}
            </T>
        </At>
    );
}

function Head({ i, label, t, before, after, limit }: { i: number; label: string; t: 'blue' | 'amber' | 'rose'; before: string; after: string; limit?: boolean }): JSX.Element {
    return (
        <At x={COL_X[i]! + 6} y={6} w={116} h={32} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
            <Chip label={label} t={t} />
            <span style={{ position: 'relative', width: 110, height: 12 }}>
                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, opacity: 0, animationName: 'vk-over' }}>
                    <T size={8.5} weight={700} color={limit ? tone('rose') : C.mutedFg}>
                        {before}
                    </T>
                </span>
                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'vk-ok' }}>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        {after}
                    </T>
                </span>
            </span>
        </At>
    );
}

export default function VistasKanban(): JSX.Element {
    return (
        <Stage label="Un tablero de ventas con carriles por vendedor y el total de cada columna. La columna Negociación supera su límite de 3 tarjetas; al arrastrar una oportunidad a Perdido, la app pide el motivo de pérdida y después la columna vuelve a estar dentro del límite." tint="rose">
            <Keyframes css={CSS} />
            <Win x={12} y={20} w={456} h={264} title="Oportunidades · Embudo">
                {/* Fondo de columnas */}
                {COL_X.map((x, i) => (
                    <At
                        key={x}
                        x={x}
                        y={2}
                        w={128}
                        h={232}
                        a={i === 1 ? 'vk-colred' : undefined}
                        style={{ borderRadius: 8, background: tone((['blue', 'amber', 'rose'] as const)[i]!, 0.06), boxShadow: 'inset 0 0 0 0 transparent' }}
                    />
                ))}
                <Head i={0} label="Propuesta" t="blue" before="2 · $ 6,2 M" after="2 · $ 6,2 M" />
                <Head i={1} label="Negociación" t="amber" before="4/3 · $ 15,9 M" after="3/3 · $ 13,2 M" limit />
                <Head i={2} label="Perdido" t="rose" before="0" after="1 · $ 2,7 M" />

                {/* Carriles */}
                {LANE_Y.map((y, l) => (
                    <At key={y} x={4} y={y} w={444} h={l === 0 ? 94 : 98} style={{ borderTop: `1px solid ${C.border}` }}>
                        <span style={{ position: 'absolute', left: 4, top: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, width: 44 }}>
                            <Avatar initials={l === 0 ? 'AM' : 'JP'} t={l === 0 ? 'violet' : 'amber'} size={20} />
                            <T size={8} weight={600} color={C.mutedFg}>
                                {l === 0 ? 'Ana' : 'Juan'}
                            </T>
                        </span>
                    </At>
                ))}

                <Card x={COL_X[0]!} y={slotY(0, 0)} title="Hotel Brisas" amount="$ 3,6 M" t="cyan" />
                <Card x={COL_X[1]!} y={slotY(0, 0)} title="Clínica Norte" amount="$ 7,9 M" t="violet" />
                <Card x={COL_X[1]!} y={slotY(0, 1)} title="Colegio Andino" amount="$ 4,1 M" t="amber" />
                <Card x={COL_X[0]!} y={slotY(1, 0)} title="Óptica Visión" amount="$ 2,6 M" t="blue" />
                <Card x={COL_X[1]!} y={slotY(1, 0)} title="Ferretería Sol" amount="$ 1,2 M" t="cyan" />
                {/* La que se mueve: termina en Perdido */}
                <Card x={COL_X[2]!} y={slotY(1, 0)} title="Café La 14" amount="$ 2,7 M" t="violet" a="vk-card" />

                {/* Formulario al mover */}
                <At x={-1} y={-27} w={458} h={266} a="vk-veil" style={{ background: 'rgba(15,23,42,.28)', opacity: 0, zIndex: 8 }} />
                <At
                    x={120}
                    y={70}
                    w={210}
                    a="vk-dlg"
                    style={{ opacity: 0, zIndex: 9, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 7, boxShadow: '0 18px 40px -16px rgba(15,23,42,.6)' }}
                >
                    <T size={10.5} weight={700}>
                        Para pasar a «Perdido» completa:
                    </T>
                    <T size={9} weight={600} color={C.mutedFg}>
                        Motivo de pérdida
                    </T>
                    <span style={{ height: 22, border: `1px solid ${primary()}`, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
                        <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', width: 62, animationName: 'vk-type', fontSize: 9.5 }}>
                            Precio alto
                        </span>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <Btn label="Cancelar" kind="outline" />
                        <Btn label="Mover" />
                    </span>
                </At>
            </Win>
            <Cursor a="vk-cur" click="vk-ring" rest={[314, 205]} />
        </Stage>
    );
}
