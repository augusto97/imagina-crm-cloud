import { ArrowRight, KeyRound, Plus } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El mapeo: «Probar» trae las columnas que devuelve la consulta, con su tipo de
 * SQL, y cada una va a un campo de la lista (uno que ya existe o uno nuevo con
 * el tipo sugerido). La columna clave se marca aparte.
 */

const MAP = [
    { col: 'NumFactura', sql: 'nvarchar', field: 'Número', type: 'Texto', key: true, create: false },
    { col: 'NIT', sql: 'varchar', field: 'NIT del cliente', type: 'Texto', key: false, create: false },
    { col: 'Total', sql: 'money', field: 'Total', type: 'Moneda', key: false, create: true },
    { col: 'Pagada', sql: 'bit', field: 'Pagada', type: 'Casilla', key: false, create: true },
    { col: 'FechaVence', sql: 'date', field: 'Vence', type: 'Fecha', key: false, create: false },
];

const CSS = `
${MAP.map(
    (_, i) => `
@keyframes sm-l${i}{0%,${8 + i * 12}%{opacity:0;transform:scaleX(0)}${14 + i * 12}%,92%{opacity:1;transform:scaleX(1)}97%,100%{opacity:0;transform:scaleX(0)}}
@keyframes sm-f${i}{0%,${12 + i * 12}%{opacity:0;transform:translateX(-8px)}${17 + i * 12}%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}`,
).join('')}
@keyframes sm-key{0%,10%{box-shadow:0 0 0 0 transparent}16%,30%{box-shadow:0 0 0 3px ${primary(0.35)}}40%,100%{box-shadow:0 0 0 0 transparent}}
`;

export default function SqlMapping(): JSX.Element {
    return (
        <Stage label="Probar trae las columnas que devuelve la consulta con su tipo; cada una va a un campo de la lista, existente o nuevo con el tipo sugerido, y el número de factura queda como columna clave." tint="rose">
            <Keyframes css={CSS} />
            <At x={22} y={18} w={436}>
                <span style={{ display: 'grid', gridTemplateColumns: '170px 60px 1fr', alignItems: 'center' }}>
                    <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Columna en SQL
                    </T>
                    <span />
                    <T size={8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Campo de la lista
                    </T>
                </span>
            </At>
            {MAP.map((m, i) => (
                <At key={m.col} x={22} y={40 + i * 48} w={436} h={40} style={{ display: 'grid', gridTemplateColumns: '170px 60px 1fr', alignItems: 'center' }}>
                    <span
                        data-a={m.key ? '' : undefined}
                        style={{
                            animationName: m.key ? 'sm-key' : undefined,
                            height: 34,
                            borderRadius: 8,
                            border: `1px solid ${m.key ? primary(0.6) : C.border}`,
                            background: C.card,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '0 9px',
                            fontFamily: 'ui-monospace, Menlo, monospace',
                        }}
                    >
                        {m.key && <KeyRound size={11} color={primary()} />}
                        <T size={9} weight={700} style={{ fontFamily: 'inherit' }}>
                            {m.col}
                        </T>
                        <T size={8} color={C.mutedFg} style={{ marginLeft: 'auto', fontFamily: 'inherit' }}>
                            {m.sql}
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: `sm-l${i}`, transformOrigin: 'left center', display: 'flex', alignItems: 'center', justifyContent: 'center', color: primary() }}>
                        <span style={{ flex: 1, height: 2, background: primary(0.5), marginLeft: 6 }} />
                        <ArrowRight size={13} />
                    </span>
                    <span
                        data-a=""
                        style={{ animationName: `sm-f${i}`, height: 34, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)' }}
                    >
                        <T size={9.5} weight={700}>
                            {m.field}
                        </T>
                        <T size={8.5} color={C.mutedFg}>
                            ({m.type})
                        </T>
                        {m.key && (
                            <span style={{ marginLeft: 'auto', height: 16, padding: '0 6px', borderRadius: 99, background: primary(0.14), color: primary(), fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>clave</span>
                        )}
                        {m.create && (
                            <span style={{ marginLeft: 'auto', height: 16, padding: '0 6px', borderRadius: 99, background: tone('mint', 0.15), color: tone('mint'), fontSize: 8, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                <Plus size={8} /> campo nuevo
                            </span>
                        )}
                    </span>
                </At>
            ))}
        </Stage>
    );
}
