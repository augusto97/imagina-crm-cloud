import { PenLine } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * Las preguntas nuevas del formulario (v0.1.355): una escala del 0 al 10, Sí o
 * No y un deslizador a la izquierda; una matriz para calificar varios aspectos
 * y una firma dibujada a la derecha. El cursor las responde una por una.
 */

const CSS = `
@keyframes fqt-cur{
0%{transform:translate(236px,268px)}
8%,10%{transform:translate(199px,91px)}
20%,22%{transform:translate(76px,160px)}
30%,31%{transform:translate(29px,214px)}
40%,42%{transform:translate(166px,214px)}
48%,50%{transform:translate(431px,110px)}
55%,57%{transform:translate(387px,130px)}
62%,64%{transform:translate(431px,150px)}
71%{transform:translate(286px,216px)}
86%,94%{transform:translate(426px,206px)}
100%{transform:translate(236px,268px)}}
@keyframes fqt-ring{
0%,8%{opacity:0;transform:scale(.4)}9%{opacity:1;transform:scale(1)}13%,20%{opacity:0;transform:scale(1.6)}
21%{opacity:1;transform:scale(1)}25%,30%{opacity:0;transform:scale(1.6)}
31%{opacity:1;transform:scale(1)}35%,48%{opacity:0;transform:scale(1.6)}
49%{opacity:1;transform:scale(1)}52%,55%{opacity:0;transform:scale(1.6)}
56%{opacity:1;transform:scale(1)}59%,62%{opacity:0;transform:scale(1.6)}
63%{opacity:1;transform:scale(1)}66%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fqt-nine{0%,9%{background:${C.card};color:${C.fg}}11%,94%{background:${primary()};color:#fff}98%,100%{background:${C.card};color:${C.fg}}}
@keyframes fqt-yes{0%,21%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}23%,94%{background:${primary(0.14)};box-shadow:0 0 0 2px ${primary()}}98%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes fqt-thumb{0%,31%{transform:translateX(-137px)}40%,94%{transform:translateX(0)}98%,100%{transform:translateX(-137px)}}
@keyframes fqt-fill{0%,31%{width:0}40%,94%{width:137px}98%,100%{width:0}}
@keyframes fqt-val{0%,33%{opacity:0}38%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes fqt-d1{0%,49%{opacity:0;transform:scale(.3)}51%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes fqt-d2{0%,56%{opacity:0;transform:scale(.3)}58%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes fqt-d3{0%,63%{opacity:0;transform:scale(.3)}65%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
@keyframes fqt-sign{0%,70%{stroke-dashoffset:100;opacity:0}71%{stroke-dashoffset:100;opacity:1}86%,94%{stroke-dashoffset:0;opacity:1}98%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:100;opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' } as const;
const COLS = ['Malo', 'Bien', 'Excelente'];
const ROWS: Array<{ label: string; answer: number; a: string }> = [
    { label: 'Atención', answer: 2, a: 'fqt-d1' },
    { label: 'Rapidez', answer: 1, a: 'fqt-d2' },
    { label: 'Precio', answer: 2, a: 'fqt-d3' },
];

export default function FormQuestionTypes(): JSX.Element {
    return (
        <Stage
            label="Las preguntas nuevas del formulario: una escala del 0 al 10, Sí o No, un deslizador para el presupuesto, una matriz para calificar varios aspectos a la vez y una firma dibujada con el dedo."
            cycle={11}
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Escala, Sí/No y deslizador */}
                <At x={20} y={50} w={214} h={200} style={CARD}>
                    <At x={10} y={14}>
                        <T size={8.5} weight={700}>
                            ¿Qué tan probable es que nos recomiendes?
                        </T>
                    </At>
                    {Array.from({ length: 11 }, (_, i) => (
                        <At
                            key={i}
                            x={9 + i * 18}
                            y={32}
                            w={16}
                            h={18}
                            a={i === 9 ? 'fqt-nine' : undefined}
                            style={{
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: i === 9 ? primary() : C.card,
                                color: i === 9 ? '#fff' : C.fg,
                                boxShadow: `0 0 0 1px ${C.border}`,
                            }}
                        >
                            <T size={7.5} weight={700} color="inherit">
                                {i}
                            </T>
                        </At>
                    ))}
                    <At x={9} y={54}>
                        <T size={6.5} color={C.mutedFg}>
                            Nada probable
                        </T>
                    </At>
                    <At x={140} y={54} w={65} style={{ textAlign: 'right' }}>
                        <T size={6.5} color={C.mutedFg}>
                            Muy probable
                        </T>
                    </At>

                    <At x={10} y={82}>
                        <T size={8.5} weight={700}>
                            ¿Volverías a comprar?
                        </T>
                    </At>
                    <At
                        x={9}
                        y={98}
                        w={95}
                        h={24}
                        a="fqt-yes"
                        style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: primary(0.14), boxShadow: `0 0 0 2px ${primary()}` }}
                    >
                        <T size={8.5} weight={700}>
                            Sí
                        </T>
                    </At>
                    <At
                        x={110}
                        y={98}
                        w={95}
                        h={24}
                        style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}
                    >
                        <T size={8.5} weight={700}>
                            No
                        </T>
                    </At>

                    <At x={10} y={140}>
                        <T size={8.5} weight={700}>
                            Presupuesto aproximado
                        </T>
                    </At>
                    <At x={140} y={140} w={65} a="fqt-val" style={{ textAlign: 'right' }}>
                        <T size={8} weight={800} color={primary()}>
                            $ 3.500.000
                        </T>
                    </At>
                    <At x={9} y={162} w={196} h={4} style={{ borderRadius: 99, background: C.muted }} />
                    <At x={9} y={162} w={137} h={4} a="fqt-fill" style={{ borderRadius: 99, background: primary() }} />
                    <At
                        x={140}
                        y={158}
                        w={12}
                        h={12}
                        a="fqt-thumb"
                        style={{ borderRadius: 99, background: C.card, boxShadow: `0 0 0 2px ${primary()}, 0 2px 6px -2px rgba(15,23,42,.4)` }}
                    />
                    <At x={9} y={174}>
                        <T size={6.5} color={C.mutedFg}>
                            $ 0
                        </T>
                    </At>
                    <At x={140} y={174} w={65} style={{ textAlign: 'right' }}>
                        <T size={6.5} color={C.mutedFg}>
                            $ 5.000.000
                        </T>
                    </At>
                </At>

                {/* Matriz y firma */}
                <At x={246} y={50} w={214} h={200} style={CARD}>
                    <At x={10} y={14}>
                        <T size={8.5} weight={700}>
                            ¿Cómo nos fue?
                        </T>
                    </At>
                    {COLS.map((c, j) => (
                        <At key={c} x={75 + j * 44} y={32} w={44} style={{ textAlign: 'center' }}>
                            <T size={6.5} weight={700} color={C.mutedFg}>
                                {c}
                            </T>
                        </At>
                    ))}
                    {ROWS.map((r, i) => (
                        <At key={r.label} x={0} y={50 + i * 20} w={214} h={20}>
                            {i > 0 ? <At x={9} y={0} w={196} h={1} style={{ background: C.border }} /> : null}
                            <At x={10} y={5}>
                                <T size={7.5}>{r.label}</T>
                            </At>
                            {COLS.map((c, j) => (
                                <At
                                    key={c}
                                    x={75 + j * 44 + 16}
                                    y={4}
                                    w={12}
                                    h={12}
                                    style={{ borderRadius: 99, boxShadow: `0 0 0 1.5px ${j === r.answer ? primary() : C.border}`, background: C.card }}
                                >
                                    {j === r.answer ? (
                                        <At x={3} y={3} w={6} h={6} a={r.a} style={{ borderRadius: 99, background: primary() }} />
                                    ) : null}
                                </At>
                            ))}
                        </At>
                    ))}

                    <At x={10} y={122} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <PenLine size={9} color={C.mutedFg} />
                        <T size={8.5} weight={700}>
                            Firma
                        </T>
                    </At>
                    <At x={9} y={136} w={196} h={48} style={{ borderRadius: 6, border: `1px dashed ${C.border}`, background: C.canvas }}>
                        <svg width={196} height={48} viewBox="0 0 196 48" style={{ position: 'absolute', left: 0, top: 0 }}>
                            <path
                                d="M 30 30 C 36 8, 44 6, 46 26 S 56 40, 62 20 S 74 8, 78 26 S 90 36, 98 18 C 103 8, 110 26, 118 24 S 136 14, 150 22 S 162 26, 172 18"
                                pathLength={100}
                                fill="none"
                                stroke={C.fg}
                                strokeWidth={1.8}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeDasharray={100}
                                data-a=""
                                style={{ animationName: 'fqt-sign', strokeDashoffset: 0 }}
                            />
                        </svg>
                        <At x={8} y={36} w={180} h={1} style={{ background: C.border }} />
                    </At>
                </At>

                <Cursor a="fqt-cur" click="fqt-ring" rest={[426, 206]} />
            </At>
        </Stage>
    );
}
