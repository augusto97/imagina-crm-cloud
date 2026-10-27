import { Copy, KanbanSquare, Link2, List, Lock, Pencil, Pin, Shield, Star, Table } from 'lucide-react';

import { At, Bar, C, Chip, Cursor, Keyframes, Stage, T, Win, primary } from '../kit';

/** Las pestañas de vistas: «+ Vista» crea una, doble clic la renombra y el clic derecho abre su menú (aquí: «Vista por defecto»). */

const CSS = `
@keyframes vp-cur{0%{transform:translate(380px,250px);opacity:0}5%{opacity:1}11%,14%{transform:translate(244px,68px)}28%,36%{transform:translate(262px,70px)}55%,60%{transform:translate(262px,70px)}70%,80%{transform:translate(392px,216px);opacity:1}88%,92%{transform:translate(392px,216px);opacity:1}97%,100%{transform:translate(392px,216px);opacity:0}}
@keyframes vp-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}15%,30%{opacity:0;transform:scale(1.6)}31%{opacity:1;transform:scale(1)}33%{opacity:0;transform:scale(1.6)}34%{opacity:1;transform:scale(1)}36%,56%{opacity:0;transform:scale(1.6)}57%{opacity:1;transform:scale(1)}60%,73%{opacity:0;transform:scale(1.6)}74%{opacity:1;transform:scale(1)}77%,100%{opacity:0;transform:scale(1.6)}}
@keyframes vp-new{0%,13%{opacity:0;transform:translateY(-6px)}18%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0;transform:translateY(0)}}
@keyframes vp-ink{0%,13%{transform:translateX(-140px);width:50px}18%,94%{transform:translateX(0);width:84px}99%,100%{transform:translateX(-140px);width:50px}}
@keyframes vp-plus{0%,13%{transform:translateX(-92px)}18%,94%{transform:translateX(0)}99%,100%{transform:translateX(-92px)}}
@keyframes vp-tabla{0%,13%{color:${C.fg}}18%,94%{color:${C.mutedFg}}99%,100%{color:${C.fg}}}
@keyframes vp-n1{0%,40%{opacity:1}43%,100%{opacity:0}}
@keyframes vp-n2{0%,42%{opacity:0}45%,100%{opacity:1}}
@keyframes vp-edit{0%,34%{box-shadow:0 0 0 0 transparent;background:transparent}36%,48%{box-shadow:0 0 0 1.5px ${primary()};background:${C.card}}52%,100%{box-shadow:0 0 0 0 transparent;background:transparent}}
@keyframes vp-menu{0%,57%{opacity:0;transform:translateY(-6px) scale(.97)}61%,90%{opacity:1;transform:translateY(0) scale(1)}95%,100%{opacity:0;transform:translateY(0) scale(1)}}
@keyframes vp-tog{0%,74%{background:${C.border}}76%,100%{background:${primary()}}}
@keyframes vp-knob{0%,74%{transform:translateX(0)}76%,100%{transform:translateX(9px)}}
@keyframes vp-star{0%,75%{opacity:0;transform:scale(.3)}79%,94%{opacity:1;transform:scale(1)}99%,100%{opacity:0}}
@keyframes vp-hl{0%,70%{background:transparent}72%,86%{background:${primary(0.1)}}90%,100%{background:transparent}}
`;

function Toggle({ on, a }: { on?: boolean; a?: string }): JSX.Element {
    return (
        <span data-a={a ? '' : undefined} style={{ position: 'relative', width: 20, height: 11, borderRadius: 99, background: on ? primary() : C.border, animationName: a ? 'vp-tog' : undefined, flexShrink: 0 }}>
            <span data-a={a ? '' : undefined} style={{ position: 'absolute', left: 1.5, top: 1.5, width: 8, height: 8, borderRadius: 99, background: '#fff', transform: on ? 'translateX(9px)' : undefined, animationName: a ? 'vp-knob' : undefined }} />
        </span>
    );
}

function Item({ icon, label, right, a }: { icon: JSX.Element; label: string; right?: JSX.Element; a?: string }): JSX.Element {
    return (
        <div data-a={a ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 21, padding: '0 9px', color: C.mutedFg, animationName: a }}>
            {icon}
            <T size={9.5} style={{ flex: 1 }}>
                {label}
            </T>
            {right}
        </div>
    );
}

export default function VistasPestanas(): JSX.Element {
    return (
        <Stage label="Las pestañas de vistas de una lista: con «+ Vista» nace una pestaña nueva, con doble clic se le cambia el nombre y con el clic derecho se abre su menú para hacerla la vista por defecto." tint="violet">
            <Keyframes css={CSS} />
            <Win x={20} y={22} w={440} h={256} title="Facturas">
                {/* Pestañas */}
                <At x={12} y={10} w={60} h={24} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.mutedFg }}>
                    <List size={11} />
                    <T size={10} weight={600} color={C.mutedFg}>
                        Todos
                    </T>
                </At>
                <At x={72} y={10} w={56} h={24} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.mutedFg }}>
                    <Table size={11} />
                    <span data-a="" style={{ fontSize: 10, fontWeight: 600, color: C.mutedFg, animationName: 'vp-tabla' }}>
                        Tabla
                    </span>
                </At>
                <At x={128} y={10} w={70} h={24} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.mutedFg }}>
                    <KanbanSquare size={11} />
                    <T size={10} weight={600} color={C.mutedFg}>
                        Por estado
                    </T>
                </At>
                {/* La pestaña nueva */}
                <At x={208} y={9} w={84} h={26} a="vp-new" style={{ zIndex: 2 }}>
                    <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 5, animationName: 'vp-edit' }} />
                    <span style={{ position: 'absolute', left: 6, top: 6, display: 'flex', alignItems: 'center', gap: 4, color: C.fg }}>
                        <Table size={11} />
                        <span style={{ position: 'relative', width: 58, height: 13 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, fontSize: 10, fontWeight: 600, opacity: 0, animationName: 'vp-n1', whiteSpace: 'nowrap' }}>
                                Nueva vista
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, fontSize: 10, fontWeight: 600, animationName: 'vp-n2', whiteSpace: 'nowrap' }}>
                                Vencidas
                            </span>
                        </span>
                    </span>
                    <span data-a="" style={{ position: 'absolute', right: 6, top: 7, color: 'hsl(var(--imcrm-warning))', animationName: 'vp-star' }}>
                        <Star size={10} fill="currentColor" />
                    </span>
                </At>
                <At x={300} y={10} w={60} h={24} a="vp-plus" style={{ display: 'flex', alignItems: 'center' }}>
                    <T size={10} weight={600} color={C.mutedFg}>
                        + Vista
                    </T>
                </At>
                <At x={12} y={35} w={416} h={1} style={{ background: C.border }} />
                <At x={208} y={33} w={84} h={2} a="vp-ink" style={{ background: primary(), borderRadius: 2 }} />

                {/* Filas de fondo */}
                {[0, 1, 2, 3, 4].map((i) => (
                    <At key={i} x={12} y={48 + i * 33} w={416} h={33} style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.border}`, padding: '0 8px' }}>
                        <T size={9.5} weight={600} style={{ width: 70 }}>
                            {['FAC-0141', 'FAC-0137', 'FAC-0132', 'FAC-0128', 'FAC-0119'][i]}
                        </T>
                        <Bar w={[90, 70, 110, 80, 96][i]!} />
                        <span style={{ flex: 1 }} />
                        <Chip label="Vencida" t="rose" />
                    </At>
                ))}

                {/* Menú de la pestaña */}
                <At
                    x={212}
                    y={40}
                    w={180}
                    a="vp-menu"
                    style={{
                        zIndex: 10,
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 9,
                        padding: '5px 0',
                        boxShadow: '0 14px 30px -12px rgba(15,23,42,.45)',
                    }}
                >
                    <Item icon={<Pin size={10} />} label="Marcar como favorito" />
                    <Item icon={<Pencil size={10} />} label="Cambiar el nombre" />
                    <Item icon={<Link2 size={10} />} label="Copiar vínculo a la vista" />
                    <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
                    <Item icon={<Lock size={10} />} label="Vista privada" right={<Toggle />} />
                    <Item icon={<Shield size={10} />} label="Proteger vista" right={<Toggle />} />
                    <Item icon={<Star size={10} />} label="Vista por defecto" right={<Toggle on a="1" />} a="vp-hl" />
                    <div style={{ height: 1, background: C.border, margin: '4px 0' }} />
                    <Item icon={<Copy size={10} />} label="Duplicar vista" />
                </At>
            </Win>
            <Cursor a="vp-cur" click="vp-ring" rest={[392, 216]} />
        </Stage>
    );
}
