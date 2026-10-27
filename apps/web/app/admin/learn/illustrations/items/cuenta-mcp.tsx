import { Check, Key, Sparkles } from 'lucide-react';

import { At, Bubble, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Conectar Claude (u otro asistente) a tu cuenta: se autoriza desde la app
 * de Claude o con un token; el asistente consulta tus listas con tu mismo
 * rol y te propone cambios que tú confirmas.
 */

const CSS = `
@keyframes cmc-q{0%,6%{opacity:0;transform:translateY(8px)}12%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes cmc-a{0%,30%{opacity:0;transform:translateY(8px)}38%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes cmc-p{0%,52%{opacity:0;transform:translateY(8px)}60%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes cmc-dots{0%,14%{opacity:0}18%,28%{opacity:1}32%,100%{opacity:0}}
@keyframes cmc-tok{0%,100%{opacity:1}}
`;

export default function CuentaMcp(): JSX.Element {
    return (
        <Stage
            label="Con una conexión autorizada, Claude consulta tus listas con tu mismo rol y permisos: responde cuántas facturas vencen esta semana y propone un cambio que sólo se aplica cuando tú lo confirmas."
            tint="violet"
        >
            <Keyframes css={CSS} />
            {/* Ajustes · Conexión */}
            <At
                x={16}
                y={22}
                w={170}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <T size={10.5} weight={700} style={{ whiteSpace: 'normal' }}>
                    Conexión MCP (Claude, Cursor y otros)
                </T>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    Con tu mismo rol y permisos. Revócala cuando quieras.
                </T>
                {[
                    ['Claude en mi notebook', 'Conexión autorizada · se renueva solo', 'mint'],
                    ['Cursor', 'Sólo lectura · vence en 90 días', 'blue'],
                ].map(([n, d, t]) => (
                    <div
                        key={n}
                        style={{
                            border: `1px solid ${C.border}`,
                            borderRadius: 9,
                            padding: 8,
                            display: 'flex',
                            gap: 7,
                        }}
                    >
                        <span
                            style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                background: tone(t as 'mint', 0.14),
                                color: tone(t as 'mint'),
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <Key size={11} />
                        </span>
                        <span
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                minWidth: 0,
                            }}
                        >
                            <T size={8.5} weight={700}>
                                {n}
                            </T>
                            <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                {d}
                            </T>
                            <T size={7.5} weight={700} color={C.destructive}>
                                Revocar
                            </T>
                        </span>
                    </div>
                ))}
            </At>

            {/* La conversación en Claude */}
            <At
                x={200}
                y={22}
                w={264}
                h={256}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <div
                    style={{
                        height: 30,
                        borderBottom: `1px solid ${C.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '0 11px',
                    }}
                >
                    <Sparkles size={12} color={tone('amber')} />
                    <T size={9.5} weight={700}>
                        Claude
                    </T>
                    <T size={8} color={C.mutedFg}>
                        · conectado a tu empresa
                    </T>
                </div>
                <div
                    style={{
                        padding: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                    }}
                >
                    <span data-a="" style={{ alignSelf: 'flex-end', animationName: 'cmc-q' }}>
                        <Bubble side="right" style={{ maxWidth: 200 }}>
                            ¿Qué facturas vencen esta semana?
                        </Bubble>
                    </span>
                    <span
                        data-a=""
                        style={{
                            display: 'flex',
                            gap: 3,
                            opacity: 0,
                            animationName: 'cmc-dots',
                        }}
                    >
                        {[0, 1, 2].map((i) => (
                            <span
                                key={i}
                                style={{
                                    width: 5,
                                    height: 5,
                                    borderRadius: 99,
                                    background: C.mutedFg,
                                }}
                            />
                        ))}
                    </span>
                    <span data-a="" style={{ animationName: 'cmc-a' }}>
                        <Bubble style={{ maxWidth: 230 }}>
                            Vencen 3 por <b>$ 4.180.000</b>: FAC-1042 (Hotel Brisas), FAC-1047 y FAC-1051. ¿Les pongo el estado «Cobrar»?
                        </Bubble>
                    </span>
                    <span data-a="" style={{ animationName: 'cmc-p' }}>
                        <div
                            style={{
                                border: `1px solid ${primary(0.5)}`,
                                borderRadius: 9,
                                padding: 8,
                                background: primary(0.05),
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 5,
                            }}
                        >
                            <T size={8.5} weight={700}>
                                Propuesta · Edición masiva (3 registros)
                            </T>
                            <T size={8} color={C.mutedFg}>
                                Estado: Pendiente → Cobrar
                            </T>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignSelf: 'flex-start',
                                    alignItems: 'center',
                                    gap: 4,
                                    height: 20,
                                    padding: '0 9px',
                                    borderRadius: 6,
                                    background: primary(),
                                    color: C.primaryFg,
                                    fontSize: 8.5,
                                    fontWeight: 600,
                                }}
                            >
                                <Check size={10} /> Confirmar
                            </span>
                        </div>
                    </span>
                </div>
            </At>
        </Stage>
    );
}
