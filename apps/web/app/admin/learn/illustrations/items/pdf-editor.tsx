import { Braces, Database, Grip, Heading, Image, PenLine, QrCode, Redo2, Rows3, Sigma, Table, Type, Undo2 } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El editor de documentos: a la izquierda los bloques, al centro la hoja real
 * y a la derecha los ajustes del bloque elegido. Se arrastra un «Código QR» a
 * la hoja y aparece con sus opciones.
 */

const PAPER = '#ffffff';
const INK = '#1f2937';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';

const CSS = `
@keyframes pe-drag{0%,14%{opacity:0;transform:translate(0,0)}16%{opacity:1;transform:translate(0,0) scale(1.04)}40%{opacity:1;transform:translate(140px,26px) scale(1.04)}44%,100%{opacity:0;transform:translate(140px,26px) scale(1)}}
@keyframes pe-drop{0%,30%{opacity:0}34%,42%{opacity:1}46%,100%{opacity:0}}
@keyframes pe-qr{0%,42%{opacity:0;transform:scale(.6)}48%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes pe-sel{0%,44%{box-shadow:0 0 0 0 transparent}48%,92%{box-shadow:0 0 0 2px ${primary()}}97%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pe-insp-a{0%,44%{opacity:1}48%,100%{opacity:0}}
@keyframes pe-insp-b{0%,44%{opacity:0}48%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pe-pal{0%,12%{background:transparent}14%,40%{background:${primary(0.12)}}44%,100%{background:transparent}}
@keyframes pe-cursor{0%,4%{transform:translate(70px,270px);opacity:0}8%{opacity:1}13%,16%{transform:translate(50px,200px);opacity:1}40%,44%{transform:translate(190px,222px);opacity:1}60%,88%{transform:translate(400px,120px);opacity:1}94%,100%{transform:translate(400px,120px);opacity:0}}
@keyframes pe-ring{0%,13%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}19%,100%{opacity:0;transform:scale(1.6)}}
`;

const PALETTE: Array<[string, JSX.Element]> = [
    ['Encabezado', <Rows3 key="a" size={10} />],
    ['Título', <Heading key="b" size={10} />],
    ['Texto', <Type key="c" size={10} />],
    ['Datos del registro', <Database key="d" size={10} />],
    ['Tabla de ítems', <Table key="e" size={10} />],
    ['Totales', <Sigma key="f" size={10} />],
    ['Código QR', <QrCode key="g" size={10} />],
    ['Imagen', <Image key="h" size={10} />],
    ['Firma', <PenLine key="i" size={10} />],
];

/** Un QR dibujado (cuadritos fijos, se ve como uno real). */
function Qr({ size }: { size: number }): JSX.Element {
    const cells = [
        '1111111001011111',
        '1000001011010001',
        '1011101001011101',
        '1011101110011101',
        '1011101010011101',
        '1000001101010001',
        '1111111010111111',
        '0000000110100000',
        '1101011001011010',
        '0110100110101101',
        '1011011010010110',
        '0000000101101001',
        '1111111010010110',
        '1000001101101010',
        '1011101010110101',
        '1111111011010110',
    ];
    const c = size / 16;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <rect width={size} height={size} fill={PAPER} />
            {cells.flatMap((row, y) => row.split('').map((v, x) => (v === '1' ? <rect key={`${x}-${y}`} x={x * c} y={y * c} width={c} height={c} fill={INK} /> : null)))}
        </svg>
    );
}

export default function PdfEditor(): JSX.Element {
    return (
        <Stage label="El editor de documentos: bloques a la izquierda, la hoja real al centro y los ajustes del bloque a la derecha. Se arrastra un «Código QR» a la hoja y aparece con su contenido y su texto." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={10} y={10} w={460} h={280} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)' }}>
                    {/* Barra superior */}
                    <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={9.5} weight={700}>
                            Diseñar documento
                        </T>
                        <span style={{ height: 18, padding: '0 7px', borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                            <T size={8}>Cuenta de cobro</T>
                        </span>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 5, color: C.mutedFg, alignItems: 'center' }}>
                            <Undo2 size={11} />
                            <Redo2 size={11} />
                            <span style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 5, padding: 2, gap: 2 }}>
                                <span style={{ padding: '1px 3px', borderRadius: 3, background: C.muted }}>
                                    <Database size={9} />
                                </span>
                                <span style={{ padding: '1px 3px' }}>
                                    <Braces size={9} />
                                </span>
                            </span>
                            <span style={{ height: 18, padding: '0 8px', borderRadius: 5, background: primary(), display: 'flex', alignItems: 'center' }}>
                                <T size={8} weight={700} color={C.primaryFg}>
                                    Guardar
                                </T>
                            </span>
                        </span>
                    </div>
                    {/* Paleta */}
                    <div style={{ position: 'absolute', left: 0, top: 30, bottom: 0, width: 108, borderRight: `1px solid ${C.border}`, padding: '6px 6px' }}>
                        <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
                            {['Agregar', 'Estructura', 'Hoja'].map((t, i) => (
                                <span key={t} style={{ flex: 1, textAlign: 'center', padding: '2px 0', borderRadius: 4, background: i === 0 ? C.muted : 'transparent' }}>
                                    <T size={6.5} weight={i === 0 ? 700 : 500} color={i === 0 ? C.fg : C.mutedFg}>
                                        {t}
                                    </T>
                                </span>
                            ))}
                        </div>
                        {PALETTE.map(([name, icon]) => (
                            <span
                                key={name}
                                data-a={name === 'Código QR' ? '' : undefined}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    height: 21,
                                    padding: '0 5px',
                                    borderRadius: 5,
                                    color: C.mutedFg,
                                    animationName: name === 'Código QR' ? 'pe-pal' : undefined,
                                }}
                            >
                                {icon}
                                <T size={7.5} weight={600}>
                                    {name}
                                </T>
                            </span>
                        ))}
                    </div>
                    {/* Lienzo */}
                    <div style={{ position: 'absolute', left: 108, right: 120, top: 30, bottom: 0, background: C.muted }} />
                    <div
                        style={{
                            position: 'absolute',
                            left: 130,
                            top: 40,
                            width: 188,
                            height: 230,
                            background: PAPER,
                            boxShadow: '0 6px 18px -8px rgba(15,23,42,.35)',
                            padding: '10px 12px',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ width: 16, height: 16, borderRadius: 4, background: primary() }} />
                            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                <T size={6.5} weight={800} color={primary()}>
                                    CUENTA DE COBRO
                                </T>
                                <T size={5.5} color={SOFT}>
                                    N.º CC-0042
                                </T>
                            </span>
                        </div>
                        <T size={5.5} weight={700} color={SOFT} style={{ display: 'block', marginTop: 10, letterSpacing: '.06em' }}>
                            DEBE A
                        </T>
                        <T size={7.5} weight={700} color={INK} style={{ display: 'block' }}>
                            Hotel Brisas del Mar
                        </T>
                        {[0, 1, 2].map((k) => (
                            <span key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${LINE}`, marginTop: k === 0 ? 8 : 0, height: 12, alignItems: 'center' }}>
                                <span style={{ display: 'block', width: [70, 56, 80][k], height: 4, borderRadius: 2, background: LINE }} />
                                <span style={{ display: 'block', width: 26, height: 4, borderRadius: 2, background: LINE }} />
                            </span>
                        ))}
                        <span style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                            <span style={{ padding: '2px 5px', background: primary(0.12), borderRadius: 2 }}>
                                <T size={7} weight={800} color={INK}>
                                    $ 1.250.000
                                </T>
                            </span>
                        </span>
                        <T size={5.5} color={SOFT} style={{ display: 'block', marginTop: 4, whiteSpace: 'normal' }}>
                            Son: un millón doscientos cincuenta mil pesos M/CTE.
                        </T>
                        {/* Línea de dónde cae */}
                        <span data-a="" style={{ position: 'absolute', left: 10, right: 10, top: 160, height: 2, borderRadius: 2, background: primary(), opacity: 0, animationName: 'pe-drop' }} />
                        {/* El QR que se agrega */}
                        <div data-a="" style={{ position: 'absolute', left: 12, top: 166, display: 'flex', alignItems: 'center', gap: 8, padding: 4, borderRadius: 4, animationName: 'pe-qr, pe-sel' }}>
                            <Qr size={44} />
                            <span style={{ display: 'flex', flexDirection: 'column' }}>
                                <T size={6.5} weight={700} color={INK}>
                                    Escanea para pagar
                                </T>
                                <T size={5.5} color={SOFT}>
                                    pagar.link/cc-0042
                                </T>
                            </span>
                        </div>
                    </div>
                    {/* Inspector */}
                    <div style={{ position: 'absolute', right: 0, top: 30, bottom: 0, width: 120, borderLeft: `1px solid ${C.border}`, padding: 8 }}>
                        <div data-a="" style={{ position: 'absolute', left: 8, right: 8, top: 10, animationName: 'pe-insp-a', opacity: 0 }}>
                            <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                Toca un bloque en el documento para editarlo.
                            </T>
                        </div>
                        <div data-a="" style={{ animationName: 'pe-insp-b' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <QrCode size={10} color={C.mutedFg} />
                                <T size={8.5} weight={700}>
                                    Código QR
                                </T>
                            </span>
                            <div style={{ display: 'flex', marginTop: 7, borderRadius: 5, background: C.muted, padding: 2 }}>
                                <span style={{ flex: 1, textAlign: 'center', borderRadius: 4, background: C.card, padding: '1px 0' }}>
                                    <T size={7} weight={700}>
                                        Contenido
                                    </T>
                                </span>
                                <span style={{ flex: 1, textAlign: 'center', padding: '1px 0' }}>
                                    <T size={7} color={C.mutedFg}>
                                        Estilo
                                    </T>
                                </span>
                            </div>
                            <T size={7} weight={600} color={C.mutedFg} style={{ display: 'block', marginTop: 8 }}>
                                Contenido del código
                            </T>
                            <span style={{ display: 'flex', alignItems: 'center', height: 18, marginTop: 3, borderRadius: 5, border: `1px solid ${C.border}`, padding: '0 4px', gap: 3 }}>
                                <span style={{ padding: '0 4px', borderRadius: 4, background: tone('violet', 0.16) }}>
                                    <T size={7} weight={700} color={tone('violet')}>
                                        pago.link
                                    </T>
                                </span>
                            </span>
                            <T size={7} weight={600} color={C.mutedFg} style={{ display: 'block', marginTop: 8 }}>
                                Texto debajo (opcional)
                            </T>
                            <span style={{ display: 'flex', alignItems: 'center', height: 18, marginTop: 3, borderRadius: 5, border: `1px solid ${C.border}`, padding: '0 5px' }}>
                                <T size={7.5}>Escanea para pagar</T>
                            </span>
                            <T size={6.5} color={C.mutedFg} style={{ display: 'block', marginTop: 8, whiteSpace: 'normal' }}>
                                Si queda vacío para un registro, el código no se dibuja.
                            </T>
                        </div>
                    </div>
                </At>
                {/* El bloque que se arrastra */}
                <At
                    x={22}
                    y={190}
                    a="pe-drag"
                    style={{
                        opacity: 0,
                        zIndex: 6,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        height: 22,
                        padding: '0 8px',
                        borderRadius: 6,
                        background: C.card,
                        border: `1px solid ${primary()}`,
                        boxShadow: '0 12px 24px -10px rgba(15,23,42,.45)',
                    }}
                >
                    <Grip size={9} color={C.mutedFg} />
                    <QrCode size={10} />
                    <T size={7.5} weight={700}>
                        Código QR
                    </T>
                </At>
                <Cursor a="pe-cursor" click="pe-ring" rest={[400, 120]} />
            </div>
        </Stage>
    );
}
