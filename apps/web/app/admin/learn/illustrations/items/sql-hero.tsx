import { RefreshCw } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Chip, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de «Bases de datos SQL»: las filas de una tabla del sistema contable
 * viajan a una lista de la app, emparejadas por el número de factura, y la
 * sincronización queda «Al día».
 */

const ROWS = [
    { n: 'FAC-1040', c: 'Hotel Brisas', v: '$ 2.300.000', s: 'Pagada', t: 'mint' as const },
    { n: 'FAC-1041', c: 'Clínica Norte', v: '$ 980.000', s: 'Pendiente', t: 'amber' as const },
    { n: 'FAC-1042', c: 'Colegio Andino', v: '$ 4.150.000', s: 'Pendiente', t: 'amber' as const },
    { n: 'FAC-1043', c: 'Óptica Visión', v: '$ 640.000', s: 'Vencida', t: 'rose' as const },
];

const CSS = `
${ROWS.map(
    (_, i) => `
@keyframes sh-pkt${i}{0%,${8 + i * 14}%{opacity:0;transform:translateX(0)}${10 + i * 14}%{opacity:1}${20 + i * 14}%{opacity:1;transform:translateX(118px)}${22 + i * 14}%,100%{opacity:0;transform:translateX(118px)}}
@keyframes sh-row${i}{0%,${18 + i * 14}%{opacity:0;transform:translateX(-6px)}${22 + i * 14}%{opacity:1;transform:translateX(0);background:${primary(0.12)}}${32 + i * 14}%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}`,
).join('')}
@keyframes sh-spin{0%,6%{transform:rotate(0)}70%{transform:rotate(720deg)}100%{transform:rotate(720deg)}}
@keyframes sh-ok{0%,74%{opacity:0;transform:scale(.7)}80%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes sh-run{0%,74%{opacity:1}80%,100%{opacity:0}}
`;

export default function SqlHero(): JSX.Element {
    return (
        <Stage label="Las filas de la tabla de facturas del sistema contable viajan a una lista de la app, emparejadas por el número de factura, y la sincronización queda al día." tint="rose">
            <Keyframes css={CSS} />

            {/* La base de datos */}
            <At x={18} y={40} w={170} h={220} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 14px 32px -18px rgba(15,23,42,.5)' }}>
                <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 7, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey="sqlserver" size={24} />
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                        <T size={9.5} weight={700}>
                            SQL Server
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
                            ERP · dbo.Facturas
                        </T>
                    </span>
                </div>
                {ROWS.map((r) => (
                    <div key={r.n} style={{ height: 30, display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center', gap: 4, padding: '0 10px', borderBottom: `1px solid ${C.border}`, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        <T size={8} weight={700}>
                            {r.n}
                        </T>
                        <T size={8} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.v.replace('$ ', '').replace(/\./g, '')}
                        </T>
                    </div>
                ))}
                <div style={{ padding: '8px 10px' }}>
                    <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                        SELECT * FROM dbo.Facturas
                    </T>
                </div>
            </At>

            {/* Las filas viajando */}
            {ROWS.map((r, i) => (
                <At key={`p${r.n}`} x={176} y={88 + i * 30} a={`sh-pkt${i}`} style={{ opacity: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px', borderRadius: 5, background: primary(), color: C.primaryFg, fontSize: 7.5, fontWeight: 700 }}>{r.n}</span>
                </At>
            ))}

            {/* La lista de la app */}
            <At x={240} y={26} w={222} h={248} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', boxShadow: '0 16px 36px -18px rgba(15,23,42,.55)' }}>
                <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10} weight={700}>
                        Facturas del ERP
                    </T>
                    <span style={{ marginLeft: 'auto', position: 'relative', height: 18, width: 74 }}>
                        <span data-a="" style={{ animationName: 'sh-run', position: 'absolute', right: 0, top: 0, display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: '0 6px', borderRadius: 99, background: tone('blue', 0.14), color: tone('blue'), fontSize: 8, fontWeight: 700, opacity: 0 }}>
                            <span data-a="" style={{ animationName: 'sh-spin', display: 'inline-flex' }}>
                                <RefreshCw size={9} />
                            </span>
                            Sincronizando
                        </span>
                        <span data-a="" style={{ animationName: 'sh-ok', position: 'absolute', right: 0, top: 0, display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 7px', borderRadius: 99, background: 'hsl(var(--imcrm-success) / .14)', color: C.success, fontSize: 8, fontWeight: 700 }}>
                            Al día
                        </span>
                    </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '58px 1fr 58px', gap: 4, height: 22, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {['Factura', 'Cliente', 'Estado'].map((h) => (
                        <T key={h} size={7.5} weight={700} color={C.mutedFg}>
                            {h}
                        </T>
                    ))}
                </div>
                {ROWS.map((r, i) => (
                    <div key={r.n} data-a="" style={{ animationName: `sh-row${i}`, height: 38, display: 'grid', gridTemplateColumns: '58px 1fr 58px', alignItems: 'center', gap: 4, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={700}>
                            {r.n}
                        </T>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <T size={8.5} weight={600} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {r.c}
                            </T>
                            <T size={7.5} color={C.mutedFg}>
                                {r.v}
                            </T>
                        </span>
                        <Chip label={r.s} t={r.t} />
                    </div>
                ))}
                <div style={{ padding: '7px 10px' }}>
                    <T size={8} color={C.mutedFg}>
                        Próxima: hoy 11:00 · cada hora
                    </T>
                </div>
            </At>
        </Stage>
    );
}
