import { Clock, Wand2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Una automatización programada: cada lunes a las 7:30 corre sola y sube 5 %
 * los precios de la lista, redondeados para que terminen en 900.
 */

const CSS = `
@keyframes ah-hand{0%{transform:rotate(60deg)}22%,100%{transform:rotate(180deg)}}
@keyframes ah-time{0%,20%{opacity:.35}24%,92%{opacity:1}97%,100%{opacity:.35}}
@keyframes ah-mon{0%,20%{background:${C.card};color:${C.fg};box-shadow:0 0 0 0 transparent}24%,90%{background:${primary()};color:${C.primaryFg};box-shadow:0 0 0 3px ${primary(0.25)}}96%,100%{background:${C.card};color:${C.fg};box-shadow:0 0 0 0 transparent}}
@keyframes ah-run{0%,24%{opacity:0;transform:translateY(4px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ah-sweep{0%,30%{opacity:0;transform:translateY(0)}32%{opacity:1;transform:translateY(0)}62%{opacity:1;transform:translateY(128px)}64%,100%{opacity:0;transform:translateY(128px)}}
`;

const PRODUCTS = [
    { n: 'Café de origen 500 g', o: '$ 32.000', v: '$ 33.900' },
    { n: 'Taza de cerámica', o: '$ 18.000', v: '$ 18.900' },
    { n: 'Prensa francesa', o: '$ 96.000', v: '$ 100.900' },
    { n: 'Filtros de papel x100', o: '$ 12.000', v: '$ 12.900' },
];
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Keyframes propias por fila (el cambio de precio llega cuando pasa el barrido). */
function rowCss(i: number): string {
    const s = 36 + i * 7;
    return `@keyframes ah-o${i}{0%,${s}%{opacity:1;transform:translateY(0)}${s + 3}%,94%{opacity:0;transform:translateY(-6px)}98%,100%{opacity:1;transform:translateY(0)}}
@keyframes ah-n${i}{0%,${s}%{opacity:0;transform:translateY(6px)}${s + 3}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ah-p${i}{0%,${s}%{opacity:0;transform:scale(.6)}${s + 3}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}`;
}

export default function AutoHorario(): JSX.Element {
    return (
        <Stage label="Una automatización programada: cada lunes a las 7:30 corre sola y sube 5 % los precios de la lista, redondeados para que terminen en 900." tint="amber">
            <Keyframes css={CSS + PRODUCTS.map((_, i) => rowCss(i)).join('\n')} />
            {/* El horario */}
            <Win x={16} y={40} w={168} h={206} title="De forma programada">
                <At x={0} y={10} w={168} style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ position: 'relative', width: 66, height: 66, borderRadius: 99, border: `2px solid ${C.border}`, background: C.card }}>
                        {[0, 1, 2, 3].map((k) => (
                            <span key={k} style={{ position: 'absolute', left: 31, top: 3, width: 2, height: 6, borderRadius: 2, background: C.mutedFg, opacity: 0.5, transformOrigin: '1px 30px', transform: `rotate(${k * 90}deg)` }} />
                        ))}
                        <span style={{ position: 'absolute', left: 31, top: 16, width: 3, height: 17, borderRadius: 3, background: C.fg, transformOrigin: '1.5px 17px', transform: 'rotate(225deg)' }} />
                        <span data-a="" style={{ position: 'absolute', left: 31.5, top: 9, width: 2, height: 24, borderRadius: 2, background: primary(), transformOrigin: '1px 24px', transform: 'rotate(180deg)', animationName: 'ah-hand' }} />
                        <span style={{ position: 'absolute', left: 29, top: 29, width: 8, height: 8, borderRadius: 99, background: primary() }} />
                    </span>
                </At>
                <At x={0} y={84} w={168} a="ah-time" style={{ display: 'flex', justifyContent: 'center' }}>
                    <T size={15} weight={700}>
                        07:30
                    </T>
                </At>
                <At x={12} y={110} w={144} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    {DAYS.map((d, i) => (
                        <span
                            key={i}
                            data-a={i === 0 ? '' : undefined}
                            style={{
                                width: 18,
                                height: 18,
                                borderRadius: 5,
                                border: `1px solid ${C.border}`,
                                background: i === 0 ? primary() : C.card,
                                color: i === 0 ? C.primaryFg : C.mutedFg,
                                fontSize: 8,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                animationName: i === 0 ? 'ah-mon' : undefined,
                            }}
                        >
                            {d}
                        </span>
                    ))}
                </At>
                <At x={12} y={138} w={144} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.4} weight={600}>
                        Una vez por semana
                    </T>
                    <T size={7.6} color={C.mutedFg}>
                        los lunes a las 07:30
                    </T>
                    <T size={7.6} color={C.mutedFg}>
                        Hora de Colombia (Bogotá)
                    </T>
                </At>
            </Win>

            {/* El aviso de que corrió */}
            <At x={196} y={16} a="ah-run" style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 99, background: tone('amber', 0.15), border: `1px solid ${tone('amber', 0.35)}` }}>
                <Clock size={11} color={tone('amber')} />
                <T size={8.6} weight={700} color={tone('amber')}>
                    Lunes 07:30 · corriendo
                </T>
                <span style={{ width: 1, height: 12, background: tone('amber', 0.4) }} />
                <Wand2 size={11} color={tone('amber')} />
                <T size={8.6} weight={600} color={tone('amber')}>
                    Editar en lote
                </T>
            </At>

            {/* La lista que cambia */}
            <Win x={196} y={46} w={270} h={200} title="Productos · Precio +5 %, termina en 900">
                <At x={0} y={0} w={270} h={24} style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, background: C.muted }}>
                    <T size={7.6} weight={700} color={C.mutedFg} style={{ flex: 1 }}>
                        Producto
                    </T>
                    <T size={7.6} weight={700} color={C.mutedFg}>
                        Precio
                    </T>
                </At>
                {PRODUCTS.map((p, i) => (
                    <At key={p.n} x={0} y={24 + i * 36} w={270} h={36} style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: i < 3 ? `1px solid ${C.border}` : undefined }}>
                        <T size={8.8} weight={500} style={{ flex: 1 }}>
                            {p.n}
                        </T>
                        <span style={{ position: 'relative', display: 'block', width: 70, height: 14 }}>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', opacity: 0, animationName: `ah-o${i}` }}>
                                <T size={9} weight={600} color={C.mutedFg}>
                                    {p.o}
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: `ah-n${i}` }}>
                                <T size={9} weight={700}>
                                    {p.v}
                                </T>
                            </span>
                        </span>
                        <span data-a="" style={{ marginLeft: 6, display: 'inline-flex', height: 14, padding: '0 5px', alignItems: 'center', borderRadius: 99, background: tone('mint', 0.16), color: tone('mint'), fontSize: 7.5, fontWeight: 700, animationName: `ah-p${i}` }}>
                            +5 %
                        </span>
                    </At>
                ))}
                <At x={0} y={24} w={270} h={8} a="ah-sweep" style={{ opacity: 0, background: `linear-gradient(180deg, transparent, ${primary(0.28)}, transparent)` }} />
            </Win>
            <At x={196} y={254} w={270} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8.4} color={C.mutedFg}>
                    Queda en el historial de ediciones masivas, con «Deshacer».
                </T>
            </At>
        </Stage>
    );
}
