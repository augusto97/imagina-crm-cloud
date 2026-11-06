import { CheckCircle2, Copy, ShieldAlert, ShieldCheck } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Btn, C, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/**
 * v0.1.384 — Cuando Google Workspace bloquea la app: Google muestra «Acceso
 * bloqueado», la persona copia el mensaje con el ID de cliente para su
 * administrador, él la marca como «De confianza» en admin.google.com y la
 * persona vuelve a conectar.
 */

const CSS = `
@keyframes gwa-s1{0%,26%{opacity:1;transform:scale(1)}31%,96%{opacity:0;transform:scale(.96)}100%{opacity:1;transform:scale(1)}}
@keyframes gwa-s2{0%,27%{opacity:0;transform:translateY(10px)}32%,58%{opacity:1;transform:translateY(0)}63%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes gwa-s3{0%,59%{opacity:0;transform:translateY(10px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes gwa-cur{0%{transform:translate(420px,270px);opacity:0}8%{opacity:1}18%,24%{transform:translate(262px,206px)}36%{transform:translate(176px,140px)}44%,52%{transform:translate(176px,140px)}66%{transform:translate(306px,184px)}74%,82%{transform:translate(306px,184px)}90%,100%{transform:translate(430px,280px);opacity:0}}
@keyframes gwa-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}45%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%{opacity:0;transform:scale(1.6)}75%{opacity:0;transform:scale(.4)}77%{opacity:1;transform:scale(1)}81%,100%{opacity:0;transform:scale(1.6)}}
@keyframes gwa-copied{0%,47%{opacity:0}49%,58%{opacity:1}60%,100%{opacity:0}}
`;

function Steps(): JSX.Element {
    const items = ['Google dice «Acceso bloqueado»', 'Le mandas el mensaje a TI', 'La marca de confianza y conectas'];
    return (
        <At x={20} y={258} w={440} style={{ display: 'flex', justifyContent: 'space-between' }}>
            {items.map((s, i) => (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                        style={{
                            width: 15,
                            height: 15,
                            borderRadius: 99,
                            background: tone('blue', 0.16),
                            color: tone('blue'),
                            fontSize: 8.5,
                            fontWeight: 800,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {i + 1}
                    </span>
                    <T size={8.5} weight={600} color={C.mutedFg}>
                        {s}
                    </T>
                </span>
            ))}
        </At>
    );
}

export default function GoogleWorkspaceAdmin(): JSX.Element {
    return (
        <Stage
            label="Google Workspace bloquea la app: Google muestra «Acceso bloqueado», copias el mensaje con el ID de cliente para tu administrador, él la marca como de confianza en la consola de Google y vuelves a conectar Google Calendar."
            tint="blue"
        >
            <Keyframes css={CSS} />

            {/* 1 — La pantalla de Google */}
            <Win x={100} y={24} w={280} h={218} title="accounts.google.com" a="gwa-s1">
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldAlert size={15} color={tone('rose')} />
                        <T size={11.5} weight={700}>
                            Acceso bloqueado
                        </T>
                    </span>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        El administrador de tu organización no permite que esta app acceda a tu cuenta de Google.
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 7, borderRadius: 8, border: `1px solid ${C.border}` }}>
                        <IntegrationLogo integrationKey="google_calendar" size={22} />
                        <T size={9} weight={600}>
                            Google Calendar
                        </T>
                    </span>
                    <T size={8} color={C.mutedFg}>
                        Error 400: admin_policy_enforced
                    </T>
                </div>
            </Win>

            {/* 2 — El mensaje para el administrador */}
            <Win x={70} y={20} w={340} h={226} title="Si Google Workspace bloquea la app" a="gwa-s2" style={{ opacity: 0 }}>
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <T size={9} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Tu administrador la marca como de confianza una sola vez para toda la organización. Mándale este mensaje:
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Btn
                            label={
                                <>
                                    <Copy size={10} />
                                    Copiar mensaje para tu administrador
                                </>
                            }
                        />
                        <span data-a="" style={{ animationName: 'gwa-copied', opacity: 0, color: C.success, fontSize: 8.5, fontWeight: 700 }}>
                            ¡Copiado!
                        </span>
                    </span>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        LO QUE HACE TU ADMINISTRADOR
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        1. admin.google.com → Seguridad → Controles de API
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        2. «Configurar app nueva» con el ID de cliente
                    </T>
                    <span
                        style={{
                            padding: '5px 8px',
                            borderRadius: 7,
                            border: `1px solid ${C.border}`,
                            background: C.muted,
                            fontFamily: 'ui-monospace, monospace',
                            fontSize: 8,
                            color: C.fg,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}
                    >
                        1234-abcd.apps.googleusercontent.com
                    </span>
                    <T size={8.5} color={C.mutedFg}>
                        3. Marcarla «De confianza» y guardar
                    </T>
                </div>
            </Win>

            {/* 3 — Ya está de confianza */}
            <Win x={70} y={36} w={340} h={196} title="Ajustes → Integraciones" a="gwa-s3" style={{ opacity: 0 }}>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '9px 10px',
                            borderRadius: 9,
                            background: 'hsl(var(--imcrm-success) / .1)',
                            border: '1px solid hsl(var(--imcrm-success) / .25)',
                        }}
                    >
                        <CheckCircle2 size={14} color={C.success} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            <T size={9.5} weight={700}>
                                ¿Tu administrador ya la marcó de confianza?
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                Vuelve a conectar con tu cuenta de Google.
                            </T>
                            <Btn label="Conectar Google Calendar" />
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={12} color={tone('mint')} />
                        <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Cada persona conecta su propia cuenta.
                        </T>
                    </span>
                </div>
            </Win>

            <Steps />
            <Cursor a="gwa-cur" click="gwa-ring" />
        </Stage>
    );
}
