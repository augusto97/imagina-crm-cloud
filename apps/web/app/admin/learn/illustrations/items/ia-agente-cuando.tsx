import { Bot, Zap } from 'lucide-react';

import { At, C, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Cuándo trabaja un agente: una automatización («Cuando cambia un campo» →
 * «Pedirle a un agente») lo despierta. Cambia la etapa de la oportunidad a
 * Ganada, el pedido baja por la automatización y el agente deja su resumen en
 * la actividad del registro.
 */

const CSS = `
@keyframes iac-old{0%,14%{opacity:1}17%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes iac-new{0%,14%{opacity:0;transform:scale(.7)}18%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes iac-act1{0%,16%{opacity:0;transform:translateY(-4px)}20%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes iac-c1{0%,18%{box-shadow:0 0 0 0 transparent}22%,30%{box-shadow:0 0 0 3px ${primary(0.3)}}34%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes iac-dot{0%,28%{opacity:0;transform:translateY(0)}30%{opacity:1}40%{opacity:1;transform:translateY(34px)}42%,100%{opacity:0;transform:translateY(34px)}}
@keyframes iac-c2{0%,40%{box-shadow:0 0 0 0 transparent}43%,56%{box-shadow:0 0 0 3px ${tone('violet', 0.35)}}60%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes iac-work{0%,42%{opacity:0}45%,56%{opacity:1}59%,100%{opacity:0}}
@keyframes iac-note{0%,57%{opacity:0;transform:translateY(6px)}62%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
`;

export default function IaAgenteCuando(): JSX.Element {
    return (
        <Stage label="Cuándo trabaja un agente: una automatización con el disparador Cuando cambia un campo y la acción Pedirle a un agente. La oportunidad pasa a Ganada, la automatización le pide trabajo al agente Resumen al cerrar y su nota aparece en la actividad del registro." tint="violet">
            <Keyframes css={CSS} />

            {/* La automatización */}
            <Win x={14} y={30} w={214} h={240} title="Automatización">
                <At x={11} y={12} w={192} a="iac-c1" style={{ borderRadius: 10, border: `1px solid ${C.border}`, background: C.card, padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('amber'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Zap size={11} />
                        </span>
                        <T size={8.6} weight={700}>
                            Cuando cambia un campo
                        </T>
                    </span>
                    <T size={7.6} color={C.mutedFg}>
                        Campo: Etapa
                    </T>
                </At>
                {/* Conector */}
                <At x={106} y={66} w={2} h={34} style={{ background: C.border }} />
                <At x={102} y={64} w={10} h={10} a="iac-dot" style={{ opacity: 0, borderRadius: 99, background: primary() }} />
                <At x={11} y={100} w={192} a="iac-c2" style={{ borderRadius: 10, border: `1px solid ${tone('violet', 0.45)}`, background: tone('violet', 0.06), padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('violet'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Bot size={11} />
                        </span>
                        <T size={8.6} weight={700}>
                            Pedirle a un agente
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <T size={7.6} color={C.mutedFg}>
                            Agente:
                        </T>
                        <span style={{ height: 17, padding: '0 7px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, fontSize: 7.8, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Bot size={9} color={tone('violet')} /> Resumen al cerrar
                        </span>
                    </span>
                    <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Instrucción extra: sólo si la etapa es Ganada o Perdida.
                    </T>
                </At>
                <At x={11} y={196} w={192} a="iac-work" style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: tone('violet') }} />
                    <T size={7.6} weight={600} color={tone('violet')}>
                        El agente está leyendo la oportunidad…
                    </T>
                </At>
            </Win>

            {/* El registro */}
            <Win x={240} y={30} w={226} h={240} title="Plan anual · Café Bahía">
                <At x={11} y={12} w={204} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <T size={7.6} color={C.mutedFg} style={{ width: 46 }}>
                            Etapa
                        </T>
                        <span style={{ position: 'relative', display: 'block', width: 80, height: 16 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'iac-old' }}>
                                <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone('amber'), color: '#fff', fontSize: 8, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Negociación</span>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: 'iac-new' }}>
                                <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone('mint'), color: '#fff', fontSize: 8, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Ganada</span>
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <T size={7.6} color={C.mutedFg} style={{ width: 46 }}>
                            Monto
                        </T>
                        <T size={8.4} weight={600}>
                            $ 4.800.000
                        </T>
                    </span>
                </At>
                <At x={11} y={62} w={204} h={1} style={{ background: C.border }} />
                <At x={11} y={70} w={204} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Actividad
                    </T>
                    <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0, animationName: 'iac-act1' }}>
                        <span style={{ width: 16, height: 16, borderRadius: 99, background: tone('blue'), color: '#fff', fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>AM</span>
                        <T size={7.6}>Ana cambió Etapa a Ganada</T>
                    </span>
                    <span data-a="" style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: 0, animationName: 'iac-note', borderRadius: 9, background: tone('violet', 0.08), border: `1px solid ${tone('violet', 0.3)}`, padding: '7px 8px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Bot size={11} color={tone('violet')} />
                            <T size={7.6} weight={700}>
                                El agente «Resumen al cerrar» comentó
                            </T>
                        </span>
                        <T size={7.4} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                            Se ganó por el plan anual con 18 % de descuento. Decide Laura (compras). Próximo paso: primera entrega el 4 de noviembre.
                        </T>
                    </span>
                </At>
            </Win>
        </Stage>
    );
}
