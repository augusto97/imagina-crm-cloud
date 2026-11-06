import { Lock, PencilLine } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * v0.1.383 — Las columnas que escribe Mercado Pago llevan candado: tocar
 * «Valor» muestra por qué no se cambia a mano. Las columnas propias de la
 * empresa (lápiz) se escriben libres y nunca viajan a Mercado Pago.
 */

const CSS = `
@keyframes cc-tip{0%,14%{opacity:0;transform:translateY(4px)}20%,44%{opacity:1;transform:translateY(0)}50%,100%{opacity:0;transform:translateY(0)}}
@keyframes cc-hl{0%,14%{box-shadow:none}18%,44%{box-shadow:inset 0 0 0 1.5px hsl(var(--imcrm-warning))}50%,100%{box-shadow:none}}
@keyframes cc-own{0%,54%{box-shadow:none}58%,90%{box-shadow:inset 0 0 0 1.5px ${primary()}}96%,100%{box-shadow:none}}
@keyframes cc-type{0%,58%{width:0}74%,92%{width:78px}98%,100%{width:0}}
@keyframes cc-badge{0%,72%{opacity:0;transform:scale(.85)}78%,92%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
`;

const COLS = '74px 52px 58px 58px 1fr';

const ROWS = [
    { n: 'Ana García', st: 'Al día', color: '#10B981', v: '$ 90.000', p: '30/11', notes: '' },
    { n: 'Beto Ruiz', st: 'Reintentando', color: '#F59E0B', v: '$ 90.000', p: '02/12', notes: 'Pagó en efectivo' },
    { n: 'Carla Díaz', st: 'Al día', color: '#10B981', v: '$ 150.000', p: '05/12', notes: '' },
];

function Head({ label, own }: { label: string; own?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <T size={7} weight={700} color={C.mutedFg}>
                {label}
            </T>
            {own ? <PencilLine size={8} color="#10B981" /> : <Lock size={8} color={C.mutedFg} />}
        </span>
    );
}

export default function CobroCandados(): JSX.Element {
    return (
        <Stage label="Una lista de suscriptores: las columnas que escribe Mercado Pago (estado, valor, próximo cobro) llevan candado y no se cambian a mano; la columna propia «Notas internas» se escribe libre y nunca viaja a Mercado Pago." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={14} y={22} w={452} h={200} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={10} weight={700}>
                            Suscriptores · Mercado Pago
                        </T>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, padding: '6px 12px', borderBottom: `1px solid ${C.border}`, background: C.muted }}>
                        <Head label="Suscriptor" own />
                        <Head label="Estado" />
                        <Head label="Valor" />
                        <Head label="Próximo cobro" />
                        <Head label="Notas internas" own />
                    </span>
                    {ROWS.map((r, i) => (
                        <span key={r.n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
                            <T size={8} weight={600}>
                                {r.n}
                            </T>
                            <span style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', height: 14, padding: '0 6px', borderRadius: 99, background: r.color, color: '#fff', fontSize: 6.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {r.st}
                            </span>
                            <span data-a={i === 0 ? '' : undefined} style={{ borderRadius: 4, padding: '1px 2px', animationName: i === 0 ? 'cc-hl' : undefined }}>
                                <T size={7.5}>{r.v}</T>
                            </span>
                            <T size={7.5} color={C.mutedFg}>
                                {r.p}
                            </T>
                            <span data-a={i === 0 ? '' : undefined} style={{ borderRadius: 4, padding: '1px 3px', minHeight: 12, animationName: i === 0 ? 'cc-own' : undefined }}>
                                {i === 0 ? (
                                    <span data-a="" style={{ display: 'inline-block', overflow: 'hidden', whiteSpace: 'nowrap', verticalAlign: 'bottom', animationName: 'cc-type' }}>
                                        <T size={7.5}>Llamar el lunes</T>
                                    </span>
                                ) : (
                                    <T size={7.5} color={C.mutedFg}>
                                        {r.notes || '—'}
                                    </T>
                                )}
                            </span>
                        </span>
                    ))}
                </At>
                <At x={120} y={156} w={238} h={52}>
                    <span data-a="" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '7px 9px', borderRadius: 8, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 10px 22px -12px rgba(15,23,42,.5)', animationName: 'cc-tip', opacity: 0 }}>
                        <Lock size={10} color="hsl(var(--imcrm-warning))" style={{ marginTop: 1, flexShrink: 0 }} />
                        <T size={7} color={C.fg}>
                            Es lo que cobra la suscripción. Para cambiarlo, usa «Cambiar el valor» en la sección «Suscripción» de la ficha.
                        </T>
                    </span>
                </At>
                <At x={300} y={236} w={166} h={40}>
                    <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 9px', borderRadius: 99, background: 'rgba(16,185,129,.14)', animationName: 'cc-badge', opacity: 0 }}>
                        <PencilLine size={10} color="#10B981" />
                        <T size={7.5} weight={700} color="#059669">
                            Sólo en la app: no viaja a Mercado Pago
                        </T>
                    </span>
                </At>
            </div>
        </Stage>
    );
}
