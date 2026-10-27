import { Download, FilePlus2, FileText, Mail, Paperclip, PlusCircle } from 'lucide-react';

import { At, C, Flow, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El PDF sin tocar nada: al crear una factura, una automatización genera la
 * cuenta de cobro y la manda adjunta por correo; el cliente además la baja
 * desde su portal.
 */

const CSS = `
@keyframes pa-s1{0%,4%{box-shadow:0 0 0 0 transparent}8%,16%{box-shadow:0 0 0 3px ${primary(0.35)}}22%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pa-s2{0%,22%{box-shadow:0 0 0 0 transparent}27%,36%{box-shadow:0 0 0 3px ${primary(0.35)}}42%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pa-s3{0%,42%{box-shadow:0 0 0 0 transparent}47%,56%{box-shadow:0 0 0 3px ${primary(0.35)}}62%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes pa-dot{0%,14%{opacity:0;transform:translate(0,0)}16%{opacity:1}26%{opacity:1;transform:translate(0,76px)}28%,34%{opacity:0;transform:translate(0,76px)}36%{opacity:1;transform:translate(0,76px)}46%{opacity:1;transform:translate(0,152px)}48%,100%{opacity:0;transform:translate(0,152px)}}
@keyframes pa-pdf{0%,28%{opacity:0;transform:scale(.5)}34%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes pa-mail{0%,54%{opacity:0;transform:translateY(10px)}62%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes pa-portal{0%,66%{opacity:0;transform:translateY(10px)}74%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
`;

function Step({ y, kicker, title, sub, icon, t, a }: { y: number; kicker: string; title: string; sub: string; icon: JSX.Element; t: 'amber' | 'violet' | 'mint'; a: string }): JSX.Element {
    return (
        <At
            x={20}
            y={y}
            w={218}
            h={54}
            a={a}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, display: 'flex', alignItems: 'center', gap: 9, padding: '0 11px', boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}
        >
            <IconSquare t={t} size={26}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={10} weight={600}>
                    {title}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {sub}
                </T>
            </span>
        </At>
    );
}

export default function PdfAutomatizar(): JSX.Element {
    return (
        <Stage label="Una automatización: cuando se crea una factura, genera la cuenta de cobro en PDF y la manda adjunta por correo al cliente, que además la puede descargar desde su portal." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Flow x1={129} y1={86} x2={129} y2={112} />
                <Flow x1={129} y1={166} x2={129} y2={188} />
                <Step y={32} kicker="Cuando" title="Se crea un registro" sub="Lista Facturas" icon={<PlusCircle size={14} />} t="amber" a="pa-s1" />
                <Step y={112} kicker="Entonces" title="Generar un PDF" sub="Plantilla: Cuenta de cobro" icon={<FilePlus2 size={14} />} t="violet" a="pa-s2" />
                <Step y={188} kicker="Después" title="Enviar email" sub="Adjuntar PDF · {{pdf.link}}" icon={<Mail size={14} />} t="mint" a="pa-s3" />
                <At x={125} y={84} a="pa-dot" style={{ opacity: 0 }}>
                    <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
                </At>
                <At x={212} y={124} a="pa-pdf" style={{ color: tone('rose') }}>
                    <span style={{ display: 'inline-flex', width: 22, height: 26, borderRadius: 4, background: '#ffffff', border: '1px solid #e5e7eb', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px -8px rgba(15,23,42,.5)' }}>
                        <FileText size={12} />
                    </span>
                </At>

                {/* Correo que recibe el cliente */}
                <At
                    x={262}
                    y={28}
                    w={202}
                    a="pa-mail"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)' }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 99, background: primary(), display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8} weight={800} color={C.primaryFg}>
                                CA
                            </T>
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            <T size={8.5} weight={700}>
                                Café Aurora
                            </T>
                            <T size={7} color={C.mutedFg}>
                                Tu cuenta de cobro FAC-1043
                            </T>
                        </span>
                    </span>
                    <T size={7.5} color={C.fg} style={{ display: 'block', marginTop: 8, whiteSpace: 'normal' }}>
                        Hola, Hotel Brisas: te enviamos la cuenta de cobro por $ 1.250.000. Vence el 15/10/2026.
                    </T>
                    <span style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.muted }}>
                        <Paperclip size={10} color={C.mutedFg} />
                        <T size={7.5} weight={600}>
                            Cuenta de cobro CC-0042.pdf
                        </T>
                    </span>
                </At>

                {/* Portal del cliente */}
                <At
                    x={262}
                    y={172}
                    w={202}
                    a="pa-portal"
                    style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 10, boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)' }}
                >
                    <T size={7} weight={700} color={C.mutedFg} style={{ display: 'block', letterSpacing: '.06em' }}>
                        PORTAL · TUS DOCUMENTOS
                    </T>
                    {['Cuenta de cobro', 'Cotización'].map((d) => (
                        <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}>
                            <FileText size={11} color={tone('rose')} />
                            <T size={8.5} weight={600} style={{ flex: 1 }}>
                                {d}
                            </T>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 17, padding: '0 6px', borderRadius: 5, border: `1px solid ${C.border}` }}>
                                <Download size={9} color={C.mutedFg} />
                                <T size={7} weight={600}>
                                    Descargar
                                </T>
                            </span>
                        </span>
                    ))}
                </At>
            </div>
        </Stage>
    );
}
