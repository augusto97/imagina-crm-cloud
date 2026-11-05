import { Eye, EyeOff, MousePointer2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Tocar cualquier parte del formulario para editarla: el puntero toca el
 * título en la vista previa, a la derecha aparece su panel con «Contenido /
 * Estilo», el color del título cambia y, con el ojo, se oculta.
 */

const CSS = `
@keyframes fce-cursor{0%,6%{transform:translate(150px,170px)}22%,40%{transform:translate(58px,62px)}44%{transform:translate(58px,62px) scale(.85)}48%,62%{transform:translate(58px,62px)}78%,100%{transform:translate(388px,128px)}}
@keyframes fce-sel{0%,42%{opacity:0}46%,94%{opacity:1}100%{opacity:0}}
@keyframes fce-panel{0%,44%{opacity:0;transform:translateX(10px)}50%,94%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes fce-color{0%,60%{color:hsl(var(--imcrm-foreground))}66%,94%{color:#7c3aed}100%{color:hsl(var(--imcrm-foreground))}}
@keyframes fce-swatch{0%,60%{background:hsl(var(--imcrm-foreground))}66%,94%{background:#7c3aed}100%{background:hsl(var(--imcrm-foreground))}}
@keyframes fce-hide{0%,80%{opacity:1}84%,92%{opacity:.18}96%,100%{opacity:1}}
@keyframes fce-eye{0%,80%{opacity:1}84%,92%{opacity:0}96%,100%{opacity:1}}
@keyframes fce-eyeoff{0%,80%{opacity:0}84%,92%{opacity:1}96%,100%{opacity:0}}
`;

export default function FormClickEdit(): JSX.Element {
    return (
        <Stage label="En la vista previa del formulario se toca el título: a la derecha aparece su panel con las pestañas Contenido y Estilo; el título cambia de color y, con el ojo, se oculta." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                {/* Vista previa */}
                <At x={20} y={36} w={250} h={228} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'block', height: 5, background: primary() }} />
                    <span style={{ display: 'block', padding: '12px 14px' }}>
                        <span data-a="" style={{ position: 'relative', display: 'inline-block', animationName: 'fce-hide' }}>
                            <span data-a="" style={{ fontSize: 15, fontWeight: 800, animationName: 'fce-color' }}>
                                Contáctanos
                            </span>
                            <span
                                data-a=""
                                style={{ position: 'absolute', inset: -4, borderRadius: 6, border: `2px solid ${primary()}`, animationName: 'fce-sel' }}
                            />
                        </span>
                        <span style={{ display: 'block', marginTop: 6 }}>
                            <T size={7} color={C.mutedFg}>
                                Te respondemos en menos de un día.
                            </T>
                        </span>
                        {['Nombre', 'Correo', 'Mensaje'].map((l) => (
                            <span key={l} style={{ display: 'block', marginTop: 9 }}>
                                <T size={7} weight={600}>
                                    {l}
                                </T>
                                <span style={{ display: 'block', marginTop: 3, height: l === 'Mensaje' ? 26 : 14, borderRadius: 4, border: `1px solid ${C.border}` }} />
                            </span>
                        ))}
                        <span style={{ display: 'inline-block', marginTop: 10, padding: '4px 12px', borderRadius: 5, background: primary(), color: '#fff' }}>
                            <T size={7} weight={700} color="#fff">
                                Enviar
                            </T>
                        </span>
                    </span>
                </At>

                {/* Panel del título */}
                <At
                    x={286}
                    y={36}
                    w={176}
                    h={228}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <span data-a="" style={{ display: 'block', animationName: 'fce-panel' }}>
                        <T size={10} weight={700}>
                            Título
                        </T>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '5px 7px', borderRadius: 6, border: `1px solid ${C.border}` }}>
                            <span style={{ position: 'relative', width: 10, height: 10 }}>
                                <span data-a="" style={{ position: 'absolute', inset: 0, animationName: 'fce-eye' }}>
                                    <Eye size={10} color={primary()} />
                                </span>
                                <span data-a="" style={{ position: 'absolute', inset: 0, animationName: 'fce-eyeoff' }}>
                                    <EyeOff size={10} color={C.mutedFg} />
                                </span>
                            </span>
                            <T size={7} weight={600}>
                                Mostrar el título
                            </T>
                        </span>
                        <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, marginTop: 8, padding: 2, borderRadius: 6, background: C.muted }}>
                            <span style={{ textAlign: 'center', padding: '3px 0' }}>
                                <T size={7} color={C.mutedFg}>
                                    Contenido
                                </T>
                            </span>
                            <span style={{ textAlign: 'center', padding: '3px 0', borderRadius: 4, background: C.card }}>
                                <T size={7} weight={700}>
                                    Estilo
                                </T>
                            </span>
                        </span>
                        <span style={{ display: 'block', marginTop: 10 }}>
                            <T size={6} weight={700} color={C.mutedFg}>
                                TAMAÑO Y GROSOR
                            </T>
                        </span>
                        <span style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                            <span style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: `1px solid ${C.border}` }}>
                                <T size={7}>28 px</T>
                            </span>
                            <span style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: `1px solid ${C.border}` }}>
                                <T size={7}>Negrita</T>
                            </span>
                        </span>
                        <span style={{ display: 'block', marginTop: 10 }}>
                            <T size={6} weight={700} color={C.mutedFg}>
                                COLOR
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <span data-a="" style={{ width: 16, height: 16, borderRadius: 4, animationName: 'fce-swatch' }} />
                            <T size={7} color={C.mutedFg}>
                                Título
                            </T>
                        </span>
                    </span>
                </At>

                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'fce-cursor' }}>
                    <MousePointer2 size={16} color="#111827" fill="#fff" />
                </span>
            </div>
        </Stage>
    );
}
