import { CalendarDays, CheckSquare, ListChecks, Table } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** El checklist de un registro: marcar ítems llena la barra de progreso y la tabla muestra «☑ 3/4». */

const ITEMS = [
    { l: 'Cotizar el camión de mudanza', who: 'AM', t: 'violet' as const, d: '20/10' },
    { l: 'Empacar el archivo físico', who: 'JP', t: 'amber' as const, d: '24/10' },
    { l: 'Reservar el ascensor del edificio', who: 'LG', t: 'cyan' as const, d: '27/10' },
    { l: 'Probar internet en la oficina nueva', who: 'JP', t: 'amber' as const, d: '31/10' },
];
const IY = 66;
const IH = 30;
// Momentos (en %) en que se marca cada ítem; el primero ya viene hecho.
const AT = [-1, 26, 52];

const CSS = `
${[1, 2]
    .map(
        (i) => `@keyframes fcl-b${i}{0%,${AT[i]}%{background:transparent;border-color:${C.border}}${AT[i]! + 2}%,94%{background:${primary()};border-color:${primary()}}99%,100%{background:transparent;border-color:${C.border}}}
@keyframes fcl-k${i}{0%,${AT[i]}%{opacity:0}${AT[i]! + 2}%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fcl-s${i}{0%,${AT[i]}%{color:${C.fg};text-decoration-color:transparent}${AT[i]! + 2}%,94%{color:${C.mutedFg};text-decoration-color:${C.mutedFg}}99%,100%{color:${C.fg};text-decoration-color:transparent}}`,
    )
    .join('\n')}
@keyframes fcl-bar{0%,26%{width:25%}29%,52%{width:50%}55%,94%{width:75%}99%,100%{width:25%}}
@keyframes fcl-n1{0%,27%{opacity:1}28%,100%{opacity:0}}
@keyframes fcl-n2{0%,27%{opacity:0}28%,53%{opacity:1}54%,100%{opacity:0}}
@keyframes fcl-n3{0%,53%{opacity:0}54%,95%{opacity:1}99%,100%{opacity:0}}
@keyframes fcl-flash{0%,53%{background:transparent}57%{background:${primary(0.16)}}75%,100%{background:transparent}}
@keyframes fcl-cur{0%{transform:translate(140px,290px);opacity:0}5%{opacity:1}20%,26%{transform:translate(32px,143px)}46%,52%{transform:translate(32px,173px);opacity:1}70%,92%{transform:translate(250px,268px);opacity:1}97%,100%{opacity:0}}
@keyframes fcl-ring{0%,25%{opacity:0;transform:scale(.4)}26%{opacity:1;transform:scale(1)}29%,51%{opacity:0;transform:scale(1.6)}52%{opacity:1;transform:scale(1)}55%,100%{opacity:0;transform:scale(1.6)}}
`;

function Count({ n, a }: { n: number; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 3, animationName: a, opacity: n === 3 ? 1 : 0 }}>
            <CheckSquare size={9} color={C.mutedFg} />
            <T size={8.5} weight={600} color={C.mutedFg}>
                {n}/4
            </T>
        </span>
    );
}

export default function FichaChecklist(): JSX.Element {
    return (
        <Stage label="En la ficha de la tarea «Mudanza de la oficina», el checklist «Antes de la mudanza» tiene cuatro ítems con responsable y fecha; al marcar dos más, la barra de progreso sube a tres de cuatro y la fila de la tabla muestra la casilla con 3/4." tint="mint">
            <Keyframes css={CSS} />
            <Win x={14} y={18} w={292} h={252} title="Tareas / Mudanza de la oficina">
                <At x={12} y={10} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ListChecks size={12} color={primary()} />
                    <T size={10.5} weight={700}>
                        Antes de la mudanza
                    </T>
                </At>
                <At x={12} y={34} w={268} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ position: 'relative', flex: 1, height: 6, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '75%', borderRadius: 99, background: tone('mint'), animationName: 'fcl-bar' }} />
                    </span>
                    <span style={{ position: 'relative', width: 30, height: 12 }}>
                        <Count n={1} a="fcl-n1" />
                        <Count n={2} a="fcl-n2" />
                        <Count n={3} a="fcl-n3" />
                    </span>
                </At>
                {ITEMS.map((it, i) => {
                    const done = i <= 2;
                    const anim = i === 1 || i === 2;
                    return (
                        <At key={it.l} x={12} y={IY + i * IH - 12} w={268} h={IH} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${C.border}` }}>
                            <span
                                data-a={anim ? '' : undefined}
                                style={{
                                    position: 'relative',
                                    width: 13,
                                    height: 13,
                                    borderRadius: 3,
                                    border: `1.5px solid ${done ? primary() : C.border}`,
                                    background: done ? primary() : 'transparent',
                                    flexShrink: 0,
                                    animationName: anim ? `fcl-b${i}` : undefined,
                                }}
                            >
                                {done && (
                                    <span data-a={anim ? '' : undefined} style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 9, lineHeight: '11px', textAlign: 'center', animationName: anim ? `fcl-k${i}` : undefined }}>
                                        ✓
                                    </span>
                                )}
                            </span>
                            <span
                                data-a={anim ? '' : undefined}
                                style={{ flex: 1, fontSize: 9.5, color: done ? C.mutedFg : C.fg, textDecoration: done ? 'line-through' : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', animationName: anim ? `fcl-s${i}` : undefined }}
                            >
                                {it.l}
                            </span>
                            <Avatar initials={it.who} t={it.t} size={16} />
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: i === 3 ? tone('amber') : C.mutedFg }}>
                                <CalendarDays size={9} />
                                <T size={8} color={i === 3 ? tone('amber') : C.mutedFg}>
                                    {it.d}
                                </T>
                            </span>
                        </At>
                    );
                })}
                <At x={12} y={IY + 4 * IH - 4} style={{ display: 'flex' }}>
                    <T size={9} color={C.mutedFg}>
                        + Agregar un ítem
                    </T>
                </At>
            </Win>

            {/* La fila en la tabla */}
            <Win x={318} y={70} w={150} h={150} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Table size={10} />Tareas</span>}>
                {[
                    ['Renovar el dominio', '2/2'],
                    ['Mudanza de la oficina', ''],
                    ['Pagar la nómina', '0/5'],
                    ['Inventario de bodega', '1/3'],
                ].map(([n, c], i) => (
                    <At key={n} x={6} y={6 + i * 28} w={138} h={26} a={i === 1 ? 'fcl-flash' : undefined} style={{ borderRadius: 6, padding: '0 6px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {n}
                        </T>
                        {i === 1 ? (
                            <span style={{ position: 'relative', height: 11 }}>
                                <Count n={1} a="fcl-n1" />
                                <Count n={2} a="fcl-n2" />
                                <Count n={3} a="fcl-n3" />
                            </span>
                        ) : (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <CheckSquare size={9} color={C.mutedFg} />
                                <T size={8.5} color={C.mutedFg}>
                                    {c}
                                </T>
                            </span>
                        )}
                    </At>
                ))}
            </Win>
            <Cursor a="fcl-cur" click="fcl-ring" rest={[250, 268]} />
        </Stage>
    );
}
