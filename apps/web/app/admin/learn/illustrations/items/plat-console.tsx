import { Activity, Building2, CreditCard, DatabaseBackup, Globe, Mail, Megaphone, Plug, RefreshCw, Sparkles, Users, Wallet } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La consola de plataforma del operador: cifras de toda la instalación
 * arriba, las secciones a la izquierda y la grilla de empresas.
 */

const CSS = `
@keyframes pco-sel{0%,30%{transform:translateY(0)}36%,62%{transform:translateY(20px)}68%,92%{transform:translateY(40px)}98%,100%{transform:translateY(0)}}
@keyframes pco-tile{0%{opacity:0;transform:translateY(6px)}10%,100%{opacity:1;transform:translateY(0)}}
@keyframes pco-row{0%,6%{opacity:0;transform:translateX(-6px)}14%,100%{opacity:1;transform:translateX(0)}}
@keyframes pco-pulse{0%,40%,100%{box-shadow:0 0 0 0 transparent}46%,56%{box-shadow:0 0 0 3px ${tone('amber', 0.35)}}}
`;

const TABS: Array<[string, JSX.Element]> = [
    ['Empresas', <Building2 key="a" size={11} />],
    ['Usuarios', <Users key="b" size={11} />],
    ['Planes', <CreditCard key="c" size={11} />],
    ['Cobros', <Wallet key="d" size={11} />],
    ['Correo (SMTP)', <Mail key="e" size={11} />],
    ['Diagnóstico', <Activity key="f" size={11} />],
    ['Dominios', <Globe key="g" size={11} />],
    ['Asistente IA', <Sparkles key="h" size={11} />],
    ['Integraciones', <Plug key="i" size={11} />],
    ['Novedades', <Megaphone key="j" size={11} />],
    ['Actualizaciones', <RefreshCw key="k" size={11} />],
    ['Copias de seguridad', <DatabaseBackup key="l" size={11} />],
];

function Tile({ label, value, sub, t, i }: { label: string; value: string; sub: string; t?: 'amber'; i: number }): JSX.Element {
    return (
        <span
            data-a=""
            style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                border: `1px solid ${C.border}`,
                borderRadius: 9,
                padding: '7px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                animationName: t ? 'pco-tile, pco-pulse' : 'pco-tile',
                animationDelay: `${i * 0.12}s, 0s`,
            }}
        >
            <T size={7.5} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <T size={14} weight={700} color={t ? tone(t) : C.fg}>
                {value}
            </T>
            <T size={7} color={C.mutedFg}>
                {sub}
            </T>
        </span>
    );
}

export default function PlatConsole(): JSX.Element {
    return (
        <Stage
            label="La consola de plataforma del operador: cifras de todas las empresas arriba (activas, impagas, usuarios y registros), las secciones a la izquierda y la grilla de empresas con su plan y su estado."
            tint="slate"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={14}
                w={452}
                h={272}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    display: 'flex',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                {/* Secciones */}
                <div
                    style={{
                        width: 118,
                        borderRight: `1px solid ${C.border}`,
                        padding: '10px 6px',
                        position: 'relative',
                        background: C.muted,
                    }}
                >
                    <T
                        size={8}
                        weight={700}
                        color={C.mutedFg}
                        style={{
                            display: 'block',
                            padding: '0 6px 6px',
                            textTransform: 'uppercase',
                            letterSpacing: '.05em',
                        }}
                    >
                        Plataforma
                    </T>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 6,
                            right: 6,
                            top: 30,
                            height: 19,
                            borderRadius: 5,
                            background: C.card,
                            boxShadow: '0 1px 2px rgba(15,23,42,.12)',
                            animationName: 'pco-sel',
                        }}
                    />
                    {TABS.map(([l, icon]) => (
                        <span
                            key={l}
                            style={{
                                position: 'relative',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                height: 19,
                                padding: '0 6px',
                                marginBottom: 1,
                                color: C.mutedFg,
                            }}
                        >
                            <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
                            <T size={8.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {l}
                            </T>
                        </span>
                    ))}
                </div>
                {/* Panel */}
                <div
                    style={{
                        flex: 1,
                        minWidth: 0,
                        padding: 11,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 9,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <T size={12} weight={700}>
                            Plataforma
                        </T>
                        <span
                            style={{
                                height: 15,
                                padding: '0 6px',
                                borderRadius: 99,
                                background: primary(0.12),
                                color: primary(),
                                fontSize: 7.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            Superadmin
                        </span>
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                        <Tile i={0} label="Empresas" value="54" sub="6 nuevas (30 días)" />
                        <Tile i={1} label="Activas" value="41" sub="10 en prueba" />
                        <Tile i={2} label="Impagas" value="3" sub="1 en solo-lectura" t="amber" />
                        <Tile i={3} label="Usuarios" value="312" sub="cuentas" />
                    </span>
                    <div
                        style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            overflow: 'hidden',
                        }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                height: 22,
                                alignItems: 'center',
                                padding: '0 9px',
                                background: C.muted,
                                gap: 6,
                            }}
                        >
                            {['Empresa', 'Plan', 'Estado', 'Uso'].map((h, i) => (
                                <T key={h} size={8} weight={700} color={C.mutedFg} style={{ width: [104, 54, 66, 80][i] }}>
                                    {h}
                                </T>
                            ))}
                        </div>
                        {(
                            [
                                ['Café Aurora', 'Pro', 'Activa', 'mint', '3.420 reg.'],
                                ['Clínica Norte', 'Starter', 'Activa', 'mint', '980 reg.'],
                                ['Ferretería El Sol', 'Pro', 'Impaga', 'amber', '12.104 reg.'],
                                ['Agencia Rumbo', 'Trial', 'En prueba', 'blue', '86 reg.'],
                                ['Colegio Andino', 'Enterprise', 'Activa', 'mint', '48.300 reg.'],
                            ] as const
                        ).map(([n, p, s, t, u], i) => (
                            <div
                                key={n}
                                data-a=""
                                style={{
                                    display: 'flex',
                                    height: 26,
                                    alignItems: 'center',
                                    padding: '0 9px',
                                    gap: 6,
                                    borderTop: `1px solid ${C.border}`,
                                    animationName: 'pco-row',
                                    animationDelay: `${0.4 + i * 0.1}s`,
                                }}
                            >
                                <T size={9} weight={600} style={{ width: 104 }}>
                                    {n}
                                </T>
                                <T size={8.5} color={C.mutedFg} style={{ width: 54 }}>
                                    {p}
                                </T>
                                <span style={{ width: 66 }}>
                                    <Chip label={s} t={t} />
                                </span>
                                <T size={8.5} color={C.mutedFg} style={{ width: 80 }}>
                                    {u}
                                </T>
                            </div>
                        ))}
                    </div>
                </div>
            </At>
        </Stage>
    );
}
