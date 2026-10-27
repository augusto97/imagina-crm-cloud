import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Wand2, X } from 'lucide-react';

import { At, Btn, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/** Edición masiva: subir 12 % y redondear a «terminar en 900»; la vista previa muestra cada precio antes y después y se aplica a 214 productos. */

const SAMPLE: Array<[string, string, string]> = [
    ['Camiseta básica', '$ 39.900', '$ 44.900'],
    ['Jean clásico', '$ 119.000', '$ 133.900'],
    ['Chaqueta de jean', '$ 189.900', '$ 212.900'],
    ['Gorra bordada', '$ 32.500', '$ 36.900'],
];

const CSS = `
@keyframes le-dlg{0%,2%{opacity:0;transform:translateY(10px) scale(.98)}6%,94%{opacity:1;transform:translateY(0) scale(1)}99%,100%{opacity:0}}
@keyframes le-op2{0%,12%{opacity:0;transform:translateY(-6px)}17%,100%{opacity:1;transform:translateY(0)}}
@keyframes le-form{0%,29%{opacity:1}33%,100%{opacity:0}}
@keyframes le-prev{0%,30%{opacity:0;transform:translateY(6px)}35%,100%{opacity:1;transform:translateY(0)}}
${SAMPLE.map((_, i) => `@keyframes le-row${i}{0%,${36 + i * 4}%{opacity:0;transform:translateX(-6px)}${40 + i * 4}%,100%{opacity:1;transform:translateX(0)}}`).join('\n')}
@keyframes le-prog{0%,62%{width:0}78%,100%{width:100%}}
@keyframes le-run{0%,60%{opacity:0}63%,79%{opacity:1}82%,100%{opacity:0}}
@keyframes le-done{0%,80%{opacity:0;transform:translateY(4px)}84%,100%{opacity:1;transform:translateY(0)}}
@keyframes le-foot{0%,60%{opacity:1}63%,100%{opacity:0}}
@keyframes le-cur{0%{transform:translate(420px,300px);opacity:0}8%{opacity:1}14%,16%{transform:translate(102px,164px)}26%,29%{transform:translate(388px,250px)}52%,60%{transform:translate(372px,261px);opacity:1}70%,88%{transform:translate(430px,286px);opacity:1}95%,100%{transform:translate(430px,286px);opacity:0}}
@keyframes le-ring{0%,14%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%,27%{opacity:0;transform:scale(1.6)}28%{opacity:1;transform:scale(1)}31%,58%{opacity:0;transform:scale(1.6)}59%{opacity:1;transform:scale(1)}62%,100%{opacity:0;transform:scale(1.6)}}
`;

function Box({ w, children, strong }: { w: number; children: ReactNode; strong?: boolean }): JSX.Element {
    return (
        <span style={{ width: w, height: 22, border: `1px solid ${strong ? primary(0.6) : C.border}`, borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 7px', fontSize: 9.5, fontWeight: 600, background: C.card, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            {children}
        </span>
    );
}

function Op({ y, n, col, what, val, a }: { y: number; n: number; col: string; what: string; val: string; a?: string }): JSX.Element {
    return (
        <At x={14} y={y} w={372} a={a} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 7, border: `1px solid ${C.border}`, borderRadius: 8, background: C.muted }}>
            <span style={{ width: 16, height: 16, borderRadius: 99, background: primary(), color: C.primaryFg, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
            <Box w={70}>{col}</Box>
            <Box w={158}>{what}</Box>
            <Box w={96} strong>
                {val}
            </Box>
        </At>
    );
}

export default function LoteEditar(): JSX.Element {
    return (
        <Stage label="La edición masiva de una tienda de ropa: a 214 productos se les sube el precio un 12 % y se redondea a terminar en 900; la vista previa muestra cada precio antes y después, y al aplicar se actualizan todos con la opción de deshacer." tint="amber">
            <Keyframes css={CSS} />
            <At x={40} y={14} w={400} h={272} a="le-dlg" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: '0 22px 50px -20px rgba(15,23,42,.55)', overflow: 'hidden' }}>
                <At x={14} y={12} w={372} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Wand2 size={13} color={primary()} />
                    <T size={12} weight={700}>
                        Edición masiva
                    </T>
                    <span style={{ flex: 1 }} />
                    <X size={12} color={C.mutedFg} />
                </At>
                <At x={14} y={36} w={372} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={9} weight={600} color={C.mutedFg}>
                        A qué registros:
                    </T>
                    <span style={{ fontSize: 9, fontWeight: 700, color: primary(), background: primary(0.12), borderRadius: 99, padding: '2px 8px' }}>Todos los que coinciden con la vista (214)</span>
                </At>

                {/* Formulario */}
                <At x={0} y={58} w={400} h={190} a="le-form" style={{ opacity: 0 }}>
                    <Op y={4} n={1} col="Precio" what="Subir o bajar un porcentaje" val="12 %" />
                    <Op y={46} n={2} col="Precio" what="Redondear · Hacia arriba" val="Terminar en 900" a="le-op2" />
                    <At x={14} y={90} w={372} style={{ display: 'flex' }}>
                        <T size={9} weight={600} color={primary()}>
                            + Agregar otro cambio
                        </T>
                    </At>
                    <At x={14} y={110} w={372} style={{ display: 'flex' }}>
                        <T size={8.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Los cambios se aplican en orden y cada uno parte del valor de cada registro.
                        </T>
                    </At>
                    <At x={14} y={168} w={372} style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn label="Cancelar" kind="outline" />
                        <Btn label="Ver vista previa" />
                    </At>
                </At>

                {/* Vista previa */}
                <At x={0} y={58} w={400} h={214} a="le-prev">
                    <At x={14} y={0} w={372} style={{ display: 'flex', gap: 6 }}>
                        {(
                            [
                                ['Van a cambiar', '214', 'mint'],
                                ['Ya estaban así', '0', 'slate'],
                                ['No se pueden cambiar', '0', 'rose'],
                            ] as const
                        ).map(([l, n, t]) => (
                            <span key={l} style={{ flex: 1, borderRadius: 8, background: tone(t, 0.12), padding: '5px 8px', display: 'flex', flexDirection: 'column' }}>
                                <T size={13} weight={800} color={tone(t)}>
                                    {n}
                                </T>
                                <T size={8} weight={600} color={C.mutedFg}>
                                    {l}
                                </T>
                            </span>
                        ))}
                    </At>
                    <At x={14} y={46} w={372} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 18px 80px', padding: '4px 9px', background: C.muted }}>
                            {['Registro', 'Antes', '', 'Después'].map((h, i) => (
                                <T key={i} size={8} weight={700} color={C.mutedFg}>
                                    {h}
                                </T>
                            ))}
                        </div>
                        {SAMPLE.map((r, i) => (
                            <div key={r[0]} data-a="" style={{ display: 'grid', gridTemplateColumns: '1fr 80px 18px 80px', alignItems: 'center', padding: '0 9px', height: 24, borderTop: `1px solid ${C.border}`, animationName: `le-row${i}` }}>
                                <T size={9.5} weight={600}>
                                    {r[0]}
                                </T>
                                <T size={9.5} color={C.mutedFg} style={{ textDecoration: 'line-through' }}>
                                    {r[1]}
                                </T>
                                <ArrowRight size={10} color={C.mutedFg} />
                                <T size={9.5} weight={700} color={tone('mint')}>
                                    {r[2]}
                                </T>
                            </div>
                        ))}
                    </At>
                    <At x={14} y={176} w={372} h={26} a="le-foot" style={{ opacity: 0, display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                        <Btn label="Volver a editar" kind="outline" />
                        <Btn label="Aplicar a 214 registros" />
                    </At>
                    <At x={14} y={176} w={372} h={26} a="le-run" style={{ opacity: 0, display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                        <T size={9} weight={600} color={C.mutedFg}>
                            Aplicando… 200 de 214
                        </T>
                        <span style={{ height: 5, borderRadius: 3, background: C.muted, overflow: 'hidden' }}>
                            <span data-a="" style={{ display: 'block', height: '100%', width: '100%', background: primary(), animationName: 'le-prog' }} />
                        </span>
                    </At>
                    <At x={14} y={176} w={372} h={26} a="le-done" style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, background: tone('mint', 0.14), padding: '0 9px' }}>
                        <CheckCircle2 size={13} color={tone('mint')} />
                        <T size={9.5} weight={700}>
                            Se actualizaron 214 registros.
                        </T>
                        <span style={{ flex: 1 }} />
                        <Btn label="Deshacer" kind="outline" />
                        <Btn label="Listo" />
                    </At>
                </At>
            </At>
            <Cursor a="le-cur" click="le-ring" rest={[430, 286]} />
        </Stage>
    );
}
