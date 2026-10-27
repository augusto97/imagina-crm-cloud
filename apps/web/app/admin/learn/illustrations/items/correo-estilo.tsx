import { ChevronDown, Palette, Type } from 'lucide-react';

import { At, C, Keyframes, Stage, T } from '../kit';

/**
 * «Estilo general»: se cambia el color de acento y la fuente de los títulos,
 * y el correo entero cambia a la vez (botón, banda, títulos).
 */

const INK = '#1f2937';
const SOFT = '#6b7280';

type Look = { accent: string; font: string; family: string; weight: number };
const LOOKS: Look[] = [
    { accent: '#0e7490', font: 'Inter', family: 'Inter, system-ui, sans-serif', weight: 800 },
    { accent: '#7c3aed', font: 'Playfair Display', family: 'Georgia, "Times New Roman", serif', weight: 700 },
    { accent: '#c2410c', font: 'Montserrat', family: 'Verdana, Tahoma, sans-serif', weight: 800 },
];

// Cada estilo se ve un tercio del ciclo; el último queda como cuadro final.
const CSS = `
@keyframes cs-l0{0%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes cs-l1{0%,30%{opacity:0}34%,63%{opacity:1}67%,100%{opacity:0}}
@keyframes cs-l2{0%,63%{opacity:0}67%,100%{opacity:1}}
@keyframes cs-ring{0%,30%{transform:translateX(0)}34%,63%{transform:translateX(24px)}67%,100%{transform:translateX(48px)}}
`;

function Mail({ look }: { look: Look }): JSX.Element {
    return (
        <div style={{ position: 'absolute', inset: 0, background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ height: 34, background: look.accent, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 7 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: 'rgba(255,255,255,.9)' }} />
                <span style={{ fontFamily: look.family, fontWeight: 700, fontSize: 10, color: '#fff' }}>Café Aurora</span>
            </div>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: look.family, fontWeight: look.weight, fontSize: 15, lineHeight: 1.2, color: INK }}>Bienvenida a Café Aurora</span>
                <span style={{ fontSize: 8, lineHeight: 1.5, color: SOFT }}>Gracias por unirte, Ana. Cada mes te enviamos el café de origen recién tostado y las novedades del club.</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 6, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                    {[
                        ['Plan', 'Club mensual'],
                        ['Primer envío', '15 de noviembre'],
                    ].map(([k, v]) => (
                        <span key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 7.5, color: SOFT }}>{k}</span>
                            <span style={{ fontSize: 7.5, fontWeight: 700, color: INK }}>{v}</span>
                        </span>
                    ))}
                </span>
                <span style={{ alignSelf: 'center', padding: '6px 18px', borderRadius: 6, background: look.accent, color: '#fff', fontSize: 8.5, fontWeight: 700 }}>Ver mi suscripción</span>
                <span style={{ fontSize: 7.5, color: look.accent, fontWeight: 600, alignSelf: 'center' }}>¿Preguntas? Escríbenos</span>
            </div>
        </div>
    );
}

export default function CorreoEstilo(): JSX.Element {
    return (
        <Stage label="En «Estilo general» se cambia el color de acento y la fuente de los títulos: el botón, la banda, los enlaces y los títulos del correo cambian a la vez." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={16} y={20} w={172} h={260} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 11, boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <T size={10} weight={700}>
                        Estilo general
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Palette size={11} color={C.mutedFg} />
                        <T size={8} weight={700}>
                            Colores
                        </T>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Acento (botones y enlaces)
                    </T>
                    <span style={{ position: 'relative', display: 'flex', gap: 6, height: 20, alignItems: 'center' }}>
                        {LOOKS.map((l) => (
                            <span key={l.accent} style={{ width: 18, height: 18, borderRadius: 99, background: l.accent }} />
                        ))}
                        <span style={{ width: 18, height: 18, borderRadius: 99, background: '#15803d' }} />
                        <span data-a="" style={{ position: 'absolute', left: -3, top: -2, width: 24, height: 24, borderRadius: 99, border: `2px solid ${C.fg}`, transform: 'translateX(48px)', animationName: 'cs-ring' }} />
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7.5} color={C.mutedFg}>
                            Fondo del correo
                        </T>
                        <span style={{ width: 14, height: 14, borderRadius: 4, border: `1px solid ${C.border}`, background: '#fff' }} />
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                        <Type size={11} color={C.mutedFg} />
                        <T size={8} weight={700}>
                            Texto
                        </T>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Fuente de los títulos
                    </T>
                    <span style={{ height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                        <span style={{ display: 'inline-grid' }}>
                            {LOOKS.map((l, i) => (
                                <span key={l.font} data-a="" style={{ gridArea: '1/1', fontFamily: l.family, fontWeight: 700, fontSize: 9, color: C.fg, opacity: i === 2 ? 1 : 0, animationName: `cs-l${i}` }}>
                                    {l.font}
                                </span>
                            ))}
                        </span>
                        <ChevronDown size={10} color={C.mutedFg} style={{ marginLeft: 'auto' }} />
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7.5} color={C.mutedFg}>
                            Tamaño del texto
                        </T>
                        <T size={7.5} weight={600}>
                            15 px
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={7.5} color={C.mutedFg}>
                            Esquinas
                        </T>
                        <T size={7.5} weight={600}>
                            8 px
                        </T>
                    </span>
                </At>

                <At x={206} y={20} w={258} h={260} style={{ borderRadius: 12, background: C.muted, border: `1px solid ${C.border}`, padding: 12 }}>
                    <div style={{ position: 'relative', height: '100%', boxShadow: '0 8px 20px -10px rgba(15,23,42,.4)', borderRadius: 8 }}>
                        {LOOKS.map((l, i) => (
                            <div key={l.font} data-a="" style={{ position: 'absolute', inset: 0, opacity: i === 2 ? 1 : 0, animationName: `cs-l${i}` }}>
                                <Mail look={l} />
                            </div>
                        ))}
                    </div>
                </At>
            </div>
        </Stage>
    );
}
