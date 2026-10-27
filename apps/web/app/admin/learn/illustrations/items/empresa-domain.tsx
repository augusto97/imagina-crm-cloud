import { Check, Coffee, Globe, Lock } from 'lucide-react';

import { At, Btn, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Dominio propio: la dirección del navegador pasa de la de la plataforma a
 * crm.cafeaurora.co cuando el TXT (propiedad) y el CNAME (apuntamiento)
 * quedan verificados; el login ya muestra la marca de la empresa.
 */

const CSS = `
@keyframes edm-old{0%,58%{opacity:1}64%,92%{opacity:0}100%{opacity:1}}
@keyframes edm-new{0%,58%{opacity:0;transform:translateY(4px)}64%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes edm-p1{0%,22%{opacity:1}26%,92%{opacity:0}100%{opacity:1}}
@keyframes edm-ok1{0%,22%{opacity:0;transform:scale(.6)}26%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes edm-p2{0%,44%{opacity:1}48%,92%{opacity:0}100%{opacity:1}}
@keyframes edm-ok2{0%,44%{opacity:0;transform:scale(.6)}48%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes edm-scan1{0%,10%{width:0;opacity:1}22%{width:100%;opacity:1}26%,100%{width:100%;opacity:0}}
@keyframes edm-scan2{0%,32%{width:0;opacity:1}44%{width:100%;opacity:1}48%,100%{width:100%;opacity:0}}
@keyframes edm-brand{0%,60%{opacity:0;transform:scale(.96)}68%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
`;

function Status({ pending, ok, scan }: { pending: string; ok: string; scan: string }): JSX.Element {
    return (
        <span
            style={{
                position: 'relative',
                width: 92,
                height: 18,
                display: 'inline-block',
            }}
        >
            <span
                data-a=""
                style={{
                    position: 'absolute',
                    left: 0,
                    bottom: -3,
                    height: 2,
                    borderRadius: 2,
                    background: primary(0.5),
                    animationName: scan,
                    width: 0,
                }}
            />
            <span
                data-a=""
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 99,
                    fontSize: 8.5,
                    fontWeight: 700,
                    color: tone('amber'),
                    background: tone('amber', 0.14),
                    opacity: 0,
                    animationName: pending,
                }}
            >
                Pendiente
            </span>
            <span
                data-a=""
                style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                    borderRadius: 99,
                    fontSize: 8.5,
                    fontWeight: 700,
                    color: C.success,
                    background: 'hsl(var(--imcrm-success) / .14)',
                    animationName: ok,
                }}
            >
                <Check size={9} strokeWidth={3} /> Configurado
            </span>
        </span>
    );
}

function DnsRow({
    type,
    host,
    value,
    pending,
    ok,
    scan,
}: {
    type: string;
    host: string;
    value: string;
    pending: string;
    ok: string;
    scan: string;
}): JSX.Element {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 34,
                borderBottom: `1px solid ${C.border}`,
            }}
        >
            <span
                style={{
                    width: 40,
                    height: 16,
                    borderRadius: 4,
                    border: `1px solid ${C.border}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 8,
                    fontWeight: 700,
                }}
            >
                {type}
            </span>
            <span
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <T size={9} weight={600}>
                    {host}
                </T>
                <T
                    size={8}
                    color={C.mutedFg}
                    style={{
                        fontFamily: 'ui-monospace, monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {value}
                </T>
            </span>
            <Status pending={pending} ok={ok} scan={scan} />
        </div>
    );
}

export default function EmpresaDomain(): JSX.Element {
    return (
        <Stage
            label="Dominio propio: se verifica el registro TXT que prueba que el dominio es de la empresa y el CNAME que lo apunta a la plataforma; después la app se abre en crm.cafeaurora.co con el logo y el nombre de la empresa desde el login."
            tint="blue"
        >
            <Keyframes css={CSS} />
            {/* Navegador */}
            <At
                x={16}
                y={18}
                w={448}
                h={128}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 28px -14px rgba(15,23,42,.35)',
                }}
            >
                <div
                    style={{
                        height: 30,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '0 10px',
                        borderBottom: `1px solid ${C.border}`,
                        background: C.muted,
                    }}
                >
                    <span style={{ display: 'flex', gap: 3 }}>
                        {[0.9, 0.6, 0.35].map((o) => (
                            <span
                                key={o}
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 99,
                                    background: C.mutedFg,
                                    opacity: o * 0.5,
                                }}
                            />
                        ))}
                    </span>
                    <span
                        style={{
                            position: 'relative',
                            flex: 1,
                            height: 18,
                            borderRadius: 99,
                            background: C.card,
                            border: `1px solid ${C.border}`,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 9px',
                        }}
                    >
                        <Lock size={9} color={C.success} />
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 24,
                                top: 0,
                                height: 16,
                                display: 'flex',
                                alignItems: 'center',
                                opacity: 0,
                                animationName: 'edm-old',
                            }}
                        >
                            <T size={9} color={C.mutedFg}>
                                https://cafe-aurora.plataforma.com
                            </T>
                        </span>
                        <span
                            data-a=""
                            style={{
                                position: 'absolute',
                                left: 24,
                                top: 0,
                                height: 16,
                                display: 'flex',
                                alignItems: 'center',
                                animationName: 'edm-new',
                            }}
                        >
                            <T size={9} weight={700}>
                                https://crm.cafeaurora.co
                            </T>
                        </span>
                    </span>
                </div>
                <div
                    style={{
                        position: 'relative',
                        height: 96,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <div
                        data-a=""
                        style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 14,
                            opacity: 0,
                            animationName: 'edm-old',
                        }}
                    >
                        <span
                            style={{
                                width: 38,
                                height: 38,
                                borderRadius: 10,
                                background: C.muted,
                            }}
                        />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <T size={12} weight={700} color={C.mutedFg}>
                                Entra a tu cuenta
                            </T>
                            <span style={{ display: 'flex', gap: 5 }}>
                                <span
                                    style={{
                                        width: 96,
                                        height: 16,
                                        borderRadius: 4,
                                        border: `1px solid ${C.border}`,
                                    }}
                                />
                                <span
                                    style={{
                                        width: 70,
                                        height: 16,
                                        borderRadius: 4,
                                        border: `1px solid ${C.border}`,
                                    }}
                                />
                                <span
                                    style={{
                                        width: 40,
                                        height: 16,
                                        borderRadius: 4,
                                        background: C.muted,
                                    }}
                                />
                            </span>
                        </span>
                    </div>
                    <div
                        data-a=""
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                            animationName: 'edm-brand',
                        }}
                    >
                        <span
                            style={{
                                width: 38,
                                height: 38,
                                borderRadius: 10,
                                background: tone('amber', 0.16),
                                color: tone('amber'),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Coffee size={20} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <T size={12} weight={700}>
                                Entra a Café Aurora
                            </T>
                            <span style={{ display: 'flex', gap: 5 }}>
                                <span
                                    style={{
                                        width: 96,
                                        height: 16,
                                        borderRadius: 4,
                                        border: `1px solid ${C.border}`,
                                    }}
                                />
                                <span
                                    style={{
                                        width: 70,
                                        height: 16,
                                        borderRadius: 4,
                                        border: `1px solid ${C.border}`,
                                    }}
                                />
                                <Btn label="Entrar" style={{ height: 16 }} />
                            </span>
                        </span>
                    </div>
                </div>
            </At>

            {/* Registros DNS */}
            <At
                x={16}
                y={158}
                w={448}
                h={122}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '9px 12px',
                    boxShadow: '0 12px 28px -14px rgba(15,23,42,.35)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Globe size={12} color={primary()} />
                    <T size={10.5} weight={700}>
                        Dominio personalizado
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        · crm.cafeaurora.co
                    </T>
                </span>
                <div style={{ marginTop: 6 }}>
                    <DnsRow
                        type="TXT"
                        host="1. Verifica que el dominio es tuyo"
                        value="Nombre y código que te da la app, para copiar"
                        pending="edm-p1"
                        ok="edm-ok1"
                        scan="edm-scan1"
                    />
                    <DnsRow
                        type="CNAME"
                        host="2. Apunta el dominio a la plataforma"
                        value="crm.cafeaurora.co → plataforma.com"
                        pending="edm-p2"
                        ok="edm-ok2"
                        scan="edm-scan2"
                    />
                </div>
            </At>
        </Stage>
    );
}
