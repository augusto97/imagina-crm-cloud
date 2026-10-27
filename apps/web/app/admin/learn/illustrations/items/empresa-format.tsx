import { Clock, Globe } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Formato regional: al pasar a «punto para miles, coma decimal», fechas
 * DD/MM/AAAA y 12 horas, la misma factura se lee como en Colombia, y la zona
 * horaria de la empresa decide a qué hora corre «todos los días a las 8».
 */

const CSS = `
@keyframes efm-a{0%,28%{opacity:1}34%,90%{opacity:0}97%,100%{opacity:1}}
@keyframes efm-b{0%,28%{opacity:0;transform:translateY(4px)}34%,90%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes efm-flash{0%,28%{background:transparent}34%,46%{background:${primary(0.1)}}60%,100%{background:transparent}}
@keyframes efm-hand{0%,48%{transform:rotate(-60deg)}62%,90%{transform:rotate(0deg)}100%{transform:rotate(-60deg)}}
@keyframes efm-tz{0%,48%{opacity:0;transform:translateX(-8px)}58%,90%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
`;

function Swap({ a, b, w, strong }: { a: string; b: string; w: number; strong?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'grid', width: w }}>
            <span
                data-a=""
                style={{
                    gridArea: '1 / 1',
                    display: 'flex',
                    opacity: 0,
                    animationName: 'efm-a',
                }}
            >
                <T size={9.5} weight={strong ? 700 : 500} color={C.mutedFg}>
                    {a}
                </T>
            </span>
            <span
                data-a=""
                style={{
                    gridArea: '1 / 1',
                    display: 'flex',
                    animationName: 'efm-b',
                }}
            >
                <T size={9.5} weight={strong ? 700 : 600}>
                    {b}
                </T>
            </span>
        </span>
    );
}

function SettingRow({ label, a, b }: { label: string; a: string; b: string }): JSX.Element {
    return (
        <div
            data-a=""
            style={{
                display: 'flex',
                alignItems: 'center',
                height: 30,
                borderBottom: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: '0 6px',
                animationName: 'efm-flash',
            }}
        >
            <T size={9} color={C.mutedFg} style={{ width: 62 }}>
                {label}
            </T>
            <span
                style={{
                    flex: 1,
                    height: 20,
                    border: `1px solid ${C.border}`,
                    borderRadius: 5,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                }}
            >
                <Swap a={a} b={b} w={140} />
            </span>
        </div>
    );
}

export default function EmpresaFormat(): JSX.Element {
    return (
        <Stage
            label="En Formato regional se elige punto para los miles y coma para los decimales, fechas DD/MM/AAAA y 12 horas, y la zona horaria de Bogotá: la misma factura pasa a leerse como en Colombia."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <Win x={16} y={20} w={230} h={160} title="Ajustes · Formato regional">
                <At x={6} y={6} w={218}>
                    <SettingRow label="Números" a="1,234,567.89" b="1.234.567,89" />
                    <SettingRow label="Fecha" a="AAAA-MM-DD" b="DD/MM/AAAA" />
                    <SettingRow label="Hora" a="24 horas (14:30)" b="12 horas (2:30 p. m.)" />
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: 30,
                            padding: '0 6px',
                        }}
                    >
                        <T size={9} color={C.mutedFg} style={{ width: 62 }}>
                            Zona horaria
                        </T>
                        <span
                            style={{
                                flex: 1,
                                height: 20,
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '0 6px',
                            }}
                        >
                            <Globe size={10} color={primary()} />
                            <T size={9.5} weight={600}>
                                America/Bogota
                            </T>
                        </span>
                    </div>
                </At>
            </Win>

            {/* Reloj de la empresa */}
            <At
                x={262}
                y={20}
                w={202}
                h={160}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)',
                }}
            >
                <span
                    style={{
                        position: 'relative',
                        width: 70,
                        height: 70,
                        borderRadius: 99,
                        border: `3px solid ${C.border}`,
                        background: tone('amber', 0.06),
                    }}
                >
                    {Array.from({ length: 12 }).map((_, i) => (
                        <span
                            key={i}
                            style={{
                                position: 'absolute',
                                left: 33,
                                top: 3,
                                width: 1.5,
                                height: 5,
                                background: C.mutedFg,
                                transformOrigin: '0.75px 30px',
                                transform: `rotate(${i * 30}deg)`,
                                opacity: 0.6,
                            }}
                        />
                    ))}
                    <span
                        style={{
                            position: 'absolute',
                            left: 33,
                            top: 18,
                            width: 3,
                            height: 17,
                            borderRadius: 2,
                            background: C.fg,
                            transformOrigin: '1.5px 17px',
                            transform: 'rotate(240deg)',
                        }}
                    />
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 33.5,
                            top: 10,
                            width: 2,
                            height: 25,
                            borderRadius: 2,
                            background: primary(),
                            transformOrigin: '1px 25px',
                            animationName: 'efm-hand',
                        }}
                    />
                    <span
                        style={{
                            position: 'absolute',
                            left: 30,
                            top: 31,
                            width: 8,
                            height: 8,
                            borderRadius: 99,
                            background: C.fg,
                        }}
                    />
                </span>
                <span
                    data-a=""
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 3,
                        animationName: 'efm-tz',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={10} color={primary()} />
                        <T size={9.5} weight={700}>
                            Todos los días a las 8:00
                        </T>
                    </span>
                    <T size={8} color={C.mutedFg}>
                        a la hora de Colombia (Bogotá)
                    </T>
                </span>
            </At>

            {/* La factura */}
            <Win x={16} y={194} w={448} h={86} title="Facturas">
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 24,
                        padding: '0 10px',
                        borderBottom: `1px solid ${C.border}`,
                        gap: 10,
                    }}
                >
                    {['Factura', 'Total', 'Vence', 'Enviada'].map((h, i) => (
                        <T key={h} size={8.5} weight={700} color={C.mutedFg} style={{ width: [80, 120, 100, 120][i] }}>
                            {h}
                        </T>
                    ))}
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: 32,
                        padding: '0 10px',
                        gap: 10,
                    }}
                >
                    <span style={{ width: 80 }}>
                        <Chip label="FAC-1042" t="blue" />
                    </span>
                    <span style={{ width: 120 }}>
                        <Swap a="$ 1,250,000.00" b="$ 1.250.000,00" w={120} strong />
                    </span>
                    <span style={{ width: 100 }}>
                        <Swap a="2026-12-31" b="31/12/2026" w={100} />
                    </span>
                    <span style={{ width: 120 }}>
                        <Swap a="14:30" b="2:30 p. m." w={120} />
                    </span>
                </div>
            </Win>
        </Stage>
    );
}
