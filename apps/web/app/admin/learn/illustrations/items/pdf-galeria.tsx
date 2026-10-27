import { Check, ChevronDown, FileText, ListChecks, Receipt, ScrollText, Sparkles } from 'lucide-react';

import { At, C, Cursor, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Nueva plantilla de documento: se elige «Cuenta de cobro» en la galería y en
 * el segundo paso la app sugiere qué campo de la lista va en cada lugar, y se
 * cargan los datos de quien cobra.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const STARTERS: Array<{ name: string; desc: string; t: Tn; icon: JSX.Element; dian?: boolean }> = [
    { name: 'Cuenta de cobro', desc: 'Concepto, valor en letras, datos bancarios y firma.', t: 'amber', icon: <Receipt size={12} /> },
    { name: 'Cuenta de cobro con detalle', desc: 'Con tabla de ítems y total sumado solo.', t: 'blue', icon: <ListChecks size={12} /> },
    { name: 'Cotización', desc: 'Ítems, descuentos, IVA, validez y condiciones.', t: 'violet', icon: <ScrollText size={12} /> },
    { name: 'Factura (no electrónica)', desc: 'Base gravable, IVA, forma de pago.', t: 'mint', icon: <FileText size={12} />, dian: true },
];

const MAP: Array<[string, string]> = [
    ['Nombre del cliente', 'Cliente'],
    ['NIT o cédula del cliente', 'NIT'],
    ['Concepto (qué se cobra)', 'Servicio'],
    ['Valor a cobrar', 'Total'],
];

const mapKeys = MAP.map(
    (_, i) => `@keyframes pg-m${i}{0%,${40 + i * 5}%{opacity:0;transform:translateX(-6px)}${45 + i * 5}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}`,
).join('\n');

const CSS = `
${mapKeys}
@keyframes pg-step1{0%,30%{opacity:1;transform:translateX(0)}36%,100%{opacity:0;transform:translateX(-20px)}}
@keyframes pg-step2{0%,32%{opacity:0;transform:translateX(24px)}38%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes pg-sel{0%,18%{box-shadow:0 0 0 0 transparent}22%,32%{box-shadow:0 0 0 2px ${primary(0.6)}}36%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pg-issuer{0%,64%{opacity:0}70%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pg-btn{0%,78%{transform:scale(1)}81%{transform:scale(.95)}84%,100%{transform:scale(1)}}
@keyframes pg-cursor{0%,6%{transform:translate(400px,280px);opacity:0}10%{opacity:1}20%,28%{transform:translate(128px,98px);opacity:1}42%,74%{transform:translate(330px,150px);opacity:1}80%,88%{transform:translate(383px,272px);opacity:1}94%,100%{transform:translate(383px,272px);opacity:0}}
@keyframes pg-ring{0%,22%{opacity:0;transform:scale(.4)}24%{opacity:1;transform:scale(1)}28%{opacity:0;transform:scale(1.6)}79%{opacity:0;transform:scale(.4)}81%{opacity:1;transform:scale(1)}85%,100%{opacity:0;transform:scale(1.6)}}
`;

function Input({ w, children }: { w: number; children: JSX.Element | string }): JSX.Element {
    return (
        <span style={{ width: w, height: 16, borderRadius: 5, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', padding: '0 5px', gap: 3 }}>
            <span style={{ flex: 1, minWidth: 0, display: 'flex' }}>{children}</span>
        </span>
    );
}

export default function PdfGaleria(): JSX.Element {
    return (
        <Stage label="Nueva plantilla de documento: se elige «Cuenta de cobro» y en el segundo paso la app sugiere qué campo de la lista va en cada lugar (cliente, NIT, concepto, valor) y se cargan los datos de quien cobra." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={14} y={12} w={452} h={276} title="Nueva plantilla de documento">
                    {/* Paso 1: la galería */}
                    <At x={0} y={0} w={450} h={250} a="pg-step1" style={{ opacity: 0 }}>
                        <At x={14} y={10}>
                            <T size={8.5} color={C.mutedFg}>
                                Elige un punto de partida. Después cambias todo en el editor.
                            </T>
                        </At>
                        {STARTERS.map((s, i) => (
                            <At
                                key={s.name}
                                x={14 + (i % 2) * 214}
                                y={30 + Math.floor(i / 2) * 76}
                                w={206}
                                h={68}
                                a={i === 0 ? 'pg-sel' : undefined}
                                style={{ border: `1px solid ${C.border}`, borderRadius: 9, background: C.card, padding: '8px 9px', display: 'flex', gap: 8 }}
                            >
                                <IconSquare t={s.t} size={24}>
                                    {s.icon}
                                </IconSquare>
                                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                                    <T size={9} weight={700}>
                                        {s.name}
                                    </T>
                                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                        {s.desc}
                                    </T>
                                    {s.dian && (
                                        <span style={{ display: 'inline-flex', alignSelf: 'flex-start', height: 13, alignItems: 'center', padding: '0 5px', borderRadius: 99, background: tone('amber', 0.16) }}>
                                            <T size={6.5} weight={700} color={tone('amber')}>
                                                No es factura electrónica DIAN
                                            </T>
                                        </span>
                                    )}
                                </span>
                            </At>
                        ))}
                        <At x={14} y={186} w={420} h={44} style={{ border: `1px dashed ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
                            <Sparkles size={12} color={C.mutedFg} />
                            <T size={8.5} weight={600}>
                                En blanco
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                Una hoja con un encabezado para armar desde cero.
                            </T>
                        </At>
                    </At>

                    {/* Paso 2: el mapeo */}
                    <At x={0} y={0} w={450} h={250} a="pg-step2">
                        <At x={14} y={9} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <IconSquare t="amber" size={18}>
                                <Receipt size={10} />
                            </IconSquare>
                            <T size={10} weight={700}>
                                Cuenta de cobro
                            </T>
                        </At>
                        <At x={14} y={36} w={206}>
                            <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                                DATOS DE ESTA LISTA
                            </T>
                            {MAP.map(([role, field], i) => (
                                <div key={role} data-a="" style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7, animationName: `pg-m${i}` }}>
                                    <T size={7.5} weight={600} style={{ width: 92, whiteSpace: 'normal' }}>
                                        {role}
                                    </T>
                                    <Input w={80}>
                                        <T size={7.5}>{`«${field}»`}</T>
                                    </Input>
                                    <ChevronDown size={8} color={C.mutedFg} style={{ marginLeft: -16 }} />
                                    <span style={{ width: 11, height: 11, borderRadius: 99, background: tone('mint'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
                                        <Check size={7} strokeWidth={3} />
                                    </span>
                                </div>
                            ))}
                        </At>
                        <At x={236} y={36} w={200} a="pg-issuer">
                            <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em', display: 'block', marginBottom: 6 }}>
                                QUIÉN COBRA
                            </T>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                                <Input w={96}>
                                    <T size={7.5}>Laura Gómez</T>
                                </Input>
                                <Input w={96}>
                                    <T size={7.5}>C.C. 52.345.678</T>
                                </Input>
                                <Input w={96}>
                                    <T size={7.5}>Bogotá</T>
                                </Input>
                                <Input w={96}>
                                    <T size={7.5}>300 555 1234</T>
                                </Input>
                            </div>
                            <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em', display: 'block', margin: '10px 0 6px' }}>
                                DÓNDE TE PAGAN
                            </T>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                                <Input w={96}>
                                    <T size={7.5}>Bancolombia</T>
                                </Input>
                                <Input w={96}>
                                    <T size={7.5}>Ahorros</T>
                                </Input>
                            </div>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 10 }}>
                                <span style={{ width: 11, height: 11, borderRadius: 3, background: primary(), color: C.primaryFg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Check size={8} strokeWidth={3} />
                                </span>
                                <T size={7.5}>Congelar el documento al emitirlo</T>
                            </span>
                        </At>
                        <At x={300} y={222} w={136} h={20}>
                            <span
                                data-a=""
                                style={{ height: 20, borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'pg-btn' }}
                            >
                                <T size={8} weight={700} color={C.primaryFg}>
                                    Crear y abrir el editor
                                </T>
                            </span>
                        </At>
                    </At>
                </Win>
                <Cursor a="pg-cursor" click="pg-ring" rest={[383, 272]} />
            </div>
        </Stage>
    );
}
