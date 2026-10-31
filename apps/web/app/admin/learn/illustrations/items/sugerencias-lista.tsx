import { Bell, Check, Columns3, Lightbulb, Loader2, Sparkles } from 'lucide-react';

import { At, Bar, Btn, C, Chip, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * v0.1.341 — Sugerencias para una lista: el aviso de la cabecera abre el
 * panel; una sugerencia de reglas (con el porqué en datos de la lista) se
 * aplica con un clic, y «Analizar con IA» suma ideas a pedido gastando una
 * del cupo del mes.
 */

const PX = 244;
const PY = 38;

const CSS = `
@keyframes sl-panel{0%,15%{opacity:0;transform:translateX(26px)}19%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0;transform:translateX(12px)}}
@keyframes sl-chip{0%,10%{box-shadow:0 0 0 0 ${primary(0)}}12%{box-shadow:0 0 0 4px ${primary(0.25)}}16%,100%{box-shadow:0 0 0 0 ${primary(0)}}}
@keyframes sl-b1{0%,30%{opacity:1}33%,100%{opacity:0}}
@keyframes sl-d1{0%,30%{opacity:0;transform:scale(.9)}33%,100%{opacity:1;transform:scale(1)}}
@keyframes sl-c1{0%,30%{border-color:${C.border}}33%,100%{border-color:${tone('mint', 0.6)};background:${tone('mint', 0.06)}}}
@keyframes sl-run{0%,47%{opacity:1}50%,100%{opacity:0}}
@keyframes sl-busy{0%,48%{opacity:0}51%,61%{opacity:1}63%,100%{opacity:0}}
@keyframes sl-ai{0%,61%{opacity:0;transform:translateY(6px)}65%,100%{opacity:1;transform:translateY(0)}}
@keyframes sl-spin{to{transform:rotate(360deg)}}
@keyframes sl-cur{0%{transform:translate(430px,290px);opacity:0}5%{opacity:1}10%,13%{transform:translate(413px,57px)}26%,31%{transform:translate(${PX + 76}px,${PY + 109}px)}44%,49%{transform:translate(${PX + 70}px,${PY + 161}px)}90%{opacity:1;transform:translate(${PX + 70}px,${PY + 161}px)}96%,100%{opacity:0}}
@keyframes sl-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}16%{opacity:0;transform:scale(1.6)}29%{opacity:0;transform:scale(.4)}30%{opacity:1;transform:scale(1)}34%{opacity:0;transform:scale(1.6)}47%{opacity:0;transform:scale(.4)}48%{opacity:1;transform:scale(1)}52%,100%{opacity:0;transform:scale(1.6)}}
`;

const ROWS: Array<[number, string, 'amber' | 'mint', string]> = [
    [70, 'Pendiente', 'amber', '$ 300.000'],
    [56, 'Pagada', 'mint', '$ 450.000'],
    [80, 'Pendiente', 'amber', '$ 120.000'],
    [64, 'Pendiente', 'amber', '$ 980.000'],
    [74, 'Pagada', 'mint', '$ 210.000'],
    [60, 'Pendiente', 'amber', '$ 640.000'],
];

function Label({ y, text }: { y: number; text: string }): JSX.Element {
    return (
        <At x={12} y={y}>
            <T size={6.8} weight={700} color={C.mutedFg} style={{ letterSpacing: 0.6 }}>
                {text}
            </T>
        </At>
    );
}

export default function SugerenciasLista(): JSX.Element {
    return (
        <Stage
            label="En la lista de cobros, el aviso «Sugerencias» abre un panel: «Vista Vencidos» explica que 6 cobros pasaron su fecha y se crea con un clic; después «Analizar con IA» trae una idea propia, «Marca solo lo vencido», y el cupo del mes baja de 5 a 4."
            tint="violet"
            cycle={9}
        >
            <Keyframes css={CSS} />
            <Win x={14} y={12} w={452} h={276} title="Cobros · Tabla">
                {ROWS.map(([w, st, t, m], i) => (
                    <At key={i} x={0} y={36 + i * 26} w={452} h={26} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                        <Bar w={w} />
                        <Chip label={st} t={t} style={{ height: 15, fontSize: 7.5, padding: '0 6px' }} />
                        <T size={8.5}>{m}</T>
                    </At>
                ))}
            </Win>

            {/* El aviso de la cabecera */}
            <At
                x={370}
                y={48}
                w={86}
                h={18}
                a="sl-chip"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 99, border: `1px solid ${primary(0.4)}`, background: primary(0.08), color: primary() }}
            >
                <Lightbulb size={9} />
                <T size={7.5} weight={700} color={primary()}>
                    Sugerencias 3
                </T>
            </At>

            {/* El panel */}
            <At
                x={PX}
                y={PY}
                w={222}
                h={250}
                a="sl-panel"
                style={{ background: C.card, borderLeft: `1px solid ${C.border}`, boxShadow: '-14px 0 30px -18px rgba(15,23,42,.55)', borderBottomRightRadius: 12 }}
            >
                <At x={12} y={10} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Sparkles size={10} color={primary()} />
                    <T size={9} weight={700}>
                        Sugerencias para «Cobros»
                    </T>
                </At>

                <Label y={32} text="PARA TU LISTA" />
                <At x={10} y={46} w={202} h={78} a="sl-c1" style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 9, border: `1px solid ${C.border}` }}>
                    <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, background: tone('blue', 0.14), color: tone('blue'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Columns3 size={11} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                        <T size={8.2} weight={700}>
                            Vista «Vencidos»
                        </T>
                        <T size={6.6} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            6 cobros pasaron su fecha y siguen sin pagar.
                        </T>
                        <span style={{ position: 'relative', height: 17, marginTop: 'auto' }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'sl-b1' }}>
                                <Btn label="Crear la vista" style={{ height: 17, fontSize: 7.2 }} />
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 2, display: 'flex', alignItems: 'center', gap: 3, opacity: 0, animationName: 'sl-d1' }}>
                                <Check size={9} color={tone('mint')} />
                                <T size={7.2} weight={700} color={tone('mint')}>
                                    Creada · Ver
                                </T>
                            </span>
                        </span>
                    </span>
                </At>

                <Label y={134} text="CON IA" />
                {/* Antes de pedir: el botón y el cupo */}
                <At x={10} y={150} w={202} a="sl-run" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex' }}>
                        <Btn kind="outline" label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Sparkles size={8} />Analizar con IA</span>} style={{ height: 22, fontSize: 7.6 }} />
                    </span>
                    <T size={6.6} color={C.mutedFg}>
                        Te quedan 5 de 5 este mes
                    </T>
                </At>
                {/* Mientras analiza */}
                <At x={10} y={154} w={202} a="sl-busy" style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0 }}>
                    <span data-a="" style={{ display: 'flex', animationName: 'sl-spin', animationDuration: '0.9s', animationTimingFunction: 'linear' }}>
                        <Loader2 size={10} color={primary()} />
                    </span>
                    <T size={7.4} color={C.mutedFg}>
                        Leyendo tu lista…
                    </T>
                </At>
                {/* La idea de la IA */}
                <At x={10} y={150} w={202} a="sl-ai" style={{ display: 'flex', flexDirection: 'column', gap: 5, opacity: 0 }}>
                    <span style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 9, border: `1px solid ${primary(0.35)}`, background: primary(0.04) }}>
                        <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, background: tone('amber', 0.16), color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Bell size={11} />
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <T size={8.2} weight={700}>
                                    Marca solo lo vencido
                                </T>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, height: 11, padding: '0 4px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 6, fontWeight: 700, color: C.mutedFg }}>
                                    <Sparkles size={6} />
                                    IA
                                </span>
                            </span>
                            <T size={6.6} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                                El estado cambia solo al día siguiente del vencimiento.
                            </T>
                        </span>
                    </span>
                    <T size={6.6} color={C.mutedFg}>
                        Te quedan 4 de 5 este mes
                    </T>
                </At>
            </At>

            <Cursor a="sl-cur" click="sl-ring" rest={[PX + 70, PY + 161]} />
        </Stage>
    );
}
