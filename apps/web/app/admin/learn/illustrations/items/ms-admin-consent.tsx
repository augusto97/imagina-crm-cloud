import { CheckCircle2, Copy, ShieldAlert, ShieldCheck } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Btn, C, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/**
 * v0.1.363 — Cuando Microsoft 365 pide «la aprobación del administrador»:
 * la persona crea el enlace en la app y se lo manda a su administrador de TI,
 * que lo aprueba una sola vez; la app lo muestra y la persona vuelve a conectar.
 */

const CSS = `
@keyframes mac-s1{0%,26%{opacity:1;transform:scale(1)}31%,96%{opacity:0;transform:scale(.96)}100%{opacity:1;transform:scale(1)}}
@keyframes mac-s2{0%,27%{opacity:0;transform:translateY(10px)}32%,58%{opacity:1;transform:translateY(0)}63%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes mac-s3{0%,59%{opacity:0;transform:translateY(10px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes mac-cur{0%{transform:translate(420px,270px);opacity:0}8%{opacity:1}18%,24%{transform:translate(262px,196px)}36%{transform:translate(214px,150px)}44%,52%{transform:translate(214px,150px)}66%{transform:translate(306px,198px)}74%,82%{transform:translate(306px,198px)}90%,100%{transform:translate(430px,280px);opacity:0}}
@keyframes mac-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}45%{opacity:0;transform:scale(.4)}47%{opacity:1;transform:scale(1)}51%{opacity:0;transform:scale(1.6)}75%{opacity:0;transform:scale(.4)}77%{opacity:1;transform:scale(1)}81%,100%{opacity:0;transform:scale(1.6)}}
@keyframes mac-copied{0%,47%{opacity:0}49%,58%{opacity:1}60%,100%{opacity:0}}
`;

function Steps(): JSX.Element {
    const items = ['Microsoft pide un administrador', 'Le mandas el enlace', 'Lo aprueba y vuelves a conectar'];
    return (
        <At x={20} y={258} w={440} style={{ display: 'flex', justifyContent: 'space-between' }}>
            {items.map((s, i) => (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span
                        style={{
                            width: 15,
                            height: 15,
                            borderRadius: 99,
                            background: tone('violet', 0.16),
                            color: tone('violet'),
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

export default function MsAdminConsent(): JSX.Element {
    return (
        <Stage
            label="Microsoft 365 pide la aprobación del administrador: creas el enlace en la app, se lo mandas a tu administrador, lo aprueba una sola vez y vuelves a conectar Microsoft Teams."
            tint="violet"
        >
            <Keyframes css={CSS} />

            {/* 1 — La pantalla de Microsoft */}
            <Win x={100} y={24} w={280} h={218} title="login.microsoftonline.com" a="mac-s1">
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldAlert size={15} color={tone('amber')} />
                        <T size={11.5} weight={700}>
                            Se necesita la aprobación del administrador
                        </T>
                    </span>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        La app necesita permiso para acceder a recursos de tu organización que sólo un administrador puede conceder.
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 7, borderRadius: 8, border: `1px solid ${C.border}` }}>
                        <IntegrationLogo integrationKey="teams" size={22} />
                        <T size={9} weight={600}>
                            Microsoft Teams
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Btn label="Volver a la aplicación" kind="outline" />
                    </span>
                </div>
            </Win>

            {/* 2 — El enlace en la app */}
            <Win x={70} y={20} w={340} h={226} title="Aprobación del administrador de Microsoft 365" a="mac-s2" style={{ opacity: 0 }}>
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <T size={9} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Un administrador de Microsoft 365 de tu empresa tiene que aprobarla una sola vez para toda la organización. Mándale este enlace:
                    </T>
                    <span
                        style={{
                            padding: '6px 8px',
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
                        https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=…
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Btn
                            label={
                                <>
                                    <Copy size={10} />
                                    Copiar mensaje para tu administrador
                                </>
                            }
                        />
                        <span data-a="" style={{ animationName: 'mac-copied', opacity: 0, color: C.success, fontSize: 8.5, fontWeight: 700 }}>
                            ¡Copiado!
                        </span>
                    </span>
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        LO QUE APRUEBA
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        · Publicar mensajes en canales de Teams
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        · Enviar mensajes en chats de Teams
                    </T>
                </div>
            </Win>

            {/* 3 — El administrador ya aprobó */}
            <Win x={70} y={36} w={340} h={196} title="Aprobación del administrador de Microsoft 365" a="mac-s3" style={{ opacity: 0 }}>
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
                                Tu administrador ya aprobó.
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                Ya puedes conectar Microsoft Teams.
                            </T>
                            <Btn label="Conectar Microsoft Teams" />
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
            <Cursor a="mac-cur" click="mac-ring" />
        </Stage>
    );
}
