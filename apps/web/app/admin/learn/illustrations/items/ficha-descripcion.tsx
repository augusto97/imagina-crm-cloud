import { CheckSquare, Columns2, Heading1, Image, List, Table, Youtube } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** La descripción: escribir «/» abre el menú de bloques y una «Lista de control» queda lista para marcar. */

const MENU: Array<{ g?: string; icon: JSX.Element; l: string; d: string }> = [
    { g: 'TEXTO', icon: <Heading1 size={11} />, l: 'Título 1', d: 'Título de sección grande' },
    { g: 'LISTAS', icon: <List size={11} />, l: 'Lista con viñetas', d: 'Una lista simple' },
    { icon: <CheckSquare size={11} />, l: 'Lista de control', d: 'Casillas para marcar' },
    { g: 'BLOQUES', icon: <Table size={11} />, l: 'Tabla', d: 'Una tabla de 3×3 con cabecera' },
];
const ITEM_H = 20;
const GROUP_H = 14;
const itemY = (i: number): number => {
    let y = 6;
    for (let k = 0; k < i; k++) y += ITEM_H + (MENU[k + 1]?.g ? GROUP_H : 0);
    return y + GROUP_H;
};

const CSS = `
@keyframes fd-slash{0%,10%{opacity:0}13%,46%{opacity:1}49%,100%{opacity:0}}
@keyframes fd-menu{0%,15%{opacity:0;transform:translateY(-6px)}19%,45%{opacity:1;transform:translateY(0)}49%,100%{opacity:0;transform:translateY(-4px)}}
@keyframes fd-hl{0%,24%{transform:translateY(${itemY(0)}px)}30%{transform:translateY(${itemY(1)}px)}36%,100%{transform:translateY(${itemY(2)}px)}}
@keyframes fd-enter{0%,40%{opacity:0;transform:scale(.8)}43%,48%{opacity:1;transform:scale(1)}52%,100%{opacity:0}}
${[0, 1, 2].map((i) => `@keyframes fd-i${i}{0%,${49 + i * 7}%{opacity:0;transform:translateX(-6px)}${53 + i * 7}%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}`).join('\n')}
@keyframes fd-chk{0%,76%{background:transparent;border-color:${C.border}}79%,94%{background:${primary()};border-color:${primary()}}99%,100%{background:transparent;border-color:${C.border}}}
@keyframes fd-tick{0%,76%{opacity:0}79%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fd-strike{0%,76%{color:${C.fg};text-decoration-color:transparent}79%,94%{color:${C.mutedFg};text-decoration-color:${C.mutedFg}}99%,100%{color:${C.fg}}}
@keyframes fd-saved{0%,58%{opacity:0}62%,94%{opacity:1}99%,100%{opacity:0}}
`;

export default function FichaDescripcion(): JSX.Element {
    const items = ['Pedir el logo en alta resolución', 'Confirmar la paleta de colores', 'Enviar el contrato firmado'];
    return (
        <Stage label="El editor de la descripción de un registro: al escribir una barra diagonal se abre el menú de bloques, se elige «Lista de control» y aparecen tres casillas; la primera se marca y la descripción se guarda sola." tint="violet">
            <Keyframes css={CSS} />
            <At x={24} y={20} w={432} h={262} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(15,23,42,.45)' }}>
                <At x={18} y={14} w={396} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <T size={8.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        DESCRIPCIÓN
                    </T>
                    <span data-a="" style={{ animationName: 'fd-saved' }}>
                        <T size={8.5} color={C.mutedFg}>
                            Guardado ✓
                        </T>
                    </span>
                </At>
                <At x={18} y={34} w={396} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={16} weight={800}>
                        Brief del proyecto
                    </T>
                    <T size={10} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                        Página web para Panadería La Espiga: catálogo, pedidos por WhatsApp y un mapa de las dos sedes.
                    </T>
                    <T size={12} weight={700} style={{ marginTop: 4 }}>
                        Lo que falta pedirle al cliente
                    </T>
                </At>
                {/* La barra que abre el menú */}
                <At x={18} y={124} a="fd-slash" style={{ opacity: 0, display: 'flex', alignItems: 'center' }}>
                    <T size={11}>/</T>
                    <span style={{ width: 1.5, height: 13, background: primary(), marginLeft: 1 }} />
                </At>
                {/* La lista de control resultante */}
                <At x={18} y={124} w={396} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {items.map((it, i) => (
                        <span key={it} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 7, animationName: `fd-i${i}` }}>
                            <span
                                data-a={i === 0 ? '' : undefined}
                                style={{ position: 'relative', width: 12, height: 12, borderRadius: 3, border: `1.5px solid ${i === 0 ? primary() : C.border}`, background: i === 0 ? primary() : 'transparent', animationName: i === 0 ? 'fd-chk' : undefined }}
                            >
                                {i === 0 && (
                                    <span data-a="" style={{ position: 'absolute', inset: 0, color: '#fff', fontSize: 8.5, lineHeight: '10px', textAlign: 'center', animationName: 'fd-tick' }}>
                                        ✓
                                    </span>
                                )}
                            </span>
                            <span data-a={i === 0 ? '' : undefined} style={{ fontSize: 10.5, textDecoration: i === 0 ? 'line-through' : undefined, color: i === 0 ? C.mutedFg : C.fg, animationName: i === 0 ? 'fd-strike' : undefined }}>
                                {it}
                            </span>
                        </span>
                    ))}
                </At>
                <At x={18} y={226} w={396} style={{ display: 'flex', gap: 10, color: C.mutedFg }}>
                    {[<Image key="i" size={11} />, <Youtube key="y" size={11} />, <Columns2 key="c" size={11} />].map((ic, i) => (
                        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {ic}
                            <T size={8.5} color={C.mutedFg}>
                                {['Imagen', 'YouTube, Loom, Figma…', 'Columnas'][i]}
                            </T>
                        </span>
                    ))}
                </At>

                {/* Menú «/» */}
                <At x={30} y={142} w={196} a="fd-menu" style={{ opacity: 0, zIndex: 5, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 16px 36px -14px rgba(15,23,42,.55)', height: itemY(MENU.length - 1) + ITEM_H + 6, overflow: 'hidden' }}>
                    <span data-a="" style={{ position: 'absolute', left: 4, right: 4, top: 0, height: ITEM_H, borderRadius: 6, background: primary(0.12), transform: `translateY(${itemY(2)}px)`, animationName: 'fd-hl' }} />
                    {MENU.map((m, i) => (
                        <span key={m.l}>
                            {m.g && (
                                <span style={{ position: 'absolute', left: 10, top: itemY(i) - GROUP_H + 2, fontSize: 7.5, fontWeight: 700, color: C.mutedFg, letterSpacing: '.06em' }}>{m.g}</span>
                            )}
                            <span style={{ position: 'absolute', left: 8, top: itemY(i), height: ITEM_H, display: 'flex', alignItems: 'center', gap: 7 }}>
                                <span style={{ width: 18, height: 18, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>{m.icon}</span>
                                <span style={{ display: 'flex', flexDirection: 'column' }}>
                                    <T size={9} weight={600}>
                                        {m.l}
                                    </T>
                                    <T size={7.5} color={C.mutedFg}>
                                        {m.d}
                                    </T>
                                </span>
                            </span>
                        </span>
                    ))}
                </At>
                <At x={236} y={170} a="fd-enter" style={{ opacity: 0, zIndex: 6, padding: '4px 10px', borderRadius: 7, border: `1px solid ${C.border}`, borderBottomWidth: 3, background: C.card, fontSize: 11, fontWeight: 700, color: tone('violet') }}>
                    Enter ↵
                </At>
            </At>
        </Stage>
    );
}
