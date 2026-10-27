import { Columns3, Folder, LayoutDashboard, MoreHorizontal, Pin, Receipt, Target } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Favoritos: al pasar el mouse por una lista aparece el pin; al tocarlo, la
 * lista se suma a Favoritos (a la derecha), junto a un tablero y una vista.
 */

const CSS = `
@keyframes fv-hover{0%,8%{background:transparent}12%,40%{background:${C.card}}46%,100%{background:transparent}}
@keyframes fv-pin{0%,8%{opacity:0}12%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fv-dots{0%,8%{opacity:0}12%,40%{opacity:1}46%,100%{opacity:0}}
@keyframes fv-pinon{0%,30%{color:${C.mutedFg};transform:rotate(0)}33%,40%{color:${primary()};transform:rotate(-30deg) scale(1.2)}46%,100%{color:${C.mutedFg};transform:rotate(0)}}
@keyframes fv-fly{0%,32%{opacity:0;transform:translate(0,0) scale(.6)}35%{opacity:1;transform:translate(0,0) scale(1)}50%{opacity:1;transform:translate(232px,-30px) scale(1)}54%,100%{opacity:0;transform:translate(236px,-30px) scale(.6)}}
@keyframes fv-card{0%,50%{opacity:0;transform:scale(.85)}57%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fv-cur{0%{transform:translate(120px,270px);opacity:0}4%{opacity:1}10%{transform:translate(110px,128px)}28%,32%{transform:translate(166px,131px)}62%,88%{transform:translate(170px,240px);opacity:1}93%,100%{transform:translate(170px,240px);opacity:0}}
@keyframes fv-ring{0%,29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}35%,100%{opacity:0;transform:scale(1.6)}}
`;

function PanelRow({ y, label, dot, active }: { y: number; label: string; dot: string; active?: string }): JSX.Element {
    return (
        <At x={24} y={y} w={176} h={22} a={active} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderRadius: 6, }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: dot }} />
            <T size={9} style={{ flex: 1 }}>
                {label}
            </T>
        </At>
    );
}

function FavCard({ x, y, icon, t, title, kind, a }: { x: number; y: number; icon: JSX.Element; t: 'violet' | 'blue' | 'amber' | 'mint'; title: string; kind: string; a?: string }): JSX.Element {
    return (
        <At x={x} y={y} w={106} h={78} a={a} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 9, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 8px 20px -14px rgba(15,23,42,.5)' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: tone(t), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                <Pin size={10} color={C.mutedFg} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <T size={9} weight={700}>
                    {title}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {kind}
                </T>
            </span>
        </At>
    );
}

export default function DiaFavoritos(): JSX.Element {
    return (
        <Stage label="Al pasar el mouse por la lista Facturas en el menú aparece el pin; al tocarlo, Facturas se suma a la página de Favoritos junto a un tablero y una vista anclada." tint="amber">
            <Keyframes css={CSS} />
            {/* Panel lateral */}
            <At x={16} y={18} w={192} h={264} style={{ background: C.muted, borderRadius: 12, border: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 30, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10.5} weight={700}>
                        Café Aurora
                    </T>
                </div>
                <div style={{ display: 'flex', padding: '9px 14px 0' }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                        ESPACIO DE TRABAJO
                    </T>
                </div>
            </At>
            <PanelRow y={74} label="Oportunidades" dot={tone('violet')} />
            <PanelRow y={98} label="Clientes" dot={tone('blue')} />
            <PanelRow y={122} label="Facturas" dot={tone('mint')} active="fv-hover" />
            <PanelRow y={146} label="Tareas" dot={tone('amber')} />
            <PanelRow y={170} label="Tickets" dot={tone('rose')} />
            {/* pin y menú al pasar el mouse */}
            <At x={160} y={127} a="fv-pin" style={{ display: 'flex', gap: 6 }}>
                <span data-a="" style={{ display: 'flex', animationName: 'fv-pinon', color: primary() }}>
                    <Pin size={12} />
                </span>
                <span data-a="" style={{ display: 'flex', animationName: 'fv-dots', opacity: 0 }}>
                    <MoreHorizontal size={12} color={C.mutedFg} />
                </span>
            </At>
            <At x={160} y={122} a="fv-fly" style={{ opacity: 0, color: primary(), zIndex: 5 }}>
                <Pin size={16} />
            </At>

            {/* Página de favoritos */}
            <At x={222} y={18} w={242} h={264} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -20px rgba(15,23,42,.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 6px' }}>
                    <T size={12} weight={700}>
                        Favoritos
                    </T>
                    <span style={{ display: 'flex', gap: 3, padding: 2, borderRadius: 6, background: C.muted }}>
                        <span style={{ fontSize: 7.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: C.card }}>Por carpeta</span>
                        <span style={{ fontSize: 7.5, fontWeight: 600, padding: '2px 6px', color: C.mutedFg }}>Por tipo</span>
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px' }}>
                    <Folder size={10} color={tone('amber')} />
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        Ventas
                    </T>
                </div>
            </At>
            <FavCard x={234} y={72} icon={<Target size={11} />} t="violet" title="Oportunidades" kind="Lista" />
            <FavCard x={346} y={72} icon={<Receipt size={11} />} t="mint" title="Facturas" kind="Lista" a="fv-card" />
            <At x={234} y={160} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <LayoutDashboard size={10} color={tone('blue')} />
                <T size={8.5} weight={700} color={C.mutedFg}>
                    Dashboards y vistas
                </T>
            </At>
            <FavCard x={234} y={178} icon={<LayoutDashboard size={11} />} t="blue" title="Ventas del mes" kind="Dashboard" />
            <FavCard x={346} y={178} icon={<Columns3 size={11} />} t="amber" title="Por etapa" kind="Vista · Oportunidades" />
            <Cursor a="fv-cur" click="fv-ring" rest={[170, 240]} />
        </Stage>
    );
}
