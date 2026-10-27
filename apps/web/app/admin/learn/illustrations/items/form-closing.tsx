import { CalendarDays, Lock, Users } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/** Cierre por cupo: con un máximo de 30 respuestas, al llegar la número 30 el formulario se cierra solo y muestra su mensaje. */

const CSS = `
@keyframes fcl-num{0%,16%{transform:translateY(0)}20%,40%{transform:translateY(-14px)}44%,94%{transform:translateY(-28px)}100%{transform:translateY(0)}}
@keyframes fcl-bar{0%,16%{width:93%}20%,40%{width:97%}44%,94%{width:100%}100%{width:93%}}
@keyframes fcl-barc{0%,40%{background:${primary()}}44%,94%{background:${tone('rose')}}100%{background:${primary()}}}
@keyframes fcl-a1{0%,8%{opacity:0;transform:translate(30px,0) scale(.8)}12%,26%{opacity:1;transform:translate(0,0) scale(1)}30%,100%{opacity:0;transform:translate(0,-10px)}}
@keyframes fcl-a2{0%,30%{opacity:0;transform:translate(30px,0) scale(.8)}34%,46%{opacity:1;transform:translate(0,0) scale(1)}50%,100%{opacity:0;transform:translate(0,-10px)}}
@keyframes fcl-form{0%,48%{opacity:1;filter:blur(0)}54%,94%{opacity:.18;filter:blur(1.5px)}100%{opacity:1;filter:blur(0)}}
@keyframes fcl-closed{0%,49%{opacity:0;transform:translateY(8px) scale(.96)}55%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes fcl-hl{0%,40%{box-shadow:0 0 0 0 transparent}45%,60%{box-shadow:0 0 0 2px ${tone('rose', 0.45)}}70%,100%{box-shadow:0 0 0 0 transparent}}
`;

function Label({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <T size={7} weight={600} color={C.mutedFg}>
            {children}
        </T>
    );
}

export default function FormClosing(): JSX.Element {
    return (
        <Stage label="Un taller con 30 cupos: llegan las últimas inscripciones, el contador llega a 30 de 30 y el formulario se cierra solo con el mensaje de cupos agotados." tint="rose">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Ajustes del constructor */}
                <At
                    x={24}
                    y={68}
                    w={172}
                    h={166}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' }}
                >
                    <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        CUÁNDO RECIBE RESPUESTAS
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Label>Hasta el día</Label>
                        <span style={{ height: 17, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
                            <CalendarDays size={8} color={C.mutedFg} />
                            <T size={8}>13/11/2026</T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Label>Hasta un máximo de respuestas</Label>
                        <span data-a="" style={{ height: 17, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px', animationName: 'fcl-hl' }}>
                            <T size={8.5} weight={700}>
                                30
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <Label>Mensaje cuando está cerrado</Label>
                        <span style={{ borderRadius: 4, border: `1px solid ${C.border}`, padding: '4px 6px' }}>
                            <T size={7.5} style={{ whiteSpace: 'normal' }}>
                                ¡Se llenó! Síguenos en Instagram para la próxima fecha.
                            </T>
                        </span>
                    </span>
                </At>

                {/* El formulario público */}
                <At
                    x={214}
                    y={24}
                    w={244}
                    h={252}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', boxShadow: '0 14px 34px -14px rgba(15,23,42,.4)' }}
                >
                    <div style={{ height: 4, background: primary() }} />
                    <At x={14} y={14} w={216}>
                        <T size={11.5} weight={800}>
                            Curso de tortas · Noviembre
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8 }}>
                            <Users size={9} color={C.mutedFg} />
                            <T size={8} color={C.mutedFg}>
                                Cupos ocupados:
                            </T>
                            <span style={{ position: 'relative', display: 'inline-block', height: 14, width: 16, overflow: 'hidden' }}>
                                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', flexDirection: 'column', transform: 'translateY(-28px)', animationName: 'fcl-num' }}>
                                    {[28, 29, 30].map((n) => (
                                        <T key={n} size={9} weight={800} style={{ height: 14, lineHeight: '14px' }}>
                                            {n}
                                        </T>
                                    ))}
                                </span>
                            </span>
                            <T size={8} color={C.mutedFg}>
                                de 30
                            </T>
                        </span>
                        <span style={{ display: 'block', marginTop: 6, height: 6, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'block', height: '100%', width: '100%', borderRadius: 99, background: tone('rose'), animationName: 'fcl-bar, fcl-barc' }} />
                        </span>
                    </At>
                    <At x={14} y={74} w={216} a="fcl-form" style={{ opacity: 0.18, filter: 'blur(1.5px)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {['Nombre', 'Celular', 'Correo'].map((l) => (
                            <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={8} weight={700}>
                                    {l}
                                </T>
                                <span style={{ height: 18, borderRadius: 5, border: `1px solid ${C.border}` }} />
                            </span>
                        ))}
                        <span style={{ marginTop: 4, height: 22, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8.5} weight={700} color={C.primaryFg}>
                                Inscribirme
                            </T>
                        </span>
                    </At>
                    {/* Cerrado */}
                    <At x={18} y={92} w={208} a="fcl-closed" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '16px 12px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 28px -14px rgba(15,23,42,.45)' }}>
                        <span style={{ width: 34, height: 34, borderRadius: 99, background: tone('rose', 0.16), color: tone('rose'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Lock size={16} />
                        </span>
                        <T size={10} weight={800}>
                            Formulario cerrado
                        </T>
                        <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', textAlign: 'center' }}>
                            ¡Se llenó! Síguenos en Instagram para la próxima fecha.
                        </T>
                    </At>
                </At>

                {/* Llegan las últimas inscripciones */}
                {(
                    [
                        ['fcl-a1', 'AR', 'Ana Ruiz', 'violet'],
                        ['fcl-a2', 'JM', 'Julián Mesa', 'mint'],
                    ] as const
                ).map(([a, ini, name, t]) => (
                    <At key={a} x={300} y={242} a={a} style={{ opacity: 0 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px 4px 4px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -8px rgba(15,23,42,.45)' }}>
                            <Avatar initials={ini} t={t} size={18} />
                            <T size={8} weight={700}>
                                {name} se inscribió
                            </T>
                        </span>
                    </At>
                ))}
            </At>
        </Stage>
    );
}
