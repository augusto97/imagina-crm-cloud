import { Copy, ExternalLink, RefreshCw, Wallet } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Cobrar» desde la ficha de una factura: el diálogo trae el concepto y el
 * monto del registro, se crea el link y aparece en la sección «Cobros» como
 * «Pendiente», con copiar, abrir y verificar.
 */

const CSS = `
@keyframes ck-cur{0%,6%{transform:translate(120px,250px)}15%,38%{transform:translate(272px,46px)}48%,56%{transform:translate(412px,232px)}68%,100%{transform:translate(248px,110px)}}
@keyframes ck-click{0%,16%{opacity:0;transform:scale(.4)}18%{opacity:1;transform:scale(1)}26%,49%{opacity:0;transform:scale(1.6)}50%{opacity:0;transform:scale(.4)}52%{opacity:1;transform:scale(1)}60%,100%{opacity:0;transform:scale(1.6)}}
@keyframes ck-dlg{0%,20%{opacity:0;transform:translateY(10px)}26%,54%{opacity:1;transform:translateY(0)}60%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes ck-create{0%,46%{box-shadow:0 0 0 0 transparent}50%,54%{box-shadow:0 0 0 4px ${primary(0.35)}}58%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes ck-row{0%,58%{opacity:0;max-height:0}64%,92%{opacity:1;max-height:60px}97%,100%{opacity:0;max-height:60px}}
@keyframes ck-toast{0%,60%{opacity:0;transform:translateY(-6px)}66%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
`;

function Field({ label, value, w }: { label: string; value: string; w?: number }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, width: w, flex: w ? 'none' : 1 }}>
            <T size={7.5} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ height: 22, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                <T size={8.5}>{value}</T>
            </span>
        </span>
    );
}

export default function CobroCobrar(): JSX.Element {
    return (
        <Stage label="En la ficha de una factura se toca «Cobrar»: el diálogo trae el concepto y el monto, se crea el link de pago y aparece en la sección «Cobros» como «Pendiente», con copiar, abrir y verificar." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                {/* Sección Cobros de la ficha */}
                <At x={16} y={24} w={290} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 11, boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Wallet size={11} color={C.fg} />
                        <T size={9.5} weight={700}>
                            Cobros
                        </T>
                        <span style={{ marginLeft: 'auto', height: 22, padding: '0 9px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Wallet size={10} color={C.primaryFg} />
                            <T size={8} weight={700} color={C.primaryFg}>
                                Cobrar
                            </T>
                        </span>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Factura FAC-1042 · Hotel Brisas
                    </T>
                    <span data-a="" style={{ overflow: 'hidden', animationName: 'ck-row' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.muted }}>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <T size={9} weight={700}>
                                        $ 1.250.000 COP
                                    </T>
                                    <span style={{ height: 15, padding: '0 6px', borderRadius: 99, background: tone('amber'), display: 'inline-flex', alignItems: 'center' }}>
                                        <T size={7} weight={700} color="#fff">
                                            Pendiente
                                        </T>
                                    </span>
                                </span>
                                <T size={7} color={C.mutedFg}>
                                    Mercado Pago · vence en 5 días
                                </T>
                            </span>
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 7, color: C.mutedFg }}>
                                <Copy size={11} />
                                <ExternalLink size={11} />
                                <RefreshCw size={11} />
                            </span>
                        </span>
                    </span>
                </At>
                <At x={16} y={160} w={290} a="ck-toast" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -14px rgba(15,23,42,.45)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: C.success }} />
                    <T size={8} weight={600}>
                        Link creado y copiado: pégalo en un WhatsApp o un correo.
                    </T>
                </At>

                {/* Diálogo Cobrar */}
                <At x={196} y={34} w={270} a="ck-dlg" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, boxShadow: '0 20px 44px -18px rgba(15,23,42,.6)', display: 'flex', flexDirection: 'column', gap: 7, zIndex: 5 }}>
                    <T size={10} weight={700}>
                        Cobrar
                    </T>
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Se crea un link de pago; cuando el cliente pague, el registro se actualiza solo.
                    </T>
                    <Field label="Concepto" value="Factura FAC-1042" />
                    <span style={{ display: 'flex', gap: 6 }}>
                        <Field label="Monto" value="1.250.000" />
                        <Field label="Moneda" value="COP" w={56} />
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                        <Field label="Correo del cliente (opcional)" value="pagos@hotelbrisas.co" />
                        <Field label="Vence en (días)" value="5" w={70} />
                    </span>
                    <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
                        <span style={{ height: 22, padding: '0 8px', display: 'flex', alignItems: 'center' }}>
                            <T size={8}>Cancelar</T>
                        </span>
                        <span data-a="" style={{ height: 22, padding: '0 10px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', animationName: 'ck-create' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Crear link de pago
                            </T>
                        </span>
                    </span>
                </At>
                <Cursor a="ck-cur" click="ck-click" rest={[248, 110]} />
            </div>
        </Stage>
    );
}
