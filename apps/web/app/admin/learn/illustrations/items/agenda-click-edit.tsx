import { MousePointer2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Tocar una parte de la agenda para editarla: el puntero toca los horarios
 * en la vista previa, a la derecha aparece el panel de «Fecha y hora» con
 * «Contenido / Estilo» y los horarios toman el color elegido.
 */

const CSS = `
@keyframes ace-cursor{0%,6%{transform:translate(150px,240px)}22%,40%{transform:translate(196px,170px)}44%{transform:translate(196px,170px) scale(.85)}48%,62%{transform:translate(196px,170px)}78%,100%{transform:translate(352px,190px)}}
@keyframes ace-sel{0%,42%{opacity:0}46%,94%{opacity:1}100%{opacity:0}}
@keyframes ace-panel{0%,44%{opacity:0;transform:translateX(10px)}50%,94%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes ace-slot{0%,74%{background:hsl(var(--imcrm-card))}80%,94%{background:#fde68a}100%{background:hsl(var(--imcrm-card))}}
@keyframes ace-swatch{0%,74%{background:hsl(var(--imcrm-card))}80%,94%{background:#fde68a}100%{background:hsl(var(--imcrm-card))}}
`;

const DAYS = ['3', '4', '5', '6', '7', '10', '11', '12', '13', '14'];

export default function AgendaClickEdit(): JSX.Element {
    return (
        <Stage label="En la vista previa de la agenda se tocan los horarios: a la derecha aparece el panel de «Fecha y hora» con las pestañas Contenido y Estilo, y los horarios toman el color elegido." tint="rose">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.3 }}>
                {/* Vista previa de la agenda */}
                <At x={20} y={30} w={270} h={240} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'block', height: 5, background: primary() }} />
                    <span style={{ display: 'block', padding: '10px 12px' }}>
                        <T size={13} weight={800}>
                            Agenda tu cita
                        </T>
                        <span style={{ display: 'block', marginTop: 3 }}>
                            <T size={7} color={C.mutedFg}>
                                Corte de cabello · 40 min
                            </T>
                        </span>
                        <span style={{ display: 'block', marginTop: 8 }}>
                            <T size={8} weight={700}>
                                Elige el día y la hora
                            </T>
                        </span>
                        <span style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                            <span style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 18px)', gap: 3 }}>
                                {DAYS.map((d) => (
                                    <span
                                        key={d}
                                        style={{
                                            height: 18,
                                            borderRadius: 4,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: d === '5' ? primary() : 'transparent',
                                        }}
                                    >
                                        <T size={7} weight={d === '5' ? 700 : 400} color={d === '5' ? '#fff' : undefined}>
                                            {d}
                                        </T>
                                    </span>
                                ))}
                            </span>
                            <span style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1 }}>
                                {['9:00', '9:40', '10:20', '11:00', '11:40', '15:00'].map((h) => (
                                    <span
                                        key={h}
                                        data-a=""
                                        style={{ padding: '4px 0', textAlign: 'center', borderRadius: 5, border: `1px solid ${primary()}`, animationName: 'ace-slot' }}
                                    >
                                        <T size={7} weight={600}>
                                            {h}
                                        </T>
                                    </span>
                                ))}
                                <span data-a="" style={{ position: 'absolute', inset: -4, borderRadius: 7, border: `2px solid ${primary()}`, animationName: 'ace-sel' }} />
                            </span>
                        </span>
                    </span>
                </At>

                {/* Panel de «Fecha y hora» */}
                <At
                    x={302}
                    y={30}
                    w={160}
                    h={240}
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}
                >
                    <span data-a="" style={{ display: 'block', animationName: 'ace-panel' }}>
                        <T size={10} weight={700}>
                            Fecha y hora
                        </T>
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
                                COLORES
                            </T>
                        </span>
                        {[
                            ['Día elegido (fondo)', primary(), false],
                            ['Horarios (fondo)', '', true],
                            ['Horarios (borde)', primary(), false],
                        ].map(([label, color, anim]) => (
                            <span key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                                <span
                                    data-a={anim ? '' : undefined}
                                    style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: 4,
                                        border: `1px solid ${C.border}`,
                                        background: anim ? undefined : String(color),
                                        animationName: anim ? 'ace-swatch' : undefined,
                                    }}
                                />
                                <T size={7} color={C.mutedFg}>
                                    {String(label)}
                                </T>
                            </span>
                        ))}
                        <span style={{ display: 'block', marginTop: 12 }}>
                            <T size={6} weight={700} color={C.mutedFg}>
                                TEXTO EN LA PÁGINA
                            </T>
                        </span>
                        <span style={{ display: 'block', marginTop: 4, padding: '4px 6px', borderRadius: 4, border: `1px solid ${C.border}` }}>
                            <T size={7}>Elige el día y la hora</T>
                        </span>
                    </span>
                </At>

                <span data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: 'ace-cursor' }}>
                    <MousePointer2 size={16} color="#111827" fill="#fff" />
                </span>
            </div>
        </Stage>
    );
}
