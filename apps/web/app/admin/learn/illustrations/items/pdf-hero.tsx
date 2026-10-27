import { Download, FileText, Mail, Paperclip } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de «Documentos PDF»: una cuenta de cobro se arma sola con los datos
 * del registro (encabezado, cliente, ítems, total en letras y firma), recibe
 * su número y sale como archivo y por correo.
 *
 * La hoja es blanca también en modo oscuro: es papel (un PDF siempre se
 * imprime así), por eso usa colores fijos de tinta sobre blanco.
 */

const PAPER = '#ffffff';
const INK = '#1f2937';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';

const STEPS = 6;
const blockKeys = Array.from({ length: STEPS }, (_, i) => {
    const s = 4 + i * 6;
    return `@keyframes ph-b${i}{0%,${s}%{opacity:0;transform:translateY(6px)}${s + 6}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}`;
}).join('\n');

const CSS = `
${blockKeys}
@keyframes ph-stamp{0%,40%{opacity:0;transform:scale(1.8) rotate(-8deg)}46%{opacity:1;transform:scale(.92) rotate(-8deg)}50%,92%{opacity:1;transform:scale(1) rotate(-8deg)}97%,100%{opacity:0;transform:scale(1) rotate(-8deg)}}
@keyframes ph-out1{0%,54%{opacity:0;transform:translateX(-18px)}62%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes ph-out2{0%,64%{opacity:0;transform:translateX(-18px)}72%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes ph-fly{0%,56%{opacity:0;transform:translate(0,0) scale(.6)}60%{opacity:1}70%{opacity:1;transform:translate(70px,-10px) scale(1)}74%,100%{opacity:0;transform:translate(70px,-10px) scale(1)}}
`;

function Row({ d, q, v }: { d: string; q: string; v: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', height: 13, borderBottom: `1px solid ${LINE}` }}>
            <span style={{ flex: 1 }}>
                <T size={6.5} color={INK}>
                    {d}
                </T>
            </span>
            <span style={{ width: 22, textAlign: 'center' }}>
                <T size={6.5} color={INK}>
                    {q}
                </T>
            </span>
            <span style={{ width: 48, textAlign: 'right' }}>
                <T size={6.5} color={INK} weight={600}>
                    {v}
                </T>
            </span>
        </div>
    );
}

export default function PdfHero(): JSX.Element {
    return (
        <Stage label="Una cuenta de cobro se arma sola con los datos del registro: encabezado con el logo, datos del cliente, ítems, total con el monto en letras y la firma. Recibe su número CC-0042 y sale como PDF descargado y por correo." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                {/* La hoja */}
                <At
                    x={52}
                    y={14}
                    w={214}
                    h={274}
                    style={{ background: PAPER, borderRadius: 4, boxShadow: '0 18px 40px -16px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.06)', padding: '14px 16px' }}
                >
                    {/* Encabezado */}
                    <div data-a="" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', animationName: 'ph-b0' }}>
                        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <span style={{ width: 18, height: 18, borderRadius: 5, background: primary(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                <T size={8} weight={800} color={C.primaryFg}>
                                    CA
                                </T>
                            </span>
                            <span style={{ display: 'flex', flexDirection: 'column' }}>
                                <T size={7.5} weight={800} color={INK}>
                                    Café Aurora
                                </T>
                                <T size={5.5} color={SOFT}>
                                    NIT 901.234.567-1
                                </T>
                            </span>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <T size={7} weight={800} color={primary()}>
                                CUENTA DE COBRO
                            </T>
                            <T size={5.5} color={SOFT}>
                                Bogotá, 8 de octubre de 2026
                            </T>
                        </span>
                    </div>
                    {/* Cliente */}
                    <div data-a="" style={{ marginTop: 14, animationName: 'ph-b1' }}>
                        <T size={5.5} weight={700} color={SOFT} style={{ letterSpacing: '.06em', display: 'block' }}>
                            DEBE A
                        </T>
                        <T size={8} weight={700} color={INK} style={{ display: 'block', marginTop: 2 }}>
                            Hotel Brisas del Mar S.A.S.
                        </T>
                        <T size={6} color={SOFT} style={{ display: 'block', marginTop: 1 }}>
                            NIT 900.876.543-2 · Cartagena
                        </T>
                    </div>
                    {/* Ítems */}
                    <div data-a="" style={{ marginTop: 12, animationName: 'ph-b2' }}>
                        <div style={{ display: 'flex', height: 13, alignItems: 'center', background: primary(0.12), padding: '0 4px', borderRadius: 2 }}>
                            <span style={{ flex: 1 }}>
                                <T size={6} weight={700} color={INK}>
                                    Descripción
                                </T>
                            </span>
                            <span style={{ width: 22, textAlign: 'center' }}>
                                <T size={6} weight={700} color={INK}>
                                    Cant.
                                </T>
                            </span>
                            <span style={{ width: 48, textAlign: 'right' }}>
                                <T size={6} weight={700} color={INK}>
                                    Valor
                                </T>
                            </span>
                        </div>
                        <div style={{ padding: '0 4px' }}>
                            <Row d="Café de origen 500 g" q="20" v="$ 640.000" />
                            <Row d="Prensa francesa" q="5" v="$ 410.000" />
                            <Row d="Capacitación barista" q="1" v="$ 200.000" />
                        </div>
                    </div>
                    {/* Total */}
                    <div data-a="" style={{ marginTop: 9, display: 'flex', justifyContent: 'flex-end', animationName: 'ph-b3' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 6px', borderRadius: 3, background: primary(0.12) }}>
                            <T size={6.5} weight={800} color={INK}>
                                TOTAL A PAGAR
                            </T>
                            <T size={8.5} weight={800} color={INK}>
                                $ 1.250.000
                            </T>
                        </span>
                    </div>
                    <div data-a="" style={{ marginTop: 6, animationName: 'ph-b4' }}>
                        <T size={6} color={SOFT} style={{ whiteSpace: 'normal', display: 'block' }}>
                            Son: un millón doscientos cincuenta mil pesos M/CTE.
                        </T>
                    </div>
                    {/* Firma */}
                    <div data-a="" style={{ position: 'absolute', left: 16, bottom: 16, animationName: 'ph-b5' }}>
                        <span style={{ display: 'block', width: 90, borderTop: `1px solid ${INK}`, marginBottom: 2 }} />
                        <T size={6.5} weight={700} color={INK} style={{ display: 'block' }}>
                            Laura Gómez
                        </T>
                        <T size={5.5} color={SOFT}>
                            C.C. 52.345.678
                        </T>
                    </div>
                    {/* Sello del número */}
                    <At
                        x={124}
                        y={196}
                        a="ph-stamp"
                        style={{ transform: 'rotate(-8deg)', border: `2px solid ${tone('rose')}`, borderRadius: 6, padding: '3px 7px' }}
                    >
                        <T size={6} weight={800} color={tone('rose')} style={{ display: 'block', letterSpacing: '.08em' }}>
                            N.º
                        </T>
                        <T size={11} weight={800} color={tone('rose')}>
                            CC-0042
                        </T>
                    </At>
                </At>

                {/* Vuela al correo */}
                <At x={262} y={110} a="ph-fly" style={{ opacity: 0, color: primary() }}>
                    <FileText size={18} />
                </At>

                {/* Salidas */}
                <At
                    x={300}
                    y={66}
                    w={164}
                    a="ph-out1"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 10px', boxShadow: '0 12px 28px -16px rgba(15,23,42,.5)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: tone('blue', 0.16), color: tone('blue'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Mail size={12} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={8.5} weight={700}>
                                Tu cuenta de cobro
                            </T>
                            <T size={7} color={C.mutedFg}>
                                Para: compras@hotelbrisas.co
                            </T>
                        </span>
                    </span>
                    <span
                        style={{
                            marginTop: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            height: 22,
                            padding: '0 7px',
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            background: C.muted,
                        }}
                    >
                        <Paperclip size={10} color={C.mutedFg} />
                        <T size={7.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            Cuenta de cobro CC-0042.pdf
                        </T>
                    </span>
                </At>
                <At
                    x={300}
                    y={166}
                    w={164}
                    a="ph-out2"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '9px 10px', boxShadow: '0 12px 28px -16px rgba(15,23,42,.5)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, background: tone('mint', 0.16), color: tone('mint'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Download size={12} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={8.5} weight={700}>
                                Descargado y congelado
                            </T>
                            <T size={7} color={C.mutedFg}>
                                Siempre se entrega igual
                            </T>
                        </span>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
