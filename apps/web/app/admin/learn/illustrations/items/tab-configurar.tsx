import { ChevronDown } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Configurar un widget: el mismo gráfico pasa de «contar registros» a «sumar
 * el monto», y la vista previa se recalcula al instante (el orden de las
 * barras cambia porque ahora pesa la plata, no la cantidad).
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const BARS: Array<{ label: string; t: Tn; a: number; b: number; va: string; vb: string }> = [
    { label: 'Nuevo', t: 'cyan', a: 96, b: 52, va: '5', vb: '11,2 M' },
    { label: 'Contactado', t: 'blue', a: 20, b: 18, va: '1', vb: '3,4 M' },
    { label: 'Calificado', t: 'violet', a: 96, b: 112, va: '5', vb: '12,9 M' },
    { label: 'Propuesta', t: 'amber', a: 20, b: 6, va: '1', vb: '0,1 M' },
    { label: 'Ganado', t: 'mint', a: 40, b: 80, va: '2', vb: '8,9 M' },
    { label: 'Perdido', t: 'rose', a: 40, b: 26, va: '2', vb: '2,8 M' },
];

const barKeys = BARS.map(
    (b, i) => `@keyframes tf-bar${i}{0%,8%{width:0;opacity:1}18%,48%{width:${b.a}px;opacity:1}56%,92%{width:${b.b}px;opacity:1}97%,100%{width:${b.b}px;opacity:0}}`,
).join('\n');

const CSS = `
${barKeys}
@keyframes tf-a{0%,48%{opacity:1}52%,100%{opacity:0}}
@keyframes tf-b{0%,48%{opacity:0}52%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tf-field{0%,32%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}36%,54%{box-shadow:0 0 0 3px ${primary(0.25)};border-color:${primary()}}62%,100%{box-shadow:0 0 0 0 transparent;border-color:${C.border}}}
@keyframes tf-menu{0%,36%{opacity:0;transform:translateY(-4px)}40%,47%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(0)}}
@keyframes tf-hl{0%,42%{background:transparent}44%,47%{background:${primary(0.14)}}50%,100%{background:transparent}}
@keyframes tf-extra{0%,48%{opacity:0;transform:translateY(-4px)}54%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes tf-cursor{0%,18%{transform:translate(260px,280px);opacity:0}24%{opacity:1}34%,38%{transform:translate(112px,190px);opacity:1}44%,48%{transform:translate(70px,229px);opacity:1}64%,88%{transform:translate(330px,250px);opacity:1}94%,100%{transform:translate(330px,250px);opacity:0}}
@keyframes tf-ring{0%,34%{opacity:0;transform:scale(.4)}36%{opacity:1;transform:scale(1)}40%{opacity:0;transform:scale(1.6)}44%{opacity:0;transform:scale(.4)}46%{opacity:1;transform:scale(1)}50%,100%{opacity:0;transform:scale(1.6)}}
`;

function Swap({ a, b, size, weight = 600, color }: { a: string; b: string; size: number; weight?: number; color?: string }): JSX.Element {
    return (
        <span style={{ display: 'inline-grid' }}>
            <span data-a="" style={{ gridArea: '1/1', opacity: 0, animationName: 'tf-a' }}>
                <T size={size} weight={weight} color={color}>
                    {a}
                </T>
            </span>
            <span data-a="" style={{ gridArea: '1/1', animationName: 'tf-b' }}>
                <T size={size} weight={weight} color={color}>
                    {b}
                </T>
            </span>
        </span>
    );
}

function Field({ label, children, a }: { label: string; children: JSX.Element; a?: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={7.5} weight={600} color={C.mutedFg}>
                {label}
            </T>
            <span
                data-a={a ? '' : undefined}
                style={{
                    height: 19,
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    background: C.card,
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 6px',
                    animationName: a,
                }}
            >
                <span style={{ flex: 1 }}>{children}</span>
                <ChevronDown size={9} color={C.mutedFg} />
            </span>
        </div>
    );
}

export default function TabConfigurar(): JSX.Element {
    return (
        <Stage label="El formulario de un widget: al elegir el campo a medir «Monto», el cálculo pasa de «Contar registros» a «Suma» y la vista previa de las barras se recalcula al instante." tint="blue">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={14} y={12} w={452} h={276} title="Nuevo widget">
                    <At x={12} y={10} w={168} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Field label="Título">
                            <Swap a="Oportunidades por etapa" b="Monto por etapa" size={8.5} />
                        </Field>
                        <Field label="Tipo">
                            <T size={8.5} weight={600}>
                                Gráfico de barras
                            </T>
                        </Field>
                        <Field label="Lista">
                            <T size={8.5} weight={600}>
                                Oportunidades
                            </T>
                        </Field>
                        <Field label="Campo a medir" a="tf-field">
                            <Swap a="(Todos los registros)" b="Monto" size={8.5} />
                        </Field>
                        <Field label="Cálculo">
                            <Swap a="Contar registros" b="Suma" size={8.5} />
                        </Field>
                        <Field label="Agrupar por">
                            <T size={8.5} weight={600}>
                                Etapa
                            </T>
                        </Field>
                    </At>
                    {/* Menú del cálculo */}
                    <At
                        x={12}
                        y={161}
                        w={168}
                        a="tf-menu"
                        style={{
                            opacity: 0,
                            zIndex: 4,
                            background: C.card,
                            border: `1px solid ${C.border}`,
                            borderRadius: 7,
                            padding: 4,
                            boxShadow: '0 12px 28px -12px rgba(15,23,42,.45)',
                            display: 'flex',
                            flexDirection: 'column',
                        }}
                    >
                        {['(Todos los registros)', 'Monto', 'Probabilidad', 'Cierre estimado'].map((o) => (
                            <span
                                key={o}
                                data-a={o === 'Monto' ? '' : undefined}
                                style={{ padding: '3px 6px', borderRadius: 4, animationName: o === 'Monto' ? 'tf-hl' : undefined }}
                            >
                                <T size={8.5}>{o}</T>
                            </span>
                        ))}
                    </At>

                    {/* Vista previa */}
                    <At x={192} y={10} w={248} h={228} style={{ border: `1px dashed ${C.border}`, borderRadius: 9, background: C.muted, padding: 8 }}>
                        <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            VISTA PREVIA
                        </T>
                        <div style={{ marginTop: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', height: 192 }}>
                            <Swap a="Oportunidades por etapa" b="Monto por etapa" size={9} weight={700} />
                            <div>
                                <Swap a="Conteo · Oportunidades" b="Suma · Oportunidades" size={7} weight={500} color={C.mutedFg} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                                {BARS.map((b, i) => (
                                    <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 12 }}>
                                        <span style={{ width: 50, textAlign: 'right' }}>
                                            <T size={7.5} color={C.mutedFg}>
                                                {b.label}
                                            </T>
                                        </span>
                                        <span style={{ position: 'relative', width: 116, height: 10, borderRadius: 3, background: C.muted }}>
                                            <span
                                                data-a=""
                                                style={{
                                                    position: 'absolute',
                                                    left: 0,
                                                    top: 0,
                                                    height: 10,
                                                    width: b.b,
                                                    borderRadius: 3,
                                                    background: tone(b.t),
                                                    animationName: `tf-bar${i}`,
                                                }}
                                            />
                                        </span>
                                        <Swap a={b.va} b={b.vb} size={7.5} weight={700} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </At>
                </Win>
                <Cursor a="tf-cursor" click="tf-ring" rest={[330, 250]} />
            </div>
        </Stage>
    );
}
