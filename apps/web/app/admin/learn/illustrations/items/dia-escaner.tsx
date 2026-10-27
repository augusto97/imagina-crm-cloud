import { CheckCircle2, ScanLine, XCircle } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El escáner en modo continuo: la cámara lee el código de barras de un
 * producto, lo encuentra en la lista y lo suma al historial; uno que no está
 * aparece marcado con una X.
 */

const CSS = `
@keyframes sc-line{0%,100%{transform:translateY(0)}50%{transform:translateY(78px)}}
@keyframes sc-box1{0%,4%{transform:translateX(-140px)}12%,36%{transform:translateX(0)}44%,100%{transform:translateX(150px)}}
@keyframes sc-box2{0%,40%{transform:translateX(-140px)}48%,72%{transform:translateX(0)}80%,100%{transform:translateX(150px)}}
@keyframes sc-flash1{0%,18%{opacity:0}20%,26%{opacity:1}30%,100%{opacity:0}}
@keyframes sc-flash2{0%,54%{opacity:0}56%,62%{opacity:1}66%,100%{opacity:0}}
@keyframes sc-h1{0%,22%{opacity:0;transform:translateY(-6px)}26%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes sc-h2{0%,58%{opacity:0;transform:translateY(-6px)}62%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes sc-push{0%,58%{transform:translateY(0)}62%,94%{transform:translateY(38px)}98%,100%{transform:translateY(0)}}
`;

function Barcode({ w = 70 }: { w?: number }): JSX.Element {
    const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1];
    return (
        <span style={{ display: 'flex', alignItems: 'stretch', gap: 1.4, height: 30, width: w }}>
            {bars.map((b, i) => (
                <span key={i} style={{ width: b, background: '#111827', flexShrink: 0 }} />
            ))}
        </span>
    );
}

function Product({ label, code, t }: { label: string; code: string; t: 'amber' | 'rose' }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 10px', borderRadius: 8, background: '#f8fafc', border: `2px solid ${tone(t, 0.6)}`, width: 104 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: tone(t), letterSpacing: '.04em' }}>{label}</span>
            <Barcode />
            <span style={{ fontSize: 7.5, fontWeight: 700, color: '#111827', letterSpacing: '.12em' }}>{code}</span>
        </span>
    );
}

function Hit({ ok, title, sub, a }: { ok: boolean; title: string; sub: string; a: string }): JSX.Element {
    return (
        <At x={0} y={0} w={206} a={a} style={{ opacity: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
                {ok ? <CheckCircle2 size={13} color={C.success} /> : <XCircle size={13} color={C.destructive} />}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                    <T size={8.5} weight={700}>
                        {title}
                    </T>
                    <T size={7.5} color={C.mutedFg}>
                        {sub}
                    </T>
                </span>
                <span style={{ fontSize: 7.5, fontWeight: 700, color: ok ? primary() : tone('rose'), padding: '2px 6px', borderRadius: 5, border: `1px solid ${ok ? primary(0.4) : tone('rose', 0.4)}` }}>{ok ? 'Abrir' : 'Crear'}</span>
            </div>
        </At>
    );
}

export default function DiaEscaner(): JSX.Element {
    return (
        <Stage label="El escáner en modo continuo: la cámara del teléfono lee el código de barras de un producto, lo encuentra en el inventario y lo suma al historial; el siguiente código no está en la lista y aparece con la opción de crearlo." tint="mint">
            <Keyframes css={CSS} />
            {/* Teléfono con la cámara */}
            <At x={30} y={14} w={168} h={272} style={{ borderRadius: 24, background: '#0b1220', border: `5px solid ${C.fg}`, overflow: 'hidden', boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>Escaneo continuo</span>
                </div>
                {/* productos que pasan frente a la cámara */}
                <At x={24} y={80} a="sc-box1" style={{ transform: 'translateX(150px)' }}>
                    <Product label="CAFÉ DE ORIGEN 500 G" code="7701234567890" t="amber" />
                </At>
                <At x={24} y={80} a="sc-box2" style={{ transform: 'translateX(150px)' }}>
                    <Product label="TAZA ESPECIAL" code="7709876543210" t="rose" />
                </At>
                {/* visor */}
                <At x={14} y={72} w={130} h={108} style={{ borderRadius: 12, boxShadow: '0 0 0 999px rgba(11,18,32,.45)' }}>
                    {[
                        { left: 0, top: 0, bl: true, bt: true },
                        { right: 0, top: 0, br: true, bt: true },
                        { left: 0, bottom: 0, bl: true, bb: true },
                        { right: 0, bottom: 0, br: true, bb: true },
                    ].map((c, i) => (
                        <span
                            key={i}
                            style={{
                                position: 'absolute',
                                width: 16,
                                height: 16,
                                left: c.left,
                                right: c.right,
                                top: c.top,
                                bottom: c.bottom,
                                borderLeft: c.bl ? '3px solid #fff' : undefined,
                                borderRight: c.br ? '3px solid #fff' : undefined,
                                borderTop: c.bt ? '3px solid #fff' : undefined,
                                borderBottom: c.bb ? '3px solid #fff' : undefined,
                                borderRadius: 4,
                            }}
                        />
                    ))}
                    <At x={8} y={14} w={114} h={2} a="sc-line" style={{ background: tone('rose'), boxShadow: `0 0 8px ${tone('rose')}`, animationDuration: '1.8s', animationTimingFunction: 'ease-in-out' }} />
                    <At x={0} y={0} w={130} h={108} a="sc-flash1" style={{ opacity: 0, borderRadius: 12, background: 'rgba(34,197,94,.35)', boxShadow: `inset 0 0 0 3px ${C.success}` }} />
                    <At x={0} y={0} w={130} h={108} a="sc-flash2" style={{ opacity: 0, borderRadius: 12, background: 'rgba(239,68,68,.3)', boxShadow: `inset 0 0 0 3px ${C.destructive}` }} />
                </At>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, display: 'flex', justifyContent: 'center' }}>
                    <span style={{ width: 42, height: 42, borderRadius: 99, border: '3px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                        <ScanLine size={18} />
                    </span>
                </div>
            </At>

            {/* Panel de resultados */}
            <At x={222} y={30} w={236} h={240} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -20px rgba(15,23,42,.5)', padding: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                    <T size={10.5} weight={700}>
                        Escanear en «Productos»
                    </T>
                    <span style={{ display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 7.5, fontWeight: 600, padding: '2px 7px', borderRadius: 5, color: C.mutedFg, border: `1px solid ${C.border}` }}>Un código</span>
                        <span style={{ fontSize: 7.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, color: primary(), background: primary(0.12), border: `1px solid ${primary(0.4)}` }}>Escaneo continuo</span>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Campo del código: Automático (SKU)
                    </T>
                </div>
                <div style={{ position: 'relative', height: 150 }}>
                    <Hit a="sc-h2" ok={false} title="7709876543210" sub="No está en la lista" />
                    <At x={0} y={0} w={206} a="sc-push" style={{ transform: 'translateY(38px)' }}>
                        <div style={{ position: 'relative' }}>
                            <Hit a="sc-h1" ok title="Café de origen 500 g" sub="Encontrado · stock 42" />
                        </div>
                        <div style={{ position: 'absolute', left: 0, top: 38, width: 206, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[
                                ['Molino manual', 'Encontrado · stock 7'],
                                ['Prensa francesa', 'Encontrado · stock 15'],
                            ].map(([t, s]) => (
                                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: `1px solid ${C.border}`, opacity: 0.75 }}>
                                    <CheckCircle2 size={13} color={C.success} />
                                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                                        <T size={8.5} weight={700}>
                                            {t}
                                        </T>
                                        <T size={7.5} color={C.mutedFg}>
                                            {s}
                                        </T>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </At>
                </div>
            </At>
        </Stage>
    );
}
