import { ArrowRight, Check, CornerDownRight, Undo2 } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * «Editar en la tienda»: subir 10 % el precio normal y redondear hacia arriba
 * a precios terminados en 900; la vista previa muestra antes → después por
 * producto y por variación, y al aplicar los cambios llegan a WooCommerce (con
 * «Deshacer»).
 */

const CSS = `
@keyframes tb-a1{0%,10%{opacity:0;transform:translateX(-4px)}14%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes tb-a2{0%,16%{opacity:0;transform:translateX(-4px)}20%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes tb-a3{0%,22%{opacity:0;transform:translateX(-4px)}26%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes tb-a4{0%,28%{opacity:0;transform:translateX(-4px)}32%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes tb-cur{0%,34%{transform:translate(300px,290px);opacity:0}38%{opacity:1}46%,50%{transform:translate(400px,252px)}62%,100%{transform:translate(430px,290px);opacity:0}}
@keyframes tb-ring{0%,47%{opacity:0;transform:scale(.4)}48%{opacity:1;transform:scale(1)}52%,100%{opacity:0;transform:scale(1.6)}}
@keyframes tb-btn{0%,47%{transform:scale(1)}49%{transform:scale(.94)}51%,100%{transform:scale(1)}}
@keyframes tb-prog{0%,50%{width:0}66%,100%{width:100%}}
@keyframes tb-pbox{0%,49%{opacity:0}51%,66%{opacity:1}69%,100%{opacity:0}}
@keyframes tb-done{0%,67%{opacity:0;transform:translateY(6px)}72%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

const ROWS: { name: string; sub?: boolean; before: string; after: string; a: string }[] = [
    { name: 'Taza Aurora · Roja', sub: true, before: '$35.000', after: '$38.900', a: 'tb-a1' },
    { name: 'Taza Aurora · Azul', sub: true, before: '$35.000', after: '$38.900', a: 'tb-a2' },
    { name: 'Libreta Kraft', before: '$22.000', after: '$24.900', a: 'tb-a3' },
    { name: 'Termo Andes', before: '$64.900', after: '$71.900', a: 'tb-a4' },
];

function Field({ label, children }: { label: string; children: JSX.Element | string }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={7.5} weight={700} color={C.mutedFg}>
                {label}
            </T>
            <span style={{ minHeight: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px', fontSize: 8.5, fontWeight: 600 }}>{children}</span>
        </span>
    );
}

export default function TiendaBulk(): JSX.Element {
    return (
        <Stage label="Editar en la tienda: subir 10 por ciento el precio normal y redondear hacia arriba a precios terminados en 900. La vista previa muestra el antes y el después de cada producto y variación, y al aplicar los cambios llegan a WooCommerce, con la opción de deshacer." tint="violet">
            <Keyframes css={CSS} />

            <At x={14} y={14} w={452} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, boxShadow: '0 16px 38px -18px rgba(15,23,42,.55)', overflow: 'hidden' }}>
                <div style={{ height: 32, display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey="woocommerce" size={16} />
                    <T size={10.5} weight={700}>
                        Editar en la tienda
                    </T>
                    <T size={8.5} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                        4 productos de la vista «Tazas y libretas»
                    </T>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', height: 240 }}>
                    {/* Qué se cambia */}
                    <div style={{ padding: 10, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={7.5} weight={700} color={primary()} style={{ textTransform: 'uppercase', letterSpacing: '.05em' }}>
                            Precios
                        </T>
                        <Field label="Campo">Precio normal</Field>
                        <Field label="Cómo">Subir o bajar un %</Field>
                        <Field label="Porcentaje">+10 %</Field>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, borderRadius: 7, background: C.muted, padding: '6px 7px' }}>
                            <T size={7.5} weight={700}>
                                Redondear el resultado
                            </T>
                            <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.35 }}>
                                Hacia arriba, a múltiplos de 1.000 más −100 (terminados en 900)
                            </T>
                        </span>
                    </div>

                    {/* Vista previa */}
                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
                        <span style={{ display: 'grid', gridTemplateColumns: '1fr 52px 14px 52px', gap: 4, alignItems: 'center', height: 18 }}>
                            <T size={7.5} weight={700} color={C.mutedFg}>
                                VISTA PREVIA
                            </T>
                            <T size={7.5} weight={700} color={C.mutedFg}>
                                Antes
                            </T>
                            <span />
                            <T size={7.5} weight={700} color={C.mutedFg}>
                                Después
                            </T>
                        </span>
                        {ROWS.map((r) => (
                            <span key={r.name} style={{ display: 'grid', gridTemplateColumns: '1fr 52px 14px 52px', gap: 4, alignItems: 'center', height: 25, borderBottom: `1px solid ${C.border}` }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                                    {r.sub && <CornerDownRight size={9} color={C.mutedFg} />}
                                    <T size={8.5} weight={600}>
                                        {r.name}
                                    </T>
                                </span>
                                <T size={8.5} color={C.mutedFg} style={{ textDecoration: 'line-through' }}>
                                    {r.before}
                                </T>
                                <ArrowRight size={9} color={C.mutedFg} />
                                <span data-a="" style={{ animationName: r.a, display: 'flex' }}>
                                    <T size={8.5} weight={700} color={primary()}>
                                        {r.after}
                                    </T>
                                </span>
                            </span>
                        ))}
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', marginTop: 2 }}>
                            Se calcula con el precio que hoy tiene la tienda.
                        </T>
                        <span style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                            <Btn label="Cancelar" kind="outline" />
                            <span data-a="" style={{ animationName: 'tb-btn', display: 'inline-flex' }}>
                                <Btn label="Aplicar en la tienda" />
                            </span>
                        </span>

                        {/* Aplicando */}
                        <span data-a="" style={{ animationName: 'tb-pbox', position: 'absolute', left: 10, right: 10, bottom: 46, opacity: 0, display: 'flex', flexDirection: 'column', gap: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 9px' }}>
                            <T size={8.5} weight={600}>
                                Aplicando en WooCommerce…
                            </T>
                            <span style={{ height: 5, borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                                <span data-a="" style={{ animationName: 'tb-prog', display: 'block', height: '100%', width: '100%', background: primary() }} />
                            </span>
                        </span>
                        {/* Listo */}
                        <span data-a="" style={{ animationName: 'tb-done', position: 'absolute', left: 10, right: 10, bottom: 46, display: 'flex', alignItems: 'center', gap: 6, background: C.card, border: `1px solid ${tone('mint', 0.5)}`, borderRadius: 8, padding: '7px 9px', boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}>
                            <Check size={12} color={C.success} />
                            <T size={8.5} weight={700} color={C.success}>
                                4 cambios aplicados en la tienda
                            </T>
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, fontWeight: 700, color: primary() }}>
                                <Undo2 size={10} /> Deshacer
                            </span>
                        </span>
                    </div>
                </div>
            </At>

            <Cursor a="tb-cur" click="tb-ring" />
        </Stage>
    );
}
