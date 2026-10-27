import { Mail, Server, ShieldCheck, Sparkles } from 'lucide-react';

import { At, C, Flow, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Cómo salen los correos de la empresa: por el correo de la plataforma (con
 * cuota mensual), por la cuenta de Google o Microsoft de la empresa, o por su
 * propio servidor. La barra de «Correos este mes» sólo cuenta los primeros.
 */

const CSS = `
@keyframes cn-sel{0%,8%{transform:translateY(0)}14%,40%{transform:translateY(0)}46%,92%{transform:translateY(64px)}97%,100%{transform:translateY(64px)}}
@keyframes cn-bar{0%,10%{width:12%}38%,100%{width:64%}}
@keyframes cn-dot{0%,10%{opacity:0;transform:translateX(0)}12%{opacity:1}36%{opacity:1;transform:translateX(118px)}38%,100%{opacity:0;transform:translateX(118px)}}
@keyframes cn-quota{0%,44%{opacity:1}50%,100%{opacity:.35}}
@keyframes cn-free{0%,48%{opacity:0;transform:translateY(4px)}54%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
`;

const ROUTES = [
    { title: 'Correo de la plataforma', sub: 'Sin configurar nada · con cuota del plan', icon: <Mail size={13} />, t: 'slate' as const },
    { title: 'Tu cuenta de Google o Microsoft', sub: 'Recomendado · sale desde tu dirección', icon: <ShieldCheck size={13} />, t: 'blue' as const, rec: true },
    { title: 'Tu servidor SMTP', sub: 'El de tu hosting o proveedor de correo', icon: <Server size={13} />, t: 'violet' as const },
];

export default function CorreoEnvio(): JSX.Element {
    return (
        <Stage label="Los correos salen por una de tres formas: el correo de la plataforma, que cuenta para la cuota mensual del plan; la cuenta de Google o Microsoft de la empresa; o su propio servidor de correo. Con las dos últimas no hay cuota de la plataforma." tint="cyan">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={18} y={16} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={12} color={primary()} />
                    <T size={10.5} weight={700}>
                        Cómo salen los correos de tu empresa
                    </T>
                </At>
                {ROUTES.map((r, i) => (
                    <At key={r.title} x={18} y={44 + i * 64} w={226} h={54} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, display: 'flex', alignItems: 'center', gap: 9, padding: '0 11px', boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}>
                        <IconSquare t={r.t} size={26}>
                            {r.icon}
                        </IconSquare>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <T size={9} weight={700}>
                                {r.title}
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                {r.sub}
                            </T>
                        </span>
                    </At>
                ))}
                {/* Marco de la forma elegida */}
                <At x={15} y={41} w={232} h={60} a="cn-sel" style={{ borderRadius: 13, border: `2px solid ${primary()}`, transform: 'translateY(64px)' }}>
                    <span style={{ position: 'absolute', right: 8, top: -9, height: 16, padding: '0 6px', borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center' }}>
                        <T size={7} weight={700} color={C.primaryFg}>
                            En uso
                        </T>
                    </span>
                </At>

                {/* Cuota del plan */}
                <At x={266} y={44} w={198} h={118} a="cn-quota" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 11, boxShadow: '0 12px 26px -16px rgba(15,23,42,.45)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                        PLAN Y USO
                    </T>
                    <span style={{ display: 'flex', alignItems: 'baseline' }}>
                        <T size={9} weight={700}>
                            Correos este mes
                        </T>
                        <T size={8} weight={600} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                            640 de 1.000
                        </T>
                    </span>
                    <span style={{ position: 'relative', height: 8, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '64%', borderRadius: 99, background: tone('cyan'), animationName: 'cn-bar' }} />
                    </span>
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Cuenta cada destinatario. Incluye automatizaciones y accesos al portal.
                    </T>
                </At>
                <At x={128} y={70} a="cn-dot" style={{ opacity: 0 }}>
                    <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: tone('cyan'), boxShadow: `0 0 0 4px ${tone('cyan', 0.2)}` }} />
                </At>
                <Flow x1={244} y1={136} x2={266} y2={196} a="cn-free" />

                {/* Con cuenta o servidor propio */}
                <At x={266} y={180} w={198} a="cn-free" style={{ background: tone('mint', 0.12), border: `1px solid ${tone('mint', 0.4)}`, borderRadius: 12, padding: 11, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <T size={9} weight={700} color={tone('mint')}>
                        Sin cuota de la plataforma
                    </T>
                    <T size={7.5} style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>
                        Sale desde ventas@cafeaurora.co. Rigen los límites de tu proveedor: Gmail ~500 al día, Google Workspace 2.000.
                    </T>
                </At>
            </div>
        </Stage>
    );
}
