import { FunctionSquare, Hash, Type, Calendar } from 'lucide-react';

import { At, Btn, C, Chip, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Campo «Fórmula»: se escribe como en una hoja de cálculo, en español, con
 * autocompletado de campos; la vista previa muestra el resultado con un
 * registro real y, al guardar, la columna se llena sola.
 */

const EXPR_W = 206;

const CSS = `
@keyframes fx-type{0%,6%{width:0}40%,100%{width:${EXPR_W}px}}
@keyframes fx-caret{0%,40%{opacity:1}41%,100%{opacity:0}}
@keyframes fx-ac{0%,9%{opacity:0;transform:translateY(-4px)}11%,19%{opacity:1;transform:translateY(0)}22%,100%{opacity:0}}
@keyframes fx-acsel{0%,13%{background:transparent}15%,19%{background:${primary(0.14)}}}
@keyframes fx-pv0{0%,42%{opacity:1}45%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes fx-pv1{0%,42%{opacity:0;transform:scale(.7)}46%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes fx-dlg{0%,58%{opacity:1;transform:scale(1)}64%,92%{opacity:0;transform:scale(.97)}97%,100%{opacity:1;transform:scale(1)}}
@keyframes fx-cell{0%,62%{opacity:0;transform:scale(.6)}68%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes fx-head{0%,60%{opacity:0}66%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fx-cur{0%{transform:translate(300px,290px);opacity:0}44%{opacity:0;transform:translate(300px,290px)}48%{opacity:1}53%,58%{transform:translate(268px,262px)}70%,88%{transform:translate(420px,200px);opacity:1}94%,100%{transform:translate(420px,200px);opacity:0}}
@keyframes fx-ring{0%,55%{opacity:0;transform:scale(.4)}57%{opacity:1;transform:scale(1)}61%,100%{opacity:0;transform:scale(1.6)}}
`;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const ROWS: Array<[string, string, 'Grande' | 'Chico']> = [
    ['Café Bahía', '$ 1.250.000', 'Grande'],
    ['Clínica Norte', '$ 320.000', 'Chico'],
    ['Hotel Brisas', '$ 2.400.000', 'Grande'],
    ['Óptica Visión', '$ 85.000', 'Chico'],
    ['Ferretería Sol', '$ 1.020.000', 'Grande'],
];

export default function LcFormula(): JSX.Element {
    return (
        <Stage label="Se escribe la fórmula SI, Total mayor que un millón, Grande o Chico; al escribir la llave aparece la lista de campos, la vista previa muestra Grande con un registro real y, al guardar, la columna Tamaño se llena sola." tint="violet">
            <Keyframes css={CSS} />
            {/* Tabla de fondo */}
            <At x={176} y={22} w={292} h={256} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 14px 34px -22px rgba(15,23,42,.5)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', height: 28, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <span style={{ width: 100, display: 'flex' }}>
                        <T size={8} weight={600} color={C.mutedFg}>
                            Cliente
                        </T>
                    </span>
                    <span style={{ width: 82, display: 'flex', justifyContent: 'flex-end' }}>
                        <T size={8} weight={600} color={C.mutedFg}>
                            Total
                        </T>
                    </span>
                    <span data-a="" style={{ width: 86, display: 'flex', alignItems: 'center', gap: 3, paddingLeft: 16, animationName: 'fx-head' }}>
                        <FunctionSquare size={9} color={primary()} />
                        <T size={8} weight={700} color={primary()}>
                            Tamaño
                        </T>
                    </span>
                </div>
                {ROWS.map(([n, t, r], i) => (
                    <div key={n} style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 100, display: 'flex' }}>
                            <T size={8.5} weight={600}>
                                {n}
                            </T>
                        </span>
                        <span style={{ width: 82, display: 'flex', justifyContent: 'flex-end' }}>
                            <T size={8.5}>{t}</T>
                        </span>
                        <span data-a="" style={{ display: 'flex', paddingLeft: 16, animationName: 'fx-cell', animationDelay: `${i * 0.07}s` }}>
                            <Chip label={r} t={r === 'Grande' ? 'violet' : 'slate'} style={{ height: 15, fontSize: 7.5 }} />
                        </span>
                    </div>
                ))}
            </At>

            {/* Editor de la fórmula */}
            <At x={12} y={14} w={286} h={272} a="fx-dlg" style={{ zIndex: 4, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 22px 46px -18px rgba(15,23,42,.6)', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 6, background: tone('violet', 0.16), color: tone('violet'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FunctionSquare size={11} />
                    </span>
                    <T size={10.5} weight={700}>
                        Fórmula · Tamaño
                    </T>
                </span>
                <span style={{ position: 'relative', height: 30, borderRadius: 7, border: `1.5px solid ${primary()}`, background: C.muted, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                    <span data-a="" style={{ display: 'flex', overflow: 'hidden', width: EXPR_W, animationName: 'fx-type', animationTimingFunction: 'steps(40, end)' }}>
                        <span style={{ fontFamily: MONO, fontSize: 8.5, whiteSpace: 'pre', color: C.fg }}>
                            <b style={{ color: tone('violet') }}>SI</b>(<span style={{ color: tone('blue'), fontWeight: 700 }}>{'{Total}'}</span> &gt; <span style={{ color: tone('amber') }}>1000000</span>, <span style={{ color: tone('mint') }}>&quot;Grande&quot;</span>, <span style={{ color: tone('mint') }}>&quot;Chico&quot;</span>)
                        </span>
                    </span>
                    <span data-a="" style={{ width: 1.5, height: 12, background: primary(), animationName: 'fx-caret' }} />
                </span>
                {/* Autocompletado */}
                <At x={44} y={72} w={130} a="fx-ac" style={{ opacity: 0, zIndex: 5, background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, boxShadow: '0 12px 28px -12px rgba(15,23,42,.6)', padding: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {[
                        [<Hash key="h" size={9} />, 'Total', 'Moneda'],
                        [<Type key="t" size={9} />, 'Cliente', 'Texto'],
                        [<Calendar key="c" size={9} />, 'Fecha', 'Fecha'],
                    ].map(([ic, n, k], i) => (
                        <span key={n as string} data-a={i === 0 ? '' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 18, padding: '0 5px', borderRadius: 5, color: C.mutedFg, animationName: i === 0 ? 'fx-acsel' : undefined }}>
                            {ic}
                            <T size={8} weight={600}>
                                {n as string}
                            </T>
                            <T size={7} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                                {k as string}
                            </T>
                        </span>
                    ))}
                </At>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <T size={8} weight={600}>
                        Mostrar el resultado como
                    </T>
                    <span style={{ height: 18, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center' }}>
                        <T size={8}>Texto</T>
                    </span>
                </span>
                <span style={{ borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <T size={7.5} color={C.mutedFg}>
                            Vista previa con
                        </T>
                        <T size={7.5} weight={700}>
                            Café Bahía
                        </T>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 18, position: 'relative' }}>
                        <T size={8} color={C.mutedFg}>
                            Total $ 1.250.000 →
                        </T>
                        <span style={{ position: 'relative', display: 'flex', alignItems: 'center', width: 60 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'fx-pv0', opacity: 0 }}>
                                <T size={8} color={C.mutedFg}>
                                    …
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, display: 'flex', animationName: 'fx-pv1' }}>
                                <Chip label="Grande" t="violet" style={{ height: 15, fontSize: 7.5 }} />
                            </span>
                        </span>
                    </span>
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <T size={7.5} weight={700} color={C.mutedFg}>
                        Funciones y campos
                    </T>
                    {[
                        ['SI(condición, sí, no)', 'Elige un valor según una condición'],
                        ['SUMAR_DIAS_HABILES(fecha, días)', 'Sin fines de semana ni festivos'],
                        ['PESOS(valor)', 'El valor en letras'],
                    ].map(([f, d]) => (
                        <span key={f} style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: 700, color: tone('violet') }}>{f}</span>
                            <T size={7} color={C.mutedFg}>
                                {d}
                            </T>
                        </span>
                    ))}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                    <Btn label="Guardar" style={{ height: 20, fontSize: 8.5 }} />
                </span>
            </At>
            <Cursor a="fx-cur" click="fx-ring" rest={[420, 200]} />
        </Stage>
    );
}
