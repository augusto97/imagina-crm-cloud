import { BookOpen, Bot, MessageSquare, PenLine } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Un agente de IA en modo «Propone y una persona aprueba»: llega un ticket, el
 * agente lo lee, propone la prioridad y deja una nota; una persona toca
 * «Aplicar» y el cambio queda hecho.
 */

const LOG = [
    { icon: <BookOpen size={10} />, k: 'Leyó', txt: 'el ticket y sus comentarios', t: 'blue' as const, s: 14 },
    { icon: <PenLine size={10} />, k: 'Propuso', txt: 'Prioridad → Alta', t: 'violet' as const, s: 28 },
    { icon: <MessageSquare size={10} />, k: 'Propuso', txt: 'nota: «No puede entrar desde ayer»', t: 'violet' as const, s: 40 },
];

const CSS = `
@keyframes iag-tk{0%,3%{opacity:0;transform:translateY(-8px)}8%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes iag-run{0%,9%{box-shadow:0 0 0 0 transparent}12%,48%{box-shadow:0 0 0 3px ${primary(0.25)}}52%,100%{box-shadow:0 0 0 0 transparent}}
${LOG.map((l, i) => `@keyframes iag-l${i}{0%,${l.s}%{opacity:0;transform:translateX(-8px)}${l.s + 5}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}`).join('\n')}
@keyframes iag-prop{0%,48%{opacity:0;transform:translateY(6px)}53%,64%{opacity:1;transform:translateY(0)}67%,100%{opacity:0}}
@keyframes iag-done{0%,64%{opacity:0}68%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes iag-pv{0%,65%{opacity:0;transform:scale(.6)}70%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes iag-empty{0%,65%{opacity:1}68%,96%{opacity:0}100%{opacity:1}}
@keyframes iag-cur{0%,44%{transform:translate(200px,296px);opacity:0}50%{opacity:1}58%,63%{transform:translate(52px,210px)}76%,90%{transform:translate(160px,288px);opacity:1}96%,100%{opacity:0;transform:translate(160px,288px)}}
@keyframes iag-ring{0%,60%{opacity:0;transform:scale(.4)}62%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
`;

export default function IaAgente(): JSX.Element {
    return (
        <Stage label="Un agente de IA que propone: llega un ticket, el agente lo lee, propone la prioridad Alta y una nota interna; una persona toca Aplicar y el cambio queda hecho." tint="violet">
            <Keyframes css={CSS} />
            {/* El ticket */}
            <Win x={14} y={26} w={200} h={250} a="iag-tk" title="Tickets · TCK-0128">
                <At x={11} y={10} w={178} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={10} weight={700}>
                        No puedo entrar a mi cuenta
                    </T>
                    <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Desde ayer me sale error al iniciar sesión y tengo pedidos por despachar.
                    </T>
                </At>
                <At x={11} y={64} w={178} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                        ['Cliente', 'Café Bahía'],
                        ['Prioridad', ''],
                    ].map(([k, v]) => (
                        <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <T size={7.6} color={C.mutedFg} style={{ width: 54 }}>
                                {k}
                            </T>
                            {v !== '' ? (
                                <T size={8.4} weight={600}>
                                    {v}
                                </T>
                            ) : (
                                <span style={{ position: 'relative', display: 'block', width: 60, height: 16 }}>
                                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: 'iag-empty' }}>
                                        <T size={8.4} color={C.mutedFg}>
                                            —
                                        </T>
                                    </span>
                                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'iag-pv' }}>
                                        <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone('rose'), color: '#fff', fontSize: 8.4, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Alta</span>
                                    </span>
                                </span>
                            )}
                        </span>
                    ))}
                </At>
                {/* La propuesta en la ficha */}
                <At x={9} y={112} w={182} a="iag-prop" style={{ opacity: 0, borderRadius: 9, border: `1px solid ${tone('violet', 0.45)}`, background: tone('violet', 0.07), padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Bot size={11} color={tone('violet')} />
                        <T size={7.8} weight={700}>
                            Propuesta de un agente de IA
                        </T>
                    </span>
                    <T size={7.6}>Prioridad: — → Alta · y una nota interna</T>
                    <span style={{ display: 'flex', gap: 5 }}>
                        <span style={{ height: 20, padding: '0 10px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Aplicar</span>
                        <span style={{ height: 20, padding: '0 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, fontSize: 8, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Descartar</span>
                    </span>
                </At>
                <At x={9} y={112} w={182} a="iag-done" style={{ borderRadius: 9, background: tone('mint', 0.12), padding: '7px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={7.8} weight={700} color={tone('mint')}>
                        ✓ Propuesta aplicada
                    </T>
                </At>
            </Win>

            {/* El agente */}
            <At x={226} y={26} w={240} h={250} a="iag-run" style={{ borderRadius: 13, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 9, background: tone('blue'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Bot size={16} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={10} weight={700}>
                            Clasificador de tickets
                        </T>
                        <T size={7.4} color={C.mutedFg}>
                            Agente de IA · Activo
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {['Leer el registro', 'Cambiar campos', 'Comentar'].map((h) => (
                        <span key={h} style={{ height: 16, padding: '0 6px', borderRadius: 99, background: C.muted, fontSize: 7.4, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{h}</span>
                    ))}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, borderRadius: 7, background: tone('violet', 0.1), padding: '5px 8px' }}>
                    <T size={7.6} weight={700} color={tone('violet')}>
                        Modo: Propone y una persona aprueba
                    </T>
                </span>
                <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 4 }}>
                    Historial · Cuando se crea un ticket
                </T>
                {LOG.map((l, i) => (
                    <span key={i} data-a="" style={{ animationName: `iag-l${i}`, display: 'flex', alignItems: 'center', gap: 7, borderRadius: 8, border: `1px solid ${C.border}`, padding: '6px 8px' }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone(l.t, 0.16), color: tone(l.t), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{l.icon}</span>
                        <T size={7.8} weight={700}>
                            {l.k}
                        </T>
                        <T size={7.6} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {l.txt}
                        </T>
                    </span>
                ))}
            </At>
            <Cursor a="iag-cur" click="iag-ring" rest={[160, 288]} />
        </Stage>
    );
}
