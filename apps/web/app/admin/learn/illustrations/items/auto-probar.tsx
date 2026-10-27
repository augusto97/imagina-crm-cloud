import { CheckCircle2, FlaskConical, Hourglass, Mail, PenLine, Play } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Probar paso a paso»: se elige un registro real, se toca «Probar» y cada
 * paso muestra lo que HARÍA (el correo armado, la espera, el cambio de campo)
 * sin enviar ni cambiar nada.
 */

const STEPS = [
    { icon: <CheckCircle2 size={12} />, t: 'mint' as const, title: 'El disparador coincidiría', sub: 'Estado es Pendiente ✓', s: 20 },
    { icon: <Mail size={12} />, t: 'blue' as const, title: 'Paso 1 · Se enviaría un correo', sub: 'Para pagos@brisas.co · «Tu factura FAC-1042»', s: 34 },
    { icon: <Hourglass size={12} />, t: 'slate' as const, title: 'Paso 2 · Esperaría', sub: 'hasta el jueves 29/10 a las 09:00', s: 48 },
    { icon: <PenLine size={12} />, t: 'rose' as const, title: 'Paso 3 · Cambiaría un campo', sub: '', s: 62 },
];

const CSS = `
@keyframes apb-cur{0%{transform:translate(380px,290px);opacity:0}6%{opacity:1}12%,16%{transform:translate(424px,80px)}28%,90%{transform:translate(150px,200px);opacity:1}96%,100%{opacity:0;transform:translate(150px,200px)}}
@keyframes apb-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}20%,100%{opacity:0;transform:scale(1.6)}}
@keyframes apb-note{0%,72%{opacity:0;transform:translateY(6px)}78%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
${STEPS.map((st, i) => `@keyframes apb-s${i}{0%,${st.s}%{opacity:0;transform:translateY(8px)}${st.s + 5}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}`).join('\n')}
`;

export default function AutoProbar(): JSX.Element {
    return (
        <Stage label="El panel Probar paso a paso: con un registro real, cada paso muestra lo que haría la automatización, el correo que enviaría, hasta cuándo esperaría y qué campo cambiaría, sin enviar ni cambiar nada." tint="mint">
            <Keyframes css={CSS} />
            {/* El editor detrás, atenuado */}
            <At x={14} y={20} w={230} h={260} style={{ borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, opacity: 0.5, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Bar w={140} h={9} color={C.fg} style={{ opacity: 0.6 }} />
                <Bar w={180} h={6} />
                {[0, 1, 2, 3].map((k) => (
                    <span key={k} style={{ height: 38, borderRadius: 9, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 9px' }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: C.muted }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Bar w={40} h={4} />
                            <Bar w={110} h={6} color={C.border} />
                        </span>
                    </span>
                ))}
            </At>

            {/* El panel de prueba */}
            <At x={196} y={10} w={274} h={280} style={{ borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 20px 44px -18px rgba(15,23,42,.55)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FlaskConical size={13} color={primary()} />
                    <T size={10.5} weight={700}>
                        Probar paso a paso
                    </T>
                </span>
                <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    Con un registro real. No se envía, no se escribe ni se llama nada.
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                        <T size={8.2}>FAC-1042 · Hotel Brisas</T>
                    </span>
                    <span style={{ height: 22, padding: '0 10px', borderRadius: 6, background: primary(), color: C.primaryFg, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8.4, fontWeight: 700 }}>
                        <Play size={9} /> Probar
                    </span>
                </span>
                {STEPS.map((st, i) => (
                    <span key={st.title} data-a="" style={{ animationName: `apb-s${i}`, display: 'flex', gap: 7, borderRadius: 9, border: `1px solid ${C.border}`, padding: '6px 8px', background: i === 0 ? tone('mint', 0.08) : C.card }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: tone(st.t, 0.16), color: tone(st.t), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{st.icon}</span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <T size={8.4} weight={700}>
                                {st.title}
                            </T>
                            {st.sub !== '' ? (
                                <T size={7.4} color={C.mutedFg}>
                                    {st.sub}
                                </T>
                            ) : (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <T size={7.4} color={C.mutedFg}>
                                        Estado:
                                    </T>
                                    <span style={{ height: 13, padding: '0 5px', borderRadius: 4, background: tone('amber'), color: '#fff', fontSize: 7.2, fontWeight: 600, display: 'inline-flex', alignItems: 'center', textDecoration: 'line-through' }}>Pendiente</span>
                                    <T size={7.4} color={C.mutedFg}>
                                        →
                                    </T>
                                    <span style={{ height: 13, padding: '0 5px', borderRadius: 4, background: tone('rose'), color: '#fff', fontSize: 7.2, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Vencida</span>
                                </span>
                            )}
                        </span>
                    </span>
                ))}
                <span data-a="" style={{ animationName: 'apb-note', display: 'flex', justifyContent: 'center' }}>
                    <T size={7.6} weight={600} color={tone('mint')}>
                        ✓ Simulación: no se envió ni se cambió nada
                    </T>
                </span>
            </At>
            <Cursor a="apb-cur" click="apb-ring" rest={[150, 200]} />
        </Stage>
    );
}
