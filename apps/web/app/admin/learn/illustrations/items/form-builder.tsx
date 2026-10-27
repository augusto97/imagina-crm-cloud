import { ChevronDown, Heading2, Link2, Monitor, Paperclip, Plus, SeparatorHorizontal, Smartphone, Tag, Type, Undo2 } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** El constructor de formularios: se agrega «Prioridad» desde los campos de la lista, se elige y se marca obligatoria. */

const CSS = `
@keyframes fb-cursor{0%{transform:translate(250px,250px);opacity:0}6%{opacity:1}14%,18%{transform:translate(117px,113px)}40%,44%{transform:translate(401px,127px)}60%,64%{transform:translate(352px,153px);opacity:1}76%,100%{transform:translate(352px,153px);opacity:0}}
@keyframes fb-ring{0%,15%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}20%{opacity:0;transform:scale(1.6)}41%{opacity:0;transform:scale(.4)}43%{opacity:1;transform:scale(1)}46%{opacity:0;transform:scale(1.6)}61%{opacity:0;transform:scale(.4)}63%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fb-src{0%,17%{opacity:1;transform:translateX(0)}22%,94%{opacity:0;transform:translateX(-8px)}100%{opacity:1;transform:translateX(0)}}
@keyframes fb-shift{0%,17%{transform:translateY(0)}22%,94%{transform:translateY(-18px)}100%{transform:translateY(0)}}
@keyframes fb-newq{0%,18%{opacity:0;transform:translateY(-6px) scale(.97)}25%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0}}
@keyframes fb-sel{0%,24%{box-shadow:0 0 0 0 transparent}28%,92%{box-shadow:0 0 0 1.5px ${primary()}}100%{box-shadow:0 0 0 0 transparent}}
@keyframes fb-settings{0%,26%{opacity:1}30%,94%{opacity:0}100%{opacity:1}}
@keyframes fb-insp{0%,26%{opacity:0;transform:translateX(8px)}31%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes fb-drop{0%,43%{opacity:1}46%,100%{opacity:0}}
@keyframes fb-btns{0%,43%{opacity:0;transform:translateY(3px)}47%,100%{opacity:1;transform:translateY(0)}}
@keyframes fb-segA{0%,43%{background:${C.card};color:${C.fg}}46%,100%{background:transparent;color:${C.mutedFg}}}
@keyframes fb-segB{0%,43%{background:transparent;color:${C.mutedFg}}46%,100%{background:${C.card};color:${C.fg}}}
@keyframes fb-check{0%,62%{background:transparent;border-color:${C.border}}65%,100%{background:${primary()};border-color:${primary()}}}
@keyframes fb-tick{0%,62%{opacity:0}65%,100%{opacity:1}}
@keyframes fb-star{0%,63%{opacity:0;transform:scale(.4)}67%,100%{opacity:1;transform:scale(1)}}
`;

function SideItem({ y, icon, label, a, req, style }: { y: number; icon: JSX.Element; label: string; a?: string; req?: boolean; style?: React.CSSProperties }): JSX.Element {
    return (
        <At x={6} y={y} w={106} h={17} a={a} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 5px', borderRadius: 5, ...style }}>
            <span style={{ color: C.mutedFg, display: 'flex' }}>{icon}</span>
            <T size={8.5} style={{ flex: 1 }}>
                {label}
            </T>
            {req && (
                <T size={6.5} color={C.mutedFg}>
                    oblig.
                </T>
            )}
            <span style={{ color: C.mutedFg, display: 'flex' }}>
                <Plus size={9} />
            </span>
        </At>
    );
}

function Input({ w = 168, children }: { w?: number; children?: React.ReactNode }): JSX.Element {
    return (
        <div style={{ marginTop: 3, width: w, height: 15, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 5px' }}>{children}</div>
    );
}

export default function FormBuilder(): JSX.Element {
    return (
        <Stage label="El constructor de formularios: a la izquierda los campos de la lista, en el centro la vista previa y a la derecha las opciones. Se agrega la pregunta Prioridad, se cambia a botones y se marca obligatoria." tint="violet">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win x={14} y={16} w={452} h={268}>
                    {/* Barra de arriba */}
                    <At x={0} y={0} w={452} h={30} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${C.border}` }}>
                            <T size={8.5} weight={600}>
                                Formulario de soporte
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 7px 2px 3px', borderRadius: 99, background: C.muted }}>
                            <span style={{ width: 16, height: 9, borderRadius: 99, background: C.border, position: 'relative' }}>
                                <span style={{ position: 'absolute', left: 1.5, top: 1.5, width: 6, height: 6, borderRadius: 99, background: '#fff' }} />
                            </span>
                            <T size={7.5} color={C.mutedFg} weight={600}>
                                Sin publicar
                            </T>
                        </span>
                        <span style={{ marginLeft: 'auto', color: C.mutedFg, display: 'flex' }}>
                            <Undo2 size={10} />
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 7px', borderRadius: 5, border: `1px solid ${C.border}` }}>
                            <Link2 size={9} />
                            <T size={8} weight={600}>
                                Compartir
                            </T>
                        </span>
                        <span style={{ padding: '3px 8px', borderRadius: 5, background: primary() }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Guardar
                            </T>
                        </span>
                    </At>

                    {/* Izquierda: agregar */}
                    <At x={0} y={30} w={118} h={238} style={{ borderRight: `1px solid ${C.border}` }}>
                        <div style={{ display: 'flex', gap: 10, padding: '6px 8px 0', borderBottom: `1px solid ${C.border}` }}>
                            <span style={{ paddingBottom: 4, borderBottom: `2px solid ${primary()}` }}>
                                <T size={8} weight={700}>
                                    Agregar
                                </T>
                            </span>
                            <T size={8} color={C.mutedFg}>
                                Preguntas (4)
                            </T>
                        </div>
                        <At x={9} y={26}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                                CAMPOS DE LA LISTA
                            </T>
                        </At>
                    </At>
                    <SideItem y={70} icon={<Paperclip size={9} />} label="Adjuntos" />
                    <SideItem y={88} icon={<Tag size={9} />} label="Prioridad" a="fb-src" style={{ opacity: 0, background: primary(0.08) }} />
                    <At x={0} y={106} w={118} a="fb-shift" style={{ transform: 'translateY(-18px)' }}>
                        <SideItem y={0} icon={<Tag size={9} />} label="Canal" />
                    </At>
                    <At x={0} y={126} w={118} a="fb-shift" style={{ transform: 'translateY(-18px)' }}>
                        <At x={9} y={8}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                                CONTENIDO
                            </T>
                        </At>
                        <SideItem y={22} icon={<Heading2 size={9} />} label="Título de sección" />
                        <SideItem y={40} icon={<Type size={9} />} label="Texto o aclaración" />
                        <SideItem y={58} icon={<SeparatorHorizontal size={9} />} label="Salto de página" />
                    </At>

                    {/* Centro: vista previa */}
                    <At x={118} y={30} w={204} h={238} style={{ background: C.canvas }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `1px solid ${C.border}` }}>
                            <T size={6.5} color={C.mutedFg}>
                                Vista previa — toca una pregunta
                            </T>
                            <span style={{ display: 'flex', gap: 3, color: C.mutedFg }}>
                                <Monitor size={8} />
                                <Smartphone size={8} />
                            </span>
                        </div>
                        <At x={9} y={22} w={186} h={208} style={{ background: C.card, borderRadius: 7, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                            <div style={{ height: 3, background: primary() }} />
                            <At x={9} y={10}>
                                <T size={11} weight={800}>
                                    Soporte técnico
                                </T>
                            </At>
                            <At x={9} y={30}>
                                <T size={7.5} weight={700}>
                                    Asunto <span style={{ color: C.destructive }}>*</span>
                                </T>
                                <Input />
                            </At>
                            <At x={9} y={62}>
                                <T size={7.5} weight={700}>
                                    Email
                                </T>
                                <Input>
                                    <T size={7} color={C.mutedFg}>
                                        nombre@ejemplo.com
                                    </T>
                                </Input>
                            </At>
                            {/* La pregunta nueva */}
                            <At x={5} y={92} w={176} h={38} a="fb-newq" style={{ borderRadius: 5, padding: '3px 4px' }}>
                                <div data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 5, animationName: 'fb-sel', boxShadow: `0 0 0 1.5px ${primary()}` }} />
                                <T size={7.5} weight={700}>
                                    Prioridad{' '}
                                    <span data-a="" style={{ color: C.destructive, display: 'inline-block', animationName: 'fb-star' }}>
                                        *
                                    </span>
                                </T>
                                <div style={{ position: 'relative', height: 18 }}>
                                    <At x={0} y={0} a="fb-drop" style={{ opacity: 0 }}>
                                        <Input>
                                            <T size={7} color={C.mutedFg} style={{ flex: 1 }}>
                                                Elige una opción
                                            </T>
                                            <ChevronDown size={8} color={C.mutedFg} />
                                        </Input>
                                    </At>
                                    <At x={0} y={3} a="fb-btns" style={{ display: 'flex', gap: 4 }}>
                                        {(
                                            [
                                                ['Alta', 'rose'],
                                                ['Media', 'amber'],
                                                ['Baja', 'mint'],
                                            ] as const
                                        ).map(([l, t]) => (
                                            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3, height: 15, padding: '0 7px', borderRadius: 4, border: `1px solid ${C.border}` }}>
                                                <span style={{ width: 6, height: 6, borderRadius: 99, border: `1px solid ${tone(t)}` }} />
                                                <T size={7}>{l}</T>
                                            </span>
                                        ))}
                                    </At>
                                </div>
                            </At>
                            <At x={9} y={140} w={168} h={20} style={{ borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <T size={8} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </At>
                        </At>
                    </At>

                    {/* Derecha: ajustes del formulario (antes de elegir) */}
                    <At x={322} y={30} w={130} h={238} a="fb-settings" style={{ opacity: 0, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={9} weight={800}>
                            Ajustes del formulario
                        </T>
                        {['Nombre interno', 'Título', 'Descripción', 'Texto del botón'].map((l, i) => (
                            <div key={l} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <T size={7} weight={600} color={C.mutedFg}>
                                    {l}
                                </T>
                                <span style={{ height: i === 2 ? 24 : 14, borderRadius: 4, border: `1px solid ${C.border}` }} />
                            </div>
                        ))}
                        <Bar w={70} h={5} />
                    </At>
                    {/* Derecha: la pregunta elegida */}
                    <At x={322} y={30} w={130} h={238} a="fb-insp" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={9} weight={800}>
                            Prioridad
                        </T>
                        <T size={6.5} color={C.mutedFg}>
                            Se guarda en el campo «Prioridad»
                        </T>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={7} weight={600} color={C.mutedFg}>
                                Pregunta
                            </T>
                            <span style={{ height: 14, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 4px' }}>
                                <T size={7}>Prioridad</T>
                            </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <T size={7} weight={600} color={C.mutedFg}>
                                Cómo se elige
                            </T>
                            <span style={{ display: 'flex', padding: 2, borderRadius: 5, background: C.muted, gap: 2 }}>
                                {(['Automático', 'Botones', 'Lista'] as const).map((l) => (
                                    <span
                                        key={l}
                                        data-a={l === 'Lista' ? undefined : ''}
                                        style={{
                                            flex: 1,
                                            textAlign: 'center',
                                            fontSize: 6.5,
                                            fontWeight: 600,
                                            padding: '2px 0',
                                            borderRadius: 3,
                                            color: l === 'Botones' ? C.fg : C.mutedFg,
                                            background: l === 'Botones' ? C.card : 'transparent',
                                            animationName: l === 'Automático' ? 'fb-segA' : l === 'Botones' ? 'fb-segB' : undefined,
                                        }}
                                    >
                                        {l}
                                    </span>
                                ))}
                            </span>
                        </div>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                            <span
                                data-a=""
                                style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 3,
                                    border: `1.5px solid ${primary()}`,
                                    background: primary(),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    animationName: 'fb-check',
                                }}
                            >
                                <svg data-a="" width="7" height="7" viewBox="0 0 10 10" style={{ animationName: 'fb-tick' }}>
                                    <path d="M2 5.2l2 2L8 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </span>
                            <T size={7.5} weight={600}>
                                Obligatoria
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 10, height: 10, borderRadius: 3, border: `1.5px solid ${C.border}` }} />
                            <T size={7.5}>Oculta</T>
                        </span>
                        <T size={7} weight={600} color={C.mutedFg} style={{ marginTop: 4 }}>
                            Mostrar sólo si…
                        </T>
                        <span style={{ height: 14, borderRadius: 4, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={6.5} color={C.mutedFg}>
                                + Agregar una condición
                            </T>
                        </span>
                    </At>
                </Win>
                <Cursor a="fb-cursor" click="fb-ring" rest={[352, 153]} />
            </At>
        </Stage>
    );
}
