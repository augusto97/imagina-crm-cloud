import { CalendarClock, CheckCircle2, PackageCheck, Receipt } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Flow, IconSquare, Keyframes, Stage, T, primary } from '../kit';

/**
 * Conectar una vez, usar en muchas automatizaciones: la conexión de WhatsApp
 * queda guardada (con su clave cifrada) y tres automatizaciones distintas la
 * eligen. Al final la tarjeta cuenta cuántas acciones la usan.
 */

const AUTOS = [
    { y: 32, title: 'Recordatorio de pago', sub: 'Cuando vence una factura', icon: <Receipt size={13} />, t: 'amber' as const },
    { y: 118, title: 'Cita confirmada', sub: 'Cuando se agenda una cita', icon: <CalendarClock size={13} />, t: 'violet' as const },
    { y: 204, title: 'Pedido enviado', sub: 'Cuando cambia el estado', icon: <PackageCheck size={13} />, t: 'blue' as const },
];

const CSS = `
${AUTOS.map(
    (_, i) => `
@keyframes ic-card${i}{0%,${10 + i * 18}%{opacity:.35;transform:translateX(10px)}${16 + i * 18}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:.35;transform:translateX(10px)}}
@keyframes ic-flow${i}{0%,${10 + i * 18}%{opacity:0}${15 + i * 18}%,92%{opacity:1}96%,100%{opacity:0}}
@keyframes ic-chip${i}{0%,${14 + i * 18}%{opacity:0;transform:scale(.6)}${19 + i * 18}%,92%{opacity:1;transform:scale(1)}96%,100%{opacity:0;transform:scale(.6)}}`,
).join('')}
@keyframes ic-use{0%,62%{opacity:0;transform:translateY(5px)}68%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ic-key{0%,4%{opacity:0;transform:scale(.6)}9%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

export default function IntegConnectOnce(): JSX.Element {
    return (
        <Stage label="Una sola conexión de WhatsApp, guardada una vez, la usan tres automatizaciones distintas: recordatorio de pago, cita confirmada y pedido enviado." tint="mint">
            <Keyframes css={CSS} />
            {AUTOS.map((a, i) => (
                <At key={`f${a.title}`} x={0} y={0} a={`ic-flow${i}`} style={{ opacity: 1 }}>
                    <Flow x1={200} y1={150} x2={262} y2={a.y + 32} />
                </At>
            ))}

            {/* La conexión */}
            <At
                x={24}
                y={80}
                w={176}
                h={140}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 14,
                    padding: 14,
                    boxShadow: '0 14px 34px -16px rgba(15,23,42,.5)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <IntegrationLogo integrationKey="whatsapp" size={34} />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <T size={11} weight={700}>
                            WhatsApp (WAS)
                        </T>
                        <T size={8.5} color={C.mutedFg}>
                            +57 300 555 0101
                        </T>
                    </span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                        data-a=""
                        style={{
                            animationName: 'ic-key',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            height: 18,
                            padding: '0 7px',
                            borderRadius: 99,
                            background: C.muted,
                            fontSize: 8.5,
                            fontWeight: 600,
                            color: C.mutedFg,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        🔒 ••••8f2a
                    </span>
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            height: 18,
                            padding: '0 7px',
                            borderRadius: 99,
                            background: 'hsl(var(--imcrm-success) / .14)',
                            color: C.success,
                            fontSize: 8.5,
                            fontWeight: 700,
                        }}
                    >
                        Conectada
                    </span>
                </span>
                <At x={14} y={96} w={150} a="ic-use" style={{ opacity: 1 }}>
                    <T size={9} weight={600} color={primary()} style={{ whiteSpace: 'normal', display: 'block' }}>
                        La usan 3 acciones de automatización.
                    </T>
                </At>
            </At>

            {AUTOS.map((a, i) => (
                <At
                    key={a.title}
                    x={262}
                    y={a.y}
                    w={196}
                    h={64}
                    a={`ic-card${i}`}
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: '9px 11px',
                        boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <IconSquare t={a.t} size={20}>
                            {a.icon}
                        </IconSquare>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <T size={10} weight={700}>
                                {a.title}
                            </T>
                            <T size={8} color={C.mutedFg}>
                                {a.sub}
                            </T>
                        </span>
                    </span>
                    <span
                        data-a=""
                        style={{
                            animationName: `ic-chip${i}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            alignSelf: 'flex-start',
                            height: 18,
                            padding: '0 7px 0 3px',
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            fontSize: 8.5,
                            fontWeight: 600,
                        }}
                    >
                        <IntegrationLogo integrationKey="whatsapp" size={13} />
                        Enviar mensaje de WhatsApp
                        <CheckCircle2 size={10} color="hsl(var(--imcrm-success))" />
                    </span>
                </At>
            ))}
        </Stage>
    );
}
