import { Copy, FilePlus2, LayoutTemplate, Receipt, Search, Target, Ticket, Users, Wallet } from 'lucide-react';

import { At, Btn, C, Cursor, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Nueva lista» desde una plantilla: se elige «Facturación» en la galería,
 * se ve qué trae, se marca «Incluir los registros de ejemplo» y al tocar
 * «Usar plantilla» las listas aparecen en el menú.
 */

const CSS = `
@keyframes nl-pick{0%,14%{box-shadow:0 0 0 1px ${C.border}}18%,100%{box-shadow:0 0 0 2px ${primary()}}}
@keyframes nl-prev{0%,16%{opacity:0;transform:translateX(10px)}22%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes nl-empty{0%,16%{opacity:1}20%,96%{opacity:0}100%{opacity:1}}
@keyframes nl-check{0%,34%{background:transparent}38%,100%{background:${primary()}}}
@keyframes nl-dlg{0%,58%{opacity:1;transform:scale(1)}64%,94%{opacity:0;transform:scale(.97)}100%{opacity:1}}
@keyframes nl-l1{0%,64%{opacity:0;transform:translateX(-10px)}70%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes nl-l2{0%,68%{opacity:0;transform:translateX(-10px)}74%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes nl-glow{0%,70%{background:transparent}74%,86%{background:${primary(0.14)}}92%,100%{background:transparent}}
@keyframes nl-tbl{0%,70%{opacity:0;transform:translateY(10px)}76%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes nl-cur{0%{transform:translate(260px,280px);opacity:0}5%{opacity:1}12%,16%{transform:translate(200px,170px)}30%,36%{transform:translate(300px,215px)}50%,56%{transform:translate(420px,262px)}74%,88%{transform:translate(150px,270px);opacity:1}94%,100%{transform:translate(150px,270px);opacity:0}}
@keyframes nl-ring{0%,14%{opacity:0;transform:scale(.4)}16%{opacity:1;transform:scale(1)}20%{opacity:0;transform:scale(1.6)}34%{opacity:0;transform:scale(.4)}36%{opacity:1;transform:scale(1)}40%{opacity:0;transform:scale(1.6)}54%{opacity:0;transform:scale(.4)}56%{opacity:1;transform:scale(1)}60%,100%{opacity:0;transform:scale(1.6)}}
`;

const TEMPLATES: Array<{ name: string; cat: string; icon: JSX.Element; t: 'violet' | 'mint' | 'blue' | 'rose' | 'amber' }> = [
    { name: 'CRM de clientes', cat: 'Clientes', icon: <Users size={11} />, t: 'blue' },
    { name: 'Facturación', cat: 'Finanzas · 2 listas', icon: <Receipt size={11} />, t: 'mint' },
    { name: 'Pipeline de ventas', cat: 'Ventas', icon: <Target size={11} />, t: 'violet' },
    { name: 'Mesa de ayuda', cat: 'Operaciones', icon: <Ticket size={11} />, t: 'rose' },
    { name: 'Control de gastos', cat: 'Finanzas', icon: <Wallet size={11} />, t: 'amber' },
];

export default function LcNuevaLista(): JSX.Element {
    return (
        <Stage label="En «Nueva lista» se elige la plantilla Facturación, se ve qué trae, se marcan los registros de ejemplo y al tocar «Usar plantilla» aparecen Clientes y Facturas en el menú." tint="mint">
            <Keyframes css={CSS} />
            {/* El menú, detrás */}
            <At x={14} y={14} w={130} h={272} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={9.5} weight={700}>
                    Café Aurora
                </T>
                <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em', marginTop: 4 }}>
                    ESPACIO DE TRABAJO
                </T>
                {[
                    ['Oportunidades', 'violet'],
                    ['Tareas', 'amber'],
                ].map(([n, t]) => (
                    <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18, padding: '0 4px' }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: tone(t as 'amber') }} />
                        <T size={8.5}>{n}</T>
                    </span>
                ))}
                <At x={8} y={98} w={114} a="nl-l1" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18, padding: '0 4px', borderRadius: 5 }}>
                    <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 5, animationName: 'nl-glow' }} />
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: tone('blue'), position: 'relative' }} />
                    <T size={8.5} weight={600} style={{ position: 'relative' }}>
                        Clientes
                    </T>
                </At>
                <At x={8} y={122} w={114} a="nl-l2" style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18, padding: '0 4px', borderRadius: 5 }}>
                    <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 5, animationName: 'nl-glow' }} />
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: tone('mint'), position: 'relative' }} />
                    <T size={8.5} weight={600} style={{ position: 'relative' }}>
                        Facturas
                    </T>
                </At>
            </At>

            {/* La lista nueva, con sus registros de ejemplo */}
            <At x={156} y={14} w={308} h={272} a="nl-tbl" style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -22px rgba(15,23,42,.5)', padding: '12px 14px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <IconSquare t="mint" size={18}>
                        <Receipt size={10} />
                    </IconSquare>
                    <T size={11} weight={700}>
                        Facturas
                    </T>
                </span>
                {[
                    ['FAC-1040', 'Hotel Brisas', '$ 1.250.000', 'Pagada', 'mint'],
                    ['FAC-1041', 'Clínica Norte', '$ 3.400.000', 'Pendiente', 'amber'],
                    ['FAC-1042', 'Café Bahía', '$ 480.000', 'Vencida', 'rose'],
                    ['FAC-1043', 'Óptica Visión', '$ 2.100.000', 'Pendiente', 'amber'],
                    ['FAC-1044', 'Colegio Andino', '$ 920.000', 'Pagada', 'mint'],
                    ['FAC-1045', 'Ferretería Sol', '$ 1.640.000', 'Pendiente', 'amber'],
                ].map(([n, c, v, s2, t]) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', height: 30, borderBottom: `1px solid ${C.border}`, gap: 8 }}>
                        <T size={8.5} weight={700} style={{ width: 52 }}>
                            {n}
                        </T>
                        <T size={8.5} style={{ width: 80 }}>
                            {c}
                        </T>
                        <T size={8.5} weight={600} style={{ width: 64 }}>
                            {v}
                        </T>
                        <span style={{ fontSize: 7.5, fontWeight: 700, color: '#fff', background: tone(t as 'mint'), borderRadius: 4, padding: '1px 6px' }}>{s2}</span>
                    </div>
                ))}
            </At>
            {/* El diálogo */}
            <At x={92} y={22} w={376} h={258} a="nl-dlg" style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 24px 56px -22px rgba(15,23,42,.6)', zIndex: 4, overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={11} weight={700}>
                        Nueva lista
                    </T>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3, padding: 3, borderRadius: 7, background: C.muted }}>
                        {[
                            [<LayoutTemplate key="a" size={9} />, 'Plantilla', true],
                            [<FilePlus2 key="b" size={9} />, 'En blanco', false],
                            [<Copy key="c" size={9} />, 'Duplicar', false],
                        ].map(([ic, l, on]) => (
                            <span key={l as string} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, height: 18, borderRadius: 5, background: on ? C.card : 'transparent', boxShadow: on ? `0 1px 2px rgba(15,23,42,.15)` : 'none', color: on ? C.fg : C.mutedFg }}>
                                {ic}
                                <T size={8} weight={on ? 700 : 500} color={on ? C.fg : C.mutedFg}>
                                    {l as string}
                                </T>
                            </span>
                        ))}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 10, padding: '0 12px' }}>
                    {/* Galería */}
                    <div style={{ width: 168, display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 20, padding: '0 6px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                            <Search size={9} color={C.mutedFg} />
                            <T size={7.5} color={C.mutedFg}>
                                Buscar plantillas
                            </T>
                        </span>
                        <span style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {['Todas', 'Ventas', 'Finanzas', 'Proyectos'].map((c, i) => (
                                <span key={c} style={{ fontSize: 7, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: i === 0 ? primary(0.14) : C.muted, color: i === 0 ? primary() : C.mutedFg }}>
                                    {c}
                                </span>
                            ))}
                        </span>
                        {TEMPLATES.map((tp) => (
                            <span
                                key={tp.name}
                                data-a={tp.name === 'Facturación' ? '' : undefined}
                                style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 6px', borderRadius: 7, boxShadow: `0 0 0 1px ${C.border}`, animationName: tp.name === 'Facturación' ? 'nl-pick' : undefined }}
                            >
                                <IconSquare t={tp.t} size={17}>
                                    {tp.icon}
                                </IconSquare>
                                <span style={{ display: 'flex', flexDirection: 'column' }}>
                                    <T size={8} weight={700}>
                                        {tp.name}
                                    </T>
                                    <T size={6.5} color={C.mutedFg}>
                                        {tp.cat}
                                    </T>
                                </span>
                            </span>
                        ))}
                    </div>
                    {/* Vista previa */}
                    <div style={{ position: 'relative', flex: 1, borderRadius: 8, background: C.muted, height: 200 }}>
                        <At x={0} y={78} w={174} a="nl-empty" style={{ opacity: 0, display: 'flex', justifyContent: 'center' }}>
                            <T size={8} color={C.mutedFg}>
                                Elige una plantilla para ver qué trae.
                            </T>
                        </At>
                        <At x={0} y={0} w={174} h={200} a="nl-prev" style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <IconSquare t="mint" size={20}>
                                    <Receipt size={11} />
                                </IconSquare>
                                <T size={9.5} weight={700}>
                                    Facturación
                                </T>
                            </span>
                            <T size={7} weight={700} color={C.mutedFg}>
                                CAMPOS
                            </T>
                            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {['N.º factura', 'Cliente', 'Monto', 'Vence', 'Estado', 'Saldo'].map((f) => (
                                    <span key={f} style={{ fontSize: 7, padding: '1px 5px', borderRadius: 4, background: C.card, border: `1px solid ${C.border}` }}>
                                        {f}
                                    </span>
                                ))}
                            </span>
                            <T size={7} weight={700} color={C.mutedFg}>
                                VISTAS · AUTOMATIZACIONES
                            </T>
                            <T size={7.5}>Por estado · Vencidas · Aviso de mora</T>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                                <span data-a="" style={{ width: 10, height: 10, borderRadius: 3, border: `1.5px solid ${primary()}`, background: primary(), color: C.primaryFg, fontSize: 7, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'nl-check' }}>
                                    ✓
                                </span>
                                <T size={7.5}>Incluir los registros de ejemplo</T>
                            </span>
                            <span style={{ marginTop: 'auto', alignSelf: 'flex-end' }}>
                                <Btn label="Usar plantilla" style={{ height: 18, fontSize: 8 }} />
                            </span>
                        </At>
                    </div>
                </div>
            </At>
            <Cursor a="nl-cur" click="nl-ring" rest={[150, 270]} />
        </Stage>
    );
}
