import type { ReactNode } from 'react';
import { Filter } from 'lucide-react';

import { At, C, Chip, Keyframes, Stage, T, Win, primary } from '../kit';

/** Filtrar: con «Estado es Pendiente» y «Vence en Esta semana» la lista pasa de 16 a 4 registros. */

const CSS = `
@keyframes vf-c1{0%,8%{opacity:0;transform:translateY(-5px)}14%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes vf-c2{0%,38%{opacity:0;transform:translateY(-5px)}44%,93%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}
@keyframes vf-out1{0%,18%{height:24px;opacity:1}27%,95%{height:0;opacity:0}100%{height:24px;opacity:1}}
@keyframes vf-out2{0%,48%{height:24px;opacity:1}57%,95%{height:0;opacity:0}100%{height:24px;opacity:1}}
@keyframes vf-n16{0%,20%{opacity:1}23%,96%{opacity:0}100%{opacity:1}}
@keyframes vf-n9{0%,20%{opacity:0}23%,50%{opacity:1}53%,100%{opacity:0}}
@keyframes vf-n4{0%,50%{opacity:0}53%,95%{opacity:1}98%,100%{opacity:0}}
@keyframes vf-b1{0%,13%{opacity:0}15%,93%{opacity:1}98%,100%{opacity:0}}
@keyframes vf-b2{0%,43%{opacity:0}45%,93%{opacity:1}98%,100%{opacity:0}}
`;

type Row = { n: string; s: string; t: 'amber' | 'blue' | 'mint'; d: string; out?: 1 | 2 };
const ROWS: Row[] = [
    { n: 'Llamar a Hotel Brisas', s: 'Pendiente', t: 'amber', d: 'Mié 28' },
    { n: 'Enviar cotización', s: 'En curso', t: 'blue', d: 'Jue 29', out: 1 },
    { n: 'Revisar contrato', s: 'Pendiente', t: 'amber', d: 'Lun 9', out: 2 },
    { n: 'Pedir el RUT', s: 'Pendiente', t: 'amber', d: 'Jue 29' },
    { n: 'Diseñar volante', s: 'Hecha', t: 'mint', d: 'Mar 27', out: 1 },
    { n: 'Visita a la sede', s: 'Pendiente', t: 'amber', d: 'Vie 30' },
    { n: 'Pagar proveedor', s: 'En curso', t: 'blue', d: 'Vie 30', out: 1 },
    { n: 'Renovar dominio', s: 'Pendiente', t: 'amber', d: 'Sáb 31' },
];

function Field({ w, children }: { w: number; children: ReactNode }): JSX.Element {
    return (
        <span style={{ width: w, height: 20, border: `1px solid ${C.border}`, borderRadius: 5, display: 'flex', alignItems: 'center', padding: '0 6px', fontSize: 9, fontWeight: 600, background: C.card, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {children}
        </span>
    );
}

function Cond({ y, a, f, op, v }: { y: number; a: string; f: string; op: string; v: ReactNode }): JSX.Element {
    return (
        <At x={10} y={y} w={168} a={a} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ display: 'flex', gap: 4 }}>
                <Field w={82}>{f}</Field>
                <Field w={82}>{op}</Field>
            </span>
            <Field w={168}>{v}</Field>
        </At>
    );
}

export default function VistasFiltros(): JSX.Element {
    return (
        <Stage label="Un panel de filtros sobre una lista de tareas: al agregar «Estado es Pendiente» y luego «Vence en Esta semana», las filas que no cumplen desaparecen y el contador baja de 16 a 4 registros." tint="blue">
            <Keyframes css={CSS} />
            <Win x={16} y={22} w={448} h={256} title="Tareas · Pendientes de la semana">
                {/* Barra */}
                <At x={10} y={8} w={240} h={22} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20, padding: '0 8px', borderRadius: 6, border: `1px solid ${primary(0.6)}`, color: primary(), fontSize: 9.5, fontWeight: 600 }}>
                        <Filter size={10} />
                        Filtrar
                        <span style={{ position: 'relative', width: 12, height: 12 }}>
                            {(['1', '2'] as const).map((n) => (
                                <span
                                    key={n}
                                    data-a=""
                                    style={{ position: 'absolute', inset: 0, borderRadius: 99, background: primary(), color: C.primaryFg, fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: `vf-b${n}`, opacity: n === '2' ? 1 : 0 }}
                                >
                                    {n}
                                </span>
                            ))}
                        </span>
                    </span>
                    <span style={{ position: 'relative', width: 90, height: 14 }}>
                        {[
                            ['16', 'vf-n16', 0],
                            ['9', 'vf-n9', 0],
                            ['4', 'vf-n4', 1],
                        ].map(([n, a, o]) => (
                            <span key={a as string} data-a="" style={{ position: 'absolute', left: 0, top: 0, animationName: a as string, opacity: o as number }}>
                                <T size={10} weight={700}>
                                    {n as string}
                                </T>
                                <T size={10} color={C.mutedFg}>
                                    {' '}
                                    registros
                                </T>
                            </span>
                        ))}
                    </span>
                </At>

                {/* Tabla */}
                <At x={10} y={36} w={232} h={192} style={{ overflow: 'hidden' }}>
                    {ROWS.map((r) => (
                        <div
                            key={r.n}
                            data-a={r.out ? '' : undefined}
                            style={{
                                height: r.out ? 0 : 24,
                                opacity: r.out ? 0 : 1,
                                overflow: 'hidden',
                                animationName: r.out ? `vf-out${r.out}` : undefined,
                            }}
                        >
                            <div style={{ height: 24, display: 'grid', gridTemplateColumns: '1fr 62px 40px', alignItems: 'center', borderBottom: `1px solid ${C.border}`, padding: '0 4px' }}>
                                <T size={9.5} weight={600}>
                                    {r.n}
                                </T>
                                <span>
                                    <Chip label={r.s} t={r.t} />
                                </span>
                                <T size={9} color={C.mutedFg}>
                                    {r.d}
                                </T>
                            </div>
                        </div>
                    ))}
                </At>

                {/* Panel de filtros */}
                <At x={252} y={8} w={188} h={214} style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.card, boxShadow: '0 12px 28px -14px rgba(15,23,42,.45)' }}>
                    <At x={10} y={9} w={168} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Filter size={10} color={C.mutedFg} />
                            <T size={10} weight={700}>
                                Filtros
                            </T>
                        </span>
                        <T size={8.5} color={C.mutedFg}>
                            Borrar todo
                        </T>
                    </At>
                    <Cond y={32} a="vf-c1" f="Estado" op="es" v={<Chip label="Pendiente" t="amber" />} />
                    <At x={10} y={82} a="vf-c2">
                        <span style={{ fontSize: 8.5, fontWeight: 700, color: primary(), background: primary(0.12), borderRadius: 4, padding: '2px 6px' }}>Y</span>
                    </At>
                    <Cond y={102} a="vf-c2" f="Vence" op="en" v="Esta semana" />
                    <At x={10} y={156}>
                        <T size={9} weight={600} color={primary()}>
                            + Agregar filtro
                        </T>
                    </At>
                    <At x={10} y={174}>
                        <T size={9} color={C.mutedFg}>
                            Agregar filtro anidado
                        </T>
                    </At>
                </At>
            </Win>
        </Stage>
    );
}
