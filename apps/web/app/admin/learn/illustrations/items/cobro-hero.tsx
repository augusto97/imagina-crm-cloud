import { Check, Copy, CreditCard, Landmark, Smartphone, Wallet } from 'lucide-react';

import { At, Bubble, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de «Cobros»: desde una factura se crea un link de pago, viaja por
 * WhatsApp, el cliente paga con PSE o Nequi y la factura cambia sola de
 * «Pendiente» a «Pagado».
 */

const CSS = `
@keyframes cbh-copy{0%,12%{opacity:0;transform:translateY(4px)}16%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cbh-msg{0%,22%{opacity:0;transform:translateY(8px)}28%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes cbh-pay{0%,36%{opacity:0;transform:translateX(12px)}42%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(0)}}
@keyframes cbh-tap{0%,50%{box-shadow:0 0 0 0 transparent}54%,60%{box-shadow:0 0 0 4px rgba(0,158,227,.35)}64%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes cbh-pend{0%,64%{opacity:1}68%,100%{opacity:0}}
@keyframes cbh-paid{0%,64%{opacity:0;transform:scale(.8)}68%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes cbh-row{0%,64%{background:transparent}68%,80%{background:${tone('mint', 0.16)}}86%,100%{background:transparent}}
`;

const MP = '#009EE3';

function Status({ label, t, a }: { label: string; t: 'amber' | 'mint'; a: string }): JSX.Element {
    return (
        <span data-a="" style={{ gridArea: '1/1', display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 7px', borderRadius: 99, background: tone(t), color: '#fff', fontSize: 7.5, fontWeight: 700, animationName: a, justifySelf: 'start' }}>
            {t === 'mint' && <Check size={9} />}
            {label}
        </span>
    );
}

export default function CobroHero(): JSX.Element {
    return (
        <Stage label="Desde una factura se crea un link de pago que se manda por WhatsApp; el cliente paga con PSE o Nequi y la factura pasa sola de «Pendiente» a «Pagado»." tint="mint">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                {/* La lista de facturas */}
                <At x={14} y={16} w={232} h={150} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <Wallet size={11} color={primary()} />
                        <T size={9.5} weight={700}>
                            Facturas
                        </T>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: '58px 1fr 70px', padding: '5px 10px', borderBottom: `1px solid ${C.border}` }}>
                        {['Número', 'Monto', 'Estado del pago'].map((h) => (
                            <T key={h} size={7} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </span>
                    {[
                        { n: 'FAC-1041', m: '$ 480.000', paid: true },
                        { n: 'FAC-1042', m: '$ 1.250.000', live: true },
                        { n: 'FAC-1043', m: '$ 320.000', paid: false },
                    ].map((r) => (
                        <span key={r.n} data-a={r.live ? '' : undefined} style={{ display: 'grid', gridTemplateColumns: '58px 1fr 70px', alignItems: 'center', padding: '7px 10px', borderBottom: `1px solid ${C.border}`, animationName: r.live ? 'cbh-row' : undefined }}>
                            <T size={8} weight={600}>
                                {r.n}
                            </T>
                            <T size={8}>{r.m}</T>
                            <span style={{ display: 'inline-grid' }}>
                                {r.live ? (
                                    <>
                                        <Status label="Pendiente" t="amber" a="cbh-pend" />
                                        <Status label="Pagado" t="mint" a="cbh-paid" />
                                    </>
                                ) : (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 16, padding: '0 7px', borderRadius: 99, background: r.paid ? tone('mint') : tone('amber'), color: '#fff', fontSize: 7.5, fontWeight: 700, justifySelf: 'start' }}>
                                        {r.paid ? 'Pagado' : 'Pendiente'}
                                    </span>
                                )}
                            </span>
                        </span>
                    ))}
                </At>
                <At x={14} y={176} w={232} a="cbh-copy" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -14px rgba(15,23,42,.45)' }}>
                    <Copy size={11} color={primary()} />
                    <T size={8} weight={600}>
                        Link de pago creado y copiado
                    </T>
                    <T size={7} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                        FAC-1042
                    </T>
                </At>
                <At x={14} y={222} a="cbh-msg">
                    <Bubble side="right" style={{ maxWidth: 232 }}>
                        Hola, Hotel Brisas: aquí puedes pagar la factura FAC-1042 por $ 1.250.000:{' '}
                        <span style={{ color: tone('blue'), fontWeight: 600 }}>mpago.la/2xK9</span>
                    </Bubble>
                </At>

                {/* La página de pago que ve el cliente */}
                <At x={268} y={20} w={198} h={260} a="cbh-pay" style={{ borderRadius: 18, border: '5px solid #111827', background: '#fff', overflow: 'hidden', boxShadow: '0 16px 32px -16px rgba(15,23,42,.55)' }}>
                    <div style={{ height: 34, background: MP, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' }}>
                        <Smartphone size={11} color="#fff" />
                        <T size={8.5} weight={800} color="#fff">
                            Pago seguro
                        </T>
                    </div>
                    <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <span style={{ fontSize: 7.5, color: '#6b7280' }}>Café Aurora · Factura FAC-1042</span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>$ 1.250.000</span>
                        {[
                            { l: 'PSE', icon: <Landmark size={11} /> },
                            { l: 'Nequi', icon: <Smartphone size={11} /> },
                            { l: 'Tarjeta', icon: <CreditCard size={11} /> },
                        ].map((m, i) => (
                            <span key={m.l} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 24, padding: '0 8px', borderRadius: 6, border: `1px solid ${i === 0 ? MP : '#e5e7eb'}`, background: i === 0 ? 'rgba(0,158,227,.08)' : '#fff', color: '#374151' }}>
                                {m.icon}
                                <span style={{ fontSize: 8, fontWeight: 600 }}>{m.l}</span>
                            </span>
                        ))}
                        <span data-a="" style={{ marginTop: 4, height: 28, borderRadius: 7, background: MP, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'cbh-tap' }}>
                            <span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>Pagar</span>
                        </span>
                    </div>
                </At>
            </div>
        </Stage>
    );
}
