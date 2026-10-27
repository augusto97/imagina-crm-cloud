import { Bold, Image, Italic, Link2, Palette, Underline } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * La firma de email: se escribe una vez en Ajustes (como en Gmail, con
 * formato, enlace y logo) y aparece al final de los correos de las
 * automatizaciones que la tengan activada.
 */

const BRAND = '#0e7490';

const CSS = `
@keyframes cf-l0{0%,6%{opacity:0;transform:translateY(4px)}12%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cf-l1{0%,14%{opacity:0;transform:translateY(4px)}20%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cf-l2{0%,22%{opacity:0;transform:translateY(4px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cf-l3{0%,30%{opacity:0;transform:translateY(4px)}36%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cf-save{0%,40%{box-shadow:0 0 0 0 transparent}44%,50%{box-shadow:0 0 0 4px ${primary(0.3)}}56%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes cf-ok{0%,46%{opacity:0}50%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes cf-mail{0%,54%{opacity:0;transform:translateX(14px)}62%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes cf-sig{0%,64%{background:transparent}68%,80%{background:${primary(0.12)}}86%,100%{background:transparent}}
`;

function Signature({ scale = 1 }: { scale?: number }): JSX.Element {
    const s = (n: number): number => n * scale;
    return (
        <span style={{ display: 'flex', gap: s(8), alignItems: 'center' }}>
            <span style={{ width: s(30), height: s(30), borderRadius: s(7), background: BRAND, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: s(10), fontWeight: 800, flex: 'none' }}>CA</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: s(1.5) }}>
                <span style={{ fontSize: s(9.5), fontWeight: 800, color: '#1f2937' }}>Laura Gómez</span>
                <span style={{ fontSize: s(7.5), color: '#6b7280', fontStyle: 'italic' }}>Gerente comercial · Café Aurora</span>
                <span style={{ fontSize: s(7.5), color: BRAND, fontWeight: 600 }}>cafeaurora.co · 300 555 1234</span>
            </span>
        </span>
    );
}

export default function CorreoFirma(): JSX.Element {
    return (
        <Stage label="En Ajustes → Firma de email se escribe la firma como en Gmail, con negrita, color, enlace y logo; se guarda y aparece al final de los correos de las automatizaciones." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={16} y={40} w={236} h={218} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 11, boxShadow: '0 14px 34px -16px rgba(15,23,42,.45)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                        <T size={10} weight={700}>
                            Firma de email
                        </T>
                        <span style={{ marginLeft: 'auto', display: 'flex', height: 18, borderRadius: 5, background: C.muted, padding: 2, gap: 2 }}>
                            {['Visual', 'HTML'].map((o, i) => (
                                <span key={o} style={{ padding: '0 7px', borderRadius: 3, display: 'flex', alignItems: 'center', background: i === 0 ? C.card : 'transparent' }}>
                                    <T size={7} weight={600} color={i === 0 ? C.fg : C.mutedFg}>
                                        {o}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </span>
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                        Aparece al final de los correos que tengan activada la firma.
                    </T>
                    <span style={{ borderRadius: 7, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                        <span style={{ display: 'flex', gap: 8, padding: '5px 8px', borderBottom: `1px solid ${C.border}`, color: C.mutedFg }}>
                            <Bold size={10} />
                            <Italic size={10} />
                            <Underline size={10} />
                            <Link2 size={10} />
                            <Palette size={10} />
                            <Image size={10} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 9, background: '#fff' }}>
                            <span data-a="" style={{ animationName: 'cf-l0' }}>
                                <span style={{ fontSize: 8, color: '#374151' }}>Saludos,</span>
                            </span>
                            <span data-a="" style={{ animationName: 'cf-l1', display: 'flex', gap: 7, alignItems: 'center', marginTop: 3 }}>
                                <span style={{ width: 26, height: 26, borderRadius: 6, background: BRAND, color: '#fff', fontSize: 9, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>CA</span>
                                <span style={{ fontSize: 9, fontWeight: 800, color: '#1f2937' }}>Laura Gómez</span>
                            </span>
                            <span data-a="" style={{ animationName: 'cf-l2', paddingLeft: 33 }}>
                                <span style={{ fontSize: 7.5, color: '#6b7280', fontStyle: 'italic' }}>Gerente comercial · Café Aurora</span>
                            </span>
                            <span data-a="" style={{ animationName: 'cf-l3', paddingLeft: 33 }}>
                                <span style={{ fontSize: 7.5, color: BRAND, fontWeight: 600, textDecoration: 'underline' }}>cafeaurora.co</span>
                                <span style={{ fontSize: 7.5, color: '#6b7280' }}> · 300 555 1234</span>
                            </span>
                        </span>
                    </span>
                    <span style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span data-a="" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, animationName: 'cf-ok' }}>
                            <span style={{ width: 7, height: 7, borderRadius: 99, background: C.success }} />
                            <T size={7.5} weight={600} color={C.mutedFg}>
                                Firma guardada
                            </T>
                        </span>
                        <span data-a="" style={{ height: 24, padding: '0 10px', borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', animationName: 'cf-save' }}>
                            <T size={8} weight={700} color={C.primaryFg}>
                                Guardar firma
                            </T>
                        </span>
                    </span>
                </At>

                {/* El correo que sale */}
                <At x={268} y={42} w={198} a="cf-mail" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.5)' }}>
                    <span style={{ display: 'block', padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>
                        <span style={{ display: 'block', fontSize: 8, fontWeight: 800, color: '#1f2937' }}>Tu cotización COT-0018</span>
                        <span style={{ fontSize: 7, color: '#6b7280' }}>Café Aurora · para Hotel Brisas</span>
                    </span>
                    <span style={{ display: 'block', padding: 10 }}>
                        <span style={{ display: 'block', fontSize: 7.5, lineHeight: 1.5, color: '#374151' }}>
                            Hola Marcela, adjunto la cotización de los 40 kg de café para el hotel. Cualquier ajuste me cuentas.
                        </span>
                        <span style={{ display: 'block', height: 5, borderRadius: 3, background: '#f1f5f9', marginTop: 7, width: '80%' }} />
                        <span data-a="" style={{ display: 'block', marginTop: 10, paddingTop: 8, borderTop: '1px solid #e5e7eb', borderRadius: 6, animationName: 'cf-sig' }}>
                            <Signature scale={0.92} />
                        </span>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
