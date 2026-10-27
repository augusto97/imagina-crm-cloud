import { FileSpreadsheet, Undo2 } from 'lucide-react';

import { At, Btn, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Actualizar desde un archivo: la lista de precios del proveedor se empareja
 * por SKU con los productos que ya existen y cambia sólo el precio; la vista
 * previa cuenta qué cambia, qué ya estaba así y qué no tiene registro.
 */

const ROWS: Array<[string, string, string, string, 'c' | 's' | 'n']> = [
    ['CAF-500', 'Café de origen 500 g', '$ 32.000', '$ 34.500', 'c'],
    ['CAF-250', 'Café de origen 250 g', '$ 18.000', '$ 19.200', 'c'],
    ['FIL-100', 'Filtros de papel ×100', '$ 9.500', '$ 9.500', 's'],
    ['TAZ-01', 'Taza de cerámica', '$ 24.000', '$ 25.900', 'c'],
];

const CSS = `
${ROWS.map((_, i) => `@keyframes ac-hl${i}{0%,${12 + i * 9}%{background:transparent}${15 + i * 9}%,${20 + i * 9}%{background:${primary(0.12)}}${24 + i * 9}%,100%{background:transparent}}`).join('\n')}
${ROWS.map((r, i) => (r[4] === 'c' ? `@keyframes ac-old${i}{0%,${16 + i * 9}%{opacity:1}${19 + i * 9}%,94%{opacity:0}98%,100%{opacity:1}}@keyframes ac-new${i}{0%,${16 + i * 9}%{opacity:0;transform:translateY(4px)}${19 + i * 9}%,94%{opacity:1;transform:translateY(0)}98%,100%{opacity:0}}` : '')).join('\n')}
@keyframes ac-miss{0%,48%{background:transparent}51%,92%{background:${tone('amber', 0.14)}}97%,100%{background:transparent}}
@keyframes ac-stats{0%,52%{opacity:0;transform:translateY(6px)}58%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ac-undo{0%,64%{opacity:0;transform:scale(.8)}70%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
`;

function Cell({ w, children, right }: { w: number; children: JSX.Element; right?: boolean }): JSX.Element {
    return <span style={{ width: w, display: 'flex', alignItems: 'center', justifyContent: right ? 'flex-end' : 'flex-start', position: 'relative', height: '100%' }}>{children}</span>;
}

export default function IeActualizar(): JSX.Element {
    return (
        <Stage label="La lista de precios del proveedor, en Excel, se empareja por SKU con los productos: tres precios cambian, uno ya estaba igual y un SKU nuevo queda sin registro; al final se puede deshacer." tint="amber">
            <Keyframes css={CSS} />
            {/* Archivo del proveedor */}
            <At x={12} y={30} w={150} h={176} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', background: tone('mint'), color: '#fff' }}>
                    <FileSpreadsheet size={10} />
                    <T size={8} weight={700} color="#fff">
                        precios-octubre.xlsx
                    </T>
                </span>
                <span style={{ display: 'flex', height: 24, background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                    <Cell w={66}>
                        <T size={7.5} weight={700} style={{ paddingLeft: 8 }}>
                            SKU
                        </T>
                    </Cell>
                    <Cell w={74} right>
                        <T size={7.5} weight={700}>
                            Precio
                        </T>
                    </Cell>
                </span>
                {[...ROWS.map((r) => [r[0], r[3]]), ['GRA-01', '$ 12.000']].map(([sku, p], i) => (
                    <span key={sku} data-a="" style={{ display: 'flex', height: 24, borderBottom: `1px solid ${C.border}`, animationName: i < ROWS.length ? `ac-hl${i}` : 'ac-miss' }}>
                        <Cell w={66}>
                            <T size={7.5} weight={600} style={{ paddingLeft: 8 }}>
                                {sku!}
                            </T>
                        </Cell>
                        <Cell w={74} right>
                            <T size={7.5}>{p!}</T>
                        </Cell>
                    </span>
                ))}
            </At>

            {/* Productos */}
            <At x={174} y={30} w={294} h={176} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -20px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <span style={{ display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8.5} weight={700}>
                        Productos
                    </T>
                </span>
                <span style={{ display: 'flex', height: 24, padding: '0 10px', background: C.muted, borderBottom: `1px solid ${C.border}` }}>
                    <Cell w={60}>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            SKU
                        </T>
                    </Cell>
                    <Cell w={140}>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Producto
                        </T>
                    </Cell>
                    <Cell w={74} right>
                        <T size={7.5} weight={700} color={C.mutedFg}>
                            Precio
                        </T>
                    </Cell>
                </span>
                {ROWS.map(([sku, name, before, after, kind], i) => (
                    <span key={sku} data-a="" style={{ display: 'flex', height: 24, padding: '0 10px', borderBottom: `1px solid ${C.border}`, animationName: `ac-hl${i}` }}>
                        <Cell w={60}>
                            <T size={7.5} weight={600}>
                                {sku}
                            </T>
                        </Cell>
                        <Cell w={140}>
                            <T size={7.5}>{name}</T>
                        </Cell>
                        <Cell w={74} right>
                            {kind === 'c' ? (
                                <>
                                    <span data-a="" style={{ position: 'absolute', right: 0, display: 'flex', animationName: `ac-old${i}`, opacity: 0 }}>
                                        <T size={7.5}>{before}</T>
                                    </span>
                                    <span data-a="" style={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 3, animationName: `ac-new${i}` }}>
                                        <T size={6.5} color={C.mutedFg} style={{ textDecoration: 'line-through' }}>
                                            {before}
                                        </T>
                                        <T size={7.5} weight={700} color={primary()}>
                                            {after}
                                        </T>
                                    </span>
                                </>
                            ) : (
                                <T size={7.5}>{before}</T>
                            )}
                        </Cell>
                    </span>
                ))}
            </At>

            {/* Resumen de la vista previa */}
            <At x={12} y={218} w={456} a="ac-stats" style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 14px 30px -18px rgba(15,23,42,.5)' }}>
                {[
                    ['3', 'Cambian', 'blue'],
                    ['1', 'Ya estaban así', 'slate'],
                    ['1', 'Sin registro', 'amber'],
                    ['0', 'Con error', 'rose'],
                ].map(([n, l, t]) => (
                    <span key={l} style={{ display: 'flex', alignItems: 'baseline', gap: 4, padding: '3px 8px', borderRadius: 7, background: tone(t as 'blue', 0.12) }}>
                        <T size={11} weight={800} color={tone(t as 'blue')}>
                            {n!}
                        </T>
                        <T size={7.5} weight={600}>
                            {l!}
                        </T>
                    </span>
                ))}
                <span data-a="" style={{ marginLeft: 'auto', display: 'flex', animationName: 'ac-undo' }}>
                    <Btn kind="outline" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Undo2 size={9} />Deshacer</span>} style={{ height: 20, fontSize: 8 }} />
                </span>
            </At>
        </Stage>
    );
}
