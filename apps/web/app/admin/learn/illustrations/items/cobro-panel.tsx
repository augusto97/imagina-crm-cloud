import { Bell, Copy } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El panel «Cobros» de una conexión: cuántos links hay pendientes, cuántos se
 * pagaron y cuánto se cobró, el último aviso del proveedor y los últimos
 * links. Llega un aviso de pago y los números se actualizan.
 */

const CSS = `
@keyframes cp-ping{0%,30%{opacity:0;transform:translateY(-6px)}36%,58%{opacity:1;transform:translateY(0)}64%,100%{opacity:0;transform:translateY(0)}}
@keyframes cp-a{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes cp-b{0%,44%{opacity:0}48%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cp-row{0%,44%{background:transparent}48%,62%{background:${tone('mint', 0.14)}}70%,100%{background:transparent}}
`;

function Swap({ a, b, size = 14 }: { a: string; b: string; size?: number }): JSX.Element {
    return (
        <span style={{ display: 'inline-grid' }}>
            <span data-a="" style={{ gridArea: '1/1', fontSize: size, fontWeight: 800, color: C.fg, opacity: 0, animationName: 'cp-a' }}>
                {a}
            </span>
            <span data-a="" style={{ gridArea: '1/1', fontSize: size, fontWeight: 800, color: C.fg, animationName: 'cp-b' }}>
                {b}
            </span>
        </span>
    );
}

function Stat({ x, label, a, b }: { x: number; label: string; a: string; b: string }): JSX.Element {
    return (
        <At x={x} y={52} w={142} h={52} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <T size={7.5} color={C.mutedFg}>
                {label}
            </T>
            <Swap a={a} b={b} />
        </At>
    );
}

export default function CobroPanel(): JSX.Element {
    return (
        <Stage label="El panel de cobros de una conexión: pendientes, pagados y total cobrado, el último aviso del proveedor y los últimos links. Al llegar el aviso de un pago, la factura pasa a «Pagado» y los números se actualizan." tint="cyan">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={14} y={14} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: '#00B1EA', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 800 }}>M</span>
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={10.5} weight={700}>
                            Cobros · Mercado Pago
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            El dinero va directo a tu cuenta, sin comisión de la plataforma.
                        </T>
                    </span>
                </At>
                <Stat x={14} label="Pendientes" a="3" b="2" />
                <Stat x={168} label="Pagados" a="12" b="13" />
                <Stat x={322} label="Cobrado" a="$ 8.420.000" b="$ 9.670.000" />

                <At x={14} y={112} w={452} h={176} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, overflow: 'hidden' }}>
                    <span style={{ display: 'flex', alignItems: 'center', padding: '7px 11px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9} weight={700}>
                            Últimos links de pago
                        </T>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: '64px 1fr 86px 92px 54px 18px', gap: 6, padding: '5px 11px', background: C.muted }}>
                        {['Registro', 'Concepto', 'Monto', 'Estado', 'Medio', ''].map((h) => (
                            <T key={h || 'x'} size={7} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </span>
                    {[
                        { r: 'FAC-1042', c: 'Factura FAC-1042', m: '$ 1.250.000', live: true },
                        { r: 'FAC-1041', c: 'Factura FAC-1041', m: '$ 480.000', s: 'Pagado', col: '#10B981', med: 'Nequi' },
                        { r: 'FAC-1043', c: 'Factura FAC-1043', m: '$ 320.000', s: 'Pendiente', col: '#F59E0B', med: '—' },
                        { r: 'FAC-1038', c: 'Anticipo obra', m: '$ 2.000.000', s: 'Vencido', col: '#6B7280', med: '—' },
                    ].map((row) => (
                        <span key={row.r} data-a={row.live ? '' : undefined} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 86px 92px 54px 18px', gap: 6, alignItems: 'center', padding: '8px 11px', borderBottom: `1px solid ${C.border}`, animationName: row.live ? 'cp-row' : undefined }}>
                            <T size={8} weight={600}>
                                {row.r}
                            </T>
                            <T size={8}>{row.c}</T>
                            <T size={8}>{row.m}</T>
                            {row.live ? (
                                <span style={{ display: 'inline-grid' }}>
                                    <span data-a="" style={{ gridArea: '1/1', justifySelf: 'start', height: 15, padding: '0 6px', borderRadius: 99, background: '#F59E0B', color: '#fff', fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center', opacity: 0, animationName: 'cp-a' }}>Pendiente</span>
                                    <span data-a="" style={{ gridArea: '1/1', justifySelf: 'start', height: 15, padding: '0 6px', borderRadius: 99, background: '#10B981', color: '#fff', fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center', animationName: 'cp-b' }}>Pagado</span>
                                </span>
                            ) : (
                                <span style={{ justifySelf: 'start', height: 15, padding: '0 6px', borderRadius: 99, background: row.col, color: '#fff', fontSize: 7, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{row.s}</span>
                            )}
                            {row.live ? (
                                <span style={{ display: 'inline-grid' }}>
                                    <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'cp-a' }}>
                                        <T size={7.5} color={C.mutedFg}>
                                            —
                                        </T>
                                    </span>
                                    <span data-a="" style={{ gridArea: '1/1', animationName: 'cp-b' }}>
                                        <T size={7.5} color={C.mutedFg}>
                                            PSE
                                        </T>
                                    </span>
                                </span>
                            ) : (
                                <T size={7.5} color={C.mutedFg}>
                                    {row.med}
                                </T>
                            )}
                            <Copy size={10} color={C.mutedFg} />
                        </span>
                    ))}
                </At>

                {/* Aviso del proveedor */}
                <At x={262} y={10} w={204} a="cp-ping" style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 10, background: C.card, border: `1px solid ${primary(0.5)}`, boxShadow: '0 12px 26px -12px rgba(15,23,42,.5)' }}>
                    <Bell size={11} color={primary()} />
                    <T size={7.5} weight={600} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                        Aviso de Mercado Pago: pago aprobado de FAC-1042
                    </T>
                </At>
            </div>
        </Stage>
    );
}
