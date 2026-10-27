import type { CSSProperties } from 'react';
import { Filter, Link2 } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary } from '../kit';

/**
 * Las columnas de cobro en la tabla: cada factura con su link, su estado, la
 * fecha, el monto pagado y el medio. Los estados cambian solos con los avisos
 * del proveedor y un filtro deja sólo lo que falta cobrar.
 */

const ST: Record<string, { label: string; color: string }> = {
    pendiente: { label: 'Pendiente', color: '#F59E0B' },
    pagado: { label: 'Pagado', color: '#10B981' },
    vencido: { label: 'Vencido', color: '#6B7280' },
    distinto: { label: 'Monto distinto', color: '#F97316' },
    reembolsado: { label: 'Reembolsado', color: '#8B5CF6' },
};

const ROWS = [
    { n: 'FAC-1040', from: 'pagado', to: 'pagado', fecha: '18/10', monto: '$ 210.000', medio: 'PSE' },
    { n: 'FAC-1041', from: 'pendiente', to: 'pagado', fecha: '27/10', monto: '$ 480.000', medio: 'Nequi', flip: 1 },
    { n: 'FAC-1042', from: 'pendiente', to: 'pendiente', fecha: '—', monto: '—', medio: '—' },
    { n: 'FAC-1043', from: 'pendiente', to: 'distinto', fecha: '26/10', monto: '$ 300.000', medio: 'Tarjeta', flip: 2 },
    { n: 'FAC-1044', from: 'pendiente', to: 'vencido', fecha: '—', monto: '—', medio: '—', flip: 3 },
    { n: 'FAC-1045', from: 'pagado', to: 'reembolsado', fecha: '20/10', monto: '$ 150.000', medio: 'PSE', flip: 4 },
];

const flipKeys = [1, 2, 3, 4]
    .map((i) => {
        const s = 8 + i * 9;
        return `@keyframes ce-o${i}{0%,${s}%{opacity:1}${s + 3}%,100%{opacity:0}}
@keyframes ce-n${i}{0%,${s}%{opacity:0;transform:scale(.8)}${s + 3}%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0;transform:scale(1)}}
@keyframes ce-r${i}{0%,${s}%{background:transparent}${s + 3}%,${s + 12}%{background:${primary(0.08)}}${s + 18}%,100%{background:transparent}}`;
    })
    .join('\n');

const CSS = `
${flipKeys}
@keyframes ce-filter{0%,62%{opacity:0;transform:translateY(-6px)}68%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0;transform:translateY(0)}}
@keyframes ce-dim{0%,66%{opacity:1}72%,92%{opacity:.25}97%,100%{opacity:1}}
`;

function Chip({ k, a, style }: { k: string; a?: string; style?: CSSProperties }): JSX.Element {
    const s = ST[k]!;
    return (
        <span data-a={a ? '' : undefined} style={{ gridArea: '1/1', justifySelf: 'start', display: 'inline-flex', alignItems: 'center', height: 15, padding: '0 6px', borderRadius: 99, background: s.color, color: '#fff', fontSize: 7, fontWeight: 700, whiteSpace: 'nowrap', animationName: a, ...style }}>
            {s.label}
        </span>
    );
}

const COLS = '56px 22px 82px 38px 58px 1fr';

export default function CobroEstados(): JSX.Element {
    return (
        <Stage label="La tabla de facturas con las columnas de cobro: link, estado del pago, fecha, monto pagado y medio. Los estados cambian solos (pagado, monto distinto, vencido, reembolsado) y un filtro deja sólo las pendientes." tint="amber">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <At x={14} y={18} w={452} h={264} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 30px -16px rgba(15,23,42,.45)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={10} weight={700}>
                            Facturas
                        </T>
                        <span data-a="" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 6, background: primary(0.12), animationName: 'ce-filter' }}>
                            <Filter size={10} color={primary()} />
                            <T size={7.5} weight={700} color={primary()}>
                                Estado del pago es Pendiente
                            </T>
                        </span>
                    </span>
                    <span style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, padding: '6px 12px', borderBottom: `1px solid ${C.border}`, background: C.muted }}>
                        {['Número', 'Link', 'Estado del pago', 'Fecha', 'Monto pagado', 'Medio de pago'].map((h) => (
                            <T key={h} size={7} weight={700} color={C.mutedFg}>
                                {h}
                            </T>
                        ))}
                    </span>
                    {ROWS.map((r) => {
                        const dim = r.to !== 'pendiente';
                        return (
                            <span
                                key={r.n}
                                data-a=""
                                style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, animationName: [r.flip ? `ce-r${r.flip}` : '', dim ? 'ce-dim' : ''].filter(Boolean).join(', ') || 'none' }}
                            >
                                <T size={8} weight={600}>
                                    {r.n}
                                </T>
                                <Link2 size={10} color={primary()} />
                                <span style={{ display: 'inline-grid' }}>
                                    {r.flip ? (
                                        <>
                                            <Chip k={r.from} a={`ce-o${r.flip}`} style={{ opacity: 0 }} />
                                            <Chip k={r.to} a={`ce-n${r.flip}`} />
                                        </>
                                    ) : (
                                        <Chip k={r.to} />
                                    )}
                                </span>
                                <T size={7.5} color={C.mutedFg}>
                                    {r.fecha}
                                </T>
                                <T size={7.5}>{r.monto}</T>
                                <T size={7.5} color={C.mutedFg}>
                                    {r.medio}
                                </T>
                            </span>
                        );
                    })}
                </At>
            </div>
        </Stage>
    );
}
