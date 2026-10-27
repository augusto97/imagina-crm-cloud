import { Key, Sparkles } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Asistente IA de la plataforma: la clave del operador, «Compartir la clave»
 * (las empresas la usan con la cuota de su plan) y «Permitir claves propias»
 * (cada empresa paga la suya, sin cuota).
 */

const CSS = `
@keyframes pai-t1{0%,14%{left:2px}20%,92%{left:14px}100%{left:2px}}
@keyframes pai-t2{0%,34%{left:2px}40%,92%{left:14px}100%{left:2px}}
@keyframes pai-tr1{0%,14%{background:${C.border}}20%,92%{background:${primary()}}100%{background:${C.border}}}
@keyframes pai-tr2{0%,34%{background:${C.border}}40%,92%{background:${primary()}}100%{background:${C.border}}}
@keyframes pai-q{0%,20%{width:0}60%,92%{width:46%}100%{width:0}}
@keyframes pai-e1{0%,18%{opacity:.4}24%,92%{opacity:1}100%{opacity:.4}}
@keyframes pai-e2{0%,38%{opacity:.4}44%,92%{opacity:1}100%{opacity:.4}}
`;

function Toggle({ track, knob }: { track: string; knob: string }): JSX.Element {
    return (
        <span
            data-a=""
            style={{
                position: 'relative',
                width: 26,
                height: 14,
                borderRadius: 99,
                background: primary(),
                flexShrink: 0,
                animationName: track,
            }}
        >
            <span
                data-a=""
                style={{
                    position: 'absolute',
                    top: 2,
                    left: 14,
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.3)',
                    animationName: knob,
                }}
            />
        </span>
    );
}

export default function PlatAi(): JSX.Element {
    return (
        <Stage
            label="En Plataforma, Asistente IA, el operador guarda su clave y elige cómo lo usan las empresas: compartiendo la clave con la cuota mensual de cada plan, o permitiendo que cada empresa cargue la suya sin cuota."
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={20}
                w={250}
                h={260}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={13} color={tone('amber')} />
                    <T size={11} weight={700} style={{ flex: 1 }}>
                        Asistente IA
                    </T>
                    <span
                        style={{
                            height: 16,
                            padding: '0 7px',
                            borderRadius: 99,
                            background: 'hsl(var(--imcrm-success) / .14)',
                            color: C.success,
                            fontSize: 8,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Activo
                    </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.5} weight={600}>
                        Clave de la plataforma
                    </T>
                    <span
                        style={{
                            height: 22,
                            border: `1px solid ${C.border}`,
                            borderRadius: 5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '0 7px',
                        }}
                    >
                        <Key size={10} color={C.mutedFg} />
                        <T size={8.5}>Clave guardada · ••••7Q2a</T>
                    </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={8.5} weight={600}>
                        Modelo por defecto
                    </T>
                    <span
                        style={{
                            height: 22,
                            border: `1px solid ${C.border}`,
                            borderRadius: 5,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 7px',
                        }}
                    >
                        <T size={8.5}>Siempre el más reciente (se actualiza solo)</T>
                    </span>
                </span>
                <T size={8.5} weight={700} style={{ marginTop: 4 }}>
                    Cómo lo usan las empresas
                </T>
                <span style={{ display: 'flex', gap: 8 }}>
                    <Toggle track="pai-tr1" knob="pai-t1" />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8.5} weight={600}>
                            Compartir la clave de la plataforma
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                            Con la cuota mensual de su plan (columna IA/mes).
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                    <Toggle track="pai-tr2" knob="pai-t2" />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8.5} weight={600}>
                            Permitir claves propias por empresa
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                            Sin cuota, a su cargo.
                        </T>
                    </span>
                </span>
            </At>

            {/* Dos empresas */}
            <At x={278} y={40} w={188} a="pai-e1">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 11,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                    }}
                >
                    <T size={9.5} weight={700}>
                        Café Aurora · plan Pro
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Usa la clave de la plataforma
                    </T>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={8}>Pedidos este mes</T>
                        <T size={8} weight={700}>
                            230 de 500
                        </T>
                    </span>
                    <span
                        style={{
                            height: 6,
                            borderRadius: 99,
                            background: C.muted,
                            overflow: 'hidden',
                        }}
                    >
                        <span
                            data-a=""
                            style={{
                                display: 'block',
                                height: '100%',
                                width: '46%',
                                background: primary(),
                                animationName: 'pai-q',
                            }}
                        />
                    </span>
                </div>
            </At>
            <At x={278} y={150} w={188} a="pai-e2">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 11,
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                    }}
                >
                    <T size={9.5} weight={700}>
                        Colegio Andino · Enterprise
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Key size={10} color={tone('violet')} />
                        <T size={8} color={C.mutedFg}>
                            Clave propia · ••••x91F
                        </T>
                    </span>
                    <span
                        style={{
                            height: 18,
                            alignSelf: 'flex-start',
                            padding: '0 7px',
                            borderRadius: 99,
                            background: tone('violet', 0.14),
                            color: tone('violet'),
                            fontSize: 8,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Sin cuota · la paga la empresa
                    </span>
                </div>
            </At>
        </Stage>
    );
}
