import { AlarmClock, BookmarkPlus, ChevronDown, ChevronUp, Download, Eye, FileDown, FileText, Link2, UserPlus, X } from 'lucide-react';

import { At, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** La barra de la ficha: seguir el registro, programar un recordatorio y generar su PDF. */

const TB_Y = 52;
const ICON_X = { eye: 300, alarm: 324, pdf: 348 };

const CSS = `
@keyframes fac-eye{0%,9%{color:${C.mutedFg};background:transparent}11%,94%{color:${primary()};background:${primary(0.12)}}99%,100%{color:${C.mutedFg};background:transparent}}
@keyframes fac-n{0%,9%{opacity:0}11%,94%{opacity:1}99%,100%{opacity:0}}
@keyframes fac-t1{0%,10%{opacity:0;transform:translateY(6px)}13%,24%{opacity:1;transform:translateY(0)}27%,100%{opacity:0}}
@keyframes fac-rem{0%,28%{opacity:0;transform:translateY(-4px)}31%,46%{opacity:1;transform:translateY(0)}49%,100%{opacity:0}}
@keyframes fac-remhl{0%,37%{opacity:0}40%,47%{opacity:1}49%,100%{opacity:0}}
@keyframes fac-t2{0%,47%{opacity:0;transform:translateY(6px)}50%,60%{opacity:1;transform:translateY(0)}63%,100%{opacity:0}}
@keyframes fac-pdf{0%,62%{opacity:0;transform:translateY(-4px)}65%,82%{opacity:1;transform:translateY(0)}85%,100%{opacity:0}}
@keyframes fac-pdfhl{0%,73%{opacity:0}76%,83%{opacity:1}85%,100%{opacity:0}}
@keyframes fac-t3{0%,83%{opacity:0;transform:translateY(6px)}86%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes fac-cur{0%{transform:translate(220px,290px);opacity:0}4%{opacity:1}8%,10%{transform:translate(${ICON_X.eye + 6}px,${TB_Y + 12}px)}26%,29%{transform:translate(${ICON_X.alarm + 6}px,${TB_Y + 12}px)}38%,44%{transform:translate(380px,217px)}60%,64%{transform:translate(${ICON_X.pdf + 6}px,${TB_Y + 12}px)}74%,80%{transform:translate(284px,141px);opacity:1}92%{opacity:1}97%,100%{transform:translate(440px,270px);opacity:0}}
@keyframes fac-ring{0%,8%{opacity:0;transform:scale(.4)}9%{opacity:1;transform:scale(1)}12%,27%{opacity:0;transform:scale(1.6)}28%{opacity:1;transform:scale(1)}31%,42%{opacity:0;transform:scale(1.6)}43%{opacity:1;transform:scale(1)}46%,62%{opacity:0;transform:scale(1.6)}63%{opacity:1;transform:scale(1)}66%,78%{opacity:0;transform:scale(1.6)}79%{opacity:1;transform:scale(1)}82%,100%{opacity:0;transform:scale(1.6)}}
`;

function Ic({ x, children, a }: { x: number; children: JSX.Element; a?: string }): JSX.Element {
    return (
        <At x={x} y={TB_Y} w={22} h={22} a={a} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, color: C.mutedFg }}>
            {children}
        </At>
    );
}

function Toast({ a, children }: { a: string; children: string }): JSX.Element {
    return (
        <At x={140} y={262} w={200} a={a} style={{ opacity: 0, zIndex: 9, display: 'flex', justifyContent: 'center' }}>
            <span style={{ background: C.fg, color: C.card, borderRadius: 8, padding: '6px 10px', fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap' }}>{children}</span>
        </At>
    );
}

export default function FichaAcciones(): JSX.Element {
    return (
        <Stage label="En la barra de la ficha de una factura se toca el ojo para seguirla, el reloj para que la app recuerde mañana a las 9:00 y «Generar PDF» para descargar la cuenta de cobro." tint="violet">
            <Keyframes css={CSS} />
            <At x={40} y={40} w={400} h={250} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 18px 40px -18px rgba(15,23,42,.45)', overflow: 'hidden' }} />
            {/* Barra de la ficha */}
            <At x={40} y={40} w={400} h={46} style={{ borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', color: C.mutedFg }}>
                <ChevronUp size={12} />
                <ChevronDown size={12} />
                <T size={9} color={C.mutedFg}>
                    Facturas / FAC-0142
                </T>
            </At>
            <Ic x={ICON_X.eye} a="fac-eye">
                <Eye size={13} />
            </Ic>
            <At x={ICON_X.eye + 14} y={TB_Y - 4} a="fac-n" style={{ minWidth: 12, height: 12, borderRadius: 99, background: primary(), color: C.primaryFg, fontSize: 7.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                2
            </At>
            <Ic x={ICON_X.alarm}>
                <AlarmClock size={13} />
            </Ic>
            <Ic x={ICON_X.pdf}>
                <FileDown size={13} />
            </Ic>
            <Ic x={372}>
                <BookmarkPlus size={13} />
            </Ic>
            <Ic x={396}>
                <UserPlus size={13} />
            </Ic>
            <Ic x={418}>
                <X size={13} />
            </Ic>

            {/* Contenido de la ficha */}
            <At x={56} y={100} w={240} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <T size={15} weight={800}>
                    FAC-0142 · Café La 14
                </T>
                {(
                    [
                        ['Monto', '$ 1.250.000'],
                        ['Vence', '30/10/2026'],
                    ] as const
                ).map(([l, v]) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'center', height: 24, borderBottom: `1px solid ${C.border}` }}>
                        <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                            {l}
                        </T>
                        <T size={9.5}>{v}</T>
                    </span>
                ))}
                <span style={{ display: 'flex', alignItems: 'center', height: 24, borderBottom: `1px solid ${C.border}` }}>
                    <T size={9} color={C.mutedFg} style={{ width: 70 }}>
                        Estado
                    </T>
                    <Chip label="Pendiente" t="amber" />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                    <span style={{ height: 6, width: 200, borderRadius: 99, background: C.muted }} />
                    <span style={{ height: 6, width: 160, borderRadius: 99, background: C.muted }} />
                </span>
            </At>

            {/* Recordarme */}
            <At x={210} y={80} w={216} a="fac-rem" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, boxShadow: '0 16px 32px -12px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <T size={8.5} weight={700}>
                    Recordarme este registro
                </T>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {['En 1 hora', 'Hoy a las 17:00', 'Mañana a las 9:00', 'En 3 días', 'El lunes a las 9:00', 'Otra fecha…'].map((o, i) => (
                        <span key={o} style={{ fontSize: 8, padding: '2px 7px', borderRadius: 99, border: `1px solid ${i === 2 ? primary() : C.border}`, background: i === 2 ? primary(0.1) : 'transparent', color: i === 2 ? primary() : C.fg, fontWeight: i === 2 ? 600 : 500, whiteSpace: 'nowrap' }}>
                            {o}
                        </span>
                    ))}
                </span>
                <span style={{ height: 22, borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                    <T size={8.5}>Llamar para confirmar el pago</T>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <T size={8} color={C.mutedFg}>
                        28/10/2026 09:00
                    </T>
                    <span style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', borderRadius: 6, background: primary(), color: C.primaryFg, fontSize: 8.5, fontWeight: 600 }}>
                        <span data-a="" style={{ position: 'absolute', inset: -2, borderRadius: 8, boxShadow: `0 0 0 2px ${primary(0.35)}`, opacity: 0, animationName: 'fac-remhl' }} />
                        Recordarme
                    </span>
                </span>
            </At>

            {/* Generar PDF */}
            <At x={192} y={80} w={244} a="fac-pdf" style={{ opacity: 0, zIndex: 6, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8, boxShadow: '0 16px 32px -12px rgba(15,23,42,.55)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={8} weight={700} color={C.mutedFg}>
                    Documentos de esta lista
                </T>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={12} color={tone('rose')} />
                    <T size={9.5} weight={700}>
                        Cuenta de cobro
                    </T>
                    <span style={{ flex: 1 }} />
                    <T size={7.5} color={C.mutedFg}>
                        Número CC-0042
                    </T>
                </span>
                <span style={{ display: 'flex', gap: 5 }}>
                    {(
                        [
                            [<Eye key="e" size={9} />, 'Ver'],
                            [<Download key="d" size={9} />, 'Descargar'],
                            [<Link2 key="l" size={9} />, 'Copiar enlace (30 días)'],
                        ] as const
                    ).map(([ic, l], i) => (
                        <span key={l} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 3, height: 22, padding: '0 6px', borderRadius: 6, border: `1px solid ${C.border}`, color: C.fg, fontSize: 8, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {i === 1 && <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 6, background: primary(0.14), animationName: 'fac-pdfhl' }} />}
                            {ic}
                            {l}
                        </span>
                    ))}
                </span>
            </At>

            <Toast a="fac-t1">Sigues este registro</Toast>
            <Toast a="fac-t2">Recordatorio creado · 28/10/2026 09:00</Toast>
            <Toast a="fac-t3">PDF generado</Toast>
            <Cursor a="fac-cur" click="fac-ring" rest={[440, 270]} />
        </Stage>
    );
}
