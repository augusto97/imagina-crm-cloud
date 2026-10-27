import { AlignLeft, Calendar, CircleDot, Hash, ListChecks, Plus, Search, Settings, Type } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Agregar un campo desde la tabla: el «+» abre el panel Campos, se elige
 * «Selección», se escriben el nombre y las opciones y al crear aparece la
 * columna nueva con sus chips.
 */

const CSS = `
@keyframes af-sheet{0%,10%{transform:translateX(220px)}16%,62%{transform:translateX(0)}68%,100%{transform:translateX(220px)}}
@keyframes af-cat{0%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes af-form{0%,32%{opacity:0}36%,96%{opacity:1}100%{opacity:0}}
@keyframes af-prev{0%,20%{opacity:0;transform:translateX(6px)}24%,32%{opacity:1;transform:translateX(0)}35%,100%{opacity:0}}
@keyframes af-sel{0%,22%{background:transparent}25%,33%{background:${primary(0.14)}}}
@keyframes af-type{0%,38%{width:0}46%,100%{width:34px}}
@keyframes af-o1{0%,46%{opacity:0}49%,100%{opacity:1}}
@keyframes af-o2{0%,49%{opacity:0}52%,100%{opacity:1}}
@keyframes af-o3{0%,52%{opacity:0}55%,100%{opacity:1}}
@keyframes af-col{0%,66%{opacity:0;transform:translateY(-6px)}72%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes af-cell{0%,68%{opacity:0;transform:scale(.6)}74%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes af-cur{0%{transform:translate(200px,280px);opacity:0}5%{opacity:1}9%,12%{transform:translate(447px,32px)}24%,30%{transform:translate(318px,124px)}56%,60%{transform:translate(404px,266px)}72%,88%{transform:translate(330px,250px);opacity:1}94%,100%{transform:translate(330px,250px);opacity:0}}
@keyframes af-ring{0%,10%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}16%{opacity:0;transform:scale(1.6)}28%{opacity:0;transform:scale(.4)}30%{opacity:1;transform:scale(1)}34%{opacity:0;transform:scale(1.6)}58%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1)}64%,100%{opacity:0;transform:scale(1.6)}}
`;

const ROWS: Array<[string, string, string, 'slate' | 'blue' | 'mint']> = [
    ['Café Bahía', 'Cali', 'Nuevo', 'slate'],
    ['Clínica Norte', 'Bogotá', 'En curso', 'blue'],
    ['Hotel Brisas', 'Cartagena', 'Ganado', 'mint'],
    ['Óptica Visión', 'Medellín', 'En curso', 'blue'],
    ['Ferretería Sol', 'Pereira', 'Nuevo', 'slate'],
    ['Colegio Andino', 'Bogotá', 'Ganado', 'mint'],
];

const TYPES: Array<[string, typeof Type]> = [
    ['Selección', CircleDot],
    ['Texto', Type],
    ['Fecha', Calendar],
    ['Texto largo', AlignLeft],
    ['Número', Hash],
    ['Selección múltiple', ListChecks],
];

export default function LcAgregarCampo(): JSX.Element {
    return (
        <Stage label="Desde la tabla se toca el más para agregar un campo; en el panel Campos se elige Selección, se escriben el nombre Estado y sus opciones, y al crear aparece la columna con sus chips de colores." tint="violet">
            <Keyframes css={CSS} />
            {/* Tabla */}
            <At x={14} y={20} w={452} h={258} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 14px', borderBottom: `1px solid ${C.border}`, gap: 0 }}>
                    {['Cliente', 'Ciudad'].map((h, i) => (
                        <span key={h} style={{ width: i === 0 ? 110 : 84, display: 'flex' }}>
                            <T size={8.5} weight={600} color={C.mutedFg}>
                                {h}
                            </T>
                        </span>
                    ))}
                    <span data-a="" style={{ width: 84, display: 'flex', animationName: 'af-col' }}>
                        <T size={8.5} weight={600} color={C.mutedFg}>
                            Estado
                        </T>
                    </span>
                </div>
                {ROWS.map(([n, c, s, t], i) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', height: 34, padding: '0 14px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 110, display: 'flex' }}>
                            <T size={9} weight={600}>
                                {n}
                            </T>
                        </span>
                        <span style={{ width: 84, display: 'flex' }}>
                            <T size={9} color={C.mutedFg}>
                                {c}
                            </T>
                        </span>
                        <span data-a="" style={{ display: 'flex', animationName: 'af-cell', animationDelay: `${i * 0.06}s` }}>
                            <Chip label={s} t={t} />
                        </span>
                    </div>
                ))}
            </At>
            {/* El «+» flotante */}
            <At x={440} y={25} style={{ zIndex: 3 }}>
                <span style={{ width: 18, height: 18, borderRadius: 99, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 4px ${primary(0.15)}` }}>
                    <Plus size={11} />
                </span>
            </At>

            {/* Panel «Campos» */}
            <At x={260} y={14} w={206} h={272} a="af-sheet" style={{ transform: 'translateX(220px)', zIndex: 5, background: C.card, borderLeft: `1px solid ${C.border}`, borderRadius: '12px 0 0 12px', boxShadow: '-16px 0 36px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px 6px' }}>
                    <T size={10.5} weight={700}>
                        Campos
                    </T>
                    <Settings size={10} color={C.mutedFg} />
                </div>
                {/* Catálogo */}
                <At x={0} y={30} w={206} h={240} a="af-cat" style={{ opacity: 0, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 20, padding: '0 6px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                        <Search size={9} color={C.mutedFg} />
                        <T size={7.5} color={C.mutedFg}>
                            Buscar campos
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 3, padding: 2, borderRadius: 6, background: C.muted }}>
                        <span style={{ flex: 1, textAlign: 'center', fontSize: 7.5, fontWeight: 700, padding: '2px 0', borderRadius: 4, background: C.card }}>Crear nuevo</span>
                        <span style={{ flex: 1, textAlign: 'center', fontSize: 7.5, fontWeight: 600, padding: '2px 0', color: C.mutedFg }}>Copiar de otra lista</span>
                    </span>
                    <T size={7} weight={700} color={C.mutedFg}>
                        POPULARES
                    </T>
                    <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                        {TYPES.map(([l, Icon], i) => (
                            <span key={l} data-a={i === 0 ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 6px', borderRadius: 6, border: `1px solid ${C.border}`, animationName: i === 0 ? 'af-sel' : undefined }}>
                                <Icon size={10} color={primary()} />
                                <T size={7.5} weight={600}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </span>
                    <T size={7} weight={700} color={C.mutedFg} style={{ marginTop: 4 }}>
                        TODOS
                    </T>
                    {['Moneda', 'Usuario', 'Relación'].map((l) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', height: 18 }}>
                            <T size={7.5}>{l}</T>
                        </span>
                    ))}
                </At>
                {/* Formulario */}
                <At x={0} y={30} w={206} h={240} a="af-form" style={{ padding: '0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <CircleDot size={11} color={primary()} />
                        <T size={9} weight={700}>
                            Selección
                        </T>
                    </span>
                    <T size={7.5} weight={600}>
                        Nombre
                    </T>
                    <span style={{ height: 20, borderRadius: 6, border: `1.5px solid ${primary()}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                        <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: 34, animationName: 'af-type' }}>
                            <T size={8.5}>Estado</T>
                        </span>
                    </span>
                    <T size={7.5} weight={600}>
                        Opciones
                    </T>
                    {[
                        ['Nuevo', 'slate', 'af-o1'],
                        ['En curso', 'blue', 'af-o2'],
                        ['Ganado', 'mint', 'af-o3'],
                    ].map(([l, t, a]) => (
                        <span key={l} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 6px', borderRadius: 6, border: `1px solid ${C.border}`, animationName: a }}>
                            <span style={{ width: 10, height: 10, borderRadius: 99, background: tone(t as 'mint') }} />
                            <T size={8}>{l}</T>
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, border: `1.5px solid ${C.mutedFg}` }} />
                        <T size={7.5}>Obligatorio</T>
                    </span>
                    <span style={{ marginTop: 'auto', marginBottom: 12, alignSelf: 'flex-end' }}>
                        <Btn label="Crear campo" style={{ height: 19, fontSize: 8 }} />
                    </span>
                </At>
            </At>
            {/* Vista previa del tipo (al pasar el mouse) */}
            <At x={150} y={110} w={104} a="af-prev" style={{ opacity: 0, zIndex: 6, background: C.card, borderRadius: 9, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -14px rgba(15,23,42,.6)', padding: 7, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={8} weight={700}>
                    Selección
                </T>
                <span style={{ display: 'flex', gap: 3 }}>
                    <Chip label="Nuevo" t="slate" style={{ height: 13, fontSize: 7 }} />
                    <Chip label="Ganado" t="mint" style={{ height: 13, fontSize: 7 }} />
                </span>
                <T size={6.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                    Una opción de una lista predefinida.
                </T>
            </At>
            <Cursor a="af-cur" click="af-ring" rest={[330, 250]} />
        </Stage>
    );
}
