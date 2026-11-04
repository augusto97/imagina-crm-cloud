import { CalendarDays, Coffee, MousePointerClick, X, Zap } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * v0.1.352 — Insertar como botón flotante o ventana: la página del sitio se ve
 * sin el formulario; recién al tocar el botón se abre la ventana y se carga.
 */

const CSS = `
@keyframes ep-cursor{0%{transform:translate(240px,300px);opacity:0}6%{opacity:1}24%,33%{transform:translate(388px,259px);opacity:1}44%,100%{transform:translate(388px,259px);opacity:0}}
@keyframes ep-ring{0%,29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}36%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ep-btn{0%,29%{transform:scale(1)}31%{transform:scale(.92)}34%,100%{transform:scale(1)}}
@keyframes ep-hint{0%,8%{opacity:0;transform:translateY(4px)}12%,27%{opacity:1;transform:translateY(0)}31%,100%{opacity:0}}
@keyframes ep-ov{0%,31%{opacity:0}37%,88%{opacity:1}94%,100%{opacity:0}}
@keyframes ep-pop{0%,31%{opacity:0;transform:translateY(12px) scale(.96)}38%,88%{opacity:1;transform:translateY(0) scale(1)}94%,100%{opacity:0;transform:translateY(8px) scale(.98)}}
@keyframes ep-skel{0%,38%{opacity:1}46%,100%{opacity:0}}
@keyframes ep-fields{0%,44%{opacity:0}52%,88%{opacity:1}94%,100%{opacity:0}}
@keyframes ep-light{0%,52%{opacity:0;transform:translateY(6px)}58%,88%{opacity:1;transform:translateY(0)}94%,100%{opacity:0}}
`;

export default function EmbedPopup(): JSX.Element {
    return (
        <Stage
            label="Un sitio web con un botón flotante «Agenda tu cita». Mientras nadie lo toca, el formulario no se carga; al tocarlo se abre una ventana sobre la página con el formulario."
            tint="cyan"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <Win x={20} y={16} w={440} h={268} title="cafeaurora.co">
                    {/* Cabecera del sitio */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Coffee size={10} />
                        </span>
                        <T size={8.5} weight={800}>
                            Café Aurora
                        </T>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                            {['Menú', 'Cursos', 'Contacto'].map((l) => (
                                <T key={l} size={7} color={C.mutedFg}>
                                    {l}
                                </T>
                            ))}
                        </span>
                    </div>
                    {/* Contenido de la página */}
                    <At x={16} y={40} w={200} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={13} weight={800} style={{ whiteSpace: 'normal', lineHeight: 1.15 }}>
                            Cursos de barismo en Medellín
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Aprende a preparar el café perfecto con nuestro equipo.
                        </T>
                        <Bar w={180} h={5} />
                        <Bar w={150} h={5} />
                        <Bar w={168} h={5} />
                        <Bar w={120} h={5} />
                    </At>
                    <At x={238} y={40} w={186} h={112} style={{ borderRadius: 10, background: `linear-gradient(135deg, ${tone('amber', 0.35)}, ${tone('rose', 0.25)})` }} />
                    <At x={16} y={170} w={408} style={{ display: 'flex', gap: 10 }}>
                        {[0, 1, 2].map((i) => (
                            <span key={i} style={{ flex: 1, height: 46, borderRadius: 8, border: `1px solid ${C.border}`, background: C.muted, opacity: 0.6 }} />
                        ))}
                    </At>

                    {/* Aviso: nada se carga todavía */}
                    <At x={206} y={196} a="ep-hint" style={{ opacity: 0, zIndex: 4 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -8px rgba(15,23,42,.35)' }}>
                            <MousePointerClick size={9} color={C.mutedFg} />
                            <T size={7} weight={600} color={C.mutedFg}>
                                El formulario se carga al tocar el botón
                            </T>
                        </span>
                    </At>

                    {/* Botón flotante */}
                    <At x={322} y={208} a="ep-btn" style={{ zIndex: 3 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 13px', borderRadius: 99, background: primary(), boxShadow: `0 10px 22px -8px ${primary(0.7)}` }}>
                            <CalendarDays size={10} color={C.primaryFg} />
                            <T size={8} weight={700} color={C.primaryFg}>
                                Agenda tu cita
                            </T>
                        </span>
                    </At>

                    {/* La ventana sobre la página */}
                    <At x={0} y={0} w={440} h={242} a="ep-ov" style={{ background: 'rgba(15,23,42,.45)', zIndex: 5 }} />
                    <At
                        x={126}
                        y={14}
                        w={188}
                        h={214}
                        a="ep-pop"
                        style={{ zIndex: 6, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 24px 50px -18px rgba(15,23,42,.6)', overflow: 'hidden' }}
                    >
                        <div style={{ height: 3, background: primary() }} />
                        <span style={{ position: 'absolute', right: 8, top: 9, width: 16, height: 16, borderRadius: 99, background: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <X size={9} color={C.mutedFg} />
                        </span>
                        {/* Mientras carga */}
                        <At x={12} y={16} w={164} a="ep-skel" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 9 }}>
                            <Bar w={110} h={8} />
                            {[0, 1, 2].map((i) => (
                                <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <Bar w={50} h={5} />
                                    <Bar w={164} h={15} style={{ borderRadius: 4 }} />
                                </span>
                            ))}
                        </At>
                        {/* El formulario */}
                        <At x={12} y={14} w={164} a="ep-fields" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <T size={9.5} weight={800}>
                                Reserva tu cupo
                            </T>
                            {['Nombre', 'Celular', 'Curso'].map((l) => (
                                <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <T size={7} weight={700}>
                                        {l}
                                    </T>
                                    <span style={{ height: 15, borderRadius: 4, border: `1px solid ${C.border}` }} />
                                </span>
                            ))}
                            <span style={{ marginTop: 3, height: 19, borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <T size={8} weight={700} color={C.primaryFg}>
                                    Enviar
                                </T>
                            </span>
                        </At>
                    </At>
                </Win>
                <At x={146} y={264} a="ep-light" style={{ zIndex: 7 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -8px rgba(15,23,42,.4)' }}>
                        <Zap size={10} color={tone('mint')} />
                        <T size={7.5} weight={700}>
                            Liviano aunque tu sitio tenga muchas visitas
                        </T>
                    </span>
                </At>
                <Cursor a="ep-cursor" click="ep-ring" rest={[388, 259]} />
            </At>
        </Stage>
    );
}
