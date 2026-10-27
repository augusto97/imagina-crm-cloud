import { Check, KeyRound, Lock, Sparkles } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Las dos formas de pagar la IA: la clave de la plataforma (con la cuota de
 * pedidos del plan) o una clave propia de la empresa (sin cuota). Abajo, qué
 * le llega al proveedor.
 */

const CSS = `
@keyframes ick-meter{0%,8%{transform:scaleX(0)}40%,92%{transform:scaleX(.62)}100%{transform:scaleX(0)}}
@keyframes ick-n0{0%,24%{opacity:1}26%,100%{opacity:0}}
@keyframes ick-n1{0%,24%{opacity:0}26%,94%{opacity:1}100%{opacity:0}}
@keyframes ick-key{0%,44%{width:0}62%,100%{width:84px}}
@keyframes ick-ok{0%,62%{opacity:0;transform:scale(.7)}67%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Card({ x, title, sub, icon, t, children }: { x: number; title: string; sub: string; icon: JSX.Element; t: 'blue' | 'violet'; children: JSX.Element }): JSX.Element {
    return (
        <At x={x} y={18} w={216} h={144} style={{ borderRadius: 13, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 28px -18px rgba(15,23,42,.5)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: tone(t), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={9.6} weight={700}>
                        {title}
                    </T>
                    <T size={7.4} color={C.mutedFg}>
                        {sub}
                    </T>
                </span>
            </span>
            {children}
        </At>
    );
}

const ROWS: Array<[string, boolean]> = [
    ['Nombres de listas y campos, tipos y opciones', true],
    ['Lo que escriben en el chat', true],
    ['Registros: sólo los que necesita para responder o trabajar, con tus permisos', true],
    ['Contraseñas, claves y secretos de tus conexiones', false],
];

export default function IaClave(): JSX.Element {
    return (
        <Stage label="Las dos formas de usar la IA: la clave de la plataforma con la cuota de pedidos del plan, o una clave propia de la empresa sin cuota; abajo, qué información le llega al proveedor." tint="violet">
            <Keyframes css={CSS} />
            <Card x={14} title="Clave de la plataforma" sub="Incluida en tu plan" icon={<Sparkles size={14} />} t="blue">
                <>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <T size={7.6} color={C.mutedFg}>
                            Pedidos este mes
                        </T>
                        <span style={{ position: 'relative', display: 'block', width: 60, height: 14 }}>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', opacity: 0, animationName: 'ick-n0' }}>
                                <T size={9} weight={700}>
                                    0 de 100
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'ick-n1' }}>
                                <T size={9} weight={700}>
                                    62 de 100
                                </T>
                            </span>
                        </span>
                    </span>
                    <span style={{ position: 'relative', display: 'block', height: 8, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <span data-a="" style={{ position: 'absolute', inset: 0, background: tone('blue'), transformOrigin: '0 50%', transform: 'scaleX(.62)', animationName: 'ick-meter' }} />
                    </span>
                    <T size={7.6} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Cada mensaje al asistente, cada campo con IA que se calcula y cada corrida de un agente cuenta. El mes siguiente vuelve a cero.
                    </T>
                </>
            </Card>
            <Card x={250} title="Clave propia de la empresa" sub="Ajustes → Asistente IA" icon={<KeyRound size={14} />} t="violet">
                <>
                    <span style={{ height: 24, borderRadius: 6, border: `1px solid ${primary(0.5)}`, display: 'flex', alignItems: 'center', gap: 5, padding: '0 7px' }}>
                        <Lock size={10} color={C.mutedFg} />
                        <span data-a="" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', width: 84, animationName: 'ick-key' }}>
                            <T size={8.2} style={{ fontFamily: 'ui-monospace, monospace' }}>
                                sk-ant-…8f2c
                            </T>
                        </span>
                    </span>
                    <span data-a="" style={{ animationName: 'ick-ok', display: 'flex', alignItems: 'center', gap: 5, borderRadius: 7, background: tone('mint', 0.12), padding: '5px 8px' }}>
                        <Check size={11} color={tone('mint')} />
                        <T size={7.8} weight={700} color={tone('mint')}>
                            Sin límite mensual de pedidos
                        </T>
                    </span>
                    <T size={7.6} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Se guarda cifrada y nunca se vuelve a mostrar. Además puedes elegir el nivel de esfuerzo.
                    </T>
                </>
            </Card>
            {/* Privacidad */}
            <At x={14} y={174} w={452} h={108} style={{ borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, padding: '11px 14px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <T size={7.4} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    Qué le llega al proveedor de IA
                </T>
                {ROWS.map(([l, ok]) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 13, height: 13, borderRadius: 99, background: ok ? tone('mint', 0.18) : tone('rose', 0.16), color: ok ? tone('mint') : tone('rose'), fontSize: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{ok ? '✓' : '✕'}</span>
                        <T size={8}>{l}</T>
                    </span>
                ))}
            </At>
        </Stage>
    );
}
