import { Check, ChevronDown, Copy, History, RotateCcw, Send, Sparkles } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * v0.1.370 — El chat del asistente rediseñado: las conversaciones guardadas
 * al costado, el pedido, los pasos que dio («2 pasos»), la respuesta con
 * formato (título, negrita y una tabla) que llega en vivo, y abajo «Copiar» y
 * «Reintentar».
 */

const CSS = `
@keyframes ich-msg{0%,6%{opacity:0;transform:translateY(6px)}10%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes ich-step{0%,14%{opacity:0}18%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ich-work{0%,13%{opacity:0}15%,24%{opacity:1}27%,100%{opacity:0}}
@keyframes ich-h{0%,26%{opacity:0}30%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ich-p{0%,32%{opacity:0}36%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ich-r1{0%,40%{opacity:0;transform:translateX(-4px)}44%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes ich-r2{0%,46%{opacity:0;transform:translateX(-4px)}50%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes ich-r3{0%,52%{opacity:0;transform:translateX(-4px)}56%,94%{opacity:1;transform:translateX(0)}99%,100%{opacity:0}}
@keyframes ich-act{0%,58%{opacity:0}62%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes ich-cur{0%,60%{transform:translate(420px,292px);opacity:0}64%{opacity:1}72%,78%{transform:translate(160px,232px)}92%,100%{transform:translate(160px,232px);opacity:0}}
@keyframes ich-ring{0%,73%{opacity:0;transform:scale(.4)}75%{opacity:1;transform:scale(1)}79%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ich-copy{0%,75%{opacity:1}76%,94%{opacity:0}100%{opacity:1}}
@keyframes ich-copied{0%,75%{opacity:0}76%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes ich-dots{0%,100%{opacity:.25}50%{opacity:1}}
`;

const CONVS: Array<[string, string, boolean]> = [
    ['Ventas por vendedor', 'hace un momento', true],
    ['Tablero de cobros', 'hace 2 h', false],
    ['Campos para Clientes', 'ayer', false],
];

const ROWS: Array<[string, string, string]> = [
    ['Ana Gómez', '12.500.000', 'ich-r1'],
    ['Luis Pérez', '9.800.000', 'ich-r2'],
    ['Sara Ruiz', '7.250.000', 'ich-r3'],
];

export default function IaChat(): JSX.Element {
    return (
        <Stage label="El chat del asistente: tus conversaciones guardadas al costado; la respuesta llega con título, negrita y una tabla; arriba se ven los pasos que dio y abajo los botones para copiar o reintentar." tint="violet" cycle={8}>
            <Keyframes css={CSS} />
            <At x={14} y={12} w={452} h={278} style={{ borderRadius: 14, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -22px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                {/* Encabezado */}
                <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <Sparkles size={12} color={primary()} />
                    <T size={9.5} weight={700}>
                        Ventas por vendedor
                    </T>
                    <T size={7} color={C.mutedFg} style={{ marginLeft: 6 }}>
                        Claude · esfuerzo medio
                    </T>
                </div>
                {/* Historial */}
                <At x={0} y={32} w={128} h={246} style={{ borderRight: `1px solid ${C.border}`, background: C.muted, padding: '8px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 4px' }}>
                        <History size={9} color={C.mutedFg} />
                        <T size={6.8} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            HOY
                        </T>
                    </span>
                    {CONVS.map(([title, when, active]) => (
                        <span key={title} style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '5px 6px', borderRadius: 6, background: active ? primary(0.12) : 'transparent' }}>
                            <T size={7.8} weight={active ? 700 : 500} color={active ? primary() : undefined}>
                                {title}
                            </T>
                            <T size={6.4} color={C.mutedFg}>
                                {when}
                            </T>
                        </span>
                    ))}
                </At>
                {/* Conversación */}
                <At x={140} y={40} w={300} h={236}>
                    <At x={110} y={0} w={190} a="ich-msg" style={{ borderRadius: '10px 10px 3px 10px', background: primary(), padding: '5px 8px' }}>
                        <T size={7.6} color={C.primaryFg} style={{ whiteSpace: 'normal', lineHeight: 1.35, display: 'block' }}>
                            ¿Cuánto vendió cada persona este mes?
                        </T>
                    </At>
                    <At x={0} y={36} a="ich-work" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <T size={7.4} color={C.mutedFg}>
                            Sumando los registros
                        </T>
                        {[0, 1, 2].map((k) => (
                            <span key={k} data-a="" style={{ width: 3.5, height: 3.5, borderRadius: 99, background: C.mutedFg, animationName: 'ich-dots', animationDuration: '1s', animationDelay: `${k * 0.2}s` }} />
                        ))}
                    </At>
                    <At x={0} y={36} a="ich-step" style={{ display: 'flex', alignItems: 'center', gap: 4, height: 15, padding: '0 7px', borderRadius: 99, border: `1px solid ${C.border}` }}>
                        <Check size={8} color={tone('mint')} />
                        <T size={7} color={C.mutedFg}>
                            2 pasos
                        </T>
                        <ChevronDown size={8} color={C.mutedFg} />
                    </At>
                    <At x={0} y={58} a="ich-h">
                        <T size={9.6} weight={800}>
                            Ventas de noviembre
                        </T>
                    </At>
                    <At x={0} y={76} w={296} a="ich-p">
                        <T size={7.8} style={{ whiteSpace: 'normal', lineHeight: 1.4, display: 'block' }}>
                            Van <b>29.550.000</b> entre tres personas:
                        </T>
                    </At>
                    {/* Tabla */}
                    <At x={0} y={94} w={296} style={{ borderRadius: 7, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: C.muted }}>
                            <T size={7} weight={700}>
                                Vendedor
                            </T>
                            <T size={7} weight={700}>
                                Total
                            </T>
                        </span>
                        {ROWS.map(([name, total, a]) => (
                            <span key={name} data-a="" style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderTop: `1px solid ${C.border}`, animationName: a, opacity: 0 }}>
                                <T size={7.4} color={primary()}>
                                    {name}
                                </T>
                                <T size={7.4} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {total}
                                </T>
                            </span>
                        ))}
                    </At>
                    {/* Copiar / Reintentar */}
                    <At x={0} y={174} a="ich-act" style={{ display: 'flex', gap: 4 }}>
                        <span style={{ position: 'relative', width: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>
                            <span data-a="" style={{ display: 'flex', animationName: 'ich-copy' }}>
                                <Copy size={10} />
                            </span>
                            <span data-a="" style={{ position: 'absolute', display: 'flex', animationName: 'ich-copied', opacity: 0, color: tone('mint') }}>
                                <Check size={10} />
                            </span>
                        </span>
                        <span style={{ width: 18, height: 18, borderRadius: 5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.mutedFg }}>
                            <RotateCcw size={10} />
                        </span>
                    </At>
                    {/* Caja de texto */}
                    <At x={0} y={204} w={296} h={26} style={{ borderRadius: 12, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 4px 0 9px', gap: 6 }}>
                        <span style={{ flex: 1 }}>
                            <T size={7.4} color={C.mutedFg}>
                                Pide algo o haz una pregunta…
                            </T>
                        </span>
                        <span style={{ width: 19, height: 19, borderRadius: 7, background: primary(), color: C.primaryFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Send size={9} />
                        </span>
                    </At>
                </At>
            </At>
            <Cursor a="ich-cur" click="ich-ring" rest={[160, 232]} />
        </Stage>
    );
}
