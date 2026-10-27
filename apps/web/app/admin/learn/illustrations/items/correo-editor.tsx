import { Columns2, Heading, Image, Minus, MousePointerClick, PenLine, Redo2, Table, Type, Undo2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * El editor visual de correos: se arrastra el bloque «Botón» del panel al
 * correo, una línea marca dónde cae, el botón aparece elegido y a la derecha
 * se editan su texto y su enlace.
 */

const INK = '#1f2937';
const SOFT = '#6b7280';
const BRAND = '#0e7490';

const CSS = `
@keyframes cd-ghost{0%,12%{opacity:0;transform:translate(0,0)}16%{opacity:1;transform:translate(0,0)}40%{opacity:1;transform:translate(156px,-12px)}44%,100%{opacity:0;transform:translate(156px,-12px)}}
@keyframes cd-tile{0%,12%{background:transparent}14%,40%{background:${primary(0.14)}}46%,100%{background:transparent}}
@keyframes cd-line{0%,30%{opacity:0}34%,42%{opacity:1}46%,100%{opacity:0}}
@keyframes cd-btn{0%,42%{opacity:0;max-height:0;margin-top:0}48%,92%{opacity:1;max-height:40px;margin-top:8px}97%,100%{opacity:0;max-height:40px;margin-top:8px}}
@keyframes cd-sel{0%,48%{box-shadow:0 0 0 0 transparent}52%,92%{box-shadow:0 0 0 2px ${primary()}}97%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes cd-insp{0%,52%{opacity:0;transform:translateX(10px)}60%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes cd-hint{0%,48%{opacity:1}54%,100%{opacity:0}}
@keyframes cd-type{0%,64%{width:0}78%,100%{width:52px}}
`;

const TILES: Array<[string, JSX.Element]> = [
    ['Título', <Heading key="a" size={11} />],
    ['Texto', <Type key="b" size={11} />],
    ['Botón', <MousePointerClick key="c" size={11} />],
    ['Imagen', <Image key="d" size={11} />],
    ['Datos', <Table key="e" size={11} />],
    ['Columnas', <Columns2 key="f" size={11} />],
    ['Separador', <Minus key="g" size={11} />],
    ['Firma', <PenLine key="h" size={11} />],
];

export default function CorreoEditor(): JSX.Element {
    return (
        <Stage label="En el editor visual se arrastra el bloque «Botón» del panel al correo: una línea marca dónde cae, el botón aparece elegido y a la derecha se escribe su texto y su enlace." tint="violet">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={10} y={12} w={460} h={276} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)' }}>
                    {/* Barra superior */}
                    <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={700}>
                            Diseñar correo
                        </T>
                        <span style={{ height: 18, padding: '0 7px', borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                            <T size={7.5} weight={600}>
                                Plantillas
                            </T>
                        </span>
                        <Undo2 size={11} color={C.mutedFg} />
                        <Redo2 size={11} color={C.mutedFg} />
                        <span style={{ marginLeft: 'auto', display: 'flex', height: 18, borderRadius: 5, background: C.muted, padding: 2, gap: 2 }}>
                            {['Escritorio', 'Celular'].map((o, i) => (
                                <span key={o} style={{ padding: '0 6px', borderRadius: 3, display: 'flex', alignItems: 'center', background: i === 0 ? C.card : 'transparent' }}>
                                    <T size={7} weight={600} color={i === 0 ? C.fg : C.mutedFg}>
                                        {o}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <span style={{ height: 18, padding: '0 8px', borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center' }}>
                            <T size={7.5} weight={700} color={C.primaryFg}>
                                Listo
                            </T>
                        </span>
                    </div>

                    {/* Panel izquierdo */}
                    <div style={{ position: 'absolute', left: 0, top: 30, bottom: 0, width: 118, borderRight: `1px solid ${C.border}`, padding: 7 }}>
                        <span style={{ display: 'flex', gap: 2, marginBottom: 7 }}>
                            {['Agregar', 'Estructura', 'Estilo'].map((o, i) => (
                                <span key={o} style={{ flex: 1, height: 16, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? primary(0.12) : 'transparent' }}>
                                    <T size={6.5} weight={700} color={i === 0 ? primary() : C.mutedFg}>
                                        {o}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <span style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                            {TILES.map(([name, icon]) => (
                                <span
                                    key={name}
                                    data-a={name === 'Botón' ? '' : undefined}
                                    style={{ height: 40, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, color: C.mutedFg, animationName: name === 'Botón' ? 'cd-tile' : undefined }}
                                >
                                    {icon}
                                    <T size={7} weight={600} color={C.fg}>
                                        {name}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </div>

                    {/* Vista previa */}
                    <div style={{ position: 'absolute', left: 118, top: 30, bottom: 0, width: 200, background: C.muted, display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                        <div style={{ width: 172, alignSelf: 'flex-start', background: '#fff', borderRadius: 6, padding: 10, boxShadow: '0 6px 18px -8px rgba(15,23,42,.35)' }}>
                            <T size={10} weight={800} color={INK} style={{ display: 'block', lineHeight: 1.2 }}>
                                Tu cuenta de cobro está lista
                            </T>
                            <T size={7} color={SOFT} style={{ display: 'block', whiteSpace: 'normal', lineHeight: 1.4, marginTop: 6 }}>
                                Hola Ana, te compartimos la cuenta de cobro de octubre por $ 1.250.000.
                            </T>
                            <span data-a="" style={{ display: 'block', height: 2, borderRadius: 2, background: primary(), marginTop: 7, opacity: 0, animationName: 'cd-line' }} />
                            <span data-a="" style={{ display: 'flex', justifyContent: 'center', overflow: 'hidden', borderRadius: 4, animationName: 'cd-btn, cd-sel' }}>
                                <span style={{ padding: '5px 14px', borderRadius: 5, background: BRAND, margin: 3 }}>
                                    <T size={7.5} weight={700} color="#fff">
                                        Pagar ahora
                                    </T>
                                </span>
                            </span>
                            <span style={{ display: 'block', borderTop: '1px solid #e5e7eb', marginTop: 9, paddingTop: 6 }}>
                                <T size={7} weight={700} color={INK} style={{ display: 'block' }}>
                                    Laura Gómez
                                </T>
                                <T size={6.5} color={SOFT}>
                                    Café Aurora
                                </T>
                            </span>
                        </div>
                    </div>

                    <div data-a="" style={{ position: 'absolute', left: 326, top: 110, right: 10, textAlign: 'center', opacity: 0, animationName: 'cd-hint' }}>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', lineHeight: 1.4 }}>
                            Toca un bloque en la vista previa para editarlo.
                        </T>
                    </div>
                    {/* Inspector */}
                    <div data-a="" style={{ position: 'absolute', left: 318, top: 30, bottom: 0, right: 0, borderLeft: `1px solid ${C.border}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 6, animationName: 'cd-insp' }}>
                        <T size={8.5} weight={700}>
                            Botón
                        </T>
                        <span style={{ display: 'flex', gap: 2, height: 17, borderRadius: 5, background: C.muted, padding: 2 }}>
                            {['Contenido', 'Estilo'].map((o, i) => (
                                <span key={o} style={{ flex: 1, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: i === 0 ? C.card : 'transparent' }}>
                                    <T size={7} weight={600} color={i === 0 ? C.fg : C.mutedFg}>
                                        {o}
                                    </T>
                                </span>
                            ))}
                        </span>
                        <T size={7} weight={600} color={C.mutedFg}>
                            Texto del botón
                        </T>
                        <span style={{ height: 19, borderRadius: 5, border: `1px solid ${primary()}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <span data-a="" style={{ overflow: 'hidden', whiteSpace: 'nowrap', display: 'inline-block', animationName: 'cd-type' }}>
                                <T size={8}>Pagar ahora</T>
                            </span>
                        </span>
                        <T size={7} weight={600} color={C.mutedFg}>
                            Enlace
                        </T>
                        <span style={{ height: 19, borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            <T size={7.5} weight={700} color={primary()}>
                                {'{{pago.link}}'}
                            </T>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <span style={{ width: 13, height: 13, borderRadius: 4, background: BRAND }} />
                            <T size={7.5}>Color del botón</T>
                        </span>
                    </div>
                </At>

                {/* Bloque arrastrado */}
                <At x={24} y={128} a="cd-ghost" style={{ zIndex: 30, opacity: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 24, padding: '0 9px', borderRadius: 6, background: C.card, border: `1px solid ${primary()}`, boxShadow: '0 10px 20px -8px rgba(15,23,42,.45)', color: primary() }}>
                        <MousePointerClick size={11} />
                        <T size={8} weight={700} color={primary()}>
                            Botón
                        </T>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
