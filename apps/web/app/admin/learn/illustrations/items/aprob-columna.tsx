import { ClipboardCheck, Filter } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * La columna «Aprobación»: muestra el estado de la última solicitud de cada
 * registro y sirve para filtrar («lo que falta aprobar») y agrupar.
 */

type Tn = 'amber' | 'mint' | 'rose' | 'blue';
const ROWS: Array<{ n: string; who: string; m: string; st: string; t: Tn }> = [
    { n: 'Viaje a Medellín', who: 'Carlos Ruiz', m: '$ 2.400.000', st: 'Pendiente', t: 'amber' },
    { n: 'Computador nuevo', who: 'Lucía Martínez', m: '$ 3.900.000', st: 'Aprobada', t: 'mint' },
    { n: 'Feria de cafés', who: 'Jorge Herrera', m: '$ 1.750.000', st: 'Pendiente', t: 'amber' },
    { n: 'Muebles terraza', who: 'Valentina Ríos', m: '$ 5.200.000', st: 'Rechazada', t: 'rose' },
    { n: 'Publicidad redes', who: 'Andrés Mejía', m: '$ 1.200.000', st: 'Devuelta', t: 'blue' },
];
const PENDING = [0, 2];
// Posición de cada fila después de filtrar (las pendientes suben).
const AFTER: Record<number, number> = { 0: 0, 2: 1 };

const RH = 32;

function rowCss(i: number): string {
    if (PENDING.includes(i)) {
        const dy = (AFTER[i]! - i) * RH;
        return `@keyframes apcol-r${i}{0%,40%{transform:translateY(0)}48%,92%{transform:translateY(${dy}px)}98%,100%{transform:translateY(0)}}`;
    }
    return `@keyframes apcol-r${i}{0%,38%{opacity:1}44%,94%{opacity:0}100%{opacity:1}}`;
}

const CSS = `
@keyframes apcol-cur{0%{transform:translate(300px,290px);opacity:0}6%{opacity:1}14%,18%{transform:translate(70px,62px)}28%,32%{transform:translate(196px,120px)}44%,90%{transform:translate(440px,280px);opacity:1}96%,100%{opacity:0;transform:translate(440px,280px)}}
@keyframes apcol-ring{0%,15%{opacity:0;transform:scale(.4)}17%{opacity:1;transform:scale(1)}21%{opacity:0;transform:scale(1.6)}29%{opacity:0;transform:scale(.4)}31%{opacity:1;transform:scale(1)}35%,100%{opacity:0;transform:scale(1.6)}}
@keyframes apcol-pop{0%,17%{opacity:0;transform:translateY(-4px)}21%,34%{opacity:1;transform:translateY(0)}38%,100%{opacity:0;transform:translateY(-4px)}}
@keyframes apcol-chip{0%,34%{opacity:0;transform:scale(.7)}39%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes apcol-hint{0%,46%{opacity:0;transform:translateY(6px)}52%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
${ROWS.map((_, i) => rowCss(i)).join('\n')}
`;

export default function AprobColumna(): JSX.Element {
    return (
        <Stage label="La columna Aprobación de una lista de gastos muestra el estado de cada solicitud; con un filtro «Aprobación es Pendiente» quedan sólo los gastos que falta aprobar." tint="amber">
            <Keyframes css={CSS} />
            <Win x={14} y={14} w={452} h={272} title="Gastos">
                {/* Barra de herramientas */}
                <At x={10} y={8} w={432} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ height: 22, padding: '0 9px', borderRadius: 6, border: `1px solid ${C.border}`, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8.4, fontWeight: 600 }}>
                        <Filter size={10} /> Filtrar
                    </span>
                    <span data-a="" style={{ animationName: 'apcol-chip', height: 22, padding: '0 9px', borderRadius: 99, background: primary(0.12), color: primary(), fontSize: 8.2, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Aprobación es Pendiente ✕
                    </span>
                </At>
                {/* Encabezados */}
                <At x={0} y={38} w={452} h={24} style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, background: C.muted }}>
                    <T size={7.6} weight={700} color={C.mutedFg} style={{ width: 150 }}>
                        Gasto
                    </T>
                    <T size={7.6} weight={700} color={C.mutedFg} style={{ width: 120 }}>
                        Solicitante
                    </T>
                    <T size={7.6} weight={700} color={C.mutedFg} style={{ width: 80 }}>
                        Monto
                    </T>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <ClipboardCheck size={10} color={C.mutedFg} />
                        <T size={7.6} weight={700} color={C.mutedFg}>
                            Aprobación
                        </T>
                    </span>
                </At>
                <At x={0} y={142} w={452} a="apcol-hint" style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 12px', borderRadius: 8, background: tone('amber', 0.1), border: `1px dashed ${tone('amber', 0.45)}` }}>
                        <ClipboardCheck size={12} color={tone('amber')} />
                        <T size={8.4} weight={600}>
                            2 gastos esperan una decisión · también puedes agrupar por «Aprobación»
                        </T>
                    </span>
                </At>
                {ROWS.map((r, i) => (
                    <At key={r.n} x={0} y={62 + i * RH} w={452} h={RH} a={`apcol-r${i}`} style={{ display: 'flex', alignItems: 'center', padding: '0 12px', borderBottom: `1px solid ${C.border}`, background: C.card, ...(PENDING.includes(i) ? { transform: `translateY(${(AFTER[i]! - i) * RH}px)` } : { opacity: 0 }) }}>
                        <T size={8.8} weight={600} style={{ width: 150 }}>
                            {r.n}
                        </T>
                        <T size={8.2} color={C.mutedFg} style={{ width: 120 }}>
                            {r.who}
                        </T>
                        <T size={8.2} weight={600} style={{ width: 80 }}>
                            {r.m}
                        </T>
                        <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone(r.t), color: '#fff', fontSize: 8.4, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{r.st}</span>
                    </At>
                ))}
            </Win>
            {/* El filtro */}
            <At x={30} y={78} w={210} a="apcol-pop" style={{ opacity: 0, zIndex: 6, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 16px 34px -14px rgba(15,23,42,.5)', padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <T size={8.4} weight={700}>
                    Filtros
                </T>
                <span style={{ display: 'flex', gap: 4 }}>
                    {['Aprobación', 'es', 'Pendiente'].map((v, i) => (
                        <span key={v} style={{ flex: i === 1 ? 0.6 : 1, height: 22, borderRadius: 6, border: `1px solid ${i === 2 ? primary(0.6) : C.border}`, display: 'flex', alignItems: 'center', padding: '0 6px' }}>
                            {i === 2 ? (
                                <span style={{ height: 14, padding: '0 5px', borderRadius: 4, background: tone('amber'), color: '#fff', fontSize: 7.6, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{v}</span>
                            ) : (
                                <T size={8}>{v}</T>
                            )}
                        </span>
                    ))}
                </span>
            </At>
            <Cursor a="apcol-cur" click="apcol-ring" rest={[440, 280]} />
        </Stage>
    );
}
