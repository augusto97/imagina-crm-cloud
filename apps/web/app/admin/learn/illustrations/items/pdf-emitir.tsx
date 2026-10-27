import { ChevronDown, Download, Eye, FileText, Link2, Lock, Paperclip, RotateCcw, ScrollText } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Generar desde la ficha: «Descargar» emite el número CC-0042 y congela el
 * PDF. Después, en «Documentos emitidos», un documento con un error se anula y
 * se emite de nuevo con el número siguiente.
 */

const CSS = `
@keyframes pm-menu{0%,8%{opacity:0;transform:translateY(-4px)}12%,30%{opacity:1;transform:translateY(0)}34%,100%{opacity:0;transform:translateY(0)}}
@keyframes pm-hl{0%,20%{background:transparent}23%,30%{background:${primary(0.12)}}34%,100%{background:transparent}}
@keyframes pm-toast{0%,32%{opacity:0;transform:translateY(8px)}36%,52%{opacity:1;transform:translateY(0)}56%,100%{opacity:0;transform:translateY(0)}}
@keyframes pm-list{0%,46%{opacity:0;transform:translateX(16px)}52%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes pm-a{0%,70%{opacity:1}74%,100%{opacity:0}}
@keyframes pm-b{0%,70%{opacity:0}74%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes pm-new{0%,74%{opacity:0;transform:translateY(-6px)}80%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes pm-cursor{0%,4%{transform:translate(60px,270px);opacity:0}8%{opacity:1}10%{transform:translate(65px,95px);opacity:1}24%,30%{transform:translate(70px,159px);opacity:1}62%,70%{transform:translate(424px,121px);opacity:1}84%,90%{transform:translate(424px,121px);opacity:1}96%,100%{transform:translate(424px,121px);opacity:0}}
@keyframes pm-ring{0%,9%{opacity:0;transform:scale(.4)}10%{opacity:1;transform:scale(1)}13%{opacity:0;transform:scale(1.6)}26%{opacity:0;transform:scale(.4)}28%{opacity:1;transform:scale(1)}32%{opacity:0;transform:scale(1.6)}66%{opacity:0;transform:scale(.4)}68%{opacity:1;transform:scale(1)}72%,100%{opacity:0;transform:scale(1.6)}}
`;

function Badge({ label, t, icon }: { label: string; t: 'mint' | 'rose' | 'slate'; icon?: JSX.Element }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 14, padding: '0 5px', borderRadius: 99, background: tone(t, 0.15), color: tone(t) }}>
            {icon}
            <T size={6.5} weight={700} color={tone(t)}>
                {label}
            </T>
        </span>
    );
}

function Doc({ n, date, status, reason }: { n: string; date: string; status: JSX.Element; reason?: string }): JSX.Element {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
            <span style={{ width: 22, height: 26, borderRadius: 3, background: tone('rose', 0.12), color: tone('rose'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileText size={11} />
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <T size={8.5} weight={700}>
                        {n}
                    </T>
                    {status}
                </span>
                <T size={6.5} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {reason ?? `Emitido ${date} por Laura Gómez`}
                </T>
            </span>
        </div>
    );
}

export default function PdfEmitir(): JSX.Element {
    const items: Array<[string, string, JSX.Element]> = [
        ['Ver', 'Con los datos de ahora', <Eye key="v" size={10} />],
        ['Descargar', 'La primera vez lo emite y lo congela', <Download key="d" size={10} />],
        ['Copiar enlace (30 días)', 'Sin guardar archivo: se arma al abrirlo', <Link2 key="l" size={10} />],
        ['Guardar en «Documento»', 'Queda en el registro', <Paperclip key="g" size={10} />],
    ];
    return (
        <Stage label="Desde la ficha, «Generar PDF → Descargar» emite el número CC-0042 y congela el documento. Después, en «Documentos emitidos», se anula el CC-0042 y se emite de nuevo como CC-0043." tint="rose">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Win x={12} y={16} w={236} h={268} title="Facturas · FAC-1043">
                    <At x={12} y={10}>
                        <T size={12} weight={800} style={{ display: 'block' }}>
                            Hotel Brisas del Mar
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            Total $ 1.250.000 · Vence 15/10/2026
                        </T>
                    </At>
                    <At
                        x={12}
                        y={42}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}` }}
                    >
                        <ScrollText size={10} color={C.mutedFg} />
                        <T size={8} weight={600}>
                            Generar PDF
                        </T>
                        <ChevronDown size={9} color={C.mutedFg} />
                    </At>
                    {/* Menú */}
                    <At
                        x={12}
                        y={66}
                        w={206}
                        a="pm-menu"
                        style={{ opacity: 0, zIndex: 4, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, boxShadow: '0 14px 30px -12px rgba(15,23,42,.45)' }}
                    >
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ display: 'block', padding: '2px 5px 4px', letterSpacing: '.04em' }}>
                            CUENTA DE COBRO
                        </T>
                        {items.map(([label, hint, icon]) => (
                            <span
                                key={label}
                                data-a={label === 'Descargar' ? '' : undefined}
                                style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '4px 5px', borderRadius: 5, animationName: label === 'Descargar' ? 'pm-hl' : undefined }}
                            >
                                <span style={{ color: C.mutedFg, marginTop: 1 }}>{icon}</span>
                                <span style={{ display: 'flex', flexDirection: 'column' }}>
                                    <T size={8} weight={600}>
                                        {label}
                                    </T>
                                    <T size={6.5} color={C.mutedFg}>
                                        {hint}
                                    </T>
                                </span>
                            </span>
                        ))}
                        <span style={{ display: 'block', height: 1, background: C.border, margin: '3px 0' }} />
                        <span style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '4px 5px' }}>
                            <FileText size={10} color={C.mutedFg} />
                            <T size={8} weight={600}>
                                Documentos emitidos
                            </T>
                        </span>
                    </At>
                    {/* Campos de fondo */}
                    <At x={12} y={74} w={210} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {['Cliente', 'Concepto', 'Total', 'Estado', 'Vencimiento'].map((f) => (
                            <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <T size={7.5} color={C.mutedFg} style={{ width: 62 }}>
                                    {f}
                                </T>
                                <span style={{ display: 'block', width: 100, height: 6, borderRadius: 3, background: C.muted }} />
                            </span>
                        ))}
                    </At>
                </Win>
                {/* Aviso del número */}
                <At
                    x={28}
                    y={244}
                    a="pm-toast"
                    style={{ opacity: 0, zIndex: 6, background: C.fg, borderRadius: 8, padding: '6px 9px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 10px 24px -10px rgba(15,23,42,.5)' }}
                >
                    <Lock size={10} color={tone('mint')} />
                    <T size={8} weight={600} color={C.card}>
                        Número: CC-0042 · congelado
                    </T>
                </At>

                {/* Documentos emitidos */}
                <Win x={258} y={36} w={210} h={228} title="Documentos emitidos" a="pm-list">
                    <At x={10} y={8} w={188}>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                            Un documento congelado se entrega siempre igual, aunque cambien los datos.
                        </T>
                    </At>
                    <At x={10} y={40} w={188} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ position: 'relative' }}>
                            <Doc n="CC-0042" date="08/10/2026" status={<Badge label="Congelado" t="mint" icon={<Lock size={7} />} />} />
                            <div data-a="" style={{ position: 'absolute', inset: 0, opacity: 0, animationName: 'pm-b' }}>
                                <Doc n="CC-0042" date="08/10/2026" status={<Badge label="Anulado" t="rose" />} reason="Anulado: «Se corrigió el precio»" />
                            </div>
                            <span data-a="" style={{ position: 'absolute', right: 8, top: 10, animationName: 'pm-a' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 6px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.card }}>
                                    <RotateCcw size={8} color={C.mutedFg} />
                                    <T size={6.5} weight={600}>
                                        Anular
                                    </T>
                                </span>
                            </span>
                        </div>
                        <div data-a="" style={{ animationName: 'pm-new' }}>
                            <Doc n="CC-0043" date="08/10/2026" status={<Badge label="Congelado" t="mint" icon={<Lock size={7} />} />} />
                        </div>
                        <Doc n="CC-0031" date="08/09/2026" status={<Badge label="Congelado" t="mint" icon={<Lock size={7} />} />} />
                    </At>
                </Win>
                <Cursor a="pm-cursor" click="pm-ring" rest={[424, 121]} />
            </div>
        </Stage>
    );
}
