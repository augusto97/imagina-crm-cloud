import { ShieldCheck } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Avatar, Btn, C, Cursor, Keyframes, Stage, T, Win, tone } from '../kit';

/**
 * Conectar una app con tu cuenta (Gmail): tocas «Conectar», Google te pide
 * elegir la cuenta y dar permiso, y vuelves a la app con la conexión lista.
 */

const CSS = `
@keyframes io-s1{0%,30%{opacity:1;transform:scale(1)}35%,96%{opacity:0;transform:scale(.96)}100%{opacity:1;transform:scale(1)}}
@keyframes io-s2{0%,31%{opacity:0;transform:translateY(10px)}36%,62%{opacity:1;transform:translateY(0)}67%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes io-s3{0%,63%{opacity:0;transform:translateY(10px)}68%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes io-cur{0%{transform:translate(400px,260px);opacity:0}6%{opacity:1}18%,24%{transform:translate(236px,166px)}40%{transform:translate(190px,128px)}46%,50%{transform:translate(190px,128px)}58%,62%{transform:translate(322px,188px)}70%,100%{transform:translate(420px,270px);opacity:0}}
@keyframes io-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}47%{opacity:0;transform:scale(.4)}48%{opacity:1;transform:scale(1)}52%{opacity:0;transform:scale(1.6)}59%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1)}64%,100%{opacity:0;transform:scale(1.6)}}
@keyframes io-pick{0%,47%{background:transparent}49%,100%{background:${tone('blue', 0.12)}}}
@keyframes io-step{0%,8%{opacity:.35}12%,100%{opacity:1}}
`;

function Steps(): JSX.Element {
    const items = ['Tocas «Conectar»', 'Eliges tu cuenta y das permiso', 'Vuelves con la app conectada'];
    return (
        <At x={24} y={256} w={432} style={{ display: 'flex', justifyContent: 'space-between' }}>
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
                    <T size={9} weight={600} color={C.mutedFg}>
                        {s}
                    </T>
                </span>
            ))}
        </At>
    );
}

export default function IntegOauth(): JSX.Element {
    return (
        <Stage label="Conectar Gmail: tocas Conectar, Google te pide elegir la cuenta y dar permiso, y vuelves a la app con Gmail conectada." tint="blue">
            <Keyframes css={CSS} />

            {/* 1 — La tarjeta de la galería */}
            <Win x={70} y={30} w={340} h={208} title="Ajustes · Integraciones" a="io-s1">
                <At x={22} y={20} w={296} h={138} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <IntegrationLogo integrationKey="gmail" size={34} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <T size={11.5} weight={700}>
                                Gmail
                            </T>
                            <T size={8.5} color={C.mutedFg}>
                                Correo
                            </T>
                        </span>
                    </span>
                    <T size={9.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        Envía correos desde tu propia cuenta de Gmail.
                    </T>
                    <Btn label="Conectar" style={{ justifyContent: 'center', height: 24 }} />
                </At>
            </Win>

            {/* 2 — La pantalla de Google */}
            <Win x={110} y={22} w={260} h={222} title="accounts.google.com" a="io-s2" style={{ opacity: 0 }}>
                <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                    <T size={12} weight={700}>
                        Elige una cuenta
                    </T>
                    <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                        para continuar y permitir que la app envíe correos en tu nombre
                    </T>
                    <span data-a="" style={{ animationName: 'io-pick', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', borderRadius: 8, border: `1px solid ${C.border}` }}>
                        <Avatar initials="AG" t="rose" size={22} />
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={9.5} weight={700}>
                                Ana Gómez
                            </T>
                            <T size={8} color={C.mutedFg}>
                                ana@cafeaurora.co
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <ShieldCheck size={12} color={tone('mint')} />
                        <T size={8.5} color={C.mutedFg}>
                            Sólo para enviar correos
                        </T>
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                        <Btn label="Cancelar" kind="outline" />
                        <Btn label="Permitir" style={{ background: tone('blue') }} />
                    </span>
                </div>
            </Win>

            {/* 3 — De vuelta en la app */}
            <Win x={50} y={44} w={380} h={180} title="Ajustes · Integraciones" a="io-s3" style={{ opacity: 1 }}>
                <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span
                        style={{
                            padding: '7px 10px',
                            borderRadius: 8,
                            background: 'hsl(var(--imcrm-success) / .1)',
                            border: '1px solid hsl(var(--imcrm-success) / .25)',
                            color: C.success,
                            fontSize: 9,
                            fontWeight: 600,
                            lineHeight: 1.35,
                        }}
                    >
                        ¡Listo! La app quedó conectada y ya la puedes usar en tus automatizaciones.
                    </span>
                    <T size={10} weight={700}>
                        Conectadas
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 9 }}>
                        <IntegrationLogo integrationKey="gmail" size={26} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <T size={10} weight={700}>
                                    Gmail
                                </T>
                                <T size={9} color={C.mutedFg}>
                                    ana@cafeaurora.co
                                </T>
                                <span style={{ height: 15, padding: '0 6px', borderRadius: 99, background: 'hsl(var(--imcrm-success) / .14)', color: C.success, fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                                    Conectada
                                </span>
                            </span>
                            <T size={8} color={C.mutedFg}>
                                Todavía no la usa ninguna automatización.
                            </T>
                        </span>
                    </span>
                </div>
            </Win>

            <Steps />
            <Cursor a="io-cur" click="io-ring" />
        </Stage>
    );
}
