import { ChevronDown, Lock, LogIn } from 'lucide-react';

import { At, Avatar, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Empresas en la consola: se cambia el estado de una empresa a «Impaga» y
 * queda en solo-lectura; el detalle muestra su uso contra los límites del
 * plan y sus miembros, con «Entrar como esta persona» para soporte.
 */

const CSS = `
@keyframes pte-cursor{0%{transform:translate(300px,290px);opacity:0}6%{opacity:1}18%,24%{transform:translate(236px,126px)}44%,50%{transform:translate(307px,126px)}62%,88%{transform:translate(307px,126px);opacity:1}95%,100%{opacity:0;transform:translate(307px,126px)}}
@keyframes pte-ring{0%,20%{opacity:0;transform:scale(.4)}22%{opacity:1;transform:scale(1)}26%{opacity:0;transform:scale(1.6)}46%{opacity:0;transform:scale(.4)}48%{opacity:1;transform:scale(1)}52%,100%{opacity:0;transform:scale(1.6)}}
@keyframes pte-s1{0%,24%{opacity:1}28%,92%{opacity:0}100%{opacity:1}}
@keyframes pte-s2{0%,24%{opacity:0}28%,92%{opacity:1}100%{opacity:0}}
@keyframes pte-row{0%,24%{background:transparent}28%,44%{background:${tone('amber', 0.1)}}52%,100%{background:transparent}}
@keyframes pte-lock{0%,26%{opacity:0;transform:scale(.5)}32%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes pte-det{0%,50%{opacity:0;transform:translateX(18px)}58%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
`;

function Bar({ label, used, pct, t }: { label: string; used: string; pct: number; t?: 'amber' }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <T size={8}>{label}</T>
                <T size={8} color={t ? tone(t) : C.mutedFg} weight={t ? 700 : 500}>
                    {used}
                </T>
            </span>
            <span
                style={{
                    height: 5,
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

export default function PlatTenants(): JSX.Element {
    return (
        <Stage
            label="En Empresas se cambia el estado de Ferretería El Sol a «Impaga»: la empresa queda en solo-lectura (sus datos se conservan). En su detalle se ve el uso contra los límites del plan y los miembros, con «Entrar como esta persona» para dar soporte."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={20}
                w={300}
                h={186}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <div
                    style={{
                        padding: '9px 11px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <T size={10.5} weight={700}>
                        Empresas (clientes)
                    </T>
                    <span
                        style={{
                            height: 20,
                            padding: '0 8px',
                            borderRadius: 6,
                            background: primary(),
                            color: C.primaryFg,
                            fontSize: 8.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Nueva empresa
                    </span>
                </div>
                <div
                    style={{
                        display: 'flex',
                        height: 22,
                        alignItems: 'center',
                        padding: '0 11px',
                        background: C.muted,
                        gap: 8,
                    }}
                >
                    {['Empresa', 'Plan', 'Estado'].map((h, i) => (
                        <T key={h} size={8} weight={700} color={C.mutedFg} style={{ width: [120, 62, 74][i] }}>
                            {h}
                        </T>
                    ))}
                </div>
                {(
                    [
                        ['Café Aurora', 'Pro', 'Activa', 'mint'],
                        ['Ferretería El Sol', 'Pro', 'Activa', 'mint'],
                        ['Clínica Norte', 'Starter', 'Activa', 'mint'],
                        ['Agencia Rumbo', 'Trial', 'En prueba', 'blue'],
                    ] as const
                ).map(([n, p, s, t], i) => (
                    <div
                        key={n}
                        data-a={i === 1 ? '' : undefined}
                        style={{
                            display: 'flex',
                            height: 30,
                            alignItems: 'center',
                            padding: '0 11px',
                            gap: 8,
                            borderTop: `1px solid ${C.border}`,
                            animationName: i === 1 ? 'pte-row' : undefined,
                        }}
                    >
                        <span
                            style={{
                                width: 120,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                        >
                            <T size={9} weight={600}>
                                {n}
                            </T>
                            {i === 1 && (
                                <span
                                    data-a=""
                                    style={{
                                        display: 'inline-flex',
                                        color: tone('amber'),
                                        animationName: 'pte-lock',
                                    }}
                                >
                                    <Lock size={10} />
                                </span>
                            )}
                        </span>
                        <span
                            style={{
                                width: 62,
                                height: 18,
                                border: `1px solid ${C.border}`,
                                borderRadius: 5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0 5px',
                            }}
                        >
                            <T size={8.5}>{p}</T>
                            <ChevronDown size={8} />
                        </span>
                        <span style={{ width: 74, position: 'relative', height: 18 }}>
                            {i === 1 ? (
                                <>
                                    <span
                                        data-a=""
                                        style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            height: 18,
                                            display: 'flex',
                                            alignItems: 'center',
                                            opacity: 0,
                                            animationName: 'pte-s1',
                                        }}
                                    >
                                        <Chip label="Activa" t="mint" />
                                    </span>
                                    <span
                                        data-a=""
                                        style={{
                                            position: 'absolute',
                                            left: 0,
                                            top: 0,
                                            height: 18,
                                            display: 'flex',
                                            alignItems: 'center',
                                            animationName: 'pte-s2',
                                        }}
                                    >
                                        <Chip label="Impaga" t="amber" />
                                    </span>
                                </>
                            ) : (
                                <span
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        height: 18,
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                >
                                    <Chip label={s} t={t} />
                                </span>
                            )}
                        </span>
                        <T size={10} weight={700} color={C.mutedFg}>
                            ⋯
                        </T>
                    </div>
                ))}
            </At>
            <At
                x={14}
                y={216}
                w={300}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 11px',
                    borderRadius: 10,
                    background: tone('amber', 0.1),
                    border: `1px solid ${tone('amber', 0.3)}`,
                }}
            >
                <Lock size={12} color={tone('amber')} />
                <T size={8.5} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    <b>Impaga o Cancelada</b> deja a la empresa en solo-lectura: los datos nunca se secuestran.
                </T>
            </At>

            {/* Detalle */}
            <At x={326} y={20} w={140} a="pte-det">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 7,
                    }}
                >
                    <T size={10} weight={700}>
                        Ferretería El Sol
                    </T>
                    <T size={8} weight={700} color={C.mutedFg}>
                        Uso vs. límites del plan
                    </T>
                    <Bar label="Registros" used="12.104 / 25.000" pct={48} />
                    <Bar label="Usuarios" used="9 / 10" pct={90} t="amber" />
                    <Bar label="Storage" used="2,1 / 5 GB" pct={42} />
                    <Bar label="Correos este mes" used="310 / 1.000" pct={31} />
                    <T size={8} weight={700} color={C.mutedFg} style={{ marginTop: 4 }}>
                        Miembros
                    </T>
                    {[
                        ['JR', 'Jorge Ruiz', 'Admin'],
                        ['MC', 'Mateo Castro', 'Agente'],
                    ].map(([i, n, r]) => (
                        <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <Avatar initials={i!} t="violet" size={16} />
                            <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <T size={8} weight={600}>
                                    {n}
                                </T>
                                <T size={7} color={C.mutedFg}>
                                    {r}
                                </T>
                            </span>
                            <LogIn size={10} color={primary()} />
                        </span>
                    ))}
                </div>
            </At>
            <Cursor a="pte-cursor" click="pte-ring" rest={[307, 126]} />
        </Stage>
    );
}
