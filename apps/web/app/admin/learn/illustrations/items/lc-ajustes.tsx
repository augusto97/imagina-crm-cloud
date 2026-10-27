import { Briefcase, CalendarDays, CheckSquare, Columns3, FileText, FormInput, Globe, Paintbrush, Receipt, Settings2, ShieldCheck, Store, Users } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Ajustes de una lista: la tira de secciones arriba y, en «General», el
 * nombre, el ícono y su color (que cambia también en el menú), la dirección
 * web y la descripción.
 */

const CSS = `
@keyframes la-pop{0%,14%{opacity:0;transform:translateY(-6px)}18%,46%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes la-ico1{0%,30%{opacity:1}34%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes la-ico2{0%,30%{opacity:0}34%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes la-c1{0%,40%{background:${tone('slate')}}44%,94%{background:${tone('mint')}}98%,100%{background:${tone('slate')}}}
@keyframes la-pickc{0%,38%{box-shadow:none}41%,46%{box-shadow:0 0 0 2px ${C.card},0 0 0 4px ${primary()}}}
@keyframes la-picki{0%,28%{background:transparent}31%,46%{background:${primary(0.16)}}}
@keyframes la-save{0%,62%{transform:scale(1)}64%{transform:scale(.94)}67%,100%{transform:scale(1)}}
@keyframes la-toast{0%,64%{opacity:0;transform:translateY(6px)}68%,86%{opacity:1;transform:translateY(0)}90%,100%{opacity:0}}
@keyframes la-cur{0%{transform:translate(300px,280px);opacity:0}5%{opacity:1}12%,16%{transform:translate(162px,160px)}28%,32%{transform:translate(262px,218px)}39%,43%{transform:translate(226px,177px)}58%,64%{transform:translate(392px,266px)}80%,88%{transform:translate(392px,266px);opacity:1}93%,100%{opacity:0}}
@keyframes la-ring{0%,14%{opacity:0;transform:scale(.4)}16%{opacity:1;transform:scale(1)}20%{opacity:0;transform:scale(1.6)}29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}35%{opacity:0;transform:scale(1.6)}40%{opacity:0;transform:scale(.4)}42%{opacity:1;transform:scale(1)}46%{opacity:0;transform:scale(1.6)}61%{opacity:0;transform:scale(.4)}63%{opacity:1;transform:scale(1)}67%,100%{opacity:0;transform:scale(1.6)}}
`;

const TABS: Array<[string, typeof Columns3]> = [
    ['Campos', Columns3],
    ['General', Settings2],
    ['Apariencia', Paintbrush],
    ['Permisos', ShieldCheck],
    ['Compartir', Globe],
    ['Documentos', FileText],
    ['Formularios', FormInput],
    ['Agenda', CalendarDays],
];

function IconBox({ size = 22 }: { size?: number }): JSX.Element {
    return (
        <span data-a="" style={{ position: 'relative', width: size, height: size, borderRadius: 6, background: tone('mint'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', animationName: 'la-c1', flexShrink: 0 }}>
            <span data-a="" style={{ position: 'absolute', display: 'flex', opacity: 0, animationName: 'la-ico1' }}>
                <Briefcase size={size * 0.55} />
            </span>
            <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'la-ico2' }}>
                <Receipt size={size * 0.55} />
            </span>
        </span>
    );
}

export default function LcAjustes(): JSX.Element {
    return (
        <Stage label="En los ajustes de la lista Facturas, sección General, se cambia el ícono por un recibo y el color a verde; el cambio se ve también en el menú lateral, y se guarda con Guardar cambios." tint="blue">
            <Keyframes css={CSS} />
            {/* Menú */}
            <At x={14} y={14} w={108} h={272} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <T size={9} weight={700}>
                    Café Aurora
                </T>
                {[
                    ['Clientes', <Users key="u" size={9} />, 'blue'],
                    ['Inventario', <Store key="s" size={9} />, 'amber'],
                ].map(([n, ic, t]) => (
                    <span key={n as string} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 14, height: 14, borderRadius: 4, background: tone(t as 'blue'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ic}</span>
                        <T size={8}>{n as string}</T>
                    </span>
                ))}
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, background: C.card, borderRadius: 5, padding: '3px 3px', boxShadow: `0 0 0 1px ${C.border}` }}>
                    <IconBox size={14} />
                    <T size={8} weight={700}>
                        Facturas
                    </T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: tone('violet'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckSquare size={9} />
                    </span>
                    <T size={8}>Tareas</T>
                </span>
            </At>

            {/* Página de ajustes */}
            <At x={132} y={14} w={334} h={272} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={7.5} color={C.mutedFg}>
                        Listas › Facturas › Configuración
                    </T>
                    <T size={12} weight={700}>
                        Facturas
                    </T>
                </div>
                <div style={{ display: 'flex', gap: 1, padding: '6px 8px 0', borderBottom: `1px solid ${C.border}`, overflow: 'hidden' }}>
                    {TABS.map(([l, Icon], i) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0 5px 5px', borderBottom: `2px solid ${i === 1 ? primary() : 'transparent'}`, color: i === 1 ? primary() : C.mutedFg, flexShrink: 0 }}>
                            <Icon size={8} />
                            <T size={7} weight={i === 1 ? 700 : 500} color={i === 1 ? primary() : C.mutedFg}>
                                {l}
                            </T>
                        </span>
                    ))}
                </div>
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={10} weight={700}>
                        General
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Nombre
                        </T>
                        <span style={{ height: 20, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={8.5}>Facturas</T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Icono
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ padding: 3, borderRadius: 7, border: `1px solid ${C.border}`, display: 'flex' }}>
                                <IconBox />
                            </span>
                            <T size={7.5} color={C.mutedFg}>
                                Se ve junto al nombre en el menú lateral.
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Dirección web
                        </T>
                        <span style={{ height: 20, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px', background: C.muted }}>
                            <T size={8} color={C.mutedFg}>
                                …/lists/<b style={{ color: C.fg }}>facturas</b>
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.5} weight={600}>
                            Descripción
                        </T>
                        <span style={{ height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 7px" }}>
                            <T size={8}>Facturas emitidas a clientes, con su saldo.</T>
                        </span>
                    </span>
                </div>
                <At x={232} y={244} a="la-save">
                    <Btn label="Guardar cambios" style={{ height: 20, fontSize: 8.5 }} />
                </At>
            </At>

            {/* Selector de íconos */}
            <At x={176} y={164} w={150} a="la-pop" style={{ opacity: 0, zIndex: 5, background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 18px 40px -14px rgba(15,23,42,.6)', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', gap: 4 }}>
                    {(['blue', 'violet', 'mint', 'amber', 'rose', 'slate'] as const).map((c) => (
                        <span key={c} data-a={c === 'mint' ? '' : undefined} style={{ width: 14, height: 14, borderRadius: 99, background: tone(c), animationName: c === 'mint' ? 'la-pickc' : undefined }} />
                    ))}
                </span>
                <span style={{ height: 16, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>
                    <T size={7} color={C.mutedFg}>
                        Buscar ícono…
                    </T>
                </span>
                <span style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 3 }}>
                    {[Briefcase, Users, Store, Receipt, FileText, CalendarDays, CheckSquare, Globe, ShieldCheck, Settings2, Columns3, Paintbrush].map((Ic, i) => (
                        <span key={i} data-a={i === 3 ? '' : undefined} style={{ height: 18, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fg, animationName: i === 3 ? 'la-picki' : undefined }}>
                            <Ic size={10} />
                        </span>
                    ))}
                </span>
            </At>
            <At x={190} y={256} a="la-toast" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 10px', borderRadius: 7, background: C.fg, color: C.card, fontSize: 8.5, fontWeight: 600 }}>✓ Cambios guardados</span>
            </At>
            <Cursor a="la-cur" click="la-ring" rest={[392, 266]} />
        </Stage>
    );
}
