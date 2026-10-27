import { Columns2, Heading, Image, Minus, MousePointerClick, PenLine, Smartphone, Table, Type } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Portada de «Correos»: un correo se arma con bloques (banda con el logo,
 * título, texto, datos del registro, botón y firma) y se ve igual en el
 * celular.
 *
 * El correo es blanco también en modo oscuro: es el diseño que recibe el
 * cliente (por defecto, claro), por eso usa colores fijos de tinta.
 */

const MAIL = '#ffffff';
const INK = '#1f2937';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';
/** Color de marca del correo de ejemplo: fijo, como el diseño que recibe el cliente. */
const BRAND = '#0e7490';

const N = 6;
const blockKeys = Array.from({ length: N }, (_, i) => {
    const s = 6 + i * 7;
    return `@keyframes ch-b${i}{0%,${s}%{opacity:0;transform:translateY(8px)}${s + 6}%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes ch-p${i}{0%,${s - 2}%{background:transparent}${s}%,${s + 6}%{background:${primary(0.14)}}${s + 10}%,100%{background:transparent}}`;
}).join('\n');

const CSS = `
${blockKeys}
@keyframes ch-phone{0%,58%{opacity:0;transform:translateX(18px)}68%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
`;

const PALETTE: Array<[string, JSX.Element]> = [
    ['Imagen', <Image key="a" size={10} />],
    ['Título', <Heading key="b" size={10} />],
    ['Texto', <Type key="c" size={10} />],
    ['Datos', <Table key="d" size={10} />],
    ['Botón', <MousePointerClick key="e" size={10} />],
    ['Firma', <PenLine key="f" size={10} />],
    ['Columnas', <Columns2 key="g" size={10} />],
    ['Separador', <Minus key="h" size={10} />],
];

function Mail({ scale = 1 }: { scale?: number }): JSX.Element {
    const s = (n: number): number => n * scale;
    return (
        <div style={{ background: MAIL, display: 'flex', flexDirection: 'column' }}>
            <div data-a="" style={{ background: BRAND, padding: `${s(10)}px ${s(12)}px`, display: 'flex', alignItems: 'center', gap: s(6), animationName: 'ch-b0' }}>
                <span style={{ width: s(16), height: s(16), borderRadius: s(4), background: 'rgba(255,255,255,.9)' }} />
                <T size={s(8.5)} weight={800} color="#fff">
                    Café Aurora
                </T>
            </div>
            <div style={{ padding: `${s(10)}px ${s(12)}px`, display: 'flex', flexDirection: 'column', gap: s(6) }}>
                <div data-a="" style={{ animationName: 'ch-b1' }}>
                    <T size={s(11)} weight={800} color={INK} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.2 }}>
                        ¡Gracias por tu compra, Ana!
                    </T>
                </div>
                <div data-a="" style={{ animationName: 'ch-b2' }}>
                    <T size={s(7)} color={SOFT} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.4 }}>
                        Tu pedido ya está en preparación. Te avisamos cuando salga.
                    </T>
                </div>
                <div data-a="" style={{ border: `1px solid ${LINE}`, borderRadius: s(5), animationName: 'ch-b3' }}>
                    {[
                        ['Pedido', 'PED-0187'],
                        ['Total', '$ 245.000'],
                        ['Entrega', '10/10/2026'],
                    ].map(([k, v], i) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: `${s(3)}px ${s(6)}px`, borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                            <T size={s(6.5)} color={SOFT}>
                                {k}
                            </T>
                            <T size={s(6.5)} weight={700} color={INK}>
                                {v}
                            </T>
                        </div>
                    ))}
                </div>
                <div data-a="" style={{ display: 'flex', justifyContent: 'center', animationName: 'ch-b4' }}>
                    <span style={{ padding: `${s(5)}px ${s(14)}px`, borderRadius: s(6), background: BRAND }}>
                        <T size={s(7.5)} weight={700} color="#fff">
                            Ver mi pedido
                        </T>
                    </span>
                </div>
                <div data-a="" style={{ borderTop: `1px solid ${LINE}`, paddingTop: s(6), animationName: 'ch-b5' }}>
                    <T size={s(6.5)} weight={700} color={INK} style={{ display: 'block', lineHeight: 1.3 }}>
                        Laura Gómez
                    </T>
                    <T size={s(6)} color={SOFT} style={{ display: 'block', lineHeight: 1.3 }}>
                        Atención al cliente · 300 555 1234
                    </T>
                </div>
            </div>
        </div>
    );
}

export default function CorreoHero(): JSX.Element {
    return (
        <Stage label="Un correo se arma con bloques en el editor visual: banda con el logo, título, texto, datos del pedido, botón y firma; y se ve igual en el celular." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={12} y={14} w={340} h={272} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)' }}>
                    <div style={{ height: 28, display: 'flex', alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={700}>
                            Diseñar correo
                        </T>
                        <span style={{ marginLeft: 'auto', height: 17, padding: '0 8px', borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center' }}>
                            <T size={7.5} weight={700} color={C.primaryFg}>
                                Listo
                            </T>
                        </span>
                    </div>
                    <div style={{ position: 'absolute', left: 0, top: 28, bottom: 0, width: 86, borderRight: `1px solid ${C.border}`, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {PALETTE.map(([name, icon], i) => (
                            <span
                                key={name}
                                data-a={i < N ? '' : undefined}
                                style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 5px', borderRadius: 5, color: C.mutedFg, animationName: i < N ? `ch-p${i}` : undefined }}
                            >
                                {icon}
                                <T size={7.5} weight={600}>
                                    {name}
                                </T>
                            </span>
                        ))}
                    </div>
                    <div style={{ position: 'absolute', left: 86, right: 0, top: 28, bottom: 0, background: C.muted, display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                        <div style={{ width: 200, borderRadius: 6, overflow: 'hidden', boxShadow: '0 6px 18px -8px rgba(15,23,42,.35)', alignSelf: 'flex-start' }}>
                            <Mail />
                        </div>
                    </div>
                </At>
                {/* Celular */}
                <At x={366} y={30} w={102} a="ch-phone">
                    <div style={{ borderRadius: 16, border: `4px solid ${C.fg}`, overflow: 'hidden', background: MAIL, height: 206, boxShadow: '0 16px 32px -16px rgba(15,23,42,.55)' }}>
                        <Mail scale={0.62} />
                    </div>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 5 }}>
                        <Smartphone size={9} color={C.mutedFg} />
                        <T size={7.5} weight={600} color={C.mutedFg}>
                            Celular
                        </T>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
