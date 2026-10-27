import { Car, ChevronLeft, ChevronRight, Download, ExternalLink, FileText, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Archivos: un clic en el PDF de la ficha abre el visor a pantalla completa; la flecha ← vuelve a la foto anterior. */

const CSS = `
@keyframes far-view{0%,22%{opacity:0;transform:scale(.97)}27%,93%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes far-pdf{0%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes far-img{0%,58%{opacity:0;transform:translateX(-16px)}63%,100%{opacity:1;transform:translateX(0)}}
@keyframes far-n1{0%,59%{opacity:1}60%,100%{opacity:0}}
@keyframes far-n2{0%,59%{opacity:0}60%,100%{opacity:1}}
@keyframes far-key{0%,50%{opacity:0;transform:scale(.8)}54%,62%{opacity:1;transform:scale(1)}66%,100%{opacity:0}}
@keyframes far-cur{0%{transform:translate(200px,290px);opacity:0}5%{opacity:1}14%,20%{transform:translate(96px,210px)}26%{opacity:1;transform:translate(96px,210px)}30%,100%{transform:translate(440px,270px);opacity:0}}
@keyframes far-ring{0%,18%{opacity:0;transform:scale(.4)}19%{opacity:1;transform:scale(1)}22%,100%{opacity:0;transform:scale(1.6)}}
`;

function Thumb({ x, t }: { x: number; t: 'blue' | 'slate' }): JSX.Element {
    return (
        <At x={x} y={0} w={60} h={46} style={{ borderRadius: 7, background: tone(t, 0.18), border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tone(t) }}>
            <Car size={22} />
        </At>
    );
}

export default function FichaArchivos(): JSX.Element {
    return (
        <Stage label="En la ficha de una orden de trabajo hay fotos del vehículo y la cotización del repuesto en PDF. Un clic en el PDF abre el visor a pantalla completa, donde se lee sin descargarlo; la flecha a la izquierda vuelve a la foto anterior." tint="slate">
            <Keyframes css={CSS} />
            <Win x={24} y={22} w={300} h={252} title="Órdenes de trabajo / OT-0218">
                <At x={12} y={10} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={13} weight={800}>
                        OT-0218 · Mazda 3 · KXY-482
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        Cambio de pastillas y revisión de frenos
                    </T>
                </At>
                <At x={12} y={54} w={276} style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.mutedFg }}>
                    <ImageIcon size={10} />
                    <T size={9} weight={600} color={C.mutedFg}>
                        Fotos
                    </T>
                </At>
                <At x={12} y={72} w={276} h={46}>
                    <Thumb x={0} t="blue" />
                    <Thumb x={66} t="slate" />
                    <At x={132} y={0} w={60} h={46} style={{ borderRadius: 7, border: `1px dashed ${C.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: C.mutedFg }}>
                        <Upload size={11} />
                        <T size={7} color={C.mutedFg}>
                            Subir archivo
                        </T>
                    </At>
                </At>
                <At x={12} y={130} w={276} style={{ display: 'flex', alignItems: 'center', gap: 5, color: C.mutedFg }}>
                    <Paperclip size={10} />
                    <T size={9} weight={600} color={C.mutedFg}>
                        Soportes
                    </T>
                </At>
                <At x={12} y={148} w={276} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {[
                        ['Cotización repuesto.pdf', '182 KB', 'rose'],
                        ['Factura proveedor.pdf', '96 KB', 'rose'],
                    ].map(([n, s, t]) => (
                        <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 28, padding: '0 8px', borderRadius: 7, border: `1px solid ${C.border}` }}>
                            <FileText size={12} color={tone(t as 'rose')} />
                            <T size={9.5} weight={600} color={primary()} style={{ flex: 1 }}>
                                {n}
                            </T>
                            <T size={8} color={C.mutedFg}>
                                {s}
                            </T>
                        </span>
                    ))}
                </At>
            </Win>

            {/* El visor */}
            <At x={0} y={0} w={480} h={300} a="far-view" style={{ zIndex: 8, background: 'rgb(12,14,20)' }}>
                <At x={16} y={12} w={448} h={26} style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#e5e7eb' }}>
                    <FileText size={12} />
                    <span style={{ position: 'relative', width: 200, height: 14 }}>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: 'far-n1' }}>
                            <T size={10} weight={600} color="#f3f4f6">
                                Cotización repuesto.pdf · 3 de 4
                            </T>
                        </span>
                        <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'far-n2' }}>
                            <T size={10} weight={600} color="#f3f4f6">
                                Foto trasera.jpg · 2 de 4
                            </T>
                        </span>
                    </span>
                    <span style={{ flex: 1 }} />
                    <Download size={12} />
                    <ExternalLink size={12} />
                    <X size={13} />
                </At>
                {/* PDF */}
                <At x={140} y={46} w={200} h={242} a="far-pdf" style={{ opacity: 0, background: '#ffffff', borderRadius: 4, padding: 16, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 20px 40px -12px rgba(0,0,0,.6)' }}>
                    <T size={11} weight={800} color="#111827">
                        COTIZACIÓN N.º 0451
                    </T>
                    <T size={7.5} color="#6b7280">
                        Repuestos El Frenazo · Bogotá
                    </T>
                    <span style={{ height: 1, background: '#e5e7eb', margin: '4px 0' }} />
                    {[
                        ['Pastillas delanteras', '$ 185.000'],
                        ['Discos (par)', '$ 320.000'],
                        ['Líquido de frenos', '$ 38.000'],
                        ['Mano de obra', '$ 120.000'],
                    ].map(([a, b]) => (
                        <span key={a} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <T size={8} color="#374151">
                                {a}
                            </T>
                            <T size={8} color="#111827" weight={600}>
                                {b}
                            </T>
                        </span>
                    ))}
                    <span style={{ height: 1, background: '#e5e7eb', margin: '4px 0' }} />
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <T size={9} weight={800} color="#111827">
                            Total
                        </T>
                        <T size={9} weight={800} color="#111827">
                            $ 663.000
                        </T>
                    </span>
                    {[150, 168, 120, 160, 90].map((w, i) => (
                        <span key={i} style={{ height: 4, width: w, borderRadius: 99, background: '#e5e7eb', marginTop: i === 0 ? 8 : 0 }} />
                    ))}
                </At>
                {/* Foto */}
                <At x={100} y={66} w={280} h={190} a="far-img" style={{ borderRadius: 6, background: `linear-gradient(160deg, ${tone('slate', 0.55)}, ${tone('blue', 0.35)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f3f4f6' }}>
                    <Car size={96} strokeWidth={1.2} />
                </At>
                <At x={24} y={150} style={{ width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb' }}>
                    <ChevronLeft size={15} />
                </At>
                <At x={428} y={150} style={{ width: 28, height: 28, borderRadius: 99, background: 'rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb' }}>
                    <ChevronRight size={15} />
                </At>
                <At x={64} y={206} a="far-key" style={{ opacity: 0, padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,.3)', borderBottomWidth: 3, background: 'rgba(255,255,255,.1)', display: 'flex' }}>
                    <T size={16} weight={800} color="#f9fafb">
                        ←
                    </T>
                </At>
            </At>
            <Cursor a="far-cur" click="far-ring" rest={[440, 270]} />
        </Stage>
    );
}
