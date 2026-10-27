import { CreditCard, Download, Lock } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Plan y suscripción: el uso contra los límites del plan, y la línea de
 * tiempo del período pagado → 5 días de gracia → solo-lectura (con
 * exportar siempre disponible). Al pagar 3 meses, el período se extiende.
 */

const CSS = `
@keyframes epl-mark{0%,6%{left:30px}50%,92%{left:340px}100%{left:30px}}
@keyframes epl-ro{0%,40%{opacity:0}46%,62%{opacity:1}70%,100%{opacity:0}}
@keyframes epl-paid{0%,62%{width:150px;border-radius:99px 0 0 99px}72%,92%{width:402px;border-radius:99px}100%{width:150px;border-radius:99px 0 0 99px}}
@keyframes epl-cursor{0%{transform:translate(460px,290px);opacity:0}8%{opacity:1}54%,60%{transform:translate(400px,146px)}78%,88%{transform:translate(444px,186px);opacity:1}95%,100%{opacity:0;transform:translate(444px,186px)}}
@keyframes epl-ring{0%,56%{opacity:0;transform:scale(.4)}58%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.6)}}
@keyframes epl-h1{0%,62%{opacity:1}68%,92%{opacity:0}100%{opacity:1}}
@keyframes epl-h2{0%,62%{opacity:0}68%,92%{opacity:1}100%{opacity:0}}
`;

function Usage({ label, used, max, pct, t }: { label: string; used: string; max: string; pct: number; t?: 'amber' }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <T size={8.5} weight={600}>
                    {label}
                </T>
                <T size={8.5} color={t ? tone(t) : C.mutedFg} weight={t ? 700 : 500}>
                    {used} de {max}
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
                    style={{
                        display: 'block',
                        width: `${pct}%`,
                        height: '100%',
                        background: t ? tone(t) : primary(),
                    }}
                />
            </span>
        </span>
    );
}

export default function EmpresaPlan(): JSX.Element {
    return (
        <Stage
            label="Plan y uso: las barras muestran cuánto se usa de cada límite. La línea de tiempo pasa del período pagado a cinco días de gracia y luego a solo-lectura, donde exportar sigue disponible; al pagar tres meses el período se extiende y todo vuelve a la normalidad."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={14}
                w={448}
                h={92}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={11} weight={700}>
                        Plan y uso
                    </T>
                    <span
                        style={{
                            height: 17,
                            padding: '0 7px',
                            borderRadius: 99,
                            background: primary(0.12),
                            color: primary(),
                            fontSize: 8.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Pro
                    </span>
                </span>
                <span style={{ display: 'flex', gap: 18 }}>
                    <Usage label="Registros" used="3.420" max="5.000" pct={68} />
                    <Usage label="Usuarios" used="9" max="10" pct={90} t="amber" />
                </span>
                <span style={{ display: 'flex', gap: 18 }}>
                    <Usage label="Correos este mes" used="640" max="1.000" pct={64} />
                    <Usage label="Almacenamiento" used="1,2 GB" max="5 GB" pct={24} />
                </span>
            </At>

            {/* Suscripción */}
            <At
                x={16}
                y={118}
                w={448}
                h={166}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                }}
            >
                <span
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span style={{ position: 'relative', width: 260, height: 30 }}>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                opacity: 0,
                                animationName: 'epl-h1',
                            }}
                        >
                            <T size={10.5} weight={700}>
                                Pagado hasta el 31/10/2026
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                Después: 5 días de gracia y luego solo-lectura.
                            </T>
                        </span>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                animationName: 'epl-h2',
                            }}
                        >
                            <T size={10.5} weight={700}>
                                Pagado hasta el 31/01/2027
                            </T>
                            <T size={8.5} color={C.success} weight={600}>
                                Se sumaron 3 meses al período.
                            </T>
                        </span>
                    </span>
                    <Btn
                        label={
                            <>
                                <CreditCard size={10} /> Pagar 3 meses
                            </>
                        }
                    />
                </span>

                {/* Línea de tiempo */}
                <div style={{ position: 'relative', height: 62, marginTop: 14 }}>
                    <span
                        style={{
                            position: 'absolute',
                            left: 226,
                            top: 16,
                            width: 196,
                            height: 18,
                            borderRadius: '0 99px 99px 0',
                            background: C.muted,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 4,
                        }}
                    >
                        <Lock size={10} color={C.mutedFg} />
                        <T size={8} weight={700} color={C.mutedFg}>
                            Solo-lectura
                        </T>
                    </span>
                    <span
                        style={{
                            position: 'absolute',
                            left: 170,
                            top: 16,
                            width: 56,
                            height: 18,
                            background: tone('amber', 0.55),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <T size={7.5} weight={700} color={C.fg}>
                            Gracia
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 20,
                            top: 16,
                            width: 402,
                            height: 18,
                            borderRadius: 99,
                            // Opaco: al extenderse tapa la gracia y el solo-lectura.
                            background: `color-mix(in srgb, ${tone('mint')} 55%, ${C.card})`,
                            animationName: 'epl-paid',
                        }}
                    />
                    <span style={{ position: 'absolute', left: 20, top: 40 }}>
                        <T size={8} color={C.mutedFg}>
                            Pagado
                        </T>
                    </span>
                    <span style={{ position: 'absolute', left: 166, top: 40 }}>
                        <T size={8} color={C.mutedFg}>
                            5 días
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 340,
                            top: 6,
                            width: 2,
                            height: 38,
                            background: C.fg,
                            borderRadius: 2,
                            animationName: 'epl-mark',
                        }}
                    >
                        <span
                            style={{
                                position: 'absolute',
                                left: -9,
                                top: -10,
                                fontSize: 7.5,
                                fontWeight: 700,
                                color: C.fg,
                            }}
                        >
                            Hoy
                        </span>
                    </span>
                </div>
                <span
                    data-a=""
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '7px 10px',
                        borderRadius: 8,
                        background: C.muted,
                        opacity: 0,
                        animationName: 'epl-ro',
                    }}
                >
                    <Lock size={12} color={C.mutedFg} />
                    <T size={8.5} style={{ flex: 1, whiteSpace: 'normal' }}>
                        Tus datos están intactos y se pueden consultar y exportar.
                    </T>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontSize: 8.5,
                            fontWeight: 700,
                            color: primary(),
                        }}
                    >
                        <Download size={10} /> Exportar
                    </span>
                </span>
            </At>
            <Cursor a="epl-cursor" click="epl-ring" rest={[444, 186]} />
        </Stage>
    );
}
