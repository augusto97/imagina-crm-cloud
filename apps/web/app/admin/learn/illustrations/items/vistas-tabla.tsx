import type { ReactNode } from 'react';
import { EyeOff, Pin, Rows3 } from 'lucide-react';

import { At, C, Chip, Keyframes, Pill, Stage, T, Win } from '../kit';

/** Ajustar la tabla: se oculta una columna, las filas pasan a compactas y la primera columna queda fija al desplazarse. */

const CSS = `
@keyframes vt-hide{0%,14%{width:86px;opacity:1}24%,95%{width:0;opacity:0}100%{width:86px;opacity:1}}
@keyframes vt-row{0%,38%{height:30px}50%,95%{height:21px}100%{height:30px}}
@keyframes vt-scroll{0%,62%{transform:translateX(0)}78%,94%{transform:translateX(-96px)}100%{transform:translateX(0)}}
@keyframes vt-shadow{0%,64%{box-shadow:none}74%,94%{box-shadow:6px 0 10px -6px rgba(15,23,42,.35)}100%{box-shadow:none}}
@keyframes vt-p1{0%,4%{opacity:0;transform:translateY(4px)}8%,28%{opacity:1;transform:translateY(0)}32%,100%{opacity:0}}
@keyframes vt-p2{0%,32%{opacity:0;transform:translateY(4px)}36%,56%{opacity:1;transform:translateY(0)}60%,100%{opacity:0}}
@keyframes vt-p3{0%,60%{opacity:0;transform:translateY(4px)}64%,92%{opacity:1;transform:translateY(0)}96%,100%{opacity:0}}
@keyframes vt-colhl{0%,6%{background:transparent}9%,16%{background:hsl(var(--imcrm-destructive) / .12)}22%,100%{background:transparent}}
`;

type Tn = 'slate' | 'violet' | 'amber' | 'blue';
const ROWS: Array<[string, string, Tn, string, string, string, string]> = [
    ['Café de origen', 'Granos', 'amber', '34', '$ 134.000', 'Finca El Roble', 'Bodega A'],
    ['Molino manual', 'Equipos', 'slate', '28', '$ 160.000', 'Importadora Sur', 'Bodega B'],
    ['Taza de cerámica', 'Menaje', 'violet', '9', '$ 22.000', 'Cerámicas Ruiz', 'Vitrina'],
    ['Filtros x100', 'Insumos', 'blue', '31', '$ 57.000', 'Papeles Andinos', 'Bodega A'],
    ['Prensa francesa', 'Equipos', 'slate', '5', '$ 92.000', 'Importadora Sur', 'Vitrina'],
    ['Jarra para leche', 'Menaje', 'violet', '38', '$ 113.000', 'Cerámicas Ruiz', 'Bodega B'],
    ['Kit de barista', 'Equipos', 'slate', '44', '$ 22.000', 'Importadora Sur', 'Bodega A'],
    ['Termo de acero', 'Menaje', 'violet', '4', '$ 107.000', 'Metálicas SAS', 'Vitrina'],
];
const COLS = [
    { h: 'Categoría', w: 86 },
    { h: 'Stock', w: 50 },
    { h: 'Precio', w: 80 },
    { h: 'Proveedor', w: 86, hide: true },
    { h: 'Ubicación', w: 80 },
    { h: 'Activo', w: 100 },
];

function Cell({ w, hide, children }: { w: number; hide?: boolean; children: ReactNode }): JSX.Element {
    return (
        <span
            data-a={hide ? '' : undefined}
            style={{ width: hide ? 0 : w, opacity: hide ? 0 : 1, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', padding: hide ? 0 : '0 8px', whiteSpace: 'nowrap', animationName: hide ? 'vt-hide' : undefined }}
        >
            {children}
        </span>
    );
}

export default function VistasTabla(): JSX.Element {
    const head = 24;
    return (
        <Stage label="Una tabla de productos que se ajusta: se oculta la columna Proveedor, las filas pasan a densidad compacta y, al desplazarse hacia los lados, la columna del producto queda fija." tint="blue">
            <Keyframes css={CSS} />
            <Win x={22} y={22} w={436} h={256} title="Productos · Tabla">
                {/* Avisos de lo que pasa */}
                <At x={12} y={7} a="vt-p1" style={{ opacity: 0 }}>
                    <Pill t="rose" icon={<EyeOff size={10} />} label="Ocultar «Proveedor»" />
                </At>
                <At x={12} y={7} a="vt-p2" style={{ opacity: 0 }}>
                    <Pill t="blue" icon={<Rows3 size={10} />} label="Densidad: Compacta" />
                </At>
                <At x={12} y={7} a="vt-p3">
                    <Pill t="violet" icon={<Pin size={10} />} label="Columnas fijas: Sólo la primera" />
                </At>

                <At x={12} y={32} w={412} h={192} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                    {/* Columnas que se desplazan */}
                    <div data-a="" style={{ position: 'absolute', left: 120, top: 0, animationName: 'vt-scroll', transform: 'translateX(-96px)' }}>
                        <div style={{ display: 'flex', height: head, background: C.muted }}>
                            {COLS.map((c) => (
                                <Cell key={c.h} w={c.w} hide={c.hide}>
                                    <span data-a={c.hide ? '' : undefined} style={{ animationName: c.hide ? 'vt-colhl' : undefined, borderRadius: 4, padding: '2px 3px', display: 'inline-flex', marginLeft: -3 }}>
                                        <T size={8.5} weight={700} color={C.mutedFg}>
                                            {c.h}
                                        </T>
                                    </span>
                                </Cell>
                            ))}
                        </div>
                        {ROWS.map((r) => (
                            <div key={r[0]} data-a="" style={{ display: 'flex', height: 21, borderTop: `1px solid ${C.border}`, animationName: 'vt-row', overflow: 'hidden' }}>
                                <Cell w={86}>
                                    <Chip label={r[1]} t={r[2]} />
                                </Cell>
                                <Cell w={50}>
                                    <T size={9.5}>{r[3]}</T>
                                </Cell>
                                <Cell w={80}>
                                    <T size={9.5}>{r[4]}</T>
                                </Cell>
                                <Cell w={86} hide>
                                    <T size={9.5} color={C.mutedFg}>
                                        {r[5]}
                                    </T>
                                </Cell>
                                <Cell w={80}>
                                    <T size={9.5} color={C.mutedFg}>
                                        {r[6]}
                                    </T>
                                </Cell>
                                <Cell w={100}>
                                    <T size={9.5} color={C.success}>
                                        ✓
                                    </T>
                                </Cell>
                            </div>
                        ))}
                    </div>
                    {/* Columna fija */}
                    <div data-a="" style={{ position: 'absolute', left: 0, top: 0, width: 120, background: C.card, zIndex: 2, animationName: 'vt-shadow', boxShadow: '6px 0 10px -6px rgba(15,23,42,.35)' }}>
                        <div style={{ height: head, background: C.muted, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', color: C.mutedFg }}>
                            <Pin size={9} />
                            <span style={{ padding: '2px 0', display: 'inline-flex' }}>
                                <T size={8.5} weight={700} color={C.mutedFg}>
                                    Producto
                                </T>
                            </span>
                        </div>
                        {ROWS.map((r) => (
                            <div key={r[0]} data-a="" style={{ height: 21, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', animationName: 'vt-row', overflow: 'hidden' }}>
                                <T size={9.5} weight={600}>
                                    {r[0]}
                                </T>
                            </div>
                        ))}
                    </div>
                </At>
            </Win>
        </Stage>
    );
}
