import { KanbanSquare, Package, Send, Sparkles } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * El asistente ✨: se le pide en palabras una lista nueva, responde con una
 * PROPUESTA con vista previa (campos, vista) y nada cambia hasta que se toca
 * «Aplicar». Después la lista aparece en el menú, lista para usar.
 */

const CSS = `
@keyframes ia-msg{0%,21%{opacity:0;transform:translateY(6px)}24%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes ia-think{0%,24%{opacity:0}27%,37%{opacity:1}40%,100%{opacity:0}}
@keyframes ia-card{0%,38%{opacity:0;transform:translateY(8px) scale(.98)}43%,94%{opacity:1;transform:translateY(0) scale(1)}99%,100%{opacity:0}}
@keyframes ia-cur{0%,40%{transform:translate(330px,296px);opacity:0}46%{opacity:1}56%,60%{transform:translate(426px,212px)}74%,90%{transform:translate(200px,280px);opacity:1}96%,100%{opacity:0;transform:translate(200px,280px)}}
@keyframes ia-ring{0%,57%{opacity:0;transform:scale(.4)}59%{opacity:1;transform:scale(1)}63%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ia-btn{0%,59%{opacity:1}61%,96%{opacity:0}100%{opacity:1}}
@keyframes ia-done{0%,59%{opacity:0}61%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ia-new{0%,62%{opacity:0;transform:translateX(-10px);background:transparent}67%{opacity:1;transform:translateX(0);background:${primary(0.16)}}84%,94%{opacity:1;background:transparent}99%,100%{opacity:0}}
@keyframes ia-dots{0%,100%{opacity:.25}50%{opacity:1}}
`;

const LISTS: Array<[string, 'violet' | 'blue' | 'amber' | 'mint' | 'rose']> = [
    ['Oportunidades', 'violet'],
    ['Clientes', 'blue'],
    ['Facturas', 'mint'],
    ['Tareas', 'amber'],
];

export default function IaAsistente(): JSX.Element {
    return (
        <Stage label="El asistente de IA: se le pide en palabras una lista de pedidos, responde con una propuesta con sus campos y su tablero, y al tocar Aplicar la lista aparece en el menú." tint="violet" cycle={8}>
            <Keyframes css={CSS} />
            {/* El menú de la app */}
            <Win x={14} y={28} w={200} h={234} title="Café Aurora">
                <At x={12} y={10} style={{ display: 'flex' }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.08em' }}>
                        ESPACIO DE TRABAJO
                    </T>
                </At>
                {LISTS.map(([n, t], i) => (
                    <At key={n} x={6} y={28 + i * 28} w={188} h={24} style={{ borderRadius: 6, display: 'flex', alignItems: 'center', gap: 7, padding: '0 7px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: tone(t) }} />
                        <T size={9}>{n}</T>
                    </At>
                ))}
                <At x={6} y={140} w={188} h={24} a="ia-new" style={{ borderRadius: 6, display: 'flex', alignItems: 'center', gap: 7, padding: '0 7px' }}>
                    <span style={{ display: 'flex', color: tone('rose') }}>
                        <Package size={11} />
                    </span>
                    <T size={9} weight={700}>
                        Pedidos
                    </T>
                    <span style={{ marginLeft: 'auto', height: 14, padding: '0 5px', borderRadius: 99, background: tone('mint', 0.16), color: tone('mint'), fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Nueva</span>
                </At>
            </Win>

            {/* El panel del asistente */}
            <At x={226} y={10} w={244} h={282} style={{ borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -20px rgba(15,23,42,.55)', overflow: 'hidden' }}>
                <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 11px', borderBottom: `1px solid ${C.border}` }}>
                    <Sparkles size={13} color={primary()} />
                    <T size={10} weight={700}>
                        Asistente IA
                    </T>
                    <T size={7.2} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                        Propón, revisa, aplica
                    </T>
                </div>
                {/* El pedido */}
                <At x={46} y={42} w={188} a="ia-msg" style={{ borderRadius: '10px 10px 3px 10px', background: primary(), padding: '6px 9px' }}>
                    <T size={8} color={C.primaryFg} style={{ whiteSpace: 'normal', lineHeight: 1.4, display: 'block' }}>
                        Crea una lista de pedidos con cliente, monto, estado y fecha de entrega, y un tablero por estado.
                    </T>
                </At>
                <At x={12} y={104} a="ia-think" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <T size={8} color={C.mutedFg}>
                        Pensando
                    </T>
                    {[0, 1, 2].map((k) => (
                        <span key={k} data-a="" style={{ width: 4, height: 4, borderRadius: 99, background: C.mutedFg, animationName: 'ia-dots', animationDuration: '1s', animationDelay: `${k * 0.2}s` }} />
                    ))}
                </At>
                {/* La propuesta */}
                <At x={12} y={98} w={220} a="ia-card" style={{ borderRadius: 11, border: `1px solid ${primary(0.35)}`, background: primary(0.04), padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IconSquare t="rose" size={20}>
                            <Package size={11} />
                        </IconSquare>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                                Propuesta · crear lista
                            </T>
                            <T size={9} weight={700}>
                                Pedidos
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {['Cliente', 'Monto', 'Estado', 'Entrega', 'Notas'].map((f) => (
                            <span key={f} style={{ height: 16, padding: '0 6px', borderRadius: 5, background: C.muted, fontSize: 7.6, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{f}</span>
                        ))}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <KanbanSquare size={11} color={C.mutedFg} />
                        <T size={7.8} color={C.mutedFg}>
                            Vista «Por estado» (tablero)
                        </T>
                    </span>
                    <span style={{ display: 'flex', gap: 3 }}>
                        {(['slate', 'blue', 'amber', 'mint'] as const).map((t, i) => (
                            <span key={t} style={{ flex: 1, height: 18, borderRadius: 5, background: tone(t, 0.12), borderTop: `2px solid ${tone(t)}`, padding: 3 }}>
                                <span style={{ display: 'block', height: 6, borderRadius: 2, background: C.card, width: `${80 - i * 10}%` }} />
                            </span>
                        ))}
                    </span>
                    <span style={{ position: 'relative', display: 'block', height: 22 }}>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', gap: 5, animationName: 'ia-btn', opacity: 0 }}>
                            <span style={{ height: 22, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, fontSize: 8.2, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Cancelar</span>
                            <span style={{ height: 22, padding: '0 12px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8.4, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Aplicar</span>
                        </span>
                        <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'ia-done' }}>
                            <span style={{ height: 22, padding: '0 10px', borderRadius: 6, background: tone('mint', 0.16), color: tone('mint'), fontSize: 8.4, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>✓ Aplicada · Abrir la lista</span>
                        </span>
                    </span>
                </At>
                {/* Caja de texto */}
                <At x={10} y={244} w={224} h={28} style={{ borderRadius: 9, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 6 }}>
                    <span style={{ flex: 1, overflow: 'hidden' }}>
                        <T size={7.8} color={C.mutedFg}>
                            Pide algo…
                        </T>
                    </span>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: primary(), color: C.primaryFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Send size={10} />
                    </span>
                </At>
            </At>
            <At x={14} y={270} w={200} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={7.8} color={C.mutedFg}>
                    Nada cambia hasta que tocas «Aplicar».
                </T>
            </At>
            <Cursor a="ia-cur" click="ia-ring" rest={[200, 280]} />
        </Stage>
    );
}
