import { Sparkles } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Un «Campo con IA» de tipo Clasificar: lee el asunto y el mensaje de cada
 * ticket y elige una de tus opciones (Alta, Media, Baja). Se completa solo al
 * llegar cada registro, y se recalcula si cambian los campos que lee.
 */

type Tn = 'rose' | 'amber' | 'slate';
const ROWS: Array<{ a: string; m: string; p: string; t: Tn }> = [
    { a: 'No puedo entrar a mi cuenta', m: 'Desde ayer me sale error y tengo que…', p: 'Alta', t: 'rose' },
    { a: 'Cambio de dirección de envío', m: 'Me mudé y quiero que el próximo pedido…', p: 'Media', t: 'amber' },
    { a: 'Cobro duplicado en la tarjeta', m: 'Me cobraron dos veces la factura…', p: 'Alta', t: 'rose' },
    { a: 'Duda sobre el plan anual', m: '¿El plan anual incluye las capacitaciones…', p: 'Baja', t: 'slate' },
];
const AT = [14, 30, 46, 62];

const CSS = `
@keyframes iac-sh{0%{background-position:-120px 0}100%{background-position:120px 0}}
${AT.map((s, i) => `@keyframes iac-w${i}{0%,${s - 8}%{opacity:0}${s - 6}%,${s}%{opacity:1}${s + 2}%,100%{opacity:0}}
@keyframes iac-v${i}{0%,${s}%{opacity:0;transform:scale(.7)}${s + 4}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes iac-r${i}{0%,${s}%{background:transparent}${s + 2}%{background:${primary(0.1)}}${s + 12}%,100%{background:transparent}}`).join('\n')}
`;

export default function IaCampo(): JSX.Element {
    return (
        <Stage label="Un campo con IA que clasifica: lee el asunto y el mensaje de cada ticket y elige su prioridad entre Alta, Media y Baja, sin que nadie la escriba." tint="violet">
            <Keyframes css={CSS} />
            {/* La configuración del campo */}
            <At x={14} y={40} w={136} style={{ borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)', padding: '10px 11px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: tone('violet'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Sparkles size={12} />
                    </span>
                    <T size={9.2} weight={700}>
                        Campo con IA
                    </T>
                </span>
                {[
                    ['Qué hace', 'Clasificar'],
                    ['Lee de estos campos', 'Asunto · Mensaje'],
                ].map(([k, v]) => (
                    <span key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={7} color={C.mutedFg}>
                            {k}
                        </T>
                        <span style={{ height: 20, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <T size={8} weight={600}>
                                {v}
                            </T>
                        </span>
                    </span>
                ))}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={7} color={C.mutedFg}>
                        Opciones (una por renglón)
                    </T>
                    <span style={{ display: 'flex', gap: 3 }}>
                        {(['Alta', 'Media', 'Baja'] as const).map((o, i) => (
                            <span key={o} style={{ height: 16, padding: '0 6px', borderRadius: 5, background: tone((['rose', 'amber', 'slate'] as const)[i]!), color: '#fff', fontSize: 7.8, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{o}</span>
                        ))}
                    </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 11, height: 11, borderRadius: 3, background: primary(), color: C.primaryFg, fontSize: 7, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
                    <T size={7.2} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                        Recalcular solo cuando cambian
                    </T>
                </span>
            </At>

            {/* La tabla */}
            <Win x={160} y={30} w={306} h={232} title="Tickets">
                <At x={0} y={0} w={306} h={24} style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}`, background: C.muted }}>
                    <T size={7.4} weight={700} color={C.mutedFg} style={{ flex: 1 }}>
                        Asunto
                    </T>
                    <span style={{ width: 76, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Sparkles size={9} color={tone('violet')} />
                        <T size={7.4} weight={700} color={C.mutedFg}>
                            Prioridad
                        </T>
                    </span>
                </At>
                {ROWS.map((r, i) => (
                    <At key={r.a} x={0} y={24 + i * 45} w={306} h={45} a={`iac-r${i}`} style={{ display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: i < 3 ? `1px solid ${C.border}` : undefined }}>
                        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                            <T size={8.6} weight={600}>
                                {r.a}
                            </T>
                            <T size={7.4} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r.m}
                            </T>
                        </span>
                        <span style={{ position: 'relative', width: 76, height: 16 }}>
                            <span
                                data-a=""
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 2,
                                    width: 50,
                                    height: 12,
                                    borderRadius: 4,
                                    opacity: 0,
                                    background: `linear-gradient(90deg, ${tone('violet', 0.12)}, ${tone('violet', 0.35)}, ${tone('violet', 0.12)})`,
                                    backgroundSize: '120px 12px',
                                    animationName: `iac-w${i}`,
                                }}
                            />
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 3, animationName: `iac-v${i}` }}>
                                <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone(r.t), color: '#fff', fontSize: 8.4, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{r.p}</span>
                            </span>
                        </span>
                    </At>
                ))}
            </Win>
            <At x={160} y={270} w={306} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8} color={C.mutedFg}>
                    Nadie la escribe: la IA la completa al llegar cada ticket.
                </T>
            </At>
        </Stage>
    );
}
