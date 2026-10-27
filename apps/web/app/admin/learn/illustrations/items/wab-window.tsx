import { Check, LayoutTemplate, MessageSquare, X } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La ventana de 24 horas: cuando el cliente escribe se abre una ventana en la
 * que puedes mandarle texto libre. Al cerrarse, el texto libre se rechaza y
 * sólo salen plantillas aprobadas, que sirven siempre.
 */

const X0 = 40;
const X1 = 440;
const toX = (h: number): number => X0 + ((X1 - X0) * h) / 36; // eje de 0 a 36 h

const CSS = `
@keyframes ww-band{0%,8%{width:0}22%,100%{width:${toX(24) - toX(2)}px}}
@keyframes ww-now{0%{transform:translateX(0)}88%,100%{transform:translateX(${toX(32) - toX(2)}px)}}
@keyframes ww-a{0%,22%{opacity:0;transform:translateY(6px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ww-b{0%,60%{opacity:0;transform:translateY(6px)}66%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ww-c{0%,74%{opacity:0;transform:translateY(6px)}80%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ww-in{0%,2%{opacity:0;transform:scale(.6)}7%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Card({ x, y, ok, icon, title, sub, a }: { x: number; y: number; ok: boolean; icon: JSX.Element; title: string; sub: string; a: string }): JSX.Element {
    return (
        <At
            x={x}
            y={y}
            w={150}
            a={a}
            style={{ background: C.card, border: `1px solid ${ok ? tone('mint', 0.5) : 'hsl(var(--imcrm-destructive) / .5)'}`, borderRadius: 10, padding: '8px 9px', display: 'flex', gap: 7, boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)' }}
        >
            <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, background: ok ? tone('mint', 0.16) : 'hsl(var(--imcrm-destructive) / .14)', color: ok ? tone('mint') : C.destructive, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {icon}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {ok ? <Check size={10} color={tone('mint')} /> : <X size={10} color={C.destructive} />}
                    <T size={9} weight={700}>
                        {title}
                    </T>
                </span>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    {sub}
                </T>
            </span>
        </At>
    );
}

export default function WabWindow(): JSX.Element {
    return (
        <Stage label="La ventana de 24 horas: cuando el cliente escribe puedes mandarle texto libre; cuando la ventana se cierra, sólo salen plantillas aprobadas." tint="mint">
            <Keyframes css={CSS} />

            {/* Eje de tiempo */}
            <At x={X0} y={150} w={X1 - X0} h={2} style={{ background: C.border }} />
            {[0, 6, 12, 18, 24, 30, 36].map((h) => (
                <At key={h} x={toX(h) - 14} y={156} w={28} style={{ textAlign: 'center' }}>
                    <T size={8} color={C.mutedFg}>
                        {h === 0 ? '0 h' : `${h} h`}
                    </T>
                </At>
            ))}

            {/* La ventana abierta */}
            <At x={toX(2)} y={128} h={22} a="ww-band" style={{ width: toX(24) - toX(2), borderRadius: '6px 6px 0 0', background: tone('mint', 0.18), borderBottom: `2px solid ${tone('mint')}`, overflow: 'hidden', display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                <T size={8.5} weight={700} color={tone('mint')}>
                    Ventana abierta: 24 h desde su último mensaje
                </T>
            </At>
            <At x={toX(24) + 6} y={132} w={140}>
                <T size={8.5} weight={700} color={C.mutedFg}>
                    Ventana cerrada
                </T>
            </At>

            {/* El mensaje del cliente que abre la ventana */}
            <At x={toX(2) - 7} y={143} a="ww-in" style={{ opacity: 1 }}>
                <span style={{ display: 'block', width: 14, height: 14, borderRadius: 99, background: '#25D366', border: `3px solid ${C.card}` }} />
            </At>
            <At x={toX(2) - 30} y={60} w={140} a="ww-in" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '6px 8px' }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.05em', display: 'block' }}>
                    El cliente escribe
                </T>
                <T size={9} style={{ display: 'block', marginTop: 2 }}>
                    «¿Ya está lista mi orden?»
                </T>
            </At>

            {/* Lo que se puede mandar en cada momento */}
            <Card x={toX(8) - 20} y={188} ok icon={<MessageSquare size={12} />} title="Texto libre" sub="Dentro de la ventana: sale." a="ww-a" />
            <Card x={toX(26) - 30} y={188} ok={false} icon={<MessageSquare size={12} />} title="Texto libre" sub="Fuera de la ventana: se rechaza." a="ww-b" />
            <Card x={toX(26) - 30} y={28} ok icon={<LayoutTemplate size={12} />} title="Plantilla aprobada" sub="Sale siempre, con o sin ventana." a="ww-c" />

            {/* «Ahora» que avanza */}
            <At x={toX(2)} y={112} a="ww-now">
                <span style={{ display: 'block', width: 2, height: 46, background: primary(), marginLeft: -1 }} />
                <span style={{ position: 'absolute', left: -14, top: -14, padding: '1px 5px', borderRadius: 4, background: primary(), color: C.primaryFg, fontSize: 7.5, fontWeight: 700 }}>ahora</span>
            </At>
        </Stage>
    );
}
